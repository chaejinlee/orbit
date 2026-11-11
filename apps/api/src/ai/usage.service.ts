import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { CONFIG, PRISMA, type Config, type Db } from '../core/tokens';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A per-person cap on AI calls over a rolling 24 hours. It keeps one eager
 * user from exhausting the shared free tier (or the bill). Planning runs that
 * didn't call the model don't count.
 */
@Injectable()
export class AiUsageService {
  constructor(
    @Inject(PRISMA) private readonly db: Db,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  get dailyLimit(): number {
    return this.config.ai.dailyLimitPerUser;
  }

  async usedToday(userId: string): Promise<number> {
    const since = new Date(Date.now() - DAY_MS);
    const [jobs, answers] = await Promise.all([
      this.db.planningJob.count({ where: { requestedById: userId, createdAt: { gte: since }, model: { not: null } } }),
      this.db.aiResponse.count({ where: { requestedById: userId, createdAt: { gte: since } } }),
    ]);
    return jobs + answers;
  }

  async hasRoom(userId: string): Promise<boolean> {
    return (await this.usedToday(userId)) < this.dailyLimit;
  }

  async assertRoom(userId: string): Promise<void> {
    if (await this.hasRoom(userId)) return;
    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        code: 'AI_LIMIT',
        message: `You’ve used today’s ${this.dailyLimit} AI requests. They refill over the next 24 hours.`,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
