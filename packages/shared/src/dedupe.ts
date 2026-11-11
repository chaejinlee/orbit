// "One place, many ideas": decide whether a new place is probably one we
// already saved. We never merge automatically — a match only drives the
// "Merge with existing?" prompt, and `high` merely pre-selects Merge.

export interface PlaceCandidate {
  name: string;
  lat?: number | null;
  lng?: number | null;
  provider?: string | null;
  externalId?: string | null;
}

export interface ExistingPlace extends PlaceCandidate {
  id: string;
}

export type MatchConfidence = 'high' | 'medium';
export type DuplicateReason = 'same_provider_id' | 'same_name' | 'similar_name' | 'nearby';

export interface DuplicateMatch {
  id: string;
  confidence: MatchConfidence;
  reasons: DuplicateReason[];
  similarity: number;
  distanceM?: number;
}

/**
 * Case-, accent-, spacing- and punctuation-insensitive form. Accents are stripped
 * with NFD → drop marks → NFC, so Hangul syllables recompose intact while
 * "Café" becomes "cafe". Spaces are removed because names like
 * "스타벅스 강남점" / "스타벅스강남점" are routinely written both ways.
 */
export function normalizePlaceName(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .normalize('NFC')
    .replace(/[\p{P}\p{S}\s]/gu, '');
}

function bigrams(s: string): Map<string, number> {
  const grams = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i += 1) {
    const g = s.slice(i, i + 2);
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  return grams;
}

/** Sørensen–Dice coefficient on character bigrams, boosted for containment. */
export function nameSimilarity(a: string, b: string): number {
  const x = normalizePlaceName(a);
  const y = normalizePlaceName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;

  const gx = bigrams(x);
  const gy = bigrams(y);
  let overlap = 0;
  for (const [g, count] of gx) overlap += Math.min(count, gy.get(g) ?? 0);
  const dice = (2 * overlap) / (x.length - 1 + (y.length - 1));

  // "Blue Bottle" vs "Blue Bottle Coffee Shibuya": the shorter name is fully
  // contained in the longer one. Worth asking about, not worth assuming.
  return nameContains(x, y, 4) ? Math.max(dice, 0.85) : dice;
}

/** Whether one normalized name contains the other (shorter side ≥ minLength chars). */
function nameContains(x: string, y: string, minLength: number): boolean {
  const [shorter, longer] = x.length <= y.length ? [x, y] : [y, x];
  return shorter.length >= minLength && longer.includes(shorter);
}

/** Great-circle distance in meters (haversine). */
export function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function coordsOf(p: PlaceCandidate): { lat: number; lng: number } | null {
  return p.lat != null && p.lng != null ? { lat: p.lat, lng: p.lng } : null;
}

export function findDuplicatePlaces(
  candidate: PlaceCandidate,
  existing: readonly ExistingPlace[],
): DuplicateMatch[] {
  const matches: DuplicateMatch[] = [];
  const here = coordsOf(candidate);

  for (const place of existing) {
    if (
      candidate.provider &&
      candidate.externalId &&
      place.provider === candidate.provider &&
      place.externalId === candidate.externalId
    ) {
      matches.push({ id: place.id, confidence: 'high', reasons: ['same_provider_id'], similarity: 1 });
      continue;
    }

    const similarity = nameSimilarity(candidate.name, place.name);
    const there = coordsOf(place);
    const nameReason: DuplicateReason = similarity === 1 ? 'same_name' : 'similar_name';

    if (here && there) {
      const distanceM = Math.round(distanceMeters(here, there));
      // Practically the same spot: a short name ("Pai") inside the full one counts.
      const contained = nameContains(normalizePlaceName(candidate.name), normalizePlaceName(place.name), 2);
      let confidence: MatchConfidence | null = null;
      if (distanceM <= 60 && (similarity >= 0.5 || contained)) confidence = 'high';
      else if (distanceM <= 250 && similarity >= 0.8) confidence = 'high';
      else if (distanceM <= 1000 && similarity >= 0.9) confidence = 'medium'; // maybe another branch
      if (confidence) {
        matches.push({ id: place.id, confidence, reasons: [nameReason, 'nearby'], similarity, distanceM });
      }
      continue;
    }

    // Without coordinates on both sides a name alone is never "high".
    if (similarity >= 0.85) {
      matches.push({ id: place.id, confidence: 'medium', reasons: [nameReason], similarity });
    }
  }

  const rank = (m: DuplicateMatch) => (m.confidence === 'high' ? 1 : 0);
  return matches.sort((a, b) => rank(b) - rank(a) || b.similarity - a.similarity);
}
