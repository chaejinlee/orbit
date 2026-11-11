import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import {
  createIdeaInput,
  previewIdeaInput,
  reactionInput,
  updateIdeaInput,
  type CreateIdeaInput,
  type CreateIdeaResultDTO,
  type IdeaDTO,
  type IdeaPreviewDTO,
  type PreviewIdeaInput,
  type UpdateIdeaInput,
} from '@orbit/shared';
import type { z } from 'zod';
import { PlanAccessGuard, RequirePermission } from '../core/guards';
import { CurrentUser, ZodBody } from '../core/http';
import type { AuthUser } from '../core/tokens';
import { IdeasService } from './ideas.service';

@Controller('plans/:planId/ideas')
@UseGuards(PlanAccessGuard)
export class IdeasController {
  constructor(@Inject(IdeasService) private readonly ideas: IdeasService) {}

  @Get()
  @RequirePermission('plan.view')
  list(
    @Param('planId') planId: string,
    @CurrentUser() user: AuthUser,
    @Query('includeArchived') includeArchived?: string,
  ): Promise<IdeaDTO[]> {
    return this.ideas.list(planId, user, includeArchived === 'true');
  }

  @Post('preview')
  @HttpCode(200)
  @RequirePermission('idea.create')
  preview(
    @Param('planId') planId: string,
    @Body(new ZodBody(previewIdeaInput)) body: PreviewIdeaInput,
  ): Promise<IdeaPreviewDTO> {
    return this.ideas.preview(planId, body);
  }

  @Post()
  @RequirePermission('idea.create')
  create(
    @Param('planId') planId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(createIdeaInput)) body: CreateIdeaInput,
  ): Promise<CreateIdeaResultDTO> {
    return this.ideas.create(planId, user, body);
  }

  @Patch(':ideaId')
  @RequirePermission('idea.edit')
  update(
    @Param('planId') planId: string,
    @Param('ideaId') ideaId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(updateIdeaInput)) body: UpdateIdeaInput,
  ): Promise<IdeaDTO> {
    return this.ideas.update(planId, ideaId, user, body);
  }

  @Post(':ideaId/archive')
  @HttpCode(200)
  @RequirePermission('idea.edit')
  archive(@Param('planId') planId: string, @Param('ideaId') ideaId: string, @CurrentUser() user: AuthUser): Promise<IdeaDTO> {
    return this.ideas.setArchived(planId, ideaId, user, true);
  }

  @Post(':ideaId/restore')
  @HttpCode(200)
  @RequirePermission('idea.edit')
  restore(@Param('planId') planId: string, @Param('ideaId') ideaId: string, @CurrentUser() user: AuthUser): Promise<IdeaDTO> {
    return this.ideas.setArchived(planId, ideaId, user, false);
  }

  @Put(':ideaId/reaction')
  @RequirePermission('idea.react')
  react(
    @Param('planId') planId: string,
    @Param('ideaId') ideaId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(reactionInput)) body: z.infer<typeof reactionInput>,
  ): Promise<IdeaDTO> {
    return this.ideas.react(planId, ideaId, user, body.kind);
  }
}
