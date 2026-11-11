import { DEFAULT_TRAVEL_MIN, scheduleDay } from '../itinerary/schedule';
import type { DraftStop, ScheduledStop } from '../itinerary/types';
import { validateItinerary, type ItineraryIssue } from '../itinerary/validate';
import { formatMoney, summarizeCosts, type Money } from '../money';
import { keysBetween } from '../ordering';
import { randomId } from '../net';
import { formatClock, formatDuration } from '../time';
import { estimateTravelMinutes, type LatLng } from './travel';

/*
 * The deterministic planner behind "Make 3 options" (spec I02).
 *
 * It never asks an LLM for a schedule. It searches every combination and order
 * of the plan's ideas (dynamic programming over subsets, which is exact for the
 * ~13 candidates a plan realistically has) and keeps only schedules that meet
 * the hard constraints: the time window, pinned times, locked stops and the
 * budget. Three objective profiles then pick the Balanced, Budget and
 * Experience options. An LLM may later reword the headlines, never the plan.
 */

/** Display order. Balanced is the recommendation. */
export const PROPOSAL_LABELS = ['BALANCED', 'BUDGET', 'EXPERIENCE'] as const;
export type ProposalLabelName = (typeof PROPOSAL_LABELS)[number];

export const PACES = ['RELAXED', 'NORMAL', 'PACKED'] as const;
export type Pace = (typeof PACES)[number];

export interface PlannerPreferences {
  pace: Pace;
  lessTravel: boolean;
  lowerCost: boolean;
  /** Candidate keys that must be in every option (if they can fit at all). */
  mustIncludeKeys: string[];
  avoidKeys: string[];
  /** Soft wish: finish with this stop ("end with dessert"). */
  endWithKey: string | null;
  maxStops: number | null;
}

export const DEFAULT_PREFERENCES: PlannerPreferences = {
  pace: 'NORMAL',
  lessTravel: false,
  lowerCost: false,
  mustIncludeKeys: [],
  avoidKeys: [],
  endWithKey: null,
  maxStops: null,
};

export interface PlannerCandidate {
  /** The idea id, or `stop:<id>` for a locked stop that has no idea. */
  key: string;
  ideaId: string | null;
  title: string;
  point: LatLng | null;
  durationMin: number;
  /** True when the duration is a default, not something a person entered. */
  durationGuessed: boolean;
  costMinor: number | null;
  costCurrency: string | null;
  fixedStartMin: number | null;
  locked: boolean;
  /** The draft stop to reuse (keeps its id) when the idea is already in the draft. */
  stopId: string | null;
  interested: number;
  notInterested: number;
  shortlisted: boolean;
}

export interface PlannerInput {
  candidates: PlannerCandidate[];
  /** Keys of locked stops in their current draft order; options keep that order. */
  lockedOrder: string[];
  window: { startMin: number; endMin: number };
  budget: Money | null;
  prefs: PlannerPreferences;
  /** Id factory for new stops (injectable for deterministic tests). */
  newId?: () => string;
}

export interface PlannedStop extends ScheduledStop {
  reasons: string[];
}

export interface SkippedIdea {
  key: string;
  ideaId: string | null;
  title: string;
  reason: string;
}

export interface ProposalTotals {
  startMin: number | null;
  endMin: number | null;
  travelMin: number;
  idleMin: number;
  stopCount: number;
  currency: string | null;
  knownCostMinor: number;
  unknownCostCount: number;
}

export interface PlannedProposal {
  label: ProposalLabelName;
  stops: PlannedStop[];
  skipped: SkippedIdea[];
  totals: ProposalTotals;
  issues: ItineraryIssue[];
  /** Plain-language default; an LLM may replace it with a friendlier one. */
  headline: string;
  /** Differences from the Balanced option. */
  tradeoffs: string[];
}

export interface PlannerResult {
  proposals: PlannedProposal[];
  /** Things the planner could not honor (shown to the user, never hidden). */
  problems: string[];
}

export const MAX_PLANNER_CANDIDATES = 13;
const HARD_CAP = 16;

const PACE_STOP_PENALTY: Record<Pace, number> = { RELAXED: 0.8, NORMAL: 0.1, PACKED: -0.25 };

/** How much the group wants this idea, from reactions and the shortlist. */
export function candidateAppeal(c: Pick<PlannerCandidate, 'interested' | 'notInterested' | 'shortlisted'>): number {
  return c.interested - 1.2 * c.notInterested + (c.shortlisted ? 1.5 : 0);
}

function popcount(x: number): number {
  let n = 0;
  for (let v = x; v; v &= v - 1) n += 1;
  return n;
}

interface Scored {
  mask: number;
  last: number;
  endMin: number;
  score: number;
}

export function planProposals(input: PlannerInput): PlannerResult {
  const { window, budget, prefs } = input;
  const newId = input.newId ?? randomId;
  const problems: string[] = [];
  const avoid = new Set(prefs.avoidKeys);
  // "End with dessert" also means "include dessert".
  const must = new Set([...prefs.mustIncludeKeys, ...(prefs.endWithKey ? [prefs.endWithKey] : [])]);

  // ── 1. Pick the candidates worth searching ────────────────────────────────
  const avoided = input.candidates.filter((c) => !c.locked && avoid.has(c.key));
  const pool = input.candidates.filter((c) => c.locked || !avoid.has(c.key));
  const fitsAlone = (c: PlannerCandidate) => {
    const start = c.fixedStartMin ?? window.startMin;
    return c.durationMin > 0 && start >= window.startMin && start + c.durationMin <= window.endMin;
  };
  const impossible = pool.filter((c) => !fitsAlone(c));
  for (const c of impossible) {
    if (c.locked) problems.push(`“${c.title}” is locked but doesn’t fit between ${formatClock(window.startMin)} and ${formatClock(window.endMin)}.`);
    else if (must.has(c.key)) problems.push(`“${c.title}” doesn’t fit between ${formatClock(window.startMin)} and ${formatClock(window.endMin)}.`);
  }
  if (impossible.some((c) => c.locked)) return { proposals: [], problems };

  const feasible = pool.filter(fitsAlone);
  const required = feasible.filter((c) => c.locked || must.has(c.key));
  const optional = feasible
    .filter((c) => !c.locked && !must.has(c.key))
    .sort(
      (a, b) =>
        candidateAppeal(b) - candidateAppeal(a) ||
        Number(!!b.point) - Number(!!a.point) ||
        a.durationMin - b.durationMin ||
        a.title.localeCompare(b.title),
    );
  if (required.length > HARD_CAP) {
    problems.push(`Only the first ${HARD_CAP} required stops were considered.`);
  }
  const cands = [...required.slice(0, HARD_CAP), ...optional].slice(0, Math.max(MAX_PLANNER_CANDIDATES, Math.min(required.length, HARD_CAP)));
  const leftOut = [
    ...feasible.filter((c) => !cands.includes(c)).map((c) => ({ c, reason: 'Lower priority' })),
    ...impossible.map((c) => ({ c, reason: 'Doesn’t fit the plan’s time' })),
  ];
  const n = cands.length;
  if (n === 0) {
    return { proposals: [], problems: problems.length ? problems : ['Add a few ideas to the board first.'] };
  }

  // ── 2. Precompute travel, costs and ordering constraints ──────────────────
  const travel = cands.map((a) => cands.map((b) => (a === b ? 0 : a.point && b.point ? estimateTravelMinutes(a.point, b.point) : DEFAULT_TRAVEL_MIN)));
  const currency = budget?.currency ?? dominantCurrency(cands);
  const costIn = cands.map((c) => (c.costMinor != null && c.costCurrency != null && c.costCurrency === currency ? c.costMinor : null));
  const knownCosts = costIn.filter((v): v is number => v != null);
  const costScale = Math.max(1, budget?.amountMinor ?? knownCosts.reduce((s, v) => s + v, 0) / 2);
  let unknownBits = 0;
  costIn.forEach((v, i) => {
    if (v == null) unknownBits |= 1 << i;
  });

  const indexOfKey = new Map(cands.map((c, i) => [c.key, i]));
  const lockedIdx = input.lockedOrder.map((k) => indexOfKey.get(k)).filter((i): i is number => i !== undefined);
  const prereq = new Int32Array(n);
  let lockedMask = 0;
  lockedIdx.forEach((i) => {
    prereq[i] = lockedMask; // every earlier locked stop must come first
    lockedMask |= 1 << i;
  });
  cands.forEach((c, i) => {
    if (c.locked) lockedMask |= 1 << i;
  });
  let requiredMask = lockedMask;
  cands.forEach((c, i) => {
    if (must.has(c.key)) requiredMask |= 1 << i;
  });
  const maxStops = prefs.maxStops != null ? Math.max(prefs.maxStops, popcount(lockedMask)) : n;

  const N = 1 << n;
  const maskCost = new Float64Array(N);
  for (let m = 1; m < N; m += 1) {
    const low = m & -m;
    const i = 31 - Math.clz32(low);
    maskCost[m] = maskCost[m ^ low]! + (costIn[i] ?? 0);
  }
  const overBudget = (m: number) => budget != null && maskCost[m]! > budget.amountMinor;

  // ── 3. Earliest finish for every (set of stops, last stop) ────────────────
  const end = new Float64Array(N * n).fill(Number.POSITIVE_INFINITY);
  const parent = new Int8Array(N * n).fill(-1);
  for (let i = 0; i < n; i += 1) {
    if (prereq[i] !== 0) continue;
    const c = cands[i]!;
    const start = c.fixedStartMin ?? window.startMin;
    const finish = start + c.durationMin;
    if (finish <= window.endMin && !overBudget(1 << i)) end[(1 << i) * n + i] = finish;
  }
  for (let mask = 1; mask < N; mask += 1) {
    if (popcount(mask) >= maxStops) continue;
    for (let last = 0; last < n; last += 1) {
      if (!(mask & (1 << last))) continue;
      const at = end[mask * n + last]!;
      if (at === Number.POSITIVE_INFINITY) continue;
      for (let j = 0; j < n; j += 1) {
        const bit = 1 << j;
        if (mask & bit || (prereq[j]! & mask) !== prereq[j]) continue;
        const next = mask | bit;
        if (overBudget(next)) continue;
        const c = cands[j]!;
        const arrive = at + travel[last]![j]!;
        let start = arrive;
        if (c.fixedStartMin != null) {
          if (arrive > c.fixedStartMin) continue;
          start = c.fixedStartMin;
        }
        const finish = start + c.durationMin;
        if (finish > window.endMin) continue;
        const k = next * n + j;
        if (finish < end[k]!) {
          end[k] = finish;
          parent[k] = last;
        }
      }
    }
  }

  // ── 4. Score complete options under each profile ──────────────────────────
  const endWith = prefs.endWithKey != null ? (indexOfKey.get(prefs.endWithKey) ?? -1) : -1;
  const options: Array<{ mask: number; last: number; endMin: number }> = [];
  const collect = (target: number) => {
    options.length = 0;
    for (let mask = 1; mask < N; mask += 1) {
      if ((mask & target) !== target) continue;
      let best = -1;
      for (let last = 0; last < n; last += 1) {
        const v = end[mask * n + last]!;
        if (v !== Number.POSITIVE_INFINITY && (best < 0 || v < end[mask * n + best]!)) best = last;
      }
      if (best < 0) continue;
      // When the wished-for last stop is in this set and can go last, it does.
      if (endWith >= 0 && best !== endWith && mask & (1 << endWith) && end[mask * n + endWith] !== Number.POSITIVE_INFINITY) {
        best = endWith;
      }
      options.push({ mask, last: best, endMin: end[mask * n + best]! });
    }
  };
  collect(requiredMask);
  if (options.length === 0 && requiredMask !== lockedMask) {
    const missing = cands.filter((c, i) => !c.locked && requiredMask & (1 << i)).map((c) => `“${c.title}”`);
    problems.push(`Couldn’t fit ${missing.join(' and ')} together with everything else, so ${missing.length === 1 ? 'it’s' : 'they’re'} optional in these options.`);
    collect(lockedMask);
  }
  if (options.length === 0) {
    problems.push(
      lockedMask
        ? 'Your locked stops don’t fit together inside the plan’s time and budget.'
        : 'Nothing fits inside the plan’s time and budget. Try a longer window or a bigger budget.',
    );
    return { proposals: [], problems };
  }

  const stopPenalty = PACE_STOP_PENALTY[prefs.pace];
  const travelWeight = 0.025 + (prefs.lessTravel ? 0.05 : 0);
  const costWeight = prefs.lowerCost ? 0.8 : 0.15;
  const scoreOf = (label: ProposalLabelName, o: { mask: number; last: number; endMin: number }): number => {
    let appeal = 0;
    let liked = 0;
    let durations = 0;
    for (let i = 0; i < n; i += 1) {
      if (!(o.mask & (1 << i))) continue;
      const a = candidateAppeal(cands[i]!);
      appeal += 1 + a;
      if (a > 0) liked += 1;
      durations += cands[i]!.durationMin;
    }
    const count = popcount(o.mask);
    const slack = o.endMin - window.startMin - durations; // travel + waiting
    const costRatio = maskCost[o.mask]! / costScale;
    const unknown = popcount(o.mask & unknownBits);
    let s = 0;
    switch (label) {
      case 'BALANCED':
        s = appeal - travelWeight * slack - stopPenalty * count - costWeight * costRatio;
        break;
      case 'BUDGET':
        s = 0.8 * appeal - travelWeight * slack - stopPenalty * count - (2.5 + costWeight) * costRatio - 0.35 * unknown;
        break;
      case 'EXPERIENCE':
        s = appeal + 0.6 * liked - 0.5 * travelWeight * slack - (stopPenalty - 0.15) * count - 0.05 * costRatio;
        break;
    }
    if (endWith >= 0 && o.mask & (1 << endWith)) s += o.last === endWith ? 1 : -0.5;
    return s;
  };

  const pathOf = (mask: number, last: number): number[] => {
    const order: number[] = [];
    let m = mask;
    let l = last;
    while (l !== -1) {
      order.push(l);
      const p = parent[m * n + l]!;
      m &= ~(1 << l);
      l = p;
    }
    return order.reverse();
  };

  const chosen: Array<{ label: ProposalLabelName; order: number[] }> = [];
  const signatures = new Set<string>();
  for (const label of ['BALANCED', 'EXPERIENCE', 'BUDGET'] as const) {
    const ranked: Scored[] = options.map((o) => ({ ...o, score: scoreOf(label, o) })).sort((a, b) => b.score - a.score || a.endMin - b.endMin || a.mask - b.mask);
    for (const r of ranked) {
      const order = pathOf(r.mask, r.last);
      const signature = order.map((i) => cands[i]!.key).join('|');
      if (signatures.has(signature)) continue;
      signatures.add(signature);
      chosen.push({ label, order });
      break;
    }
  }

  if (endWith >= 0 && !chosen.some(({ order }) => order.at(-1) === endWith)) {
    const c = cands[endWith]!;
    const included = chosen.some(({ order }) => order.includes(endWith));
    problems.push(
      included
        ? `Couldn’t finish with “${c.title}”: after the other stops it would run past ${formatClock(window.endMin)}, so it comes earlier.`
        : `Couldn’t fit “${c.title}” before ${formatClock(window.endMin)}.`,
    );
  }

  // ── 5. Turn each option into draft stops with times, reasons and checks ───
  const built = chosen.map(({ label, order }) =>
    buildProposal({ label, order, cands, travel, input, newId, must, avoided, leftOut, currency, costIn }),
  );
  const base = built.find((p) => p.label === 'BALANCED');
  for (const p of built) {
    p.tradeoffs = base && p !== base ? tradeoffsVersus(p, base) : [];
    p.headline = defaultHeadline(p);
  }
  built.sort((a, b) => PROPOSAL_LABELS.indexOf(a.label) - PROPOSAL_LABELS.indexOf(b.label));
  return { proposals: built, problems };
}

function dominantCurrency(cands: readonly PlannerCandidate[]): string | null {
  const counts = new Map<string, number>();
  for (const c of cands) if (c.costCurrency && c.costMinor != null) counts.set(c.costCurrency, (counts.get(c.costCurrency) ?? 0) + 1);
  let best: string | null = null;
  for (const [cur, count] of counts) if (best == null || count > counts.get(best)!) best = cur;
  return best;
}

function buildProposal(args: {
  label: ProposalLabelName;
  order: number[];
  cands: PlannerCandidate[];
  travel: number[][];
  input: PlannerInput;
  newId: () => string;
  must: Set<string>;
  avoided: PlannerCandidate[];
  leftOut: Array<{ c: PlannerCandidate; reason: string }>;
  currency: string | null;
  costIn: Array<number | null>;
}): PlannedProposal {
  const { label, order, cands, travel, input, newId, must } = args;
  const positions = keysBetween(null, null, order.length);
  const indexOfStop = new Map<string, number>();
  const drafts: DraftStop[] = order.map((i, k) => {
    const c = cands[i]!;
    const id = c.stopId ?? newId();
    indexOfStop.set(id, i);
    return {
      id,
      ideaId: c.ideaId,
      title: c.title,
      position: positions[k]!,
      dayIndex: 0,
      durationMin: c.durationMin,
      fixedStartMin: c.fixedStartMin,
      locked: c.locked,
      travelMinFromPrev: null, // estimated, so it stays labeled "est." in the draft
      costMinor: c.costMinor,
      costCurrency: c.costCurrency,
    };
  });
  const scheduled = scheduleDay(drafts, {
    dayStartMin: input.window.startMin,
    estimateTravelMin: (from, to) => travel[indexOfStop.get(from.id)!]![indexOfStop.get(to.id)!]!,
  });
  const issues = validateItinerary(scheduled, { window: input.window, budget: input.budget });

  const stops: PlannedStop[] = scheduled.map((s, k) => {
    const c = cands[order[k]!]!;
    const prev = k > 0 ? cands[order[k - 1]!]! : null;
    const reasons: string[] = [];
    if (c.locked) reasons.push('Locked');
    if (c.fixedStartMin != null) reasons.push(`Pinned at ${formatClock(c.fixedStartMin)}`);
    if (must.has(c.key)) reasons.push('You asked for it');
    if (c.shortlisted) reasons.push('Shortlisted');
    if (c.interested > 0) reasons.push(`${c.interested} interested`);
    if (input.prefs.endWithKey === c.key && k === scheduled.length - 1) reasons.push('Saved for last');
    if (c.costMinor === 0) reasons.push('Free');
    if (prev?.point && c.point && s.travelMin <= 10) {
      reasons.push(s.travelMin === 0 ? 'Right next door' : `${s.travelMin} min from the last stop`);
    }
    const shown = reasons.slice(0, 3);
    if (c.durationGuessed) shown.push(`${formatDuration(c.durationMin)} is a guess`);
    return { ...s, reasons: shown };
  });

  const costs = summarizeCosts(stops, input.budget?.currency ?? args.currency);
  const totals: ProposalTotals = {
    startMin: stops[0]?.startMin ?? null,
    endMin: stops.at(-1)?.endMin ?? null,
    travelMin: stops.reduce((sum, s) => sum + s.travelMin, 0),
    idleMin: stops.reduce((sum, s) => sum + s.idleBeforeMin, 0),
    stopCount: stops.length,
    currency: costs.currency,
    knownCostMinor: costs.knownTotalMinor,
    unknownCostCount: costs.unknownCount,
  };

  const inPlan = new Set(order.map((i) => cands[i]!.key));
  const freeAtEnd = input.window.endMin - (totals.endMin ?? input.window.startMin);
  const skipped: SkippedIdea[] = [
    ...args.avoided.map((c) => ({ key: c.key, ideaId: c.ideaId, title: c.title, reason: 'You asked to skip it' })),
    ...cands
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => !inPlan.has(c.key))
      .map(({ c, i }) => {
        const cost = args.costIn[i];
        let reason: string;
        if (c.notInterested > c.interested) reason = `${c.notInterested} not interested`;
        else if (input.budget && cost != null && totals.knownCostMinor + cost > input.budget.amountMinor) reason = 'Would go over budget';
        else if (c.durationMin > freeAtEnd) reason = 'Didn’t fit the time';
        else if (label === 'BUDGET' && (cost ?? 0) > 0) reason = 'Left out to save money';
        else if (input.prefs.pace === 'RELAXED') reason = 'Left out for a lighter day';
        else reason = 'Lower priority';
        return { key: c.key, ideaId: c.ideaId, title: c.title, reason };
      }),
    ...args.leftOut.map(({ c, reason }) => ({ key: c.key, ideaId: c.ideaId, title: c.title, reason })),
  ];

  return { label, stops, skipped, totals, issues, headline: '', tradeoffs: [] };
}

function tradeoffsVersus(p: PlannedProposal, base: PlannedProposal): string[] {
  const out: string[] = [];
  const dStops = p.totals.stopCount - base.totals.stopCount;
  if (dStops > 0) out.push(`${dStops} more ${dStops === 1 ? 'stop' : 'stops'}`);
  if (dStops < 0) out.push(`${-dStops} fewer ${-dStops === 1 ? 'stop' : 'stops'}`);
  if (p.totals.currency && p.totals.currency === base.totals.currency) {
    const dCost = p.totals.knownCostMinor - base.totals.knownCostMinor;
    const amount = (v: number) => formatMoney({ amountMinor: v, currency: p.totals.currency! });
    if (dCost < 0) out.push(`${amount(-dCost)} cheaper`);
    if (dCost > 0) out.push(`${amount(dCost)} more`);
  }
  const dTravel = p.totals.travelMin - base.totals.travelMin;
  if (dTravel <= -10) out.push(`${formatDuration(-dTravel)} less travel`);
  if (dTravel >= 10) out.push(`${formatDuration(dTravel)} more travel`);
  if (p.totals.endMin != null && base.totals.endMin != null) {
    const dEnd = p.totals.endMin - base.totals.endMin;
    if (dEnd <= -30) out.push(`Ends ${formatDuration(-dEnd)} earlier`);
    if (dEnd >= 30) out.push(`Ends ${formatDuration(dEnd)} later`);
  }
  return out;
}

function defaultHeadline(p: PlannedProposal): string {
  if (p.label === 'BUDGET') {
    const saving = p.tradeoffs.find((t) => t.endsWith('cheaper'));
    return saving ? `Spends less: ${saving}` : 'Keeps spending low';
  }
  return p.label === 'BALANCED' ? 'The best mix of what your group liked' : 'Fits in the most of what people want';
}
