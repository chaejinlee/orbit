import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createPrismaClient, serverEnv } from '@orbit/db';
import { CONFIG, PRISMA, type Config, type Db } from './tokens';

@Injectable()
class PrismaLifecycle implements OnApplicationShutdown {
  constructor(@Inject(PRISMA) private readonly db: Db) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.$disconnect();
  }
}

@Global()
@Module({
  providers: [
    { provide: CONFIG, useFactory: (): Config => serverEnv() },
    { provide: PRISMA, useFactory: (config: Config): Db => createPrismaClient(config.databaseUrl), inject: [CONFIG] },
    PrismaLifecycle,
  ],
  exports: [CONFIG, PRISMA],
})
export class CoreModule {}
