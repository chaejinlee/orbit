import EmbeddedPostgres from 'embedded-postgres';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { freePort, migrateDeploy } from './postgres';

export { freePort };

export interface EphemeralPostgres {
  url: string;
  stop: () => Promise<void>;
}

/**
 * A throwaway, fully migrated Postgres for integration tests: real SQL, real
 * constraints and real transactions, no Docker, gone after the run.
 */
export async function startEphemeralPostgres(): Promise<EphemeralPostgres> {
  const databaseDir = await mkdtemp(join(tmpdir(), 'orbit-pg-'));
  const port = await freePort();
  const pg = new EmbeddedPostgres({
    databaseDir,
    port,
    user: 'orbit',
    password: 'orbit',
    persistent: false,
    onLog: () => {},
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('orbit_test');
  const url = `postgresql://orbit:orbit@127.0.0.1:${port}/orbit_test`;
  migrateDeploy(url);
  return {
    url,
    stop: async () => {
      await pg.stop();
      await rm(databaseDir, { recursive: true, force: true });
    },
  };
}
