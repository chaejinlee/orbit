'use client';

import {
  createIdeaInput,
  PLATFORM_LABEL,
  type CreateIdeaResultDTO,
  type DuplicateCandidateDTO,
  type IdeaPreviewDTO,
  type PreviewIdeaInput,
} from '@orbit/shared';
import { useMutation } from '@tanstack/react-query';
import { Link2, LoaderCircle, MapPin, StickyNote, Ticket } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, newRequestId } from '@/lib/api';
import { cn } from '@/lib/format';
import { Badge, Banner, Button, Dialog, Field, Input, Select, Textarea } from '../ui';

type Tab = 'LINK' | 'PLACE' | 'ACTIVITY' | 'NOTE';

const TABS: Array<{ id: Tab; label: string; icon: typeof Link2 }> = [
  { id: 'LINK', label: 'Link', icon: Link2 },
  { id: 'PLACE', label: 'Place', icon: MapPin },
  { id: 'ACTIVITY', label: 'Activity', icon: Ticket },
  { id: 'NOTE', label: 'Note', icon: StickyNote },
];

const CATEGORIES = ['Café', 'Restaurant', 'Bar', 'Dessert', 'Museum', 'Park', 'Shop', 'Viewpoint', 'Other'];

function reasonText(d: DuplicateCandidateDTO): string {
  if (d.reasons.includes('same_link')) return 'same link';
  if (d.reasons.includes('same_provider_id')) return 'same place';
  const name = d.reasons.includes('same_name') ? 'same name' : 'similar name';
  return d.distanceM != null ? `${name}, ${d.distanceM} m away` : name;
}

export interface AddIdeaDialogProps {
  open: boolean;
  planId: string;
  onClose: () => void;
  onSaved: (result: CreateIdeaResultDTO) => void;
}

/**
 * W02 — save a link, place, activity or note. Links are cleaned and read for
 * place details without fetching the page; possible duplicates are offered as
 * "add to the existing idea" (pre-selected only when confidence is high).
 */
export function AddIdeaDialog({ open, planId, onClose, onSaved }: AddIdeaDialogProps) {
  const [tab, setTab] = useState<Tab>('LINK');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [placeName, setPlaceName] = useState('');
  const [address, setAddress] = useState('');
  const [category, setCategory] = useState('');
  const [saveAsPlace, setSaveAsPlace] = useState(true);
  const [preview, setPreview] = useState<IdeaPreviewDTO | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [mergeInto, setMergeInto] = useState<string | null>(null);
  const [requestId, setRequestId] = useState(newRequestId);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTab('LINK');
    setUrl('');
    setTitle('');
    setNote('');
    setPlaceName('');
    setAddress('');
    setCategory('');
    setSaveAsPlace(true);
    setPreview(null);
    setPreviewError(null);
    setMergeInto(null);
    setError(null);
    setRequestId(newRequestId());
  }, [open]);

  // Debounced, side-effect-free preview: cleaned link + duplicate candidates.
  useEffect(() => {
    if (!open) return;
    let input: PreviewIdeaInput | null = null;
    if (tab === 'LINK' && url.trim()) input = { kind: 'LINK', url: url.trim() };
    if (tab === 'PLACE' && placeName.trim().length >= 2) input = { kind: 'PLACE', place: { name: placeName.trim() } };
    if (!input) {
      setPreview(null);
      setPreviewError(null);
      setMergeInto(null);
      return;
    }
    let cancelled = false;
    setPreviewing(true);
    const timer = setTimeout(async () => {
      try {
        const result = await api.previewIdea(planId, input);
        if (cancelled) return;
        setPreview(result);
        setPreviewError(null);
        setMergeInto(result.duplicates.find((d) => d.confidence === 'high')?.ideaId ?? null);
      } catch (e) {
        if (cancelled) return;
        setPreview(null);
        setPreviewError(e instanceof ApiError ? e.message : 'Couldn’t check that.');
      } finally {
        if (!cancelled) setPreviewing(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, tab, url, placeName, planId]);

  const save = useMutation({
    mutationFn: (input: unknown) => api.createIdea(planId, createIdeaInput.parse(input)),
    onSuccess: (result) => onSaved(result),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Couldn’t save. Your input is still here — try again.'),
  });

  const parsedPlace = tab === 'LINK' ? preview?.parsedPlace : null;
  const duplicates = tab === 'LINK' || tab === 'PLACE' ? (preview?.duplicates ?? []) : [];

  const buildInput = () => {
    const common = { clientRequestId: requestId, note: note.trim() || undefined, mergeIntoIdeaId: mergeInto ?? undefined };
    switch (tab) {
      case 'LINK':
        return parsedPlace?.name && saveAsPlace
          ? { ...common, kind: 'PLACE', place: { name: parsedPlace.name, lat: parsedPlace.lat, lng: parsedPlace.lng }, sourceUrl: url.trim() }
          : { ...common, kind: 'LINK', url: url.trim(), title: title.trim() || undefined };
      case 'PLACE':
        return {
          ...common,
          kind: 'PLACE',
          place: { name: placeName.trim(), address: address.trim() || undefined, category: category || undefined },
        };
      case 'ACTIVITY':
        return {
          clientRequestId: requestId,
          note: note.trim() || undefined,
          kind: 'ACTIVITY',
          title: title.trim(),
          place: placeName.trim() ? { name: placeName.trim(), address: address.trim() || undefined } : undefined,
        };
      case 'NOTE':
        return { clientRequestId: requestId, note: note.trim() || undefined, kind: 'NOTE', title: title.trim() };
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const input = buildInput();
    const parsed = createIdeaInput.safeParse(input);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the fields above.');
      return;
    }
    setError(null);
    save.mutate(input);
  };

  const canSubmit =
    !save.isPending &&
    ((tab === 'LINK' && url.trim() && !previewError) ||
      (tab === 'PLACE' && placeName.trim()) ||
      ((tab === 'ACTIVITY' || tab === 'NOTE') && title.trim()));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add an idea"
      description="Paste a link, or save a place, activity or note."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="add-idea-form" loading={save.isPending} disabled={!canSubmit}>
            {mergeInto ? 'Add to existing idea' : 'Save to board'}
          </Button>
        </>
      }
    >
      <form id="add-idea-form" onSubmit={submit} className="flex flex-col gap-4">
        <div role="tablist" aria-label="Idea type" className="grid grid-cols-4 gap-1 rounded-2xl bg-ivory p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => {
                setTab(t.id);
                setPreview(null);
                setMergeInto(null);
                setError(null);
              }}
              className={cn(
                'flex items-center justify-center gap-1.5 rounded-xl py-2 text-[13px] font-semibold transition-colors',
                tab === t.id ? 'bg-paper text-ink shadow-card' : 'text-ink-3 hover:text-ink',
              )}
            >
              <t.icon className="size-3.5" aria-hidden />
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'LINK' && (
          <>
            <Field label="Link" hint="Instagram, TikTok, Google Maps, a blog — anything." error={previewError}>
              {({ id, describedBy, invalid }) => (
                <div className="relative">
                  <Input
                    id={id}
                    autoFocus
                    inputMode="url"
                    placeholder="https://"
                    value={url}
                    aria-describedby={describedBy}
                    aria-invalid={invalid}
                    onChange={(e) => setUrl(e.target.value)}
                  />
                  {previewing && <LoaderCircle className="absolute top-3 right-3 size-4 animate-spin text-ink-3" aria-label="Checking link" />}
                </div>
              )}
            </Field>
            {preview?.link && (
              <div className="rounded-2xl border border-line bg-ivory px-3.5 py-3 text-sm">
                <div className="flex items-center gap-2">
                  <Badge tone="sky">{PLATFORM_LABEL[preview.link.platform]}</Badge>
                  <span className="truncate text-ink-2">{preview.link.url}</span>
                </div>
                {parsedPlace?.name ? (
                  <label className="mt-3 flex items-start gap-2">
                    <input type="checkbox" checked={saveAsPlace} onChange={(e) => setSaveAsPlace(e.target.checked)} className="mt-0.5 size-4 accent-ink" />
                    <span>
                      Save as the place <span className="font-semibold">“{parsedPlace.name}”</span>
                      <span className="block text-xs text-ink-3">Read from the link itself — check it’s the right spot.</span>
                    </span>
                  </label>
                ) : (
                  <p className="mt-2 text-xs text-ink-3">Saved as a link card. You can connect it to a place later.</p>
                )}
              </div>
            )}
            {!(parsedPlace?.name && saveAsPlace) && (
              <Field label="Title" optional>
                {({ id }) => <Input id={id} placeholder="We’ll suggest one from the link" value={title} onChange={(e) => setTitle(e.target.value)} />}
              </Field>
            )}
          </>
        )}

        {(tab === 'PLACE' || tab === 'ACTIVITY') && (
          <>
            {tab === 'ACTIVITY' && (
              <Field label="What is it?">
                {({ id }) => <Input id={id} autoFocus placeholder="Jazz night, pottery class, exhibition…" value={title} onChange={(e) => setTitle(e.target.value)} />}
              </Field>
            )}
            <Field label={tab === 'PLACE' ? 'Place name' : 'Where'} optional={tab === 'ACTIVITY'}>
              {({ id }) => (
                <Input id={id} autoFocus={tab === 'PLACE'} placeholder="Name of the place" value={placeName} onChange={(e) => setPlaceName(e.target.value)} />
              )}
            </Field>
            <div className={cn('grid gap-3', tab === 'PLACE' && 'sm:grid-cols-[1fr_160px]')}>
              <Field label="Address or area" optional>
                {({ id }) => <Input id={id} placeholder="Street, neighborhood" value={address} onChange={(e) => setAddress(e.target.value)} />}
              </Field>
              {tab === 'PLACE' && (
                <Field label="Type" optional>
                  {({ id }) => (
                    <Select id={id} value={category} onChange={(e) => setCategory(e.target.value)}>
                      <option value="">—</option>
                      {CATEGORIES.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </Select>
                  )}
                </Field>
              )}
            </div>
          </>
        )}

        {tab === 'NOTE' && (
          <Field label="Idea">
            {({ id }) => <Input id={id} autoFocus placeholder="Picnic somewhere by the lake" value={title} onChange={(e) => setTitle(e.target.value)} />}
          </Field>
        )}

        {duplicates.length > 0 && (
          <fieldset className="rounded-2xl border border-butter bg-butter-50 px-3.5 pt-1 pb-3">
            <legend className="px-1 text-[13px] font-semibold text-butter-800">Looks like you may have saved this already</legend>
            <div className="mt-1 flex flex-col gap-2 text-sm">
              {duplicates.map((d) => (
                <label key={d.ideaId} className="flex items-start gap-2">
                  <input type="radio" name="merge" checked={mergeInto === d.ideaId} onChange={() => setMergeInto(d.ideaId)} className="mt-0.5 size-4 accent-ink" />
                  <span>
                    Add to <span className="font-semibold">“{d.title}”</span>
                    <span className="block text-xs text-butter-800">{reasonText(d)}</span>
                  </span>
                </label>
              ))}
              <label className="flex items-start gap-2">
                <input type="radio" name="merge" checked={mergeInto === null} onChange={() => setMergeInto(null)} className="mt-0.5 size-4 accent-ink" />
                <span>Keep it as a separate idea</span>
              </label>
            </div>
          </fieldset>
        )}

        <Field label="Why save it?" optional>
          {({ id }) => <Textarea id={id} rows={2} placeholder="분위기 좋아 보여. 여기 가고 싶어!" value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>

        {error && <Banner tone="error">{error}</Banner>}
      </form>
    </Dialog>
  );
}
