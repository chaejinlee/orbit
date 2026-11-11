'use client';

import { ArrowRight, LayoutGrid, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { usePlan, useUpdatePlan } from '@/lib/queries';
import { PLAN_TYPE_STYLE } from './plan-visuals';
import { Badge, Banner, Skeleton } from './ui';

/**
 * C02 — two ways to start, one shared workspace. The choice only sets the
 * first screen; it never splits the plan into "AI" and "manual" modes.
 */
export function HybridEntry({ planId }: { planId: string }) {
  const router = useRouter();
  const plan = usePlan(planId);
  const update = useUpdatePlan(planId);

  const startManual = () => {
    update.mutate({ entryMode: 'MANUAL' });
    router.push(`/plans/${planId}?view=board`);
  };

  if (plan.isError) {
    return (
      <main className="mx-auto max-w-3xl px-5 py-16">
        <Banner tone="error">{plan.error.message}</Banner>
      </main>
    );
  }

  const type = plan.data ? PLAN_TYPE_STYLE[plan.data.type] : null;

  return (
    <main className="mx-auto flex min-h-dvh max-w-4xl flex-col justify-center px-5 py-12">
      {plan.data && type ? (
        <p className="flex items-center gap-2 text-sm font-semibold text-ink-2">
          <span className={`inline-flex size-7 items-center justify-center rounded-lg ${type.iconCls}`}>
            <type.icon className="size-3.5" aria-hidden />
          </span>
          {plan.data.name}
        </p>
      ) : (
        <Skeleton className="h-7 w-48" />
      )}
      <h1 className="mt-4 font-display text-4xl font-semibold md:text-5xl">Let’s make a plan.</h1>
      <p className="mt-2 text-ink-2">Pick a starting point. You can always switch later.</p>

      <div className="mt-10 grid gap-4 md:grid-cols-2">
        <button
          type="button"
          onClick={startManual}
          className="group flex flex-col rounded-3xl border border-line bg-paper p-6 text-left shadow-card transition-shadow hover:shadow-lift"
        >
          <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-sage text-ink">
            <LayoutGrid className="size-5" aria-hidden />
          </span>
          <span className="mt-6 font-display text-2xl font-semibold">I have some ideas</span>
          <span className="mt-2 text-ink-2">Start with a canvas and collect places, links and notes.</span>
          <span className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-sage-700">
            Open the board <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </span>
        </button>

        <div
          aria-disabled="true"
          className="flex flex-col rounded-3xl border border-dashed border-line-2 bg-paper/60 p-6 text-left"
        >
          <div className="flex items-start justify-between">
            <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-lilac-100 text-lilac-700">
              <Sparkles className="size-5" aria-hidden />
            </span>
            <Badge tone="lilac">Coming soon</Badge>
          </div>
          <span className="mt-6 font-display text-2xl font-semibold text-ink-2">Surprise me</span>
          <span className="mt-2 text-ink-3">
            Tell Orbit what you’re in the mood for and get feasible plans to compare. Arrives with the planning engine —
            whatever you collect on the board now will feed into it.
          </span>
        </div>
      </div>

      <p className="mt-8 text-center text-sm text-ink-3">Both paths lead to the same editable workspace.</p>
    </main>
  );
}
