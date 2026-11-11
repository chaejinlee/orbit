import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  defaultPlanName,
  planWindowErrors,
  type CreatePlanInput,
  type PlanDTO,
  type UpdatePlanInput,
  type WorkspaceView,
} from '@orbit/shared';
import { isUniqueViolation } from '../core/http';
import { isoDay, planInclude, toPlan } from '../core/mappers';
import { PRISMA, type AuthUser, type Db } from '../core/tokens';

const day = (iso: string | null | undefined) => (iso ? new Date(`${iso}T00:00:00Z`) : null);

@Injectable()
export class PlansService {
  constructor(@Inject(PRISMA) private readonly db: Db) {}

  /**
   * Idempotent: the client sends a clientRequestId generated once per form, so
   * a double click or a retried request returns the same plan instead of two.
   */
  async create(user: AuthUser, input: CreatePlanInput): Promise<PlanDTO> {
    const existing = await this.findByRequest(user.id, input.clientRequestId);
    if (existing) return existing;

    const singleDay = input.type !== 'TRIP';
    try {
      const plan = await this.db.plan.create({
        data: {
          type: input.type,
          name: input.name || defaultPlanName(input.type, { startDate: input.startDate, city: input.city }),
          city: input.city || null,
          timezone: input.timezone ?? null,
          startDate: day(input.startDate),
          endDate: day(input.endDate ?? (singleDay ? input.startDate : undefined)),
          startMin: input.startMin ?? null,
          endMin: input.endMin ?? null,
          budgetMinor: input.budget?.amountMinor ?? null,
          budgetCurrency: input.budget?.currency ?? null,
          createdById: user.id,
          clientRequestId: input.clientRequestId,
          members: { create: { userId: user.id, role: 'OWNER' } },
          aiSettings: { create: {} },
          events: { create: { type: 'plan.created', actorId: user.id } },
        },
        include: planInclude,
      });
      return toPlan(plan, user.id);
    } catch (error) {
      // Two identical requests raced past the lookup: return the winner.
      if (!isUniqueViolation(error)) throw error;
      const raced = await this.findByRequest(user.id, input.clientRequestId);
      if (!raced) throw error;
      return raced;
    }
  }

  async list(user: AuthUser): Promise<PlanDTO[]> {
    const plans = await this.db.plan.findMany({
      where: { archivedAt: null, members: { some: { userId: user.id } } },
      orderBy: { updatedAt: 'desc' },
      include: planInclude,
    });
    return plans.map((p) => toPlan(p, user.id));
  }

  async get(planId: string, user: AuthUser): Promise<PlanDTO> {
    const plan = await this.db.plan.findUniqueOrThrow({ where: { id: planId }, include: planInclude });
    return toPlan(plan, user.id);
  }

  /** Validates the merged result, not just the patch (an end date alone can be invalid). */
  async update(planId: string, user: AuthUser, patch: UpdatePlanInput): Promise<PlanDTO> {
    const current = await this.db.plan.findUniqueOrThrow({ where: { id: planId } });
    const singleDay = current.type !== 'TRIP';
    const startDate = patch.startDate !== undefined ? patch.startDate : isoDay(current.startDate);
    let endDate = patch.endDate !== undefined ? patch.endDate : isoDay(current.endDate);
    if (singleDay && patch.startDate !== undefined && patch.endDate === undefined) endDate = startDate;

    const merged = {
      type: current.type,
      startDate,
      endDate,
      startMin: patch.startMin !== undefined ? patch.startMin : current.startMin,
      endMin: patch.endMin !== undefined ? patch.endMin : current.endMin,
    };
    const errors = planWindowErrors(merged);
    if (errors.length > 0) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'VALIDATION_FAILED',
        message: errors[0]!.message,
        issues: errors.map((e) => ({ path: e.path, message: e.message })),
      });
    }

    const plan = await this.db.plan.update({
      where: { id: planId },
      data: {
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.city !== undefined && { city: patch.city || null }),
        ...(patch.timezone !== undefined && { timezone: patch.timezone }),
        ...(patch.entryMode !== undefined && { entryMode: patch.entryMode }),
        ...(patch.budget !== undefined && {
          budgetMinor: patch.budget?.amountMinor ?? null,
          budgetCurrency: patch.budget?.currency ?? null,
        }),
        startDate: day(merged.startDate),
        endDate: day(merged.endDate),
        startMin: merged.startMin,
        endMin: merged.endMin,
      },
      include: planInclude,
    });
    return toPlan(plan, user.id);
  }

  async setLastView(planId: string, user: AuthUser, view: WorkspaceView): Promise<void> {
    await this.db.planMember.update({
      where: { planId_userId: { planId, userId: user.id } },
      data: { lastView: view },
    });
  }

  private async findByRequest(userId: string, clientRequestId: string): Promise<PlanDTO | null> {
    const plan = await this.db.plan.findUnique({
      where: { createdById_clientRequestId: { createdById: userId, clientRequestId } },
      include: planInclude,
    });
    return plan ? toPlan(plan, userId) : null;
  }
}
