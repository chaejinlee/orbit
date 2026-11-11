import { formatClock, formatMoney, type Money, type PlanDTO } from '@orbit/shared';
import { extendTailwindMerge } from 'tailwind-merge';

// Later classes win on conflict (`text-sm` + `text-2xl` → `text-2xl`), so a
// component's className can override its base styles. Taught our theme tokens.
const twMerge = extendTailwindMerge({
  extend: { theme: { font: ['display', 'sans'], shadow: ['card', 'lift', 'panel'] } },
});

export function cn(...classes: Array<string | false | null | undefined>): string {
  return twMerge(...classes);
}

export function formatPlanDate(plan: Pick<PlanDTO, 'startDate' | 'endDate'>): string | null {
  if (!plan.startDate) return null;
  const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en', { timeZone: 'UTC', ...opts }).format(new Date(`${iso}T00:00:00Z`));
  const start = fmt(plan.startDate, { weekday: 'short', month: 'short', day: 'numeric' });
  if (!plan.endDate || plan.endDate === plan.startDate) return start;
  return `${start} – ${fmt(plan.endDate, { month: 'short', day: 'numeric' })}`;
}

export function formatWindow(startMin: number | null, endMin: number | null): string | null {
  if (startMin == null && endMin == null) return null;
  if (startMin != null && endMin != null) return `${formatClock(startMin)} – ${formatClock(endMin)}`;
  if (startMin != null) return `from ${formatClock(startMin)}`;
  return `until ${formatClock(endMin!)}`;
}

export function formatBudget(budget: Money | null): string | null {
  return budget ? formatMoney(budget) : null;
}

export function timeAgo(iso: string): string {
  const seconds = Math.round((Date.now() - Date.parse(iso)) / 1000);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return rtf.format(-Math.round(seconds / 60), 'minute');
  if (seconds < 86_400) return rtf.format(-Math.round(seconds / 3600), 'hour');
  return rtf.format(-Math.round(seconds / 86_400), 'day');
}

/** "in 6 days", "in 5 hours", "in 20 minutes" — for expiry times. */
export function timeUntil(iso: string): string {
  const seconds = Math.round((Date.parse(iso) - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (seconds <= 0) return 'now';
  if (seconds < 3600) return rtf.format(Math.max(1, Math.round(seconds / 60)), 'minute');
  if (seconds < 86_400 * 2) return rtf.format(Math.round(seconds / 3600), 'hour');
  return rtf.format(Math.round(seconds / 86_400), 'day');
}

export function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 5) return 'Up late';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

/** Best guess at the user's currency, shown (never silently applied) as the form default. */
export function localeCurrency(): string {
  try {
    const region = new Intl.Locale(navigator.language).maximize().region;
    const byRegion: Record<string, string> = {
      CA: 'CAD', US: 'USD', KR: 'KRW', GB: 'GBP', JP: 'JPY', AU: 'AUD', FR: 'EUR', DE: 'EUR', ES: 'EUR', IT: 'EUR',
    };
    return (region && byRegion[region]) || 'USD';
  } catch {
    return 'USD';
  }
}

export const CURRENCIES = ['CAD', 'USD', 'KRW', 'EUR', 'GBP', 'JPY', 'AUD'] as const;
