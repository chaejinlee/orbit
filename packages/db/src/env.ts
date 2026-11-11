import { isLoopbackHostname, isPrivateIPv4 } from '@orbit/shared';
import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT_ENV = fileURLToPath(new URL('../../../.env', import.meta.url));
const DEV_UPLOADS_DIR = fileURLToPath(new URL('../../../.data/uploads', import.meta.url));
const DEV_DATABASE_URL = 'postgresql://orbit:orbit@localhost:5433/orbit';
const DEV_AUTH_SECRET = 'dev-only-change-me-0123456789abcdef';

let loaded = false;

/** Loads the repo-root .env once. Variables already in the environment win. */
export function loadRootEnv(): void {
  if (loaded) return;
  loaded = true;
  if (existsSync(ROOT_ENV)) process.loadEnvFile(ROOT_ENV);
}

export type AiProviderName = 'gemini' | 'fake';

export interface AiEnv {
  /** null = AI features are off (no key configured, or AI_PROVIDER=off). */
  provider: AiProviderName | null;
  apiKey: string | null;
  model: string;
  /** AI calls one person may make per rolling 24 hours (protects the free tier). */
  dailyLimitPerUser: number;
}

export interface ServerEnv {
  production: boolean;
  databaseUrl: string;
  authSecret: string;
  devLogin: boolean;
  apiPort: number;
  realtimePort: number;
  /** Port of the web app (used for the phone link and allowed origins). */
  webPort: number;
  /**
   * Network interface the servers listen on. Defaults to this machine only;
   * other devices on the network can't reach the (passwordless) dev sign-in
   * unless you opt in with BIND_HOST=0.0.0.0 (`npm run dev:phone`).
   */
  bindHost: string;
  /**
   * Phone mode: BIND_HOST is not this machine only, so a phone on the same
   * Wi-Fi can open Orbit. Its sign-in then needs the code shown on this computer.
   */
  lanMode: boolean;
  /** Browser origins allowed to call the API (comma-separated in WEB_ORIGIN). */
  webOrigins: string[];
  /**
   * Where photo files are kept (local disk). A deployment needs a persistent
   * disk here, or object storage behind the same interface.
   */
  uploadsDir: string;
  ai: AiEnv;
}

/**
 * This computer's private IPv4 addresses (Wi-Fi, Ethernet, a phone hotspot),
 * physical interfaces first: where a phone on the same network can reach it.
 * Read on demand, so a new address after switching networks shows up.
 */
export function lanAddresses(): string[] {
  const found: Array<{ address: string; physical: boolean }> = [];
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal || !isPrivateIPv4(a.address)) continue;
      found.push({ address: a.address, physical: /^(en|eth|wlan|wl)/i.test(name) });
    }
  }
  found.sort((x, y) => Number(y.physical) - Number(x.physical));
  return [...new Set(found.map((f) => f.address))];
}

/**
 * Google's current stable Flash-Lite. Free tier for plain calls; Google Maps /
 * Search grounding needs billing on the key (5,000 grounded requests a month
 * free). gemini-2.5-flash-lite is closed to keys created since late 2026.
 */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';

function aiEnv(production: boolean): AiEnv {
  const requested = (process.env.AI_PROVIDER ?? '').trim().toLowerCase();
  const apiKey = process.env.GEMINI_API_KEY?.trim() || null;
  const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  const limit = Number(process.env.AI_DAILY_LIMIT ?? 40);
  const dailyLimitPerUser = Number.isInteger(limit) && limit >= 0 ? limit : 40;

  if (requested === 'off') return { provider: null, apiKey: null, model, dailyLimitPerUser };
  if (requested === 'fake') {
    // Canned answers for building the UI without a key. Never in production.
    if (production) throw new Error('AI_PROVIDER=fake is for local development only.');
    return { provider: 'fake', apiKey: null, model: 'fake-dev-model', dailyLimitPerUser };
  }
  if (requested && requested !== 'gemini') throw new Error(`Unknown AI_PROVIDER "${requested}". Use gemini, fake or off.`);
  return { provider: apiKey ? 'gemini' : null, apiKey, model, dailyLimitPerUser };
}

/** Server configuration with local-dev defaults that are refused in production. */
export function serverEnv(): ServerEnv {
  loadRootEnv();
  const production = process.env.NODE_ENV === 'production';
  const databaseUrl = process.env.DATABASE_URL ?? (production ? '' : DEV_DATABASE_URL);
  const authSecret = process.env.AUTH_SECRET ?? (production ? '' : DEV_AUTH_SECRET);
  const bindHost = process.env.BIND_HOST?.trim() || '127.0.0.1';

  if (!databaseUrl) throw new Error('DATABASE_URL is required.');
  if (authSecret.length < 32 || (production && authSecret === DEV_AUTH_SECRET)) {
    throw new Error('AUTH_SECRET must be a random value of at least 32 characters.');
  }

  return {
    production,
    databaseUrl,
    authSecret,
    // The passwordless dev sign-in can never be switched on in production.
    devLogin: !production && process.env.AUTH_DEV_LOGIN === 'true',
    apiPort: Number(process.env.API_PORT ?? 4000),
    realtimePort: Number(process.env.REALTIME_PORT ?? 4001),
    webPort: Number(process.env.WEB_PORT ?? 3000),
    bindHost,
    lanMode: !isLoopbackHostname(bindHost),
    webOrigins: (process.env.WEB_ORIGIN ?? 'http://localhost:3000,http://127.0.0.1:3000')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    uploadsDir: process.env.UPLOADS_DIR?.trim() || DEV_UPLOADS_DIR,
    ai: aiEnv(production),
  };
}
