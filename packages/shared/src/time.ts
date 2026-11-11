// Plan times are wall-clock minutes after local midnight of the plan day, so a
// 7 PM reservation stays 7 PM regardless of where the viewer is. Values past
// 1440 mean "the next day" and only exist when the user confirmed it.

export const MINUTES_PER_DAY = 1440;

/** Parses "15:00", "3:00 PM", "3pm" or "9:30am" into minutes after midnight. */
export function parseClock(value: string): number | null {
  const match = /^\s*(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?\s*$/i.exec(value);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3]?.toLowerCase().replaceAll('.', '');
  if (minutes > 59) return null;
  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    if (meridiem === 'am') hours = hours === 12 ? 0 : hours;
    else hours = hours === 12 ? 12 : hours + 12;
  } else if (hours > 23) {
    return null;
  }
  return hours * 60 + minutes;
}

/** "HH:MM" for <input type="time">. Wraps values past midnight. */
export function toClockInput(min: number): string {
  const wrapped = ((min % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function formatClock(min: number, locale = 'en'): string {
  const dayOffset = Math.floor(min / MINUTES_PER_DAY);
  const wrapped = min - dayOffset * MINUTES_PER_DAY;
  const date = new Date(Date.UTC(2000, 0, 1, Math.floor(wrapped / 60), wrapped % 60));
  const text = new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(date);
  return dayOffset > 0 ? `${text} (+${dayOffset})` : text;
}

export function formatDuration(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
