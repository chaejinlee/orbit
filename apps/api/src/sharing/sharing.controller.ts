import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import {
  createInviteInput,
  inviteTokenInput,
  updateMemberInput,
  type CreatedInviteDTO,
  type CreateInviteInput,
  type InviteDTO,
  type InvitePreviewDTO,
  type JoinResultDTO,
  type PlanDTO,
  type UpdateMemberInput,
} from '@orbit/shared';
import type { z } from 'zod';
import { PlanAccessGuard, Public, RequirePermission } from '../core/guards';
import { CurrentUser, ZodBody } from '../core/http';
import type { AppRequest, AuthUser } from '../core/tokens';
import { InvitesService } from './invites.service';
import { MembersService } from './members.service';

type TokenInput = z.infer<typeof inviteTokenInput>;

@Controller('plans/:planId/invites')
@UseGuards(PlanAccessGuard)
export class PlanInvitesController {
  constructor(@Inject(InvitesService) private readonly invites: InvitesService) {}

  @Get()
  @RequirePermission('invite.create')
  list(@Param('planId') planId: string, @CurrentUser() user: AuthUser, @Req() req: AppRequest): Promise<InviteDTO[]> {
    return this.invites.list(planId, user, req.planRole!);
  }

  @Post()
  @RequirePermission('invite.create')
  create(
    @Param('planId') planId: string,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
    @Body(new ZodBody(createInviteInput)) body: CreateInviteInput,
  ): Promise<CreatedInviteDTO> {
    return this.invites.create(planId, user, req.planRole!, body);
  }

  @Post(':inviteId/revoke')
  @HttpCode(204)
  @RequirePermission('invite.create')
  revoke(
    @Param('planId') planId: string,
    @Param('inviteId') inviteId: string,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
  ): Promise<void> {
    return this.invites.revoke(planId, inviteId, user, req.planRole!);
  }
}

@Controller('plans/:planId')
@UseGuards(PlanAccessGuard)
export class PlanMembersController {
  constructor(@Inject(MembersService) private readonly members: MembersService) {}

  @Patch('members/:userId')
  @RequirePermission('member.manage')
  changeRole(
    @Param('planId') planId: string,
    @Param('userId') userId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(updateMemberInput)) body: UpdateMemberInput,
  ): Promise<PlanDTO> {
    return this.members.changeRole(planId, user, userId, body.role);
  }

  @Delete('members/:userId')
  @HttpCode(204)
  @RequirePermission('member.manage')
  remove(@Param('planId') planId: string, @Param('userId') userId: string, @CurrentUser() user: AuthUser): Promise<void> {
    return this.members.remove(planId, user, userId);
  }

  @Post('leave')
  @HttpCode(204)
  @RequirePermission('plan.view')
  leave(@Param('planId') planId: string, @CurrentUser() user: AuthUser, @Req() req: AppRequest): Promise<void> {
    return this.members.leave(planId, user, req.planRole!);
  }
}

/** The token travels in the body (never in a URL, so it stays out of logs). */
@Controller('invites')
export class InvitesController {
  constructor(@Inject(InvitesService) private readonly invites: InvitesService) {}

  @Public()
  @Post('preview')
  @HttpCode(200)
  preview(@Req() req: AppRequest, @Body(new ZodBody(inviteTokenInput)) body: TokenInput): Promise<InvitePreviewDTO> {
    return this.invites.preview(body.token, req.user?.id ?? null);
  }

  @Post('accept')
  @HttpCode(200)
  accept(@CurrentUser() user: AuthUser, @Body(new ZodBody(inviteTokenInput)) body: TokenInput): Promise<JoinResultDTO> {
    return this.invites.accept(body.token, user);
  }
}
