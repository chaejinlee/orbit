import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@orbit/db';
import {
  compareByPosition,
  DEFAULT_PREFERENCES,
  parseClock,
  planProposals,
  toMinor,
  type DraftStop,
  type IdeaKind,
  type IdeaRefDTO,
  type Money,
  type PlannerCandidate,
  type PlannerPreferences,
  type ProposalDTO,
  type ProposalLabelName,
  type ProposalsInput,
  type ProposalsResultDTO,
  type UnderstoodDTO,
  type WindowSource,
} from '@orbit/shared';
import { isoDay, money } from '../core/mappers';
import { PRISMA, type AuthUser, type Db } from '../core/tokens';
import { AI_MODEL, type AiModel } from './model';
import { clip, headlineRequest, noteRequest, type NoteOutput } from './prompts';
import { AiUsageService } from './usage.service';

const DEFAULT_DURATION: Record<IdeaKind, number> = { PLACE: 60, ACTIVITY: 90, NOTE: 45, LINK: 60 };
/** Used only when the plan has no time window yet, and always labeled "assumed". */
const ASSUMED_WINDOW = { startMin: 10 * 60, endMin: 20 * 60 };
const ASSUMED_LENGTH_MIN = 6 * 60;

interface PlanningWindow {
  startMin: number;
  endMin: number;
  source: WindowSource;
}

type IdeaRow = Prisma.IdeaGetPayload<{ include: { place: true; reactions: true } }>;

/** Turns the plan's ideas and the current draft into planner candidates. */
export function buildCandidates(ideas: readonly IdeaRow[], draft: readonly DraftStop[]) {
  const day = draft.filter((s) => s.dayIndex === 0).sort(compareByPosition);
  const known = new Set(ideas.map((i) => i.id));
  const firstStop = new Map<string, DraftStop>();
  for (const s of day) if (s.ideaId && known.has(s.ideaId) && !firstStop.has(s.ideaId)) firstStop.set(s.ideaId, s);
  const keyOf = (s: DraftStop) => (s.ideaId && firstStop.get(s.ideaId) === s ? s.ideaId : `stop:${s.id}`);

  const candidates: PlannerCandidate[] = [];
  const kinds = new Map<string, IdeaKind>();
  for (const idea of ideas) {
    const stop = firstStop.get(idea.id);
    const interested = idea.reactions.filter((r) => r.kind === 'INTERESTED').length;
    const notInterested = idea.reactions.filter((r) => r.kind === 'NOT_INTERESTED').length;
    // Places and activities are stops by nature; links and notes only once someone backs them.
    const schedulable = idea.kind === 'PLACE' || idea.kind === 'ACTIVITY' || !!stop || idea.shortlisted || interested > 0;
    if (!schedulable) continue;
    kinds.set(idea.id, idea.kind);
    const stopCost = stop && stop.costMinor != null;
    candidates.push({
      key: idea.id,
      ideaId: idea.id,
      title: idea.title,
      point: idea.place?.lat != null && idea.place?.lng != null ? { lat: idea.place.lat, lng: idea.place.lng } : null,
      durationMin: stop?.durationMin ?? idea.durationMin ?? DEFAULT_DURATION[idea.kind],
      durationGuessed: !stop && idea.durationMin == null,
      costMinor: stopCost ? stop.costMinor : idea.costMinor,
      costCurrency: stopCost ? stop.costCurrency : (idea.costCurrency?.trim() ?? null),
      fixedStartMin: stop?.fixedStartMin ?? null,
      locked: stop?.locked ?? false,
      stopId: stop?.id ?? null,
      interested,
      notInterested,
      shortlisted: idea.shortlisted,
    });
  }
  // Stops that aren't a live idea on the board (e.g. restored from an old
  // version) stay candidates too, so options never silently drop them.
  for (const s of day) {
    if (keyOf(s) !== `stop:${s.id}` || (s.ideaId && known.has(s.ideaId))) continue;
    candidates.push({
      key: `stop:${s.id}`,
      ideaId: s.ideaId,
      title: s.title,
      point: null,
      durationMin: s.durationMin,
      durationGuessed: false,
      costMinor: s.costMinor,
      costCurrency: s.costCurrency,
      fixedStartMin: s.fixedStartMin,
      locked: s.locked,
      stopId: s.id,
      interested: 0,
      notInterested: 0,
      shortlisted: false,
    });
  }
  const lockedOrder = day.filter((s) => s.locked).map(keyOf);
  return { candidates, lockedOrder, kinds };
}

/** The plan's window, or a clearly labeled assumption when it has none. */
export function planningWindow(startMin: number | null, endMin: number | null): PlanningWindow {
  if (startMin != null && endMin != null && endMin > startMin) return { startMin, endMin, source: 'plan' };
  if (startMin != null) return { startMin, endMin: Math.min(startMin + ASSUMED_LENGTH_MIN, 2880), source: 'assumed' };
  if (endMin != null) return { startMin: Math.max(0, endMin - ASSUMED_LENGTH_MIN), endMin, source: 'assumed' };
  return { ...ASSUMED_WINDOW, source: 'assumed' };
}

@Injectable()
export class ProposalsService {
  private readonly log = new Logger('Proposals');

  constructor(
    @Inject(PRISMA) private readonly db: Db,
    @Inject(AI_MODEL) private readonly ai: AiModel | null,
    @Inject(AiUsageService) private readonly usage: AiUsageService,
  ) {}

  /**
   * "Make 3 options". The planner is deterministic and free; the model (when
   * on) only reads the optional note and rewords the headlines. If the model
   * is off, out of quota or fails, the options still come back.
   */
  async generate(planId: string, user: AuthUser, input: ProposalsInput): Promise<ProposalsResultDTO> {
    const plan = await this.db.plan.findUniqueOrThrow({ where: { id: planId } });
    const ideas = await this.db.idea.findMany({
      where: { planId, archivedAt: null, mergedIntoId: null },
      include: { place: true, reactions: true },
      orderBy: { createdAt: 'asc' },
    });
    const { candidates, lockedOrder, kinds } = buildCandidates(ideas, input.draft);
    const titleOf = new Map(candidates.map((c) => [c.key, c.title]));
    const ref = (key: string): IdeaRefDTO => ({ ideaId: key, title: titleOf.get(key) ?? key });

    const prefs: PlannerPreferences = {
      ...DEFAULT_PREFERENCES,
      pace: input.chips.includes('RELAXED') ? 'RELAXED' : input.chips.includes('PACKED') ? 'PACKED' : 'NORMAL',
      lessTravel: input.chips.includes('LESS_TRAVEL'),
      lowerCost: input.chips.includes('CHEAPER'),
    };
    let window = planningWindow(plan.startMin, plan.endMin);
    let budget: Money | null = money(plan.budgetMinor, plan.budgetCurrency);
    let budgetSource: UnderstoodDTO['budgetSource'] = budget ? 'plan' : null;
    const notUnderstood: string[] = [];
    let noteUsed = false;
    let model: string | null = null;
    let notice: string | null = null;

    const note = input.note?.trim() || null;
    if (note) {
      if (!this.ai) notice = 'AI is off, so your note wasn’t read.';
      else if (!(await this.usage.hasRoom(user.id))) notice = 'You’ve used today’s AI requests, so your note wasn’t read.';
      else {
        try {
          const { data } = await this.ai.generateJson(
            noteRequest({
              note,
              planType: plan.type,
              city: plan.city,
              date: isoDay(plan.startDate),
              window,
              budget,
              ideas: candidates.filter((c) => c.ideaId && kinds.has(c.ideaId)).map((c) => ({ id: c.ideaId!, title: c.title, kind: kinds.get(c.ideaId!)! })),
            }),
          );
          model = this.ai.model;
          noteUsed = true;
          const applied = applyNote(data, { prefs, chipsSetPace: prefs.pace !== 'NORMAL', known: new Set(titleOf.keys()), window, budget, currency: plan.budgetCurrency?.trim() ?? null, notUnderstood });
          window = applied.window;
          if (applied.budget) {
            budget = applied.budget;
            budgetSource = 'note';
          }
        } catch (error) {
          this.log.warn(`Couldn’t read the note: ${(error as Error).message}`);
          notice = 'Orbit couldn’t read your note this time, so these options ignore it.';
        }
      }
    }

    const result = planProposals({ candidates, lockedOrder, window: { startMin: window.startMin, endMin: window.endMin }, budget, prefs });

    const worded = new Map<ProposalLabelName, { headline: string; why: string }>();
    if (this.ai && result.proposals.length > 0 && (model != null || (await this.usage.hasRoom(user.id)))) {
      try {
        const { data } = await this.ai.generateJson(headlineRequest({ note: noteUsed ? note : null, proposals: result.proposals }));
        model = this.ai.model;
        for (const o of data.options) worded.set(o.label, { headline: clip(o.headline, 70), why: clip(o.why, 160) });
      } catch (error) {
        this.log.warn(`Couldn’t word the headlines: ${(error as Error).message}`); // the plain ones stay
      }
    }

    const proposals = result.proposals.map((p) => ({
      ...p,
      headline: worded.get(p.label)?.headline ?? p.headline,
      why: worded.get(p.label)?.why ?? null,
    }));
    const understood: UnderstoodDTO = {
      chips: input.chips,
      pace: prefs.pace,
      lessTravel: prefs.lessTravel,
      lowerCost: prefs.lowerCost,
      mustInclude: prefs.mustIncludeKeys.map(ref),
      avoid: prefs.avoidKeys.map(ref),
      endWith: prefs.endWithKey ? ref(prefs.endWithKey) : null,
      maxStops: prefs.maxStops,
      window,
      budget,
      budgetSource,
      notUnderstood,
      noteUsed,
    };

    const basePlanVersion = plan.currentVersion;
    const job = await this.db.planningJob.create({
      data: {
        planId,
        requestedById: user.id,
        status: 'SUCCEEDED',
        basePlanVersion,
        model,
        finishedAt: new Date(),
        constraints: { chips: input.chips, note: noteUsed ? note : null, understood } as unknown as Prisma.InputJsonValue,
        proposals: {
          create: proposals.map((p) => ({ planId, label: p.label, basePlanVersion, payload: p as unknown as Prisma.InputJsonValue })),
        },
      },
      include: { proposals: { select: { id: true, label: true } } },
    });
    const idOf = new Map(job.proposals.map((p) => [p.label, p.id]));

    return {
      jobId: job.id,
      basePlanVersion,
      proposals: proposals.map(
        (p): ProposalDTO => ({
          id: idOf.get(p.label)!,
          label: p.label,
          headline: p.headline,
          why: p.why,
          stops: p.stops,
          skipped: p.skipped,
          totals: p.totals,
          issues: p.issues,
          tradeoffs: p.tradeoffs,
        }),
      ),
      problems: result.problems,
      understood,
      ai: { used: model != null, model, notice },
      generatedAt: job.createdAt.toISOString(),
    };
  }
}

/** Applies what the model read from the note, keeping only ids and values Orbit offered. */
function applyNote(
  data: NoteOutput,
  ctx: {
    prefs: PlannerPreferences;
    chipsSetPace: boolean;
    known: Set<string>;
    window: PlanningWindow;
    budget: Money | null;
    currency: string | null;
    notUnderstood: string[];
  },
): { window: PlanningWindow; budget: Money | null } {
  const { prefs, known } = ctx;
  const valid = (ids: string[]) => [...new Set(ids)].filter((id) => known.has(id));
  prefs.mustIncludeKeys = valid(data.mustIncludeIds);
  prefs.avoidKeys = valid(data.avoidIds).filter((id) => !prefs.mustIncludeKeys.includes(id));
  prefs.endWithKey = known.has(data.endWithId) && !prefs.avoidKeys.includes(data.endWithId) ? data.endWithId : null;
  if (!ctx.chipsSetPace && data.pace !== 'UNSPECIFIED') prefs.pace = data.pace; // a tapped chip wins
  prefs.lessTravel ||= data.lessTravel;
  prefs.lowerCost ||= data.lowerCost;
  prefs.maxStops = data.maxStops > 0 ? data.maxStops : null;

  let window = ctx.window;
  const start = data.startTime ? parseClock(data.startTime) : null;
  const end = data.endTime ? parseClock(data.endTime) : null;
  if (start != null || end != null) {
    const s = start ?? (end != null && ctx.window.source === 'assumed' ? Math.max(0, end - ASSUMED_LENGTH_MIN) : ctx.window.startMin);
    let e = end ?? (ctx.window.source === 'assumed' ? s + ASSUMED_LENGTH_MIN : ctx.window.endMin);
    if (e <= s && end != null && end + 1440 > s) e = end + 1440; // "6 PM until 1 AM"
    // Models sometimes echo the plan's own window back; that isn't the note's doing.
    const unchanged = s === ctx.window.startMin && e === ctx.window.endMin;
    if (e > s && e <= 2880) window = unchanged ? ctx.window : { startMin: s, endMin: e, source: 'note' };
    else ctx.notUnderstood.push('that time window');
  }

  let budget: Money | null = null;
  if (data.budgetAmount > 0) {
    if (!ctx.currency) ctx.notUnderstood.push('a budget (set the plan’s budget currency first)');
    else {
      const amountMinor = toMinor(data.budgetAmount, ctx.currency);
      // Same as the plan's budget = echoed back, not asked for: keep it labeled "plan".
      if (amountMinor !== ctx.budget?.amountMinor) budget = { amountMinor, currency: ctx.currency };
    }
  }
  ctx.notUnderstood.push(...data.unsupported.map((s) => s.trim()).filter(Boolean));
  return { window, budget };
}
