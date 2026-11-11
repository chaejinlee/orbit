'use client';

import {
  can,
  deriveIdeaStatus,
  IDEA_STATUS_LABEL,
  PLAN_TYPE_LABEL,
  scheduleItinerary,
  travelEstimatorFor,
  validateItinerary,
  type CreateIdeaResultDTO,
  type IdeaDTO,
  type IdeaStatus,
  type MemberRole,
  type PlanDTO,
  type PlanHint,
  type WorkspaceView,
} from '@orbit/shared';
import { addDraftStop, ensureIdeasPlaced, placeIdeaNode, setIdeaNodeHidden, type BoardPoint } from '@orbit/shared/yboard';
import { useQueryClient } from '@tanstack/react-query';
import { ArchiveArrowUp, ArrowLeft, Eye, LayoutGrid, ListOrdered, Map as MapIcon, Plus, Share2, Vote } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { cn, formatBudget, formatPlanDate, formatWindow } from '@/lib/format';
import { usePlanDoc, type DocStatus } from '@/lib/plan-doc';
import { notifyPlan } from '@/lib/plan-hints';
import { keys, useAiStatus, useIdeaMutations, useIdeas, useItinerary, usePlan, useUpdatePlan } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { GlobalRail } from '../shell';
import { useToast } from '../toast';
import { AvatarStack, Badge, Banner, Button, buttonClass, IconButton, Skeleton } from '../ui';
import { AddIdeaDialog } from './add-idea';
import { Board } from './board';
import { CARD_WIDTH, IdeaCard } from './idea-card';
import { Inspector } from './inspector';
import { ItineraryView } from './itinerary';
import { ShareDialog } from './share';

const FILTERS: Array<IdeaStatus | 'all'> = ['all', 'saved', 'shortlisted', 'in_plan'];

function gridSlot(slot: number): BoardPoint {
  return { x: (slot % 4) * (CARD_WIDTH + 40), y: Math.floor(slot / 4) * 270 };
}

/** Mirrors the `desk:` variant in globals.css: a sideways phone is wide but short. */
const DESKTOP_LAYOUT = '(min-width: 768px) and (min-height: 512px)';

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(true);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const update = () => setMatches(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, [query]);
  return matches;
}

/**
 * Counts changes of your role after it's first known, so the socket reconnects
 * with the right access (viewers get a read-only connection) instead of waiting
 * for the server's periodic re-check.
 */
function useRoleEpoch(role: MemberRole | null): number {
  const known = useRef<MemberRole | null>(null);
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    if (!role) return;
    if (known.current && known.current !== role) setEpoch((e) => e + 1);
    known.current = role;
  }, [role]);
  return epoch;
}

function ConnectionPill({ status }: { status: DocStatus }) {
  const map: Record<DocStatus, { label: string; dot: string }> = {
    connecting: { label: 'Connecting…', dot: 'bg-butter-800' },
    live: { label: 'Live', dot: 'bg-sage-700' },
    reconnecting: { label: 'Reconnecting…', dot: 'bg-butter-800 animate-pulse' },
    forbidden: { label: 'No access', dot: 'bg-rose-700' },
  };
  const s = map[status];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-2" role="status">
      <span className={cn('size-2 rounded-full', s.dot)} aria-hidden />
      {s.label}
    </span>
  );
}

export function Workspace({ planId }: { planId: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const view: WorkspaceView = params.get('view') === 'itinerary' ? 'itinerary' : 'board';
  const qc = useQueryClient();
  const toast = useToast();
  const { user, token } = useSession();
  const isDesktop = useMediaQuery(DESKTOP_LAYOUT);

  const planQ = usePlan(planId);
  const ideasQ = useIdeas(planId);
  const itineraryQ = useItinerary(planId);
  const updatePlan = useUpdatePlan(planId);
  const ideaMutations = useIdeaMutations(planId);
  const roleEpoch = useRoleEpoch(planQ.data?.myRole ?? null);

  // Someone else changed SQL-backed data (a comment, an edit, a new member):
  // refetch just that. Hints carry no content; the data comes over HTTP.
  const onHint = useCallback(
    (hint: PlanHint) => {
      const refetch = (queryKey: readonly unknown[]) => void qc.invalidateQueries({ queryKey });
      for (const topic of hint.topics) {
        if (topic === 'plan') {
          refetch(keys.plan(planId));
          refetch(keys.invites(planId));
          refetch(keys.plans);
        } else if (topic === 'ideas') refetch(keys.ideas(planId));
        else if (topic === 'itinerary') refetch(keys.itinerary(planId));
        else if (topic === 'comments' && hint.ideaId) refetch(keys.comments(planId, hint.ideaId));
        else if (topic === 'answers' && hint.ideaId) refetch(keys.answers(planId, hint.ideaId));
      }
    },
    [qc, planId],
  );
  const planDoc = usePlanDoc(planId, token, user, { epoch: roleEpoch, onHint });
  const { doc } = planDoc;
  const aiStatus = useAiStatus();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<IdeaStatus | 'all'>('all');
  const [adding, setAdding] = useState<{ position: BoardPoint | null } | null>(null);
  const [sharing, setSharing] = useState(false);

  const plan = planQ.data;
  const ideas = useMemo(() => ideasQ.data ?? [], [ideasQ.data]);
  const ideasById = useMemo(() => new Map(ideas.map((i) => [i.id, i])), [ideas]);
  const activeIdeas = useMemo(() => ideas.filter((i) => !i.archivedAt), [ideas]);
  const canEdit = !!plan && can(plan.myRole, 'board.edit') && planDoc.status !== 'forbidden';

  // Untimed legs use the two places' coordinates (the API commits with the same estimator).
  const estimateTravelMin = useMemo(
    () =>
      travelEstimatorFor((id) => {
        const place = ideasById.get(id)?.place;
        return place && place.lat != null && place.lng != null ? { lat: place.lat, lng: place.lng } : null;
      }),
    [ideasById],
  );
  const schedule = useMemo(
    () => scheduleItinerary(planDoc.draft, { dayStartMin: plan?.startMin ?? null, estimateTravelMin }),
    [planDoc.draft, plan?.startMin, estimateTravelMin],
  );
  const issues = useMemo(
    () => (plan ? validateItinerary(schedule, { window: { startMin: plan.startMin, endMin: plan.endMin }, budget: plan.budget }) : []),
    [schedule, plan],
  );

  const draftCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of planDoc.draft) if (s.ideaId) counts.set(s.ideaId, (counts.get(s.ideaId) ?? 0) + 1);
    return counts;
  }, [planDoc.draft]);
  const confirmedIds = useMemo(
    () => new Set((itineraryQ.data?.current?.stops ?? []).flatMap((s) => (s.ideaId ? [s.ideaId] : []))),
    [itineraryQ.data],
  );
  const statusOf = useCallback(
    (idea: IdeaDTO) =>
      deriveIdeaStatus({
        archived: !!idea.archivedAt,
        shortlisted: idea.shortlisted,
        inDraft: draftCount.has(idea.id),
        inConfirmed: confirmedIds.has(idea.id),
        inOpenPoll: false,
      }),
    [draftCount, confirmedIds],
  );

  // Someone else added an idea: its card shows up in the shared doc before our
  // list knows it. Refetch once per new set of unknown ids.
  const lastUnknown = useRef('');
  useEffect(() => {
    if (!ideasQ.data) return;
    const unknown = planDoc.board
      .filter((n) => !ideasById.has(n.ideaId))
      .map((n) => n.ideaId)
      .sort()
      .join(',');
    if (unknown && unknown !== lastUnknown.current) {
      lastUnknown.current = unknown;
      void qc.invalidateQueries({ queryKey: keys.ideas(planId) });
    }
  }, [planDoc.board, ideasById, ideasQ.data, qc, planId]);

  // Someone just joined (they're online but not in our member list): refetch
  // the plan once per new set of strangers.
  const lastNewPeers = useRef('');
  useEffect(() => {
    if (!planQ.data) return;
    const members = new Set(planQ.data.members.map((m) => m.id));
    const unknown = planDoc.peers
      .filter((p) => !members.has(p.id))
      .map((p) => p.id)
      .sort()
      .join(',');
    if (unknown && unknown !== lastNewPeers.current) {
      lastNewPeers.current = unknown;
      void qc.invalidateQueries({ queryKey: keys.plan(planId) });
    }
  }, [planDoc.peers, planQ.data, qc, planId]);

  // Ideas without a card (e.g. created elsewhere) get one — only after the
  // server's layout has synced, so we never overwrite existing positions.
  useEffect(() => {
    if (doc && planDoc.synced && canEdit && activeIdeas.length > 0) {
      ensureIdeasPlaced(doc, activeIdeas.map((i) => i.id), gridSlot);
    }
  }, [doc, planDoc.synced, canEdit, activeIdeas]);

  const setView = useCallback(
    (next: WorkspaceView) => {
      router.replace(`/plans/${planId}?view=${next}`, { scroll: false });
      void api.setLastView(planId, next).catch(() => {});
    },
    [router, planId],
  );

  const addToItinerary = useCallback(
    (ideaId: string) => {
      const idea = ideasById.get(ideaId);
      if (!doc || !idea) return;
      addDraftStop(doc, {
        ideaId,
        title: idea.title,
        durationMin: idea.durationMin ?? 60,
        fixedStartMin: null,
        locked: false,
        travelMinFromPrev: null,
        costMinor: idea.cost?.amountMinor ?? null,
        costCurrency: idea.cost?.currency ?? null,
      });
      toast({
        message: `Added “${idea.title}” to the plan.`,
        action: view === 'board' ? { label: 'View', onClick: () => setView('itinerary') } : undefined,
      });
    },
    [doc, ideasById, toast, view, setView],
  );

  const removeFromBoard = useCallback(
    (ideaIds: string[]) => {
      if (!doc || ideaIds.length === 0) return;
      for (const id of ideaIds) setIdeaNodeHidden(doc, id, true);
      setSelectedId(null);
      toast({
        message: ideaIds.length === 1 ? 'Removed from the board. The idea is kept.' : `Removed ${ideaIds.length} cards from the board. The ideas are kept.`,
        action: { label: 'Undo', onClick: () => ideaIds.forEach((id) => setIdeaNodeHidden(doc, id, false)) },
      });
    },
    [doc, toast],
  );

  const archive = (idea: IdeaDTO) => {
    ideaMutations.archive.mutate(
      { ideaId: idea.id, archived: true },
      {
        onSuccess: () =>
          toast({
            message: `Archived “${idea.title}”.`,
            action: { label: 'Undo', onClick: () => ideaMutations.archive.mutate({ ideaId: idea.id, archived: false }) },
          }),
      },
    );
    setSelectedId(null);
  };

  const onIdeaSaved = (result: CreateIdeaResultDTO, position: BoardPoint | null) => {
    if (doc && !result.merged) placeIdeaNode(doc, result.idea.id, position ?? gridSlot(planDoc.board.length));
    ideaMutations.upsertLocal(result.idea);
    // A merge adds a source to an existing card, which the board doesn't show.
    notifyPlan(planId, ['ideas']);
    setAdding(null);
    setSelectedId(result.idea.id);
    toast({ message: result.merged ? `Added to “${result.idea.title}”.` : 'Saved to the board.' });
  };

  // Keyboard: ⌘Z / ⇧⌘Z undo only your own edits. (On the board, Delete is the board's.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], dialog[open]')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z' && canEdit) {
        e.preventDefault();
        if (e.shiftKey) planDoc.undo?.redo();
        else planDoc.undo?.undo();
      } else if (e.key === 'Escape') {
        setSelectedId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canEdit, planDoc.undo]);

  if (planQ.isError) {
    const notFound = planQ.error instanceof ApiError && planQ.error.status === 404;
    return (
      <div className="flex min-h-dvh items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <p className="font-display text-2xl font-semibold">{notFound ? 'Plan not found' : 'Couldn’t load this plan'}</p>
          <p className="mt-2 text-sm text-ink-2">
            {notFound ? 'It may have been deleted, or you don’t have access to it.' : planQ.error.message}
          </p>
          <Link href="/" className={buttonClass('secondary', 'md', 'mt-6')}>
            Back to Home
          </Link>
        </div>
      </div>
    );
  }

  const selected = selectedId ? ideasById.get(selectedId) : undefined;
  const hiddenIdeas = activeIdeas.filter((i) => planDoc.board.find((n) => n.ideaId === i.id)?.hidden);
  const archivedIdeas = ideas.filter((i) => i.archivedAt);
  const counts = FILTERS.reduce<Record<string, number>>((acc, f) => {
    acc[f] = f === 'all' ? activeIdeas.length : activeIdeas.filter((i) => statusOf(i) === f).length;
    return acc;
  }, {});
  const peers = planDoc.peers.length > 0 ? planDoc.peers : user ? [user] : [];

  const inspector = selected && plan && user && (
    <Inspector
      planId={planId}
      idea={selected}
      status={statusOf(selected)}
      canEdit={canEdit}
      defaultCurrency={plan.budget?.currency ?? 'CAD'}
      inDraftCount={draftCount.get(selected.id) ?? 0}
      meId={user.id}
      ai={aiStatus.data}
      canAsk={can(plan.myRole, 'ai.ask')}
      canComment={can(plan.myRole, 'comment.create')}
      isOwner={plan.myRole === 'OWNER'}
      onClose={() => setSelectedId(null)}
      onUpdate={(patch) => ideaMutations.update.mutate({ ideaId: selected.id, patch })}
      onToggleInterest={() =>
        ideaMutations.react.mutate({ ideaId: selected.id, kind: selected.myReaction === 'INTERESTED' ? null : 'INTERESTED' })
      }
      onAddToItinerary={() => addToItinerary(selected.id)}
      onRemoveFromBoard={() => removeFromBoard([selected.id])}
      onArchive={() => archive(selected)}
    />
  );

  return (
    <div className="flex h-dvh overflow-hidden">
      <GlobalRail />
      <div className="flex min-w-0 flex-1 flex-col">
        <WorkspaceHeader
          plan={plan}
          peers={peers}
          status={planDoc.status}
          canEdit={canEdit}
          onRename={(name) => updatePlan.mutate({ name })}
          onShare={() => setSharing(true)}
        />

        {planDoc.status === 'forbidden' && (
          <Banner tone="error" className="m-3 mb-0">
            You no longer have access to this plan’s board. Changes you make here won’t be saved.
          </Banner>
        )}

        {!isDesktop && (
          <div role="tablist" aria-label="Plan views" className="grid grid-cols-2 gap-1 border-b border-line bg-paper p-2">
            {(['board', 'itinerary'] as const).map((v) => (
              <button
                key={v}
                role="tab"
                type="button"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={cn('rounded-xl py-2 text-sm font-semibold', view === v ? 'bg-ink text-white' : 'text-ink-2')}
              >
                {v === 'board' ? 'Ideas' : 'Plan'}
              </button>
            ))}
          </div>
        )}

        <div className="flex min-h-0 flex-1">
          {isDesktop && (
            <aside aria-label="Workspace" className="flex w-[240px] shrink-0 flex-col gap-6 overflow-y-auto border-r border-line bg-paper px-3 py-4">
              <nav aria-label="Plan views" className="flex flex-col gap-0.5">
                <SideTab icon={LayoutGrid} label="Board" active={view === 'board'} onClick={() => setView('board')} />
                <SideTab icon={ListOrdered} label="Itinerary" active={view === 'itinerary'} onClick={() => setView('itinerary')} badge={planDoc.draft.length || undefined} />
                <SideTab icon={MapIcon} label="Map" soon />
                <SideTab icon={Vote} label="Decisions" soon />
              </nav>

              {canEdit && (
                <Button icon={<Plus className="size-4" />} onClick={() => setAdding({ position: null })}>
                  Add idea
                </Button>
              )}

              {view === 'board' && (
                <div>
                  <p className="px-2 text-xs font-semibold tracking-wide text-ink-3 uppercase">Show</p>
                  <div className="mt-2 flex flex-col gap-0.5" role="radiogroup" aria-label="Filter cards">
                    {FILTERS.map((f) => (
                      <button
                        key={f}
                        type="button"
                        role="radio"
                        aria-checked={filter === f}
                        onClick={() => setFilter(f)}
                        className={cn(
                          'flex items-center justify-between rounded-lg px-2 py-1.5 text-sm',
                          filter === f ? 'bg-ink/5 font-semibold text-ink' : 'text-ink-2 hover:bg-ink/5',
                        )}
                      >
                        {f === 'all' ? 'All ideas' : IDEA_STATUS_LABEL[f]}
                        <span className="text-xs text-ink-3 tabular-nums">{counts[f]}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {hiddenIdeas.length > 0 && (
                <div>
                  <p className="px-2 text-xs font-semibold tracking-wide text-ink-3 uppercase">Not on the board</p>
                  <ul className="mt-2 flex flex-col gap-1">
                    {hiddenIdeas.map((i) => (
                      <li key={i.id} className="flex items-center justify-between gap-1 rounded-lg px-2 py-1 text-[13px] text-ink-2">
                        <span className="truncate">{i.title}</span>
                        {canEdit && doc && (
                          <IconButton label={`Put “${i.title}” back on the board`} className="size-7" onClick={() => setIdeaNodeHidden(doc, i.id, false)}>
                            <Eye className="size-3.5" />
                          </IconButton>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {archivedIdeas.length > 0 && (
                <div>
                  <p className="px-2 text-xs font-semibold tracking-wide text-ink-3 uppercase">Archived</p>
                  <ul className="mt-2 flex flex-col gap-1">
                    {archivedIdeas.map((i) => (
                      <li key={i.id} className="flex items-center justify-between gap-1 rounded-lg px-2 py-1 text-[13px] text-ink-3">
                        <span className="truncate line-through decoration-ink/20">{i.title}</span>
                        {canEdit && (
                          <IconButton label={`Restore “${i.title}”`} className="size-7" onClick={() => ideaMutations.archive.mutate({ ideaId: i.id, archived: false })}>
                            <ArchiveArrowUp className="size-3.5" />
                          </IconButton>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="mt-auto px-2 text-xs text-ink-3">
                {plan ? (plan.myRole === 'VIEWER' ? 'You can view, react and comment.' : `You’re ${plan.myRole === 'OWNER' ? 'the owner' : 'an editor'}.`) : null}
              </p>
            </aside>
          )}

          <main className="relative min-w-0 flex-1">
            {!plan || ideasQ.isPending ? (
              <div className="grid grid-cols-2 gap-4 p-8 lg:grid-cols-3">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-52 rounded-2xl" />
                ))}
              </div>
            ) : view === 'board' ? (
              isDesktop ? (
                <Board
                  planId={planId}
                  doc={doc}
                  board={planDoc.board}
                  items={planDoc.items}
                  links={planDoc.links}
                  ideas={ideas}
                  statusOf={statusOf}
                  filter={filter}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  canEdit={canEdit}
                  schedule={schedule}
                  onRequestAdd={(position) => setAdding({ position })}
                  onAddToPlan={addToItinerary}
                  onRemoveIdeas={removeFromBoard}
                  onOpenItinerary={() => setView('itinerary')}
                />
              ) : (
                <IdeasList ideas={activeIdeas} statusOf={statusOf} filter={filter} onFilter={setFilter} onSelect={setSelectedId} canEdit={canEdit} onAdd={() => setAdding({ position: null })} />
              )
            ) : (
              <ItineraryView
                plan={plan}
                doc={doc}
                draft={planDoc.draft}
                schedule={schedule}
                issues={issues}
                draftBaseVersion={planDoc.draftBaseVersion}
                itinerary={itineraryQ.data}
                ideasById={ideasById}
                canEdit={canEdit}
                canPropose={canEdit && can(plan.myRole, 'proposal.generate')}
                ideaCount={activeIdeas.length}
                ai={aiStatus.data}
                onUpdatePlan={(patch) => updatePlan.mutate(patch)}
                onSelectIdea={setSelectedId}
                onUndo={() => planDoc.undo?.undo()}
                narrow={!!inspector && isDesktop}
              />
            )}
          </main>

          {inspector && isDesktop && (
            <div className="w-[320px] shrink-0 overflow-hidden border-l border-line" style={{ boxShadow: 'var(--shadow-panel)' }}>
              {inspector}
            </div>
          )}
        </div>
      </div>

      {inspector && !isDesktop && (
        <div className="fixed inset-0 z-40 flex flex-col bg-ink/30" onClick={() => setSelectedId(null)}>
          <div className="mt-12 min-h-0 flex-1 overflow-hidden rounded-t-3xl bg-paper" onClick={(e) => e.stopPropagation()}>
            {inspector}
          </div>
        </div>
      )}

      {plan && user && (
        <ShareDialog
          open={sharing}
          onClose={() => setSharing(false)}
          plan={plan}
          meId={user.id}
          onLeft={() => {
            setSharing(false);
            toast({ message: `You left “${plan.name}”.` });
            router.push('/');
          }}
        />
      )}

      <AddIdeaDialog
        open={adding !== null}
        planId={planId}
        onClose={() => setAdding(null)}
        onSaved={(result) => onIdeaSaved(result, adding?.position ?? null)}
      />
    </div>
  );
}

function SideTab({
  icon: Icon,
  label,
  active,
  soon,
  badge,
  onClick,
}: {
  icon: typeof LayoutGrid;
  label: string;
  active?: boolean;
  soon?: boolean;
  badge?: number;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={soon}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed',
        active ? 'bg-lilac-100 text-lilac-700' : 'text-ink-2 hover:bg-ink/5 disabled:hover:bg-transparent',
        soon && 'opacity-50',
      )}
    >
      <Icon className="size-4" aria-hidden />
      {label}
      {soon && <span className="ml-auto text-[10px] font-semibold tracking-wide text-ink-3 uppercase">soon</span>}
      {badge != null && <span className="ml-auto rounded-full bg-paper px-1.5 text-xs tabular-nums">{badge}</span>}
    </button>
  );
}

function WorkspaceHeader({
  plan,
  peers,
  status,
  canEdit,
  onRename,
  onShare,
}: {
  plan: PlanDTO | undefined;
  peers: Array<{ id: string; name: string; color: string }>;
  status: DocStatus;
  canEdit: boolean;
  onRename: (name: string) => void;
  onShare: () => void;
}) {
  const [name, setName] = useState(plan?.name ?? '');
  useEffect(() => setName(plan?.name ?? ''), [plan?.name]);
  const meta = plan
    ? [PLAN_TYPE_LABEL[plan.type], formatPlanDate(plan), formatWindow(plan.startMin, plan.endMin), plan.city, formatBudget(plan.budget)]
        .filter(Boolean)
        .join(' · ')
    : '';

  return (
    <header className="flex h-16 shrink-0 items-center gap-3 border-b border-line bg-paper px-3 desk:px-4">
      <Link href="/" aria-label="Back to Home" className="inline-flex size-9 items-center justify-center rounded-lg text-ink-2 hover:bg-ink/5">
        <ArrowLeft className="size-4" />
      </Link>
      <div className="min-w-0 flex-1">
        {plan ? (
          canEdit ? (
            <input
              aria-label="Plan name"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                const trimmed = name.trim();
                if (trimmed && trimmed !== plan.name) onRename(trimmed);
                else setName(plan.name);
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              className="w-full max-w-md truncate rounded-md bg-transparent font-display text-lg leading-tight font-semibold hover:bg-ink/5 focus:bg-ivory focus:outline-none"
            />
          ) : (
            <h1 className="truncate font-display text-lg font-semibold">{plan.name}</h1>
          )
        ) : (
          <Skeleton className="h-5 w-40" />
        )}
        <p className="truncate text-xs text-ink-3">{meta}</p>
      </div>
      <div className="flex items-center gap-3">
        <span className="hidden sm:inline-flex">
          <ConnectionPill status={status} />
        </span>
        <span className="hidden items-center gap-2 desk:flex" title={peers.map((p) => p.name).join(', ')}>
          <AvatarStack people={peers} />
          <span className="text-xs text-ink-3">{peers.length} online</span>
        </span>
        {plan?.myRole === 'VIEWER' && <Badge>View only</Badge>}
        <Button variant="secondary" size="sm" icon={<Share2 className="size-3.5" />} disabled={!plan} onClick={onShare}>
          Share
        </Button>
      </div>
    </header>
  );
}

function IdeasList({
  ideas,
  statusOf,
  filter,
  onFilter,
  onSelect,
  canEdit,
  onAdd,
}: {
  ideas: IdeaDTO[];
  statusOf: (idea: IdeaDTO) => IdeaStatus;
  filter: IdeaStatus | 'all';
  onFilter: (f: IdeaStatus | 'all') => void;
  onSelect: (id: string) => void;
  canEdit: boolean;
  onAdd: () => void;
}) {
  const shown = ideas.filter((i) => filter === 'all' || statusOf(i) === filter).toReversed();
  return (
    <div className="h-full overflow-y-auto pb-28">
      <div className="flex gap-2 overflow-x-auto px-4 pt-4">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => onFilter(f)}
            className={cn('shrink-0 rounded-full border px-3 py-1.5 text-[13px] font-semibold', filter === f ? 'border-ink bg-ink text-white' : 'border-line bg-paper text-ink-2')}
          >
            {f === 'all' ? 'All' : IDEA_STATUS_LABEL[f]}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="px-6 py-16 text-center text-sm text-ink-3">No ideas here yet.</p>
      ) : (
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          {shown.map((idea) => (
            <button key={idea.id} type="button" className="text-left" onClick={() => onSelect(idea.id)}>
              <IdeaCard idea={idea} status={statusOf(idea)} />
            </button>
          ))}
        </div>
      )}
      {canEdit && (
        <button
          type="button"
          aria-label="Add idea"
          onClick={onAdd}
          className="fixed right-5 bottom-6 z-30 inline-flex size-14 items-center justify-center rounded-full bg-ink text-white shadow-lift"
        >
          <Plus className="size-6" />
        </button>
      )}
    </div>
  );
}
