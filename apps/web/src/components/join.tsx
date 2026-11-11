'use client';

import { inviteTokenFromHash, PLAN_TYPE_LABEL, ROLE_LABEL, ROLE_SUMMARY, type InvitePreviewDTO } from '@orbit/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { cn, formatPlanDate, timeUntil } from '@/lib/format';
import { keys } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { PLAN_TYPE_STYLE } from './plan-visuals';
import { FullPage, Logo } from './shell';
import { useToast } from './toast';
import { AvatarStack, Banner, Button, buttonClass, Spinner } from './ui';
import { Welcome } from './welcome';

function InviteCard({ preview, className }: { preview: InvitePreviewDTO; className?: string }) {
  const { plan } = preview;
  const type = PLAN_TYPE_STYLE[plan.type];
  const meta = [PLAN_TYPE_LABEL[plan.type], formatPlanDate(plan), plan.city].filter(Boolean).join(' · ');
  const names = plan.members.map((m) => m.name);
  const more = plan.memberCount - names.length;
  return (
    <div className={cn('overflow-hidden rounded-3xl border border-line bg-paper shadow-card', className)}>
      <div className={`flex items-center gap-3 bg-linear-to-br px-5 py-4 ${type.band}`}>
        <span className={`inline-flex size-9 shrink-0 items-center justify-center rounded-xl ${type.iconCls}`}>
          <type.icon className="size-4" aria-hidden />
        </span>
        <p className="text-sm text-ink-2">
          <span className="font-semibold text-ink">{preview.invitedBy.name}</span> invited you to plan together
        </p>
      </div>
      <div className="px-5 py-4">
        <h1 className="font-display text-2xl leading-tight font-semibold">{plan.name}</h1>
        {meta && <p className="mt-1 text-[13px] text-ink-3">{meta}</p>}
        <div className="mt-3 flex items-center gap-2">
          <AvatarStack people={plan.members} max={5} />
          <span className="truncate text-xs text-ink-2">
            {names.join(', ')}
            {more > 0 && ` and ${more} more`}
          </span>
        </div>
        <div className="mt-4 rounded-2xl bg-ivory px-3.5 py-3">
          <p className="text-[13px] font-semibold text-ink">You’ll join as: {ROLE_LABEL[preview.role].toLowerCase()}</p>
          <p className="mt-0.5 text-xs text-ink-2">{ROLE_SUMMARY[preview.role]}</p>
        </div>
        {preview.expiresAt && <p className="mt-3 text-xs text-ink-3">This link expires {timeUntil(preview.expiresAt)}.</p>}
      </div>
    </div>
  );
}

function Problem({ title, message }: { title: string; message: string }) {
  return (
    <FullPage>
      <div className="flex max-w-sm flex-col items-center text-center">
        <Logo className="text-2xl" />
        <p className="mt-6 font-display text-2xl font-semibold">{title}</p>
        <p className="mt-2 text-sm text-ink-2">{message}</p>
        <Link href="/" className={buttonClass('secondary', 'md', 'mt-6')}>
          Go to Orbit
        </Link>
      </div>
    </FullPage>
  );
}

/**
 * W06 — where an invite link lands (`/join#<token>`). Shows who invited you to
 * what, and with which role; signs you in if needed (in place, so the link
 * survives); then joins on an explicit tap. Already a member: straight to the plan.
 */
export function JoinPage() {
  const { user, ready, signOut } = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  // undefined until mounted: the token lives in the fragment, which only the browser sees.
  const [token, setToken] = useState<string | null | undefined>(undefined);
  useEffect(() => setToken(inviteTokenFromHash(window.location.hash)), []);

  const preview = useQuery({
    queryKey: ['invite-preview', token, user?.id ?? null],
    queryFn: () => api.previewInvite(token!),
    enabled: ready && !!token,
    retry: false,
    staleTime: 0,
  });

  const planId = preview.data?.plan.id;
  const alreadyIn = !!preview.data?.myRole;
  useEffect(() => {
    if (alreadyIn && planId) router.replace(`/plans/${planId}`);
  }, [alreadyIn, planId, router]);

  const join = useMutation({
    mutationFn: () => api.acceptInvite(token!),
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: keys.plans });
      toast({ message: result.joined ? `You joined “${preview.data?.plan.name ?? 'the plan'}”.` : 'You’re already in this plan.' });
      router.replace(`/plans/${result.planId}`);
    },
  });

  if (!ready || token === undefined) {
    return (
      <FullPage>
        <Spinner />
      </FullPage>
    );
  }
  if (token === null) {
    return <Problem title="This invite link isn’t complete" message="Ask for the link again, and open it exactly as you got it." />;
  }
  if (preview.isPending || alreadyIn) {
    return (
      <FullPage>
        <Spinner label={alreadyIn ? 'Opening the plan…' : 'Checking the invite…'} />
      </FullPage>
    );
  }
  if (preview.isError) {
    const error = preview.error;
    const gone = error instanceof ApiError && (error.status === 404 || error.status === 410);
    return (
      <Problem
        title={gone ? 'This invite can’t be used' : 'Couldn’t check this invite'}
        message={error instanceof ApiError && error.status !== 0 ? error.message : 'Can’t reach Orbit right now. Check your connection and try again.'}
      />
    );
  }

  if (!user) return <Welcome intro={<InviteCard preview={preview.data} />} />;

  const joinError = join.error instanceof ApiError ? join.error.message : join.error ? 'Couldn’t join. Try again.' : null;
  return (
    <FullPage>
      <div className="flex w-full max-w-sm flex-col gap-5">
        <Logo className="text-2xl" />
        <InviteCard preview={preview.data} />
        {joinError && <Banner tone="error">{joinError}</Banner>}
        <Button size="lg" loading={join.isPending} icon={<ArrowRight className="size-4" />} onClick={() => join.mutate()}>
          Join as {user.name}
        </Button>
        <p className="text-center text-xs text-ink-3">
          Not {user.name}?{' '}
          <button type="button" className="font-semibold text-lilac-700 hover:underline" onClick={signOut}>
            Use another account
          </button>
        </p>
      </div>
    </FullPage>
  );
}
