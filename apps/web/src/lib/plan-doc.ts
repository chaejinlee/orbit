'use client';

import { HocuspocusProvider } from '@hocuspocus/provider';
import { parsePlanHint, type DraftStop, type PersonDTO, type PlanHint } from '@orbit/shared';
import {
  createLocalUndoManager,
  docNameForPlan,
  getDraftBaseVersion,
  initBoardDoc,
  observeBoard,
  readBoardNodes,
  readCanvasItems,
  readCanvasLinks,
  readDraft,
  type BoardNode,
  type CanvasItem,
  type CanvasLink,
} from '@orbit/shared/yboard';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { REALTIME_URL } from './api';
import { registerPlanNotifier } from './plan-hints';

export type DocStatus = 'connecting' | 'live' | 'reconnecting' | 'forbidden';

export interface PlanDocState {
  doc: Y.Doc | null;
  undo: Y.UndoManager | null;
  status: DocStatus;
  /** True once the server's copy has been merged in (safe to auto-place cards). */
  synced: boolean;
  board: BoardNode[];
  /** Text, photos and stickers on the board (not ideas). */
  items: CanvasItem[];
  /** Arrows between cards and items. */
  links: CanvasLink[];
  draft: DraftStop[];
  draftBaseVersion: number;
  peers: PersonDTO[];
}

export interface PlanDocOptions {
  /** Bump to reconnect, e.g. when your role changes (viewers get a read-only socket). */
  epoch?: number;
  /** Hints from other people's screens (see @orbit/shared hints). */
  onHint?: (hint: PlanHint) => void;
}

const EMPTY: Omit<PlanDocState, 'doc' | 'undo'> = {
  status: 'connecting',
  synced: false,
  board: [],
  items: [],
  links: [],
  draft: [],
  draftBaseVersion: 0,
  peers: [],
};

/**
 * Connects to the plan's Yjs document (board layout, canvas items + shared itinerary draft)
 * and exposes React-friendly snapshots of it. All writes go through the
 * helpers in @orbit/shared/yboard using the returned `doc`. While connected,
 * `notifyPlan(planId, …)` sends hints over the same socket.
 */
export function usePlanDoc(planId: string, token: string | null, me: PersonDTO | null, options: PlanDocOptions = {}): PlanDocState {
  const { epoch = 0, onHint } = options;
  const [handles, setHandles] = useState<{ doc: Y.Doc; undo: Y.UndoManager } | null>(null);
  const [state, setState] = useState(EMPTY);
  const onHintRef = useRef(onHint);
  useEffect(() => {
    onHintRef.current = onHint;
  });

  useEffect(() => {
    if (!token || !me) return;
    const doc = new Y.Doc();
    const undo = createLocalUndoManager(doc);
    let forbidden = false;
    const refresh = () =>
      setState((s) => ({
        ...s,
        board: readBoardNodes(doc),
        items: readCanvasItems(doc),
        links: readCanvasLinks(doc),
        draft: readDraft(doc),
        draftBaseVersion: getDraftBaseVersion(doc),
      }));

    const provider = new HocuspocusProvider({
      url: REALTIME_URL,
      name: docNameForPlan(planId),
      document: doc,
      token,
      onSynced: () => {
        refresh();
        setState((s) => ({ ...s, synced: true, status: 'live' }));
      },
      onStatus: ({ status }) => {
        if (forbidden) return;
        setState((s) => ({ ...s, status: status === 'connected' ? (s.synced ? 'live' : 'connecting') : 'reconnecting' }));
      },
      onAuthenticationFailed: () => {
        forbidden = true;
        setState((s) => ({ ...s, status: 'forbidden' }));
      },
      onStateless: ({ payload }) => {
        const hint = parsePlanHint(payload);
        if (hint) onHintRef.current?.(hint);
      },
      // Per-document closes arrive as code 1000 + the server's reason.
      onClose: ({ event }) => {
        if (event.reason === 'Forbidden' || event.reason === 'Unauthorized') {
          forbidden = true;
          setState((s) => ({ ...s, status: 'forbidden' }));
          provider.disconnect();
        }
      },
    });

    const awareness = provider.awareness;
    awareness?.setLocalStateField('user', { id: me.id, name: me.name, color: me.color });
    const onAwareness = () => {
      const seen = new Map<string, PersonDTO>();
      awareness?.getStates().forEach((s) => {
        const user = (s as { user?: PersonDTO }).user;
        if (user?.id) seen.set(user.id, user);
      });
      setState((s) => ({ ...s, peers: [...seen.values()] }));
    };
    awareness?.on('change', onAwareness);
    onAwareness();

    const stopObserving = observeBoard(doc, refresh);
    const initOnce = () => initBoardDoc(doc);
    provider.on('synced', initOnce);
    const unregister = registerPlanNotifier(planId, (topics, ideaId) =>
      provider.sendStateless(JSON.stringify({ type: 'changed', topics, ...(ideaId ? { ideaId } : {}) })),
    );
    setHandles({ doc, undo });

    return () => {
      unregister();
      awareness?.off('change', onAwareness);
      provider.off('synced', initOnce);
      stopObserving();
      undo.destroy();
      provider.destroy();
      doc.destroy();
      setHandles(null);
      setState(EMPTY);
    };
  }, [planId, token, me, epoch]);

  return useMemo(() => ({ ...state, doc: handles?.doc ?? null, undo: handles?.undo ?? null }), [state, handles]);
}
