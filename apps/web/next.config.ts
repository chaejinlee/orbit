import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NextConfig } from 'next';

// Share the repo-root .env (NEXT_PUBLIC_* values) with the other apps.
const repoRoot = resolve(process.cwd(), '../..');
const rootEnv = resolve(repoRoot, '.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

// Phone mode (BIND_HOST=0.0.0.0, `npm run dev:phone`): a phone on this Wi-Fi
// loads the app from http://<this computer's private address>:3000. Next only
// serves its dev assets to listed hosts; each `*` stands for one part of the
// address, so a new address after switching networks still works.
const bindHost = process.env.BIND_HOST?.trim() || '127.0.0.1';
const phoneMode = !['127.0.0.1', 'localhost', '::1'].includes(bindHost);
const privateNetworks = ['10.*.*.*', '192.168.*.*', ...Array.from({ length: 16 }, (_, i) => `172.${16 + i}.*.*`), '*.local'];

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@orbit/shared'],
  turbopack: { root: repoRoot },
  // 127.0.0.1 lets a second dev session run side by side (separate storage = separate user).
  allowedDevOrigins: ['127.0.0.1', ...(phoneMode ? privateNetworks : [])],
};

export default config;
