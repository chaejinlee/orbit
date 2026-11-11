import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createPrismaClient, signSessionToken, type PrismaClient } from '@orbit/db';
import { startEphemeralPostgres, type EphemeralPostgres } from '@orbit/db/testing';
import type { DraftStop } from '@orbit/shared';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule, configureApp } from '../src/app.module';
import { CONFIG, type Config } from '../src/core/tokens';

let pg: EphemeralPostgres;
let app: INestApplication;
let db: PrismaClient;

beforeAll(async () => {
  pg = await startEphemeralPostgres();
  process.env.DATABASE_URL = pg.url;
  process.env.AUTH_DEV_LOGIN = 'true';
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
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

const api = () => request(app.getHttpServer());
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function login(email: string): Promise<{ token: string; userId: string }> {
  const res = await api().post('/v1/auth/dev-login').send({ email }).expect(200);
  return { token: res.body.token, userId: res.body.user.id };
}

async function createPlan(token: string, body: Record<string, unknown> = {}) {
  const res = await api()
    .post('/v1/plans')
    .set(bearer(token))
    .send({ clientRequestId: randomUUID(), type: 'DATE', ...body })
    .expect(201);
  return res.body as { id: string; name: string; currentVersion: number };
}

async function createNote(token: string, planId: string, title: string) {
  const res = await api()
    .post(`/v1/plans/${planId}/ideas`)
    .set(bearer(token))
    .send({ clientRequestId: randomUUID(), kind: 'NOTE', title })
    .expect(201);
  return res.body.idea as { id: string; title: string };
}

function draftStop(ideaId: string | null, title: string, extra: Partial<DraftStop> = {}): DraftStop {
  return {
    id: randomUUID(),
    ideaId,
    title,
    position: `a${Math.random().toString(36).slice(2, 6)}`,
    dayIndex: 0,
    durationMin: 60,
    fixedStartMin: null,
    locked: false,
    travelMinFromPrev: 15,
    costMinor: null,
    costCurrency: null,
    ...extra,
  };
}

describe('authentication', () => {
  it('rejects requests without a valid token', async () => {
    await api().get('/v1/plans').expect(401);
    const forged = await signSessionToken({ userId: 'u1', name: 'x' }, 'some-other-secret-that-is-long-enough!!');
    await api().get('/v1/plans').set(bearer(forged)).expect(401);
  });

  it('signs in with the development login', async () => {
    const { token } = await login('ana@example.com');
    const me = await api().get('/v1/auth/me').set(bearer(token)).expect(200);
    expect(me.body).toMatchObject({ email: 'ana@example.com', name: 'Ana' });
  });
});

describe('plans', () => {
  it('names the plan and makes the creator its owner', async () => {
    const { token } = await login('owner@example.com');
    const plan = await createPlan(token, { startDate: '2026-11-14', city: 'Toronto' });
    expect(plan).toMatchObject({ name: 'Saturday Date', myRole: 'OWNER', endDate: '2026-11-14' });
  });

  it('creates exactly one plan when the same request is sent twice at once', async () => {
    const { token, userId } = await login('doubleclick@example.com');
    const body = { clientRequestId: randomUUID(), type: 'HANGOUT' };
    const [a, b] = await Promise.all([
      api().post('/v1/plans').set(bearer(token)).send(body),
      api().post('/v1/plans').set(bearer(token)).send(body),
    ]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.id).toBe(b.body.id);
    expect(await db.plan.count({ where: { createdById: userId } })).toBe(1);
  });

  it('returns 404 (not 403) to non-members so plan ids cannot be probed', async () => {
    const { token: owner } = await login('private@example.com');
    const { token: stranger } = await login('stranger@example.com');
    const plan = await createPlan(owner);
    await api().get(`/v1/plans/${plan.id}`).set(bearer(stranger)).expect(404);
    await api().get(`/v1/plans/${plan.id}/ideas`).set(bearer(stranger)).expect(404);
  });

  it('validates the merged result of a partial update', async () => {
    const { token } = await login('patcher@example.com');
    const plan = await createPlan(token, { startMin: 900, endMin: 1260 });
    const res = await api().patch(`/v1/plans/${plan.id}`).set(bearer(token)).send({ endMin: 600 }).expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });
});

describe('roles', () => {
  it('lets a viewer react but not edit or confirm', async () => {
    const { token: owner } = await login('host@example.com');
    const { token: viewer, userId: viewerId } = await login('guest@example.com');
    const plan = await createPlan(owner);
    const idea = await createNote(owner, plan.id, 'Karaoke');
    await db.planMember.create({ data: { planId: plan.id, userId: viewerId, role: 'VIEWER' } });

    await api().put(`/v1/plans/${plan.id}/ideas/${idea.id}/reaction`).set(bearer(viewer)).send({ kind: 'INTERESTED' }).expect(200);
    await api()
      .post(`/v1/plans/${plan.id}/ideas`)
      .set(bearer(viewer))
      .send({ clientRequestId: randomUUID(), kind: 'NOTE', title: 'Sneaky' })
      .expect(403);
    await api()
      .post(`/v1/plans/${plan.id}/itinerary/commits`)
      .set(bearer(viewer))
      .send({ expectedVersion: 0, stops: [draftStop(idea.id, 'Karaoke')] })
      .expect(403);
  });
});

describe('ideas', () => {
  it('saves a cleaned link and flags the same link pasted again', async () => {
    const { token } = await login('linker@example.com');
    const plan = await createPlan(token);
    const created = await api()
      .post(`/v1/plans/${plan.id}/ideas`)
      .set(bearer(token))
      .send({ clientRequestId: randomUUID(), kind: 'LINK', url: 'https://www.instagram.com/reel/Cx1AbC/?igsh=tracking' })
      .expect(201);
    expect(created.body.idea).toMatchObject({ kind: 'LINK', title: 'Instagram reel' });
    expect(created.body.idea.sources[0]).toMatchObject({ url: 'https://www.instagram.com/reel/Cx1AbC/', platform: 'instagram' });

    const preview = await api()
      .post(`/v1/plans/${plan.id}/ideas/preview`)
      .set(bearer(token))
      .send({ kind: 'LINK', url: 'instagram.com/p/Cx1AbC' })
      .expect(200);
    expect(preview.body.duplicates).toEqual([
      expect.objectContaining({ ideaId: created.body.idea.id, reasons: ['same_link'] }),
    ]);

    const bad = await api()
      .post(`/v1/plans/${plan.id}/ideas/preview`)
      .set(bearer(token))
      .send({ kind: 'LINK', url: 'javascript:alert(1)' })
      .expect(400);
    expect(bad.body.code).toBe('INVALID_LINK');
  });

  it('merges a duplicate into the existing idea once, even when retried', async () => {
    const { token: a } = await login('mina@example.com');
    const { token: b, userId: bId } = await login('jun@example.com');
    const plan = await createPlan(a);
    await db.planMember.create({ data: { planId: plan.id, userId: bId, role: 'EDITOR' } });
    const place = await api()
      .post(`/v1/plans/${plan.id}/ideas`)
      .set(bearer(a))
      .send({ clientRequestId: randomUUID(), kind: 'PLACE', place: { name: 'Hanok Table', lat: 43.6629, lng: -79.4146 } })
      .expect(201);

    const preview = await api()
      .post(`/v1/plans/${plan.id}/ideas/preview`)
      .set(bearer(b))
      .send({ kind: 'PLACE', place: { name: 'hanok table', lat: 43.66291, lng: -79.41462 } })
      .expect(200);
    expect(preview.body.duplicates[0]).toMatchObject({ ideaId: place.body.idea.id, confidence: 'high' });

    const merge = {
      clientRequestId: randomUUID(),
      kind: 'LINK',
      url: 'https://www.google.com/maps/search/?api=1&query=Hanok+Table',
      mergeIntoIdeaId: place.body.idea.id,
    };
    const first = await api().post(`/v1/plans/${plan.id}/ideas`).set(bearer(b)).send(merge).expect(201);
    const retry = await api().post(`/v1/plans/${plan.id}/ideas`).set(bearer(b)).send(merge).expect(201);
    expect(first.body).toMatchObject({ merged: true, replayed: false });
    expect(retry.body).toMatchObject({ merged: true, replayed: true });
    expect(retry.body.idea.sources).toHaveLength(1);
    expect(retry.body.idea.interested.map((p: { id: string }) => p.id)).toEqual([bId]);
    expect(await db.idea.count({ where: { planId: plan.id } })).toBe(1);
  });

  it('scopes idea ids to their plan', async () => {
    const { token } = await login('scoper@example.com');
    const planA = await createPlan(token);
    const planB = await createPlan(token);
    const idea = await createNote(token, planA.id, 'Only in A');
    await api().patch(`/v1/plans/${planB.id}/ideas/${idea.id}`).set(bearer(token)).send({ title: 'hijack' }).expect(404);
  });
});

describe('itinerary commits', () => {
  it('versions commits and refuses a draft based on a stale version', async () => {
    const { token } = await login('committer@example.com');
    const plan = await createPlan(token, { startMin: 15 * 60, endMin: 21 * 60 });
    const coffee = await createNote(token, plan.id, 'Coffee');

    const v1 = await api()
      .post(`/v1/plans/${plan.id}/itinerary/commits`)
      .set(bearer(token))
      .send({ expectedVersion: 0, stops: [draftStop(coffee.id, 'Coffee')], note: 'first pass' })
      .expect(201);
    expect(v1.body).toMatchObject({ version: 1, note: 'first pass' });
    expect(v1.body.stops[0]).toMatchObject({ title: 'Coffee', startMin: 900, sequence: 0 });

    const stale = await api()
      .post(`/v1/plans/${plan.id}/itinerary/commits`)
      .set(bearer(token))
      .send({ expectedVersion: 0, stops: [draftStop(coffee.id, 'Coffee')] })
      .expect(409);
    expect(stale.body).toMatchObject({ code: 'VERSION_CONFLICT', expectedVersion: 0, currentVersion: 1 });

    const state = await api().get(`/v1/plans/${plan.id}/itinerary`).set(bearer(token)).expect(200);
    expect(state.body.currentVersion).toBe(1);
    expect(state.body.history).toHaveLength(1);
  });

  it('lets exactly one of two concurrent commits win', async () => {
    const { token } = await login('racer@example.com');
    const plan = await createPlan(token);
    const idea = await createNote(token, plan.id, 'Dinner');
    const send = () =>
      api()
        .post(`/v1/plans/${plan.id}/itinerary/commits`)
        .set(bearer(token))
        .send({ expectedVersion: 0, stops: [draftStop(idea.id, 'Dinner')] });
    const results = await Promise.all([send(), send(), send()]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect(await db.itineraryVersion.count({ where: { planId: plan.id } })).toBe(1);
  });

  it('blocks hard-constraint violations unless explicitly accepted', async () => {
    const { token } = await login('strict@example.com');
    const plan = await createPlan(token, { startMin: 15 * 60, endMin: 21 * 60, budget: { amountMinor: 5000, currency: 'CAD' } });
    const dinner = await createNote(token, plan.id, 'Dinner');
    const stops = [draftStop(dinner.id, 'Dinner', { costMinor: 9000, costCurrency: 'CAD' })];

    const rejected = await api()
      .post(`/v1/plans/${plan.id}/itinerary/commits`)
      .set(bearer(token))
      .send({ expectedVersion: 0, stops })
      .expect(422);
    expect(rejected.body.code).toBe('CONSTRAINTS_FAILED');
    expect(rejected.body.issues.map((i: { code: string }) => i.code)).toEqual(['BUDGET_EXCEEDED']);

    await api()
      .post(`/v1/plans/${plan.id}/itinerary/commits`)
      .set(bearer(token))
      .send({ expectedVersion: 0, stops, acceptedIssueCodes: ['BUDGET_EXCEEDED'] })
      .expect(201);
  });

  it('rejects stops that point at another plan’s ideas', async () => {
    const { token } = await login('mixer@example.com');
    const planA = await createPlan(token);
    const planB = await createPlan(token);
    const foreign = await createNote(token, planB.id, 'Elsewhere');
    const res = await api()
      .post(`/v1/plans/${planA.id}/itinerary/commits`)
      .set(bearer(token))
      .send({ expectedVersion: 0, stops: [draftStop(foreign.id, 'Elsewhere')] })
      .expect(400);
    expect(res.body.code).toBe('UNKNOWN_IDEA');
  });
});
