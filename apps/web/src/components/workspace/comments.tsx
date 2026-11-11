'use client';

import { COMMENT_MAX_CHARS, type CommentDTO } from '@orbit/shared';
import { Send } from 'lucide-react';
import { useRef, useState, type KeyboardEvent } from 'react';
import { ApiError, newRequestId } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { useCommentMutations, useComments } from '@/lib/queries';
import { Avatar, Banner, Button, Skeleton, Textarea } from '../ui';

const errorText = (error: unknown, fallback: string) => (error instanceof ApiError ? error.message : fallback);

/** ⌘/Ctrl+Enter sends; plain Enter is a new line (phones have no ⌘ key). */
function onModEnter(send: () => void) {
  return (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
    }
  };
}

function CharCount({ text }: { text: string }) {
  const left = COMMENT_MAX_CHARS - text.length;
  return left <= 150 ? <span className="text-[11px] text-ink-3 tabular-nums">{left} left</span> : null;
}

function CommentItem({
  comment,
  saving,
  deleting,
  onSave,
  onDelete,
}: {
  comment: CommentDTO;
  saving: boolean;
  deleting: boolean;
  onSave: (content: string, done: () => void) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(comment.content);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const save = () => {
    const content = text.trim();
    if (!content) return;
    if (content === comment.content) setEditing(false);
    else onSave(content, () => setEditing(false));
  };

  return (
    <li className="flex gap-2.5">
      <Avatar person={comment.author} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-ink-3">
          <span className="font-semibold text-ink">{comment.mine ? 'You' : comment.author.name}</span> · {timeAgo(comment.createdAt)}
          {comment.editedAt && ' · edited'}
        </p>
        {editing ? (
          <div className="mt-1 flex flex-col gap-1.5">
            <Textarea
              aria-label="Edit comment"
              rows={2}
              autoFocus
              maxLength={COMMENT_MAX_CHARS}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onModEnter(save)}
              className="min-h-0 text-sm"
            />
            <div className="flex items-center gap-2">
              <Button size="sm" loading={saving} disabled={!text.trim()} onClick={save}>
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setText(comment.content);
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
              <CharCount text={text} />
            </div>
          </div>
        ) : (
          <p className="mt-0.5 text-sm leading-relaxed break-words whitespace-pre-wrap text-ink">{comment.content}</p>
        )}
        {!editing && (comment.mine || comment.canDelete) && (
          <div className="mt-0.5 flex items-center gap-3 text-xs">
            {confirmDelete ? (
              <>
                <span className="text-rose-700">Delete this comment?</span>
                <button type="button" className="font-semibold text-rose-700 hover:underline disabled:opacity-50" disabled={deleting} onClick={onDelete}>
                  {deleting ? 'Deleting…' : 'Delete'}
                </button>
                <button type="button" className="text-ink-3 hover:underline" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <>
                {comment.mine && (
                  <button type="button" className="text-ink-3 hover:text-ink hover:underline" onClick={() => setEditing(true)}>
                    Edit
                  </button>
                )}
                {comment.canDelete && (
                  <button type="button" className="text-ink-3 hover:text-rose-700 hover:underline" onClick={() => setConfirmDelete(true)}>
                    Delete
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

/**
 * W05 — the conversation on one card. Everyone in the plan can comment,
 * viewers included. New comments from others arrive live (a hint over the
 * plan's socket triggers a refetch).
 */
export function Comments({ planId, ideaId, canComment }: { planId: string; ideaId: string; canComment: boolean }) {
  const comments = useComments(planId, ideaId);
  const mutations = useCommentMutations(planId, ideaId);
  const [draft, setDraft] = useState('');
  // One id per message: a retried or double-tapped Send posts once.
  const requestId = useRef(newRequestId());

  const send = () => {
    const content = draft.trim();
    if (!content || mutations.create.isPending) return;
    mutations.create.mutate(
      { clientRequestId: requestId.current, content },
      {
        onSuccess: () => {
          setDraft('');
          requestId.current = newRequestId();
        },
      },
    );
  };

  const list = comments.data ?? [];
  const actionError = mutations.update.error ?? mutations.remove.error;

  return (
    <div className="flex flex-col gap-3">
      {comments.isPending ? (
        <Skeleton className="h-12 w-full" />
      ) : comments.isError ? (
        <Banner tone="error">Couldn’t load comments. {errorText(comments.error, '')}</Banner>
      ) : list.length === 0 ? (
        <p className="text-sm text-ink-3">No comments yet.</p>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Comments">
          {list.map((c) => (
            <CommentItem
              key={c.id}
              comment={c}
              saving={mutations.update.isPending && mutations.update.variables?.commentId === c.id}
              deleting={mutations.remove.isPending && mutations.remove.variables === c.id}
              onSave={(content, done) => mutations.update.mutate({ commentId: c.id, content }, { onSuccess: done })}
              onDelete={() => mutations.remove.mutate(c.id)}
            />
          ))}
        </ul>
      )}
      {actionError && <Banner tone="error">{errorText(actionError, 'That didn’t work. Try again.')}</Banner>}

      {canComment && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <Textarea
            aria-label="Write a comment"
            placeholder={list.length === 0 ? 'What do you think?' : 'Reply to the group…'}
            rows={2}
            maxLength={COMMENT_MAX_CHARS}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onModEnter(send)}
            className="min-h-0 text-sm"
          />
          {mutations.create.error && <Banner tone="error">{errorText(mutations.create.error, 'Couldn’t send. Try again.')}</Banner>}
          <div className="flex items-center justify-end gap-3">
            <CharCount text={draft} />
            <Button type="submit" size="sm" icon={<Send className="size-3.5" />} loading={mutations.create.isPending} disabled={!draft.trim()}>
              Send
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
