// String unions mirror the Prisma enums one-to-one, so API payloads and DB rows
// share a vocabulary without importing the server-only Prisma client.

export const PLAN_TYPES = ['DATE', 'HANGOUT', 'TRIP', 'EVENT'] as const;
export type PlanType = (typeof PLAN_TYPES)[number];

export const PLAN_STATUSES = ['DRAFT', 'PLANNING', 'CONFIRMED', 'COMPLETED', 'ARCHIVED'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const ENTRY_MODES = ['MANUAL', 'AI'] as const;
export type EntryMode = (typeof ENTRY_MODES)[number];

export const MEMBER_ROLES = ['OWNER', 'EDITOR', 'VIEWER'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const IDEA_KINDS = ['PLACE', 'LINK', 'NOTE', 'ACTIVITY'] as const;
export type IdeaKind = (typeof IDEA_KINDS)[number];

export const PLACE_PROVIDERS = ['MANUAL', 'GOOGLE', 'FOURSQUARE', 'OSM'] as const;
export type PlaceProvider = (typeof PLACE_PROVIDERS)[number];

export const SOURCE_KINDS = ['LINK', 'PHOTO', 'NOTE'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const VERIFICATION_STATES = ['VERIFIED', 'NEEDS_RECHECK', 'UNKNOWN'] as const;
export type Verification = (typeof VERIFICATION_STATES)[number];

export const REACTION_KINDS = ['INTERESTED', 'NOT_INTERESTED'] as const;
export type ReactionKind = (typeof REACTION_KINDS)[number];

export const COMMIT_SOURCES = ['DRAFT', 'PROPOSAL', 'REPLAN', 'REVERT'] as const;
export type CommitSource = (typeof COMMIT_SOURCES)[number];

export const WORKSPACE_VIEWS = ['board', 'itinerary', 'map', 'decisions'] as const;
export type WorkspaceView = (typeof WORKSPACE_VIEWS)[number];

export const PLAN_TYPE_LABEL: Record<PlanType, string> = {
  DATE: 'Date',
  HANGOUT: 'Hangout',
  TRIP: 'Trip',
  EVENT: 'Event',
};
