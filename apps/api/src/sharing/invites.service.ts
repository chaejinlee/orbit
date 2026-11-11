import { ForbiddenException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@orbit/db';
import {
  can,
  INVITE_EXPIRY_HOURS,
  MAX_ACTIVE_INVITES,
  type CreatedInviteDTO,
  type CreateInviteInput,
  type InviteDTO,
  type InviteErrorCode,
  type InvitePreviewDTO,
  type InviteRole,
  type JoinResultDTO,
  type MemberRole,
} from '@orbit/shared';
import { createHash, randomBytes } from 'node:crypto';
import { apiError, isUniqueViolation, personSelect } from '../core/http';
import { isoDay } from '../core/mappers';
import { PRISMA, type AuthUser, type Db } from '../core/tokens';

/** 24 random bytes as base64url: 32 characters, 192 bits. */
export function newInviteToken(): string {
  return randomBytes(24).toString('base64url');
}

/** Only this hash is stored, so a database leak doesn't leak working links. */
export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const inviteInclude = { createdBy: { select: personSelect } } satisfies Prisma.InviteLinkInclude;
type InviteRow = Prisma.InviteLinkGetPayload<{ include: typeof inviteInclude }>;
type InviteState = Pick<InviteRow, 'revokedAt' | 'expiresAt' | 'maxUses' | 'useCount'>;

const PREVIEW_MEMBERS = 8;

const INVITE_ERRORS: Record<InviteErrorCode, { status: HttpStatus; message: string }> = {
  INVITE_INVALID: { status: HttpStatus.NOT_FOUND, message: 'This invite link isn’t valid. Ask for a new one.' },
  INVITE_EXPIRED: { status: HttpStatus.GONE, message: 'This invite link has expired. Ask for a new one.' },
  INVITE_REVOKED: { status: HttpStatus.GONE, message: 'This invite link was turned off. Ask for a new one.' },
  INVITE_USED_UP: { status: HttpStatus.GONE, message: 'This invite link has already been used. Ask for a new one.' },
};

function inviteError(code: InviteErrorCode) {
  const { status, message } = INVITE_ERRORS[code];
  return apiError(status, code, message);
}

/** Why a link can't be used right now, or null if it can. */
function unusableReason(invite: InviteState, now = new Date()): InviteErrorCode | null {
  if (invite.revokedAt) return 'INVITE_REVOKED';
  if (invite.expiresAt && invite.expiresAt <= now) return 'INVITE_EXPIRED';
  if (invite.maxUses != null && invite.useCount >= invite.maxUses) return 'INVITE_USED_UP';
  return null;
}

function toInvite(row: InviteRow, userId: string, role: MemberRole): InviteDTO {
  return {
    id: row.id,
    role: row.role as InviteRole,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    maxUses: row.maxUses,
    useCount: row.useCount,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    canRevoke: row.createdById === userId || can(role, 'invite.manage'),
  };
}

/**
 * Invite links. Rules:
 *  - The token is random (192 bits), shown once to its creator, stored as a hash.
 *  - A link adds new members with its role. It never changes the role of
 *    someone already in the plan (no way to promote yourself with an old link).
 *  - Uses are claimed with a conditional UPDATE, so "one person only" holds
 *    even when two people open the link at the same moment.
 *  - Every active link was made by a current member who can still invite:
 *    links are turned off when their creator leaves, is removed or becomes a
 *    viewer (see MembersService).
 */
@Injectable()
export class InvitesService {
  constructor(@Inject(PRISMA) private readonly db: Db) {}

  async create(planId: string, user: AuthUser, role: MemberRole, input: CreateInviteInput): Promise<CreatedInviteDTO> {
    const active = await this.activeRows(planId);
    if (active.length >= MAX_ACTIVE_INVITES) {
      throw apiError(HttpStatus.CONFLICT, 'TOO_MANY_INVITES', `This plan already has ${MAX_ACTIVE_INVITES} active links. Turn some off first.`);
    }
    const token = newInviteToken();
    const expiresAt = new Date(Date.now() + INVITE_EXPIRY_HOURS[input.expiresIn] * 3_600_000);
    const row = await this.db.inviteLink.create({
      data: { planId, tokenHash: hashInviteToken(token), role: input.role, createdById: user.id, expiresAt, maxUses: input.maxUses },
      include: inviteInclude,
    });
    await this.db.activityEvent.create({
      data: { planId, actorId: user.id, type: 'invite.created', payload: { inviteId: row.id, role: input.role, expiresAt: expiresAt.toISOString(), maxUses: input.maxUses } },
    });
    return { invite: toInvite(row, user.id, role), token };
  }

  /** Links that still work, newest first. */
  async list(planId: string, user: AuthUser, role: MemberRole): Promise<InviteDTO[]> {
    return (await this.activeRows(planId)).map((row) => toInvite(row, user.id, role));
  }

  async revoke(planId: string, inviteId: string, user: AuthUser, role: MemberRole): Promise<void> {
    const row = await this.db.inviteLink.findFirst({ where: { id: inviteId, planId } });
    if (!row) throw new NotFoundException('Invite link not found.');
    if (row.createdById !== user.id && !can(role, 'invite.manage')) {
      throw new ForbiddenException('Only the person who made this link, or the plan owner, can turn it off.');
    }
    if (row.revokedAt) return;
    await this.db.inviteLink.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
    await this.db.activityEvent.create({ data: { planId, actorId: user.id, type: 'invite.revoked', payload: { inviteId } } });
  }

  /**
   * What the join page shows. Public: the token is the secret. People already
   * in the plan get the preview even for an old link, so they can open the plan.
   */
  async preview(token: string, userId: string | null): Promise<InvitePreviewDTO> {
    const row = await this.db.inviteLink.findUnique({
      where: { tokenHash: hashInviteToken(token) },
      include: {
        ...inviteInclude,
        plan: {
          include: {
            members: { orderBy: { joinedAt: 'asc' }, take: PREVIEW_MEMBERS, include: { user: { select: personSelect } } },
            _count: { select: { members: true } },
          },
        },
      },
    });
    if (!row || row.plan.archivedAt) throw inviteError('INVITE_INVALID');
    const myRole = userId ? await this.roleOf(row.planId, userId) : null;
    const reason = unusableReason(row);
    if (reason && !myRole) throw inviteError(reason);
    const { plan } = row;
    return {
      plan: {
        id: plan.id,
        name: plan.name,
        type: plan.type,
        city: plan.city,
        startDate: isoDay(plan.startDate),
        endDate: isoDay(plan.endDate),
        memberCount: plan._count.members,
        members: plan.members.map((m) => m.user),
      },
      role: row.role as InviteRole,
      invitedBy: row.createdBy,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      myRole,
    };
  }

  async accept(token: string, user: AuthUser): Promise<JoinResultDTO> {
    const invite = await this.db.inviteLink.findUnique({
      where: { tokenHash: hashInviteToken(token) },
      include: { plan: { select: { archivedAt: true } } },
    });
    if (!invite || invite.plan.archivedAt) throw inviteError('INVITE_INVALID');
    const { planId } = invite;

    const existing = await this.roleOf(planId, user.id);
    if (existing) return { planId, role: existing, joined: false };
    const reason = unusableReason(invite);
    if (reason) throw inviteError(reason);

    try {
      return await this.db.$transaction(async (tx) => {
        const now = new Date();
        // Claim one use. Concurrent joins serialize on this row; the WHERE is
        // re-checked after a competing transaction commits.
        const claimed = await tx.$executeRaw`
          UPDATE "invite_links" SET "useCount" = "useCount" + 1
          WHERE "id" = ${invite.id}
            AND "revokedAt" IS NULL
            AND ("expiresAt" IS NULL OR "expiresAt" > ${now})
            AND ("maxUses" IS NULL OR "useCount" < "maxUses")`;
        if (claimed === 0) {
          // The same person tapping Join twice: the other request already added them.
          const member = await tx.planMember.findUnique({ where: { planId_userId: { planId, userId: user.id } } });
          if (member) return { planId, role: member.role, joined: false };
          const fresh = await tx.inviteLink.findUniqueOrThrow({ where: { id: invite.id } });
          throw inviteError(unusableReason(fresh, now) ?? 'INVITE_USED_UP');
        }
        await tx.planMember.create({ data: { planId, userId: user.id, role: invite.role } });
        await tx.activityEvent.create({
          data: { planId, actorId: user.id, type: 'member.joined', payload: { inviteId: invite.id, role: invite.role } },
        });
        return { planId, role: invite.role as MemberRole, joined: true };
      });
    } catch (error) {
      // Joined twice at once on an unlimited link: the membership insert lost
      // the race and rolled back its claimed use.
      if (!isUniqueViolation(error)) throw error;
      const role = await this.roleOf(planId, user.id);
      if (!role) throw error;
      return { planId, role, joined: false };
    }
  }

  private async roleOf(planId: string, userId: string): Promise<MemberRole | null> {
    const member = await this.db.planMember.findUnique({ where: { planId_userId: { planId, userId } }, select: { role: true } });
    return member?.role ?? null;
  }

  private async activeRows(planId: string): Promise<InviteRow[]> {
    const now = new Date();
    const rows = await this.db.inviteLink.findMany({
      where: { planId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      include: inviteInclude,
      orderBy: { createdAt: 'desc' },
    });
    return rows.filter((row) => !unusableReason(row, now));
  }
}
