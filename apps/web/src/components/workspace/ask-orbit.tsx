'use client';

import { ASK_PRESET_LABEL, ASK_PRESETS, type AiAnswerDTO, type AiStatusDTO, type AskPreset, type IdeaDTO } from '@orbit/shared';
import { Banknote, BusFront, Clock, EyeOff, Lightbulb, SendHorizontal, Share2, Sparkles, Ticket, type LucideIcon } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { ApiError, newRequestId } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { useAnswerMutations, useAnswers } from '@/lib/queries';
import { Badge, Banner, Button, IconButton, Input, Skeleton } from '../ui';

const PRESET_ICON: Record<AskPreset, LucideIcon> = {
  HOURS: Clock,
  PRICE: Banknote,
  RESERVATIONS: Ticket,
  GETTING_THERE: BusFront,
  TIPS: Lightbulb,
};

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function errorText(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Orbit couldn’t get an answer this time. Try again.';
}

export interface AskOrbitProps {
  planId: string;
  idea: IdeaDTO;
  ai: AiStatusDTO | undefined;
  canAsk: boolean;
  isOwner: boolean;
  meId: string;
}

/**
 * W05 on demand: one tap on a chip asks Orbit about this card. Answers are
 * private until the asker shares them. A checked answer shows its sources
 * (Google Maps or the web) and a "checked" time right under it; one Gemini
 * couldn't check (no billing on the key yet) says so instead.
 */
export function AskOrbit({ planId, idea, ai, canAsk, isOwner, meId }: AskOrbitProps) {
  const answers = useAnswers(planId, idea.id);
  const { ask, share, hide } = useAnswerMutations(planId, idea.id);
  const [typing, setTyping] = useState(false);
  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState<string | null>(null);

  const enabled = !!ai?.enabled;
  const list = answers.data ?? [];
  const left = ai ? Math.max(0, ai.dailyLimit - ai.usedToday) : null;

  const send = (input: { preset: AskPreset } | { question: string }, label: string) => {
    setPending(label);
    ask.mutate(
      { clientRequestId: newRequestId(), ...input },
      {
        onSettled: () => setPending(null),
        onSuccess: () => {
          if ('question' in input) {
            setQuestion('');
            setTyping(false);
          }
        },
      },
    );
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (q.length >= 3 && !pending) send({ question: q }, q);
  };

  return (
    <div className="flex flex-col gap-3">
      {canAsk && enabled && (
        <>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick questions">
            {ASK_PRESETS.map((p) => {
              const Icon = PRESET_ICON[p];
              return (
                <button
                  key={p}
                  type="button"
                  disabled={!!pending}
                  onClick={() => send({ preset: p }, ASK_PRESET_LABEL[p])}
                  className="inline-flex items-center gap-1 rounded-full border border-line-2 bg-paper px-2.5 py-1 text-xs font-semibold text-ink-2 transition-colors hover:border-lilac-600 hover:text-lilac-700 disabled:opacity-50"
                >
                  <Icon className="size-3.5" aria-hidden />
                  {ASK_PRESET_LABEL[p]}
                </button>
              );
            })}
            <button
              type="button"
              aria-expanded={typing}
              onClick={() => setTyping((t) => !t)}
              className="rounded-full px-2.5 py-1 text-xs font-semibold text-lilac-700 hover:bg-lilac-100"
            >
              Ask something else…
            </button>
          </div>
          {typing && (
            <form onSubmit={submit} className="flex items-center gap-1.5">
              <Input
                autoFocus
                aria-label="Your question"
                maxLength={280}
                placeholder="e.g. Is there vegetarian food?"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                className="h-9 min-w-0 text-[13px]"
              />
              <IconButton type="submit" label="Ask Orbit" disabled={question.trim().length < 3 || !!pending}>
                <SendHorizontal className="size-4" />
              </IconButton>
            </form>
          )}
          <p className="text-[11px] leading-relaxed text-ink-3">
            {ai?.provider === 'fake'
              ? 'Fake AI for development: answers are canned.'
              : 'Sends this card’s name, place and saved links to Google Gemini.'}{' '}
            Only you see answers until you share them.
            {left != null && left <= 10 && ` ${left} AI ${left === 1 ? 'request' : 'requests'} left today.`}
          </p>
        </>
      )}

      {canAsk && !enabled && ai && (
        <p className="rounded-xl bg-ink/[0.04] px-3 py-2 text-xs text-ink-3">
          Orbit AI is off. Add <code className="font-mono">GEMINI_API_KEY</code> to <code className="font-mono">.env</code> to ask about hours,
          prices and more.
        </p>
      )}

      {ask.isError && !pending && (
        <Banner tone={ask.error instanceof ApiError && ask.error.code === 'AI_LIMIT' ? 'warning' : 'error'}>{errorText(ask.error)}</Banner>
      )}

      {(pending || list.length > 0) && (
        <ul className="flex flex-col gap-2" aria-live="polite">
          {pending && (
            <li className="rounded-2xl border border-dashed border-line-2 p-3">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold text-lilac-700">
                <Sparkles className="size-3 animate-pulse" aria-hidden />
                {pending}
              </p>
              <p className="mt-1 text-xs text-ink-3">Orbit is answering…</p>
              <Skeleton className="mt-2 h-3 w-full" />
              <Skeleton className="mt-1.5 h-3 w-2/3" />
            </li>
          )}
          {list.map((answer) => (
            <AnswerCard
              key={answer.id}
              answer={answer}
              meId={meId}
              canHide={answer.mine || (isOwner && answer.visibility === 'SHARED')}
              sharing={share.isPending && share.variables === answer.id}
              onShare={() => share.mutate(answer.id)}
              onHide={() => hide.mutate(answer.id)}
            />
          ))}
        </ul>
      )}

      {!canAsk && list.length === 0 && <p className="text-sm text-ink-3">No shared answers yet.</p>}
    </div>
  );
}

function AnswerCard({
  answer,
  meId,
  canHide,
  sharing,
  onShare,
  onHide,
}: {
  answer: AiAnswerDTO;
  meId: string;
  canHide: boolean;
  sharing: boolean;
  onShare: () => void;
  onHide: () => void;
}) {
  return (
    <li className="rounded-2xl border border-line bg-paper p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold text-lilac-700">
          <Sparkles className="size-3 shrink-0" aria-hidden />
          Orbit AI
          <span className="truncate font-medium text-ink-3">· {answer.question}</span>
        </p>
        {canHide && (
          <IconButton label="Hide this answer" onClick={onHide} className="-mt-1.5 -mr-1.5 size-7">
            <EyeOff className="size-3.5" />
          </IconButton>
        )}
      </div>
      <p className="mt-1.5 text-[13px] leading-relaxed whitespace-pre-line text-ink">{answer.answer}</p>

      {answer.checkedWith == null ? (
        <p className="mt-2 text-xs font-medium text-butter-800">
          Not checked against <span translate="no">Google Maps</span> or the web. Gemini answered from general knowledge, so confirm before you
          go.
        </p>
      ) : answer.sources.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-0.5" aria-label="Sources">
          {answer.sources.map((s) => (
            <li key={s.url} className="truncate text-xs">
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="font-medium text-lilac-700 hover:underline">
                {s.title || hostOf(s.url)}
              </a>
              <span className="text-ink-3">
                {' · '}
                {s.provider === 'google_maps' ? <span translate="no">Google Maps</span> : hostOf(s.url)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs font-medium text-butter-800">No sources came back, so treat this as unverified.</p>
      )}

      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-3">
        <span>{answer.checkedAt ? `Checked ${timeAgo(answer.checkedAt)}` : `Answered ${timeAgo(answer.createdAt)}`}</span>
        {answer.visibility === 'PRIVATE' ? (
          <span className="flex items-center gap-2">
            <Badge>Only you</Badge>
            <Button size="sm" variant="secondary" icon={<Share2 className="size-3.5" />} loading={sharing} onClick={onShare}>
              Share with group
            </Button>
          </span>
        ) : (
          <span>
            Shared by {answer.sharedBy?.id === meId ? 'you' : (answer.sharedBy?.name ?? 'someone')}
            {answer.sharedAt ? ` · ${timeAgo(answer.sharedAt)}` : ''}
          </span>
        )}
      </div>
    </li>
  );
}
