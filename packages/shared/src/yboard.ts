import * as Y from 'yjs';
import { z } from 'zod';
import {
  CANVAS_TEXT_MAX_CHARS,
  DEFAULT_ITEM_SIZE,
  isSticker,
  ITEM_SIZE_LIMITS,
  TEXT_COLORS,
  TEXT_SIZES,
  type TextColor,
  type TextSize,
} from './canvas';
import type { DraftStop } from './itinerary/types';
import { compareByPosition, keyBetween, keysBetween } from './ordering';
import { randomId } from './net';

/*
 * The plan's collaborative document (one Y.Doc per plan, name `plan:<id>`):
 *
 *   nodes : Y.Map<ideaId, Y.Map>   board layout. Keyed by idea id, so an idea
 *                                  has at most one card and two clients that
 *                                  auto-place the same idea write the same key.
 *            pos    {x, y}         one atomic value: concurrent drags never mix
 *                                  one user's x with another user's y
 *            hidden boolean        "remove from board" (the idea itself stays)
 *   items : Y.Map<itemId, Y.Map>   free canvas items that aren't ideas
 *            kind   text | photo | sticker   (fixed when created)
 *            pos    {x, y}  atomic          size {w, h}  atomic
 *            createdAt number               stable stacking order
 *            text   Y.Text                  (text) merges concurrent typing
 *            color, textSize                (text) registers
 *            photoId                        (photo) a row in plan_photos
 *            emoji                          (sticker)
 *   links : Y.Map<linkId, Y.Map>   arrows between any two things on the board
 *            from, to                       idea ids or item ids
 *   draft : Y.Map<stopId, Y.Map>   the shared itinerary draft
 *            order  {dayIndex, position}   atomic, so a concurrent move of the
 *                                  same stop can't split day and position
 *            ...other fields       independent last-writer-wins registers
 *   meta  : Y.Map                  schemaVersion, draftBaseVersion
 *
 * Every write goes through these helpers inside one transaction tagged with
 * LOCAL_ORIGIN, which lets an UndoManager undo only the local user's edits.
 * Readers validate everything: any client can write anything into a CRDT.
 */

export const BOARD_SCHEMA_VERSION = 1;
export const LOCAL_ORIGIN = 'orbit-local';

export function docNameForPlan(planId: string): string {
  return `plan:${planId}`;
}

export function planIdFromDocName(name: string): string | null {
  const match = /^plan:([A-Za-z0-9_-]{1,64})$/.exec(name);
  return match ? match[1]! : null;
}

type YRecord = Y.Map<unknown>;

function maps(doc: Y.Doc) {
  return {
    nodes: doc.getMap<YRecord>('nodes'),
    items: doc.getMap<YRecord>('items'),
    links: doc.getMap<YRecord>('links'),
    draft: doc.getMap<YRecord>('draft'),
    meta: doc.getMap<unknown>('meta'),
  };
}

function transact(doc: Y.Doc, fn: () => void): void {
  doc.transact(fn, LOCAL_ORIGIN);
}

// ─── Board layout ───────────────────────────────────────────────────────────

export interface BoardPoint {
  x: number;
  y: number;
}

export interface BoardNode extends BoardPoint {
  ideaId: string;
  hidden: boolean;
}

const pointSchema = z.object({ x: z.number(), y: z.number() });

export function readBoardNodes(doc: Y.Doc): BoardNode[] {
  const out: BoardNode[] = [];
  maps(doc).nodes.forEach((node, ideaId) => {
    if (!(node instanceof Y.Map)) return;
    const pos = pointSchema.safeParse(node.get('pos'));
    if (!pos.success || !Number.isFinite(pos.data.x) || !Number.isFinite(pos.data.y)) return;
    out.push({ ideaId, ...pos.data, hidden: node.get('hidden') === true });
  });
  return out;
}

function nodeFor(doc: Y.Doc, ideaId: string): YRecord {
  const { nodes } = maps(doc);
  const existing = nodes.get(ideaId);
  if (existing instanceof Y.Map) return existing;
  const node = new Y.Map<unknown>();
  nodes.set(ideaId, node);
  node.set('kind', 'idea');
  node.set('hidden', false);
  return node;
}

/** Puts an idea's card at `point` (creating it, or bringing it back if hidden). */
export function placeIdeaNode(doc: Y.Doc, ideaId: string, point: BoardPoint): void {
  transact(doc, () => {
    const node = nodeFor(doc, ideaId);
    node.set('pos', { x: point.x, y: point.y });
    node.set('hidden', false);
  });
}

export function moveIdeaNode(doc: Y.Doc, ideaId: string, point: BoardPoint): void {
  transact(doc, () => {
    nodeFor(doc, ideaId).set('pos', { x: point.x, y: point.y });
  });
}

export function setIdeaNodeHidden(doc: Y.Doc, ideaId: string, hidden: boolean): void {
  transact(doc, () => {
    nodeFor(doc, ideaId).set('hidden', hidden);
  });
}

/**
 * Gives every idea without a card a position from `layout`. Ideas whose card
 * was hidden on purpose stay hidden. Returns the ids that were placed.
 */
export function ensureIdeasPlaced(
  doc: Y.Doc,
  ideaIds: readonly string[],
  layout: (slot: number) => BoardPoint,
): string[] {
  const { nodes } = maps(doc);
  const missing = ideaIds.filter((id) => !nodes.has(id));
  if (missing.length === 0) return [];
  transact(doc, () => {
    let slot = nodes.size;
    for (const id of missing) {
      const node = nodeFor(doc, id);
      node.set('pos', layout(slot));
      slot += 1;
    }
  });
  return missing;
}

// ─── Free canvas: text, photos, stickers and arrows ────────────────────────

const ITEM_ID = /^it_[A-Za-z0-9-]{8,64}$/;
const LINK_ID = /^ln_[A-Za-z0-9-]{8,64}$/;
const NODE_REF = /^[A-Za-z0-9_-]{1,80}$/;
const PHOTO_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** Item ids can't collide with idea ids (cuids never start with `it_`). */
export function isCanvasItemId(id: string): boolean {
  return ITEM_ID.test(id);
}

export interface BoardBox extends BoardPoint {
  w: number;
  /** 0 for text: its height follows the text. */
  h: number;
}

interface ItemBase extends BoardBox {
  id: string;
  createdAt: number;
}
export interface TextItem extends ItemBase {
  kind: 'text';
  text: string;
  color: TextColor;
  textSize: TextSize;
}
export interface PhotoItem extends ItemBase {
  kind: 'photo';
  photoId: string;
}
export interface StickerItem extends ItemBase {
  kind: 'sticker';
  emoji: string;
}
export type CanvasItem = TextItem | PhotoItem | StickerItem;

export interface CanvasLink {
  id: string;
  from: string;
  to: string;
}

const sizeSchema = z.object({ w: z.number(), h: z.number() });
const finite = (n: number) => Number.isFinite(n);
const clampSize = (n: number) => Math.min(ITEM_SIZE_LIMITS.max, Math.max(ITEM_SIZE_LIMITS.min, n));
const oneOf = <T extends string>(list: readonly T[], value: unknown, fallback: T): T =>
  list.includes(value as T) ? (value as T) : fallback;

function readItem(id: string, m: YRecord): CanvasItem | null {
  if (!ITEM_ID.test(id)) return null;
  const pos = pointSchema.safeParse(m.get('pos'));
  if (!pos.success || !finite(pos.data.x) || !finite(pos.data.y)) return null;
  const size = sizeSchema.safeParse(m.get('size'));
  const createdAt = m.get('createdAt');
  const box = {
    id,
    x: pos.data.x,
    y: pos.data.y,
    createdAt: typeof createdAt === 'number' && finite(createdAt) ? createdAt : 0,
  };
  const w = (fallback: number) => (size.success && finite(size.data.w) ? clampSize(size.data.w) : fallback);
  const h = (fallback: number) => (size.success && finite(size.data.h) ? clampSize(size.data.h) : fallback);

  switch (m.get('kind')) {
    case 'text': {
      const t = m.get('text');
      const text = t instanceof Y.Text ? t.toString() : typeof t === 'string' ? t : '';
      return {
        ...box,
        kind: 'text',
        w: w(DEFAULT_ITEM_SIZE.text.w),
        h: 0,
        text: text.slice(0, CANVAS_TEXT_MAX_CHARS),
        color: oneOf(TEXT_COLORS, m.get('color'), 'plain'),
        textSize: oneOf(TEXT_SIZES, m.get('textSize'), 'm'),
      };
    }
    case 'photo': {
      const photoId = m.get('photoId');
      if (typeof photoId !== 'string' || !PHOTO_ID.test(photoId)) return null;
      const width = w(DEFAULT_ITEM_SIZE.photoWidth);
      return { ...box, kind: 'photo', w: width, h: h(width), photoId };
    }
    case 'sticker': {
      const emoji = m.get('emoji');
      if (!isSticker(emoji)) return null;
      return { ...box, kind: 'sticker', w: w(DEFAULT_ITEM_SIZE.sticker.w), h: h(DEFAULT_ITEM_SIZE.sticker.h), emoji };
    }
    default:
      return null;
  }
}

/** Canvas items, oldest first (a stable stacking order on every screen). */
export function readCanvasItems(doc: Y.Doc): CanvasItem[] {
  const out: CanvasItem[] = [];
  maps(doc).items.forEach((m, id) => {
    if (!(m instanceof Y.Map)) return;
    const item = readItem(id, m);
    if (item) out.push(item);
  });
  return out.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Arrows, one per direction between two things (two people drawing the same
 * arrow at once both write one; the smaller id wins). Whether both ends are
 * on the board right now is the board's call: an arrow to a hidden card comes
 * back with the card.
 */
export function readCanvasLinks(doc: Y.Doc): CanvasLink[] {
  const byPair = new Map<string, CanvasLink>();
  maps(doc).links.forEach((m, id) => {
    if (!(m instanceof Y.Map) || !LINK_ID.test(id)) return;
    const from = m.get('from');
    const to = m.get('to');
    if (typeof from !== 'string' || typeof to !== 'string' || from === to) return;
    if (!NODE_REF.test(from) || !NODE_REF.test(to)) return;
    const key = `${from}\u0000${to}`;
    const seen = byPair.get(key);
    if (!seen || id < seen.id) byPair.set(key, { id, from, to });
  });
  return [...byPair.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
}

interface NewItem extends BoardPoint {
  w?: number;
  h?: number;
}

function addItem(doc: Y.Doc, kind: CanvasItem['kind'], at: NewItem, size: { w: number; h: number }, fill: (m: YRecord) => void): string {
  const id = `it_${randomId()}`;
  transact(doc, () => {
    const m = new Y.Map<unknown>();
    maps(doc).items.set(id, m);
    m.set('kind', kind);
    m.set('pos', { x: at.x, y: at.y });
    m.set('size', size);
    m.set('createdAt', Date.now());
    fill(m);
  });
  return id;
}

export function addTextItem(
  doc: Y.Doc,
  input: NewItem & { text?: string; color?: TextColor; textSize?: TextSize },
): string {
  return addItem(doc, 'text', input, { w: clampSize(input.w ?? DEFAULT_ITEM_SIZE.text.w), h: 0 }, (m) => {
    const text = new Y.Text();
    m.set('text', text);
    if (input.text) text.insert(0, capText(input.text));
    m.set('color', input.color ?? 'plain');
    m.set('textSize', input.textSize ?? 'm');
  });
}

export function addPhotoItem(doc: Y.Doc, input: NewItem & { w: number; h: number; photoId: string }): string {
  if (!PHOTO_ID.test(input.photoId)) throw new Error('Invalid photo id.');
  return addItem(doc, 'photo', input, { w: clampSize(input.w), h: clampSize(input.h) }, (m) => m.set('photoId', input.photoId));
}

export function addStickerItem(doc: Y.Doc, input: NewItem & { emoji: string }): string {
  if (!isSticker(input.emoji)) throw new Error('Not an emoji.');
  const side = clampSize(input.w ?? DEFAULT_ITEM_SIZE.sticker.w);
  return addItem(doc, 'sticker', input, { w: side, h: side }, (m) => m.set('emoji', input.emoji));
}

/** Moves cards and items together (one undo step), e.g. after a multi-select drag. */
export function moveBoardNodes(doc: Y.Doc, moves: ReadonlyArray<{ id: string } & BoardPoint>): void {
  if (moves.length === 0) return;
  transact(doc, () => {
    const { items } = maps(doc);
    for (const { id, x, y } of moves) {
      if (!finite(x) || !finite(y)) continue;
      if (ITEM_ID.test(id)) items.get(id)?.set('pos', { x, y });
      else nodeFor(doc, id).set('pos', { x, y });
    }
  });
}

/** After a resize: the box can move too (dragging a left or top edge). */
export function resizeCanvasItem(doc: Y.Doc, id: string, box: BoardBox): void {
  if (![box.x, box.y, box.w, box.h].every(finite)) return;
  transact(doc, () => {
    const m = maps(doc).items.get(id);
    if (!(m instanceof Y.Map)) return;
    m.set('pos', { x: box.x, y: box.y });
    m.set('size', { w: clampSize(box.w), h: m.get('kind') === 'text' ? 0 : clampSize(box.h) });
  });
}

export function styleTextItem(doc: Y.Doc, id: string, patch: { color?: TextColor; textSize?: TextSize }): void {
  transact(doc, () => {
    const m = maps(doc).items.get(id);
    if (!(m instanceof Y.Map) || m.get('kind') !== 'text') return;
    if (patch.color && TEXT_COLORS.includes(patch.color)) m.set('color', patch.color);
    if (patch.textSize && TEXT_SIZES.includes(patch.textSize)) m.set('textSize', patch.textSize);
  });
}

/** The shared text of a text item, for binding an editor to it. */
export function canvasText(doc: Y.Doc, id: string): Y.Text | null {
  const t = maps(doc).items.get(id)?.get('text');
  return t instanceof Y.Text ? t : null;
}

const isHighSurrogate = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLowSurrogate = (c: number) => c >= 0xdc00 && c <= 0xdfff;

function capText(text: string): string {
  if (text.length <= CANVAS_TEXT_MAX_CHARS) return text;
  const cut = text.slice(0, CANVAS_TEXT_MAX_CHARS);
  return isHighSurrogate(cut.charCodeAt(cut.length - 1)) ? cut.slice(0, -1) : cut;
}

/**
 * Sets a text item's text by applying only what changed (one delete and one
 * insert around the edit), so two people typing in the same box keep both
 * edits. Never splits an emoji's surrogate pair.
 */
export function setCanvasText(doc: Y.Doc, id: string, value: string): void {
  const text = canvasText(doc, id);
  if (!text) return;
  const next = capText(value);
  const prev = text.toString();
  if (prev === next) return;
  let start = 0;
  const max = Math.min(prev.length, next.length);
  while (start < max && prev.charCodeAt(start) === next.charCodeAt(start)) start += 1;
  if (start > 0 && isHighSurrogate(prev.charCodeAt(start - 1))) start -= 1;
  let endPrev = prev.length;
  let endNext = next.length;
  while (endPrev > start && endNext > start && prev.charCodeAt(endPrev - 1) === next.charCodeAt(endNext - 1)) {
    endPrev -= 1;
    endNext -= 1;
  }
  if (endPrev < prev.length && isLowSurrogate(prev.charCodeAt(endPrev))) {
    endPrev += 1;
    endNext += 1;
  }
  transact(doc, () => {
    if (endPrev > start) text.delete(start, endPrev - start);
    if (endNext > start) text.insert(start, next.slice(start, endNext));
  });
}

/** Deletes items and every arrow touching them. */
export function removeCanvasItems(doc: Y.Doc, ids: readonly string[]): void {
  const gone = new Set(ids.filter((id) => ITEM_ID.test(id)));
  if (gone.size === 0) return;
  transact(doc, () => {
    const { items, links } = maps(doc);
    for (const id of gone) items.delete(id);
    links.forEach((m, linkId) => {
      if (m instanceof Y.Map && (gone.has(m.get('from') as string) || gone.has(m.get('to') as string))) links.delete(linkId);
    });
  });
}

/** Draws an arrow (or returns the one already drawn the same way). Null for a self-arrow. */
export function addCanvasLink(doc: Y.Doc, from: string, to: string): string | null {
  if (from === to || !NODE_REF.test(from) || !NODE_REF.test(to)) return null;
  const existing = readCanvasLinks(doc).find((l) => l.from === from && l.to === to);
  if (existing) return existing.id;
  const id = `ln_${randomId()}`;
  transact(doc, () => {
    const m = new Y.Map<unknown>();
    maps(doc).links.set(id, m);
    m.set('from', from);
    m.set('to', to);
  });
  return id;
}

export function removeCanvasLinks(doc: Y.Doc, ids: readonly string[]): void {
  if (ids.length === 0) return;
  transact(doc, () => {
    const { links } = maps(doc);
    for (const id of ids) links.delete(id);
  });
}

// ─── Itinerary draft ────────────────────────────────────────────────────────

const orderSchema = z.object({ dayIndex: z.number().int().min(0), position: z.string().min(1) });
const intOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);

function readStop(id: string, m: YRecord): DraftStop | null {
  const order = orderSchema.safeParse(m.get('order'));
  if (!order.success) return null;
  const title = m.get('title');
  const ideaId = m.get('ideaId');
  const currency = m.get('costCurrency');
  return {
    id,
    ideaId: typeof ideaId === 'string' ? ideaId : null,
    title: typeof title === 'string' && title.trim() ? title : 'Untitled stop',
    position: order.data.position,
    dayIndex: order.data.dayIndex,
    // Kept even when invalid: the validator reports it instead of the stop vanishing.
    durationMin: intOrNull(m.get('durationMin')) ?? 60,
    fixedStartMin: intOrNull(m.get('fixedStartMin')),
    locked: m.get('locked') === true,
    travelMinFromPrev: intOrNull(m.get('travelMinFromPrev')),
    costMinor: intOrNull(m.get('costMinor')),
    costCurrency: typeof currency === 'string' && /^[A-Z]{3}$/.test(currency) ? currency : null,
  };
}

export function readDraft(doc: Y.Doc): DraftStop[] {
  const out: DraftStop[] = [];
  maps(doc).draft.forEach((m, id) => {
    if (!(m instanceof Y.Map)) return;
    const stop = readStop(id, m);
    if (stop) out.push(stop);
  });
  return out.sort((a, b) => a.dayIndex - b.dayIndex || compareByPosition(a, b));
}

type StopFields = Omit<DraftStop, 'id' | 'position' | 'dayIndex'>;
export type DraftStopPatch = Partial<Omit<StopFields, 'ideaId'>>;
export type NewDraftStop = StopFields & { id?: string; dayIndex?: number };

const FIELD_KEYS = [
  'ideaId',
  'title',
  'durationMin',
  'fixedStartMin',
  'locked',
  'travelMinFromPrev',
  'costMinor',
  'costCurrency',
] as const satisfies ReadonlyArray<keyof StopFields>;

function writeFields(m: YRecord, fields: Partial<StopFields>): void {
  for (const key of FIELD_KEYS) {
    if (key in fields) m.set(key, fields[key] ?? null);
  }
}

function dayStops(doc: Y.Doc, dayIndex: number, excludeId?: string): DraftStop[] {
  return readDraft(doc).filter((s) => s.dayIndex === dayIndex && s.id !== excludeId);
}

/** Re-keys one day evenly. Only needed after concurrent inserts produced equal keys. */
function rebalanceDay(doc: Y.Doc, stops: readonly DraftStop[]): void {
  const keys = keysBetween(null, null, stops.length);
  const { draft } = maps(doc);
  stops.forEach((stop, i) => {
    draft.get(stop.id)?.set('order', { dayIndex: stop.dayIndex, position: keys[i]! });
  });
}

function positionAt(doc: Y.Doc, dayIndex: number, index: number, excludeId?: string): string {
  let stops = dayStops(doc, dayIndex, excludeId);
  const i = Math.max(0, Math.min(index, stops.length));
  const before = stops[i - 1]?.position ?? null;
  const after = stops[i]?.position ?? null;
  if (before !== null && after !== null && before >= after) {
    rebalanceDay(doc, stops);
    stops = dayStops(doc, dayIndex, excludeId);
    return keyBetween(stops[i - 1]?.position ?? null, stops[i]?.position ?? null);
  }
  return keyBetween(before, after);
}

/** Adds a stop to a day (at `index`, default: the end). Returns its id. */
export function addDraftStop(doc: Y.Doc, input: NewDraftStop, opts: { index?: number } = {}): string {
  const id = input.id ?? randomId();
  const dayIndex = input.dayIndex ?? 0;
  transact(doc, () => {
    const position = positionAt(doc, dayIndex, opts.index ?? Number.MAX_SAFE_INTEGER);
    const m = new Y.Map<unknown>();
    maps(doc).draft.set(id, m);
    m.set('order', { dayIndex, position });
    writeFields(m, input);
  });
  return id;
}

export function moveDraftStop(doc: Y.Doc, stopId: string, to: { dayIndex: number; index: number }): void {
  transact(doc, () => {
    const m = maps(doc).draft.get(stopId);
    if (!(m instanceof Y.Map)) return;
    const position = positionAt(doc, to.dayIndex, to.index, stopId);
    m.set('order', { dayIndex: to.dayIndex, position });
  });
}

export function updateDraftStop(doc: Y.Doc, stopId: string, patch: DraftStopPatch): void {
  transact(doc, () => {
    const m = maps(doc).draft.get(stopId);
    if (m instanceof Y.Map) writeFields(m, patch);
  });
}

export function removeDraftStop(doc: Y.Doc, stopId: string): void {
  transact(doc, () => {
    maps(doc).draft.delete(stopId);
  });
}

/**
 * Replaces the whole draft, keeping the given stop ids (e.g. "restore version
 * 3 to the draft"). Stops keep their relative order within each day.
 */
export function replaceDraft(
  doc: Y.Doc,
  stops: ReadonlyArray<Omit<DraftStop, 'position'>>,
  baseVersion?: number,
): void {
  transact(doc, () => {
    const { draft, meta } = maps(doc);
    draft.clear();
    const byDay = new Map<number, Array<Omit<DraftStop, 'position'>>>();
    for (const stop of stops) byDay.set(stop.dayIndex, [...(byDay.get(stop.dayIndex) ?? []), stop]);
    for (const [dayIndex, day] of byDay) {
      const keys = keysBetween(null, null, day.length);
      day.forEach((stop, i) => {
        const m = new Y.Map<unknown>();
        draft.set(stop.id, m);
        m.set('order', { dayIndex, position: keys[i]! });
        writeFields(m, stop);
      });
    }
    if (baseVersion !== undefined) meta.set('draftBaseVersion', baseVersion);
  });
}

/** The confirmed version the draft was last committed as or restored from. */
export function getDraftBaseVersion(doc: Y.Doc): number {
  const v = maps(doc).meta.get('draftBaseVersion');
  return typeof v === 'number' ? v : 0;
}

export function setDraftBaseVersion(doc: Y.Doc, version: number): void {
  transact(doc, () => {
    maps(doc).meta.set('draftBaseVersion', version);
  });
}

export function initBoardDoc(doc: Y.Doc): void {
  const { meta } = maps(doc);
  if (meta.get('schemaVersion') !== BOARD_SCHEMA_VERSION) {
    transact(doc, () => meta.set('schemaVersion', BOARD_SCHEMA_VERSION));
  }
}

/** Calls `onChange` after any local or remote change to the board, canvas or draft. */
export function observeBoard(doc: Y.Doc, onChange: () => void): () => void {
  const { nodes, items, links, draft, meta } = maps(doc);
  const deep = [nodes, items, links, draft];
  const handler = () => onChange();
  for (const m of deep) m.observeDeep(handler);
  meta.observe(handler);
  return () => {
    for (const m of deep) m.unobserveDeep(handler);
    meta.unobserve(handler);
  };
}

/** Undo/redo scoped to this user's own board, canvas and draft edits. */
export function createLocalUndoManager(doc: Y.Doc): Y.UndoManager {
  const { nodes, items, links, draft } = maps(doc);
  return new Y.UndoManager([nodes, items, links, draft], { trackedOrigins: new Set([LOCAL_ORIGIN]) });
}
