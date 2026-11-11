/** A stop in the shared itinerary draft (lives in the plan's Yjs document). */
export interface DraftStop {
  /** Stable across commits, so versions can be diffed stop by stop. */
  id: string;
  /** The idea this stop came from ("drag to plan" references, never copies). */
  ideaId: string | null;
  title: string;
  /** Fractional index within the day. */
  position: string;
  dayIndex: number;
  durationMin: number;
  /** User-pinned start, e.g. a 7 PM reservation. */
  fixedStartMin: number | null;
  /** Kept as-is by "Lock & Regenerate" and Smart Plan B. */
  locked: boolean;
  /** Travel time from the previous stop. Null = default estimate until routing exists. */
  travelMinFromPrev: number | null;
  /** Estimated cost for the whole group, in minor units. */
  costMinor: number | null;
  costCurrency: string | null;
}

export interface ScheduledStop extends DraftStop {
  /** 0-based order within its day. */
  sequence: number;
  startMin: number | null;
  endMin: number | null;
  /** Travel minutes used before this stop (0 for the first stop of a day). */
  travelMin: number;
  /** True when travelMin is the default estimate, not a user/routing value. */
  travelEstimated: boolean;
  /** Free time spent waiting for a fixed start. */
  idleBeforeMin: number;
  /** > 0 when the previous stop makes this fixed start impossible. */
  lateByMin: number;
}
