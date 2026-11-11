import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createPrismaClient, type PrismaClient } from '@orbit/db';
import { startEphemeralPostgres, type EphemeralPostgres } from '@orbit/db/testing';
import { createHash, randomUUID } from 'node:crypto';
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
  process.env.AI_PROVIDER = 'off';
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
const uid = () => randomUUID().slice(0, 8);

interface Person {
  token: string;
  userId: string;
}

async function login(name: string): Promise<Person> {
  const res = await api().post('/v1/auth/dev-login').send({ email: `${name}-${uid()}@example.com`, name }).expect(200);
  return { token: res.body.token, userId: res.body.user.id };
}

async function createPlan(owner: Person) {
  const res = await api().post('/v1/plans').set(bearer(owner.token)).send({ clientRequestId: randomUUID(), type: 'HANGOUT', name: 'Friday hangout' }).expect(201);
  return res.body as { id: string };
}

async function addMember(planId: string, person: Person, role: 'EDITOR' | 'VIEWER') {
  await db.planMember.create({ data: { planId, userId: person.userId, role } });
}

async function createNote(owner: Person, planId: string, title = 'Ramen place') {
  const res = await api().post(`/v1/plans/${planId}/ideas`).set(bearer(owner.token)).send({ clientRequestId: randomUUID(), kind: 'NOTE', title }).expect(201);
  return res.body.idea as { id: string };
}

async function createInvite(person: Person, planId: string, body: Record<string, unknown> = {}) {
  const res = await api()
    .post(`/v1/plans/${planId}/invites`)
    .set(bearer(person.token))
    .send({ role: 'EDITOR', expiresIn: 'WEEK', maxUses: null, ...body })
    .expect(201);
  return res.body as { token: string; invite: { id: string; role: string; canRevoke: boolean; useCount: number } };
}

const accept = (person: Person, token: string) => api().post('/v1/invites/accept').set(bearer(person.token)).send({ token });

/** A plan with an owner, an editor and a viewer. */
async function team() {
  const owner = await login('Owner');
  const editor = await login('Editor');
  const viewer = await login('Viewer');
  const plan = await createPlan(owner);
  await addMember(plan.id, editor, 'EDITOR');
  await addMember(plan.id, viewer, 'VIEWER');
  return { owner, editor, viewer, plan };
}

describe('invite links', () => {
  it('can be made by owners and editors, not viewers or strangers', async () => {
    const { owner, editor, viewer, plan } = await team();
    const stranger = await login('Stranger');
    await createInvite(owner, plan.id);
    await createInvite(editor, plan.id, { role: 'VIEWER' });
    const body = { role: 'EDITOR', expiresIn: 'WEEK', maxUses: null };
    await api().post(`/v1/plans/${plan.id}/invites`).set(bearer(viewer.token)).send(body).expect(403);
    await api().post(`/v1/plans/${plan.id}/invites`).set(bearer(stranger.token)).send(body).expect(404);
    await api().get(`/v1/plans/${plan.id}/invites`).set(bearer(viewer.token)).expect(403);
  });

  it('can’t grant the owner role', async () => {
    const { owner, plan } = await team();
    await api().post(`/v1/plans/${plan.id}/invites`).set(bearer(owner.token)).send({ role: 'OWNER', expiresIn: 'WEEK', maxUses: null }).expect(400);
  });

  it('stores only a hash of the token', async () => {
    const { owner, plan } = await team();
    const { token, invite } = await createInvite(owner, plan.id);
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    const row = await db.inviteLink.findUniqueOrThrow({ where: { id: invite.id } });
    expect(row.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(JSON.stringify(row)).not.toContain(token);
    // …and the list never repeats it.
    const list = await api().get(`/v1/plans/${plan.id}/invites`).set(bearer(owner.token)).expect(200);
    expect(JSON.stringify(list.body)).not.toContain(token);
  });

  it('previews without signing in, and knows when you are already in', async () => {
    const { owner, plan } = await team();
    const { token } = await createInvite(owner, plan.id, { role: 'VIEWER' });
    const anonymous = await api().post('/v1/invites/preview').send({ token }).expect(200);
    expect(anonymous.body).toMatchObject({ plan: { id: plan.id, name: 'Friday hangout', memberCount: 3 }, role: 'VIEWER', invitedBy: { name: 'Owner' }, myRole: null });
    expect(anonymous.body.plan.members).toHaveLength(3);
    expect(JSON.stringify(anonymous.body)).not.toContain('@example.com');

    const member = await api().post('/v1/invites/preview').set(bearer(owner.token)).send({ token }).expect(200);
    expect(member.body.myRole).toBe('OWNER');
    // A stale session on a public route is ignored, not an error.
    await api().post('/v1/invites/preview').set(bearer('not-a-token')).send({ token }).expect(200);
  });

  it('adds new people with the link’s role, and re-opening it changes nothing', async () => {
    const { owner, plan } = await team();
    const newcomer = await login('Newcomer');
    const { token, invite } = await createInvite(owner, plan.id, { role: 'VIEWER' });

    const first = await accept(newcomer, token).expect(200);
    expect(first.body).toEqual({ planId: plan.id, role: 'VIEWER', joined: true });
    await api().get(`/v1/plans/${plan.id}`).set(bearer(newcomer.token)).expect(200);

    const again = await accept(newcomer, token).expect(200);
    expect(again.body).toEqual({ planId: plan.id, role: 'VIEWER', joined: false });
    expect((await db.inviteLink.findUniqueOrThrow({ where: { id: invite.id } })).useCount).toBe(1);
    const events = await db.activityEvent.count({ where: { planId: plan.id, type: 'member.joined' } });
    expect(events).toBe(1);
  });

  it('never changes an existing member’s role (no promoting yourself with an old link)', async () => {
    const { owner, editor, plan } = await team();
    const { token } = await createInvite(editor, plan.id, { role: 'EDITOR' });
    // The owner makes the editor a viewer; the editor tries their own old link.
    await api().patch(`/v1/plans/${plan.id}/members/${editor.userId}`).set(bearer(owner.token)).send({ role: 'VIEWER' }).expect(200);
    const res = await accept(editor, token).expect(200);
    expect(res.body).toMatchObject({ role: 'VIEWER', joined: false });
    // The owner opening any link stays the owner.
    const { token: ownerLink } = await createInvite(owner, plan.id, { role: 'VIEWER' });
    expect((await accept(owner, ownerLink).expect(200)).body.role).toBe('OWNER');
  });

  it('explains expired, turned-off and used-up links', async () => {
    const { owner, plan } = await team();
    const expired = await createInvite(owner, plan.id);
    await db.inviteLink.update({ where: { id: expired.invite.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const revoked = await createInvite(owner, plan.id);
    await api().post(`/v1/plans/${plan.id}/invites/${revoked.invite.id}/revoke`).set(bearer(owner.token)).expect(204);
    const single = await createInvite(owner, plan.id, { maxUses: 1 });
    await accept(await login('First'), single.token).expect(200);

    const late = await login('Late');
    const cases: Array<[string, string]> = [
      [expired.token, 'INVITE_EXPIRED'],
      [revoked.token, 'INVITE_REVOKED'],
      [single.token, 'INVITE_USED_UP'],
    ];
    for (const [token, code] of cases) {
      const preview = await api().post('/v1/invites/preview').send({ token }).expect(410);
      expect(preview.body.code).toBe(code);
      const join = await accept(late, token).expect(410);
      expect(join.body.code).toBe(code);
    }
    const unknown = await api().post('/v1/invites/preview').send({ token: 'x'.repeat(32) }).expect(404);
    expect(unknown.body.code).toBe('INVITE_INVALID');
    await api().post('/v1/invites/preview').send({ token: 'short' }).expect(400);
    expect(await db.planMember.count({ where: { planId: plan.id, userId: late.userId } })).toBe(0);
  });

  it('still lets members open an old link to get to the plan', async () => {
    const { owner, viewer, plan } = await team();
    const link = await createInvite(owner, plan.id);
    await api().post(`/v1/plans/${plan.id}/invites/${link.invite.id}/revoke`).set(bearer(owner.token)).expect(204);
    const preview = await api().post('/v1/invites/preview').set(bearer(viewer.token)).send({ token: link.token }).expect(200);
    expect(preview.body.myRole).toBe('VIEWER');
    expect((await accept(viewer, link.token).expect(200)).body).toMatchObject({ planId: plan.id, joined: false });
  });

  it('lets exactly one person in through a one-person link, even all at once', async () => {
    const { owner, plan } = await team();
    const { token, invite } = await createInvite(owner, plan.id, { maxUses: 1 });
    const people = await Promise.all(['A', 'B', 'C', 'D', 'E'].map((n) => login(n)));
    const results = await Promise.all(people.map((p) => accept(p, token)));
    expect(results.filter((r) => r.status === 200 && r.body.joined)).toHaveLength(1);
    expect(results.filter((r) => r.status === 410 && r.body.code === 'INVITE_USED_UP')).toHaveLength(4);
    expect((await db.inviteLink.findUniqueOrThrow({ where: { id: invite.id } })).useCount).toBe(1);
    expect(await db.planMember.count({ where: { planId: plan.id } })).toBe(4);
  });

  it('counts a double-tapped Join once', async () => {
    const { owner, plan } = await team();
    for (const maxUses of [null, 1]) {
      const { token, invite } = await createInvite(owner, plan.id, { maxUses });
      const person = await login('Tapper');
      const [a, b] = await Promise.all([accept(person, token), accept(person, token)]);
      expect([a.status, b.status]).toEqual([200, 200]);
      expect([a.body.joined, b.body.joined].sort()).toEqual([false, true]);
      expect((await db.inviteLink.findUniqueOrThrow({ where: { id: invite.id } })).useCount).toBe(1);
    }
  });

  it('lists only working links, and says who can turn each off', async () => {
    const { owner, editor, plan } = await team();
    const mine = await createInvite(editor, plan.id);
    const owners = await createInvite(owner, plan.id);
    const used = await createInvite(owner, plan.id, { maxUses: 1 });
    await accept(await login('Joiner'), used.token).expect(200);

    const asEditor = await api().get(`/v1/plans/${plan.id}/invites`).set(bearer(editor.token)).expect(200);
    expect(asEditor.body.map((i: { id: string }) => i.id)).toEqual([owners.invite.id, mine.invite.id]);
    const canRevoke = Object.fromEntries(asEditor.body.map((i: { id: string; canRevoke: boolean }) => [i.id, i.canRevoke]));
    expect(canRevoke).toEqual({ [mine.invite.id]: true, [owners.invite.id]: false });

    // Editors turn off their own links only; the owner can turn off any.
    await api().post(`/v1/plans/${plan.id}/invites/${owners.invite.id}/revoke`).set(bearer(editor.token)).expect(403);
    await api().post(`/v1/plans/${plan.id}/invites/${mine.invite.id}/revoke`).set(bearer(editor.token)).expect(204);
    await api().post(`/v1/plans/${plan.id}/invites/${owners.invite.id}/revoke`).set(bearer(owner.token)).expect(204);
    await api().post(`/v1/plans/${plan.id}/invites/${owners.invite.id}/revoke`).set(bearer(owner.token)).expect(204);
    expect((await api().get(`/v1/plans/${plan.id}/invites`).set(bearer(owner.token)).expect(200)).body).toEqual([]);
  });

  it('doesn’t reach links of other plans', async () => {
    const { owner, plan } = await team();
    const other = await team();
    const theirs = await createInvite(other.owner, other.plan.id);
    await api().post(`/v1/plans/${plan.id}/invites/${theirs.invite.id}/revoke`).set(bearer(owner.token)).expect(404);
  });

  it('caps active links per plan', async () => {
    const { owner, plan } = await team();
    for (let i = 0; i < 20; i++) await createInvite(owner, plan.id);
    const res = await api().post(`/v1/plans/${plan.id}/invites`).set(bearer(owner.token)).send({ role: 'VIEWER', expiresIn: 'DAY', maxUses: null }).expect(409);
    expect(res.body.code).toBe('TOO_MANY_INVITES');
  });
});

describe('members', () => {
  it('lets the owner change roles, but not the owner’s own', async () => {
    const { owner, editor, plan } = await team();
    const res = await api().patch(`/v1/plans/${plan.id}/members/${editor.userId}`).set(bearer(owner.token)).send({ role: 'VIEWER' }).expect(200);
    expect(res.body.members.find((m: { id: string }) => m.id === editor.userId).role).toBe('VIEWER');
    await api().post(`/v1/plans/${plan.id}/ideas`).set(bearer(editor.token)).send({ clientRequestId: randomUUID(), kind: 'NOTE', title: 'x' }).expect(403);

    const own = await api().patch(`/v1/plans/${plan.id}/members/${owner.userId}`).set(bearer(owner.token)).send({ role: 'VIEWER' }).expect(409);
    expect(own.body.code).toBe('OWNER_ROLE');
    await api().patch(`/v1/plans/${plan.id}/members/${owner.userId}`).set(bearer(owner.token)).send({ role: 'OWNER' }).expect(400);
  });

  it('is managed by the owner only', async () => {
    const { editor, viewer, plan } = await team();
    await api().patch(`/v1/plans/${plan.id}/members/${viewer.userId}`).set(bearer(editor.token)).send({ role: 'EDITOR' }).expect(403);
    await api().delete(`/v1/plans/${plan.id}/members/${viewer.userId}`).set(bearer(editor.token)).expect(403);
    const ghost = await login('Ghost');
    const { owner } = await team();
    await api().delete(`/v1/plans/${plan.id}/members/${ghost.userId}`).set(bearer(owner.token)).expect(404);
  });

  it('turns off links of people who can no longer invite', async () => {
    const { owner, editor, plan } = await team();
    const a = await createInvite(editor, plan.id);
    await api().patch(`/v1/plans/${plan.id}/members/${editor.userId}`).set(bearer(owner.token)).send({ role: 'VIEWER' }).expect(200);
    expect((await db.inviteLink.findUniqueOrThrow({ where: { id: a.invite.id } })).revokedAt).not.toBeNull();

    await api().patch(`/v1/plans/${plan.id}/members/${editor.userId}`).set(bearer(owner.token)).send({ role: 'EDITOR' }).expect(200);
    const b = await createInvite(editor, plan.id);
    await api().delete(`/v1/plans/${plan.id}/members/${editor.userId}`).set(bearer(owner.token)).expect(204);
    const late = await login('Late');
    expect((await accept(late, b.token).expect(410)).body.code).toBe('INVITE_REVOKED');
    // …so a removed member can't walk back in through their own link.
    expect((await accept(editor, b.token).expect(410)).body.code).toBe('INVITE_REVOKED');
  });

  it('removing someone takes away access and their interest marks, but keeps their comments', async () => {
    const { owner, editor, plan } = await team();
    const idea = await createNote(owner, plan.id);
    await api().put(`/v1/plans/${plan.id}/ideas/${idea.id}/reaction`).set(bearer(editor.token)).send({ kind: 'INTERESTED' }).expect(200);
    await api().post(`/v1/plans/${plan.id}/ideas/${idea.id}/comments`).set(bearer(editor.token)).send({ clientRequestId: randomUUID(), content: 'I’m in!' }).expect(201);

    await api().delete(`/v1/plans/${plan.id}/members/${editor.userId}`).set(bearer(owner.token)).expect(204);
    await api().get(`/v1/plans/${plan.id}`).set(bearer(editor.token)).expect(404);
    const ideas = await api().get(`/v1/plans/${plan.id}/ideas`).set(bearer(owner.token)).expect(200);
    expect(ideas.body[0].interested).toEqual([]);
    const comments = await api().get(`/v1/plans/${plan.id}/ideas/${idea.id}/comments`).set(bearer(owner.token)).expect(200);
    expect(comments.body.map((c: { content: string }) => c.content)).toEqual(['I’m in!']);
    const owners = await api().delete(`/v1/plans/${plan.id}/members/${owner.userId}`).set(bearer(owner.token)).expect(409);
    expect(owners.body.code).toBe('OWNER_REMOVE');
  });

  it('lets anyone but the owner leave', async () => {
    const { owner, viewer, plan } = await team();
    await api().post(`/v1/plans/${plan.id}/leave`).set(bearer(viewer.token)).expect(204);
    await api().get(`/v1/plans/${plan.id}`).set(bearer(viewer.token)).expect(404);
    const plans = await api().get('/v1/plans').set(bearer(viewer.token)).expect(200);
    expect(plans.body).toEqual([]);
    const res = await api().post(`/v1/plans/${plan.id}/leave`).set(bearer(owner.token)).expect(409);
    expect(res.body.code).toBe('OWNER_LEAVE');
  });
});

describe('comments', () => {
  it('can be posted by every member, viewers included; strangers get 404', async () => {
    const { owner, editor, viewer, plan } = await team();
    const stranger = await login('Stranger');
    const idea = await createNote(owner, plan.id);
    for (const [who, text] of [
      [owner, 'Open late?'],
      [editor, 'Until 11'],
      [viewer, 'Count me in'],
    ] as const) {
      await api().post(`/v1/plans/${plan.id}/ideas/${idea.id}/comments`).set(bearer(who.token)).send({ clientRequestId: randomUUID(), content: `  ${text}  ` }).expect(201);
    }
    await api().post(`/v1/plans/${plan.id}/ideas/${idea.id}/comments`).set(bearer(stranger.token)).send({ clientRequestId: randomUUID(), content: 'hi' }).expect(404);
    await api().get(`/v1/plans/${plan.id}/ideas/${idea.id}/comments`).set(bearer(stranger.token)).expect(404);

    const list = await api().get(`/v1/plans/${plan.id}/ideas/${idea.id}/comments`).set(bearer(viewer.token)).expect(200);
    expect(list.body.map((c: { content: string }) => c.content)).toEqual(['Open late?', 'Until 11', 'Count me in']);
    expect(list.body.map((c: { mine: boolean; canDelete: boolean }) => [c.mine, c.canDelete])).toEqual([
      [false, false],
      [false, false],
      [true, true],
    ]);
    expect(list.body[0].author).toEqual({ id: owner.userId, name: 'Owner', color: expect.any(String) });
  });

  it('validates the text', async () => {
    const { owner, plan } = await team();
    const idea = await createNote(owner, plan.id);
    const post = (content: string) => api().post(`/v1/plans/${plan.id}/ideas/${idea.id}/comments`).set(bearer(owner.token)).send({ clientRequestId: randomUUID(), content });
    await post('   ').expect(400);
    await post('x'.repeat(1001)).expect(400);
    await post('x'.repeat(1000)).expect(201);
  });

  it('posts once per request id, even when sent twice at once', async () => {
    const { owner, plan } = await team();
    const idea = await createNote(owner, plan.id);
    const body = { clientRequestId: randomUUID(), content: 'Booked!' };
    const send = () => api().post(`/v1/plans/${plan.id}/ideas/${idea.id}/comments`).set(bearer(owner.token)).send(body);
    const [a, b] = await Promise.all([send(), send()]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.id).toBe(b.body.id);
    expect((await send().expect(201)).body.id).toBe(a.body.id);
    expect(await db.comment.count({ where: { ideaId: idea.id } })).toBe(1);
  });

  it('lets authors edit only their own', async () => {
    const { owner, editor, plan } = await team();
    const idea = await createNote(owner, plan.id);
    const posted = await api().post(`/v1/plans/${plan.id}/ideas/${idea.id}/comments`).set(bearer(editor.token)).send({ clientRequestId: randomUUID(), content: 'Fri?' }).expect(201);
    await api().patch(`/v1/plans/${plan.id}/comments/${posted.body.id}`).set(bearer(owner.token)).send({ content: 'Sat?' }).expect(403);
    const edited = await api().patch(`/v1/plans/${plan.id}/comments/${posted.body.id}`).set(bearer(editor.token)).send({ content: 'Saturday?' }).expect(200);
    expect(edited.body).toMatchObject({ content: 'Saturday?', mine: true });
    expect(edited.body.editedAt).not.toBeNull();
  });

  it('lets authors delete their own, and the owner delete anyone’s', async () => {
    const { owner, editor, viewer, plan } = await team();
    const idea = await createNote(owner, plan.id);
    const post = async (who: Person, content: string) =>
      (await api().post(`/v1/plans/${plan.id}/ideas/${idea.id}/comments`).set(bearer(who.token)).send({ clientRequestId: randomUUID(), content }).expect(201)).body.id as string;
    const byViewer = await post(viewer, 'mine');
    const byEditor = await post(editor, 'rude');

    await api().delete(`/v1/plans/${plan.id}/comments/${byEditor}`).set(bearer(viewer.token)).expect(403);
    await api().delete(`/v1/plans/${plan.id}/comments/${byViewer}`).set(bearer(viewer.token)).expect(204);
    await api().delete(`/v1/plans/${plan.id}/comments/${byViewer}`).set(bearer(viewer.token)).expect(204);
    await api().delete(`/v1/plans/${plan.id}/comments/${byEditor}`).set(bearer(owner.token)).expect(204);
    await api().patch(`/v1/plans/${plan.id}/comments/${byEditor}`).set(bearer(editor.token)).send({ content: 'sorry' }).expect(404);

    const list = await api().get(`/v1/plans/${plan.id}/ideas/${idea.id}/comments`).set(bearer(owner.token)).expect(200);
    expect(list.body).toEqual([]);
    const moderated = await db.activityEvent.findFirstOrThrow({ where: { planId: plan.id, type: 'comment.deleted', actorId: owner.userId } });
    expect(moderated.payload).toMatchObject({ commentId: byEditor, moderated: true });
  });

  it('stays inside its plan', async () => {
    const { owner, plan } = await team();
    const other = await team();
    const theirIdea = await createNote(other.owner, other.plan.id);
    const theirComment = await api().post(`/v1/plans/${other.plan.id}/ideas/${theirIdea.id}/comments`).set(bearer(other.owner.token)).send({ clientRequestId: randomUUID(), content: 'secret' }).expect(201);
    await api().get(`/v1/plans/${plan.id}/ideas/${theirIdea.id}/comments`).set(bearer(owner.token)).expect(404);
    await api().post(`/v1/plans/${plan.id}/ideas/${theirIdea.id}/comments`).set(bearer(owner.token)).send({ clientRequestId: randomUUID(), content: 'x' }).expect(404);
    await api().delete(`/v1/plans/${plan.id}/comments/${theirComment.body.id}`).set(bearer(owner.token)).expect(404);
    await api().patch(`/v1/plans/${plan.id}/comments/${theirComment.body.id}`).set(bearer(owner.token)).send({ content: 'x' }).expect(404);
  });

  it('shows up as a count on cards, without deleted ones', async () => {
    const { owner, plan } = await team();
    const idea = await createNote(owner, plan.id);
    const ids: string[] = [];
    for (const content of ['a', 'b', 'c']) {
      ids.push((await api().post(`/v1/plans/${plan.id}/ideas/${idea.id}/comments`).set(bearer(owner.token)).send({ clientRequestId: randomUUID(), content }).expect(201)).body.id);
    }
    await api().delete(`/v1/plans/${plan.id}/comments/${ids[1]}`).set(bearer(owner.token)).expect(204);
    const ideas = await api().get(`/v1/plans/${plan.id}/ideas`).set(bearer(owner.token)).expect(200);
    expect(ideas.body[0].commentCount).toBe(2);
  });

  it('can’t be added to an archived idea', async () => {
    const { owner, plan } = await team();
    const idea = await createNote(owner, plan.id);
    await api().post(`/v1/plans/${plan.id}/ideas/${idea.id}/archive`).set(bearer(owner.token)).expect(200);
    const res = await api().post(`/v1/plans/${plan.id}/ideas/${idea.id}/comments`).set(bearer(owner.token)).send({ clientRequestId: randomUUID(), content: 'x' }).expect(409);
    expect(res.body.code).toBe('IDEA_ARCHIVED');
  });
});
