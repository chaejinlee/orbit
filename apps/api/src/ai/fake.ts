import { formatDuration, type AskPreset } from '@orbit/shared';
import type { AiModel, AiUsage, GroundedAnswer, GroundedRequest, JsonRequest } from './model';
import type { HeadlineContext, NoteContext, NoteOutput } from './prompts';

/*
 * AI_PROVIDER=fake: deterministic stand-in for building and demoing the UI
 * without an API key. Answers are clearly marked as development answers and
 * it can never be enabled in production (see serverEnv).
 */

const NO_USAGE: AiUsage = { inputTokens: 0, outputTokens: 0, groundingQueries: 0 };
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function to24h(hour: number, minute: number, meridiem: string | undefined): string {
  let h = hour;
  if (meridiem === 'pm' && h < 12) h += 12;
  else if (meridiem === 'am' && h === 12) h = 0;
  else if (!meridiem && h >= 1 && h <= 8) h += 12; // "start at 6" means 6 PM for an outing
  return `${String(Math.min(h, 23)).padStart(2, '0')}:${String(Math.min(minute, 59)).padStart(2, '0')}`;
}

export function fakeNote(ctx: NoteContext): NoteOutput {
  const text = ctx.note.toLowerCase();
  const has = (...words: string[]) => words.some((w) => text.includes(w));
  const avoidIds: string[] = [];
  const mustIncludeIds: string[] = [];
  let endWithId = '';
  for (const idea of ctx.ideas) {
    const title = idea.title.toLowerCase();
    const at = text.indexOf(title);
    if (at < 0) continue;
    const before = text.slice(Math.max(0, at - 16), at);
    const after = text.slice(at + title.length, at + title.length + 8);
    if (/(skip|no|without|not)\s*$/.test(before) || /^\s*(빼|말고|제외)/.test(after)) avoidIds.push(idea.id);
    else if (/(end with|finish with|last)\s*$/.test(before) || /^\s*(로 마무리|으로 마무리|마지막)/.test(after)) endWithId = idea.id;
    else mustIncludeIds.push(idea.id);
  }
  const start = /(?:start|from|begin)\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/.exec(text);
  const end = /(?:end|finish|until|by)\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/.exec(text);
  const budget = /(?:under|below|max|budget)\s*\$?\s*(\d+)/.exec(text);
  const unsupported: string[] = [];
  if (has('book', 'reserve', '예약')) unsupported.push('booking or reservations');
  if (has('find a', 'find new', 'recommend', '추천')) unsupported.push('finding new places');
  return {
    pace: has('relax', 'chill', 'slow', 'easy', '여유', '천천') ? 'RELAXED' : has('packed', 'as many', 'lots', '알차', '많이') ? 'PACKED' : 'UNSPECIFIED',
    lessTravel: has('walk', 'close by', 'nearby', 'less travel', '가까', '이동 적'),
    lowerCost: has('cheap', 'save', 'free', 'budget', '저렴', '싸게', '아껴'),
    mustIncludeIds,
    avoidIds,
    endWithId,
    maxStops: Number(/(?:max|at most|up to)\s*(\d+)\s*(?:stops|places)/.exec(text)?.[1] ?? 0),
    startTime: start ? to24h(Number(start[1]), Number(start[2] ?? 0), start[3]) : '',
    endTime: end ? to24h(Number(end[1]), Number(end[2] ?? 0), end[3]) : '',
    budgetAmount: budget ? Number(budget[1]) : 0,
    unsupported,
  };
}

function fakeHeadlines(ctx: HeadlineContext) {
  return {
    options: ctx.proposals.map((p) => {
      const first = p.stops[0]?.title ?? 'the first stop';
      const last = p.stops.at(-1)?.title ?? 'the last stop';
      const headline =
        p.label === 'BALANCED' ? `${first} to ${last}, nicely paced` : p.label === 'BUDGET' ? `${last} without overspending` : `The most of your favorites`;
      return {
        label: p.label,
        headline,
        why: `${p.totals.stopCount} stops with about ${formatDuration(p.totals.travelMin)} of travel${p.tradeoffs[0] ? `; ${p.tradeoffs[0]}` : ''}.`,
      };
    }),
  };
}

const CANNED: Record<AskPreset, string> = {
  HOURS: 'Usually open from late morning until about 10 PM, with shorter hours on Sundays. Check before you go.',
  PRICE: 'Most visitors spend roughly 20–40 per person, depending on what you order.',
  RESERVATIONS: 'Walk-ins are usually fine on weekdays. Weekend evenings get busy, so booking ahead is safer.',
  GETTING_THERE: 'A short walk from the nearest subway stop. Street parking is limited nearby.',
  TIPS: 'Go a little early to skip the line. The signature dish sells out on busy nights.',
};

export class FakeModel implements AiModel {
  readonly provider = 'fake' as const;
  readonly model = 'fake-dev-model';

  constructor(private readonly delayMs = 400) {}

  async generateJson<T>(request: JsonRequest<T>): Promise<{ data: T; usage: AiUsage }> {
    await pause(this.delayMs);
    const value = request.purpose === 'parse_note' ? fakeNote(request.context as NoteContext) : fakeHeadlines(request.context as HeadlineContext);
    return { data: request.parse(value), usage: NO_USAGE };
  }

  async answer(request: GroundedRequest): Promise<GroundedAnswer> {
    await pause(this.delayMs * 2);
    const { title, preset } = request.context;
    const body = preset ? CANNED[preset as AskPreset] : 'This is a canned development answer. Add GEMINI_API_KEY to get a real one.';
    if (request.grounding === 'none') return { text: `Development answer (fake AI, unchecked): ${body}`, sources: [], usage: NO_USAGE };
    return {
      text: `Development answer (fake AI): ${body}`,
      sources: [
        {
          url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(title)}`,
          title: `${title} (search)`,
          provider: request.grounding === 'google_maps' ? 'google_maps' : 'web',
        },
      ],
      usage: NO_USAGE,
    };
  }
}
