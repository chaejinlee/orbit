import { PLAN_TYPE_LABEL, type PlanType } from './enums';
import { MINUTES_PER_DAY } from './time';

/** "Saturday Date", "Toronto Trip", "Untitled Hangout". */
export function defaultPlanName(
  type: PlanType,
  opts: { startDate?: string | null; city?: string | null } = {},
): string {
  const label = PLAN_TYPE_LABEL[type];
  if (type === 'TRIP' && opts.city) return `${opts.city} Trip`;
  if (opts.startDate) {
    const weekday = new Intl.DateTimeFormat('en', { weekday: 'long', timeZone: 'UTC' }).format(
      new Date(`${opts.startDate}T00:00:00Z`),
    );
    return `${weekday} ${label}`;
  }
  if (opts.city) return `${opts.city} ${label}`;
  return `Untitled ${label}`;
}

export interface PlanWindowFields {
  type: PlanType;
  startDate: string | null;
  endDate: string | null;
  startMin: number | null;
  endMin: number | null;
}

export interface FieldError {
  path: keyof PlanWindowFields;
  message: string;
}

/**
 * Shared by create and update (the API validates the merged result of a
 * partial update, not just the patch).
 */
export function planWindowErrors(v: PlanWindowFields): FieldError[] {
  const errors: FieldError[] = [];
  if (v.endDate && !v.startDate) {
    errors.push({ path: 'startDate', message: 'Pick a start date when there is an end date.' });
  }
  if (v.startDate && v.endDate && v.endDate < v.startDate) {
    errors.push({ path: 'endDate', message: 'The end date can’t be before the start date.' });
  }
  if (v.type !== 'TRIP' && v.startDate && v.endDate && v.endDate !== v.startDate) {
    errors.push({ path: 'endDate', message: 'Only trips can span several days.' });
  }
  if (v.startMin != null && v.endMin != null && v.endMin <= v.startMin) {
    errors.push({
      path: 'endMin',
      message: 'The end time must be after the start time. For late nights, confirm that it ends the next day.',
    });
  }
  if (v.endMin != null && v.endMin > MINUTES_PER_DAY && v.startMin == null) {
    errors.push({ path: 'startMin', message: 'Set a start time for a plan that runs past midnight.' });
  }
  return errors;
}

/** Number of days a plan covers (1 for anything that is not a multi-day trip). */
export function planDayCount(startDate: string | null, endDate: string | null): number {
  if (!startDate || !endDate) return 1;
  const ms = Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`);
  return Math.max(1, Math.round(ms / 86_400_000) + 1);
}
