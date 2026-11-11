import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import {
  createCommentInput,
  updateCommentInput,
  type CommentDTO,
  type CreateCommentInput,
  type UpdateCommentInput,
} from '@orbit/shared';
import { PlanAccessGuard, RequirePermission } from '../core/guards';
import { CurrentUser, ZodBody } from '../core/http';
import type { AppRequest, AuthUser } from '../core/tokens';
import { CommentsService } from './comments.service';

@Controller('plans/:planId/ideas/:ideaId/comments')
@UseGuards(PlanAccessGuard)
export class IdeaCommentsController {
  constructor(@Inject(CommentsService) private readonly comments: CommentsService) {}

  @Get()
  @RequirePermission('plan.view')
  list(
    @Param('planId') planId: string,
    @Param('ideaId') ideaId: string,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
  ): Promise<CommentDTO[]> {
    return this.comments.list(planId, ideaId, user, req.planRole!);
  }

  @Post()
  @RequirePermission('comment.create')
  create(
    @Param('planId') planId: string,
    @Param('ideaId') ideaId: string,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Body(new ZodBody(createCommentInput)) body: CreateCommentInput,
  ): Promise<CommentDTO> {
    return this.comments.create(planId, ideaId, user, req.planRole!, body);
  }
}

@Controller('plans/:planId/comments')
@UseGuards(PlanAccessGuard)
export class CommentsController {
  constructor(@Inject(CommentsService) private readonly comments: CommentsService) {}

  @Patch(':commentId')
  @RequirePermission('comment.create')
  update(
    @Param('planId') planId: string,
    @Param('commentId') commentId: string,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Body(new ZodBody(updateCommentInput)) body: UpdateCommentInput,
  ): Promise<CommentDTO> {
    return this.comments.update(planId, commentId, user, req.planRole!, body.content);
  }

  /** Authors delete their own; the owner can delete anyone's (checked in the service). */
  @Delete(':commentId')
  @HttpCode(204)
  @RequirePermission('plan.view')
  remove(@Param('planId') planId: string, @Param('commentId') commentId: string, @CurrentUser() user: AuthUser, @Req() req: AppRequest): Promise<void> {
    return this.comments.remove(planId, commentId, user, req.planRole!);
  }
}
