import { z } from 'zod';
import type { PersonDTO } from './api-types';
import { idempotencyKey } from './schemas';

// Comments on a card (W05). Plain text, one flat thread per idea.

export const COMMENT_MAX_CHARS = 1000;

const content = z
  .string()
  .trim()
  .min(1, 'Write something first.')
  .max(COMMENT_MAX_CHARS, `Keep it under ${COMMENT_MAX_CHARS} characters.`);

export const createCommentInput = z.object({
  /** Generated once per message, so a double-tapped Send posts once. */
  clientRequestId: idempotencyKey,
  content,
});
export type CreateCommentInput = z.infer<typeof createCommentInput>;

export const updateCommentInput = z.object({ content });
export type UpdateCommentInput = z.infer<typeof updateCommentInput>;

export interface CommentDTO {
  id: string;
  ideaId: string;
  content: string;
  author: PersonDTO;
  createdAt: string;
  editedAt: string | null;
  /** You wrote it, so you can edit it. */
  mine: boolean;
  /** Your own comment, or anyone's when you own the plan. */
  canDelete: boolean;
}
