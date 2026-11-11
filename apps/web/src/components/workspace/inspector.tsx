'use client';

import {
  formatDuration,
  formatMoney,
  mapsSearchUrl,
  PLATFORM_LABEL,
  toMajor,
  toMinor,
  type AiStatusDTO,
  type IdeaDTO,
  type IdeaStatus,
  type Money,
} from '@orbit/shared';
import { Archive, Check, ExternalLink, EyeOff, Heart, MapPin, Plus, Star, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { cn, CURRENCIES, timeAgo } from '@/lib/format';
import { IDEA_KIND_STYLE } from '../plan-visuals';
import { AvatarStack, Badge, Button, IconButton, Input, Select, StatusBadge, Textarea } from '../ui';
import { AskOrbit } from './ask-orbit';
import { Comments } from './comments';

const DURATIONS = [30, 45, 60, 90, 120, 180, 240];

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="border-t border-line px-5 py-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold tracking-wide text-ink-3 uppercase">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Text that saves when you leave the field (or press Enter on single-line). */
function useDraftText(value: string, onCommit: (next: string) => void) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return {
    value: text,
    onChange: (e: { target: { value: string } }) => setText(e.target.value),
    onBlur: () => {
      if (text.trim() !== value.trim()) onCommit(text.trim());
    },
  };
}

export interface InspectorProps {
  planId: string;
  idea: IdeaDTO;
  status: IdeaStatus;
  canEdit: boolean;
  defaultCurrency: string;
  inDraftCount: number;
  meId: string;
  ai: AiStatusDTO | undefined;
  canAsk: boolean;
  canComment: boolean;
  isOwner: boolean;
  onClose: () => void;
  onUpdate: (patch: { title?: string; note?: string | null; shortlisted?: boolean; durationMin?: number | null; cost?: Money | null }) => void;
  onToggleInterest: () => void;
  onAddToItinerary: () => void;
  onRemoveFromBoard: () => void;
  onArchive: () => void;
}

/**
 * W03 — details and actions for one idea. "Remove from board", "Archive" and
 * removing a stop from the itinerary are separate actions on purpose: none of
 * them silently deletes the others.
 */
export function Inspector({
  planId,
  idea,
  status,
  canEdit,
  defaultCurrency,
  inDraftCount,
  meId,
  ai,
  canAsk,
  canComment,
  isOwner,
  onClose,
  onUpdate,
  onToggleInterest,
  onAddToItinerary,
  onRemoveFromBoard,
  onArchive,
}: InspectorProps) {
  const kind = IDEA_KIND_STYLE[idea.kind];
  const title = useDraftText(idea.title, (t) => t && onUpdate({ title: t }));
  const note = useDraftText(idea.note ?? '', (n) => onUpdate({ note: n || null }));
  const costCurrency = idea.cost?.currency ?? defaultCurrency;
  const [costText, setCostText] = useState(idea.cost ? String(toMajor(idea.cost.amountMinor, idea.cost.currency)) : '');
  useEffect(() => setCostText(idea.cost ? String(toMajor(idea.cost.amountMinor, idea.cost.currency)) : ''), [idea.cost]);
  const interested = idea.myReaction === 'INTERESTED';

  const commitCost = (text: string, currency: string) => {
    const amount = text.trim() === '' ? null : Number(text);
    if (amount != null && (!Number.isFinite(amount) || amount < 0)) return;
    const next = amount == null ? null : { amountMinor: toMinor(amount, currency), currency };
    if (JSON.stringify(next) !== JSON.stringify(idea.cost)) onUpdate({ cost: next });
  };

  return (
    <aside aria-label="Idea details" className="flex h-full w-full flex-col overflow-y-auto bg-paper">
      <div className={cn('relative shrink-0 bg-linear-to-br px-5 pt-4 pb-5', kind.band)}>
        <div className="flex items-center justify-between">
          <Badge className={cn('bg-paper/90', kind.chip)}>
            <kind.icon className="size-3" aria-hidden />
            {kind.label}
          </Badge>
          <IconButton label="Close details" onClick={onClose} className="-mr-2 hover:bg-paper/60">
            <X className="size-4" />
          </IconButton>
        </div>
        {canEdit ? (
          <Textarea
            aria-label="Title"
            rows={2}
            {...title}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                (e.target as HTMLTextAreaElement).blur();
              }
            }}
            className="mt-3 min-h-0 resize-none border-transparent bg-transparent px-0 py-0 font-display text-2xl leading-tight font-semibold hover:border-transparent focus:bg-paper/70 focus:px-2"
          />
        ) : (
          <h2 className="mt-3 font-display text-2xl leading-tight font-semibold">{idea.title}</h2>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <StatusBadge status={status} />
          {canEdit && (
            <button
              type="button"
              aria-pressed={idea.shortlisted}
              onClick={() => onUpdate({ shortlisted: !idea.shortlisted })}
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors',
                idea.shortlisted ? 'bg-lilac-600 text-white' : 'bg-paper/80 text-ink-2 hover:bg-paper',
              )}
            >
              <Star className={cn('size-3', idea.shortlisted && 'fill-current')} aria-hidden />
              {idea.shortlisted ? 'Shortlisted' : 'Shortlist'}
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2 px-5 py-4">
        {canEdit && (
          <Button onClick={onAddToItinerary} icon={inDraftCount > 0 ? <Check className="size-4" /> : <Plus className="size-4" />}>
            {inDraftCount > 0 ? 'In itinerary · add again' : 'Add to itinerary'}
          </Button>
        )}
        <Button
          variant={interested ? 'secondary' : 'ghost'}
          onClick={onToggleInterest}
          aria-pressed={interested}
          icon={<Heart className={cn('size-4', interested && 'fill-rose text-rose-700')} />}
          className="justify-start"
        >
          {interested ? 'You’re interested' : 'I’m interested'}
        </Button>
      </div>

      {idea.place && (
        <Section title="Place">
          <p className="flex items-start gap-2 text-sm">
            <MapPin className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
            <span>
              <span className="font-medium">{idea.place.name ?? idea.title}</span>
              {idea.place.address && <span className="block text-ink-2">{idea.place.address}</span>}
              {idea.place.category && <span className="block text-ink-3">{idea.place.category}</span>}
            </span>
          </p>
          <div className="mt-3 flex items-center justify-between">
            <Badge tone={idea.place.verification === 'VERIFIED' ? 'sage' : 'butter'}>
              {idea.place.verification === 'VERIFIED' ? 'Verified' : 'Not verified · entered by hand'}
            </Badge>
            <a
              href={mapsSearchUrl({ name: idea.place.name ?? idea.title, lat: idea.place.lat, lng: idea.place.lng })}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[13px] font-semibold text-lilac-700 hover:underline"
            >
              Open in Maps <ExternalLink className="size-3.5" aria-hidden />
            </a>
          </div>
        </Section>
      )}

      <Section title="Ask Orbit" aside={<Badge tone="lilac">AI</Badge>}>
        <AskOrbit planId={planId} idea={idea} ai={ai} canAsk={canAsk} isOwner={isOwner} meId={meId} />
      </Section>

      <Section title="Why we saved it">
        {canEdit ? (
          <Textarea aria-label="Note" placeholder="What makes this worth it?" {...note} />
        ) : (
          <p className="text-sm text-ink-2">{idea.note || 'No note yet.'}</p>
        )}
      </Section>

      <Section title={idea.commentCount > 0 ? `Comments · ${idea.commentCount}` : 'Comments'}>
        <Comments key={idea.id} planId={planId} ideaId={idea.id} canComment={canComment} />
      </Section>

      <Section title="Estimates" aside={<span className="text-[11px] text-ink-3">your guess, not verified</span>}>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
            Time there
            <Select
              disabled={!canEdit}
              value={idea.durationMin ?? ''}
              onChange={(e) => onUpdate({ durationMin: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">Not set</option>
              {[...new Set([...DURATIONS, ...(idea.durationMin ? [idea.durationMin] : [])])]
                .sort((a, b) => a - b)
                .map((d) => (
                  <option key={d} value={d}>
                    {formatDuration(d)}
                  </option>
                ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
            Cost for the group
            <div className="flex gap-1">
              <Input
                disabled={!canEdit}
                inputMode="decimal"
                placeholder="—"
                value={costText}
                onChange={(e) => setCostText(e.target.value)}
                onBlur={() => commitCost(costText, costCurrency)}
                className="min-w-0"
              />
              <Select
                aria-label="Currency"
                disabled={!canEdit}
                value={costCurrency}
                onChange={(e) => commitCost(costText, e.target.value)}
                className="w-[76px] shrink-0 px-2 pr-6"
              >
                {[...new Set([costCurrency, ...CURRENCIES])].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </div>
          </label>
        </div>
        {idea.cost && <p className="mt-2 text-xs text-ink-3">≈ {formatMoney(idea.cost)} total</p>}
      </Section>

      <Section title={`Sources · ${idea.sources.length}`}>
        {idea.sources.length === 0 ? (
          <p className="text-sm text-ink-3">Added directly.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {idea.sources.map((s) => (
              <li key={s.id} className="rounded-xl border border-line px-3 py-2 text-sm">
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between gap-2 font-medium hover:text-lilac-700">
                    <span className="truncate">
                      {s.platform ? PLATFORM_LABEL[s.platform] : 'Link'} · {new URL(s.url).hostname.replace(/^www\./, '')}
                    </span>
                    <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                  </a>
                ) : (
                  <p className="text-ink-2">{s.note}</p>
                )}
                {s.url && s.note && <p className="mt-1 text-ink-2">{s.note}</p>}
                <p className="mt-1 text-[11px] text-ink-3">
                  {s.addedBy.id === meId ? 'You' : s.addedBy.name} · {timeAgo(s.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Interested">
        {idea.interested.length === 0 ? (
          <p className="text-sm text-ink-3">No one yet.</p>
        ) : (
          <div className="flex items-center gap-2">
            <AvatarStack people={idea.interested} max={6} size="md" />
            <span className="text-sm text-ink-2">{idea.interested.map((p) => (p.id === meId ? 'You' : p.name)).join(', ')}</span>
          </div>
        )}
      </Section>

      {canEdit && (
        <Section title="Manage">
          <div className="flex flex-col gap-1">
            <Button variant="ghost" size="sm" className="justify-start" icon={<EyeOff className="size-4" />} onClick={onRemoveFromBoard}>
              Remove from board (keeps the idea)
            </Button>
            <Button variant="ghost" size="sm" className="justify-start text-rose-700 hover:bg-rose-50" icon={<Archive className="size-4" />} onClick={onArchive}>
              Archive idea
            </Button>
          </div>
        </Section>
      )}

      <p className="mt-auto px-5 py-4 text-xs text-ink-3">
        Added by {idea.createdBy.id === meId ? 'you' : idea.createdBy.name} · {timeAgo(idea.createdAt)}
      </p>
    </aside>
  );
}
