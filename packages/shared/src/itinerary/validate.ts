import { formatMoney, summarizeCosts, type Money } from '../money';
import { formatClock, formatDuration, MINUTES_PER_DAY } from '../time';
import type { ScheduledStop } from './types';

// The deterministic validator. The browser runs it for live warnings and the
// API re-runs it at commit time, so neither a buggy client nor (later) an LLM
// proposal can commit a plan that silently breaks a hard constraint.

export const ISSUE_CODES = [
  'EMPTY_ITINERARY',
  'INVALID_DURATION',
  'LATE_FOR_FIXED_TIME',
  'STARTS_BEFORE_WINDOW',
  'ENDS_AFTER_WINDOW',
  'BUDGET_EXCEEDED',
  'COSTS_INCOMPLETE',
  'CURRENCY_MISMATCH',
  'DUPLICATE_VISIT',
  'NO_START_TIME',
] as const;
export type IssueCode = (typeof ISSUE_CODES)[number];

/** error = hard constraint (blocks commit unless explicitly accepted). */
export type IssueSeverity = 'error' | 'warning' | 'info';

export interface ItineraryIssue {
  code: IssueCode;
  severity: IssueSeverity;
  message: string;
  stopId?: string;
}

export interface ValidationContext {
  window: { startMin: number | null; endMin: number | null };
  budget: Money | null;
}

export function validateItinerary(stops: readonly ScheduledStop[], ctx: ValidationContext): ItineraryIssue[] {
  const issues: ItineraryIssue[] = [];
  if (stops.length === 0) {
    return [{ code: 'EMPTY_ITINERARY', severity: 'error', message: 'Add at least one stop before confirming.' }];
  }

  for (const stop of stops) {
    if (!Number.isInteger(stop.durationMin) || stop.durationMin <= 0 || stop.durationMin > MINUTES_PER_DAY) {
      issues.push({
        code: 'INVALID_DURATION',
        severity: 'error',
        stopId: stop.id,
        message: `“${stop.title}” needs a duration between 1 minute and 24 hours.`,
      });
    }
    if (stop.lateByMin > 0 && stop.fixedStartMin != null) {
      issues.push({
        code: 'LATE_FOR_FIXED_TIME',
        severity: 'error',
        stopId: stop.id,
        message: `“${stop.title}” is fixed at ${formatClock(stop.fixedStartMin)}, but the stop before it runs ${formatDuration(stop.lateByMin)} too late.`,
      });
    }
    const { startMin, endMin } = ctx.window;
    if (startMin != null && stop.startMin != null && stop.startMin < startMin) {
      issues.push({
        code: 'STARTS_BEFORE_WINDOW',
        severity: 'error',
        stopId: stop.id,
        message: `“${stop.title}” starts at ${formatClock(stop.startMin)}, before the plan starts (${formatClock(startMin)}).`,
      });
    }
    if (endMin != null && stop.endMin != null && stop.endMin > endMin) {
      issues.push({
        code: 'ENDS_AFTER_WINDOW',
        severity: 'error',
        stopId: stop.id,
        message: `“${stop.title}” ends at ${formatClock(stop.endMin)}, after the plan should end (${formatClock(endMin)}).`,
      });
    }
  }

  if (stops.some((s) => s.startMin == null)) {
    issues.push({
      code: 'NO_START_TIME',
      severity: 'info',
      message: 'Set a start time for the plan (or pin a stop’s time) to see the schedule.',
    });
  }

  const seen = new Map<string, number>();
  for (const stop of stops) {
    if (!stop.ideaId) continue;
    const count = (seen.get(stop.ideaId) ?? 0) + 1;
    seen.set(stop.ideaId, count);
    if (count === 2) {
      issues.push({
        code: 'DUPLICATE_VISIT',
        severity: 'info',
        stopId: stop.id,
        message: `“${stop.title}” appears more than once. That’s fine if you mean to go back.`,
      });
    }
  }

  if (ctx.budget) {
    const costs = summarizeCosts(stops, ctx.budget.currency);
    if (costs.knownTotalMinor > ctx.budget.amountMinor) {
      issues.push({
        code: 'BUDGET_EXCEEDED',
        severity: 'error',
        message: `Estimated ${formatMoney({ amountMinor: costs.knownTotalMinor, currency: ctx.budget.currency })} is over the ${formatMoney(ctx.budget)} budget.`,
      });
    }
    if (costs.unknownCount > 0) {
      issues.push({
        code: 'COSTS_INCOMPLETE',
        severity: 'warning',
        message: `${costs.unknownCount} ${costs.unknownCount === 1 ? 'stop has' : 'stops have'} no cost estimate, so the budget check is incomplete.`,
      });
    }
    if (costs.mismatchedCount > 0) {
      issues.push({
        code: 'CURRENCY_MISMATCH',
        severity: 'warning',
        message: `${costs.mismatchedCount} ${costs.mismatchedCount === 1 ? 'cost is' : 'costs are'} in another currency and weren’t added to the total.`,
      });
    }
  }

  return issues;
}

/** Errors the user has not explicitly accepted. These block a commit. */
export function blockingIssues(
  issues: readonly ItineraryIssue[],
  acceptedCodes: readonly IssueCode[] = [],
): ItineraryIssue[] {
  return issues.filter((i) => i.severity === 'error' && !acceptedCodes.includes(i.code));
}
