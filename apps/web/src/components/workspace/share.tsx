'use client';

import {
  can,
  INVITE_EXPIRY,
  INVITE_EXPIRY_LABEL,
  INVITE_ROLES,
  inviteUrl,
  MAX_ACTIVE_INVITES,
  ROLE_LABEL,
  ROLE_SUMMARY,
  type InviteDTO,
  type InviteExpiry,
  type InviteRole,
  type MemberDTO,
  type PlanDTO,
} from '@orbit/shared';
import { useQuery } from '@tanstack/react-query';
import { Check, Copy, Link2, LogOut, QrCode as QrIcon, Share, UserMinus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { canShareSheet, copyText } from '@/lib/clipboard';
import { cn, timeUntil } from '@/lib/format';
import { useInviteMutations, useInvites, useMemberMutations } from '@/lib/queries';
import { QrCode, useOnThisComputer } from '../phone';
import { Avatar, Badge, Banner, Button, Dialog, IconButton, Select, Skeleton } from '../ui';

// Feedback here is inline, not toasts: an open <dialog> sits in the browser's
// top layer, above the toast area.
const errorText = (error: unknown, fallback: string) => (error instanceof ApiError ? error.message : fallback);

// Links made on this device, so whoever made one can copy it again here. The
// server can't help: it keeps only a hash of each token.
const TOKENS_KEY = 'orbit.invite-tokens.v1';

function readTokens(): Record<string, string> {
  try {
    const value = JSON.parse(localStorage.getItem(TOKENS_KEY) ?? '{}') as unknown;
    return value && typeof value === 'object' ? (value as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeTokens(tokens: Record<string, string>): void {
  try {
    localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));
  } catch {
    // Private mode etc.: the link just can't be copied again later.
  }
}

type LinkScope =
  | { kind: 'loading' }
  /** Development, phone mode off: a link opens only on this computer. */
  | { kind: 'this-computer'; origin: string }
  /** Development over Wi-Fi: friends need the same network and the sign-in code. */
  | { kind: 'wifi'; origin: string; code: string | null; onThisComputer: boolean }
  | { kind: 'web'; origin: string };

/** Where invite links should point so the person receiving one can open it. */
function useLinkScope(open: boolean): LinkScope {
  const onThisComputer = useOnThisComputer();
  const phone = useQuery({ queryKey: ['phone-access'], queryFn: api.phoneAccess, enabled: open && onThisComputer === true, staleTime: 0 });
  if (onThisComputer === null) return { kind: 'loading' };
  const origin = window.location.origin;
  if (process.env.NODE_ENV !== 'development') return { kind: 'web', origin };
  if (!onThisComputer) return { kind: 'wifi', origin, code: null, onThisComputer: false };
  if (phone.isPending) return { kind: 'loading' };
  const url = phone.data?.enabled ? phone.data.urls[0] : undefined;
  if (phone.data?.enabled && url) return { kind: 'wifi', origin: url, code: phone.data.code, onThisComputer: true };
  return { kind: 'this-computer', origin };
}

function usesLabel(invite: InviteDTO): string {
  if (invite.maxUses === 1) return invite.useCount > 0 ? 'used' : 'for one person';
  if (invite.maxUses != null) return `${invite.useCount} of ${invite.maxUses} joined`;
  return invite.useCount === 0 ? 'nobody yet' : `${invite.useCount} joined`;
}

function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (state !== 'copied') return;
    const t = setTimeout(() => setState('idle'), 2000);
    return () => clearTimeout(t);
  }, [state]);
  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        icon={state === 'copied' ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        onClick={async () => setState((await copyText(text)) ? 'copied' : 'failed')}
      >
        {state === 'copied' ? 'Copied' : 'Copy'}
      </Button>
      {state === 'failed' && <span className="self-center text-xs text-rose-700">Couldn’t copy. Press and hold the link instead.</span>}
    </>
  );
}

function LinkBox({ url, planName, highlight }: { url: string; planName: string; highlight?: boolean }) {
  const [showQr, setShowQr] = useState(false);
  return (
    <div className={cn('rounded-2xl border p-3', highlight ? 'border-lilac-600/40 bg-lilac-50' : 'border-line bg-ivory')}>
      <p className="font-mono text-[12px] leading-relaxed break-all text-ink select-all">{url}</p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <CopyButton text={url} />
        <Button size="sm" variant="secondary" icon={<QrIcon className="size-3.5" />} aria-expanded={showQr} onClick={() => setShowQr((v) => !v)}>
          {showQr ? 'Hide QR' : 'QR code'}
        </Button>
        {canShareSheet() && (
          <Button
            size="sm"
            variant="secondary"
            icon={<Share className="size-3.5" />}
            onClick={() => void navigator.share({ title: planName, text: `Join “${planName}” on Orbit`, url }).catch(() => {})}
          >
            Share…
          </Button>
        )}
      </div>
      {showQr && (
        <div className="mt-3 flex justify-center">
          <QrCode text={url} label={`QR code for the invite link to ${planName}`} className="size-48" />
        </div>
      )}
    </div>
  );
}

function ScopeNote({ scope }: { scope: LinkScope }) {
  if (scope.kind === 'this-computer') {
    return (
      <Banner tone="warning">
        Right now these links open only on this computer. To invite someone on your Wi-Fi, restart Orbit with{' '}
        <code className="rounded bg-ink/5 px-1 text-[12px]">npm run dev:phone</code>.
      </Banner>
    );
  }
  if (scope.kind === 'wifi') {
    const code = scope.code ? `${scope.code.slice(0, 3)} ${scope.code.slice(3)}` : null;
    return (
      <p className="text-xs leading-relaxed text-ink-3">
        Development mode: the other person needs to be on the same Wi-Fi as the computer running Orbit
        {code ? (
          <>
            , and to enter the sign-in code <span className="font-semibold text-ink-2 tabular-nums">{code}</span> once.
          </>
        ) : (
          ', and the sign-in code shown on that computer.'
        )}
      </p>
    );
  }
  return null;
}

function InviteSection({ plan, open, scope }: { plan: PlanDTO; open: boolean; scope: LinkScope }) {
  const invites = useInvites(plan.id, open);
  const mutations = useInviteMutations(plan.id);
  const [role, setRole] = useState<InviteRole>('EDITOR');
  const [expiresIn, setExpiresIn] = useState<InviteExpiry>('WEEK');
  const [onePerson, setOnePerson] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [tokens, setTokens] = useState<Record<string, string>>({});

  useEffect(() => setTokens(readTokens()), []);
  // Forget tokens of links that stopped working.
  useEffect(() => {
    if (!invites.data) return;
    const active = new Set(invites.data.map((i) => i.id));
    const stored = readTokens();
    const kept = Object.fromEntries(Object.entries(stored).filter(([id]) => active.has(id)));
    if (Object.keys(kept).length !== Object.keys(stored).length) writeTokens(kept);
  }, [invites.data]);

  const origin = scope.kind === 'loading' ? null : scope.origin;
  const urlFor = (inviteId: string) => (origin && tokens[inviteId] ? inviteUrl(origin, tokens[inviteId]) : null);
  const created = createdId ? invites.data?.find((i) => i.id === createdId) : undefined;
  const createdUrl = createdId ? urlFor(createdId) : null;
  const others = (invites.data ?? []).filter((i) => i.id !== createdId);
  const atLimit = (invites.data?.length ?? 0) >= MAX_ACTIVE_INVITES;

  const create = () =>
    mutations.create.mutate(
      { role, expiresIn, maxUses: onePerson ? 1 : null },
      {
        onSuccess: ({ invite, token }) => {
          const next = { ...readTokens(), [invite.id]: token };
          writeTokens(next);
          setTokens(next);
          setCreatedId(invite.id);
        },
      },
    );

  return (
    <section aria-labelledby="invite-heading" className="flex flex-col gap-3">
      <h3 id="invite-heading" className="text-xs font-semibold tracking-wide text-ink-3 uppercase">
        Invite with a link
      </h3>
      <div role="radiogroup" aria-label="What invited people can do" className="grid grid-cols-2 gap-1 rounded-xl bg-ink/5 p-1">
        {INVITE_ROLES.map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={role === r}
            onClick={() => setRole(r)}
            className={cn('rounded-lg py-2 text-sm font-semibold transition-colors', role === r ? 'bg-paper text-ink shadow-card' : 'text-ink-2')}
          >
            {ROLE_LABEL[r]}
          </button>
        ))}
      </div>
      <p className="-mt-1 text-xs text-ink-3">{ROLE_SUMMARY[role]}</p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-2 text-[13px] font-medium text-ink-2">
          Expires after
          <Select value={expiresIn} onChange={(e) => setExpiresIn(e.target.value as InviteExpiry)} className="h-9 w-[104px]">
            {INVITE_EXPIRY.map((e) => (
              <option key={e} value={e}>
                {INVITE_EXPIRY_LABEL[e]}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex items-center gap-2 text-[13px] font-medium text-ink-2">
          <input type="checkbox" checked={onePerson} onChange={(e) => setOnePerson(e.target.checked)} className="size-4 accent-lilac-600" />
          Only one person can use it
        </label>
      </div>
      <Button
        onClick={create}
        loading={mutations.create.isPending}
        disabled={atLimit || scope.kind === 'loading'}
        icon={<Link2 className="size-4" />}
        title={atLimit ? `Turn off a link first (at most ${MAX_ACTIVE_INVITES}).` : undefined}
      >
        Create invite link
      </Button>
      {mutations.create.error && <Banner tone="error">{errorText(mutations.create.error, 'Couldn’t create the link. Try again.')}</Banner>}

      {created && createdUrl && (
        <div className="flex flex-col gap-1.5">
          <p className="text-[13px] font-semibold text-ink">
            Link ready · {ROLE_LABEL[created.role].toLowerCase()} · expires {created.expiresAt ? timeUntil(created.expiresAt) : 'never'}
          </p>
          <LinkBox url={createdUrl} planName={plan.name} highlight />
        </div>
      )}
      <ScopeNote scope={scope} />

      {mutations.revoke.error && <Banner tone="error">{errorText(mutations.revoke.error, 'Couldn’t turn off the link. Try again.')}</Banner>}
      {invites.isPending ? (
        <Skeleton className="h-14 w-full" />
      ) : others.length > 0 ? (
        <div className="mt-1">
          <p className="text-xs font-semibold tracking-wide text-ink-3 uppercase">Active links · {others.length}</p>
          <ul className="mt-2 flex flex-col gap-2">
            {others.map((invite) => (
              <ActiveLink
                key={invite.id}
                invite={invite}
                url={urlFor(invite.id)}
                planName={plan.name}
                revoking={mutations.revoke.isPending && mutations.revoke.variables === invite.id}
                onRevoke={() => mutations.revoke.mutate(invite.id)}
              />
            ))}
          </ul>
        </div>
      ) : null}
      {created && (
        <Button
          variant="ghost"
          size="sm"
          className="self-start text-rose-700 hover:bg-rose-50"
          loading={mutations.revoke.isPending && mutations.revoke.variables === created.id}
          onClick={() => mutations.revoke.mutate(created.id, { onSuccess: () => setCreatedId(null) })}
        >
          Turn off the new link
        </Button>
      )}
    </section>
  );
}

function ActiveLink({
  invite,
  url,
  planName,
  revoking,
  onRevoke,
}: {
  invite: InviteDTO;
  url: string | null;
  planName: string;
  revoking: boolean;
  onRevoke: () => void;
}) {
  const [showLink, setShowLink] = useState(false);
  return (
    <li className="rounded-xl border border-line px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 text-[13px]">
          <p className="font-semibold text-ink">{ROLE_LABEL[invite.role]}</p>
          <p className="text-xs text-ink-3">
            Expires {invite.expiresAt ? timeUntil(invite.expiresAt) : 'never'} · {usesLabel(invite)} · by {invite.createdBy.name}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {url && (
            <Button size="sm" variant="ghost" aria-expanded={showLink} onClick={() => setShowLink((v) => !v)}>
              {showLink ? 'Hide' : 'Show link'}
            </Button>
          )}
          {invite.canRevoke && (
            <Button size="sm" variant="ghost" className="text-rose-700 hover:bg-rose-50" loading={revoking} onClick={onRevoke}>
              Turn off
            </Button>
          )}
        </div>
      </div>
      {showLink && url && (
        <div className="mt-2">
          <LinkBox url={url} planName={planName} />
        </div>
      )}
    </li>
  );
}

function PeopleSection({ plan, meId, onLeft }: { plan: PlanDTO; meId: string; onLeft: () => void }) {
  const mutations = useMemberMutations(plan.id);
  const [confirming, setConfirming] = useState<string | null>(null);
  const isOwner = can(plan.myRole, 'member.manage');
  const failed = mutations.changeRole.error ?? mutations.remove.error ?? mutations.leave.error;

  return (
    <section aria-labelledby="people-heading" className="flex flex-col gap-2">
      <h3 id="people-heading" className="text-xs font-semibold tracking-wide text-ink-3 uppercase">
        People · {plan.members.length}
      </h3>
      {failed && <Banner tone="error">{errorText(failed, 'Something went wrong. Try again.')}</Banner>}
      <ul className="flex flex-col">
        {plan.members.map((m: MemberDTO) => {
          const me = m.id === meId;
          const manageable = isOwner && !me && m.role !== 'OWNER';
          return (
            <li key={m.id} className="flex flex-col border-b border-line py-2.5 last:border-b-0">
              <div className="flex items-center gap-3">
                <Avatar person={m} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {m.name}
                    {me && <span className="font-normal text-ink-3"> (you)</span>}
                  </p>
                  {!manageable && m.role !== 'OWNER' && <p className="text-xs text-ink-3">{ROLE_LABEL[m.role]}</p>}
                </div>
                {manageable && (
                  <>
                    <Select
                      aria-label={`What ${m.name} can do`}
                      value={m.role}
                      disabled={mutations.changeRole.isPending}
                      onChange={(e) => mutations.changeRole.mutate({ userId: m.id, role: e.target.value as InviteRole })}
                      className="h-9 w-[112px]"
                    >
                      {INVITE_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </Select>
                    <IconButton label={`Remove ${m.name}`} onClick={() => setConfirming(m.id)}>
                      <UserMinus className="size-4" />
                    </IconButton>
                  </>
                )}
                {m.role === 'OWNER' && <Badge tone="lilac">Owner</Badge>}
              </div>
              {confirming === m.id && (
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-rose-50 px-3 py-2 text-[13px] text-rose-700">
                  <span className="flex-1">Remove {m.name}? They lose access, and links they made stop working.</span>
                  <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    loading={mutations.remove.isPending}
                    onClick={() => mutations.remove.mutate(m.id, { onSuccess: () => setConfirming(null) })}
                  >
                    Remove
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {plan.myRole !== 'OWNER' &&
        (confirming === 'leave' ? (
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-rose-50 px-3 py-2 text-[13px] text-rose-700">
            <span className="flex-1">Leave this plan? You’ll need a new invite to come back.</span>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button size="sm" variant="danger" loading={mutations.leave.isPending} onClick={() => mutations.leave.mutate(undefined, { onSuccess: onLeft })}>
              Leave
            </Button>
          </div>
        ) : (
          <Button variant="ghost" size="sm" className="self-start text-rose-700 hover:bg-rose-50" icon={<LogOut className="size-4" />} onClick={() => setConfirming('leave')}>
            Leave plan
          </Button>
        ))}
    </section>
  );
}

/** W06 — invite people with a link, and see (or, as the owner, manage) who's in the plan. */
export function ShareDialog({ open, onClose, plan, meId, onLeft }: { open: boolean; onClose: () => void; plan: PlanDTO; meId: string; onLeft: () => void }) {
  const scope = useLinkScope(open);
  const canInvite = can(plan.myRole, 'invite.create');
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Share “${plan.name}”`}
      description="Everyone in a plan sees all of it: ideas, comments and the itinerary."
      initialFocus="none"
    >
      <div className="flex flex-col gap-6">
        {canInvite ? (
          <InviteSection plan={plan} open={open} scope={scope} />
        ) : (
          <Banner>As a viewer you can’t invite people. Ask the owner or an editor for a link.</Banner>
        )}
        <PeopleSection plan={plan} meId={meId} onLeft={onLeft} />
      </div>
    </Dialog>
  );
}
