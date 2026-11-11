'use client';

import { CANVAS_TEXT_MAX_CHARS, TEXT_COLORS, TEXT_SIZES, type TextColor, type TextSize } from '@orbit/shared';
import {
  canvasText,
  removeCanvasItems,
  removeCanvasLinks,
  setCanvasText,
  styleTextItem,
  type BoardBox,
  type PhotoItem,
  type StickerItem,
  type TextItem,
} from '@orbit/shared/yboard';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  Handle,
  NodeResizeControl,
  NodeResizer,
  NodeToolbar,
  Position,
  ResizeControlVariant,
  useConnection,
  useInternalNode,
  type Edge,
  type EdgeProps,
  type InternalNode,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { ImageOff, Maximize2, Trash, X } from 'lucide-react';
import { createContext, memo, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as Y from 'yjs';
import { cn } from '@/lib/format';

// ─── Shared canvas state ────────────────────────────────────────────────────

export type CanvasTool = 'select' | 'arrow';

export interface PhotoSource {
  src: string;
  thumb: string;
}

export interface CanvasContextValue {
  doc: Y.Doc | null;
  canEdit: boolean;
  tool: CanvasTool;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  /** undefined while loading, null when the photo can't be shown. */
  photo: (photoId: string) => PhotoSource | null | undefined;
  /** The photo as it looked on this device before upload (shown until the real one loads). */
  localPreview: (photoId: string) => string | undefined;
  onPhotoError: (photoId: string) => void;
  openPhoto: (photoId: string) => void;
  /** Resizes stream locally; the doc gets the final box. */
  onResizeStart: (id: string) => void;
  onResizeEnd: (id: string, box: BoardBox) => void;
}

export const CanvasContext = createContext<CanvasContextValue | null>(null);

function useCanvas(): CanvasContextValue {
  const ctx = useContext(CanvasContext);
  if (!ctx) throw new Error('Canvas nodes must render inside <CanvasContext>.');
  return ctx;
}

export type TextFlowNode = Node<{ item: TextItem }, 'text'>;
export type PhotoFlowNode = Node<{ item: PhotoItem }, 'photo'>;
export type StickerFlowNode = Node<{ item: StickerItem }, 'sticker'>;
export type UploadFlowNode = Node<{ preview: string }, 'upload'>;
export type ArrowFlowEdge = Edge<Record<string, never>, 'arrow'>;

const LILAC = '#6e56c2';

// ─── Arrows: where they start and end ───────────────────────────────────────

/**
 * Every item can be an arrow's end. One small source handle ("c") always
 * exists, so stored arrows always render (React Flow needs a handle on both
 * ends); the arrow itself is drawn border to border, not handle to handle.
 * While someone drags an arrow, every other item becomes one big drop target,
 * and with the arrow tool the whole item is where an arrow starts.
 */
export function ConnectHandles({ nodeId }: { nodeId: string }) {
  const { canEdit, tool } = useCanvas();
  const connectingFrom = useConnection((c) => (c.inProgress ? c.fromNode.id : null));
  const knob = canEdit && tool === 'select';
  return (
    <>
      <Handle type="source" id="c" position={Position.Right} isConnectable={knob} className={cn('orbit-knob', !knob && 'orbit-knob-off')} />
      {/* Stays mounted on the item the arrow is being dragged from: unmounting it mid-drag would drop the arrow. */}
      {canEdit && tool === 'arrow' && (!connectingFrom || connectingFrom === nodeId) && (
        <Handle type="source" id="all" position={Position.Right} className="orbit-fill" />
      )}
      {canEdit && connectingFrom && connectingFrom !== nodeId && (
        <Handle type="target" id="drop" position={Position.Left} isConnectableStart={false} className="orbit-fill orbit-drop" />
      )}
    </>
  );
}

function boxOf(node: InternalNode) {
  const w = node.measured.width ?? node.width ?? 0;
  const h = node.measured.height ?? node.height ?? 0;
  const { x, y } = node.internals.positionAbsolute;
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
}

/** Where the line between two items' centers leaves `from`'s box (a little outside it). */
function exitPoint(from: ReturnType<typeof boxOf>, to: ReturnType<typeof boxOf>) {
  const dx = to.cx - from.cx;
  const dy = to.cy - from.cy;
  const hw = from.w / 2 + 6;
  const hh = from.h / 2 + 6;
  if (dx === 0 && dy === 0) return { x: from.cx, y: from.cy, side: Position.Bottom };
  const horizontal = Math.abs(dx) / hw >= Math.abs(dy) / hh;
  const t = horizontal ? hw / Math.abs(dx) : hh / Math.abs(dy);
  const side = horizontal ? (dx > 0 ? Position.Right : Position.Left) : dy > 0 ? Position.Bottom : Position.Top;
  return { x: from.cx + dx * t, y: from.cy + dy * t, side };
}

export const ArrowEdge = memo(function ArrowEdge({ id, source, target, selected, markerEnd }: EdgeProps<ArrowFlowEdge>) {
  const { doc, canEdit } = useCanvas();
  const s = useInternalNode(source);
  const t = useInternalNode(target);
  if (!s || !t) return null;
  const a = boxOf(s);
  const b = boxOf(t);
  const start = exitPoint(a, b);
  const end = exitPoint(b, a);
  const [path, midX, midY] = getBezierPath({
    sourceX: start.x,
    sourceY: start.y,
    sourcePosition: start.side,
    targetX: end.x,
    targetY: end.y,
    targetPosition: end.side,
    curvature: 0.2,
  });
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        interactionWidth={20}
        style={{ stroke: selected ? LILAC : '#4a4f66', strokeWidth: selected ? 2.5 : 2 }}
      />
      {selected && canEdit && doc && (
        <EdgeLabelRenderer>
          <button
            type="button"
            aria-label="Delete arrow"
            title="Delete arrow"
            className="nodrag nopan absolute flex size-7 items-center justify-center rounded-full border border-line bg-paper text-ink-2 shadow-card hover:text-rose-700"
            style={{ transform: `translate(-50%, -50%) translate(${midX}px, ${midY}px)`, pointerEvents: 'all' }}
            onClick={() => removeCanvasLinks(doc, [id])}
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
});

// ─── Item toolbar ───────────────────────────────────────────────────────────

function ItemToolbar({ children }: { children: ReactNode }) {
  return (
    <NodeToolbar position={Position.Top} offset={10} className="nodrag nopan flex items-center gap-1 rounded-xl border border-line bg-paper p-1 shadow-card">
      {children}
    </NodeToolbar>
  );
}

function ToolbarButton({ label, onClick, children, active, danger }: { label: string; onClick: () => void; children: ReactNode; active?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex h-7 min-w-7 items-center justify-center rounded-lg px-1.5 text-xs font-semibold text-ink-2 hover:bg-ink/5',
        active && 'bg-lilac-100 text-lilac-700',
        danger && 'hover:text-rose-700',
      )}
    >
      {children}
    </button>
  );
}

function DeleteButton({ id }: { id: string }) {
  const { doc } = useCanvas();
  return (
    <ToolbarButton label="Delete" danger onClick={() => doc && removeCanvasItems(doc, [id])}>
      <Trash className="size-3.5" aria-hidden />
    </ToolbarButton>
  );
}

// ─── Text ───────────────────────────────────────────────────────────────────

const TEXT_COLOR_STYLE: Record<TextColor, { box: string; swatch: string; label: string }> = {
  plain: { box: 'bg-transparent border-transparent', swatch: 'bg-paper border-line-2', label: 'No color' },
  butter: { box: 'bg-butter-50 border-butter shadow-card', swatch: 'bg-butter border-butter', label: 'Yellow' },
  rose: { box: 'bg-rose-50 border-rose shadow-card', swatch: 'bg-rose border-rose', label: 'Pink' },
  sage: { box: 'bg-sage-50 border-sage shadow-card', swatch: 'bg-sage border-sage', label: 'Green' },
  sky: { box: 'bg-sky-50 border-sky shadow-card', swatch: 'bg-sky border-sky', label: 'Blue' },
  lilac: { box: 'bg-lilac-50 border-lilac shadow-card', swatch: 'bg-lilac border-lilac', label: 'Purple' },
};

const TEXT_SIZE_STYLE: Record<TextSize, { text: string; label: string; short: string }> = {
  s: { text: 'text-sm leading-snug', label: 'Small text', short: 'S' },
  m: { text: 'text-[17px] leading-snug font-medium', label: 'Medium text', short: 'M' },
  l: { text: 'font-display text-[28px] leading-tight font-semibold', label: 'Large text', short: 'L' },
};

/**
 * Binds a textarea to an item's shared text: local typing applies only what
 * changed, and other people's typing arrives without moving your cursor.
 */
function useSharedText(doc: Y.Doc, id: string) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const text = useMemo(() => canvasText(doc, id), [doc, id]);
  const [value, setValue] = useState(() => text?.toString() ?? '');
  const writing = useRef(false);
  const nextSelection = useRef<[number, number] | null>(null);

  useEffect(() => {
    if (!text) return;
    const onChange = (event: Y.YTextEvent) => {
      if (writing.current) return;
      const el = ref.current;
      if (el && document.activeElement === el) {
        // Map the cursor through the change (positions are in the old text).
        const shift = (pos: number) => {
          let at = 0;
          let delta = 0;
          for (const op of event.delta) {
            if (op.retain) at += op.retain;
            else if (op.insert !== undefined) {
              if (at < pos) delta += typeof op.insert === 'string' ? op.insert.length : 1;
            } else if (op.delete) {
              if (at < pos) delta -= Math.min(op.delete, pos - at);
              at += op.delete;
            }
          }
          return pos + delta;
        };
        nextSelection.current = [shift(el.selectionStart), shift(el.selectionEnd)];
      }
      setValue(text.toString());
    };
    text.observe(onChange);
    return () => text.unobserve(onChange);
  }, [text]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
    const sel = nextSelection.current;
    if (sel) {
      el.setSelectionRange(sel[0], sel[1]);
      nextSelection.current = null;
    }
  }, [value]);

  const onChange = (next: string) => {
    writing.current = true;
    try {
      setCanvasText(doc, id, next);
    } finally {
      writing.current = false;
    }
    setValue(next.slice(0, CANVAS_TEXT_MAX_CHARS));
  };
  return { ref, value, onChange };
}

function TextEditor({ doc, item, onDone }: { doc: Y.Doc; item: TextItem; onDone: () => void }) {
  const { ref, value, onChange } = useSharedText(doc, item.id);
  // React Flow keeps a new node hidden until it has measured it, and hidden
  // elements can't take focus: keep trying for a few frames.
  useEffect(() => {
    let raf = 0;
    let tries = 0;
    const tryFocus = () => {
      const el = ref.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      if (document.activeElement === el) el.setSelectionRange(el.value.length, el.value.length);
      else if (++tries < 30) raf = requestAnimationFrame(tryFocus);
    };
    tryFocus();
    return () => cancelAnimationFrame(raf);
  }, [ref]);
  return (
    <textarea
      ref={ref}
      aria-label="Text on the board"
      rows={1}
      maxLength={CANVAS_TEXT_MAX_CHARS}
      value={value}
      placeholder="Write something"
      onChange={(e) => onChange(e.target.value)}
      onBlur={onDone}
      onKeyDown={(e) => {
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      className={cn(
        'nodrag nopan nowheel block w-full resize-none overflow-hidden bg-transparent p-0 text-ink outline-none placeholder:text-ink-3',
        TEXT_SIZE_STYLE[item.textSize].text,
      )}
    />
  );
}

export const TextNode = memo(function TextNode({ id, data, selected }: NodeProps<TextFlowNode>) {
  const { doc, canEdit, editingId, setEditingId, onResizeStart, onResizeEnd } = useCanvas();
  const { item } = data;
  const editing = editingId === id && !!doc && canEdit;
  const color = TEXT_COLOR_STYLE[item.color];

  const finish = () => {
    setEditingId(null);
    // An empty box has nothing to say: don't leave it behind.
    if (doc && !(canvasText(doc, id)?.toString().trim() ?? '')) removeCanvasItems(doc, [id]);
  };

  return (
    <div
      className={cn(
        'group relative rounded-2xl border-2 px-3 py-2 text-ink',
        color.box,
        item.color === 'plain' && !selected && !editing && 'hover:border-dashed hover:border-line-2',
        (selected || editing) && 'border-lilac-600',
      )}
      onDoubleClick={(e) => {
        if (!canEdit) return;
        e.stopPropagation();
        setEditingId(id);
      }}
    >
      {editing && doc ? (
        <TextEditor doc={doc} item={item} onDone={finish} />
      ) : (
        <p className={cn('break-words whitespace-pre-wrap', TEXT_SIZE_STYLE[item.textSize].text, !item.text && 'text-ink-3')}>
          {item.text || 'Empty'}
        </p>
      )}
      <ConnectHandles nodeId={id} />
      {canEdit && selected && !editing && (
        <NodeResizeControl
          position="right"
          variant={ResizeControlVariant.Line}
          minWidth={60}
          maxWidth={1200}
          color={LILAC}
          className="orbit-width-line"
          onResizeStart={() => onResizeStart(id)}
          onResizeEnd={(_, p) => onResizeEnd(id, { x: p.x, y: p.y, w: p.width, h: 0 })}
        />
      )}
      {canEdit && doc && !editing && (
        <ItemToolbar>
          {TEXT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={TEXT_COLOR_STYLE[c].label}
              title={TEXT_COLOR_STYLE[c].label}
              aria-pressed={item.color === c}
              onClick={() => styleTextItem(doc, id, { color: c })}
              className={cn(
                'size-6 rounded-full border-2',
                TEXT_COLOR_STYLE[c].swatch,
                item.color === c && 'ring-2 ring-lilac-600 ring-offset-1',
              )}
            />
          ))}
          <span className="mx-0.5 h-5 w-px bg-line" aria-hidden />
          {TEXT_SIZES.map((s) => (
            <ToolbarButton key={s} label={TEXT_SIZE_STYLE[s].label} active={item.textSize === s} onClick={() => styleTextItem(doc, id, { textSize: s })}>
              {TEXT_SIZE_STYLE[s].short}
            </ToolbarButton>
          ))}
          <span className="mx-0.5 h-5 w-px bg-line" aria-hidden />
          <ToolbarButton label="Edit text" onClick={() => setEditingId(id)}>
            Edit
          </ToolbarButton>
          <DeleteButton id={id} />
        </ItemToolbar>
      )}
    </div>
  );
});

// ─── Photos ─────────────────────────────────────────────────────────────────

export const PhotoNode = memo(function PhotoNode({ id, data, selected }: NodeProps<PhotoFlowNode>) {
  const { canEdit, photo, localPreview, onPhotoError, openPhoto, onResizeStart, onResizeEnd } = useCanvas();
  const { item } = data;
  const source = photo(item.photoId);
  const preview = localPreview(item.photoId);
  const [loaded, setLoaded] = useState(false);
  const src = source ? (item.w > 320 ? source.src : source.thumb) : undefined;
  useEffect(() => setLoaded(false), [src]);

  return (
    <div
      className={cn('relative h-full w-full rounded-xl bg-paper p-1.5 shadow-card', selected && 'ring-2 ring-lilac-600')}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (source) openPhoto(item.photoId);
      }}
    >
      <div className="relative h-full w-full overflow-hidden rounded-lg bg-ivory">
        {preview && !loaded && <img src={preview} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover" />}
        {source === null ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-center text-xs text-ink-3">
            <ImageOff className="size-5" aria-hidden />
            Photo unavailable
          </div>
        ) : src ? (
          <img
            src={src}
            alt="Photo on the board"
            draggable={false}
            onLoad={() => setLoaded(true)}
            onError={() => onPhotoError(item.photoId)}
            className={cn('absolute inset-0 h-full w-full object-cover transition-opacity', loaded ? 'opacity-100' : 'opacity-0')}
          />
        ) : null}
        {!loaded && !preview && source !== null && <div className="absolute inset-0 animate-pulse bg-line/50" aria-hidden />}
      </div>
      <ConnectHandles nodeId={id} />
      <NodeResizer
        isVisible={canEdit && selected}
        keepAspectRatio
        minWidth={60}
        minHeight={40}
        maxWidth={2400}
        maxHeight={2400}
        color={LILAC}
        handleClassName="orbit-resize-handle"
        onResizeStart={() => onResizeStart(id)}
        onResizeEnd={(_, p) => onResizeEnd(id, { x: p.x, y: p.y, w: p.width, h: p.height })}
      />
      {(canEdit || source) && (
        <ItemToolbar>
          {source && (
            <ToolbarButton label="Open photo" onClick={() => openPhoto(item.photoId)}>
              <Maximize2 className="size-3.5" aria-hidden />
            </ToolbarButton>
          )}
          {canEdit && <DeleteButton id={id} />}
        </ItemToolbar>
      )}
    </div>
  );
});

/** A photo still on its way up (only on the uploader's screen). */
export const UploadNode = memo(function UploadNode({ data }: NodeProps<UploadFlowNode>) {
  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl bg-paper p-1.5 shadow-card" role="status" aria-label="Adding photo">
      <div className="relative h-full w-full overflow-hidden rounded-lg bg-ivory">
        <img src={data.preview} alt="" className="h-full w-full object-cover opacity-60" />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="size-6 animate-spin rounded-full border-2 border-lilac-600 border-t-transparent" aria-hidden />
        </div>
      </div>
    </div>
  );
});

// ─── Stickers ───────────────────────────────────────────────────────────────

export const StickerNode = memo(function StickerNode({ id, data, selected }: NodeProps<StickerFlowNode>) {
  const { canEdit, onResizeStart, onResizeEnd } = useCanvas();
  const { item } = data;
  return (
    <div
      className={cn('flex h-full w-full items-center justify-center rounded-2xl select-none', selected && 'ring-2 ring-lilac-600')}
      style={{ fontSize: Math.round(item.h * 0.78), lineHeight: 1 }}
      role="img"
      aria-label={`Sticker ${item.emoji}`}
    >
      <span aria-hidden>{item.emoji}</span>
      <ConnectHandles nodeId={id} />
      <NodeResizer
        isVisible={canEdit && selected}
        keepAspectRatio
        minWidth={32}
        minHeight={32}
        maxWidth={480}
        maxHeight={480}
        color={LILAC}
        handleClassName="orbit-resize-handle"
        onResizeStart={() => onResizeStart(id)}
        onResizeEnd={(_, p) => onResizeEnd(id, { x: p.x, y: p.y, w: p.width, h: p.height })}
      />
      {canEdit && (
        <ItemToolbar>
          <DeleteButton id={id} />
        </ItemToolbar>
      )}
    </div>
  );
});
