import { describe, expect, it } from 'vitest';
import {
  blockingIssues,
  diffItinerary,
  scheduleItinerary,
  validateItinerary,
  type DraftStop,
  type StopSnapshot,
} from '../src';

let n = 0;
function stop(partial: Partial<DraftStop> & { title: string }): DraftStop {
  n += 1;
  return {
    id: `s${n}`,
    ideaId: `idea-${partial.title}`,
    position: `a${n}`,
    dayIndex: 0,
    durationMin: 60,
    fixedStartMin: null,
    locked: false,
    travelMinFromPrev: 15,
    costMinor: null,
    costCurrency: null,
    ...partial,
  };
}

describe('scheduleItinerary', () => {
  it('chains start(B) = end(A) + travel(A→B) from the plan start', () => {
    const s = scheduleItinerary(
      [stop({ title: 'Coffee', position: 'a0' }), stop({ title: 'Museum', position: 'a1', durationMin: 90, travelMinFromPrev: 20 })],
      { dayStartMin: 15 * 60 },
    );
    expect(s.map((x) => [x.title, x.startMin, x.endMin])).toEqual([
      ['Coffee', 900, 960],
      ['Museum', 980, 1070],
    ]);
  });

  it('back-schedules from a fixed reservation when the plan has no start time', () => {
    const s = scheduleItinerary(
      [
        stop({ title: 'Coffee', position: 'a0', durationMin: 60 }),
        stop({ title: 'Dinner', position: 'a1', fixedStartMin: 19 * 60, travelMinFromPrev: 15 }),
      ],
      { dayStartMin: null },
    );
    expect(s[0]?.startMin).toBe(17 * 60 + 45);
    expect(s[1]?.startMin).toBe(19 * 60);
    expect(s[1]?.lateByMin).toBe(0);
  });

  it('leaves times unknown rather than inventing them', () => {
    const s = scheduleItinerary([stop({ title: 'Picnic' })], { dayStartMin: null });
    expect(s[0]?.startMin).toBeNull();
    expect(validateItinerary(s, { window: { startMin: null, endMin: null }, budget: null }).map((i) => i.code)).toEqual([
      'NO_START_TIME',
    ]);
  });

  it('labels default travel time as an estimate', () => {
    const s = scheduleItinerary(
      [stop({ title: 'A', position: 'a0' }), stop({ title: 'B', position: 'a1', travelMinFromPrev: null })],
      { dayStartMin: 600 },
    );
    expect(s[1]).toMatchObject({ travelMin: 15, travelEstimated: true });
  });

  it('orders by day, then position, then id (deterministic ties)', () => {
    const s = scheduleItinerary(
      [
        stop({ id: 'z', title: 'Day1-late', dayIndex: 1, position: 'a0' }),
        stop({ id: 'b', title: 'tie-b', position: 'a5' }),
        stop({ id: 'a', title: 'tie-a', position: 'a5' }),
      ],
      { dayStartMin: 600 },
    );
    expect(s.map((x) => [x.title, x.sequence])).toEqual([
      ['tie-a', 0],
      ['tie-b', 1],
      ['Day1-late', 0],
    ]);
  });
});

describe('validateItinerary (hard constraints)', () => {
  const window = { startMin: 15 * 60, endMin: 21 * 60 };

  it('flags a fixed-time stop that the previous stop makes impossible', () => {
    const s = scheduleItinerary(
      [
        stop({ title: 'Museum', position: 'a0', durationMin: 180 }),
        stop({ title: 'Dinner', position: 'a1', fixedStartMin: 17 * 60 + 30 }),
      ],
      { dayStartMin: window.startMin },
    );
    const issues = validateItinerary(s, { window, budget: null });
    expect(issues).toContainEqual(expect.objectContaining({ code: 'LATE_FOR_FIXED_TIME', severity: 'error' }));
    expect(issues.find((i) => i.code === 'LATE_FOR_FIXED_TIME')?.message).toContain('45m too late');
  });

  it('flags stops that run past the plan end', () => {
    const s = scheduleItinerary([stop({ title: 'Late show', fixedStartMin: 20 * 60, durationMin: 120 })], {
      dayStartMin: window.startMin,
    });
    expect(validateItinerary(s, { window, budget: null }).map((i) => i.code)).toContain('ENDS_AFTER_WINDOW');
  });

  it('checks the budget and says when the check is incomplete', () => {
    const s = scheduleItinerary(
      [
        stop({ title: 'Dinner', costMinor: 9000, costCurrency: 'CAD' }),
        stop({ title: 'Dessert', costMinor: 4000, costCurrency: 'CAD' }),
        stop({ title: 'Walk' }),
      ],
      { dayStartMin: window.startMin },
    );
    const issues = validateItinerary(s, { window: { startMin: null, endMin: null }, budget: { amountMinor: 12000, currency: 'CAD' } });
    expect(issues.map((i) => i.code)).toEqual(['BUDGET_EXCEEDED', 'COSTS_INCOMPLETE']);
  });

  it('only lets errors through when explicitly accepted', () => {
    const issues = validateItinerary([], { window, budget: null });
    expect(blockingIssues(issues)).toHaveLength(1);
    expect(blockingIssues(issues, ['EMPTY_ITINERARY'])).toHaveLength(0);
  });
});

describe('diffItinerary', () => {
  const snap = (key: string, sequence: number, startMin: number | null = null, durationMin = 60): StopSnapshot => ({
    key,
    title: key,
    dayIndex: 0,
    sequence,
    startMin,
    durationMin,
  });

  it('reports an insertion without marking later stops as moved', () => {
    const changes = diffItinerary([snap('a', 0), snap('b', 1), snap('c', 2)], [snap('a', 0), snap('x', 1), snap('b', 2), snap('c', 3)]);
    expect(changes.map((c) => `${c.type}:${c.stop.key}`)).toEqual(['added:x']);
  });

  it('reports only the stop that actually moved', () => {
    const changes = diffItinerary(
      [snap('a', 0), snap('b', 1), snap('c', 2), snap('d', 3)],
      [snap('a', 0), snap('c', 1), snap('d', 2), snap('b', 3)],
    );
    expect(changes.map((c) => `${c.type}:${c.stop.key}`)).toEqual(['moved:b']);
  });

  it('reports removals, retimes and duration changes', () => {
    const changes = diffItinerary([snap('a', 0, 900), snap('b', 1, 1000)], [snap('a', 0, 945, 90)]);
    expect(changes.map((c) => c.type).sort()).toEqual(['removed', 'resized', 'retimed']);
  });
});
