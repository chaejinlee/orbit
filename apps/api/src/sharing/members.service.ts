import { HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@orbit/db';
import { can, type InviteRole, type MemberRole, type PlanDTO } from '@orbit/shared';
import { apiError } from '../core/http';
import { planInclude, toPlan } from '../core/mappers';
import { PRISMA, type AuthUser, type Db } from '../core/tokens';

type Tx = Prisma.TransactionClient;

/**
 * People in a plan. The owner changes roles and removes people; anyone but
 * the owner can leave. When someone stops being able to invite (they leave,
 * are removed or become a viewer) the links they made are turned off, so
 * nobody can come back in through a link of their own.
 *
 * Realtime catches up by itself: the socket re-checks membership on the next
 * message, closing a removed member's connection and making a new viewer's
 * read-only.
 */
@Injectable()
export class MembersService {
  constructor(@Inject(PRISMA) private readonly db: Db) {}

  async changeRole(planId: string, actor: AuthUser, userId: string, role: InviteRole): Promise<PlanDTO> {
    const member = await this.findMember(planId, userId);
    if (member.role === 'OWNER') throw apiError(HttpStatus.CONFLICT, 'OWNER_ROLE', 'The owner’s role can’t be changed.');
    if (member.role !== role) {
      await this.db.$transaction(async (tx) => {
        await tx.planMember.update({ where: { planId_userId: { planId, userId } }, data: { role } });
        if (!can(role, 'invite.create')) await this.revokeLinksBy(tx, planId, userId);
        await tx.activityEvent.create({
          data: { planId, actorId: actor.id, type: 'member.role_changed', payload: { userId, from: member.role, to: role } },
        });
      });
    }
    const plan = await this.db.plan.findUniqueOrThrow({ where: { id: planId }, include: planInclude });
    return toPlan(plan, actor.id);
  }

  async remove(planId: string, actor: AuthUser, userId: string): Promise<void> {
    const member = await this.findMember(planId, userId);
    if (member.role === 'OWNER') throw apiError(HttpStatus.CONFLICT, 'OWNER_REMOVE', 'The owner can’t be removed from their plan.');
    await this.db.$transaction(async (tx) => {
      await this.detach(tx, planId, userId);
      await tx.activityEvent.create({ data: { planId, actorId: actor.id, type: 'member.removed', payload: { userId } } });
    });
  }

  async leave(planId: string, user: AuthUser, role: MemberRole): Promise<void> {
    if (role === 'OWNER') throw apiError(HttpStatus.CONFLICT, 'OWNER_LEAVE', 'You own this plan, so you can’t leave it.');
    await this.db.$transaction(async (tx) => {
      await this.detach(tx, planId, user.id);
      await tx.activityEvent.create({ data: { planId, actorId: user.id, type: 'member.left' } });
    });
  }

  private async findMember(planId: string, userId: string) {
    const member = await this.db.planMember.findUnique({ where: { planId_userId: { planId, userId } } });
    if (!member) throw new NotFoundException('That person isn’t in this plan.');
    return member;
  }

  /**
   * Comments stay (they're part of the conversation); "interested" marks go,
   * since they say who wants to go now.
   */
  private async detach(tx: Tx, planId: string, userId: string): Promise<void> {
    await tx.planMember.delete({ where: { planId_userId: { planId, userId } } });
    await this.revokeLinksBy(tx, planId, userId);
    await tx.ideaReaction.deleteMany({ where: { userId, idea: { planId } } });
  }

  private async revokeLinksBy(tx: Tx, planId: string, userId: string): Promise<void> {
    await tx.inviteLink.updateMany({ where: { planId, createdById: userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}
