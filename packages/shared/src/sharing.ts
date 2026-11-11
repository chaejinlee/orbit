import { z } from 'zod';
import type { PersonDTO } from './api-types';
import type { MemberRole, PlanType } from './enums';

// Invite links and membership. A link carries a random token that is shown
// once, to whoever creates it; the server keeps only its SHA-256 hash.

export const INVITE_ROLES = ['EDITOR', 'VIEWER'] as const;
export type InviteRole = (typeof INVITE_ROLES)[number];

export const ROLE_LABEL: Record<MemberRole, string> = { OWNER: 'Owner', EDITOR: 'Can edit', VIEWER: 'Can view' };

/** What each role can do, in the words the share dialog and the join page use. */
export const ROLE_SUMMARY: Record<MemberRole, string> = {
  OWNER: 'Can do everything, including managing people and links.',
  EDITOR: 'Can add ideas, edit the board and the plan, and invite people.',
  VIEWER: 'Can see the plan, react, comment and vote, but not edit.',
};

export const INVITE_EXPIRY = ['DAY', 'WEEK', 'MONTH'] as const;
export type InviteExpiry = (typeof INVITE_EXPIRY)[number];
export const INVITE_EXPIRY_HOURS: Record<InviteExpiry, number> = { DAY: 24, WEEK: 24 * 7, MONTH: 24 * 30 };
export const INVITE_EXPIRY_LABEL: Record<InviteExpiry, string> = { DAY: '1 day', WEEK: '7 days', MONTH: '30 days' };

/** Active links per plan: plenty for a group, and a cap on runaway link creation. */
export const MAX_ACTIVE_INVITES = 20;

export const createInviteInput = z.object({
  role: z.enum(INVITE_ROLES),
  expiresIn: z.enum(INVITE_EXPIRY),
  /** null = any number of people until the link expires. */
  maxUses: z.number().int().min(1).max(50).nullable(),
});
export type CreateInviteInput = z.infer<typeof createInviteInput>;

/** base64url, as the API generates it (24 random bytes → 32 characters). */
export const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,128}$/;

export const inviteTokenInput = z.object({
  token: z.string().regex(INVITE_TOKEN_PATTERN, 'This invite link isn’t complete. Ask for the link again.'),
});

export const updateMemberInput = z.object({ role: z.enum(INVITE_ROLES) });
export type UpdateMemberInput = z.infer<typeof updateMemberInput>;

/** The link people open. The token sits after `#`, so it never reaches a server log. */
export function inviteUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/join#${token}`;
}

/** Reads the token from `location.hash` ("#<token>"); null if it isn't one. */
export function inviteTokenFromHash(hash: string): string | null {
  const token = hash.replace(/^#/, '').trim();
  return INVITE_TOKEN_PATTERN.test(token) ? token : null;
}

export type InviteErrorCode = 'INVITE_INVALID' | 'INVITE_EXPIRED' | 'INVITE_REVOKED' | 'INVITE_USED_UP';

export interface InviteDTO {
  id: string;
  role: InviteRole;
  expiresAt: string | null;
  maxUses: number | null;
  useCount: number;
  createdBy: PersonDTO;
  createdAt: string;
  /** Whoever made the link, or the owner, can turn it off. */
  canRevoke: boolean;
}

export interface CreatedInviteDTO {
  invite: InviteDTO;
  /** The secret part of the link. Returned this once: the server keeps only a hash. */
  token: string;
}

export interface InvitePreviewDTO {
  plan: {
    id: string;
    name: string;
    type: PlanType;
    city: string | null;
    startDate: string | null;
    endDate: string | null;
    memberCount: number;
    /** The first few members, for the avatars on the join page. */
    members: PersonDTO[];
  };
  role: InviteRole;
  invitedBy: PersonDTO;
  expiresAt: string | null;
  /** Your role when you're signed in and already in the plan; otherwise null. */
  myRole: MemberRole | null;
}

export interface JoinResultDTO {
  planId: string;
  role: MemberRole;
  /** False when you were already a member. A link never changes an existing member's role. */
  joined: boolean;
}
