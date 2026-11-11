import type { HintTopic } from '@orbit/shared';

/** Tells the plan's other open screens that something changed, so they refetch it. */
export type NotifyPlan = (topics: HintTopic[], ideaId?: string) => void;

// One sender per open plan, registered by usePlanDoc (which owns the socket).
// A registry rather than React context, so hooks used anywhere (including by
// the workspace component itself) can reach it with just the plan id.
const senders = new Map<string, NotifyPlan>();

export function registerPlanNotifier(planId: string, send: NotifyPlan): () => void {
  senders.set(planId, send);
  return () => {
    if (senders.get(planId) === send) senders.delete(planId);
  };
}

/** A no-op when the plan isn't open (or its socket isn't up): screens also refetch on a timer. */
export function notifyPlan(planId: string, topics: HintTopic[], ideaId?: string): void {
  senders.get(planId)?.(topics, ideaId);
}
