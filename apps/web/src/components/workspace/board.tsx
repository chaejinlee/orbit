'use client';

import { DEFAULT_ITEM_SIZE, formatClock, type IdeaDTO, type IdeaStatus, type ScheduledStop } from '@orbit/shared';
import {
  addCanvasLink,
  addPhotoItem,
  addStickerItem,
  addTextItem,
  moveBoardNodes,
  removeCanvasItems,
  removeCanvasLinks,
  resizeCanvasItem,
  type BoardNode,
  type BoardPoint,
  type CanvasItem,
  type CanvasLink,
} from '@orbit/shared/yboard';
import { useQueryClient } from '@tanstack/react-query';
import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  ConnectionMode,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  useUpdateNodeInternals,
  type EdgeChange,
  type NodeChange,
  type OnSelectionChangeParams,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ArrowRight, ImagePlus, Lock, Maximize2, MousePointerClick, MoveUpRight, Plus, Sticker, Type, ZoomIn, ZoomOut } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import type * as Y from 'yjs';
import { api, ApiError, newRequestId, photoSrc } from '@/lib/api';
import { cn, timeAgo } from '@/lib/format';
import { imageFiles, PhotoPrepError, preparePhoto } from '@/lib/photos';
import { keys, usePhotos, useRememberPhoto } from '@/lib/queries';
import { useToast } from '../toast';
import { Button, Dialog, IconButton } from '../ui';
import {
  ArrowEdge,
  CanvasContext,
  PhotoNode,
  StickerNode,
  TextNode,
  UploadNode,
  type ArrowFlowEdge,
  type CanvasContextValue,
  type CanvasTool,
  type PhotoFlowNode,
  type StickerFlowNode,
  type TextFlowNode,
  type UploadFlowNode,
} from './canvas-items';
import { CARD_WIDTH, IdeaCardNode, type IdeaFlowNode } from './idea-card';
import { StickerPicker } from './sticker-picker';

type BoardFlowNode = IdeaFlowNode | TextFlowNode | PhotoFlowNode | StickerFlowNode | UploadFlowNode;

const nodeTypes = { idea: IdeaCardNode, text: TextNode, photo: PhotoNode, sticker: StickerNode, upload: UploadNode };
const edgeTypes = { arrow: ArrowEdge };
const ARROW_MARKER = { type: MarkerType.ArrowClosed, width: 18, height: 18, color: '#4a4f66' } as const;
// Leave room for the floating toolbar (top) and the plan strip (bottom).
const FIT_VIEW = { padding: { top: '84px', bottom: '112px', x: '48px' }, maxZoom: 1 } as const;
const MAX_PHOTOS_AT_ONCE = 10;

export interface BoardProps {
  planId: string;
  doc: Y.Doc | null;
  board: BoardNode[];
  items: CanvasItem[];
  links: CanvasLink[];
  ideas: IdeaDTO[];
  statusOf: (idea: IdeaDTO) => IdeaStatus;
  filter: IdeaStatus | 'all';
  selectedId: string | null;
  onSelect: (ideaId: string | null) => void;
  canEdit: boolean;
  schedule: ScheduledStop[];
  onRequestAdd: (position: BoardPoint | null) => void;
  onAddToPlan: (ideaId: string) => void;
  onRemoveIdeas: (ideaIds: string[]) => void;
  onOpenItinerary: () => void;
}

export function Board(props: BoardProps) {
  return (
    <ReactFlowProvider>
      <BoardCanvas {...props} />
    </ReactFlowProvider>
  );
}

type PointerLike = ReactMouseEvent | MouseEvent | TouchEvent;

function pointerOf(e: PointerLike): { clientX: number; clientY: number } | null {
  if ('clientX' in e) return e;
  return e.changedTouches?.[0] ?? null;
}

interface PendingUpload {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  preview: string;
}

interface Box extends BoardPoint {
  w: number;
  h: number;
}

const isItem = (n: BoardFlowNode) => n.type === 'text' || n.type === 'photo' || n.type === 'sticker';

/**
 * W01 — the board: idea cards plus free text, photos, stickers and arrows, all
 * in the plan's Yjs document. React Flow only renders them. Drags stream to
 * the doc (one write per animation frame), so collaborators watch things move
 * live. Dropping a card on the plan strip adds it to the shared itinerary
 * draft and returns the card to where it came from.
 */
function BoardCanvas({
  planId,
  doc,
  board,
  items,
  links,
  ideas,
  statusOf,
  filter,
  selectedId,
  onSelect,
  canEdit,
  schedule,
  onRequestAdd,
  onAddToPlan,
  onRemoveIdeas,
  onOpenItinerary,
}: BoardProps) {
  const flow = useReactFlow<BoardFlowNode, ArrowFlowEdge>();
  const initialized = useNodesInitialized();
  const updateNodeInternals = useUpdateNodeInternals();
  const toast = useToast();
  const qc = useQueryClient();
  const photosQ = usePhotos(planId);
  const rememberPhoto = useRememberPhoto(planId);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [overStrip, setOverStrip] = useState(false);
  const [tool, setTool] = useState<CanvasTool>('select');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [uploads, setUploads] = useState<PendingUpload[]>([]);
  const [viewing, setViewing] = useState<string | null>(null);
  const [stickersOpen, setStickersOpen] = useState(false);
  const [dropping, setDropping] = useState(false);
  const dragOrigin = useRef<BoardPoint | null>(null);
  const pendingMoves = useRef<Array<{ id: string } & BoardPoint> | null>(null);
  const frame = useRef<number | null>(null);
  const resizing = useRef(new Set<string>());
  const previews = useRef(new Map<string, string>());
  const didFit = useRef(false);

  // ─── Where new things go ──────────────────────────────────────────────────

  const viewCenter = useCallback((): BoardPoint => {
    const r = wrapperRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return flow.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  }, [flow]);

  /**
   * The free spot nearest `near` for a w×h box, so a new photo or sticker
   * doesn't land on (or hide under) a card. Searches rings around the point.
   */
  const freeSpot = useCallback(
    (w: number, h: number, near: BoardPoint, reserved: Box[] = []): BoardPoint => {
      const taken: Box[] = [
        ...flow.getNodes().map((n) => ({ x: n.position.x, y: n.position.y, w: n.measured?.width ?? n.width ?? 0, h: n.measured?.height ?? n.height ?? 0 })),
        ...reserved,
      ];
      const gap = 24;
      const fits = (x: number, y: number) =>
        taken.every((r) => x + w + gap <= r.x || x >= r.x + r.w + gap || y + h + gap <= r.y || y >= r.y + r.h + gap);
      const start = { x: Math.round(near.x - w / 2), y: Math.round(near.y - h / 2) };
      if (fits(start.x, start.y)) return start;
      for (let ring = 1; ring <= 30; ring += 1) {
        const steps = 8 * ring;
        for (let k = 0; k < steps; k += 1) {
          const angle = (k / steps) * Math.PI * 2;
          const x = Math.round(start.x + Math.cos(angle) * ring * 48);
          const y = Math.round(start.y + Math.sin(angle) * ring * 36);
          if (fits(x, y)) return { x, y };
        }
      }
      return start;
    },
    [flow],
  );

  // ─── Photos ───────────────────────────────────────────────────────────────

  const photosById = useMemo(() => new Map((photosQ.data ?? []).map((p) => [p.id, p])), [photosQ.data]);

  // Someone else added a photo: its item arrives before our photo list knows it.
  const lastUnknownPhotos = useRef('');
  useEffect(() => {
    if (!photosQ.data) return;
    const unknown = items
      .flatMap((i) => (i.kind === 'photo' && !photosById.has(i.photoId) ? [i.photoId] : []))
      .sort()
      .join(',');
    if (unknown && unknown !== lastUnknownPhotos.current) {
      lastUnknownPhotos.current = unknown;
      void qc.invalidateQueries({ queryKey: keys.photos(planId) });
    }
  }, [items, photosById, photosQ.data, qc, planId]);

  // A photo that fails to load gets fresh links and one retry, then shows as unavailable.
  const [retries, setRetries] = useState<ReadonlyMap<string, number>>(new Map());
  const onPhotoError = useCallback(
    (photoId: string) => {
      setRetries((r) => new Map(r).set(photoId, (r.get(photoId) ?? 0) + 1));
      void qc.invalidateQueries({ queryKey: keys.photos(planId) });
    },
    [qc, planId],
  );
  const photo = useCallback<CanvasContextValue['photo']>(
    (photoId) => {
      const tries = retries.get(photoId) ?? 0;
      if (tries > 1) return null;
      const p = photosById.get(photoId);
      if (p) {
        const bust = tries ? `&retry=${tries}` : '';
        return { src: photoSrc(p.url) + bust, thumb: photoSrc(p.thumbUrl) + bust };
      }
      return photosQ.isPending || photosQ.isFetching ? undefined : null;
    },
    [photosById, photosQ.isPending, photosQ.isFetching, retries],
  );

  useEffect(() => {
    const urls = previews.current;
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const sendPhoto = useCallback(
    async (id: string, blob: Blob, box: Box, preview: string) => {
      if (!doc) return;
      let keepPreview = false;
      try {
        const uploaded = await api.uploadPhoto(planId, blob, newRequestId());
        rememberPhoto(uploaded);
        // Shown until the uploaded copy has loaded, so the photo never blinks.
        previews.current.set(uploaded.id, preview);
        keepPreview = true;
        addPhotoItem(doc, { ...box, photoId: uploaded.id });
      } catch (error) {
        toast({ message: error instanceof ApiError ? error.message : 'Couldn’t add that photo. Try again.' });
      } finally {
        if (!keepPreview) URL.revokeObjectURL(preview);
        setUploads((u) => u.filter((x) => x.id !== id));
      }
    },
    [doc, planId, rememberPhoto, toast],
  );

  /**
   * Shrinks each photo first (so its real shape is known), then places it:
   * where it was dropped (`at`), or in a free spot near the middle of the view,
   * and uploads it while a placeholder shows.
   */
  const startUploads = useCallback(
    (files: File[], at: BoardPoint | null) => {
      if (!doc || !canEdit || files.length === 0) return;
      if (files.length > MAX_PHOTOS_AT_ONCE) toast({ message: `Adding the first ${MAX_PHOTOS_AT_ONCE} photos. Add the rest in another go.` });
      const center = at ?? viewCenter();
      const reserved: Box[] = [];
      void (async () => {
        for (const [i, file] of files.slice(0, MAX_PHOTOS_AT_ONCE).entries()) {
          let prepared;
          try {
            prepared = await preparePhoto(file);
          } catch (error) {
            toast({ message: error instanceof PhotoPrepError ? error.message : `Orbit can’t read “${file.name}”.` });
            continue;
          }
          const w = DEFAULT_ITEM_SIZE.photoWidth;
          const h = Math.max(24, Math.round((w * prepared.height) / prepared.width));
          const spot = at ? { x: Math.round(at.x - w / 2 + i * 28), y: Math.round(at.y - h / 2 + i * 28) } : freeSpot(w, h, center, reserved);
          const box = { ...spot, w, h };
          reserved.push(box);
          const id = `upload-${newRequestId()}`;
          const preview = URL.createObjectURL(prepared.blob);
          setUploads((u) => [...u, { id, ...box, preview }]);
          void sendPhoto(id, prepared.blob, box, preview);
        }
      })();
    },
    [doc, canEdit, toast, freeSpot, viewCenter, sendPhoto],
  );

  // ─── Nodes and arrows from the doc ────────────────────────────────────────

  const ideasById = useMemo(() => new Map(ideas.map((i) => [i.id, i])), [ideas]);

  const computed = useMemo<BoardFlowNode[]>(() => {
    const below: BoardFlowNode[] = [];
    const above: BoardFlowNode[] = [];
    for (const item of items) {
      const base = { id: item.id, position: { x: item.x, y: item.y }, draggable: canEdit && editingId !== item.id };
      if (item.kind === 'photo') below.push({ ...base, type: 'photo', data: { item }, width: item.w, height: item.h });
      else if (item.kind === 'sticker') above.push({ ...base, type: 'sticker', data: { item }, width: item.w, height: item.h });
      else above.push({ ...base, type: 'text', data: { item }, width: item.w });
    }
    const cards: BoardFlowNode[] = board.flatMap((n) => {
      const idea = ideasById.get(n.ideaId);
      if (!idea || idea.archivedAt || n.hidden) return [];
      const status = statusOf(idea);
      return [
        {
          id: idea.id,
          type: 'idea' as const,
          position: { x: n.x, y: n.y },
          data: { idea, status, dimmed: filter !== 'all' && status !== filter },
          draggable: canEdit,
        },
      ];
    });
    const pending: BoardFlowNode[] = uploads.map((u) => ({
      id: u.id,
      type: 'upload' as const,
      position: { x: u.x, y: u.y },
      data: { preview: u.preview },
      width: u.w,
      height: u.h,
      draggable: false,
      selectable: false,
      connectable: false,
      focusable: false,
    }));
    // Photos at the bottom, then cards, then text and stickers (labels sit on top of photos).
    return [...below, ...cards, ...above, ...pending];
  }, [items, board, ideasById, statusOf, filter, canEdit, editingId, uploads]);

  const computedEdges = useMemo<ArrowFlowEdge[]>(() => {
    const visible = new Set(computed.map((n) => n.id));
    return links
      .filter((l) => visible.has(l.from) && visible.has(l.to))
      .map((l) => ({
        id: l.id,
        type: 'arrow' as const,
        source: l.from,
        target: l.to,
        sourceHandle: 'c',
        targetHandle: 'c',
        markerEnd: ARROW_MARKER,
        deletable: canEdit,
        ariaLabel: 'Arrow',
      }));
  }, [links, computed, canEdit]);

  const [nodes, setNodes] = useState<BoardFlowNode[]>([]);
  useEffect(() => {
    setNodes((prev) => {
      const byId = new Map(prev.map((n) => [n.id, n]));
      return computed.map((next) => {
        const current = byId.get(next.id);
        if (!current) return next;
        const kept = { ...next, selected: current.selected, measured: current.measured } as BoardFlowNode;
        // Never yank something out from under the local user's cursor.
        if (current.dragging || resizing.current.has(next.id)) {
          return { ...kept, position: current.position, width: current.width, height: current.height, dragging: current.dragging } as BoardFlowNode;
        }
        return kept;
      });
    });
  }, [computed]);

  const [edges, setEdges] = useState<ArrowFlowEdge[]>([]);
  useEffect(() => {
    setEdges((prev) => {
      const selected = new Set(prev.filter((e) => e.selected).map((e) => e.id));
      return computedEdges.map((e) => (selected.has(e.id) ? { ...e, selected: true } : e));
    });
  }, [computedEdges]);

  // Stop editing text that someone else deleted.
  useEffect(() => {
    if (editingId && !items.some((i) => i.id === editingId)) setEditingId(null);
  }, [editingId, items]);

  // Fit once the first things are measured. Wait two frames so React Flow has
  // committed node sizes and its own container size, and only mark it done when
  // the fit actually happened (StrictMode re-runs effects in development).
  useEffect(() => {
    if (didFit.current || !initialized || nodes.length === 0) return;
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => {
        void flow.fitView(FIT_VIEW).then((ok) => {
          if (ok) didFit.current = true;
        });
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [initialized, nodes.length, flow]);

  // ─── Selection ↔ the inspector ────────────────────────────────────────────
  // The inspector shows an idea when exactly one card is selected.

  const selectedRef = useRef(selectedId);
  useEffect(() => {
    selectedRef.current = selectedId;
    setNodes((ns) => {
      const current = ns.filter((n) => n.selected);
      if (selectedId) {
        if (current.length === 1 && current[0]!.id === selectedId) return ns;
        if (!ns.some((n) => n.id === selectedId)) return ns;
        return ns.map((n) => (!!n.selected === (n.id === selectedId) ? n : ({ ...n, selected: n.id === selectedId } as BoardFlowNode)));
      }
      if (current.length === 1 && current[0]!.type === 'idea') return ns.map((n) => (n.selected ? ({ ...n, selected: false } as BoardFlowNode) : n));
      return ns;
    });
  }, [selectedId]);

  const onSelectionChange = useCallback(
    ({ nodes: picked }: OnSelectionChangeParams<BoardFlowNode, ArrowFlowEdge>) => {
      const only = picked.length === 1 && picked[0]!.type === 'idea' ? picked[0]!.id : null;
      if (only !== selectedRef.current) onSelect(only);
    },
    [onSelect],
  );

  const onNodesChange = useCallback((changes: NodeChange<BoardFlowNode>[]) => {
    // Removals happen in the doc (see onBeforeDelete); everything else is local view state.
    setNodes((ns) => applyNodeChanges(changes.filter((c) => c.type !== 'remove'), ns));
  }, []);
  const onEdgesChange = useCallback((changes: EdgeChange<ArrowFlowEdge>[]) => {
    setEdges((es) => applyEdgeChanges(changes.filter((c) => c.type !== 'remove'), es));
  }, []);

  // ─── Moving ───────────────────────────────────────────────────────────────

  const flushMoves = useCallback(() => {
    frame.current = null;
    const moves = pendingMoves.current;
    pendingMoves.current = null;
    if (moves && doc) moveBoardNodes(doc, moves);
  }, [doc]);

  const movesOf = (dragged: BoardFlowNode[]) =>
    dragged.filter((n) => n.type !== 'upload').map((n) => ({ id: n.id, x: n.position.x, y: n.position.y }));

  const streamMoves = (dragged: BoardFlowNode[]) => {
    pendingMoves.current = movesOf(dragged);
    frame.current ??= requestAnimationFrame(flushMoves);
  };

  const stopStreaming = () => {
    if (frame.current != null) cancelAnimationFrame(frame.current);
    frame.current = null;
    pendingMoves.current = null;
  };

  const isOverStrip = (e: PointerLike) => {
    const el = stripRef.current;
    const p = pointerOf(e);
    if (!el || !p) return false;
    const r = el.getBoundingClientRect();
    return p.clientX >= r.left && p.clientX <= r.right && p.clientY >= r.top && p.clientY <= r.bottom;
  };

  // ─── Adding things ────────────────────────────────────────────────────────


  const addTextAt = (p: BoardPoint) => {
    if (!doc || !canEdit) return;
    const id = addTextItem(doc, { x: p.x, y: p.y });
    setTool('select');
    setEditingId(id);
  };

  const addSticker = (emoji: string) => {
    if (!doc) return;
    const side = DEFAULT_ITEM_SIZE.sticker.w;
    addStickerItem(doc, { ...freeSpot(side, side, viewCenter()), emoji });
    setStickersOpen(false);
  };

  const requestAddAtCenter = () => {
    const c = viewCenter();
    onRequestAdd({ x: c.x - CARD_WIDTH / 2, y: c.y - 90 });
  };

  // Paste a photo (⌘V) anywhere on the board.
  useEffect(() => {
    if (!canEdit) return;
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], dialog[open]')) return;
      const files = imageFiles(e.clipboardData?.items);
      if (files.length === 0) return;
      e.preventDefault();
      startUploads(files, null);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [canEdit, startUploads]);

  // The arrow tool adds a whole-item handle to everything; React Flow only
  // starts arrows from handles it has measured, so measure them again.
  useEffect(() => {
    updateNodeInternals(flow.getNodes().map((n) => n.id));
  }, [tool, flow, updateNodeInternals]);

  useEffect(() => {
    if (tool !== 'arrow') return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setTool('select');
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tool]);

  const ctx = useMemo<CanvasContextValue>(
    () => ({
      doc,
      canEdit,
      tool,
      editingId,
      setEditingId,
      photo,
      localPreview: (photoId) => previews.current.get(photoId),
      onPhotoError,
      openPhoto: setViewing,
      onResizeStart: (id) => resizing.current.add(id),
      onResizeEnd: (id, box) => {
        resizing.current.delete(id);
        if (doc) resizeCanvasItem(doc, id, box);
      },
    }),
    [doc, canEdit, tool, editingId, photo, onPhotoError],
  );

  const viewed = viewing ? photosById.get(viewing) : undefined;
  const thingsOnBoard = nodes.length > 0;

  return (
    <CanvasContext.Provider value={ctx}>
      <div
        ref={wrapperRef}
        className={cn('relative h-full w-full', tool === 'arrow' && 'orbit-arrow-tool')}
        onDragOver={(e) => {
          if (!canEdit || !e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          setDropping(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false);
        }}
        onDrop={(e) => {
          if (!canEdit || !e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          setDropping(false);
          const files = imageFiles(e.dataTransfer.files);
          if (files.length === 0) return toast({ message: 'Only photos can be dropped on the board.' });
          startUploads(files, flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
        }}
      >
        <ReactFlow<BoardFlowNode, ArrowFlowEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onSelectionChange={onSelectionChange}
          onPaneClick={(e) => {
            if (e.detail >= 2) {
              const p = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
              addTextAt({ x: p.x - 16, y: p.y - 22 });
            }
          }}
          onNodeDragStart={(_, node, dragged) => {
            dragOrigin.current = node.type === 'idea' && dragged.length === 1 ? { ...node.position } : null;
          }}
          onNodeDrag={(e, _node, dragged) => {
            setOverStrip(dragOrigin.current !== null && isOverStrip(e));
            streamMoves(dragged);
          }}
          onNodeDragStop={(e, node, dragged) => {
            stopStreaming();
            const dropped = dragOrigin.current !== null && isOverStrip(e);
            setOverStrip(false);
            if (doc) {
              if (dropped && dragOrigin.current) {
                moveBoardNodes(doc, [{ id: node.id, ...dragOrigin.current }]);
                onAddToPlan(node.id);
              } else {
                moveBoardNodes(doc, movesOf(dragged));
              }
            }
            dragOrigin.current = null;
          }}
          onSelectionDrag={(_, dragged) => streamMoves(dragged)}
          onSelectionDragStop={(_, dragged) => {
            stopStreaming();
            if (doc) moveBoardNodes(doc, movesOf(dragged));
          }}
          onConnect={(c) => {
            if (doc && canEdit && c.source !== c.target) addCanvasLink(doc, c.source, c.target);
          }}
          isValidConnection={(c) => c.source !== c.target}
          onConnectEnd={(event, state) => {
            // Dropped on empty space: start a new text there, already connected (mind-map style).
            if (!doc || !canEdit || state.isValid || !state.fromNode || state.toNode) return;
            const p = pointerOf(event);
            if (!p) return;
            const at = flow.screenToFlowPosition({ x: p.clientX, y: p.clientY });
            const from = state.fromNode;
            const { x, y } = from.internals.positionAbsolute;
            const w = from.measured.width ?? 0;
            const h = from.measured.height ?? 0;
            if (at.x >= x && at.x <= x + w && at.y >= y && at.y <= y + h) return;
            const id = addTextItem(doc, { x: at.x - 16, y: at.y - 22 });
            addCanvasLink(doc, from.id, id);
            setTool('select');
            setEditingId(id);
          }}
          onBeforeDelete={async ({ nodes: gone, edges: goneEdges }) => {
            if (!doc || !canEdit) return false;
            removeCanvasLinks(doc, goneEdges.filter((e) => e.selected).map((e) => e.id));
            removeCanvasItems(doc, gone.filter(isItem).map((n) => n.id));
            const ideaIds = gone.filter((n) => n.type === 'idea').map((n) => n.id);
            if (ideaIds.length) onRemoveIdeas(ideaIds);
            return false; // the doc is the source of truth: React Flow removes nothing itself
          }}
          nodesDraggable={canEdit && tool === 'select'}
          nodesConnectable={canEdit}
          connectionMode={ConnectionMode.Loose}
          connectOnClick={false}
          connectionRadius={28}
          connectionLineStyle={{ stroke: '#6e56c2', strokeWidth: 2 }}
          deleteKeyCode={canEdit ? ['Backspace', 'Delete'] : null}
          selectionKeyCode="Shift"
          multiSelectionKeyCode={['Meta', 'Control', 'Shift']}
          zoomOnDoubleClick={false}
          panOnScroll
          minZoom={0.1}
          maxZoom={3}
          aria-label="Idea board"
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="#d9d2c6" />
        </ReactFlow>

        {!thingsOnBoard && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center pb-24">
            <div className="max-w-xs text-center">
              <MousePointerClick className="mx-auto size-8 text-lilac-600" aria-hidden />
              <p className="mt-3 font-display text-xl font-semibold">Start collecting ideas</p>
              <p className="mt-1 text-sm text-ink-2">
                {canEdit
                  ? 'Double-click anywhere to write, drop photos here, or use “Add idea” to save a place, link or note.'
                  : 'Nothing here yet.'}
              </p>
            </div>
          </div>
        )}

        {dropping && (
          <div className="pointer-events-none absolute inset-3 flex items-center justify-center rounded-3xl border-2 border-dashed border-lilac-600 bg-lilac-50/60">
            <p className="rounded-full bg-paper px-4 py-2 text-sm font-semibold text-lilac-700 shadow-card">Drop photos to add them to the board</p>
          </div>
        )}

        <div className="absolute top-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-2xl border border-line bg-paper/95 p-1 shadow-card backdrop-blur">
          {canEdit && (
            <>
              <Button size="sm" icon={<Plus className="size-4" />} onClick={requestAddAtCenter}>
                Add idea
              </Button>
              <span className="mx-1 h-5 w-px bg-line" aria-hidden />
              <IconButton label="Add text (or double-click the board)" onClick={() => addTextAt(freeSpot(DEFAULT_ITEM_SIZE.text.w, 56, viewCenter()))}>
                <Type className="size-4" />
              </IconButton>
              <IconButton label="Add photos (or drop or paste them)" onClick={() => fileInput.current?.click()}>
                <ImagePlus className="size-4" />
              </IconButton>
              <div className="relative">
                <IconButton label="Add a sticker" active={stickersOpen} data-sticker-toggle onClick={() => setStickersOpen((o) => !o)}>
                  <Sticker className="size-4" />
                </IconButton>
                {stickersOpen && <StickerPicker onPick={addSticker} onClose={() => setStickersOpen(false)} />}
              </div>
              <IconButton
                label={tool === 'arrow' ? 'Stop drawing arrows (Esc)' : 'Draw arrows'}
                active={tool === 'arrow'}
                onClick={() => setTool((t) => (t === 'arrow' ? 'select' : 'arrow'))}
              >
                <MoveUpRight className="size-4" />
              </IconButton>
              <span className="mx-1 h-5 w-px bg-line" aria-hidden />
            </>
          )}
          <IconButton label="Zoom out" onClick={() => void flow.zoomOut()}>
            <ZoomOut className="size-4" />
          </IconButton>
          <IconButton label="Zoom in" onClick={() => void flow.zoomIn()}>
            <ZoomIn className="size-4" />
          </IconButton>
          <IconButton label="Fit everything" onClick={() => void flow.fitView(FIT_VIEW)}>
            <Maximize2 className="size-4" />
          </IconButton>
        </div>

        {tool === 'arrow' && (
          <p role="status" className="absolute top-[68px] left-1/2 z-10 -translate-x-1/2 rounded-full bg-ink px-3.5 py-1.5 text-xs text-white shadow-card">
            Drag from one thing to another. Let go on empty space to start a new note.
          </p>
        )}

        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const files = imageFiles(e.target.files);
            e.target.value = '';
            startUploads(files, null);
          }}
        />

        <div
          ref={stripRef}
          aria-label="Plan strip — drop cards here to add them to the itinerary"
          className={cn(
            'absolute inset-x-4 bottom-4 flex items-center gap-2 overflow-x-auto rounded-2xl border bg-paper/95 px-3 py-2.5 shadow-card backdrop-blur transition-[border-color,box-shadow]',
            overStrip ? 'border-lilac-600 ring-4 ring-lilac-100' : 'border-line',
          )}
        >
          <div className="shrink-0 border-r border-line pr-3">
            <p className="text-xs font-semibold">Plan</p>
            <p className="text-[11px] text-ink-3">
              {schedule.length} {schedule.length === 1 ? 'stop' : 'stops'}
            </p>
          </div>
          {schedule.length === 0 ? (
            <p className={cn('text-[13px]', overStrip ? 'font-semibold text-lilac-700' : 'text-ink-3')}>
              {overStrip ? 'Drop to add it to the plan' : canEdit ? 'Drag a card here to add it to the plan' : 'No stops yet'}
            </p>
          ) : (
            schedule.map((stop) => (
              <button
                key={stop.id}
                type="button"
                onClick={() => stop.ideaId && onSelect(stop.ideaId)}
                className="flex shrink-0 items-center gap-1.5 rounded-xl border border-line bg-ivory px-2.5 py-1.5 text-[13px] hover:border-lilac-600"
              >
                <span className="text-ink-3 tabular-nums">{stop.startMin != null ? formatClock(stop.startMin) : `#${stop.sequence + 1}`}</span>
                <span className="max-w-40 truncate font-medium">{stop.title}</span>
                {stop.locked && <Lock className="size-3 text-ink-3" aria-label="Locked" />}
              </button>
            ))
          )}
          <Button variant="ghost" size="sm" className="ml-auto" onClick={onOpenItinerary}>
            Itinerary <ArrowRight className="size-3.5" aria-hidden />
          </Button>
        </div>

        <Dialog
          open={!!viewed}
          onClose={() => setViewing(null)}
          title="Photo"
          width="max-w-4xl"
          initialFocus="none"
          description={viewed ? `Added by ${viewed.uploadedBy.name} · ${timeAgo(viewed.createdAt)}` : undefined}
        >
          {viewed && <img src={photoSrc(viewed.url)} alt="Photo on the board" className="mx-auto max-h-[70vh] w-auto rounded-xl object-contain" />}
        </Dialog>
      </div>
    </CanvasContext.Provider>
  );
}
