import { describe, expect, it, vi } from 'vitest';
import { GeminiModel, translateGeminiError } from '../src/ai/gemini';
import type { GroundedRequest } from '../src/ai/model';

// No network: these pin down how Orbit reads Gemini's errors and how it calls
// the Interactions API (no SDK retries, tools only when grounding).

const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });

const ask: GroundedRequest = {
  system: 'system',
  prompt: 'prompt',
  grounding: 'none',
  location: null,
  maxOutputTokens: 100,
  context: { title: 'Art Gallery of Ontario', preset: 'HOURS' },
};

const completed = (text: string) => ({
  status: 'completed',
  output_text: text,
  steps: [{ type: 'model_output', content: [{ type: 'text', text, annotations: [] }] }],
});

function withFakeClient(create: ReturnType<typeof vi.fn>): GeminiModel {
  const model = new GeminiModel('not-a-real-key', 'gemini-3.5-flash-lite');
  (model as unknown as { client: unknown }).client = { interactions: { create } };
  return model;
}

describe('translateGeminiError', () => {
  it('reads a quota error on a grounded call as "no grounding", so Orbit can answer without it', () => {
    const quota = httpError(429, 'You exceeded your current quota, please check your plan and billing details.');
    expect(translateGeminiError(quota, { model: 'm', grounded: true }).reason).toBe('grounding_unavailable');
    expect(translateGeminiError(quota, { model: 'm', grounded: false }).reason).toBe('rate_limited');
  });

  it('names the model Google suggests when the configured one is closed', () => {
    const closed = httpError(
      404,
      'This model models/gemini-2.5-flash-lite is no longer available to new users. Please update your code to use models/gemini-3.5-flash-lite for the latest features and improvements.',
    );
    const error = translateGeminiError(closed, { model: 'gemini-2.5-flash-lite', grounded: false });
    expect(error.reason).toBe('bad_model');
    expect(error.message).toContain('GEMINI_MODEL=gemini-3.5-flash-lite');
    expect(translateGeminiError(httpError(404, 'not found'), { model: 'gemini-typo', grounded: false }).message).toContain(
      'GEMINI_MODEL=gemini-3.5-flash-lite',
    );
  });

  it('explains bad keys and treats anything else as a temporary failure', () => {
    expect(translateGeminiError(httpError(400, 'API key not valid. Please pass a valid API key.'), { model: 'm', grounded: false }).reason).toBe('bad_key');
    expect(translateGeminiError(httpError(403, 'permission denied'), { model: 'm', grounded: false }).reason).toBe('bad_key');
    expect(translateGeminiError(httpError(402, 'payment required'), { model: 'm', grounded: true }).reason).toBe('no_credit');
    expect(translateGeminiError(httpError(503, 'overloaded'), { model: 'm', grounded: false }).reason).toBe('unavailable');
    expect(translateGeminiError(new Error('socket hang up'), { model: 'm', grounded: false }).reason).toBe('unavailable');
  });
});

describe('GeminiModel', () => {
  it('sends no tools without grounding, turns SDK retries off, and retries a server error once', async () => {
    const create = vi.fn().mockRejectedValueOnce(httpError(503, 'overloaded')).mockResolvedValueOnce(completed('Usually 10:30 to 5.'));
    const result = await withFakeClient(create).answer(ask);
    expect(result).toMatchObject({ text: 'Usually 10:30 to 5.', sources: [] });
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0]![0]).not.toHaveProperty('tools');
    expect(create.mock.calls[0]![0]).toMatchObject({ model: 'gemini-3.5-flash-lite', store: false });
    expect(create.mock.calls[0]![1]).toMatchObject({ maxRetries: 0 });
  });

  it('asks Google Maps near the place, and reports a refused tool at once instead of retrying', async () => {
    const create = vi.fn().mockRejectedValue(httpError(429, 'You exceeded your current quota'));
    const model = withFakeClient(create);
    await expect(model.answer({ ...ask, grounding: 'google_maps', location: { lat: 43.6536, lng: -79.3925 } })).rejects.toMatchObject({
      reason: 'grounding_unavailable',
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![0].tools).toEqual([{ type: 'google_maps', latitude: 43.6536, longitude: -79.3925 }]);
  });

  it('keeps only safe citation links as sources', async () => {
    const create = vi.fn().mockResolvedValue({
      status: 'completed',
      output_text: 'Open 10:30–5.',
      steps: [
        {
          type: 'model_output',
          content: [
            {
              type: 'text',
              text: 'Open 10:30–5.',
              annotations: [
                { type: 'place_citation', url: 'https://maps.google.com/?cid=1', name: 'Art Gallery of Ontario' },
                { type: 'url_citation', url: 'javascript:alert(1)', title: 'bad' },
                { type: 'url_citation', url: 'https://ago.ca/visit', title: 'Visit the AGO' },
              ],
            },
          ],
        },
      ],
    });
    const result = await withFakeClient(create).answer({ ...ask, grounding: 'google_search' });
    expect(create.mock.calls[0]![0].tools).toEqual([{ type: 'google_search' }]);
    expect(result.sources).toEqual([
      { url: 'https://maps.google.com/?cid=1', title: 'Art Gallery of Ontario', provider: 'google_maps' },
      { url: 'https://ago.ca/visit', title: 'Visit the AGO', provider: 'web' },
    ]);
  });
});
