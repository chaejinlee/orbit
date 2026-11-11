// Live hints over a plan's realtime socket. A hint says only what kind of
// SQL-backed data changed ("comments on card X"); each client then refetches
// it over HTTP, where permissions apply. Hints carry no content, so they can't
// show anyone anything, and a lost hint only delays a refresh (screens also
// refetch on a slow timer).

/** plan = details and members; itinerary = confirmed versions (the draft syncs through Yjs). */
export const HINT_TOPICS = ['plan', 'ideas', 'comments', 'answers', 'itinerary'] as const;
export type HintTopic = (typeof HINT_TOPICS)[number];

export interface PlanHint {
  type: 'changed';
  topics: HintTopic[];
  /** For comments and answers: the card they belong to. */
  ideaId?: string;
  /** Who caused it. Set by the realtime server, never trusted from a client. */
  by?: string;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_HINT_CHARS = 512;

/** Parses a hint from the wire. Anything unexpected is dropped (null). */
export function parsePlanHint(raw: string): PlanHint | null {
  if (raw.length > MAX_HINT_CHARS) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (v.type !== 'changed' || !Array.isArray(v.topics)) return null;
  const topics = HINT_TOPICS.filter((t) => (v.topics as unknown[]).includes(t));
  if (topics.length === 0) return null;
  const hint: PlanHint = { type: 'changed', topics };
  if (typeof v.ideaId === 'string' && ID.test(v.ideaId)) hint.ideaId = v.ideaId;
  if (typeof v.by === 'string' && ID.test(v.by)) hint.by = v.by;
  return hint;
}
