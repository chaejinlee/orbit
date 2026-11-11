'use client';

import {
  formatClock,
  formatDuration,
  formatMoney,
  PROPOSAL_CHIP_LABEL,
  PROPOSAL_CHIPS,
  PROPOSAL_LABEL_NAME,
  type AiStatusDTO,
  type DraftStop,
  type PlanDTO,
  type ProposalChip,
  type ProposalDTO,
  type ProposalLabelName,
  type ProposalsResultDTO,
  type UnderstoodDTO,
} from '@orbit/shared';
import { useMutation } from '@tanstack/react-query';
import { Lock, Pin, Sparkles, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, newRequestId } from '@/lib/api';
import { cn } from '@/lib/format';
import { Badge, Banner, Button, IconButton, Skeleton, Textarea, type Tone } from '../ui';

const LABEL_TONE: Record<ProposalLabelName, Tone> = { BALANCED: 'lilac', BUDGET: 'sage', EXPERIENCE: 'peach' };

function draftSignature(draft: readonly DraftStop[]): string {
  return draft.map((s) => `${s.id}:${s.ideaId}:${s.locked}:${s.fixedStartMin}:${s.durationMin}`).join('|');
}

export interface ProposalsPanelProps {
  open: boolean;
  onClose: () => void;
  plan: PlanDTO;
  draft: DraftStop[];
  ai: AiStatusDTO | undefined;
  onApply: (result: ProposalsResultDTO, proposal: ProposalDTO) => void;
}

/**
 * I01/I02 — "Make 3 options". Opening the panel is enough: options appear
 * without typing. Chips and the optional note refine them. Nothing changes the
 * shared draft until someone presses "Use this plan" (and that can be undone).
 */
export function ProposalsPanel({ open, onClose, plan, draft, ai, onApply }: ProposalsPanelProps) {
  const [chips, setChips] = useState<ProposalChip[]>([]);
  const [note, setNote] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [result, setResult] = useState<ProposalsResultDTO | null>(null);
  const [madeFrom, setMadeFrom] = useState<{ chips: string; note: string; draft: string } | null>(null);
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const generate = useMutation({
    mutationFn: (input: { chips: ProposalChip[]; note: string }) =>
      api.proposals(plan.id, {
        clientRequestId: newRequestId(),
        draft: draftRef.current,
        chips: input.chips,
        ...(input.note.trim() ? { note: input.note.trim() } : {}),
      }),
    onSuccess: (data, input) => {
      setResult(data);
      setMadeFrom({ chips: input.chips.join(','), note: input.note.trim(), draft: draftSignature(draftRef.current) });
    },
  });
  const run = () => generate.mutate({ chips, note: ai?.enabled ? note : '' });

  useEffect(() => {
    if (!open) return;
    headingRef.current?.focus();
    if (!result && !generate.isPending) run();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // Only react to opening/closing; `run` reads the latest state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const dirty = !!madeFrom && (madeFrom.chips !== chips.join(',') || madeFrom.note !== (ai?.enabled ? note.trim() : ''));
  const draftChanged = !!madeFrom && madeFrom.draft !== draftSignature(draft);

  const toggle = (chip: ProposalChip) =>
    setChips((list) => {
      if (list.includes(chip)) return list.filter((c) => c !== chip);
      const opposite: Partial<Record<ProposalChip, ProposalChip>> = { RELAXED: 'PACKED', PACKED: 'RELAXED' };
      return [...list.filter((c) => c !== opposite[chip]), chip];
    });

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-ink/20" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="proposals-title"
        className="flex h-full w-full max-w-[440px] flex-col bg-ivory shadow-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line bg-paper px-5 py-4">
          <div>
            <h2 id="proposals-title" ref={headingRef} tabIndex={-1} className="flex items-center gap-2 font-display text-xl font-semibold outline-none">
              <Sparkles className="size-5 text-lilac-600" aria-hidden />
              Plan options
            </h2>
            <p className="mt-0.5 text-[13px] text-ink-3">Built from your board and checked against time, pinned stops and budget.</p>
          </div>
          <IconButton label="Close plan options" onClick={onClose} className="-mr-2">
            <X className="size-4" />
          </IconButton>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Preferences">
            {PROPOSAL_CHIPS.map((chip) => {
              const on = chips.includes(chip);
              return (
                <button
                  key={chip}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(chip)}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
                    on ? 'border-lilac-600 bg-lilac-600 text-white' : 'border-line-2 bg-paper text-ink-2 hover:border-lilac-600 hover:text-lilac-700',
                  )}
                >
                  {PROPOSAL_CHIP_LABEL[chip]}
                </button>
              );
            })}
            <button
              type="button"
              aria-expanded={noteOpen}
              onClick={() => setNoteOpen((v) => !v)}
              className="rounded-full px-3 py-1.5 text-xs font-semibold text-lilac-700 hover:bg-lilac-100"
            >
              {noteOpen ? 'Hide note' : '+ Add a note'}
            </button>
          </div>
          {noteOpen && (
            <div className="mt-3">
              <Textarea
                aria-label="Note for Orbit (optional)"
                rows={2}
                maxLength={300}
                disabled={!ai?.enabled}
                placeholder={ai?.enabled ? 'e.g. end with dessert, skip the museum, start at 6' : 'Notes need AI. Add GEMINI_API_KEY to .env to turn it on.'}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <p className="mt-1 text-[11px] text-ink-3">Optional. Orbit shows what it understood, and never changes the plan on its own.</p>
            </div>
          )}

          {(dirty || draftChanged || (!result && !generate.isPending)) && (
            <Button className="mt-3 w-full" icon={<Sparkles className="size-4" />} loading={generate.isPending} onClick={run}>
              {result ? 'Remake options' : 'Make 3 options'}
            </Button>
          )}
          {draftChanged && !dirty && <p className="mt-1.5 text-[11px] text-ink-3">The draft changed since these options were made.</p>}

          {generate.isError && (
            <Banner tone="error" className="mt-4">
              {generate.error instanceof ApiError ? generate.error.message : 'Couldn’t make options right now. Try again.'}
            </Banner>
          )}

          {generate.isPending ? (
            <div className="mt-5 flex flex-col gap-3" aria-live="polite">
              <p className="text-[13px] text-ink-3">Checking times, travel and budget…</p>
              {[0, 1, 2].map((i) => (
                <div key={i} className="rounded-2xl border border-line bg-paper p-4">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="mt-3 h-5 w-3/4" />
                  <Skeleton className="mt-2 h-3 w-full" />
                  <Skeleton className="mt-1.5 h-3 w-5/6" />
                </div>
              ))}
            </div>
          ) : (
            result && (
              <div className="mt-5 flex flex-col gap-4">
                {result.ai.notice && <Banner tone="warning">{result.ai.notice}</Banner>}
                {result.problems.map((p) => (
                  <Banner key={p} tone="warning">
                    {p}
                  </Banner>
                ))}
                <Understood understood={result.understood} />
                {result.proposals.map((p) => (
                  <ProposalCard
                    key={p.id}
                    proposal={p}
                    understood={result.understood}
                    recommended={p.label === 'BALANCED'}
                    onUse={() => onApply(result, p)}
                  />
                ))}
                {result.proposals.length === 0 && result.problems.length === 0 && (
                  <p className="text-sm text-ink-3">No options this time. Add a few more ideas to the board and try again.</p>
                )}
              </div>
            )
          )}
        </div>

        <footer className="shrink-0 border-t border-line bg-paper px-5 py-3 text-[11px] leading-relaxed text-ink-3">
          Times use estimated travel. Opening hours aren’t checked here: tap “Hours” on a card to ask Orbit.{' '}
          {ai?.enabled
            ? ai.provider === 'fake'
              ? 'Headlines by the fake development AI.'
              : `Headlines and note reading by Gemini (${ai.model}).`
            : 'AI is off, so headlines are plain and notes aren’t read.'}
        </footer>
      </aside>
    </div>
  );
}

function Understood({ understood: u }: { understood: UnderstoodDTO }) {
  const chips: Array<{ text: string; tone?: Tone }> = [];
  const window = `${formatClock(u.window.startMin)}–${formatClock(u.window.endMin)}`;
  chips.push({ text: u.window.source === 'note' ? `${window} (from your note)` : u.window.source === 'assumed' ? `${window} (assumed)` : window });
  if (u.budget) chips.push({ text: `${formatMoney(u.budget)} budget${u.budgetSource === 'note' ? ' (from your note)' : ''}` });
  if (u.pace !== 'NORMAL') chips.push({ text: u.pace === 'RELAXED' ? 'Relaxed pace' : 'Fit in more', tone: 'lilac' });
  if (u.lessTravel) chips.push({ text: 'Less travel', tone: 'lilac' });
  if (u.lowerCost) chips.push({ text: 'Spend less', tone: 'lilac' });
  for (const m of u.mustInclude) chips.push({ text: `Include ${m.title}`, tone: 'sage' });
  if (u.endWith) chips.push({ text: `End with ${u.endWith.title}`, tone: 'sage' });
  for (const a of u.avoid) chips.push({ text: `Skip ${a.title}`, tone: 'rose' });
  if (u.maxStops) chips.push({ text: `At most ${u.maxStops} stops`, tone: 'lilac' });

  return (
    <section aria-label="What Orbit used" className="rounded-2xl bg-paper/70 px-3.5 py-3">
      <h3 className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">{u.noteUsed ? 'What Orbit understood' : 'Using'}</h3>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {chips.map((c) => (
          <Badge key={c.text} tone={c.tone ?? 'neutral'}>
            {c.text}
          </Badge>
        ))}
      </div>
      {u.window.source === 'assumed' && (
        <p className="mt-2 text-[11px] text-ink-3">This plan has no time set, so Orbit assumed one. Using an option sets the plan to that time.</p>
      )}
      {u.notUnderstood.length > 0 && <p className="mt-2 text-[11px] text-ink-3">Orbit can’t do this yet: {u.notUnderstood.join(', ')}.</p>}
    </section>
  );
}

function ProposalCard({
  proposal: p,
  understood,
  recommended,
  onUse,
}: {
  proposal: ProposalDTO;
  understood: UnderstoodDTO;
  recommended: boolean;
  onUse: () => void;
}) {
  const t = p.totals;
  const cost = useMemo(() => {
    if (!t.currency) return t.unknownCostCount > 0 ? 'cost unknown' : null;
    const known = formatMoney({ amountMinor: t.knownCostMinor, currency: t.currency });
    const of = understood.budget && understood.budget.currency === t.currency ? ` of ${formatMoney(understood.budget)}` : '';
    const unknown = t.unknownCostCount > 0 ? ` + ${t.unknownCostCount} without a price` : '';
    return `${known}${of}${unknown}`;
  }, [t, understood.budget]);
  const warnings = p.issues.filter((i) => i.severity !== 'info');

  return (
    <article
      aria-label={`${PROPOSAL_LABEL_NAME[p.label]} option`}
      className={cn('rounded-2xl border bg-paper p-4 shadow-card', recommended ? 'border-lilac-600/50' : 'border-line')}
    >
      <div className="flex items-center gap-2">
        <Badge tone={LABEL_TONE[p.label]}>{PROPOSAL_LABEL_NAME[p.label]}</Badge>
        {recommended && <span className="text-[11px] font-semibold text-lilac-700">Recommended</span>}
      </div>
      <h3 className="mt-2 font-display text-lg leading-snug font-semibold">{p.headline}</h3>
      {p.why && <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{p.why}</p>}
      <p className="mt-2 text-xs text-ink-3">
        {t.startMin != null && t.endMin != null && `${formatClock(t.startMin)}–${formatClock(t.endMin)} · `}
        {t.stopCount} {t.stopCount === 1 ? 'stop' : 'stops'} · ~{formatDuration(t.travelMin)} travel (est.)
        {cost && ` · ${cost}`}
      </p>
      {p.tradeoffs.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {p.tradeoffs.map((x) => (
            <Badge key={x}>{x}</Badge>
          ))}
        </div>
      )}

      <ol className="mt-3 flex flex-col gap-2 border-l-2 border-line pl-3">
        {p.stops.map((s) => (
          <li key={s.id} className="text-[13px]">
            <div className="flex items-baseline gap-2">
              <span className="w-[62px] shrink-0 text-xs text-ink-3 tabular-nums">{s.startMin != null ? formatClock(s.startMin) : '—'}</span>
              <span className="min-w-0 font-medium">
                {s.title}
                {s.locked && <Lock className="ml-1 inline size-3 text-ink-3" aria-label="Locked" />}
                {s.fixedStartMin != null && <Pin className="ml-1 inline size-3 text-ink-3" aria-label="Pinned time" />}
              </span>
            </div>
            {s.reasons.length > 0 && <p className="ml-[70px] text-[11px] text-ink-3">{s.reasons.join(' · ')}</p>}
          </li>
        ))}
      </ol>

      {warnings.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1">
          {warnings.map((w) => (
            <li key={`${w.code}-${w.stopId ?? ''}`} className={cn('text-[11px]', w.severity === 'error' ? 'text-rose-700' : 'text-butter-800')}>
              {w.message}
            </li>
          ))}
        </ul>
      )}

      {p.skipped.length > 0 && (
        <details className="mt-3 text-xs text-ink-3">
          <summary className="cursor-pointer font-semibold text-ink-2">Not included ({p.skipped.length})</summary>
          <ul className="mt-1.5 flex flex-col gap-0.5">
            {p.skipped.map((s) => (
              <li key={s.key}>
                {s.title} <span className="text-ink-3">· {s.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <Button className="mt-4 w-full" variant={recommended ? 'primary' : 'secondary'} onClick={onUse}>
        Use this plan
      </Button>
    </article>
  );
}
