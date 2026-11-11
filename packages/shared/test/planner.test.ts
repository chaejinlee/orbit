import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PREFERENCES,
  estimateTravelMinutes,
  planProposals,
  scheduleItinerary,
  travelEstimatorFor,
  type DraftStop,
  type PlannerCandidate,
  type PlannerInput,
  type PlannerPreferences,
} from '../src';

// Toronto: a few real places ~0.2–2.5 km apart.
const P = {
  cityHall: { lat: 43.6532, lng: -79.3832 },
  nathan: { lat: 43.6526, lng: -79.3838 }, // across the square
  eaton: { lat: 43.6544, lng: -79.3807 },
  cnTower: { lat: 43.6426, lng: -79.3871 },
  rom: { lat: 43.6677, lng: -79.3948 },
  kensington: { lat: 43.6547, lng: -79.4005 },
};

function cand(key: string, extra: Partial<PlannerCandidate> = {}): PlannerCandidate {
  return {
    key,
    ideaId: key,
    title: key,
    point: null,
    durationMin: 60,
    durationGuessed: false,
    costMinor: null,
    costCurrency: null,
    fixedStartMin: null,
    locked: false,
    stopId: null,
    interested: 0,
    notInterested: 0,
    shortlisted: false,
    ...extra,
  };
}

let idCounter = 0;
function plan(candidates: PlannerCandidate[], extra: Partial<Omit<PlannerInput, 'prefs'>> & { prefs?: Partial<PlannerPreferences> } = {}) {
  idCounter = 0;
  return planProposals({
    candidates,
    lockedOrder: extra.lockedOrder ?? candidates.filter((c) => c.locked).map((c) => c.key),
    window: extra.window ?? { startMin: 15 * 60, endMin: 21 * 60 },
    budget: extra.budget ?? null,
    prefs: { ...DEFAULT_PREFERENCES, ...extra.prefs },
    newId: () => `new-${++idCounter}`,
  });
}

const keysOf = (p: { stops: Array<{ ideaId: string | null }> }) => p.stops.map((s) => s.ideaId);

describe('estimateTravelMinutes', () => {
  it('is zero across the street and walks short hops', () => {
    expect(estimateTravelMinutes(P.cityHall, P.nathan)).toBe(0);
    expect(estimateTravelMinutes(P.cityHall, P.eaton)).toBe(5);
    expect(estimateTravelMinutes(P.cityHall, P.kensington)).toBeGreaterThanOrEqual(15);
  });

  it('takes a ride for longer distances and rounds up to 5 minutes', () => {
    const minutes = estimateTravelMinutes(P.cnTower, P.rom);
    expect(minutes % 5).toBe(0);
    expect(minutes).toBeGreaterThanOrEqual(15);
    expect(minutes).toBeLessThan(40);
  });
});

describe('scheduler travel estimates', () => {
  const stops: DraftStop[] = [
    { id: 'a', ideaId: 'cityHall', title: 'City Hall', position: 'a0', dayIndex: 0, durationMin: 60, fixedStartMin: null, locked: false, travelMinFromPrev: null, costMinor: null, costCurrency: null },
    { id: 'b', ideaId: 'rom', title: 'ROM', position: 'a1', dayIndex: 0, durationMin: 60, fixedStartMin: null, locked: false, travelMinFromPrev: null, costMinor: null, costCurrency: null },
    { id: 'c', ideaId: 'unknown', title: 'Somewhere', position: 'a2', dayIndex: 0, durationMin: 30, fixedStartMin: null, locked: false, travelMinFromPrev: null, costMinor: null, costCurrency: null },
  ];
  const estimator = travelEstimatorFor((id) => P[id as keyof typeof P] ?? null);

  it('uses coordinates when both places are known and the default otherwise', () => {
    const s = scheduleItinerary(stops, { dayStartMin: 600, estimateTravelMin: estimator });
    expect(s[1]!.travelMin).toBe(estimateTravelMinutes(P.cityHall, P.rom));
    expect(s[1]!.travelEstimated).toBe(true);
    expect(s[2]!.travelMin).toBe(15);
  });

  it('never overrides a travel time a person entered', () => {
    const timed = stops.map((x) => (x.id === 'b' ? { ...x, travelMinFromPrev: 42 } : x));
    const s = scheduleItinerary(timed, { dayStartMin: 600, estimateTravelMin: estimator });
    expect(s[1]!.travelMin).toBe(42);
    expect(s[1]!.travelEstimated).toBe(false);
  });
});

describe('planProposals', () => {
  it('returns up to three distinct, labeled options that all fit the window', () => {
    const result = plan([
      cand('gallery', { point: P.cityHall, durationMin: 90, costMinor: 3000, costCurrency: 'CAD', interested: 1 }),
      cand('coffee', { point: P.eaton, durationMin: 45, costMinor: 1500, costCurrency: 'CAD', interested: 2 }),
      cand('tower', { point: P.cnTower, durationMin: 120, costMinor: 9000, costCurrency: 'CAD', shortlisted: true }),
      cand('market', { point: P.kensington, durationMin: 60, costMinor: 0, costCurrency: 'CAD' }),
      cand('museum', { point: P.rom, durationMin: 120, costMinor: 5000, costCurrency: 'CAD', interested: 1 }),
      cand('dinner', { point: P.nathan, durationMin: 90, costMinor: 8000, costCurrency: 'CAD', interested: 2 }),
    ]);
    expect(result.proposals.map((p) => p.label)).toEqual(['BALANCED', 'BUDGET', 'EXPERIENCE']);
    const signatures = result.proposals.map((p) => keysOf(p).join('|'));
    expect(new Set(signatures).size).toBe(3);
    for (const p of result.proposals) {
      expect(p.totals.startMin).toBeGreaterThanOrEqual(15 * 60);
      expect(p.totals.endMin).toBeLessThanOrEqual(21 * 60);
      expect(p.issues.filter((i) => i.severity === 'error')).toEqual([]);
    }
    const [balanced, budget] = result.proposals;
    expect(budget!.totals.knownCostMinor).toBeLessThanOrEqual(balanced!.totals.knownCostMinor);
  });

  it('keeps pinned times exactly and never arrives late', () => {
    const result = plan([
      cand('dinner', { point: P.nathan, durationMin: 90, fixedStartMin: 19 * 60, interested: 2 }),
      cand('gallery', { point: P.rom, durationMin: 120, interested: 1 }),
      cand('walk', { point: P.kensington, durationMin: 60 }),
    ]);
    for (const p of result.proposals) {
      const dinner = p.stops.find((s) => s.ideaId === 'dinner');
      if (!dinner) continue;
      expect(dinner.startMin).toBe(19 * 60);
      expect(dinner.lateByMin).toBe(0);
    }
  });

  it('always includes locked stops in their locked order', () => {
    const result = plan(
      [
        cand('b', { locked: true, stopId: 'stop-b', point: P.rom }),
        cand('a', { locked: true, stopId: 'stop-a', point: P.cityHall }),
        cand('c', { point: P.eaton, interested: 3 }),
        cand('d', { point: P.cnTower, interested: 1 }),
      ],
      { lockedOrder: ['b', 'a'] },
    );
    expect(result.proposals.length).toBeGreaterThan(0);
    for (const p of result.proposals) {
      const order = keysOf(p);
      expect(order).toContain('a');
      expect(order).toContain('b');
      expect(order.indexOf('b')).toBeLessThan(order.indexOf('a'));
      // the existing draft stops keep their ids
      expect(p.stops.find((s) => s.ideaId === 'a')!.id).toBe('stop-a');
      expect(p.stops.find((s) => s.ideaId === 'b')!.locked).toBe(true);
    }
  });

  it('never exceeds the budget with known costs', () => {
    const result = plan(
      [
        cand('steak', { durationMin: 90, costMinor: 9000, costCurrency: 'CAD', interested: 3 }),
        cand('show', { durationMin: 120, costMinor: 6000, costCurrency: 'CAD', interested: 2 }),
        cand('park', { durationMin: 60, costMinor: 0, costCurrency: 'CAD' }),
        cand('tea', { durationMin: 45, costMinor: 2000, costCurrency: 'CAD' }),
      ],
      { budget: { amountMinor: 10_000, currency: 'CAD' } },
    );
    expect(result.proposals.length).toBeGreaterThan(0);
    for (const p of result.proposals) {
      expect(p.totals.knownCostMinor).toBeLessThanOrEqual(10_000);
      expect(p.issues.some((i) => i.code === 'BUDGET_EXCEEDED')).toBe(false);
    }
    const skippedSteak = result.proposals.flatMap((p) => p.skipped).find((s) => s.ideaId === 'show' || s.ideaId === 'steak');
    expect(skippedSteak?.reason).toBeTruthy();
  });

  it('honors “skip”, “must include” and “end with”', () => {
    const result = plan(
      [
        cand('bar', { point: P.eaton, interested: 3 }),
        cand('museum', { point: P.rom, durationMin: 90 }),
        cand('dessert', { point: P.nathan, durationMin: 30 }),
        cand('arcade', { point: P.cnTower, interested: 1 }),
      ],
      { prefs: { avoidKeys: ['bar'], mustIncludeKeys: ['museum'], endWithKey: 'dessert' } },
    );
    for (const p of result.proposals) {
      const order = keysOf(p);
      expect(order).not.toContain('bar');
      expect(order).toContain('museum');
      expect(order.at(-1)).toBe('dessert');
      expect(p.skipped.find((s) => s.ideaId === 'bar')?.reason).toBe('You asked to skip it');
    }
  });

  it('plans a lighter day for a relaxed pace than for a packed one', () => {
    const ideas = ['a', 'b', 'c', 'd', 'e', 'f'].map((k, i) => cand(k, { durationMin: 45, point: Object.values(P)[i]! }));
    const relaxed = plan(ideas, { prefs: { pace: 'RELAXED' } }).proposals.find((p) => p.label === 'BALANCED')!;
    const packed = plan(ideas, { prefs: { pace: 'PACKED' } }).proposals.find((p) => p.label === 'BALANCED')!;
    expect(relaxed.totals.stopCount).toBeLessThan(packed.totals.stopCount);
  });

  it('leaves out ideas most people are not interested in', () => {
    const result = plan([cand('liked', { interested: 2 }), cand('disliked', { notInterested: 3 }), cand('neutral')]);
    const balanced = result.proposals.find((p) => p.label === 'BALANCED')!;
    expect(keysOf(balanced)).not.toContain('disliked');
    expect(balanced.skipped.find((s) => s.ideaId === 'disliked')?.reason).toBe('3 not interested');
  });

  it('explains instead of guessing when locked stops cannot fit', () => {
    const result = plan([cand('late-show', { locked: true, fixedStartMin: 22 * 60, durationMin: 120 }), cand('coffee')]);
    expect(result.proposals).toEqual([]);
    expect(result.problems[0]).toMatch(/locked/);
  });

  it('produces times the shared draft will reproduce exactly', () => {
    const points = { a: P.cityHall, b: P.rom, c: P.kensington, d: P.cnTower };
    const result = plan(Object.entries(points).map(([k, point]) => cand(k, { point, interested: 1 })));
    const estimator = travelEstimatorFor((id) => points[id as keyof typeof points] ?? null);
    for (const p of result.proposals) {
      const replay = scheduleItinerary(p.stops, { dayStartMin: 15 * 60, estimateTravelMin: estimator });
      expect(replay.map((s) => s.startMin)).toEqual(p.stops.map((s) => s.startMin));
      expect(p.stops.every((s) => s.travelMinFromPrev === null)).toBe(true);
    }
  });

  it('is deterministic for the same input', () => {
    const ideas = [cand('x', { point: P.eaton, interested: 1 }), cand('y', { point: P.rom }), cand('z', { point: P.cnTower, shortlisted: true })];
    expect(plan(ideas)).toEqual(plan(ideas));
  });
});
