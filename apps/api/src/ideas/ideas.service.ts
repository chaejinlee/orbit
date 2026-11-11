import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@orbit/db';
import {
  findDuplicatePlaces,
  InvalidLinkError,
  normalizeLink,
  parseMapsLink,
  suggestLinkTitle,
  type CreateIdeaInput,
  type CreateIdeaResultDTO,
  type DuplicateCandidateDTO,
  type IdeaDTO,
  type IdeaPreviewDTO,
  type NormalizedLink,
  type PlaceCandidate,
  type PreviewIdeaInput,
  type ReactionKind,
  type UpdateIdeaInput,
} from '@orbit/shared';
import { isUniqueViolation } from '../core/http';
import { ideaInclude, toIdea } from '../core/mappers';
import { PRISMA, type AuthUser, type Db } from '../core/tokens';

type Tx = Prisma.TransactionClient;

@Injectable()
export class IdeasService {
  constructor(@Inject(PRISMA) private readonly db: Db) {}

  async list(planId: string, user: AuthUser, includeArchived: boolean): Promise<IdeaDTO[]> {
    const rows = await this.db.idea.findMany({
      where: { planId, mergedIntoId: null, ...(includeArchived ? {} : { archivedAt: null }) },
      orderBy: { createdAt: 'asc' },
      include: ideaInclude,
    });
    return rows.map((r) => toIdea(r, user.id));
  }

  /** Read-only: what the link/place resolves to and what it may duplicate. */
  async preview(planId: string, input: PreviewIdeaInput): Promise<IdeaPreviewDTO> {
    if (input.kind === 'PLACE') {
      return { link: null, parsedPlace: null, duplicates: await this.placeDuplicates(planId, input.place) };
    }
    const link = this.normalize(input.url);
    const parsed = parseMapsLink(link.url);
    const sameLink = await this.db.ideaSource.findMany({
      where: { planId, urlKey: link.key, idea: { archivedAt: null, mergedIntoId: null } },
      select: { idea: { select: { id: true, title: true } } },
    });
    const duplicates = new Map<string, DuplicateCandidateDTO>();
    for (const { idea } of sameLink) {
      duplicates.set(idea.id, { ideaId: idea.id, title: idea.title, confidence: 'high', reasons: ['same_link'] });
    }
    if (parsed?.name) {
      for (const d of await this.placeDuplicates(planId, { name: parsed.name, lat: parsed.lat, lng: parsed.lng })) {
        if (!duplicates.has(d.ideaId)) duplicates.set(d.ideaId, d);
      }
    }
    return {
      link: { url: link.url, host: link.host, platform: link.platform },
      parsedPlace: parsed ? { name: parsed.name, lat: parsed.lat, lng: parsed.lng } : null,
      duplicates: [...duplicates.values()],
    };
  }

  /**
   * Creates an idea card, or — with mergeIntoIdeaId — attaches the new link or
   * note to an existing idea and records the user's interest. Idempotent on
   * clientRequestId for both paths.
   */
  async create(planId: string, user: AuthUser, input: CreateIdeaInput): Promise<CreateIdeaResultDTO> {
    const replay = await this.findReplay(planId, input.clientRequestId, user.id);
    if (replay) return replay;

    const rawUrl = input.kind === 'LINK' ? input.url : input.kind === 'PLACE' ? input.sourceUrl : undefined;
    const link = rawUrl ? this.normalize(rawUrl) : null;

    try {
      if (input.mergeIntoIdeaId) return await this.merge(planId, user, input, link);

      const idea = await this.db.$transaction(async (tx) => {
        const placeInput = input.kind === 'PLACE' || input.kind === 'ACTIVITY' ? input.place : undefined;
        const place = placeInput
          ? await tx.placeRef.create({
              data: {
                provider: 'MANUAL',
                name: placeInput.name,
                address: placeInput.address ?? null,
                lat: placeInput.lat ?? null,
                lng: placeInput.lng ?? null,
                category: placeInput.category ?? null,
              },
            })
          : null;
        const title =
          input.kind === 'LINK'
            ? input.title || suggestLinkTitle(link!, parseMapsLink(link!.url))
            : input.kind === 'PLACE'
              ? input.place.name
              : input.title;

        const created = await tx.idea.create({
          data: {
            planId,
            kind: input.kind,
            title,
            note: input.note || null,
            placeRefId: place?.id ?? null,
            createdById: user.id,
            clientRequestId: input.clientRequestId,
            sources: link
              ? {
                  create: {
                    planId,
                    kind: 'LINK',
                    url: link.url,
                    urlKey: link.key,
                    platform: link.platform,
                    addedById: user.id,
                  },
                }
              : undefined,
          },
          include: ideaInclude,
        });
        await this.touchPlan(tx, planId, user.id, 'idea.created', { ideaId: created.id, kind: created.kind });
        return created;
      });
      return { idea: toIdea(idea, user.id), merged: false, replayed: false };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await this.findReplay(planId, input.clientRequestId, user.id);
      if (!raced) throw error;
      return raced;
    }
  }

  async update(planId: string, ideaId: string, user: AuthUser, patch: UpdateIdeaInput): Promise<IdeaDTO> {
    await this.requireIdea(planId, ideaId);
    const row = await this.db.idea.update({
      where: { id: ideaId },
      data: {
        ...(patch.title !== undefined && { title: patch.title }),
        ...(patch.note !== undefined && { note: patch.note || null }),
        ...(patch.shortlisted !== undefined && { shortlisted: patch.shortlisted }),
        ...(patch.durationMin !== undefined && { durationMin: patch.durationMin }),
        ...(patch.cost !== undefined && {
          costMinor: patch.cost?.amountMinor ?? null,
          costCurrency: patch.cost?.currency ?? null,
        }),
      },
      include: ideaInclude,
    });
    return toIdea(row, user.id);
  }

  /** Archive hides the idea everywhere but keeps it (and any itinerary history) intact. */
  async setArchived(planId: string, ideaId: string, user: AuthUser, archived: boolean): Promise<IdeaDTO> {
    await this.requireIdea(planId, ideaId);
    const row = await this.db.idea.update({
      where: { id: ideaId },
      data: { archivedAt: archived ? new Date() : null },
      include: ideaInclude,
    });
    return toIdea(row, user.id);
  }

  async react(planId: string, ideaId: string, user: AuthUser, kind: ReactionKind | null): Promise<IdeaDTO> {
    await this.requireIdea(planId, ideaId);
    const where = { ideaId_userId: { ideaId, userId: user.id } };
    if (kind) {
      await this.db.ideaReaction.upsert({ where, create: { ideaId, userId: user.id, kind }, update: { kind } });
    } else {
      await this.db.ideaReaction.deleteMany({ where: { ideaId, userId: user.id } });
    }
    const row = await this.db.idea.findUniqueOrThrow({ where: { id: ideaId }, include: ideaInclude });
    return toIdea(row, user.id);
  }

  private async merge(
    planId: string,
    user: AuthUser,
    input: CreateIdeaInput,
    link: NormalizedLink | null,
  ): Promise<CreateIdeaResultDTO> {
    const target = await this.db.idea.findFirst({
      where: { id: input.mergeIntoIdeaId, planId, archivedAt: null, mergedIntoId: null },
      select: { id: true },
    });
    if (!target) throw new NotFoundException('That idea is no longer on this plan. Save this as a new idea instead.');

    await this.db.$transaction(async (tx) => {
      const source: Omit<Prisma.IdeaSourceUncheckedCreateInput, 'ideaId' | 'planId' | 'addedById'> | null = link
        ? { kind: 'LINK', url: link.url, urlKey: link.key, platform: link.platform, note: input.note || null }
        : input.note
          ? { kind: 'NOTE', note: input.note }
          : null;
      if (source) {
        await tx.ideaSource.create({
          data: { ...source, ideaId: target.id, planId, addedById: user.id, clientRequestId: input.clientRequestId },
        });
      }
      // Saving the same place again is a signal: count it as interest.
      await tx.ideaReaction.upsert({
        where: { ideaId_userId: { ideaId: target.id, userId: user.id } },
        create: { ideaId: target.id, userId: user.id, kind: 'INTERESTED' },
        update: { kind: 'INTERESTED' },
      });
      await this.touchPlan(tx, planId, user.id, 'idea.merged', { ideaId: target.id });
    });

    const row = await this.db.idea.findUniqueOrThrow({ where: { id: target.id }, include: ideaInclude });
    return { idea: toIdea(row, user.id), merged: true, replayed: false };
  }

  private async findReplay(planId: string, clientRequestId: string, userId: string): Promise<CreateIdeaResultDTO | null> {
    const idea = await this.db.idea.findUnique({
      where: { planId_clientRequestId: { planId, clientRequestId } },
      include: ideaInclude,
    });
    if (idea) return { idea: toIdea(idea, userId), merged: false, replayed: true };
    const source = await this.db.ideaSource.findUnique({
      where: { planId_clientRequestId: { planId, clientRequestId } },
      select: { ideaId: true },
    });
    if (!source) return null;
    const target = await this.db.idea.findUniqueOrThrow({ where: { id: source.ideaId }, include: ideaInclude });
    return { idea: toIdea(target, userId), merged: true, replayed: true };
  }

  private async placeDuplicates(planId: string, candidate: PlaceCandidate): Promise<DuplicateCandidateDTO[]> {
    const ideas = await this.db.idea.findMany({
      where: { planId, archivedAt: null, mergedIntoId: null, placeRefId: { not: null } },
      select: {
        id: true,
        title: true,
        place: { select: { name: true, lat: true, lng: true, provider: true, externalId: true } },
      },
    });
    const titles = new Map(ideas.map((i) => [i.id, i.title]));
    return findDuplicatePlaces(
      candidate,
      ideas.map((i) => ({
        id: i.id,
        name: i.place?.name ?? i.title,
        lat: i.place?.lat,
        lng: i.place?.lng,
        provider: i.place?.provider,
        externalId: i.place?.externalId,
      })),
    ).map((m) => ({
      ideaId: m.id,
      title: titles.get(m.id) ?? '',
      confidence: m.confidence,
      reasons: m.reasons,
      distanceM: m.distanceM,
    }));
  }

  /** Scopes every idea id to its plan: an id from another plan is simply "not found". */
  private async requireIdea(planId: string, ideaId: string): Promise<void> {
    const idea = await this.db.idea.findFirst({ where: { id: ideaId, planId }, select: { id: true } });
    if (!idea) throw new NotFoundException('Idea not found.');
  }

  private async touchPlan(tx: Tx, planId: string, actorId: string, type: string, payload: Prisma.InputJsonValue) {
    await tx.plan.update({ where: { id: planId }, data: { updatedAt: new Date() } });
    await tx.plan.updateMany({ where: { id: planId, status: 'DRAFT' }, data: { status: 'PLANNING' } });
    await tx.activityEvent.create({ data: { planId, actorId, type, payload } });
  }

  private normalize(url: string): NormalizedLink {
    try {
      return normalizeLink(url);
    } catch (error) {
      if (error instanceof InvalidLinkError) {
        throw new BadRequestException({ statusCode: 400, code: 'INVALID_LINK', message: error.message });
      }
      throw error;
    }
  }
}
