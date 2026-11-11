'use client';

import { PLAN_TYPES, type PlanDTO } from '@orbit/shared';
import { Orbit, Plus } from 'lucide-react';
import Link from 'next/link';
import { formatPlanDate, greeting } from '@/lib/format';
import { usePlans } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { PLAN_STATUS_STYLE, PLAN_TYPE_STYLE } from './plan-visuals';
import { GlobalRail, MobileTopBar } from './shell';
import { AvatarStack, Badge, Banner, Button, buttonClass, Skeleton } from './ui';

function PlanCard({ plan }: { plan: PlanDTO }) {
  const type = PLAN_TYPE_STYLE[plan.type];
  const status = PLAN_STATUS_STYLE[plan.status];
  const meta = [formatPlanDate(plan), plan.city].filter(Boolean).join(' · ');
  const href = `/plans/${plan.id}${plan.lastView ? `?view=${plan.lastView}` : ''}`;
  return (
    <Link
      href={href}
      className="group flex flex-col overflow-hidden rounded-3xl border border-line bg-paper shadow-card transition-shadow hover:shadow-lift"
    >
      <div className={`relative h-28 bg-linear-to-br ${type.band}`}>
        <span className={`absolute top-4 left-4 inline-flex size-9 items-center justify-center rounded-xl ${type.iconCls}`}>
          <type.icon className="size-4" aria-hidden />
        </span>
        <span className="absolute -right-6 -bottom-10 size-32 rounded-full border border-ink/10" aria-hidden />
        <span className="absolute right-6 bottom-4 size-3 rounded-full bg-paper/80" aria-hidden />
      </div>
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-display text-lg leading-snug font-semibold group-hover:text-lilac-700">{plan.name}</h3>
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>
        <p className="mt-1 text-[13px] text-ink-3">{meta || `${type.label} · no date yet`}</p>
        <div className="mt-auto flex items-center justify-between pt-4">
          <AvatarStack people={plan.members} />
          <span className="text-xs text-ink-3">
            {plan.ideaCount} {plan.ideaCount === 1 ? 'idea' : 'ideas'}
            {plan.currentVersion > 0 && ` · v${plan.currentVersion}`}
          </span>
        </div>
      </div>
    </Link>
  );
}

/** H01 — every plan in one place; start or resume in ≤ 2 clicks. */
export function Home() {
  const { user } = useSession();
  const plans = usePlans();

  return (
    <div className="flex min-h-dvh">
      <GlobalRail active="home" />
      <div className="min-w-0 flex-1">
        <MobileTopBar />
        <main className="mx-auto max-w-6xl px-5 py-8 md:px-10 md:py-12">
          <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-medium text-ink-3">
                {greeting()}, {user?.name}
              </p>
              <h1 className="mt-1 font-display text-4xl font-semibold md:text-5xl">Where to next?</h1>
              <p className="mt-2 text-ink-2">All your plans, one place.</p>
            </div>
            <Link href="/plans/new" className={buttonClass('primary', 'lg', 'gap-2')}>
              <Plus className="size-4" aria-hidden />
              New plan
            </Link>
          </header>

          <section aria-labelledby="start-heading" className="mt-10">
            <h2 id="start-heading" className="text-sm font-semibold text-ink-2">
              Start something new
            </h2>
            <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
              {PLAN_TYPES.map((t) => {
                const s = PLAN_TYPE_STYLE[t];
                return (
                  <Link
                    key={t}
                    href={`/plans/new?type=${t}`}
                    className={`flex items-center gap-3 rounded-2xl border border-transparent p-4 transition-colors ${s.tile}`}
                  >
                    <span className={`inline-flex size-10 shrink-0 items-center justify-center rounded-xl ${s.iconCls}`}>
                      <s.icon className="size-5" aria-hidden />
                    </span>
                    <span>
                      <span className="block font-semibold">{s.label}</span>
                      <span className="block text-xs text-ink-3">{s.blurb}</span>
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>

          <section aria-labelledby="plans-heading" className="mt-12">
            <h2 id="plans-heading" className="text-sm font-semibold text-ink-2">
              Your plans
            </h2>
            {plans.isError && (
              <Banner tone="error" className="mt-3" action={<Button size="sm" variant="secondary" onClick={() => plans.refetch()}>Retry</Button>}>
                {plans.error.message}
              </Banner>
            )}
            {plans.isPending && (
              <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-60 rounded-3xl" />
                ))}
              </div>
            )}
            {plans.data && plans.data.length === 0 && (
              <div className="mt-3 flex flex-col items-center rounded-3xl border border-dashed border-line-2 bg-paper/60 px-6 py-14 text-center">
                <Orbit className="size-10 text-lilac-600" aria-hidden />
                <p className="mt-4 font-display text-2xl font-semibold">Your next adventure starts here</p>
                <p className="mt-1 max-w-sm text-sm text-ink-2">Save a few places, invite your people, and turn it into a plan.</p>
                <Link href="/plans/new" className={buttonClass('primary', 'md', 'mt-6')}>
                  <Plus className="size-4" aria-hidden />
                  Create your first plan
                </Link>
              </div>
            )}
            {plans.data && plans.data.length > 0 && (
              <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {plans.data.map((p) => (
                  <PlanCard key={p.id} plan={p} />
                ))}
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
