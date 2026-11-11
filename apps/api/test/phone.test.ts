import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { serverEnv } from '@orbit/db';
import { startEphemeralPostgres, type EphemeralPostgres } from '@orbit/db/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule, configureApp } from '../src/app.module';
import { fromThisComputer, MAX_PHONE_CODE_MISSES, PhoneAccess } from '../src/auth/phone-access';
import { CONFIG, type Config } from '../src/core/tokens';

// Phone mode (BIND_HOST=0.0.0.0) must not open the passwordless dev sign-in to
// everyone on the Wi-Fi. Supertest always connects from 127.0.0.1, so another
// device is simulated with its Host header, which is also what a web page that
// points its own domain at 127.0.0.1 (DNS rebinding) would send.

const PHONE_HOST = '192.168.1.23:4000';

let pg: EphemeralPostgres;
let phoneMode: INestApplication;
let localOnly: INestApplication;

async function boot(overrides: Partial<Config>): Promise<INestApplication> {
  const config: Config = { ...serverEnv(), ...overrides };
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(CONFIG).useValue(config).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app, config);
  await app.init();
  return app;
}

beforeAll(async () => {
  pg = await startEphemeralPostgres();
  process.env.DATABASE_URL = pg.url;
  process.env.AUTH_DEV_LOGIN = 'true';
  process.env.AI_PROVIDER = 'off';
  phoneMode = await boot({ bindHost: '0.0.0.0', lanMode: true, webPort: 3000 });
  localOnly = await boot({ bindHost: '127.0.0.1', lanMode: false, webPort: 3000 });
});

afterAll(async () => {
  await phoneMode?.close();
  await localOnly?.close();
  await pg?.stop();
});

function signIn(app: INestApplication, body: Record<string, unknown>, host?: string) {
  const req = request(app.getHttpServer()).post('/v1/auth/dev-login');
  if (host) req.set('Host', host);
  return req.send(body);
}

function phoneInfo(app: INestApplication, host?: string) {
  const req = request(app.getHttpServer()).get('/v1/auth/phone');
  if (host) req.set('Host', host);
  return req;
}

function preflight(app: INestApplication, origin: string) {
  return request(app.getHttpServer()).options('/v1/auth/dev-login').set('Origin', origin).set('Access-Control-Request-Method', 'POST');
}

describe('phone mode', () => {
  it('lets this computer sign in without a code', async () => {
    await signIn(phoneMode, { email: 'here@orbit.dev' }).expect(200);
  });

  it('asks another device for the code this computer shows, and signs it in with it', async () => {
    const none = await signIn(phoneMode, { email: 'phone@orbit.dev' }, PHONE_HOST).expect(403);
    expect(none.body).toMatchObject({ code: 'PHONE_CODE', message: expect.stringContaining('6-digit code') });

    const info = await phoneInfo(phoneMode).expect(200);
    expect(info.body).toMatchObject({ enabled: true, code: expect.stringMatching(/^\d{6}$/), urls: expect.any(Array) });
    for (const url of info.body.urls as string[]) expect(url).toMatch(/^http:\/\/[\d.]+:3000$/);
    const code: string = info.body.code;

    const wrong = await signIn(phoneMode, { email: 'phone@orbit.dev', phoneCode: code === '000000' ? '111111' : '000000' }, PHONE_HOST).expect(403);
    expect(wrong.body).toMatchObject({ code: 'PHONE_CODE', message: expect.stringContaining('doesn’t match') });

    // Typed as shown on screen ("123 456").
    const ok = await signIn(phoneMode, { email: 'phone@orbit.dev', phoneCode: `${code.slice(0, 3)} ${code.slice(3)}` }, PHONE_HOST).expect(200);
    expect(ok.body).toMatchObject({ token: expect.any(String), user: { email: 'phone@orbit.dev' } });
  });

  it('shows the code only on this computer', async () => {
    await phoneInfo(phoneMode, PHONE_HOST).expect(404);
    await phoneInfo(phoneMode, 'evil.example:4000').expect(404);
  });

  it('lets the web app at a Wi-Fi address call the API, and no other site', async () => {
    const lan = await preflight(phoneMode, 'http://192.168.1.23:3000');
    expect(lan.headers['access-control-allow-origin']).toBe('http://192.168.1.23:3000');
    for (const origin of ['http://192.168.1.23:8080', 'https://evil.example', 'http://8.8.8.8:3000']) {
      expect((await preflight(phoneMode, origin)).headers['access-control-allow-origin']).toBeUndefined();
    }
    expect((await preflight(phoneMode, 'http://localhost:3000')).headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });
});

describe('without phone mode', () => {
  it('keeps the dev sign-in to this computer, code or not', async () => {
    await signIn(localOnly, { email: 'here2@orbit.dev' }).expect(200);
    for (const host of [PHONE_HOST, 'evil.example:4000']) {
      const res = await signIn(localOnly, { email: 'someone@orbit.dev', phoneCode: '123456' }, host).expect(403);
      expect(res.body.code).toBe('LOCAL_ONLY');
    }
    expect((await phoneInfo(localOnly).expect(200)).body).toEqual({ enabled: false });
    expect((await preflight(localOnly, 'http://192.168.1.23:3000')).headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('PhoneAccess', () => {
  const config = { lanMode: true, devLogin: true, webPort: 3000 } as Config;

  it('replaces the code after too many wrong guesses; an empty code is not a guess', () => {
    const phone = new PhoneAccess(config);
    const first = phone.current();
    const wrong = first === '000000' ? '111111' : '000000';
    for (let i = 0; i < 50; i++) expect(phone.verify(undefined)).toBe(false);
    for (let i = 0; i < MAX_PHONE_CODE_MISSES - 1; i++) expect(phone.verify(wrong)).toBe(false);
    expect(phone.current()).toBe(first);
    expect(phone.verify(first)).toBe(true);

    expect(phone.verify(wrong)).toBe(false); // the last allowed miss
    const second = phone.current();
    expect(second).toMatch(/^\d{6}$/);
    if (second !== first) expect(phone.verify(first)).toBe(false);
  });

  it('counts a request as this computer only from a loopback address, sent to a loopback host', () => {
    const req = (remoteAddress: string, host: string) => ({ socket: { remoteAddress }, headers: { host } }) as unknown as Parameters<typeof fromThisComputer>[0];
    expect(fromThisComputer(req('127.0.0.1', 'localhost:4000'))).toBe(true);
    expect(fromThisComputer(req('::1', '[::1]:4000'))).toBe(true);
    expect(fromThisComputer(req('::ffff:127.0.0.1', '127.0.0.1:4000'))).toBe(true);
    expect(fromThisComputer(req('192.168.1.50', '192.168.1.23:4000'))).toBe(false);
    expect(fromThisComputer(req('192.168.1.50', 'localhost:4000'))).toBe(false);
    expect(fromThisComputer(req('127.0.0.1', 'evil.example:4000'))).toBe(false);
  });
});
