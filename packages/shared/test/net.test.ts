import { afterEach, describe, expect, it, vi } from 'vitest';
import { hostnameOfHost, isLanWebOrigin, isLoopbackAddress, isLoopbackHostname, isPrivateIPv4, randomId, withPageHost } from '../src';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('randomId', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('makes v4 UUIDs, also where crypto.randomUUID is missing (pages served over http from a Wi-Fi address)', () => {
    expect(randomId()).toMatch(UUID_V4);
    const real = globalThis.crypto;
    vi.stubGlobal('crypto', { getRandomValues: real.getRandomValues.bind(real) });
    const ids = new Set(Array.from({ length: 200 }, () => randomId()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(UUID_V4);
  });
});

describe('this computer or not', () => {
  it('recognizes loopback hostnames and socket addresses', () => {
    for (const h of ['localhost', 'LOCALHOST', 'app.localhost', '127.0.0.1', '127.1.2.3', '::1', '[::1]']) expect(isLoopbackHostname(h)).toBe(true);
    for (const h of ['192.168.1.23', 'example.com', 'localhost.example.com', '0.0.0.0', '']) expect(isLoopbackHostname(h)).toBe(false);
    for (const a of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) expect(isLoopbackAddress(a)).toBe(true);
    for (const a of ['192.168.1.50', '::ffff:192.168.1.50', 'fe80::1', undefined, null, '']) expect(isLoopbackAddress(a)).toBe(false);
  });

  it('reads the hostname out of a Host header', () => {
    expect(hostnameOfHost('localhost:4000')).toBe('localhost');
    expect(hostnameOfHost('[::1]:4000')).toBe('::1');
    expect(hostnameOfHost('192.168.1.23')).toBe('192.168.1.23');
    expect(hostnameOfHost('Evil.Example:4000')).toBe('evil.example');
    expect(hostnameOfHost(undefined)).toBeNull();
  });

  it('knows which addresses a home or office Wi-Fi hands out', () => {
    for (const ip of ['10.0.0.5', '172.16.0.1', '172.31.255.254', '192.168.1.23']) expect(isPrivateIPv4(ip)).toBe(true);
    for (const ip of ['172.15.0.1', '172.32.0.1', '8.8.8.8', '192.169.0.1', '127.0.0.1', '192.168.1.256', 'example.com']) expect(isPrivateIPv4(ip)).toBe(false);
  });

  it('lets in the web app as a phone on the Wi-Fi sees it, and nothing else', () => {
    expect(isLanWebOrigin('http://192.168.1.23:3000', 3000)).toBe(true);
    expect(isLanWebOrigin('http://chaes-macbook.local:3000', 3000)).toBe(true);
    expect(isLanWebOrigin('http://192.168.1.23:5173', 3000)).toBe(false);
    expect(isLanWebOrigin('https://192.168.1.23:3000', 3000)).toBe(false);
    expect(isLanWebOrigin('http://8.8.8.8:3000', 3000)).toBe(false);
    expect(isLanWebOrigin('http://evil.example:3000', 3000)).toBe(false);
    expect(isLanWebOrigin('not a url', 3000)).toBe(false);
  });
});

describe('withPageHost', () => {
  it('points localhost services at the host a phone loaded the page from', () => {
    expect(withPageHost('http://localhost:4000', '192.168.1.23')).toBe('http://192.168.1.23:4000');
    expect(withPageHost('ws://localhost:4001', '192.168.1.23')).toBe('ws://192.168.1.23:4001');
    expect(withPageHost('http://127.0.0.1:4000/', 'chaes-macbook.local')).toBe('http://chaes-macbook.local:4000/');
    expect(withPageHost('http://localhost:4000', 'fe80::1')).toBe('http://[fe80::1]:4000');
  });

  it('leaves everything else alone', () => {
    expect(withPageHost('http://localhost:4000', 'localhost')).toBe('http://localhost:4000');
    expect(withPageHost('http://localhost:4000', '127.0.0.1')).toBe('http://localhost:4000');
    expect(withPageHost('http://localhost:4000', null)).toBe('http://localhost:4000');
    expect(withPageHost('https://api.orbit.example', '192.168.1.23')).toBe('https://api.orbit.example');
    expect(withPageHost('not a url', '192.168.1.23')).toBe('not a url');
  });
});
