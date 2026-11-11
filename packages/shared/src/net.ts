/*
 * Small network helpers shared by the browser and the servers, mostly for
 * opening Orbit from a phone on the same Wi-Fi ("phone mode", BIND_HOST=0.0.0.0).
 */

/**
 * A v4 UUID. `crypto.randomUUID()` only exists in secure contexts, and a page
 * a phone loads from http://192.168.x.y:3000 isn't one, so this falls back to
 * `crypto.getRandomValues()` (available everywhere).
 */
export function randomId(): string {
  const c = globalThis.crypto;
  if (typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = c.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Hostnames that mean "this computer" (localhost, 127.x.x.x, ::1). */
export function isLoopbackHostname(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/^\[(.*)\]$/, '$1');
  return h === 'localhost' || h.endsWith('.localhost') || h === '::1' || /^127(?:\.\d{1,3}){3}$/.test(h);
}

/** A socket's remote address is this computer (IPv4, IPv6, or IPv4-mapped IPv6). */
export function isLoopbackAddress(address: string | null | undefined): boolean {
  if (!address) return false;
  const a = address.toLowerCase();
  return a === '::1' || /^(?:::ffff:)?127(?:\.\d{1,3}){3}$/.test(a);
}

/** The hostname in a Host header ("localhost:4000" → "localhost", "[::1]:4000" → "::1"). */
export function hostnameOfHost(host: string | null | undefined): string | null {
  if (!host) return null;
  const h = host.trim().toLowerCase();
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(h);
  if (bracketed) return bracketed[1]!;
  const [name] = h.split(':');
  return name || null;
}

/** 10.x, 172.16–31.x and 192.168.x: addresses a home or office Wi-Fi hands out. */
export function isPrivateIPv4(address: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (!m) return false;
  const [a, b, c, d] = m.slice(1).map(Number) as [number, number, number, number];
  if ([a, b, c, d].some((n) => n > 255)) return false;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/**
 * The web app as a phone on the same network sees it: `http://<private IPv4 or
 * name.local>:<web port>`. Used to let those origins call the API in phone mode.
 */
export function isLanWebOrigin(origin: string, webPort: number): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' || url.port !== String(webPort) || url.username || url.password) return false;
  return isPrivateIPv4(url.hostname) || /^[a-z0-9-]+\.local$/i.test(url.hostname);
}

/**
 * The API and realtime servers live on the same computer as the web app. When
 * they are configured as localhost but the page was loaded from another host
 * (a phone opened http://192.168.1.23:3000), "localhost" would mean the phone
 * itself, so use the page's host instead. Anything else is returned unchanged.
 */
export function withPageHost(serviceUrl: string, pageHostname: string | null | undefined): string {
  if (!pageHostname || isLoopbackHostname(pageHostname)) return serviceUrl;
  let url: URL;
  try {
    url = new URL(serviceUrl);
  } catch {
    return serviceUrl;
  }
  if (!isLoopbackHostname(url.hostname)) return serviceUrl;
  url.hostname = pageHostname.includes(':') && !pageHostname.startsWith('[') ? `[${pageHostname}]` : pageHostname;
  const out = url.toString();
  // URL adds "/" to a bare origin; keep the caller's form so `${base}/v1` stays one slash.
  return !serviceUrl.endsWith('/') && out.endsWith('/') && url.pathname === '/' ? out.slice(0, -1) : out;
}
