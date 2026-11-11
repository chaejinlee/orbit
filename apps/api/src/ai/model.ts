import type { AiEnv } from '@orbit/db';
import type { AiSourceProvider, LatLng } from '@orbit/shared';

/**
 * The one seam between Orbit and an LLM provider. Services depend on this
 * interface (DI token AI_MODEL), never on a provider SDK, so swapping Gemini
 * for another model touches one file. `null` means AI is off.
 */
export const AI_MODEL = Symbol('AI_MODEL');

export interface AiUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  /** Grounding queries the provider ran (billed separately beyond free quotas). */
  groundingQueries: number | null;
}

export type AiPurpose = 'parse_note' | 'write_headlines';

export interface JsonRequest<T> {
  purpose: AiPurpose;
  system: string;
  prompt: string;
  /** JSON Schema subset the provider enforces (types, enum, required, ...). */
  jsonSchema: Record<string, unknown>;
  /** Re-validates the provider's output; throws on anything unexpected. */
  parse: (value: unknown) => T;
  maxOutputTokens: number;
  /** The structured facts the prompt was built from (lets the fake model answer sensibly). */
  context: unknown;
}

/** 'none' = answer without looking anything up (used when the key can't ground). */
export type Grounding = 'google_maps' | 'google_search' | 'none';

export interface GroundedRequest {
  system: string;
  prompt: string;
  grounding: Grounding;
  /** Biases Google Maps results toward the card's place. */
  location: LatLng | null;
  maxOutputTokens: number;
  context: { title: string; preset: string | null };
}

export interface GroundedSource {
  url: string;
  title: string | null;
  provider: AiSourceProvider;
}

export interface GroundedAnswer {
  text: string;
  sources: GroundedSource[];
  usage: AiUsage;
}

export interface AiModel {
  readonly provider: 'gemini' | 'fake';
  readonly model: string;
  generateJson<T>(request: JsonRequest<T>): Promise<{ data: T; usage: AiUsage }>;
  answer(request: GroundedRequest): Promise<GroundedAnswer>;
}

/**
 * - grounding_unavailable: the provider refused the Maps/Search tool (Gemini 3+
 *   grounding isn't part of the free tier). The caller may retry without it.
 * - bad_model: the configured model doesn't exist for this key (retired, or
 *   closed to new users).
 * - no_credit: the key's prepaid billing credits ran out (HTTP 402).
 */
export type AiFailure =
  | 'rate_limited'
  | 'bad_key'
  | 'bad_model'
  | 'no_credit'
  | 'unavailable'
  | 'bad_output'
  | 'blocked'
  | 'grounding_unavailable';

/** A provider failure translated into something the API can explain. */
export class AiError extends Error {
  constructor(
    readonly reason: AiFailure,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
  }
}

/** Only http(s) links ever reach the browser as sources. */
export function isSafeSourceUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password;
  } catch {
    return false;
  }
}

export type AiModelFactory = (env: AiEnv) => Promise<AiModel | null>;
