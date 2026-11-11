import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

// Itinerary order uses fractional indexes: moving a stop rewrites only that
// stop's key, so two people reordering different stops never conflict.
// Keys compare by code unit (`<`), never localeCompare.

export function keyBetween(before: string | null, after: string | null): string {
  return generateKeyBetween(before, after);
}

export function keysBetween(before: string | null, after: string | null, count: number): string[] {
  return generateNKeysBetween(before, after, count);
}

/**
 * Two clients inserting between the same neighbours can produce the same key.
 * Ties break on id, so every replica shows the same order.
 */
export function compareByPosition<T extends { position: string; id: string }>(a: T, b: T): number {
  if (a.position !== b.position) return a.position < b.position ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}
