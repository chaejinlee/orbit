// Card status is DERIVED, never stored. "In plan" comes from the itinerary
// (draft or confirmed), "needs decision" from open polls, and only the
// shortlist flag is a user choice. Storing a status field on the card would
// create a second source of truth that drifts from the itinerary.

export const IDEA_STATUSES = ['saved', 'shortlisted', 'in_plan', 'needs_decision', 'archived'] as const;
export type IdeaStatus = (typeof IDEA_STATUSES)[number];

export interface IdeaStatusInput {
  archived: boolean;
  shortlisted: boolean;
  inDraft: boolean;
  inConfirmed: boolean;
  inOpenPoll: boolean;
}

/** Precedence: archived > needs decision > in plan > shortlisted > saved. */
export function deriveIdeaStatus(input: IdeaStatusInput): IdeaStatus {
  if (input.archived) return 'archived';
  if (input.inOpenPoll) return 'needs_decision';
  if (input.inDraft || input.inConfirmed) return 'in_plan';
  if (input.shortlisted) return 'shortlisted';
  return 'saved';
}

export const IDEA_STATUS_LABEL: Record<IdeaStatus, string> = {
  saved: 'Saved',
  shortlisted: 'Shortlisted',
  in_plan: 'In plan',
  needs_decision: 'Needs decision',
  archived: 'Archived',
};
