import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';
import { serverEnv } from './env';

export * from './generated/prisma/client';
export { DEFAULT_GEMINI_MODEL, lanAddresses, loadRootEnv, serverEnv, type AiEnv, type AiProviderName, type ServerEnv } from './env';
export * from './access';

/** One client (= one connection pool) per process. */
export function createPrismaClient(databaseUrl: string = serverEnv().databaseUrl): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
}
