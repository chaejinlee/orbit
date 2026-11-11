import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import {
  createPlanInput,
  lastViewInput,
  updatePlanInput,
  type CreatePlanInput,
  type PlanDTO,
  type UpdatePlanInput,
} from '@orbit/shared';
import type { z } from 'zod';
import { PlanAccessGuard, RequirePermission } from '../core/guards';
import { CurrentUser, ZodBody } from '../core/http';
import type { AuthUser } from '../core/tokens';
import { PlansService } from './plans.service';

@Controller('plans')
export class PlansController {
  constructor(@Inject(PlansService) private readonly plans: PlansService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body(new ZodBody(createPlanInput)) body: CreatePlanInput): Promise<PlanDTO> {
    return this.plans.create(user, body);
  }

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<PlanDTO[]> {
    return this.plans.list(user);
  }
}

@Controller('plans/:planId')
@UseGuards(PlanAccessGuard)
export class PlanController {
  constructor(@Inject(PlansService) private readonly plans: PlansService) {}

  @Get()
  @RequirePermission('plan.view')
  get(@Param('planId') planId: string, @CurrentUser() user: AuthUser): Promise<PlanDTO> {
    return this.plans.get(planId, user);
  }

  @Patch()
  @RequirePermission('plan.edit')
  update(
    @Param('planId') planId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(updatePlanInput)) body: UpdatePlanInput,
  ): Promise<PlanDTO> {
    return this.plans.update(planId, user, body);
  }

  @Put('last-view')
  @HttpCode(204)
  @RequirePermission('plan.view')
  async setLastView(
    @Param('planId') planId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(lastViewInput)) body: z.infer<typeof lastViewInput>,
  ): Promise<void> {
    await this.plans.setLastView(planId, user, body.view);
  }
}
