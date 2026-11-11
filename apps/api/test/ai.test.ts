import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createPrismaClient, type PrismaClient } from '@orbit/db';
import { startEphemeralPostgres, type EphemeralPostgres } from '@orbit/db/testing';
import type { DraftStop, ProposalsResultDTO } from '@orbit/shared';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AI_MODEL, AiError, type AiModel, type GroundedRequest, type JsonRequest } from '../src/ai/model';
import type { HeadlineContext, NoteOutput } from '../src/ai/prompts';
import { AppModule, configureApp } from '../src/app.module';
import { CONFIG, type Config } from '../src/core/tokens';

/** A scriptable stand-in for Gemini: records every call, answers on cue. */
class ScriptedModel implements AiModel {
  readonly provider = 'fake' as const;
  readonly model = 'test-model';
  calls: Array<{ kind: 'json' | 'answer'; purpose?: string; grounding?: string; location?: unknown; prompt: string; system?: string }> = [];
  note: Partial<NoteOutput> = {};
  failNext: AiError | null = null;
  /** Acts like a free-tier Gemini 3 key: grounded calls are refused, plain ones work. */
  groundingOff = false;

  async generateJson<T>(req: JsonRequest<T>) {
    this.calls.push({ kind: 'json', purpose: req.purpose, prompt: req.prompt });
    if (req.purpose === 'parse_note') {
      const empty: NoteOutput = {
        pace: 'UNSPECIFIED', lessTravel: false, lowerCost: false, mustIncludeIds: [], avoidIds: [], endWithId: '',
        maxStops: 0, startTime: '', endTime: '', budgetAmount: 0, unsupported: [],
      };
      return { data: req.parse({ ...empty, ...this.note }), usage: { inputTokens: 10, outputTokens: 5, groundingQueries: 0 } };
    }
    const ctx = req.context as HeadlineContext;
    return {
      data: req.parse({ options: ctx.proposals.map((p) => ({ label: p.label, headline: `AI ${p.label}`, why: `Why ${p.label}.` })) }),
      usage: { inputTokens: 10, outputTokens: 5, groundingQueries: 0 },
    };
  }

  async answer(req: GroundedRequest) {
    this.calls.push({ kind: 'answer', grounding: req.grounding, location: req.location, prompt: req.prompt, system: req.system });
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = null;
      throw error;
    }
    if (this.groundingOff && req.grounding !== 'none') throw new AiError('grounding_unavailable', 'quota 0 for grounding');
    if (req.grounding === 'none') {
      return { text: `About ${req.context.title}: usually open in the afternoon.`, sources: [], usage: { inputTokens: 20, outputTokens: 10, groundingQueries: 0 } };
    }
    return {
      text: `About ${req.context.title}: open until 10 PM.`,
      sources: [
        { url: 'https://maps.google.com/?cid=123', title: req.context.title, provider: 'google_maps' as const },
        { url: 'javascript:alert(1)', title: 'evil', provider: 'web' as const },
      ],
      usage: { inputTokens: 20, outputTokens: 10, groundingQueries: 1 },
    };
  }
}

let pg: EphemeralPostgres;
let app: INestApplication;
let db: PrismaClient;
const model = new ScriptedModel();

beforeAll(async () => {
  pg = await startEphemeralPostgres();
  process.env.DATABASE_URL = pg.url;
  process.env.AUTH_DEV_LOGIN = 'true';
  process.env.AI_DAILY_LIMIT = '6';
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(AI_MODEL).useValue(model).compile();
  app = moduleRef.createNestApplication({ logger: false });
  configureApp(app, app.get<Config>(CONFIG));
  await app.init();
  db = createPrismaClient(pg.url);
});

afterAll(async () => {
  await app?.close();
  await db?.$disconnect();
  await pg?.stop();
});

beforeEach(() => {
  model.calls = [];
  model.note = {};
  model.failNext = null;
  model.groundingOff = false;
});

const api = () => request(app.getHttpServer());
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function login(email: string) {
  const res = await api().post('/v1/auth/dev-login').send({ email }).expect(200);
  return { token: res.body.token as string, userId: res.body.user.id as string };
}

async function datePlan(token: string) {
  const res = await api()
    .post('/v1/plans')
    .set(bearer(token))
    .send({ clientRequestId: randomUUID(), type: 'DATE', city: 'Toronto', startDate: '2026-11-14', startMin: 15 * 60, endMin: 21 * 60, budget: { amountMinor: 12_000, currency: 'CAD' } })
    .expect(201);
  return res.body as { id: string };
}

async function place(token: string, planId: string, name: string, lat: number, lng: number) {
  const res = await api()
    .post(`/v1/plans/${planId}/ideas`)
    .set(bearer(token))
    .send({ clientRequestId: randomUUID(), kind: 'PLACE', place: { name, lat, lng } })
    .expect(201);
  return res.body.idea as { id: string; title: string };
}

function stopFor(ideaId: string, title: string, extra: Partial<DraftStop> = {}): DraftStop {
  return {
    id: randomUUID(), ideaId, title, position: 'a0', dayIndex: 0, durationMin: 60, fixedStartMin: null,
    locked: false, travelMinFromPrev: null, costMinor: null, costCurrency: null, ...extra,
  };
}

async function propose(token: string, planId: string, body: Record<string, unknown> = {}) {
  const res = await api()
    .post(`/v1/plans/${planId}/proposals`)
    .set(bearer(token))
    .send({ clientRequestId: randomUUID(), draft: [], chips: [], ...body });
  return res;
}

describe('AI status', () => {
  it('reports the provider, model and the daily allowance', async () => {
    const { token } = await login('status@example.com');
    const res = await api().get('/v1/ai/status').set(bearer(token)).expect(200);
    expect(res.body).toEqual({ enabled: true, provider: 'fake', model: 'test-model', dailyLimit: 6, usedToday: 0 });
  });
});

describe('plan options', () => {
  it('returns labeled options inside the plan window, worded by the model', async () => {
    const { token } = await login('planner@example.com');
    const plan = await datePlan(token);
    await place(token, plan.id, 'Gallery', 43.6536, -79.3925);
    await place(token, plan.id, 'Cafe', 43.6544, -79.3807);
    await place(token, plan.id, 'Dinner', 43.6526, -79.3838);
    await place(token, plan.id, 'Arcade', 43.6426, -79.3871);

    const res = await propose(token, plan.id);
    expect(res.status).toBe(200);
    const body = res.body as ProposalsResultDTO;
    expect(body.proposals.length).toBeGreaterThanOrEqual(2);
    expect(body.proposals[0]!.label).toBe('BALANCED');
    for (const p of body.proposals) {
      expect(p.headline).toBe(`AI ${p.label}`);
      expect(p.why).toBe(`Why ${p.label}.`);
      expect(p.totals.startMin).toBeGreaterThanOrEqual(15 * 60);
      expect(p.totals.endMin).toBeLessThanOrEqual(21 * 60);
    }
    expect(body.understood.window).toEqual({ startMin: 900, endMin: 1260, source: 'plan' });
    expect(body.ai).toEqual({ used: true, model: 'test-model', notice: null });
    // Proposals are stored (SQL truth), tied to the confirmed version they were based on.
    const stored = await db.planProposal.findMany({ where: { jobId: body.jobId } });
    expect(stored.map((s) => s.basePlanVersion)).toEqual(body.proposals.map(() => 0));
    // Only the headlines went to the model: no note was given.
    expect(model.calls.map((c) => c.purpose)).toEqual(['write_headlines']);
  });

  it('applies the note, but only with ids Orbit offered', async () => {
    const { token } = await login('noter@example.com');
    const plan = await datePlan(token);
    const bar = await place(token, plan.id, 'Loud Bar', 43.6544, -79.3807);
    const museum = await place(token, plan.id, 'Museum', 43.6677, -79.3948);
    await place(token, plan.id, 'Tea House', 43.6526, -79.3838);
    model.note = { avoidIds: [bar.id], mustIncludeIds: [museum.id, 'made-up-id'], pace: 'RELAXED', unsupported: ['booking tickets'] };

    const body = (await propose(token, plan.id, { note: 'skip the loud bar, the museum for sure, chill day' })).body as ProposalsResultDTO;
    expect(body.understood.noteUsed).toBe(true);
    expect(body.understood.avoid).toEqual([{ ideaId: bar.id, title: 'Loud Bar' }]);
    expect(body.understood.mustInclude).toEqual([{ ideaId: museum.id, title: 'Museum' }]);
    expect(body.understood.pace).toBe('RELAXED');
    expect(body.understood.notUnderstood).toEqual(['booking tickets']);
    for (const p of body.proposals) {
      const ids = p.stops.map((s) => s.ideaId);
      expect(ids).not.toContain(bar.id);
      expect(ids).toContain(museum.id);
    }
    expect(model.calls.map((c) => c.purpose)).toEqual(['parse_note', 'write_headlines']);
  });

  it('does not credit the note with the plan’s own times and budget echoed back', async () => {
    const { token } = await login('echo@example.com');
    const plan = await datePlan(token); // 3–9 PM, CA$120
    await place(token, plan.id, 'Tea House', 43.6526, -79.3838);
    model.note = { pace: 'RELAXED', startTime: '15:00', endTime: '21:00', budgetAmount: 120 };
    let body = (await propose(token, plan.id, { note: 'relaxed please' })).body as ProposalsResultDTO;
    expect(body.understood.window).toEqual({ startMin: 900, endMin: 1260, source: 'plan' });
    expect(body.understood.budgetSource).toBe('plan');

    // a real change in the note still counts
    model.note = { startTime: '16:00', budgetAmount: 80 };
    body = (await propose(token, plan.id, { note: 'start at 4, keep it under $80' })).body as ProposalsResultDTO;
    expect(body.understood.window).toEqual({ startMin: 960, endMin: 1260, source: 'note' });
    expect(body.understood.budgetSource).toBe('note');
  });

  it('keeps locked stops (same id) in every option', async () => {
    const { token } = await login('locker@example.com');
    const plan = await datePlan(token);
    const dinner = await place(token, plan.id, 'Dinner', 43.6526, -79.3838);
    await place(token, plan.id, 'Gallery', 43.6536, -79.3925);
    await place(token, plan.id, 'Cafe', 43.6544, -79.3807);
    const locked = stopFor(dinner.id, 'Dinner', { locked: true, fixedStartMin: 19 * 60, durationMin: 90 });

    const body = (await propose(token, plan.id, { draft: [locked] })).body as ProposalsResultDTO;
    expect(body.proposals.length).toBeGreaterThan(0);
    for (const p of body.proposals) {
      const kept = p.stops.find((s) => s.ideaId === dinner.id)!;
      expect(kept.id).toBe(locked.id);
      expect(kept.startMin).toBe(19 * 60);
    }
  });

  it('is for editors only, and invisible to non-members', async () => {
    const { token: owner } = await login('opt-owner@example.com');
    const { token: viewer, userId: viewerId } = await login('opt-viewer@example.com');
    const { token: stranger } = await login('opt-stranger@example.com');
    const plan = await datePlan(owner);
    await db.planMember.create({ data: { planId: plan.id, userId: viewerId, role: 'VIEWER' } });
    expect((await propose(viewer, plan.id)).status).toBe(403);
    expect((await propose(stranger, plan.id)).status).toBe(404);
  });
});

describe('Ask Orbit', () => {
  async function setup(prefix: string) {
    const owner = await login(`${prefix}-owner@example.com`);
    const editor = await login(`${prefix}-editor@example.com`);
    const viewer = await login(`${prefix}-viewer@example.com`);
    const plan = await datePlan(owner.token);
    await db.planMember.createMany({
      data: [
        { planId: plan.id, userId: editor.userId, role: 'EDITOR' },
        { planId: plan.id, userId: viewer.userId, role: 'VIEWER' },
      ],
    });
    const idea = await place(owner.token, plan.id, 'Hanok Table', 43.6532, -79.3832);
    return { owner, editor, viewer, plan, idea };
  }
  const ask = (token: string, planId: string, ideaId: string, body: Record<string, unknown>) =>
    api().post(`/v1/plans/${planId}/ideas/${ideaId}/ask`).set(bearer(token)).send({ clientRequestId: randomUUID(), ...body });
  const list = (token: string, planId: string, ideaId: string) =>
    api().get(`/v1/plans/${planId}/ideas/${ideaId}/answers`).set(bearer(token)).expect(200);

  it('answers privately with Google Maps sources, then shares on request', async () => {
    const { owner, editor, viewer, plan, idea } = await setup('ask');

    const res = await ask(editor.token, plan.id, idea.id, { preset: 'HOURS' }).expect(201);
    expect(res.body).toMatchObject({ question: 'Hours', preset: 'HOURS', visibility: 'PRIVATE', mine: true, sharedBy: null, checkedWith: 'google_maps' });
    expect(typeof res.body.checkedAt).toBe('string');
    expect(res.body.answer).toContain('Hanok Table');
    // unsafe links never reach the browser
    expect(res.body.sources).toEqual([{ url: 'https://maps.google.com/?cid=123', title: 'Hanok Table', provider: 'google_maps' }]);
    // place questions use Google Maps grounding near the place, with the plan date for hours
    expect(model.calls[0]).toMatchObject({ kind: 'answer', grounding: 'google_maps', location: { lat: 43.6532, lng: -79.3832 } });
    expect(model.calls[0]!.prompt).toContain('Saturday, November 14');

    // private: only the asker sees it
    expect((await list(editor.token, plan.id, idea.id)).body).toHaveLength(1);
    expect((await list(owner.token, plan.id, idea.id)).body).toHaveLength(0);
    expect((await list(viewer.token, plan.id, idea.id)).body).toHaveLength(0);

    // others can't share it (they can't even see it)
    await api().post(`/v1/plans/${plan.id}/answers/${res.body.id}/share`).set(bearer(owner.token)).expect(404);
    const shared = await api().post(`/v1/plans/${plan.id}/answers/${res.body.id}/share`).set(bearer(editor.token)).expect(200);
    expect(shared.body).toMatchObject({ visibility: 'SHARED', sharedBy: { id: editor.userId } });

    const seenByViewer = (await list(viewer.token, plan.id, idea.id)).body;
    expect(seenByViewer).toHaveLength(1);
    expect(seenByViewer[0]).toMatchObject({ visibility: 'SHARED', mine: false });
  });

  it('does not let viewers spend AI, and validates the question', async () => {
    const { viewer, editor, plan, idea } = await setup('ask-rules');
    await ask(viewer.token, plan.id, idea.id, { preset: 'PRICE' }).expect(403);
    await ask(editor.token, plan.id, idea.id, { preset: 'PRICE', question: 'And this too?' }).expect(400);
    await ask(editor.token, plan.id, idea.id, {}).expect(400);
  });

  it('searches the web for questions Google Maps grounding cannot take', async () => {
    const { editor, plan, idea } = await setup('ask-ko');
    await ask(editor.token, plan.id, idea.id, { question: '여기 주차 돼?' }).expect(201);
    expect(model.calls[0]).toMatchObject({ grounding: 'google_search' });
  });

  it('answers without sources, marked unchecked, when the key can’t use grounding', async () => {
    const { editor, plan, idea } = await setup('ask-free-tier');
    model.groundingOff = true;
    const res = await ask(editor.token, plan.id, idea.id, { preset: 'HOURS' }).expect(201);
    expect(res.body).toMatchObject({ checkedWith: null, checkedAt: null, sources: [] });
    expect(res.body.answer).toContain('Hanok Table');
    // tried Google Maps first, then answered without tools, coordinates or the grounded prompt
    expect(model.calls.map((c) => c.grounding)).toEqual(['google_maps', 'none']);
    expect(model.calls[1]).toMatchObject({ location: null });
    expect(model.calls[1]!.system).toContain("can't look anything up");
    // stored the same way, and counted once against the daily limit
    expect((await list(editor.token, plan.id, idea.id)).body[0]).toMatchObject({ checkedWith: null, checkedAt: null });
    const status = await api().get('/v1/ai/status').set(bearer(editor.token)).expect(200);
    expect(status.body.usedToday).toBe(1);
  });

  it('answers a double-tap once', async () => {
    const { editor, plan, idea } = await setup('ask-twice');
    const clientRequestId = randomUUID();
    const first = await ask(editor.token, plan.id, idea.id, { preset: 'TIPS', clientRequestId }).expect(201);
    const again = await ask(editor.token, plan.id, idea.id, { preset: 'TIPS', clientRequestId }).expect(201);
    expect(again.body.id).toBe(first.body.id);
    expect(model.calls.filter((c) => c.kind === 'answer')).toHaveLength(1);
  });

  it('explains provider trouble and keeps failed answers out of the list', async () => {
    const { editor, plan, idea } = await setup('ask-fail');
    model.failNext = new AiError('rate_limited', 'busy');
    const res = await ask(editor.token, plan.id, idea.id, { preset: 'HOURS' }).expect(503);
    expect(res.body.code).toBe('AI_BUSY');
    expect((await list(editor.token, plan.id, idea.id)).body).toEqual([]);

    model.failNext = new AiError('bad_model', 'Gemini model “old-model” isn’t available for this API key. Set GEMINI_MODEL=new-model in .env.');
    const closed = await ask(editor.token, plan.id, idea.id, { preset: 'HOURS' }).expect(503);
    expect(closed.body).toMatchObject({ code: 'AI_MODEL' });
    expect(closed.body.message).toContain('GEMINI_MODEL=new-model');
  });

  it('lets the asker hide an answer', async () => {
    const { editor, owner, plan, idea } = await setup('ask-hide');
    const res = await ask(editor.token, plan.id, idea.id, { preset: 'RESERVATIONS' }).expect(201);
    await api().post(`/v1/plans/${plan.id}/answers/${res.body.id}/hide`).set(bearer(owner.token)).expect(404); // private: not theirs
    await api().post(`/v1/plans/${plan.id}/answers/${res.body.id}/hide`).set(bearer(editor.token)).expect(204);
    expect((await list(editor.token, plan.id, idea.id)).body).toEqual([]);
  });

  it('stops at the daily limit; plan options keep working without AI wording', async () => {
    const { editor, plan, idea } = await setup('ask-limit');
    for (let i = 0; i < 6; i += 1) await ask(editor.token, plan.id, idea.id, { preset: 'TIPS' }).expect(201);
    const over = await ask(editor.token, plan.id, idea.id, { preset: 'TIPS' }).expect(429);
    expect(over.body.code).toBe('AI_LIMIT');

    await place(editor.token, plan.id, 'Second place', 43.6544, -79.3807);
    const body = (await propose(editor.token, plan.id, { note: 'chill' })).body as ProposalsResultDTO;
    expect(body.proposals.length).toBeGreaterThan(0);
    expect(body.ai.used).toBe(false);
    expect(body.ai.notice).toMatch(/today’s AI requests/);
    expect(body.proposals[0]!.why).toBeNull();
  });
});
