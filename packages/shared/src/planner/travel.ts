import { distanceMeters } from '../dedupe';
import type { DraftStop } from '../itinerary/types';

export interface LatLng {
  lat: number;
  lng: number;
}

/** Streets are rarely straight lines. */
const DETOUR_FACTOR = 1.3;
const WALK_KMH = 4.8;
/** City transit or driving, averaged over waiting, parking and traffic. */
const RIDE_KMH = 25;
const RIDE_OVERHEAD_MIN = 10;
const WALK_ONLY_UNDER_KM = 1.6;

/**
 * A rough door-to-door estimate between two points, rounded up to 5 minutes.
 * Short hops are walked; longer ones take whichever of walking or a ride is
 * faster. It is always shown as an estimate ("est.") until a routing service
 * provides real travel times.
 */
export function estimateTravelMinutes(a: LatLng, b: LatLng): number {
  const km = (distanceMeters(a, b) / 1000) * DETOUR_FACTOR;
  if (km < 0.15) return 0; // same block or building
  const walk = (km / WALK_KMH) * 60;
  const ride = RIDE_OVERHEAD_MIN + (km / RIDE_KMH) * 60;
  const minutes = km <= WALK_ONLY_UNDER_KM ? walk : Math.min(walk, ride);
  return Math.max(5, Math.ceil(minutes / 5) * 5);
}

/**
 * Travel estimator for the scheduler: uses the coordinates of the ideas two
 * stops came from. Returns null (meaning "use the default estimate") when
 * either side has no known location.
 */
export function travelEstimatorFor(
  pointOf: (ideaId: string) => LatLng | null | undefined,
): (from: DraftStop, to: DraftStop) => number | null {
  return (from, to) => {
    if (!from.ideaId || !to.ideaId) return null;
    const a = pointOf(from.ideaId);
    const b = pointOf(to.ideaId);
    return a && b ? estimateTravelMinutes(a, b) : null;
  };
}
