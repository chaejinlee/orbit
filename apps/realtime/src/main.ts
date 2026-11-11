import { createPrismaClient, serverEnv } from '@orbit/db';
import { createRealtimeServer } from './server';

const env = serverEnv();
const prisma = createPrismaClient(env.databaseUrl);
const server = createRealtimeServer({ prisma, authSecret: env.authSecret, port: env.realtimePort, address: env.bindHost });

await server.listen();
console.log(`Orbit realtime ready on ws://${env.bindHost}:${env.realtimePort}`);

const shutdown = async () => {
  await server.destroy();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
