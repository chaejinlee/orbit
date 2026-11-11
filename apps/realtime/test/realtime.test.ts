import { HocuspocusProvider } from '@hocuspocus/provider';
import { createPrismaClient, signSessionToken, type PrismaClient } from '@orbit/db';
import { freePort, startEphemeralPostgres, type EphemeralPostgres } from '@orbit/db/testing';
import { addDraftStop, docNameForPlan, readDraft } from '@orbit/shared/yboard';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createRealtimeServer } from '../src/server';

const SECRET = 'realtime-test-secret-0123456789abcdef';
let pg: EphemeralPostgres;
let prisma: PrismaClient;
let server: ReturnType<typeof createRealtimeServer>;
let url: string;
let planId: string;
const tokens: Record<'owner' | 'editor' | 'viewer' | 'stranger', string> = {
  owner: '',
  editor: '',
  viewer: '',
  stranger: '',
};
const ids: Record<string, string> = {};
const open: HocuspocusProvider[] = [];

const stop = {
  ideaId: null,
  durationMin: 60,
  fixedStartMin: null,
  locked: false,
  travelMinFromPrev: null,
  costMinor: null,
  costCurrency: null,
};

async function until(check: () => boolean | Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 25));
  }
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

function connect(token: string) {
  const doc = new Y.Doc();
  // Documents are multiplexed over one socket, so a per-document close arrives
  // as a CLOSE message: the provider reports code 1000 plus the server's reason.
  const state = { synced: false, authFailed: '' as string, closeReason: '' };
  const provider = new HocuspocusProvider({
    url,
    name: docNameForPlan(planId),
    document: doc,
    token,
    onSynced: () => (state.synced = true),
    onAuthenticationFailed: ({ reason }) => (state.authFailed = reason || 'failed'),
    onClose: ({ event }) => (state.closeReason = event.reason),
  });
  open.push(provider);
  return { doc, provider, state };
}

beforeAll(async () => {
  pg = await startEphemeralPostgres();
  prisma = createPrismaClient(pg.url);
  const port = await freePort();
  url = `ws://127.0.0.1:${port}`;
  server = createRealtimeServer({ prisma, authSecret: SECRET, port, recheckMs: 0, debounce: 50 });
  await server.listen();

  for (const who of Object.keys(tokens) as Array<keyof typeof tokens>) {
    const user = await prisma.user.create({ data: { email: `${who}@test.dev`, name: who } });
    ids[who] = user.id;
    tokens[who] = await signSessionToken({ userId: user.id, name: who }, SECRET);
  }
  const plan = await prisma.plan.create({
    data: {
      type: 'DATE',
      name: 'Realtime test',
      createdById: ids.owner!,
      clientRequestId: randomUUID(),
      members: {
        create: [
          { userId: ids.owner!, role: 'OWNER' },
          { userId: ids.editor!, role: 'EDITOR' },
          { userId: ids.viewer!, role: 'VIEWER' },
        ],
      },
    },
  });
  planId = plan.id;
});

afterEach(() => {
  while (open.length) open.pop()!.destroy();
});

afterAll(async () => {
  await server?.destroy();
  await prisma?.$disconnect();
  await pg?.stop();
});

describe('realtime collaboration server', () => {
  it('syncs the shared draft between members and persists it to Postgres', async () => {
    const owner = connect(tokens.owner);
    const editor = connect(tokens.editor);
    await until(() => owner.state.synced && editor.state.synced);

    addDraftStop(owner.doc, { ...stop, title: 'Coffee' });
    addDraftStop(editor.doc, { ...stop, title: 'Dinner' });
    await until(() => readDraft(owner.doc).length === 2 && readDraft(editor.doc).length === 2);
    expect(readDraft(owner.doc).map((s) => s.title)).toEqual(readDraft(editor.doc).map((s) => s.title));

    await until(async () => {
      const row = await prisma.canvasDocument.findUnique({ where: { planId } });
      if (!row) return false;
      const stored = new Y.Doc();
      Y.applyUpdate(stored, new Uint8Array(row.state));
      return readDraft(stored).length === 2;
    });
  });

  it('refuses invalid sessions and non-members', async () => {
    const forged = connect(await signSessionToken({ userId: ids.owner!, name: 'x' }, 'not-the-real-secret-0123456789abcdef'));
    const stranger = connect(tokens.stranger);
    await until(() => Boolean(forged.state.authFailed) && Boolean(stranger.state.authFailed));
    expect(forged.state.synced).toBe(false);
    expect(stranger.state.synced).toBe(false);
  });

  it('gives viewers a read-only connection', async () => {
    const owner = connect(tokens.owner);
    const viewer = connect(tokens.viewer);
    await until(() => owner.state.synced && viewer.state.synced);
    const before = readDraft(owner.doc).length;

    addDraftStop(viewer.doc, { ...stop, title: 'Viewer was here' });
    await pause(400);
    expect(readDraft(owner.doc)).toHaveLength(before);
  });

  it('closes the socket of a member removed mid-session and drops their edit', async () => {
    const owner = connect(tokens.owner);
    const editor = connect(tokens.editor);
    await until(() => owner.state.synced && editor.state.synced);
    const before = readDraft(owner.doc).length;

    await prisma.planMember.delete({ where: { planId_userId: { planId, userId: ids.editor! } } });
    addDraftStop(editor.doc, { ...stop, title: 'After removal' });

    await until(() => editor.state.closeReason === 'Forbidden');
    await pause(200);
    expect(readDraft(owner.doc)).toHaveLength(before);
  });
});

describe('live hints', () => {
  function listen(token: string) {
    const conn = connect(token);
    const hints: Array<Record<string, unknown>> = [];
    conn.provider.on('stateless', ({ payload }: { payload: string }) => hints.push(JSON.parse(payload) as Record<string, unknown>));
    return { ...conn, hints };
  }

  it('relays a viewer’s hint to the others, stamped with who sent it, and drops anything extra', async () => {
    const owner = listen(tokens.owner);
    const viewer = listen(tokens.viewer);
    await until(() => owner.state.synced && viewer.state.synced);

    viewer.provider.sendStateless(JSON.stringify({ type: 'changed', topics: ['comments'], ideaId: 'idea_1', by: ids.owner, content: 'secret' }));
    await until(() => owner.hints.length === 1);
    expect(owner.hints[0]).toEqual({ type: 'changed', topics: ['comments'], ideaId: 'idea_1', by: ids.viewer });
    await pause(150);
    expect(viewer.hints).toEqual([]); // not echoed back
  });

  it('drops malformed hints and limits how many one connection sends', async () => {
    const owner = listen(tokens.owner);
    const viewer = listen(tokens.viewer);
    await until(() => owner.state.synced && viewer.state.synced);

    for (const bad of ['nope', '{"type":"changed","topics":["passwords"]}', JSON.stringify({ type: 'changed', topics: ['plan'], pad: 'x'.repeat(600) })]) {
      viewer.provider.sendStateless(bad);
    }
    for (let i = 0; i < 40; i++) viewer.provider.sendStateless(JSON.stringify({ type: 'changed', topics: ['ideas'] }));
    await until(() => owner.hints.length >= 30);
    await pause(300);
    expect(owner.hints).toHaveLength(30);
    expect(owner.hints.every((h) => (h.topics as string[]).join() === 'ideas')).toBe(true);
  });
});
