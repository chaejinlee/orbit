import { ConflictException, ForbiddenException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@orbit/db';
import { can, type CommentDTO, type CreateCommentInput, type MemberRole } from '@orbit/shared';
import { apiError, isUniqueViolation, personSelect } from '../core/http';
import { PRISMA, type AuthUser, type Db } from '../core/tokens';

const commentInclude = { author: { select: personSelect } } satisfies Prisma.CommentInclude;
type CommentRow = Prisma.CommentGetPayload<{ include: typeof commentInclude }>;

/** The newest this many comments on a card are returned (plenty for a group thread). */
const MAX_COMMENTS = 200;

function toComment(row: CommentRow, userId: string, role: MemberRole): CommentDTO {
  return {
    id: row.id,
    ideaId: row.ideaId,
    content: row.content,
    author: row.author,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
    mine: row.authorId === userId,
    canDelete: row.authorId === userId || can(role, 'comment.moderate'),
  };
}

/**
 * Comments on a card (W05). Every member can comment, viewers included.
 * People edit and delete their own; the owner can also delete anyone's.
 * Deleting keeps the row with `deletedAt` (for the activity history) and drops
 * it from every list. Ids are always scoped by the plan in the query.
 */
@Injectable()
export class CommentsService {
  constructor(@Inject(PRISMA) private readonly db: Db) {}

  async list(planId: string, ideaId: string, user: AuthUser, role: MemberRole): Promise<CommentDTO[]> {
    await this.findIdea(planId, ideaId);
    const rows = await this.db.comment.findMany({
      where: { ideaId, deletedAt: null },
      include: commentInclude,
      orderBy: { createdAt: 'desc' },
      take: MAX_COMMENTS,
    });
    return rows.reverse().map((row) => toComment(row, user.id, role));
  }

  /** Idempotent per (author, clientRequestId): a retried Send returns the first comment. */
  async create(planId: string, ideaId: string, user: AuthUser, role: MemberRole, input: CreateCommentInput): Promise<CommentDTO> {
    const replay = await this.findByRequest(user.id, input.clientRequestId);
    if (replay) return this.replayed(replay, ideaId, user, role);

    const idea = await this.findIdea(planId, ideaId);
    if (idea.archivedAt) throw apiError(HttpStatus.CONFLICT, 'IDEA_ARCHIVED', 'This idea is archived. Restore it to comment.');
    try {
      const row = await this.db.comment.create({
        data: { ideaId, authorId: user.id, content: input.content, clientRequestId: input.clientRequestId },
        include: commentInclude,
      });
      await this.db.activityEvent.create({
        data: { planId, actorId: user.id, type: 'comment.created', payload: { commentId: row.id, ideaId } },
      });
      return toComment(row, user.id, role);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await this.findByRequest(user.id, input.clientRequestId);
      if (!raced) throw error;
      return this.replayed(raced, ideaId, user, role);
    }
  }

  async update(planId: string, commentId: string, user: AuthUser, role: MemberRole, content: string): Promise<CommentDTO> {
    const row = await this.findComment(planId, commentId);
    if (!row || row.deletedAt) throw new NotFoundException('Comment not found.');
    if (row.authorId !== user.id) throw new ForbiddenException('You can only edit your own comments.');
    if (row.content === content) return toComment(row, user.id, role);
    const saved = await this.db.comment.update({
      where: { id: row.id },
      data: { content, editedAt: new Date() },
      include: commentInclude,
    });
    return toComment(saved, user.id, role);
  }

  /** Idempotent: deleting a deleted comment succeeds quietly. */
  async remove(planId: string, commentId: string, user: AuthUser, role: MemberRole): Promise<void> {
    const row = await this.findComment(planId, commentId);
    if (!row) throw new NotFoundException('Comment not found.');
    const moderating = row.authorId !== user.id;
    if (moderating && !can(role, 'comment.moderate')) {
      throw new ForbiddenException('Only the person who wrote this, or the plan owner, can delete it.');
    }
    if (row.deletedAt) return;
    await this.db.comment.update({ where: { id: row.id }, data: { deletedAt: new Date() } });
    await this.db.activityEvent.create({
      data: { planId, actorId: user.id, type: 'comment.deleted', payload: { commentId, ideaId: row.ideaId, moderated: moderating } },
    });
  }

  private async findIdea(planId: string, ideaId: string) {
    const idea = await this.db.idea.findFirst({ where: { id: ideaId, planId }, select: { id: true, archivedAt: true } });
    if (!idea) throw new NotFoundException('Idea not found.');
    return idea;
  }

  private findComment(planId: string, commentId: string) {
    return this.db.comment.findFirst({ where: { id: commentId, idea: { planId } }, include: commentInclude });
  }

  private findByRequest(authorId: string, clientRequestId: string) {
    return this.db.comment.findUnique({
      where: { authorId_clientRequestId: { authorId, clientRequestId } },
      include: commentInclude,
    });
  }

  private replayed(row: CommentRow, ideaId: string, user: AuthUser, role: MemberRole): CommentDTO {
    if (row.ideaId !== ideaId) throw new ConflictException('That request id was already used for another comment.');
    if (row.deletedAt) throw new NotFoundException('That comment was deleted.');
    return toComment(row, user.id, role);
  }
}
