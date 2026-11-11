'use client';

import {
  createPlanInput,
  defaultPlanName,
  PLAN_TYPES,
  parseClock,
  toMinor,
  type CreatePlanInput,
  type PlanType,
} from '@orbit/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import { api, newRequestId } from '@/lib/api';
import { cn, CURRENCIES, localeCurrency } from '@/lib/format';
import { keys } from '@/lib/queries';
import { PLAN_TYPE_STYLE } from './plan-visuals';
import { Banner, Button, Field, Input, Select } from './ui';

type Errors = Partial<Record<'type' | 'name' | 'city' | 'startDate' | 'endDate' | 'startMin' | 'endMin' | 'budget' | 'form', string>>;

function isPlanType(value: string | null): value is PlanType {
  return (PLAN_TYPES as readonly string[]).includes(value ?? '');
}

/** C01 — only the type is required; everything else can be decided later. */
export function CreatePlan() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const initialType = params.get('type');

  const [type, setType] = useState<PlanType | null>(isPlanType(initialType) ? initialType : null);
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [overnight, setOvernight] = useState(false);
  const [budget, setBudget] = useState('');
  const [currency, setCurrency] = useState(() => (typeof navigator === 'undefined' ? 'USD' : localeCurrency()));
  const [errors, setErrors] = useState<Errors>({});
  // One key per form: a double click or a retry after a network error can't create two plans.
  const [clientRequestId] = useState(newRequestId);

  const startMin = startTime ? parseClock(startTime) : null;
  const rawEndMin = endTime ? parseClock(endTime) : null;
  const crossesMidnight = startMin != null && rawEndMin != null && rawEndMin <= startMin;
  const endMin = rawEndMin != null && crossesMidnight && overnight ? rawEndMin + 1440 : rawEndMin;

  const placeholderName = useMemo(
    () => (type ? defaultPlanName(type, { startDate: startDate || null, city: city.trim() || null }) : 'Name your plan'),
    [type, startDate, city],
  );

  const create = useMutation({
    mutationFn: (input: CreatePlanInput) => api.createPlan(input),
    onSuccess: (plan) => {
      void qc.invalidateQueries({ queryKey: keys.plans });
      qc.setQueryData(keys.plan(plan.id), plan);
      router.push(`/plans/${plan.id}/start`);
    },
    onError: (error) => setErrors({ form: error.message }),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!type) {
      setErrors({ type: 'Pick what you’re planning.' });
      return;
    }
    const amount = budget.trim() === '' ? null : Number(budget);
    if (amount != null && (!Number.isFinite(amount) || amount < 0)) {
      setErrors({ budget: 'Enter a positive amount, or leave it empty.' });
      return;
    }
    const input = {
      clientRequestId,
      type,
      name: name.trim() || undefined,
      city: city.trim() || undefined,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      startDate: startDate || undefined,
      endDate: type === 'TRIP' ? endDate || undefined : undefined,
      startMin: startMin ?? undefined,
      endMin: endMin ?? undefined,
      budget: amount != null ? { amountMinor: toMinor(amount, currency), currency } : undefined,
    };
    const parsed = createPlanInput.safeParse(input);
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) {
        const key = (issue.path[0] as keyof Errors | undefined) ?? 'form';
        next[key] ??= issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    create.mutate(parsed.data);
  };

  return (
    <main className="mx-auto max-w-2xl px-5 py-8 md:py-14">
      <Link href="/" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Home
      </Link>
      <h1 className="mt-6 font-display text-4xl font-semibold">What are we planning?</h1>
      <p className="mt-2 text-ink-2">Only the type is required. Dates, places and budget can wait.</p>

      <form onSubmit={submit} noValidate className="mt-8 flex flex-col gap-8">
        <fieldset>
          <legend className="sr-only">Plan type</legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" role="radiogroup" aria-invalid={Boolean(errors.type)}>
            {PLAN_TYPES.map((t) => {
              const s = PLAN_TYPE_STYLE[t];
              const checked = type === t;
              return (
                <label
                  key={t}
                  className={cn(
                    'relative flex cursor-pointer flex-col gap-3 rounded-2xl border bg-paper p-4 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-lilac-600',
                    checked ? 'border-ink ring-1 ring-ink' : 'border-line hover:border-ink/30',
                  )}
                >
                  <input
                    type="radio"
                    name="plan-type"
                    value={t}
                    checked={checked}
                    onChange={() => {
                      setType(t);
                      setErrors((e) => ({ ...e, type: undefined }));
                    }}
                    className="sr-only"
                  />
                  <span className={`inline-flex size-9 items-center justify-center rounded-xl ${s.iconCls}`}>
                    <s.icon className="size-4" aria-hidden />
                  </span>
                  <span>
                    <span className="block font-semibold">{s.label}</span>
                    <span className="block text-xs text-ink-3">{s.blurb}</span>
                  </span>
                </label>
              );
            })}
          </div>
          {errors.type && (
            <p className="mt-2 text-xs font-medium text-rose-700" role="alert">
              {errors.type}
            </p>
          )}
        </fieldset>

        <Field label="Name" optional error={errors.name}>
          {({ id, describedBy, invalid }) => (
            <Input id={id} value={name} placeholder={placeholderName} maxLength={80} aria-describedby={describedBy} aria-invalid={invalid} onChange={(e) => setName(e.target.value)} />
          )}
        </Field>

        <Field label="Where?" optional hint="A city or area. Not sure yet? Leave it blank." error={errors.city}>
          {({ id, describedBy, invalid }) => (
            <Input id={id} value={city} placeholder="Toronto" aria-describedby={describedBy} aria-invalid={invalid} onChange={(e) => setCity(e.target.value)} />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={type === 'TRIP' ? 'From' : 'When?'} optional error={errors.startDate}>
            {({ id, describedBy, invalid }) => (
              <Input id={id} type="date" value={startDate} aria-describedby={describedBy} aria-invalid={invalid} onChange={(e) => setStartDate(e.target.value)} />
            )}
          </Field>
          {type === 'TRIP' && (
            <Field label="To" optional error={errors.endDate}>
              {({ id, describedBy, invalid }) => (
                <Input id={id} type="date" min={startDate || undefined} value={endDate} aria-describedby={describedBy} aria-invalid={invalid} onChange={(e) => setEndDate(e.target.value)} />
              )}
            </Field>
          )}
        </div>

        <div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Starts at" optional error={errors.startMin}>
              {({ id, describedBy, invalid }) => (
                <Input id={id} type="time" step={900} value={startTime} aria-describedby={describedBy} aria-invalid={invalid} onChange={(e) => setStartTime(e.target.value)} />
              )}
            </Field>
            <Field label="Wraps up by" optional error={errors.endMin}>
              {({ id, describedBy, invalid }) => (
                <Input id={id} type="time" step={900} value={endTime} aria-describedby={describedBy} aria-invalid={invalid} onChange={(e) => setEndTime(e.target.value)} />
              )}
            </Field>
          </div>
          {crossesMidnight && (
            <label className="mt-3 flex items-center gap-2 rounded-xl bg-butter-50 px-3 py-2 text-[13px] text-butter-800">
              <input type="checkbox" checked={overnight} onChange={(e) => setOvernight(e.target.checked)} className="size-4 accent-ink" />
              This ends after midnight (the next day)
            </label>
          )}
        </div>

        <Field label="Budget" optional hint="The total for the whole group. Used to check plans, never guessed." error={errors.budget}>
          {({ id, describedBy, invalid }) => (
            <div className="flex gap-2">
              <Input
                id={id}
                inputMode="decimal"
                placeholder="120"
                value={budget}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                onChange={(e) => setBudget(e.target.value)}
              />
              <Select aria-label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-28">
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </div>
          )}
        </Field>

        <p className="text-sm text-ink-3">You can invite people once the plan exists.</p>

        {errors.form && <Banner tone="error">{errors.form}</Banner>}

        <div className="flex justify-end gap-2">
          <Link href="/" className="inline-flex h-12 items-center rounded-xl px-5 text-[15px] font-semibold text-ink-2 hover:bg-ink/5">
            Cancel
          </Link>
          <Button type="submit" size="lg" loading={create.isPending}>
            Create plan
          </Button>
        </div>
      </form>
    </main>
  );
}
