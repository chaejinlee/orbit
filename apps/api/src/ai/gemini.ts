import { GoogleGenAI, type GoogleGenAIInteraction } from '@google/genai';
import { DEFAULT_GEMINI_MODEL } from '@orbit/db';
import { AiError, isSafeSourceUrl, type AiModel, type AiUsage, type GroundedAnswer, type GroundedRequest, type GroundedSource, type JsonRequest } from './model';

/*
 * Google Gemini through the Interactions API (@google/genai).
 * - store: false — requests aren't kept server-side for later retrieval.
 * - Grounding with Google Maps / Google Search returns citations as text
 *   annotations (place_citation / url_citation); those become the sources the
 *   UI must show next to the answer.
 * - No SDK retries: a 429 would otherwise wait out Retry-After (30 s+) while
 *   someone stares at a spinner. Orbit retries a 5xx once itself and reports
 *   everything else straight away.
 */

type Interaction = GoogleGenAIInteraction;

const CALL_OPTIONS = { maxRetries: 0, timeout: 25_000 };
const RETRY_DELAY_MS = 800;

function statusOf(error: unknown): number | null {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : null;
}

/** Turns an SDK error into a reason the API can explain. Exported for tests. */
export function translateGeminiError(error: unknown, ctx: { model: string; grounded: boolean }): AiError {
  if (error instanceof AiError) return error;
  const status = statusOf(error);
  const message = String((error as Error | null)?.message ?? '');
  if (status === 429) {
    // Gemini 3+ grounding isn't in the free tier; the key gets a quota error for
    // the tool while plain calls still work. The caller can answer without it.
    return ctx.grounded
      ? new AiError('grounding_unavailable', 'Gemini refused Google Maps / Search grounding for this key (free tier, or over quota).', error)
      : new AiError('rate_limited', 'Gemini is busy (rate limit). Try again in a minute.', error);
  }
  if (status === 404) {
    const suggested = /use models\/([\w.-]+)/i.exec(message)?.[1] ?? (ctx.model !== DEFAULT_GEMINI_MODEL ? DEFAULT_GEMINI_MODEL : null);
    return new AiError(
      'bad_model',
      `Gemini model “${ctx.model}” isn’t available for this API key.${suggested ? ` Set GEMINI_MODEL=${suggested} in .env.` : ' Set GEMINI_MODEL in .env to a current model.'}`,
      error,
    );
  }
  if (status === 402) {
    return new AiError('no_credit', 'Gemini stopped: this key’s prepaid credits ran out. Add credits at https://aistudio.google.com/billing.', error);
  }
  if ((status === 400 && /api key/i.test(message)) || status === 401 || status === 403) {
    return new AiError('bad_key', 'Gemini rejected the API key. Check GEMINI_API_KEY in .env.', error);
  }
  return new AiError('unavailable', 'Gemini didn’t answer this time. Try again.', error);
}

function usageOf(interaction: Interaction): AiUsage {
  const u = 'usage' in interaction ? interaction.usage : undefined;
  const grounding = u?.grounding_tool_count?.reduce((sum, g) => sum + (Number((g as { count?: number }).count) || 0), 0);
  return {
    inputTokens: u?.total_input_tokens ?? null,
    outputTokens: u?.total_output_tokens ?? null,
    groundingQueries: grounding ?? null,
  };
}

function assertFinished(interaction: Interaction, allowIncomplete: boolean): void {
  if (interaction.status === 'completed' || (allowIncomplete && interaction.status === 'incomplete')) return;
  const blocked = interaction.status === 'failed' && JSON.stringify(interaction.errors ?? '').toLowerCase().includes('safety');
  throw new AiError(blocked ? 'blocked' : 'unavailable', `Gemini stopped early (${interaction.status}).`);
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class GeminiModel implements AiModel {
  readonly provider = 'gemini' as const;
  private readonly client: GoogleGenAI;

  constructor(
    apiKey: string,
    readonly model: string,
  ) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async generateJson<T>(request: JsonRequest<T>): Promise<{ data: T; usage: AiUsage }> {
    const interaction = await this.call(
      () =>
        this.client.interactions.create(
          {
            model: this.model,
            input: request.prompt,
            system_instruction: request.system,
            response_format: { type: 'text', mime_type: 'application/json', schema: request.jsonSchema },
            generation_config: { max_output_tokens: request.maxOutputTokens },
            store: false,
          },
          CALL_OPTIONS,
        ),
      false,
    );
    assertFinished(interaction, false);
    try {
      return { data: request.parse(JSON.parse(interaction.output_text ?? '')), usage: usageOf(interaction) };
    } catch (error) {
      throw new AiError('bad_output', 'Gemini returned something Orbit couldn’t use.', error);
    }
  }

  async answer(request: GroundedRequest): Promise<GroundedAnswer> {
    const tools =
      request.grounding === 'google_maps'
        ? [{ type: 'google_maps' as const, ...(request.location ? { latitude: request.location.lat, longitude: request.location.lng } : {}) }]
        : request.grounding === 'google_search'
          ? [{ type: 'google_search' as const }]
          : null;
    const interaction = await this.call(
      () =>
        this.client.interactions.create(
          {
            model: this.model,
            input: request.prompt,
            system_instruction: request.system,
            ...(tools ? { tools } : {}),
            generation_config: { max_output_tokens: request.maxOutputTokens },
            store: false,
          },
          CALL_OPTIONS,
        ),
      tools != null,
    );
    assertFinished(interaction, true);

    let text = '';
    const sources = new Map<string, GroundedSource>();
    for (const step of interaction.steps) {
      if (step.type !== 'model_output') continue;
      for (const block of step.content ?? []) {
        if (block.type !== 'text') continue;
        text += block.text;
        for (const a of block.annotations ?? []) {
          if (a.type === 'place_citation' && a.url && isSafeSourceUrl(a.url)) {
            sources.set(a.url, { url: a.url, title: a.name ?? null, provider: 'google_maps' });
          } else if (a.type === 'url_citation' && a.url && isSafeSourceUrl(a.url)) {
            sources.set(a.url, { url: a.url, title: a.title ?? null, provider: 'web' });
          }
        }
      }
    }
    text = (text || interaction.output_text || '').trim();
    if (!text) throw new AiError('bad_output', 'Gemini returned an empty answer.');
    if (interaction.status === 'incomplete') text = `${text}…`;
    return { text, sources: [...sources.values()].slice(0, 8), usage: usageOf(interaction) };
  }

  /** One call, retried once on a server error (5xx); everything else is reported as is. */
  private async call(run: () => Promise<Interaction>, grounded: boolean): Promise<Interaction> {
    try {
      return await run();
    } catch (first) {
      const status = statusOf(first);
      if (status == null || status < 500) throw translateGeminiError(first, { model: this.model, grounded });
      await pause(RETRY_DELAY_MS);
      try {
        return await run();
      } catch (second) {
        throw translateGeminiError(second, { model: this.model, grounded });
      }
    }
  }
}
