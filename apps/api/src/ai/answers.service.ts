import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@orbit/db';
import { ASK_PRESETS, type AiAnswerDTO, type AiSourceProvider, type AskInput, type AskPreset, type MemberRole } from '@orbit/shared';
import { isUniqueViolation, personSelect } from '../core/http';
import { isoDay } from '../core/mappers';
import { PRISMA, type AuthUser, type Db } from '../core/tokens';
import { AI_MODEL, AiError, isSafeSourceUrl, type AiModel, type GroundedAnswer, type GroundedRequest, type Grounding } from './model';
import { ASK_SYSTEM, ASK_SYSTEM_UNCHECKED, buildAskPrompt, looksEnglish, presetLabel, presetQuestion } from './prompts';
import { AiUsageService } from './usage.service';

const answerInclude = {
  sources: { orderBy: { accessedAt: 'asc' } },
  requestedBy: { select: personSelect },
  sharedBy: { select: personSelect },
} satisfies Prisma.AiResponseInclude;
type AnswerRow = Prisma.AiResponseGetPayload<{ include: typeof answerInclude }>;

const MAX_ANSWER_CHARS = 1200;

function http(status: HttpStatus, code: string, message: string): HttpException {
  return new HttpException({ statusCode: status, code, message }, status);
}

/** Which grounding actually answered, as stored with the usage. */
function checkedWithOf(row: AnswerRow): AiAnswerDTO['checkedWith'] {
  const used = (row.usage as { grounding?: unknown } | null)?.grounding;
  return used === 'google_maps' || used === 'google_search' ? used : null;
}

function toAnswer(row: AnswerRow, userId: string): AiAnswerDTO {
  const checkedWith = checkedWithOf(row);
  return {
    id: row.id,
    ideaId: row.ideaId,
    question: row.questionSnapshot,
    preset: (ASK_PRESETS as readonly string[]).includes(row.preset ?? '') ? (row.preset as AskPreset) : null,
    answer: row.answer ?? '',
    sources: row.sources.map((s) => ({ url: s.url, title: s.title, provider: (s.provider as AiSourceProvider | null) ?? null })),
    checkedWith,
    checkedAt: checkedWith ? (row.checkedAt ?? row.createdAt).toISOString() : null,
    visibility: row.visibility,
    mine: row.requestedById === userId,
    requestedBy: row.requestedBy,
    sharedBy: row.sharedBy,
    sharedAt: row.sharedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toHttpError(error: unknown): HttpException {
  if (error instanceof AiError) {
    switch (error.reason) {
      case 'rate_limited':
        return http(HttpStatus.SERVICE_UNAVAILABLE, 'AI_BUSY', 'Gemini is busy right now (rate limit). Try again in a minute.');
      case 'bad_key':
        return http(HttpStatus.SERVICE_UNAVAILABLE, 'AI_KEY', 'Gemini rejected the API key. Check GEMINI_API_KEY in .env.');
      case 'bad_model':
        return http(HttpStatus.SERVICE_UNAVAILABLE, 'AI_MODEL', error.message);
      case 'no_credit':
        return http(HttpStatus.SERVICE_UNAVAILABLE, 'AI_BILLING', error.message);
      case 'blocked':
        return http(HttpStatus.UNPROCESSABLE_ENTITY, 'AI_BLOCKED', 'Orbit can’t answer that one.');
      default:
        return http(HttpStatus.BAD_GATEWAY, 'AI_FAILED', 'Orbit couldn’t get an answer this time. Try again.');
    }
  }
  return http(HttpStatus.BAD_GATEWAY, 'AI_FAILED', 'Orbit couldn’t get an answer this time. Try again.');
}

/**
 * Ask Orbit about one card (W05, on-demand). Answers are private to the asker
 * until they press Share; then every member of the plan sees them. Facts come
 * from Google Maps (places) or Google Search grounding, with the sources
 * stored next to the answer and a "checked at" time.
 */
@Injectable()
export class AnswersService {
  private readonly log = new Logger('AskOrbit');
  private warnedNoGrounding = false;

  constructor(
    @Inject(PRISMA) private readonly db: Db,
    @Inject(AI_MODEL) private readonly ai: AiModel | null,
    @Inject(AiUsageService) private readonly usage: AiUsageService,
  ) {}

  async ask(planId: string, ideaId: string, user: AuthUser, input: AskInput): Promise<AiAnswerDTO> {
    if (!this.ai) throw http(HttpStatus.SERVICE_UNAVAILABLE, 'AI_OFF', 'AI is off on this server.');

    const replay = await this.findByRequest(user.id, input.clientRequestId);
    if (replay) return this.replay(replay, planId, ideaId, user.id);

    const idea = await this.db.idea.findFirst({
      where: { id: ideaId, planId, archivedAt: null, mergedIntoId: null },
      include: { place: true, plan: true, sources: { orderBy: { createdAt: 'asc' }, select: { url: true } } },
    });
    if (!idea) throw new NotFoundException('Idea not found.');
    await this.usage.assertRoom(user.id);

    const name = idea.place?.name || idea.title;
    const date = input.preset === 'HOURS' ? isoDay(idea.plan.startDate) : null;
    const question = input.preset ? presetQuestion(input.preset, name, date) : input.question!;
    const hasPlace = !!idea.place && (idea.place.lat != null || !!idea.place.name || !!idea.place.address);
    const grounding: Grounding = hasPlace && looksEnglish(question) ? 'google_maps' : 'google_search';
    const location = idea.place?.lat != null && idea.place?.lng != null ? { lat: idea.place.lat, lng: idea.place.lng } : null;

    let row: { id: string };
    try {
      row = await this.db.aiResponse.create({
        data: {
          planId,
          ideaId,
          requestedById: user.id,
          channel: 'ASK_BUTTON',
          visibility: 'PRIVATE',
          status: 'PENDING',
          questionSnapshot: input.preset ? presetLabel(input.preset) : input.question!,
          clientRequestId: input.clientRequestId,
          preset: input.preset ?? null,
          model: this.ai.model,
        },
        select: { id: true },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const again = await this.findByRequest(user.id, input.clientRequestId);
      if (again) return this.replay(again, planId, ideaId, user.id);
      throw error;
    }

    try {
      const { result, used } = await this.answerWithFallback({
        system: ASK_SYSTEM,
        prompt: buildAskPrompt({
          question,
          preset: input.preset ?? null,
          idea: { title: idea.title, kind: idea.kind, note: idea.note },
          place: idea.place ? { name: idea.place.name, address: idea.place.address, lat: idea.place.lat, lng: idea.place.lng } : null,
          city: idea.plan.city,
          date,
          sourceUrls: idea.sources.flatMap((s) => (s.url ? [s.url] : [])),
        }),
        grounding,
        location,
        maxOutputTokens: 700,
        context: { title: name, preset: input.preset ?? null },
      });
      const now = new Date();
      const saved = await this.db.aiResponse.update({
        where: { id: row.id },
        data: {
          status: 'ANSWERED',
          answer: result.text.length > MAX_ANSWER_CHARS ? `${result.text.slice(0, MAX_ANSWER_CHARS - 1)}…` : result.text,
          checkedAt: used === 'none' ? null : now,
          usage: { ...result.usage, grounding: used, ...(used !== grounding ? { groundingWanted: grounding } : {}) } as unknown as Prisma.InputJsonValue,
          sources: {
            create: result.sources
              .filter((s) => isSafeSourceUrl(s.url))
              .slice(0, 8)
              .map((s) => ({ url: s.url, title: s.title?.slice(0, 200) ?? null, provider: s.provider, accessedAt: now })),
          },
        },
        include: answerInclude,
      });
      return toAnswer(saved, user.id);
    } catch (error) {
      await this.db.aiResponse.update({ where: { id: row.id }, data: { status: 'FAILED' } }).catch(() => undefined);
      this.log.warn(`Ask failed (${error instanceof AiError ? error.reason : 'error'}): ${(error as Error).message}`);
      throw toHttpError(error);
    }
  }

  /** Answers this person may see on a card: everything shared, plus their own. */
  async list(planId: string, ideaId: string, userId: string): Promise<AiAnswerDTO[]> {
    const rows = await this.db.aiResponse.findMany({
      where: { planId, ideaId, status: 'ANSWERED', hiddenAt: null, OR: [{ visibility: 'SHARED' }, { requestedById: userId }] },
      include: answerInclude,
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return rows.map((r) => toAnswer(r, userId));
  }

  async share(planId: string, answerId: string, user: AuthUser): Promise<AiAnswerDTO> {
    const row = await this.db.aiResponse.findFirst({ where: { id: answerId, planId, hiddenAt: null }, include: answerInclude });
    if (!row || (row.visibility === 'PRIVATE' && row.requestedById !== user.id)) throw new NotFoundException('Answer not found.');
    if (row.requestedById !== user.id) throw new ForbiddenException('Only the person who asked can share this answer.');
    if (row.status !== 'ANSWERED') throw new ConflictException('This answer isn’t ready to share.');
    if (row.visibility === 'SHARED') return toAnswer(row, user.id);
    const saved = await this.db.aiResponse.update({
      where: { id: row.id },
      data: { visibility: 'SHARED', sharedById: user.id, sharedAt: new Date() },
      include: answerInclude,
    });
    await this.db.activityEvent.create({ data: { planId, actorId: user.id, type: 'ai.answer_shared', payload: { answerId, ideaId: row.ideaId } } });
    return toAnswer(saved, user.id);
  }

  /** "Hide this reply": the asker can hide their own; an owner can also hide shared ones. */
  async hide(planId: string, answerId: string, user: AuthUser, role: MemberRole): Promise<void> {
    const row = await this.db.aiResponse.findFirst({ where: { id: answerId, planId, hiddenAt: null } });
    if (!row || (row.visibility === 'PRIVATE' && row.requestedById !== user.id)) throw new NotFoundException('Answer not found.');
    if (row.requestedById !== user.id && role !== 'OWNER') throw new ForbiddenException('Only the person who asked (or the plan owner) can hide this.');
    await this.db.aiResponse.update({ where: { id: row.id }, data: { hiddenAt: new Date() } });
  }

  /**
   * Grounded first. If the key can't ground (Gemini 3+ grounding isn't in the
   * free tier), answer from general knowledge instead; the answer is stored
   * without sources and the UI labels it "not checked".
   */
  private async answerWithFallback(request: GroundedRequest): Promise<{ result: GroundedAnswer; used: Grounding }> {
    try {
      return { result: await this.ai!.answer(request), used: request.grounding };
    } catch (error) {
      if (!(error instanceof AiError && error.reason === 'grounding_unavailable')) throw error;
      if (!this.warnedNoGrounding) {
        this.warnedNoGrounding = true;
        this.log.warn('Gemini refused Google Maps / Search grounding (it needs billing on the API key). Answering without sources for now.');
      }
      const result = await this.ai!.answer({ ...request, system: ASK_SYSTEM_UNCHECKED, grounding: 'none', location: null });
      return { result: { ...result, sources: [] }, used: 'none' };
    }
  }

  private findByRequest(userId: string, clientRequestId: string) {
    return this.db.aiResponse.findUnique({
      where: { requestedById_clientRequestId: { requestedById: userId, clientRequestId } },
      include: answerInclude,
    });
  }

  private replay(row: AnswerRow, planId: string, ideaId: string, userId: string): AiAnswerDTO {
    if (row.planId !== planId || row.ideaId !== ideaId) throw new ConflictException('That request id was already used for another question.');
    if (row.status === 'ANSWERED') return toAnswer(row, userId);
    if (row.status === 'PENDING') throw http(HttpStatus.CONFLICT, 'AI_PENDING', 'Orbit is still answering this one.');
    throw http(HttpStatus.BAD_GATEWAY, 'AI_FAILED', 'That question didn’t get an answer. Ask again.');
  }
}
