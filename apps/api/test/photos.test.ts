import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createPrismaClient, type PrismaClient } from '@orbit/db';
import { startEphemeralPostgres, type EphemeralPostgres } from '@orbit/db/testing';
import { MAX_PLAN_PHOTOS, type PhotoDTO } from '@orbit/shared';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule, configureApp } from '../src/app.module';
import { CONFIG, type Config } from '../src/core/tokens';
import { PhotosService } from '../src/photos/photos.service';

let pg: EphemeralPostgres;
let app: INestApplication;
let db: PrismaClient;
let uploads: string;

beforeAll(async () => {
  pg = await startEphemeralPostgres();
  uploads = await mkdtemp(join(tmpdir(), 'orbit-photos-'));
  process.env.DATABASE_URL = pg.url;
  process.env.UPLOADS_DIR = uploads;
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
  if (uploads) await rm(uploads, { recursive: true, force: true });
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

async function team() {
  const owner = await login('Owner');
  const editor = await login('Editor');
  const viewer = await login('Viewer');
  const stranger = await login('Stranger');
  const res = await api().post('/v1/plans').set(bearer(owner.token)).send({ clientRequestId: randomUUID(), type: 'TRIP', name: 'Photo trip' }).expect(201);
  const planId = res.body.id as string;
  await db.planMember.createMany({
    data: [
      { planId, userId: editor.userId, role: 'EDITOR' },
      { planId, userId: viewer.userId, role: 'VIEWER' },
    ],
  });
  return { owner, editor, viewer, stranger, planId };
}

const png = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 80 } } }).png().toBuffer();

function upload(person: Person, planId: string, body: Buffer, type = 'image/png', clientRequestId: string = randomUUID()) {
  return api().post(`/v1/plans/${planId}/photos`).query({ clientRequestId }).set(bearer(person.token)).set('Content-Type', type).send(body);
}

/** Fetches a signed photo link the way an <img> does: no session. */
const fetchFile = (path: string) => api().get(path).buffer(true).parse((res, done) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => done(null, Buffer.concat(chunks)));
});

describe('photos', () => {
  it('shrinks, re-encodes and serves an uploaded photo from a signed link', async () => {
    const { editor, viewer, planId } = await team();
    const res = await upload(editor, planId, await png(3000, 1000)).expect(201);
    const photo = res.body as PhotoDTO;
    expect(photo).toMatchObject({ width: 2048, height: 683, uploadedBy: { id: editor.userId } });

    const listed = await api().get(`/v1/plans/${planId}/photos`).set(bearer(viewer.token)).expect(200);
    expect((listed.body as PhotoDTO[]).map((p) => p.id)).toEqual([photo.id]);

    const full = await fetchFile(photo.url).expect(200);
    expect(full.headers['content-type']).toBe('image/webp');
    expect(full.headers['x-content-type-options']).toBe('nosniff');
    expect(full.headers['content-security-policy']).toContain('sandbox');
    expect(full.headers['cache-control']).toMatch(/^private, max-age=\d+$/);
    const meta = await sharp(full.body as Buffer).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['webp', 2048, 683]);

    const thumb = await fetchFile(photo.thumbUrl).expect(200);
    expect((await sharp(thumb.body as Buffer).metadata()).width).toBe(640);
  });

  it('turns photos upright and drops their metadata (no GPS location for the group)', async () => {
    const { editor, planId } = await team();
    const input = await sharp({ create: { width: 120, height: 60, channels: 3, background: '#88aacc' } })
      .jpeg()
      .withMetadata({ orientation: 6 }) // sharp writes the orientation tag itself
      .withExifMerge({ IFD0: { Copyright: 'private-owner' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '43/1 39/1 0/1' } })
      .toBuffer();
    const before = await sharp(input).metadata();
    expect(before.orientation).toBe(6);
    expect(input.includes(Buffer.from('private-owner'))).toBe(true);

    const photo = (await upload(editor, planId, input, 'image/jpeg').expect(201)).body as PhotoDTO;
    expect([photo.width, photo.height]).toEqual([60, 120]); // orientation 6 = rotated a quarter turn
    const served = (await fetchFile(photo.url).expect(200)).body as Buffer;
    const meta = await sharp(served).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(served.includes(Buffer.from('private-owner'))).toBe(false);
  });

  it('lets owners and editors upload, not viewers or strangers', async () => {
    const { owner, viewer, stranger, planId } = await team();
    const body = await png(40, 40);
    await upload(owner, planId, body).expect(201);
    expect((await upload(viewer, planId, body).expect(403)).body.message).toBeTruthy();
    await upload(stranger, planId, body).expect(404);
    await api().get(`/v1/plans/${planId}/photos`).set(bearer(stranger.token)).expect(404);
    await api().post(`/v1/plans/${planId}/photos`).query({ clientRequestId: randomUUID() }).set('Content-Type', 'image/png').send(body).expect(401);
  });

  it('explains files it refuses', async () => {
    const { editor, planId } = await team();
    expect((await upload(editor, planId, Buffer.from('hello'), 'text/plain').expect(415)).body.code).toBe('PHOTO_UNSUPPORTED');
    // Says it's a PNG, isn't one.
    expect((await upload(editor, planId, Buffer.from('<html><script>alert(1)</script></html>')).expect(415)).body.code).toBe('PHOTO_UNSUPPORTED');
    expect((await upload(editor, planId, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml').expect(415)).body.code).toBe(
      'PHOTO_UNSUPPORTED',
    );
    expect((await upload(editor, planId, Buffer.alloc(0)).expect(400)).body.code).toBe('PHOTO_EMPTY');
    const tooBig = await upload(editor, planId, Buffer.alloc(16 * 1024 * 1024, 1)).expect(413);
    expect(tooBig.body.code).toBe('PHOTO_TOO_LARGE');
    await api().post(`/v1/plans/${planId}/photos`).set(bearer(editor.token)).set('Content-Type', 'image/png').send(await png(10, 10)).expect(400); // no request id
    expect(await db.planPhoto.count({ where: { planId } })).toBe(0);
  });

  it('stores a photo once when the same upload is sent twice, even at the same time', async () => {
    const { editor, planId } = await team();
    const body = await png(64, 64);
    const requestId = randomUUID();
    const [a, b] = await Promise.all([upload(editor, planId, body, 'image/png', requestId), upload(editor, planId, body, 'image/png', requestId)]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.id).toBe(b.body.id);
    const again = await upload(editor, planId, body, 'image/png', requestId).expect(201);
    expect(again.body.id).toBe(a.body.id);
    expect(await db.planPhoto.count({ where: { planId } })).toBe(1);
    const files = await readdir(join(uploads, planId));
    expect(files.sort()).toEqual([`${a.body.id}.full.webp`, `${a.body.id}.thumb.webp`]);
  });

  it('refuses an upload id reused for another plan', async () => {
    const first = await team();
    const other = await db.plan.create({
      data: { type: 'DATE', name: 'Other', createdById: first.editor.userId, clientRequestId: randomUUID(), members: { create: { userId: first.editor.userId, role: 'OWNER' } } },
    });
    const requestId = randomUUID();
    await upload(first.editor, first.planId, await png(20, 20), 'image/png', requestId).expect(201);
    expect((await upload(first.editor, other.id, await png(20, 20), 'image/png', requestId).expect(409)).body.code).toBe('REQUEST_ID_REUSED');
  });

  it('keeps each plan’s photos to that plan', async () => {
    const a = await team();
    const b = await team();
    await upload(a.editor, a.planId, await png(30, 30)).expect(201);
    const listB = await api().get(`/v1/plans/${b.planId}/photos`).set(bearer(b.owner.token)).expect(200);
    expect(listB.body).toEqual([]);
    await upload(b.editor, a.planId, await png(30, 30)).expect(404);
  });

  it('stops at the per-plan photo limit', async () => {
    const { editor, planId } = await team();
    await db.planPhoto.createMany({
      data: Array.from({ length: MAX_PLAN_PHOTOS }, () => ({
        id: randomUUID(),
        planId,
        uploadedById: editor.userId,
        width: 1,
        height: 1,
        bytes: 1,
        thumbBytes: 1,
        clientRequestId: randomUUID(),
      })),
    });
    expect((await upload(editor, planId, await png(10, 10)).expect(409)).body.code).toBe('TOO_MANY_PHOTOS');
  });

  it('serves files only from untampered, unexpired links', async () => {
    const { editor, planId } = await team();
    const photo = (await upload(editor, planId, await png(50, 50)).expect(201)).body as PhotoDTO;
    const url = new URL(photo.url, 'http://x');
    const sig = url.searchParams.get('sig')!;
    const exp = url.searchParams.get('exp')!;
    const flipped = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);

    await fetchFile(`/v1/photos/${photo.id}/full?exp=${exp}&sig=${flipped}`).expect(403);
    await fetchFile(`/v1/photos/${photo.id}/thumb?exp=${exp}&sig=${sig}`).expect(403); // a link names one size
    await fetchFile(`/v1/photos/${photo.id}/full?exp=${Number(exp) + 3600}&sig=${sig}`).expect(403);
    await fetchFile(`/v1/photos/${photo.id}/full`).expect(403);
    await fetchFile(`/v1/photos/${photo.id}/original?exp=${exp}&sig=${sig}`).expect(404);
    await fetchFile(`/v1/photos/..%2F..%2Fetc%2Fpasswd/full?exp=${exp}&sig=${sig}`).expect(404);

    const photos = app.get(PhotosService);
    const hourAgo = Date.now() - 3 * 3600_000;
    await fetchFile(photos.signedPath(photo.id, 'full', hourAgo)).expect(403); // expired
    await fetchFile(photos.signedPath(randomUUID(), 'full')).expect(404); // validly signed, no such photo
  });

  it('keeps a link the same within the hour, valid for at least an hour', () => {
    const photos = app.get(PhotosService);
    const t = Date.UTC(2026, 10, 10, 9, 0, 5);
    expect(photos.signedPath('abcdefgh', 'full', t)).toBe(photos.signedPath('abcdefgh', 'full', t + 50 * 60_000));
    const late = t + 59 * 60_000;
    const exp = Number(new URL(photos.signedPath('abcdefgh', 'full', late), 'http://x').searchParams.get('exp'));
    expect(exp * 1000 - late).toBeGreaterThanOrEqual(3600_000);
  });
});
