import type { MemberRole } from './enums';

/**
 * The single permission matrix. The API guards, the realtime server and the UI
 * all ask `can(role, permission)`, so a rule changes in exactly one place.
 *
 * Viewers are participants, not spectators: they can vote, react and comment,
 * but cannot change the board, the itinerary, or spend AI budget.
 */
export const PERMISSIONS = {
  'plan.view': ['OWNER', 'EDITOR', 'VIEWER'],
  'plan.edit': ['OWNER', 'EDITOR'],
  'plan.delete': ['OWNER'],
  'member.manage': ['OWNER'],
  'invite.create': ['OWNER', 'EDITOR'],
  /** Turn off any invite link, not just your own. */
  'invite.manage': ['OWNER'],
  'idea.create': ['OWNER', 'EDITOR'],
  'idea.edit': ['OWNER', 'EDITOR'],
  'idea.react': ['OWNER', 'EDITOR', 'VIEWER'],
  'board.edit': ['OWNER', 'EDITOR'],
  'photo.upload': ['OWNER', 'EDITOR'],
  'comment.create': ['OWNER', 'EDITOR', 'VIEWER'],
  /** Delete other people's comments. */
  'comment.moderate': ['OWNER'],
  'vote.cast': ['OWNER', 'EDITOR', 'VIEWER'],
  'itinerary.edit': ['OWNER', 'EDITOR'],
  'itinerary.commit': ['OWNER', 'EDITOR'],
  'proposal.generate': ['OWNER', 'EDITOR'],
  'ai.ask': ['OWNER', 'EDITOR'],
  'ai.settings': ['OWNER'],
} as const satisfies Record<string, readonly MemberRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: MemberRole | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly MemberRole[]).includes(role);
}

export function permissionsFor(role: MemberRole): Permission[] {
  return (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(role, p));
}
