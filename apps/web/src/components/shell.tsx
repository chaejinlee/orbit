'use client';

import { Bookmark, House, LogOut, Users } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/format';
import { PhoneAccessButton } from './phone';
import { Avatar, IconButton, Spinner } from './ui';
import { Welcome } from './welcome';

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('font-display font-semibold tracking-tight', className)}>
      orbit<span className="text-lilac-600">.</span>
    </span>
  );
}

function RailItem({ href, icon: Icon, label, active, soon }: { href?: string; icon: typeof House; label: string; active?: boolean; soon?: boolean }) {
  const cls = cn(
    'flex size-11 items-center justify-center rounded-xl transition-colors',
    active ? 'bg-lilac-100 text-lilac-700' : 'text-ink-2 hover:bg-ink/5',
    soon && 'cursor-not-allowed opacity-40 hover:bg-transparent',
  );
  const title = soon ? `${label} (coming soon)` : label;
  if (href && !soon) {
    return (
      <Link href={href} aria-label={label} title={title} aria-current={active ? 'page' : undefined} className={cls}>
        <Icon className="size-5" />
      </Link>
    );
  }
  return (
    <span role="img" aria-label={title} title={title} className={cls}>
      <Icon className="size-5" />
    </span>
  );
}

/** 72px global navigation (desktop). */
export function GlobalRail({ active }: { active?: 'home' }) {
  const { user, signOut } = useSession();
  return (
    <nav aria-label="Main" className="hidden w-[72px] shrink-0 flex-col items-center gap-1.5 border-r border-line bg-paper py-4 desk:flex">
      <Link href="/" aria-label="Orbit home" className="mb-5 font-display text-[28px] leading-none font-semibold">
        o<span className="text-lilac-600">.</span>
      </Link>
      <RailItem href="/" icon={House} label="Home" active={active === 'home'} />
      <RailItem icon={Bookmark} label="Saved ideas" soon />
      <RailItem icon={Users} label="Shared spaces" soon />
      <div className="mt-auto flex flex-col items-center gap-2">
        <PhoneAccessButton />
        {user && <Avatar person={user} />}
        <IconButton label="Sign out" onClick={signOut}>
          <LogOut className="size-4" />
        </IconButton>
      </div>
    </nav>
  );
}

export function MobileTopBar() {
  const { user, signOut } = useSession();
  return (
    <header className="flex h-14 items-center justify-between border-b border-line bg-paper px-4 desk:hidden">
      <Link href="/" aria-label="Orbit home">
        <Logo className="text-xl" />
      </Link>
      <div className="flex items-center gap-1">
        {user && <Avatar person={user} size="sm" />}
        <IconButton label="Sign out" onClick={signOut}>
          <LogOut className="size-4" />
        </IconButton>
      </div>
    </header>
  );
}

export function FullPage({ children }: { children: ReactNode }) {
  return <div className="flex min-h-dvh items-center justify-center p-6">{children}</div>;
}

/**
 * Pages render the sign-in screen in place when there is no session, so the
 * URL (e.g. an invitation) survives sign-in.
 */
export function RequireSession({ children }: { children: ReactNode }) {
  const { user, ready } = useSession();
  if (!ready) {
    return (
      <FullPage>
        <Spinner />
      </FullPage>
    );
  }
  if (!user) return <Welcome />;
  return <>{children}</>;
}
