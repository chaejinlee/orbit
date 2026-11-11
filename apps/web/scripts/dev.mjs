// `next dev` on the host and port from the repo-root .env (BIND_HOST, WEB_PORT),
// so `npm run dev:phone` opens the web app to the Wi-Fi together with the API
// and realtime servers. Variables already set in the environment win.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const host = process.env.BIND_HOST?.trim() || '127.0.0.1';
const port = process.env.WEB_PORT?.trim() || '3000';
const nextBin = createRequire(import.meta.url).resolve('next/dist/bin/next');

const child = spawn(process.execPath, [nextBin, 'dev', '--hostname', host, '--port', port, ...process.argv.slice(2)], {
  stdio: 'inherit',
});
// Ctrl+C reaches the whole process group, Next included: wait for it to stop.
process.on('SIGINT', () => {});
process.on('SIGTERM', () => child.kill('SIGTERM'));
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
