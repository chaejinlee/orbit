import { Body, Controller, Get, HttpCode, Inject, Module, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { AiEnv } from '@orbit/db';
import {
  askInput,
  proposalsInput,
  type AiAnswerDTO,
  type AiStatusDTO,
  type AskInput,
  type ProposalsInput,
  type ProposalsResultDTO,
} from '@orbit/shared';
import { PlanAccessGuard, RequirePermission } from '../core/guards';
import { CurrentUser, ZodBody } from '../core/http';
import { CONFIG, type AppRequest, type AuthUser, type Config } from '../core/tokens';
import { AnswersService } from './answers.service';
import { FakeModel } from './fake';
import { GeminiModel } from './gemini';
import { AI_MODEL, type AiModel } from './model';
import { ProposalsService } from './proposals.service';
import { AiUsageService } from './usage.service';

export function createAiModel(env: AiEnv): AiModel | null {
  if (env.provider === 'gemini' && env.apiKey) return new GeminiModel(env.apiKey, env.model);
  if (env.provider === 'fake') return new FakeModel();
  return null;
}

@Controller('plans/:planId')
@UseGuards(PlanAccessGuard)
class PlanAiController {
  constructor(
    @Inject(ProposalsService) private readonly proposals: ProposalsService,
    @Inject(AnswersService) private readonly answers: AnswersService,
  ) {}

  @Post('proposals')
  @HttpCode(200)
  @RequirePermission('proposal.generate')
  generate(
    @Param('planId') planId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(proposalsInput)) body: ProposalsInput,
  ): Promise<ProposalsResultDTO> {
    return this.proposals.generate(planId, user, body);
  }

  @Post('ideas/:ideaId/ask')
  @RequirePermission('ai.ask')
  ask(
    @Param('planId') planId: string,
    @Param('ideaId') ideaId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(askInput)) body: AskInput,
  ): Promise<AiAnswerDTO> {
    return this.answers.ask(planId, ideaId, user, body);
  }

  @Get('ideas/:ideaId/answers')
  @RequirePermission('plan.view')
  list(@Param('planId') planId: string, @Param('ideaId') ideaId: string, @CurrentUser() user: AuthUser): Promise<AiAnswerDTO[]> {
    return this.answers.list(planId, ideaId, user.id);
  }

  @Post('answers/:answerId/share')
  @HttpCode(200)
  @RequirePermission('plan.view')
  share(@Param('planId') planId: string, @Param('answerId') answerId: string, @CurrentUser() user: AuthUser): Promise<AiAnswerDTO> {
    return this.answers.share(planId, answerId, user);
  }

  @Post('answers/:answerId/hide')
  @HttpCode(204)
  @RequirePermission('plan.view')
  hide(
    @Param('planId') planId: string,
    @Param('answerId') answerId: string,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
  ): Promise<void> {
    return this.answers.hide(planId, answerId, user, req.planRole!);
  }
}

@Controller('ai')
class AiStatusController {
  constructor(
    @Inject(AI_MODEL) private readonly ai: AiModel | null,
    @Inject(AiUsageService) private readonly usage: AiUsageService,
  ) {}

  @Get('status')
  async status(@CurrentUser() user: AuthUser): Promise<AiStatusDTO> {
    return {
      enabled: this.ai != null,
      provider: this.ai?.provider ?? null,
      model: this.ai?.model ?? null,
      dailyLimit: this.usage.dailyLimit,
      usedToday: this.ai ? await this.usage.usedToday(user.id) : 0,
    };
  }
}

@Module({
  controllers: [PlanAiController, AiStatusController],
  providers: [
    { provide: AI_MODEL, useFactory: (config: Config): AiModel | null => createAiModel(config.ai), inject: [CONFIG] },
    AiUsageService,
    ProposalsService,
    AnswersService,
  ],
})
export class AiModule {}
