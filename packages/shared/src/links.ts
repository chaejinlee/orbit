// V1 link import: normalize what the user pasted and read what the URL itself
// tells us. Nothing here fetches the page, so private posts, login walls and
// scraping limits are never an issue — and there is no SSRF surface yet.

export type LinkPlatform =
  | 'instagram'
  | 'tiktok'
  | 'youtube'
  | 'google_maps'
  | 'apple_maps'
  | 'naver_map'
  | 'kakao_map'
  | 'yelp'
  | 'tripadvisor'
  | 'x'
  | 'web';

export const PLATFORM_LABEL: Record<LinkPlatform, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  google_maps: 'Google Maps',
  apple_maps: 'Apple Maps',
  naver_map: 'Naver Map',
  kakao_map: 'Kakao Map',
  yelp: 'Yelp',
  tripadvisor: 'Tripadvisor',
  x: 'X',
  web: 'Link',
};

export class InvalidLinkError extends Error {
  override name = 'InvalidLinkError';
}

export interface NormalizedLink {
  /** Cleaned URL to store and open: tracking params, fragment and credentials removed. */
  url: string;
  /** Canonical comparison key for duplicate detection. Not meant to be opened. */
  key: string;
  host: string;
  platform: LinkPlatform;
}

const TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'yclid', 'ttclid',
  'igshid', 'igsh', 'si', 'mc_cid', 'mc_eid', '_hsenc', '_hsmi', 'ref_src',
  'ref_url', 'spm', 'share_id', 'g_st', 'g_ep', '_r', '_t',
]);

function isTrackingParam(name: string): boolean {
  return name.startsWith('utm_') || TRACKING_PARAMS.has(name);
}

function bareHost(host: string): string {
  return host.replace(/^(www|m|mobile)\./, '');
}

function isGoogleHost(host: string): boolean {
  return /(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(host);
}

export function detectPlatform(host: string, pathname = '/'): LinkPlatform {
  const h = bareHost(host.toLowerCase());
  if (h === 'instagram.com' || h === 'instagr.am') return 'instagram';
  if (h === 'tiktok.com' || h.endsWith('.tiktok.com')) return 'tiktok';
  if (h === 'youtube.com' || h === 'youtu.be' || h === 'music.youtube.com') return 'youtube';
  if (h === 'maps.app.goo.gl' || (h === 'goo.gl' && pathname.startsWith('/maps'))) return 'google_maps';
  if (h.startsWith('maps.google.') || (isGoogleHost(h) && pathname.startsWith('/maps'))) return 'google_maps';
  if (h === 'maps.apple.com' || h === 'maps.apple') return 'apple_maps';
  if (h === 'map.naver.com' || h === 'naver.me' || h === 'm.place.naver.com' || h === 'place.naver.com') return 'naver_map';
  if (h === 'map.kakao.com' || h === 'place.map.kakao.com' || h === 'kko.to') return 'kakao_map';
  if (h === 'yelp.com' || h.endsWith('.yelp.com') || /^yelp\.[a-z.]+$/.test(h)) return 'yelp';
  if (/^tripadvisor\.[a-z.]+$/.test(h)) return 'tripadvisor';
  if (h === 'x.com' || h === 'twitter.com') return 'x';
  return 'web';
}

/** Same post, different URL shapes → one key. */
function canonicalPath(platform: LinkPlatform, url: URL): { path: string; params: URLSearchParams } {
  const params = new URLSearchParams(url.searchParams);
  let path = url.pathname.replace(/\/+$/, '') || '/';
  if (platform === 'instagram') {
    const m = /^\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([^/]+)/.exec(path);
    if (m) return { path: `/p/${m[1]}`, params: new URLSearchParams() };
  }
  if (platform === 'youtube') {
    const host = bareHost(url.hostname);
    const shortId = host === 'youtu.be' ? path.slice(1) : /^\/(?:shorts|live|embed)\/([^/]+)/.exec(path)?.[1];
    const id = shortId || params.get('v');
    if (id) return { path: '/watch', params: new URLSearchParams({ v: id }) };
  }
  if (platform === 'tiktok') {
    const m = /\/video\/(\d+)/.exec(path);
    if (m) return { path: `/video/${m[1]}`, params: new URLSearchParams() };
  }
  return { path, params };
}

export function normalizeLink(raw: string): NormalizedLink {
  const trimmed = raw.trim();
  if (!trimmed) throw new InvalidLinkError('Paste a link first.');
  if (trimmed.length > 2048) throw new InvalidLinkError('That link is too long.');
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new InvalidLinkError('That doesn’t look like a link.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new InvalidLinkError('Only web links (http or https) can be saved.');
  }
  if (!url.hostname.includes('.') || url.hostname.endsWith('.')) {
    throw new InvalidLinkError('That doesn’t look like a link.');
  }
  url.username = '';
  url.password = '';
  url.hash = '';
  for (const name of [...url.searchParams.keys()]) {
    if (isTrackingParam(name)) url.searchParams.delete(name);
  }

  const platform = detectPlatform(url.hostname, url.pathname);
  const { path, params } = canonicalPath(platform, url);
  params.sort();
  const query = params.toString();
  const keyHost = platform === 'youtube' ? 'youtube.com' : bareHost(url.hostname);
  const key = `${keyHost}${path === '/' ? '' : path}${query ? `?${query}` : ''}`;

  return { url: url.toString(), key, host: url.hostname, platform };
}

export interface MapsLinkPlace {
  provider: 'google' | 'apple';
  name?: string;
  lat?: number;
  lng?: number;
  /** Google place id when the link carries one (query_place_id). */
  providerPlaceId?: string;
}

function validCoords(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

function parseLatLng(value: string | null | undefined): { lat: number; lng: number } | null {
  if (!value) return null;
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(value);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return validCoords(lat, lng) ? { lat, lng } : null;
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment.replaceAll('+', ' ')).trim();
  } catch {
    return segment.replaceAll('+', ' ').trim();
  }
}

/**
 * Reads the place name/coordinates that Google and Apple Maps share links carry
 * in the URL itself. Short links (maps.app.goo.gl) need a redirect lookup, which
 * is a server-side fetch we have not built yet, so they return null.
 */
export function parseMapsLink(rawUrl: string): MapsLinkPlace | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const platform = detectPlatform(url.hostname, url.pathname);

  if (platform === 'google_maps') {
    if (bareHost(url.hostname) === 'maps.app.goo.gl' || bareHost(url.hostname) === 'goo.gl') return null;
    const result: MapsLinkPlace = { provider: 'google' };
    const path = url.pathname;

    const named = /\/maps\/(?:place|search)\/([^/@]+)/.exec(path);
    if (named?.[1]) {
      const name = decodeSegment(named[1]);
      if (!parseLatLng(name)) result.name = name;
    }
    // !3d<lat>!4d<lng> is the pinned place; @lat,lng is only the viewport.
    const pinned = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(path);
    const viewport = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(path);
    const coordsMatch = pinned ?? viewport;
    if (coordsMatch) {
      const lat = Number(coordsMatch[1]);
      const lng = Number(coordsMatch[2]);
      if (validCoords(lat, lng)) Object.assign(result, { lat, lng });
    }

    const q = url.searchParams.get('query') ?? url.searchParams.get('q');
    if (q) {
      const asCoords = parseLatLng(q);
      if (asCoords) Object.assign(result, asCoords);
      else result.name ??= q.trim();
    }
    const placeId = url.searchParams.get('query_place_id');
    if (placeId) result.providerPlaceId = placeId;
    const ll = parseLatLng(url.searchParams.get('ll'));
    if (ll && result.lat == null) Object.assign(result, ll);

    return result.name || result.lat != null || result.providerPlaceId ? result : null;
  }

  if (platform === 'apple_maps') {
    const result: MapsLinkPlace = { provider: 'apple' };
    const name = url.searchParams.get('name') ?? url.searchParams.get('q');
    if (name && !parseLatLng(name)) result.name = name.trim();
    const coords =
      parseLatLng(url.searchParams.get('coordinate')) ??
      parseLatLng(url.searchParams.get('ll')) ??
      parseLatLng(url.searchParams.get('sll'));
    if (coords) Object.assign(result, coords);
    return result.name || result.lat != null ? result : null;
  }

  return null;
}

/** A readable default title for a saved link: "Instagram reel", "Google Maps place", "example.com". */
export function suggestLinkTitle(link: NormalizedLink, parsed?: MapsLinkPlace | null): string {
  if (parsed?.name) return parsed.name;
  const path = new URL(link.url).pathname;
  switch (link.platform) {
    case 'instagram':
      return /\/(reel|reels)\//.test(path) ? 'Instagram reel' : 'Instagram post';
    case 'tiktok':
      return 'TikTok video';
    case 'youtube':
      return /\/shorts\//.test(path) ? 'YouTube short' : 'YouTube video';
    case 'google_maps':
    case 'apple_maps':
    case 'naver_map':
    case 'kakao_map':
      return `${PLATFORM_LABEL[link.platform]} place`;
    default:
      return link.host.replace(/^www\./, '');
  }
}

/** A plain, provider-neutral "open in maps" link for a place we know about. */
export function mapsSearchUrl(place: { name: string; lat?: number | null; lng?: number | null }): string {
  const query =
    place.lat != null && place.lng != null ? `${place.lat},${place.lng}` : place.name;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
