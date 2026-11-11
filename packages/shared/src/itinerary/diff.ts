// "What changes if I confirm this?" — the summary shown before every commit
// and when comparing versions.

export interface StopSnapshot {
  key: string;
  title: string;
  dayIndex: number;
  sequence: number;
  startMin: number | null;
  durationMin: number;
}

export type StopChange =
  | { type: 'added'; stop: StopSnapshot }
  | { type: 'removed'; stop: StopSnapshot }
  | { type: 'moved'; stop: StopSnapshot; fromDay: number; toDay: number }
  | { type: 'retimed'; stop: StopSnapshot; fromStartMin: number | null; toStartMin: number | null }
  | { type: 'resized'; stop: StopSnapshot; fromDurationMin: number; toDurationMin: number };

const byOrder = (a: StopSnapshot, b: StopSnapshot) => a.dayIndex - b.dayIndex || a.sequence - b.sequence;

/** Indices (into `values`) of one longest strictly increasing subsequence. O(n log n). */
function longestIncreasingSubsequence(values: readonly number[]): Set<number> {
  const tails: number[] = []; // index into values of the smallest tail for each length
  const prev = new Array<number>(values.length).fill(-1);
  for (let i = 0; i < values.length; i += 1) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (values[tails[mid]!]! < values[i]!) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1]!;
    tails[lo] = i;
  }
  const keep = new Set<number>();
  let k = tails.length > 0 ? tails[tails.length - 1]! : -1;
  while (k >= 0) {
    keep.add(k);
    k = prev[k]!;
  }
  return keep;
}

/**
 * Only stops that actually changed relative order are reported as "moved":
 * we keep the longest run of stops whose order is unchanged (LIS) and flag the
 * rest. Inserting one stop does not mark everything after it as moved.
 */
export function diffItinerary(prev: readonly StopSnapshot[], next: readonly StopSnapshot[]): StopChange[] {
  const before = [...prev].sort(byOrder);
  const after = [...next].sort(byOrder);
  const prevRank = new Map(before.map((s, i) => [s.key, i]));
  const prevByKey = new Map(before.map((s) => [s.key, s]));
  const nextKeys = new Set(after.map((s) => s.key));
  const changes: StopChange[] = [];

  const common = after.filter((s) => prevByKey.has(s.key));
  const inOrder = longestIncreasingSubsequence(common.map((s) => prevRank.get(s.key)!));

  for (const stop of after) {
    if (!prevByKey.has(stop.key)) changes.push({ type: 'added', stop });
  }
  common.forEach((stop, i) => {
    const old = prevByKey.get(stop.key)!;
    if (!inOrder.has(i) || old.dayIndex !== stop.dayIndex) {
      changes.push({ type: 'moved', stop, fromDay: old.dayIndex, toDay: stop.dayIndex });
    }
    if (old.startMin !== stop.startMin) {
      changes.push({ type: 'retimed', stop, fromStartMin: old.startMin, toStartMin: stop.startMin });
    }
    if (old.durationMin !== stop.durationMin) {
      changes.push({ type: 'resized', stop, fromDurationMin: old.durationMin, toDurationMin: stop.durationMin });
    }
  });
  for (const stop of before) {
    if (!nextKeys.has(stop.key)) changes.push({ type: 'removed', stop });
  }
  return changes;
}
