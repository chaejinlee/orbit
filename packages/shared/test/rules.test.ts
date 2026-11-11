import { describe, expect, it } from 'vitest';
import {
  can,
  createPlanInput,
  defaultPlanName,
  deriveIdeaStatus,
  formatClock,
  formatDuration,
  formatMoney,
  parseClock,
  permissionsFor,
  summarizeCosts,
  toMinor,
} from '../src';

describe('permissions', () => {
  it('lets viewers participate without editing', () => {
    expect(can('VIEWER', 'vote.cast')).toBe(true);
    expect(can('VIEWER', 'comment.create')).toBe(true);
    expect(can('VIEWER', 'board.edit')).toBe(false);
    expect(can('VIEWER', 'itinerary.commit')).toBe(false);
    expect(can('VIEWER', 'ai.ask')).toBe(false);
  });

  it('reserves membership and deletion for the owner', () => {
    expect(can('EDITOR', 'member.manage')).toBe(false);
    expect(can('EDITOR', 'plan.delete')).toBe(false);
    expect(can('OWNER', 'member.manage')).toBe(true);
  });

  it('denies everything without a role', () => {
    expect(can(null, 'plan.view')).toBe(false);
    expect(can(undefined, 'plan.view')).toBe(false);
  });

  it('gives owners a superset of editor permissions', () => {
    const owner = new Set(permissionsFor('OWNER'));
    for (const p of permissionsFor('EDITOR')) expect(owner.has(p)).toBe(true);
  });
});

describe('card status is derived', () => {
  const base = { archived: false, shortlisted: false, inDraft: false, inConfirmed: false, inOpenPoll: false };
  it('applies precedence archived > needs decision > in plan > shortlisted > saved', () => {
    expect(deriveIdeaStatus(base)).toBe('saved');
    expect(deriveIdeaStatus({ ...base, shortlisted: true })).toBe('shortlisted');
    expect(deriveIdeaStatus({ ...base, shortlisted: true, inDraft: true })).toBe('in_plan');
    expect(deriveIdeaStatus({ ...base, inConfirmed: true, inOpenPoll: true })).toBe('needs_decision');
    expect(deriveIdeaStatus({ ...base, inDraft: true, archived: true })).toBe('archived');
  });
});

describe('time & money', () => {
  it('parses clock input forms', () => {
    expect(parseClock('15:00')).toBe(900);
    expect(parseClock('3:00 PM')).toBe(900);
    expect(parseClock('12am')).toBe(0);
    expect(parseClock('12:30 pm')).toBe(750);
    expect(parseClock('24:00')).toBeNull();
    expect(parseClock('13pm')).toBeNull();
  });

  it('formats times past midnight with a day marker', () => {
    expect(formatClock(19 * 60)).toBe('7:00 PM');
    expect(formatClock(1440 + 30)).toBe('12:30 AM (+1)');
    expect(formatDuration(90)).toBe('1h 30m');
    expect(formatDuration(45)).toBe('45m');
  });

  it('respects currency minor units', () => {
    expect(toMinor(12.5, 'CAD')).toBe(1250);
    expect(toMinor(12000, 'KRW')).toBe(12000);
    expect(formatMoney({ amountMinor: 12000, currency: 'CAD' })).toBe('CA$120');
  });

  it('never converts currencies when summing costs', () => {
    const summary = summarizeCosts(
      [
        { costMinor: 4000, costCurrency: 'CAD' },
        { costMinor: null, costCurrency: null },
        { costMinor: 3000, costCurrency: 'USD' },
      ],
      'CAD',
    );
    expect(summary).toEqual({ currency: 'CAD', knownTotalMinor: 4000, unknownCount: 1, mismatchedCount: 1 });
  });
});

describe('plan creation input', () => {
  const ok = { clientRequestId: 'req-12345678', type: 'DATE' as const };

  it('accepts a plan with nothing but a type', () => {
    expect(createPlanInput.safeParse(ok).success).toBe(true);
  });

  it('rejects an end time before the start time unless it is marked as next day', () => {
    expect(createPlanInput.safeParse({ ...ok, startMin: 22 * 60, endMin: 60 }).success).toBe(false);
    expect(createPlanInput.safeParse({ ...ok, startMin: 22 * 60, endMin: 1440 + 60 }).success).toBe(true);
  });

  it('only lets trips span several days', () => {
    const span = { startDate: '2026-12-24', endDate: '2026-12-27' };
    expect(createPlanInput.safeParse({ ...ok, ...span }).success).toBe(false);
    expect(createPlanInput.safeParse({ ...ok, type: 'TRIP', ...span }).success).toBe(true);
  });

  it('requires a real currency code for a budget', () => {
    expect(createPlanInput.safeParse({ ...ok, budget: { amountMinor: 12000, currency: 'XYZ' } }).success).toBe(false);
    expect(createPlanInput.safeParse({ ...ok, budget: { amountMinor: 12000, currency: 'CAD' } }).success).toBe(true);
  });

  it('names plans from what we know', () => {
    expect(defaultPlanName('DATE', { startDate: '2026-11-14' })).toBe('Saturday Date');
    expect(defaultPlanName('TRIP', { city: 'Toronto', startDate: '2026-11-14' })).toBe('Toronto Trip');
    expect(defaultPlanName('HANGOUT')).toBe('Untitled Hangout');
  });
});
