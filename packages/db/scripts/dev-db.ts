// Local Postgres without Docker or a system install: runs the embedded-postgres
// binaries from node_modules, keeps data in <repo>/.data/postgres, applies
// migrations, and stays in the foreground until Ctrl+C.

import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { serverEnv } from '../src/env';
import { migrateDeploy, portInUse } from '../src/postgres';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const DATA_DIR = join(ROOT, '.data', 'postgres');

const { databaseUrl } = serverEnv();
const url = new URL(databaseUrl);
const port = Number(url.port || 5432);
const database = url.pathname.slice(1);
const keepAlive = () => setInterval(() => {}, 1 << 30);

async function main() {
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) {
    console.log(`DATABASE_URL points at ${url.host}; not starting a local Postgres.`);
    keepAlive();
    return;
  }

  if (await portInUse(port)) {
    console.log(`Something is already listening on :${port}; assuming it is your Postgres.`);
    migrateDeploy(databaseUrl);
    console.log('Migrations are up to date.');
    keepAlive();
    return;
  }

  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    port,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    persistent: true,
    onLog: () => {},
  });

  if (!existsSync(join(DATA_DIR, 'PG_VERSION'))) {
    console.log('Initialising a new local database in .data/postgres …');
    await pg.initialise();
  }
  await pg.start();
  try {
    await pg.createDatabase(database);
  } catch (error) {
    if (!String(error).includes('already exists')) throw error;
  }
  migrateDeploy(databaseUrl);
  console.log(`Postgres ready at ${url.host}/${database} (migrations applied).`);

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    await pg.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  keepAlive();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
