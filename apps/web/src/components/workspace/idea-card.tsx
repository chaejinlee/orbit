'use client';

import { formatMoney, IDEA_STATUS_LABEL, PLATFORM_LABEL, type IdeaDTO, type IdeaStatus, type LinkPlatform } from '@orbit/shared';
import type { Node, NodeProps } from '@xyflow/react';
import { MessageCircle } from 'lucide-react';
import { memo } from 'react';
import { cn } from '@/lib/format';
import { IDEA_KIND_STYLE } from '../plan-visuals';
import { AvatarStack, StatusBadge } from '../ui';
import { ConnectHandles } from './canvas-items';

export const CARD_WIDTH = 248;

export interface IdeaNodeData extends Record<string, unknown> {
  idea: IdeaDTO;
  status: IdeaStatus;
  dimmed: boolean;
}
export type IdeaFlowNode = Node<IdeaNodeData, 'idea'>;

export function ideaSubtitle(idea: IdeaDTO): string | null {
  if (idea.place) {
    const street = idea.place.address?.split(',')[0];
    return [idea.place.category, street].filter(Boolean).join(' · ') || null;
  }
  const url = idea.sources.find((s) => s.url)?.url;
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function ideaPlatforms(idea: IdeaDTO): LinkPlatform[] {
  return [...new Set(idea.sources.map((s) => s.platform).filter((p): p is LinkPlatform => !!p && p !== 'web'))];
}

/** Shared by the canvas node and the mobile list. */
export function IdeaCard({
  idea,
  status,
  selected,
  dragging,
  dimmed,
}: {
  idea: IdeaDTO;
  status: IdeaStatus;
  selected?: boolean;
  dragging?: boolean;
  dimmed?: boolean;
}) {
  const kind = IDEA_KIND_STYLE[idea.kind];
  const subtitle = ideaSubtitle(idea);
  const platforms = ideaPlatforms(idea);
  const sourceCount = idea.sources.length;
  return (
    <article
      aria-label={`${kind.label}: ${idea.title}. ${IDEA_STATUS_LABEL[status]}.`}
      className={cn(
        'w-full overflow-hidden rounded-2xl border bg-paper text-left transition-[box-shadow,opacity,transform] duration-150',
        selected ? 'border-transparent shadow-lift ring-2 ring-lilac-600' : 'border-line shadow-card hover:shadow-lift',
        dragging && 'rotate-[0.8deg] opacity-85 shadow-lift',
        dimmed && !selected && 'opacity-35',
      )}
    >
      <div className={cn('relative h-[68px] overflow-hidden bg-linear-to-br', kind.band)}>
        <span className={cn('absolute top-3 left-3 inline-flex items-center gap-1 rounded-full bg-paper/90 px-2 py-0.5 text-[11px] font-semibold', kind.chip)}>
          <kind.icon className="size-3" aria-hidden />
          {kind.label}
        </span>
        {platforms.length > 0 && (
          <span className="absolute top-3 right-3 flex gap-1">
            {platforms.slice(0, 2).map((p) => (
              <span key={p} className="rounded-full bg-paper/90 px-2 py-0.5 text-[10px] font-semibold text-ink-2">
                {PLATFORM_LABEL[p]}
              </span>
            ))}
          </span>
        )}
        <kind.icon className={cn('absolute -right-1 -bottom-4 size-16', kind.mark)} aria-hidden />
      </div>
      <div className="p-3.5">
        <h3 className="line-clamp-2 text-[15px] leading-snug font-semibold text-ink">{idea.title}</h3>
        {subtitle && <p className="mt-0.5 truncate text-xs text-ink-3">{subtitle}</p>}
        {idea.note && <p className="mt-2 line-clamp-2 text-[13px] leading-snug text-ink-2">“{idea.note}”</p>}
        <div className="mt-3 flex items-center justify-between gap-2">
          <StatusBadge status={status} />
          <span className="flex items-center gap-2 text-[11px] text-ink-3">
            {idea.cost && <span className="font-medium text-ink-2">{formatMoney(idea.cost)}</span>}
            {sourceCount > 1 && <span>{sourceCount} sources</span>}
            {idea.commentCount > 0 && (
              <span className="inline-flex items-center gap-0.5" aria-label={`${idea.commentCount} ${idea.commentCount === 1 ? 'comment' : 'comments'}`}>
                <MessageCircle className="size-3" aria-hidden />
                {idea.commentCount}
              </span>
            )}
            {idea.interested.length > 0 && <AvatarStack people={idea.interested} max={3} />}
          </span>
        </div>
      </div>
    </article>
  );
}

export const IdeaCardNode = memo(function IdeaCardNode({ id, data, selected, dragging }: NodeProps<IdeaFlowNode>) {
  return (
    <div className="relative rounded-2xl" style={{ width: CARD_WIDTH }}>
      <IdeaCard idea={data.idea} status={data.status} selected={selected} dragging={dragging} dimmed={data.dimmed} />
      <ConnectHandles nodeId={id} />
    </div>
  );
});
