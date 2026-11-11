import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  blockingIssues,
  scheduleItinerary,
  travelEstimatorFor,
  validateItinerary,
  type CommitItineraryInput,
  type ConstraintsFailedDTO,
  type ItineraryStateDTO,
  type ItineraryVersionDTO,
  type VersionConflictDTO,
} from '@orbit/shared';
import { personSelect } from '../core/http';
import { money, toVersion, versionInclude } from '../core/mappers';
import { PRISMA, type AuthUser, type Db } from '../core/tokens';

@Injectable()
export class ItineraryService {
  constructor(@Inject(PRISMA) private readonly db: Db) {}

  async state(planId: string): Promise<ItineraryStateDTO> {
    const { currentVersion } = await this.db.plan.findUniqueOrThrow({
      where: { id: planId },
      select: { currentVersion: true },
    });
    const [current, history] = await Promise.all([
      currentVersion > 0
        ? this.db.itineraryVersion.findUnique({
            where: { planId_version: { planId, version: currentVersion } },
            include: versionInclude,
          })
        : null,
      this.db.itineraryVersion.findMany({
        where: { planId },
        orderBy: { version: 'desc' },
        include: { committedBy: { select: personSelect }, _count: { select: { stops: true } } },
      }),
    ]);
    return {
      currentVersion,
      current: current ? toVersion(current) : null,
      history: history.map((v) => ({
        version: v.version,
        source: v.source,
        note: v.note,
        committedBy: v.committedBy,
        committedAt: v.committedAt.toISOString(),
        stopCount: v._count.stops,
      })),
    };
  }

  async version(planId: string, version: number): Promise<ItineraryVersionDTO> {
    const row = await this.db.itineraryVersion.findUnique({
      where: { planId_version: { planId, version } },
      include: versionInclude,
    });
    if (!row) throw new NotFoundException(`Version ${version} doesn’t exist.`);
    return toVersion(row);
  }

  /**
   * Turns the reviewed draft into the next immutable version.
   *
   * 1. Every stop must reference an idea of this plan.
   * 2. The deterministic validator re-runs here; hard-constraint errors block
   *    unless the user explicitly accepted that exact issue code.
   * 3. Optimistic concurrency: the version bump is a conditional UPDATE
   *    (`WHERE currentVersion = expectedVersion`). Of two concurrent commits
   *    against the same version exactly one wins; the other gets a 409 with
   *    the current version instead of silently overwriting it.
   */
  async commit(planId: string, user: AuthUser, input: CommitItineraryInput): Promise<ItineraryVersionDTO> {
    const plan = await this.db.plan.findUniqueOrThrow({
      where: { id: planId },
      select: { startMin: true, endMin: true, budgetMinor: true, budgetCurrency: true, currentVersion: true },
    });
    if (plan.currentVersion !== input.expectedVersion) {
      throw this.conflict(input.expectedVersion, plan.currentVersion);
    }

    const ideaIds = [...new Set(input.stops.flatMap((s) => (s.ideaId ? [s.ideaId] : [])))];
    const owned = ideaIds.length
      ? await this.db.idea.findMany({
          where: { planId, id: { in: ideaIds } },
          select: { id: true, place: { select: { lat: true, lng: true } } },
        })
      : [];
    if (owned.length !== ideaIds.length) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'UNKNOWN_IDEA',
        message: 'Some stops point to ideas that aren’t part of this plan.',
      });
    }

    // Same travel estimate as the browser (place coordinates), so both sides
    // compute the same schedule and the same issues.
    const points = new Map(
      owned.flatMap((i) => (i.place?.lat != null && i.place?.lng != null ? [[i.id, { lat: i.place.lat, lng: i.place.lng }] as const] : [])),
    );
    const scheduled = scheduleItinerary(input.stops, {
      dayStartMin: plan.startMin,
      estimateTravelMin: travelEstimatorFor((id) => points.get(id)),
    });
    const issues = validateItinerary(scheduled, {
      window: { startMin: plan.startMin, endMin: plan.endMin },
      budget: money(plan.budgetMinor, plan.budgetCurrency),
    });
    const blocking = blockingIssues(issues, input.acceptedIssueCodes);
    if (blocking.length > 0) {
      const body: ConstraintsFailedDTO = { code: 'CONSTRAINTS_FAILED', message: blocking[0]!.message, issues: blocking };
      throw new UnprocessableEntityException({ statusCode: 422, ...body });
    }

    const row = await this.db.$transaction(async (tx) => {
      const bumped = await tx.plan.updateMany({
        where: { id: planId, currentVersion: input.expectedVersion },
        data: { currentVersion: { increment: 1 }, status: 'CONFIRMED' },
      });
      if (bumped.count === 0) {
        const now = await tx.plan.findUniqueOrThrow({ where: { id: planId }, select: { currentVersion: true } });
        throw this.conflict(input.expectedVersion, now.currentVersion);
      }
      const version = await tx.itineraryVersion.create({
        data: {
          planId,
          version: input.expectedVersion + 1,
          source: 'DRAFT',
          note: input.note || null,
          committedById: user.id,
          stops: {
            create: scheduled.map((s) => ({
              key: s.id,
              ideaId: s.ideaId,
              title: s.title,
              dayIndex: s.dayIndex,
              sequence: s.sequence,
              startMin: s.startMin,
              durationMin: s.durationMin,
              travelMinFromPrev: s.travelMinFromPrev,
              fixedStartMin: s.fixedStartMin,
              locked: s.locked,
              costMinor: s.costMinor,
              costCurrency: s.costCurrency,
            })),
          },
        },
        include: versionInclude,
      });
      await tx.activityEvent.create({
        data: {
          planId,
          actorId: user.id,
          type: 'itinerary.committed',
          payload: { version: version.version, stops: scheduled.length, acceptedIssueCodes: input.acceptedIssueCodes },
        },
      });
      return version;
    });
    return toVersion(row);
  }

  private conflict(expectedVersion: number, currentVersion: number): ConflictException {
    const body: VersionConflictDTO = {
      code: 'VERSION_CONFLICT',
      message: `The confirmed plan changed (it’s now version ${currentVersion}). Review the latest version before confirming.`,
      expectedVersion,
      currentVersion,
    };
    return new ConflictException({ statusCode: 409, ...body });
  }
}
