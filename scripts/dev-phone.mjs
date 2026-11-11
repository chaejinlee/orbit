// `npm run dev`, with the servers opened to this Wi-Fi for this run only
// (BIND_HOST=0.0.0.0), so a phone on the same network can open Orbit.
// Sign-in from the phone then needs the 6-digit code this computer shows.
import { spawn } from 'node:child_process';

const windows = process.platform === 'win32';
const child = spawn(windows ? 'npm.cmd' : 'npm', ['run', 'dev'], {
  stdio: 'inherit',
  env: { ...process.env, BIND_HOST: '0.0.0.0' },
  shell: windows,
});
// Ctrl+C reaches the whole process group: wait for the servers to stop.
process.on('SIGINT', () => {});
process.on('SIGTERM', () => child.kill('SIGTERM'));
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
