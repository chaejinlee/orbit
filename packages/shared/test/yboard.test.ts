import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { firstSticker, isSticker } from '../src/canvas';
import {
  addCanvasLink,
  addDraftStop,
  addPhotoItem,
  addStickerItem,
  addTextItem,
  canvasText,
  createLocalUndoManager,
  ensureIdeasPlaced,
  moveDraftStop,
  moveBoardNodes,
  moveIdeaNode,
  placeIdeaNode,
  planIdFromDocName,
  readBoardNodes,
  readCanvasItems,
  readCanvasLinks,
  readDraft,
  removeCanvasItems,
  removeCanvasLinks,
  removeDraftStop,
  resizeCanvasItem,
  setCanvasText,
  styleTextItem,
  replaceDraft,
  setIdeaNodeHidden,
  updateDraftStop,
} from '../src/yboard';

const base = {
  ideaId: null,
  durationMin: 60,
  fixedStartMin: null,
  locked: false,
  travelMinFromPrev: null,
  costMinor: null,
  costCurrency: null,
};

/** Two replicas that exchange updates only when we say so (simulates being offline). */
function pair() {
  const a = new Y.Doc();
  const b = new Y.Doc();
  const sync = () => {
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
  };
  return { a, b, sync };
}

const titles = (doc: Y.Doc) => readDraft(doc).map((s) => s.title);

describe('board layout', () => {
  it('keeps both edits when one user moves a card and another hides a different one', () => {
    const { a, b, sync } = pair();
    placeIdeaNode(a, 'i1', { x: 0, y: 0 });
    placeIdeaNode(a, 'i2', { x: 300, y: 0 });
    sync();
    moveIdeaNode(a, 'i1', { x: 40, y: 80 });
    setIdeaNodeHidden(b, 'i2', true);
    sync();
    for (const doc of [a, b]) {
      expect(readBoardNodes(doc)).toEqual(
        expect.arrayContaining([
          { ideaId: 'i1', x: 40, y: 80, hidden: false },
          { ideaId: 'i2', x: 300, y: 0, hidden: true },
        ]),
      );
    }
  });

  it('never mixes coordinates from two concurrent drags of the same card', () => {
    const { a, b, sync } = pair();
    placeIdeaNode(a, 'i1', { x: 0, y: 0 });
    sync();
    moveIdeaNode(a, 'i1', { x: 100, y: 100 });
    moveIdeaNode(b, 'i1', { x: -50, y: -50 });
    sync();
    const [na] = readBoardNodes(a);
    const [nb] = readBoardNodes(b);
    expect(na).toEqual(nb);
    expect([{ x: 100, y: 100 }, { x: -50, y: -50 }]).toContainEqual({ x: na!.x, y: na!.y });
  });

  it('does not duplicate cards when two clients auto-place the same idea', () => {
    const { a, b, sync } = pair();
    ensureIdeasPlaced(a, ['i1', 'i2'], (slot) => ({ x: slot * 300, y: 0 }));
    ensureIdeasPlaced(b, ['i1', 'i2'], (slot) => ({ x: slot * 300, y: 0 }));
    sync();
    expect(readBoardNodes(a)).toHaveLength(2);
    expect(readBoardNodes(a)).toEqual(readBoardNodes(b));
  });

  it('leaves intentionally hidden cards hidden', () => {
    const doc = new Y.Doc();
    placeIdeaNode(doc, 'i1', { x: 0, y: 0 });
    setIdeaNodeHidden(doc, 'i1', true);
    expect(ensureIdeasPlaced(doc, ['i1'], () => ({ x: 9, y: 9 }))).toEqual([]);
    expect(readBoardNodes(doc)[0]?.hidden).toBe(true);
  });
});

describe('itinerary draft', () => {
  it('inserts at an index and moves stops', () => {
    const doc = new Y.Doc();
    addDraftStop(doc, { ...base, title: 'Coffee' });
    addDraftStop(doc, { ...base, title: 'Dinner' });
    const museum = addDraftStop(doc, { ...base, title: 'Museum' }, { index: 1 });
    expect(titles(doc)).toEqual(['Coffee', 'Museum', 'Dinner']);
    moveDraftStop(doc, museum, { dayIndex: 0, index: 0 });
    expect(titles(doc)).toEqual(['Museum', 'Coffee', 'Dinner']);
  });

  it('merges concurrent reorders of different stops', () => {
    const { a, b, sync } = pair();
    const ids = ['A', 'B', 'C', 'D'].map((t) => addDraftStop(a, { ...base, title: t }));
    sync();
    moveDraftStop(a, ids[0]!, { dayIndex: 0, index: 3 }); // A to the end
    moveDraftStop(b, ids[3]!, { dayIndex: 0, index: 0 }); // D to the front
    sync();
    expect(titles(a)).toEqual(titles(b));
    expect(titles(a)[0]).toBe('D');
    expect(titles(a).at(-1)).toBe('A');
  });

  it('never duplicates a stop moved by two people at once', () => {
    const { a, b, sync } = pair();
    const ids = ['A', 'B', 'C'].map((t) => addDraftStop(a, { ...base, title: t }));
    sync();
    moveDraftStop(a, ids[1]!, { dayIndex: 0, index: 0 });
    moveDraftStop(b, ids[1]!, { dayIndex: 0, index: 2 });
    sync();
    expect(titles(a)).toEqual(titles(b));
    expect(titles(a).filter((t) => t === 'B')).toHaveLength(1);
    expect(titles(a)).toHaveLength(3);
  });

  it('orders concurrent inserts at the same spot identically on every replica', () => {
    const { a, b, sync } = pair();
    addDraftStop(a, { ...base, title: 'Coffee' });
    addDraftStop(a, { ...base, title: 'Dinner' });
    sync();
    addDraftStop(a, { ...base, title: 'Museum' }, { index: 1 });
    addDraftStop(b, { ...base, title: 'Park' }, { index: 1 });
    sync();
    expect(titles(a)).toEqual(titles(b));
    expect(titles(a)[0]).toBe('Coffee');
    expect(titles(a)[3]).toBe('Dinner');
    // A later insert between the tied stops still works (rebalances the day).
    addDraftStop(a, { ...base, title: 'Snack' }, { index: 2 });
    expect(titles(a)[2]).toBe('Snack');
    expect(new Set(readDraft(a).map((s) => s.position)).size).toBe(5);
  });

  it('keeps an edit to one field when another field changes concurrently', () => {
    const { a, b, sync } = pair();
    const id = addDraftStop(a, { ...base, title: 'Dinner' });
    sync();
    updateDraftStop(a, id, { locked: true, fixedStartMin: 19 * 60 });
    updateDraftStop(b, id, { durationMin: 90 });
    sync();
    expect(readDraft(b)[0]).toMatchObject({ locked: true, fixedStartMin: 1140, durationMin: 90 });
  });

  it('a stop deleted offline stays deleted after reconnect even if edited elsewhere', () => {
    const { a, b, sync } = pair();
    const id = addDraftStop(a, { ...base, title: 'Dessert' });
    sync();
    removeDraftStop(a, id);
    updateDraftStop(b, id, { durationMin: 30 });
    sync();
    expect(readDraft(a)).toEqual([]);
    expect(readDraft(b)).toEqual([]);
  });

  it('replaces the draft while keeping stable stop ids', () => {
    const doc = new Y.Doc();
    addDraftStop(doc, { ...base, title: 'Old' });
    replaceDraft(
      doc,
      [
        { ...base, id: 'k1', title: 'One', dayIndex: 0 },
        { ...base, id: 'k2', title: 'Two', dayIndex: 0 },
      ],
      3,
    );
    expect(readDraft(doc).map((s) => [s.id, s.title])).toEqual([
      ['k1', 'One'],
      ['k2', 'Two'],
    ]);
  });

  it('skips malformed entries instead of crashing', () => {
    const doc = new Y.Doc();
    doc.getMap('draft').set('bad', new Y.Map());
    doc.getMap('nodes').set('bad', 42 as never);
    expect(readDraft(doc)).toEqual([]);
    expect(readBoardNodes(doc)).toEqual([]);
  });

  it('undoes only local edits', () => {
    const { a, b, sync } = pair();
    const undo = createLocalUndoManager(a);
    addDraftStop(a, { ...base, title: 'Mine' });
    sync();
    // b's change arrives through a remote update, which the undo manager ignores.
    addDraftStop(b, { ...base, title: 'Theirs' });
    sync();
    undo.undo();
    expect(titles(a)).toEqual(['Theirs']);
  });

  it('only accepts well-formed document names', () => {
    expect(planIdFromDocName('plan:abc123')).toBe('abc123');
    expect(planIdFromDocName('plan:')).toBeNull();
    expect(planIdFromDocName('plan:../etc')).toBeNull();
    expect(planIdFromDocName('other:abc')).toBeNull();
  });
});

const textOf = (doc: Y.Doc, id: string) => {
  const item = readCanvasItems(doc).find((i) => i.id === id);
  return item?.kind === 'text' ? item.text : undefined;
};

describe('canvas items and arrows', () => {
  it('adds text, photos and stickers that every replica reads the same way', () => {
    const { a, b, sync } = pair();
    const text = addTextItem(a, { x: 10, y: 20, text: 'Brunch first?', color: 'butter' });
    const photo = addPhotoItem(a, { x: 300, y: 0, w: 240, h: 180, photoId: 'cmphoto000001' });
    const sticker = addStickerItem(a, { x: 0, y: 200, emoji: '🍜' });
    sync();
    expect(readCanvasItems(b)).toEqual(readCanvasItems(a));
    const byId = new Map(readCanvasItems(b).map((i) => [i.id, i]));
    expect(byId.get(text)).toMatchObject({ kind: 'text', x: 10, y: 20, text: 'Brunch first?', color: 'butter', textSize: 'm', h: 0 });
    expect(byId.get(photo)).toMatchObject({ kind: 'photo', w: 240, h: 180, photoId: 'cmphoto000001' });
    expect(byId.get(sticker)).toMatchObject({ kind: 'sticker', emoji: '🍜', w: 72, h: 72 });
  });

  it('merges two people typing in the same text box', () => {
    const { a, b, sync } = pair();
    const id = addTextItem(a, { x: 0, y: 0, text: 'Dinner' });
    sync();
    setCanvasText(a, id, 'Late dinner');
    setCanvasText(b, id, 'Dinner downtown');
    sync();
    expect(textOf(a, id)).toBe('Late dinner downtown');
    expect(textOf(b, id)).toBe('Late dinner downtown');
  });

  it('edits text without breaking emoji', () => {
    const doc = new Y.Doc();
    const id = addTextItem(doc, { x: 0, y: 0, text: 'Go 😀 now' });
    setCanvasText(doc, id, 'Go 😃 now'); // same high surrogate, different low one
    expect(textOf(doc, id)).toBe('Go 😃 now');
    setCanvasText(doc, id, 'Go now');
    expect(textOf(doc, id)).toBe('Go now');
    expect(canvasText(doc, id)?.toString()).not.toContain('�');
  });

  it('caps text length', () => {
    const doc = new Y.Doc();
    const id = addTextItem(doc, { x: 0, y: 0 });
    setCanvasText(doc, id, 'a'.repeat(5000));
    expect(textOf(doc, id)).toHaveLength(2000);
  });

  it('keeps a concurrent move and a resize of the same photo, each whole', () => {
    const { a, b, sync } = pair();
    const id = addPhotoItem(a, { x: 0, y: 0, w: 200, h: 100, photoId: 'cmphoto000001' });
    sync();
    moveBoardNodes(a, [{ id, x: 50, y: 60 }]);
    resizeCanvasItem(b, id, { x: 0, y: 0, w: 400, h: 200 });
    sync();
    const [pa] = readCanvasItems(a);
    const [pb] = readCanvasItems(b);
    expect(pa).toEqual(pb);
    // One user's position wins whole, and the size is the resize: never x from one and y from the other.
    expect([pa!.x, pa!.y]).toSatisfy(([x, y]: number[]) => (x === 50 && y === 60) || (x === 0 && y === 0));
    expect([pa!.w, pa!.h]).toEqual([400, 200]);
  });

  it('moves cards and items together in one step', () => {
    const doc = new Y.Doc();
    const undo = createLocalUndoManager(doc);
    placeIdeaNode(doc, 'idea1', { x: 0, y: 0 });
    const id = addStickerItem(doc, { x: 0, y: 0, emoji: '⭐' });
    undo.stopCapturing();
    moveBoardNodes(doc, [
      { id: 'idea1', x: 100, y: 100 },
      { id, x: 140, y: 100 },
    ]);
    expect(readBoardNodes(doc)[0]).toMatchObject({ x: 100, y: 100 });
    expect(readCanvasItems(doc)[0]).toMatchObject({ x: 140, y: 100 });
    undo.undo();
    expect(readBoardNodes(doc)[0]).toMatchObject({ x: 0, y: 0 });
    expect(readCanvasItems(doc)[0]).toMatchObject({ x: 0, y: 0 });
  });

  it('styles only text items, with known colors and sizes', () => {
    const doc = new Y.Doc();
    const text = addTextItem(doc, { x: 0, y: 0, text: 'Hi' });
    const sticker = addStickerItem(doc, { x: 0, y: 0, emoji: '⭐' });
    styleTextItem(doc, text, { color: 'sky', textSize: 'l' });
    styleTextItem(doc, text, { color: 'neon' as never });
    styleTextItem(doc, sticker, { color: 'rose' });
    const items = readCanvasItems(doc);
    expect(items.find((i) => i.id === text)).toMatchObject({ color: 'sky', textSize: 'l' });
    expect(items.find((i) => i.id === sticker)).not.toHaveProperty('color');
  });

  it('draws one arrow per direction and never to itself', () => {
    const { a, b, sync } = pair();
    const t = addTextItem(a, { x: 0, y: 0, text: 'Why?' });
    sync();
    // Both draw the same arrow while offline: one survives.
    addCanvasLink(a, 'idea1', t);
    addCanvasLink(b, 'idea1', t);
    sync();
    expect(readCanvasLinks(a)).toHaveLength(1);
    expect(readCanvasLinks(a)).toEqual(readCanvasLinks(b));
    expect(addCanvasLink(a, 'idea1', t)).toBe(readCanvasLinks(a)[0]!.id);
    expect(addCanvasLink(a, t, 'idea1')).not.toBeNull(); // the other direction is a different arrow
    expect(addCanvasLink(a, t, t)).toBeNull();
    expect(readCanvasLinks(a)).toHaveLength(2);
  });

  it('deletes the arrows of a deleted item, and deletes arrows on their own', () => {
    const doc = new Y.Doc();
    const t1 = addTextItem(doc, { x: 0, y: 0, text: 'A' });
    const t2 = addTextItem(doc, { x: 0, y: 0, text: 'B' });
    addCanvasLink(doc, t1, t2);
    const keep = addCanvasLink(doc, 'idea1', 'idea2')!;
    const other = addCanvasLink(doc, 'idea2', 'idea1')!;
    removeCanvasItems(doc, [t1]);
    expect(readCanvasItems(doc).map((i) => i.id)).toEqual([t2]);
    expect(readCanvasLinks(doc).map((l) => l.id).sort()).toEqual([keep, other].sort());
    removeCanvasLinks(doc, [other]);
    expect(readCanvasLinks(doc).map((l) => l.id)).toEqual([keep]);
  });

  it('skips malformed items and arrows', () => {
    const doc = new Y.Doc();
    const items = doc.getMap('items');
    const raw = (fields: Record<string, unknown>) => {
      const m = new Y.Map();
      for (const [k, v] of Object.entries(fields)) m.set(k, v);
      return m;
    };
    items.set('cmIdeaLookalike', raw({ kind: 'text', pos: { x: 0, y: 0 }, text: 'id collides with idea ids' }));
    items.set('it_badkind00', raw({ kind: 'iframe', pos: { x: 0, y: 0 } }));
    items.set('it_nopos0000', raw({ kind: 'sticker', emoji: '⭐' }));
    items.set('it_notemoji0', raw({ kind: 'sticker', pos: { x: 0, y: 0 }, emoji: 'hello' }));
    items.set('it_badphoto0', raw({ kind: 'photo', pos: { x: 0, y: 0 }, photoId: '../../etc/passwd' }));
    items.set('it_hugesize0', raw({ kind: 'sticker', pos: { x: 0, y: 0 }, emoji: '⭐', size: { w: 1e9, h: -5 } }));
    const links = doc.getMap('links');
    links.set('ln_selfloop0', raw({ from: 'a', to: 'a' }));
    links.set('ln_noto00000', raw({ from: 'a' }));
    links.set('badlinkid', raw({ from: 'a', to: 'b' }));
    const items2 = readCanvasItems(doc);
    expect(items2.map((i) => i.id)).toEqual(['it_hugesize0']);
    expect(items2[0]).toMatchObject({ w: 2400, h: 24 }); // clamped
    expect(readCanvasLinks(doc)).toEqual([]);
  });

  it('refuses writes that readers would reject', () => {
    const doc = new Y.Doc();
    expect(() => addStickerItem(doc, { x: 0, y: 0, emoji: '<b>hi</b>' })).toThrow();
    expect(() => addPhotoItem(doc, { x: 0, y: 0, w: 10, h: 10, photoId: '../x' })).toThrow();
  });

  it('undoes only my own canvas edits, typing included', () => {
    const { a, b, sync } = pair();
    const undo = createLocalUndoManager(a);
    const id = addTextItem(a, { x: 0, y: 0, text: 'Mine' });
    undo.stopCapturing();
    sync();
    addStickerItem(b, { x: 0, y: 0, emoji: '🔥' });
    sync();
    setCanvasText(a, id, 'Mine, edited');
    undo.undo();
    expect(textOf(a, id)).toBe('Mine');
    undo.undo();
    expect(readCanvasItems(a).map((i) => i.kind)).toEqual(['sticker']);
  });
});

describe('stickers', () => {
  it('accepts emoji, not text', () => {
    for (const e of ['🍜', '❤️', '👍🏽', '🇰🇷', '👩‍👩‍👧', '1️⃣']) expect(isSticker(e)).toBe(true);
    for (const e of ['', 'a', 'hi 🍜', '<svg>', '12', '🍜'.repeat(9)]) expect(isSticker(e)).toBe(false);
  });

  it('picks the first emoji someone typed', () => {
    expect(firstSticker('  👩‍👩‍👧 yay')).toBe('👩‍👩‍👧');
    expect(firstSticker('no emoji here')).toBeNull();
  });
});
