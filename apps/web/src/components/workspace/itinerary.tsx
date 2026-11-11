'use client';

import {
  DEFAULT_TRAVEL_MIN,
  diffItinerary,
  formatClock,
  formatDuration,
  formatMoney,
  parseClock,
  summarizeCosts,
  toClockInput,
  toMajor,
  toMinor,
  PROPOSAL_LABEL_NAME,
  type AiStatusDTO,
  type DraftStop,
  type IdeaDTO,
  type ItineraryIssue,
  type ItineraryStateDTO,
  type IssueCode,
  type PlanDTO,
  type ProposalDTO,
  type ProposalsResultDTO,
  type ScheduledStop,
  type StopChange,
  type UpdatePlanInput,
} from '@orbit/shared';
import { moveDraftStop, removeDraftStop, replaceDraft, setDraftBaseVersion, updateDraftStop } from '@orbit/shared/yboard';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown,
  ChevronUp,
  CircleExclamationPoint,
  ClockArrowLeft,
  Footprints,
  GripVertical,
  Info,
  Lock,
  LockOpen,
  Pin,
  RotateCcw,
  Sparkles,
  TriangleExclamationPoint,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type * as Y from 'yjs';
import { api, ApiError } from '@/lib/api';
import { cn, timeAgo } from '@/lib/format';
import { keys } from '@/lib/queries';
import { notifyPlan } from '@/lib/plan-hints';
import { IDEA_KIND_STYLE } from '../plan-visuals';
import { useToast } from '../toast';
import { Badge, Banner, Button, Dialog, IconButton, Input, Select, Textarea } from '../ui';
import { ProposalsPanel } from './proposals';

const DURATIONS = [15, 30, 45, 60, 75, 90, 120, 150, 180, 240];

const SEVERITY = {
  error: { icon: CircleExclamationPoint, cls: 'text-rose-700', label: 'Must fix' },
  warning: { icon: TriangleExclamationPoint, cls: 'text-butter-800', label: 'Heads up' },
  info: { icon: Info, cls: 'text-sky-700', label: 'Note' },
} as const;

function IssueLine({ issue }: { issue: ItineraryIssue }) {
  const s = SEVERITY[issue.severity];
  return (
    <li className={cn('flex items-start gap-2 text-[13px] leading-snug', s.cls)}>
      <s.icon className="mt-0.5 size-3.5 shrink-0" aria-label={s.label} />
      <span>{issue.message}</span>
    </li>
  );
}

function describeChange(c: StopChange): string {
  switch (c.type) {
    case 'added':
      return `Add “${c.stop.title}”`;
    case 'removed':
      return `Remove “${c.stop.title}”`;
    case 'moved':
      return `Move “${c.stop.title}” to position ${c.stop.sequence + 1}`;
    case 'retimed':
      return `“${c.stop.title}”: ${c.fromStartMin != null ? formatClock(c.fromStartMin) : 'no time'} → ${c.toStartMin != null ? formatClock(c.toStartMin) : 'no time'}`;
    case 'resized':
      return `“${c.stop.title}”: ${formatDuration(c.fromDurationMin)} → ${formatDuration(c.toDurationMin)}`;
  }
}

export interface ItineraryViewProps {
  plan: PlanDTO;
  doc: Y.Doc | null;
  draft: DraftStop[];
  schedule: ScheduledStop[];
  issues: ItineraryIssue[];
  draftBaseVersion: number;
  itinerary: ItineraryStateDTO | undefined;
  ideasById: Map<string, IdeaDTO>;
  canEdit: boolean;
  /** Editors with `proposal.generate` get "3 options" (the planner works with AI off too). */
  canPropose: boolean;
  ideaCount: number;
  ai: AiStatusDTO | undefined;
  onUpdatePlan: (patch: UpdatePlanInput) => void;
  onSelectIdea: (ideaId: string) => void;
  /** Undoes this user's last board/draft edit (same as ⌘Z). */
  onUndo: () => void;
  /** True while the idea panel takes space on the right: the checks column stacks below. */
  narrow?: boolean;
}

/**
 * T01 — the shared draft as a timeline. Every edit is a CRDT write, so two
 * people can retime and reorder at once; the schedule and the hard-constraint
 * checks recompute live. Confirming turns the draft into the next immutable
 * version (T02).
 */
export function ItineraryView({
  plan,
  doc,
  draft,
  schedule,
  issues,
  draftBaseVersion,
  itinerary,
  ideasById,
  canEdit,
  canPropose,
  ideaCount,
  ai,
  onUpdatePlan,
  onSelectIdea,
  onUndo,
  narrow = false,
}: ItineraryViewProps) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [committing, setCommitting] = useState(false);
  const [proposing, setProposing] = useState(false);
  const toast = useToast();

  // "Use this plan": one undoable draft transaction. Locked stops keep their ids;
  // stops on other days are left alone. If the option needed a time window the
  // plan doesn't have yet (assumed, or from the note), the plan gets that window
  // so the shared draft shows exactly the times the option showed.
  const applyProposal = (result: ProposalsResultDTO, proposal: ProposalDTO) => {
    if (!doc) return;
    replaceDraft(doc, [...proposal.stops, ...draft.filter((s) => s.dayIndex !== 0)]);
    const w = result.understood.window;
    if (w.source !== 'plan' && (plan.startMin !== w.startMin || plan.endMin !== w.endMin)) {
      onUpdatePlan({ startMin: w.startMin, endMin: w.endMin });
    }
    setProposing(false);
    toast({ message: `Draft now follows the ${PROPOSAL_LABEL_NAME[proposal.label]} option.`, action: { label: 'Undo', onClick: onUndo } });
  };

  const current = itinerary?.current ?? null;
  const changes = useMemo(
    () =>
      diffItinerary(
        current?.stops.map((s) => ({ key: s.key, title: s.title, dayIndex: s.dayIndex, sequence: s.sequence, startMin: s.startMin, durationMin: s.durationMin })) ?? [],
        schedule.map((s) => ({ key: s.id, title: s.title, dayIndex: s.dayIndex, sequence: s.sequence, startMin: s.startMin, durationMin: s.durationMin })),
      ),
    [current, schedule],
  );
  const issuesByStop = useMemo(() => {
    const map = new Map<string, ItineraryIssue[]>();
    for (const i of issues) if (i.stopId) map.set(i.stopId, [...(map.get(i.stopId) ?? []), i]);
    return map;
  }, [issues]);
  const costs = summarizeCosts(schedule, plan.budget?.currency ?? null);
  const errors = issues.filter((i) => i.severity === 'error');

  const move = (stopId: string, toIndex: number) => doc && moveDraftStop(doc, stopId, { dayIndex: 0, index: toIndex });

  const onDrop = (beforeIndex: number) => {
    if (!dragId) return;
    const from = schedule.findIndex((s) => s.id === dragId);
    if (from >= 0) move(dragId, beforeIndex - (from < beforeIndex ? 1 : 0));
    setDragId(null);
    setDropIndex(null);
  };

  return (
    <div
      className={cn(
        'grid h-full min-h-0 grid-cols-1 overflow-y-auto',
        narrow ? '2xl:grid-cols-[minmax(0,1fr)_320px] 2xl:overflow-hidden' : 'xl:grid-cols-[minmax(0,1fr)_320px] xl:overflow-hidden',
      )}
    >
      <section aria-labelledby="itinerary-heading" className={cn('min-w-0 px-5 py-6 lg:px-8', narrow ? '2xl:overflow-y-auto' : 'xl:overflow-y-auto')}>
        <div className="mx-auto max-w-2xl">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 id="itinerary-heading" className="font-display text-3xl font-semibold">
                Itinerary
              </h2>
              <p className="mt-1 text-sm text-ink-3">
                Shared draft{draftBaseVersion > 0 ? ` · based on v${draftBaseVersion}` : ''} ·{' '}
                {changes.length === 0
                  ? current
                    ? 'matches the confirmed plan'
                    : 'not confirmed yet'
                  : `${changes.length} unconfirmed ${changes.length === 1 ? 'change' : 'changes'}`}
              </p>
            </div>
            {canEdit && (
              <div className="flex flex-wrap items-center gap-2">
                {canPropose && (
                  <Button
                    variant="secondary"
                    icon={<Sparkles className="size-4 text-lilac-600" />}
                    disabled={ideaCount === 0}
                    title={ideaCount === 0 ? 'Add ideas to the board first' : undefined}
                    onClick={() => setProposing(true)}
                  >
                    3 options
                  </Button>
                )}
                <Button disabled={schedule.length === 0 || (changes.length === 0 && !!current)} onClick={() => setCommitting(true)}>
                  {current ? `Confirm as v${(itinerary?.currentVersion ?? 0) + 1}` : 'Confirm plan'}
                </Button>
              </div>
            )}
          </div>
          {canEdit && <PlanWindowEditor plan={plan} onUpdatePlan={onUpdatePlan} />}

          {schedule.length === 0 ? (
            <div className="mt-8 rounded-3xl border border-dashed border-line-2 bg-paper/60 px-6 py-12 text-center">
              <p className="font-display text-xl font-semibold">Nothing in the plan yet</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-ink-2">
                On the board, drag a card onto the plan strip — or open an idea and choose “Add to itinerary”.
              </p>
              {canPropose && ideaCount > 0 && (
                <Button className="mt-5" icon={<Sparkles className="size-4" />} onClick={() => setProposing(true)}>
                  Let Orbit make 3 options
                </Button>
              )}
            </div>
          ) : (
            <ol className="mt-6" onDragLeave={() => setDropIndex(null)}>
              {schedule.map((stop, index) => (
                <li key={stop.id}>
                  {index > 0 && <TravelLeg stop={stop} doc={doc} canEdit={canEdit} />}
                  <div
                    onDragOver={(e) => {
                      if (!dragId) return;
                      e.preventDefault();
                      const r = e.currentTarget.getBoundingClientRect();
                      setDropIndex(e.clientY < r.top + r.height / 2 ? index : index + 1);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dropIndex != null) onDrop(dropIndex);
                    }}
                    className="relative"
                  >
                    {dropIndex === index && dragId && <DropLine position="top" />}
                    <StopRow
                      stop={stop}
                      idea={stop.ideaId ? ideasById.get(stop.ideaId) : undefined}
                      issues={issuesByStop.get(stop.id) ?? []}
                      doc={doc}
                      canEdit={canEdit}
                      isFirst={index === 0}
                      isLast={index === schedule.length - 1}
                      dragging={dragId === stop.id}
                      onDragStart={() => setDragId(stop.id)}
                      onDragEnd={() => {
                        setDragId(null);
                        setDropIndex(null);
                      }}
                      onMoveUp={() => move(stop.id, index - 1)}
                      onMoveDown={() => move(stop.id, index + 1)}
                      onOpenIdea={() => stop.ideaId && onSelectIdea(stop.ideaId)}
                      defaultCurrency={plan.budget?.currency ?? 'CAD'}
                    />
                    {dropIndex === index + 1 && dragId && index === schedule.length - 1 && <DropLine position="bottom" />}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>

      <aside
        aria-label="Plan checks"
        className={cn(
          'border-t border-line bg-paper px-5 py-6',
          narrow ? '2xl:overflow-y-auto 2xl:border-t-0 2xl:border-l' : 'xl:overflow-y-auto xl:border-t-0 xl:border-l',
        )}
      >
        <div className="flex flex-col gap-6">
          {plan.budget && (
            <div>
              <h3 className="text-xs font-semibold tracking-wide text-ink-3 uppercase">Budget</h3>
              <p className="mt-2 font-display text-2xl font-semibold">
                {formatMoney({ amountMinor: costs.knownTotalMinor, currency: plan.budget.currency })}
                <span className="ml-1.5 text-sm font-normal text-ink-3">of {formatMoney(plan.budget)}</span>
              </p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink/5" role="meter" aria-valuemin={0} aria-valuemax={plan.budget.amountMinor} aria-valuenow={costs.knownTotalMinor} aria-label="Estimated cost against budget">
                <div
                  className={cn('h-full rounded-full', costs.knownTotalMinor > plan.budget.amountMinor ? 'bg-rose-700' : 'bg-sage-700')}
                  style={{ width: `${Math.min(100, (costs.knownTotalMinor / Math.max(1, plan.budget.amountMinor)) * 100)}%` }}
                />
              </div>
              {costs.unknownCount > 0 && <p className="mt-1.5 text-xs text-ink-3">{costs.unknownCount} without an estimate</p>}
            </div>
          )}

          <div>
            <h3 className="text-xs font-semibold tracking-wide text-ink-3 uppercase">Checks</h3>
            {issues.length === 0 ? (
              <p className="mt-2 flex items-center gap-2 text-[13px] text-sage-700">All hard constraints are met.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2">
                {issues.map((issue, i) => (
                  <IssueLine key={`${issue.code}-${issue.stopId ?? i}`} issue={issue} />
                ))}
              </ul>
            )}
            <p className="mt-3 text-[11px] text-ink-3">The server runs the same checks again when you confirm.</p>
          </div>

          {errors.length > 0 && canEdit && (
            <p className="-mt-3 text-xs text-ink-3">You can still confirm — you’ll be asked to accept each failed check explicitly.</p>
          )}

          <VersionHistory planId={plan.id} itinerary={itinerary} doc={doc} canEdit={canEdit} />
        </div>
      </aside>

      <ProposalsPanel open={proposing} onClose={() => setProposing(false)} plan={plan} draft={draft} ai={ai} onApply={applyProposal} />

      <CommitDialog
        open={committing}
        onClose={() => setCommitting(false)}
        planId={plan.id}
        doc={doc}
        draft={draft}
        changes={changes}
        issues={issues}
        itinerary={itinerary}
      />
    </div>
  );
}

function DropLine({ position }: { position: 'top' | 'bottom' }) {
  return <div className={cn('absolute right-0 left-[84px] z-10 h-0.5 rounded-full bg-lilac-600', position === 'top' ? '-top-1' : '-bottom-1')} aria-hidden />;
}

function PlanWindowEditor({ plan, onUpdatePlan }: { plan: PlanDTO; onUpdatePlan: (patch: UpdatePlanInput) => void }) {
  const [error, setError] = useState<string | null>(null);
  const commit = (field: 'startMin' | 'endMin', value: string) => {
    const minutes = value ? parseClock(value) : null;
    const next = { startMin: plan.startMin, endMin: plan.endMin, [field]: minutes };
    if (next.startMin != null && next.endMin != null && next.endMin <= next.startMin) {
      setError('End must be after start.');
      return;
    }
    setError(null);
    onUpdatePlan({ [field]: minutes });
  };
  return (
    <div className="mt-4 flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] whitespace-nowrap text-ink-2">
        <label className="flex items-center gap-1.5">
          Starts
          <Input type="time" step={900} className="h-8 w-[118px] px-2 text-[13px]" defaultValue={plan.startMin != null ? toClockInput(plan.startMin) : ''} key={`s${plan.startMin}`} onBlur={(e) => commit('startMin', e.target.value)} />
        </label>
        <label className="flex items-center gap-1.5">
          ends by
          <Input type="time" step={900} className="h-8 w-[118px] px-2 text-[13px]" defaultValue={plan.endMin != null ? toClockInput(plan.endMin) : ''} key={`e${plan.endMin}`} onBlur={(e) => commit('endMin', e.target.value)} />
        </label>
      </div>
      {error && <p className="text-xs text-rose-700">{error}</p>}
    </div>
  );
}

function TravelLeg({ stop, doc, canEdit }: { stop: ScheduledStop; doc: Y.Doc | null; canEdit: boolean }) {
  return (
    <div className="flex items-center gap-2 py-2 pl-[84px] text-xs text-ink-3">
      <Footprints className="size-3.5" aria-hidden />
      {canEdit ? (
        <label className="flex items-center gap-1.5">
          <input
            type="number"
            min={0}
            max={600}
            step={5}
            aria-label={`Travel time to ${stop.title} in minutes`}
            placeholder={String(stop.travelEstimated ? stop.travelMin : DEFAULT_TRAVEL_MIN)}
            defaultValue={stop.travelMinFromPrev ?? ''}
            key={stop.travelMinFromPrev ?? 'est'}
            onBlur={(e) => {
              const v = e.target.value === '' ? null : Math.max(0, Math.round(Number(e.target.value)));
              if (doc && v !== stop.travelMinFromPrev) updateDraftStop(doc, stop.id, { travelMinFromPrev: Number.isFinite(v) ? v : null });
            }}
            className="w-14 rounded-md border border-line bg-paper px-1.5 py-0.5 text-right text-ink tabular-nums"
          />
          min travel
        </label>
      ) : (
        <span>{stop.travelMin} min travel</span>
      )}
      {stop.travelEstimated && <Badge>estimate</Badge>}
      {stop.idleBeforeMin > 0 && <span>· {formatDuration(stop.idleBeforeMin)} free before</span>}
    </div>
  );
}

function StopRow({
  stop,
  idea,
  issues,
  doc,
  canEdit,
  isFirst,
  isLast,
  dragging,
  onDragStart,
  onDragEnd,
  onMoveUp,
  onMoveDown,
  onOpenIdea,
  defaultCurrency,
}: {
  stop: ScheduledStop;
  idea: IdeaDTO | undefined;
  issues: ItineraryIssue[];
  doc: Y.Doc | null;
  canEdit: boolean;
  isFirst: boolean;
  isLast: boolean;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onOpenIdea: () => void;
  defaultCurrency: string;
}) {
  const kind = idea ? IDEA_KIND_STYLE[idea.kind] : null;
  const hasError = issues.some((i) => i.severity === 'error');
  const update = (patch: Parameters<typeof updateDraftStop>[2]) => doc && updateDraftStop(doc, stop.id, patch);
  const currency = stop.costCurrency ?? defaultCurrency;

  return (
    <div className={cn('grid grid-cols-[72px_minmax(0,1fr)] gap-3', dragging && 'opacity-50')}>
      <div className="pt-3 text-right">
        <p className="text-[15px] font-semibold tabular-nums">{stop.startMin != null ? formatClock(stop.startMin) : '—'}</p>
        {stop.endMin != null && <p className="text-xs text-ink-3 tabular-nums">{formatClock(stop.endMin)}</p>}
      </div>
      <div
        draggable={canEdit}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', stop.id);
          onDragStart();
        }}
        onDragEnd={onDragEnd}
        className={cn('group rounded-2xl border bg-paper p-3 shadow-card', hasError ? 'border-rose-700/40 ring-1 ring-rose-700/20' : 'border-line')}
      >
        <div className="flex items-start gap-2">
          {canEdit && <GripVertical className="mt-1 size-4 shrink-0 cursor-grab text-ink-3" aria-hidden />}
          <button type="button" onClick={onOpenIdea} className="min-w-0 flex-1 text-left">
            <span className="flex items-start gap-1.5">
              {kind && <kind.icon className={cn('mt-1 size-3.5 shrink-0', kind.chip)} aria-hidden />}
              <span className="line-clamp-2 leading-snug font-semibold hover:text-lilac-700">{stop.title}</span>
            </span>
            {idea?.place?.address && <span className="block truncate text-xs text-ink-3">{idea.place.address}</span>}
          </button>
          {canEdit && (
            <div className="flex shrink-0 items-center">
              <IconButton
                label={stop.locked ? 'Unlock stop' : 'Lock stop (keep it when regenerating)'}
                active={stop.locked}
                onClick={() => update({ locked: !stop.locked })}
                className="size-8"
              >
                {stop.locked ? <Lock className="size-4" /> : <LockOpen className="size-4" />}
              </IconButton>
              <IconButton label="Remove from itinerary" onClick={() => doc && removeDraftStop(doc, stop.id)} className="size-8">
                <X className="size-4" />
              </IconButton>
            </div>
          )}
          {!canEdit && stop.locked && <Lock className="size-4 text-ink-3" aria-label="Locked" />}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
          <Select
            aria-label="Duration"
            disabled={!canEdit}
            value={stop.durationMin}
            onChange={(e) => update({ durationMin: Number(e.target.value) })}
            className="h-8 w-[104px] px-2 pr-7 text-[13px]"
          >
            {[...new Set([...DURATIONS, stop.durationMin])]
              .sort((a, b) => a - b)
              .map((d) => (
                <option key={d} value={d}>
                  {formatDuration(d)}
                </option>
              ))}
          </Select>

          {stop.fixedStartMin != null ? (
            <span className="flex items-center gap-1 rounded-lg bg-lilac-50 py-0.5 pr-0.5 pl-2 text-lilac-700">
              <Pin className="size-3.5" aria-hidden />
              <input
                type="time"
                step={900}
                disabled={!canEdit}
                aria-label="Fixed start time"
                defaultValue={toClockInput(stop.fixedStartMin)}
                key={stop.fixedStartMin}
                onBlur={(e) => {
                  const m = parseClock(e.target.value);
                  if (m != null && m !== stop.fixedStartMin) update({ fixedStartMin: m });
                }}
                className="bg-transparent text-[13px] tabular-nums"
              />
              {canEdit && (
                <IconButton label="Unpin time" className="size-6" onClick={() => update({ fixedStartMin: null })}>
                  <X className="size-3" />
                </IconButton>
              )}
            </span>
          ) : (
            canEdit && (
              <Button variant="ghost" size="sm" icon={<Pin className="size-3.5" />} onClick={() => update({ fixedStartMin: stop.startMin ?? 18 * 60 })}>
                Pin time
              </Button>
            )
          )}

          {canEdit && (
            <span className="flex items-center">
              <IconButton label="Move up" disabled={isFirst} onClick={onMoveUp} className="size-7">
                <ChevronUp className="size-4" />
              </IconButton>
              <IconButton label="Move down" disabled={isLast} onClick={onMoveDown} className="size-7">
                <ChevronDown className="size-4" />
              </IconButton>
            </span>
          )}

          <label className="ml-auto flex items-center gap-1 text-ink-3">
            <span className="sr-only">Estimated cost</span>
            <input
              inputMode="decimal"
              disabled={!canEdit}
              placeholder="cost"
              defaultValue={stop.costMinor != null ? String(toMajor(stop.costMinor, currency)) : ''}
              key={`${stop.costMinor}-${currency}`}
              onBlur={(e) => {
                const raw = e.target.value.trim();
                const amount = raw === '' ? null : Number(raw);
                if (amount != null && (!Number.isFinite(amount) || amount < 0)) return;
                update({ costMinor: amount == null ? null : toMinor(amount, currency), costCurrency: amount == null ? null : currency });
              }}
              className="w-16 rounded-md border border-line bg-paper px-1.5 py-0.5 text-right text-ink tabular-nums"
            />
            {currency}
          </label>
        </div>

        {issues.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1 border-t border-line pt-2">
            {issues.map((i) => (
              <IssueLine key={i.code} issue={i} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function VersionHistory({
  planId,
  itinerary,
  doc,
  canEdit,
}: {
  planId: string;
  itinerary: ItineraryStateDTO | undefined;
  doc: Y.Doc | null;
  canEdit: boolean;
}) {
  const toast = useToast();
  const [confirming, setConfirming] = useState<number | null>(null);
  const restore = useMutation({
    mutationFn: (version: number) => api.itineraryVersion(planId, version),
    onSuccess: (v) => {
      if (!doc) return;
      replaceDraft(
        doc,
        v.stops.map((s) => ({
          id: s.key,
          ideaId: s.ideaId,
          title: s.title,
          dayIndex: s.dayIndex,
          durationMin: s.durationMin,
          fixedStartMin: s.fixedStartMin,
          locked: s.locked,
          travelMinFromPrev: s.travelMinFromPrev,
          costMinor: s.cost?.amountMinor ?? null,
          costCurrency: s.cost?.currency ?? null,
        })),
        v.version,
      );
      setConfirming(null);
      toast({ message: `Draft restored from version ${v.version}. Confirm to make it current.` });
    },
  });

  if (!itinerary || itinerary.history.length === 0) {
    return (
      <div>
        <h3 className="text-xs font-semibold tracking-wide text-ink-3 uppercase">History</h3>
        <p className="mt-2 text-[13px] text-ink-3">Every confirmation is saved as a version you can come back to.</p>
      </div>
    );
  }
  return (
    <div>
      <h3 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-ink-3 uppercase">
        <ClockArrowLeft className="size-3.5" aria-hidden /> History
      </h3>
      <ol className="mt-2 flex flex-col gap-2">
        {itinerary.history.map((v) => (
          <li key={v.version} className="rounded-xl border border-line px-3 py-2 text-[13px]">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">
                v{v.version}
                {v.version === itinerary.currentVersion && (
                  <Badge tone="sage" className="ml-2">
                    current
                  </Badge>
                )}
              </span>
              {canEdit &&
                (confirming === v.version ? (
                  <span className="flex gap-1">
                    <Button size="sm" variant="secondary" onClick={() => setConfirming(null)}>
                      Keep draft
                    </Button>
                    <Button size="sm" loading={restore.isPending} onClick={() => restore.mutate(v.version)}>
                      Replace draft
                    </Button>
                  </span>
                ) : (
                  <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={() => setConfirming(v.version)}>
                    Restore
                  </Button>
                ))}
            </div>
            <p className="mt-0.5 text-ink-3">
              {v.committedBy.name} · {timeAgo(v.committedAt)} · {v.stopCount} {v.stopCount === 1 ? 'stop' : 'stops'}
            </p>
            {v.note && <p className="mt-1 text-ink-2">“{v.note}”</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}

function CommitDialog({
  open,
  onClose,
  planId,
  doc,
  draft,
  changes,
  issues,
  itinerary,
}: {
  open: boolean;
  onClose: () => void;
  planId: string;
  doc: Y.Doc | null;
  draft: DraftStop[];
  changes: StopChange[];
  issues: ItineraryIssue[];
  itinerary: ItineraryStateDTO | undefined;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [accepted, setAccepted] = useState<IssueCode[]>([]);
  const [conflict, setConflict] = useState<string | null>(null);
  const expectedVersion = itinerary?.currentVersion ?? 0;
  const errorCodes = [...new Set(issues.filter((i) => i.severity === 'error').map((i) => i.code))];
  const blocked = errorCodes.some((c) => !accepted.includes(c));
  // e.g. someone else just confirmed exactly this draft.
  const nothingToConfirm = changes.length === 0 && !!itinerary?.current;

  const commit = useMutation({
    mutationFn: () =>
      api.commitItinerary(planId, {
        expectedVersion,
        stops: draft,
        note: note.trim() || undefined,
        acceptedIssueCodes: accepted.filter((c) => errorCodes.includes(c)),
      }),
    onSuccess: (version) => {
      if (doc) setDraftBaseVersion(doc, version.version);
      void qc.invalidateQueries({ queryKey: keys.itinerary(planId) });
      void qc.invalidateQueries({ queryKey: keys.plan(planId) });
      void qc.invalidateQueries({ queryKey: keys.plans });
      notifyPlan(planId, ['itinerary', 'plan']);
      toast({ message: `Confirmed version ${version.version}.` });
      setNote('');
      setAccepted([]);
      setConflict(null);
      onClose();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        setConflict(error.message);
        void qc.invalidateQueries({ queryKey: keys.itinerary(planId) });
      }
    },
  });

  const otherError = commit.error instanceof ApiError && commit.error.status !== 409 ? commit.error.message : null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Confirm version ${expectedVersion + 1}`}
      description="Confirmed versions are kept forever; editing later creates a new version."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Keep editing
          </Button>
          <Button loading={commit.isPending} disabled={blocked || draft.length === 0 || nothingToConfirm} onClick={() => commit.mutate()}>
            Confirm v{expectedVersion + 1}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {conflict && (
          <Banner tone="warning">
            {conflict} The changes below are now compared against the latest version.
          </Banner>
        )}

        <div>
          <h3 className="text-[13px] font-semibold">What changes</h3>
          {changes.length === 0 ? (
            <p className="mt-1 text-sm text-ink-3">
              Nothing to confirm — the draft matches version {itinerary?.currentVersion ?? 0}.
            </p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1 text-sm text-ink-2">
              {changes.map((c, i) => (
                <li key={`${c.type}-${c.stop.key}-${i}`} className="flex gap-2">
                  <span
                    className={cn(
                      'mt-1.5 size-1.5 shrink-0 rounded-full',
                      c.type === 'added' ? 'bg-sage-700' : c.type === 'removed' ? 'bg-rose-700' : 'bg-lilac-600',
                    )}
                    aria-hidden
                  />
                  {describeChange(c)}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3 className="text-[13px] font-semibold">Checks</h3>
          {issues.length === 0 ? (
            <p className="mt-1 text-sm text-sage-700">All hard constraints are met.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2">
              {issues.map((issue, i) => (
                <IssueLine key={`${issue.code}-${issue.stopId ?? i}`} issue={issue} />
              ))}
            </ul>
          )}
          {errorCodes.length > 0 && (
            <fieldset className="mt-3 rounded-2xl border border-rose/70 bg-rose-50 p-3">
              <legend className="px-1 text-[13px] font-semibold text-rose-700">Confirm anyway?</legend>
              <p className="text-xs text-rose-700">Hard constraints are never relaxed silently. Tick each one you accept.</p>
              <div className="mt-2 flex flex-col gap-1.5">
                {errorCodes.map((code) => (
                  <label key={code} className="flex items-center gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      className="size-4 accent-ink"
                      checked={accepted.includes(code)}
                      onChange={(e) => setAccepted((a) => (e.target.checked ? [...a, code] : a.filter((c) => c !== code)))}
                    />
                    {issues.find((i) => i.code === code)?.message}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold">
            Note <span className="font-normal text-ink-3">optional</span>
          </span>
          <Textarea rows={2} maxLength={280} placeholder="Moved dinner to 7:30 so we can stay longer at the gallery" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>

        {otherError && <Banner tone="error">{otherError}</Banner>}
      </div>
    </Dialog>
  );
}
