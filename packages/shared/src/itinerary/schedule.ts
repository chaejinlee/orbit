import { compareByPosition } from '../ordering';
import type { DraftStop, ScheduledStop } from './types';

/** Placeholder travel time until the routing service exists. Always labeled "est." */
export const DEFAULT_TRAVEL_MIN = 15;

export interface ScheduleOptions {
  /** The plan's daily start. Null when the user has not set one. */
  dayStartMin: number | null;
  defaultTravelMin?: number;
  /**
   * Estimate for a leg the user hasn't timed (e.g. from the two places'
   * coordinates). Null falls back to `defaultTravelMin`. The browser and the
   * API must pass the same estimator so they compute the same schedule.
   */
  estimateTravelMin?: (from: DraftStop, to: DraftStop) => number | null;
}

export function orderStops<T extends DraftStop>(stops: readonly T[]): T[] {
  return [...stops].sort((a, b) => a.dayIndex - b.dayIndex || compareByPosition(a, b));
}

/**
 * Assigns clock times to one day's ordered stops, enforcing
 *   start(B) ≥ start(A) + duration(A) + travel(A→B).
 *
 * The anchor is the plan's start time; without one we back-schedule from the
 * first fixed-time stop ("dinner at 7, coffee before it"). With neither, times
 * stay unknown instead of being invented.
 */
export function scheduleDay(stops: readonly DraftStop[], options: ScheduleOptions): ScheduledStop[] {
  const defaultTravel = options.defaultTravelMin ?? DEFAULT_TRAVEL_MIN;
  const estimate = options.estimateTravelMin;
  const travelOf = (i: number) =>
    i === 0
      ? 0
      : (stops[i]!.travelMinFromPrev ?? (estimate ? estimate(stops[i - 1]!, stops[i]!) : null) ?? defaultTravel);

  let anchor = options.dayStartMin;
  if (anchor == null) {
    const k = stops.findIndex((s) => s.fixedStartMin != null);
    if (k >= 0) {
      let t = stops[k]!.fixedStartMin!;
      for (let i = k - 1; i >= 0; i -= 1) t -= travelOf(i + 1) + stops[i]!.durationMin;
      anchor = Math.max(0, t);
    }
  }

  let cursor = anchor;
  return stops.map((stop, i) => {
    const travelMin = travelOf(i);
    const travelEstimated = i > 0 && stop.travelMinFromPrev == null;
    const base = { ...stop, sequence: i, travelMin, travelEstimated };
    if (cursor == null) {
      return { ...base, startMin: null, endMin: null, idleBeforeMin: 0, lateByMin: 0 };
    }
    const earliest = i === 0 ? cursor : cursor + travelMin;
    let startMin = earliest;
    let idleBeforeMin = 0;
    let lateByMin = 0;
    if (stop.fixedStartMin != null) {
      if (stop.fixedStartMin >= earliest) idleBeforeMin = stop.fixedStartMin - earliest;
      else lateByMin = earliest - stop.fixedStartMin;
      startMin = stop.fixedStartMin;
    }
    const endMin = startMin + stop.durationMin;
    cursor = endMin;
    return { ...base, startMin, endMin, idleBeforeMin, lateByMin };
  });
}

/** Orders all stops and schedules each day with the same daily window. */
export function scheduleItinerary(stops: readonly DraftStop[], options: ScheduleOptions): ScheduledStop[] {
  const ordered = orderStops(stops);
  const days = new Map<number, DraftStop[]>();
  for (const stop of ordered) {
    const day = days.get(stop.dayIndex) ?? [];
    day.push(stop);
    days.set(stop.dayIndex, day);
  }
  return [...days.keys()]
    .sort((a, b) => a - b)
    .flatMap((day) => scheduleDay(days.get(day)!, options));
}
