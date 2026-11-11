import type { Prisma } from '@orbit/db';
import {
  WORKSPACE_VIEWS,
  type IdeaDTO,
  type ItineraryStopDTO,
  type ItineraryVersionDTO,
  type LinkPlatform,
  type Money,
  type PlanDTO,
  type WorkspaceView,
} from '@orbit/shared';
import { personSelect } from './http';

// Prisma rows → API DTOs. Includes live next to their mappers so a query and
// the shape it must return can't drift apart.

export const planInclude = {
  members: { orderBy: { joinedAt: 'asc' }, include: { user: { select: personSelect } } },
  _count: { select: { ideas: { where: { archivedAt: null } } } },
} satisfies Prisma.PlanInclude;
type PlanRow = Prisma.PlanGetPayload<{ include: typeof planInclude }>;

export const ideaInclude = {
  place: true,
  createdBy: { select: personSelect },
  sources: { orderBy: { createdAt: 'asc' }, include: { addedBy: { select: personSelect } } },
  reactions: { orderBy: { createdAt: 'asc' }, include: { user: { select: personSelect } } },
  _count: { select: { comments: { where: { deletedAt: null } } } },
} satisfies Prisma.IdeaInclude;
export type IdeaRow = Prisma.IdeaGetPayload<{ include: typeof ideaInclude }>;

export const versionInclude = {
  committedBy: { select: personSelect },
  stops: { orderBy: [{ dayIndex: 'asc' }, { sequence: 'asc' }] },
} satisfies Prisma.ItineraryVersionInclude;
type VersionRow = Prisma.ItineraryVersionGetPayload<{ include: typeof versionInclude }>;

export function isoDay(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

export function money(amountMinor: number | null, currency: string | null): Money | null {
  return amountMinor != null && currency ? { amountMinor, currency: currency.trim() } : null;
}

function workspaceView(value: string | null): WorkspaceView | null {
  return (WORKSPACE_VIEWS as readonly string[]).includes(value ?? '') ? (value as WorkspaceView) : null;
}

export function toPlan(row: PlanRow, userId: string): PlanDTO {
  const me = row.members.find((m) => m.userId === userId);
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    status: row.status,
    city: row.city,
    timezone: row.timezone,
    startDate: isoDay(row.startDate),
    endDate: isoDay(row.endDate),
    startMin: row.startMin,
    endMin: row.endMin,
    budget: money(row.budgetMinor, row.budgetCurrency),
    entryMode: row.entryMode,
    currentVersion: row.currentVersion,
    myRole: me?.role ?? 'VIEWER',
    lastView: workspaceView(me?.lastView ?? null),
    members: row.members.map((m) => ({ ...m.user, role: m.role })),
    ideaCount: row._count.ideas,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toIdea(row: IdeaRow, userId: string): IdeaDTO {
  const mine = row.reactions.find((r) => r.userId === userId);
  return {
    id: row.id,
    planId: row.planId,
    kind: row.kind,
    title: row.title,
    note: row.note,
    shortlisted: row.shortlisted,
    durationMin: row.durationMin,
    cost: money(row.costMinor, row.costCurrency),
    place: row.place
      ? {
          id: row.place.id,
          provider: row.place.provider,
          name: row.place.name,
          address: row.place.address,
          lat: row.place.lat,
          lng: row.place.lng,
          category: row.place.category,
          verification: row.place.verification,
          fetchedAt: row.place.fetchedAt?.toISOString() ?? null,
        }
      : null,
    sources: row.sources.map((s) => ({
      id: s.id,
      kind: s.kind,
      url: s.url,
      platform: (s.platform as LinkPlatform | null) ?? null,
      title: s.title,
      note: s.note,
      addedBy: s.addedBy,
      createdAt: s.createdAt.toISOString(),
    })),
    interested: row.reactions.filter((r) => r.kind === 'INTERESTED').map((r) => r.user),
    notInterestedCount: row.reactions.filter((r) => r.kind === 'NOT_INTERESTED').length,
    myReaction: mine?.kind ?? null,
    commentCount: row._count.comments,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

export function toStop(s: VersionRow['stops'][number]): ItineraryStopDTO {
  return {
    key: s.key,
    ideaId: s.ideaId,
    title: s.title,
    dayIndex: s.dayIndex,
    sequence: s.sequence,
    startMin: s.startMin,
    durationMin: s.durationMin,
    travelMinFromPrev: s.travelMinFromPrev,
    fixedStartMin: s.fixedStartMin,
    locked: s.locked,
    cost: money(s.costMinor, s.costCurrency),
  };
}

export function toVersion(row: VersionRow): ItineraryVersionDTO {
  return {
    version: row.version,
    source: row.source,
    note: row.note,
    committedBy: row.committedBy,
    committedAt: row.committedAt.toISOString(),
    stops: row.stops.map(toStop),
  };
}
