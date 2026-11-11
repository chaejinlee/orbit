'use client';

import { useMutation } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { takeCodeFromLink, useOnThisComputer } from './phone';
import { Logo } from './shell';
import { Banner, Button, Field, Input } from './ui';

const DEMO_ACCOUNTS = [
  { email: 'demo@orbit.dev', name: 'Demo', note: 'Owner of the sample plan' },
  { email: 'sam@orbit.dev', name: 'Sam', note: 'Editor — open in a second browser' },
];

function OrbitIllustration() {
  return (
    <svg viewBox="0 0 400 400" className="h-auto w-full max-w-[420px]" role="img" aria-label="">
      <defs>
        <radialGradient id="glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#f4f1fc" />
          <stop offset="100%" stopColor="#f8f6f2" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="200" cy="200" r="190" fill="url(#glow)" />
      <g fill="none" stroke="#d9d2c6" strokeWidth="1.5">
        <ellipse cx="200" cy="200" rx="170" ry="70" transform="rotate(-18 200 200)" />
        <ellipse cx="200" cy="200" rx="120" ry="120" strokeDasharray="4 8" />
        <ellipse cx="200" cy="200" rx="170" ry="70" transform="rotate(32 200 200)" />
      </g>
      <circle cx="200" cy="200" r="34" fill="#24283b" />
      <text x="200" y="207" textAnchor="middle" fontSize="20" fontWeight="600" fill="#f8f6f2" fontFamily="var(--font-display)">
        go
      </text>
      <circle cx="44" cy="232" r="16" fill="#b7a7e6" />
      <circle cx="318" cy="96" r="12" fill="#f0bba8" />
      <circle cx="300" cy="300" r="20" fill="#b6d8c2" />
      <circle cx="110" cy="96" r="9" fill="#a9cbea" />
      <g transform="translate(232 286) rotate(-6)">
        <rect width="128" height="70" rx="14" fill="#fff" stroke="#e8e3da" />
        <rect x="10" y="10" width="44" height="8" rx="4" fill="#b6d8c2" />
        <rect x="10" y="26" width="96" height="9" rx="4.5" fill="#24283b" opacity=".85" />
        <rect x="10" y="42" width="66" height="7" rx="3.5" fill="#686d84" opacity=".5" />
      </g>
      <g transform="translate(36 120) rotate(5)">
        <rect width="118" height="66" rx="14" fill="#fff" stroke="#e8e3da" />
        <rect x="10" y="10" width="38" height="8" rx="4" fill="#b7a7e6" />
        <rect x="10" y="26" width="88" height="9" rx="4.5" fill="#24283b" opacity=".85" />
        <rect x="10" y="42" width="54" height="7" rx="3.5" fill="#686d84" opacity=".5" />
      </g>
    </svg>
  );
}

/**
 * A01 — sign-in. Development build: passwordless. On another device (a phone
 * on the same Wi-Fi in phone mode) it also needs the code the computer shows.
 * `intro` replaces the tagline, e.g. with the invitation you're signing in for.
 */
export function Welcome({ intro }: { intro?: ReactNode } = {}) {
  const { signIn } = useSession();
  const onPhone = useOnThisComputer() === false;
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const fromLink = takeCodeFromLink();
    if (fromLink) setCode(fromLink);
  }, []);

  const digits = code.replace(/\D/g, '');
  const login = useMutation({
    mutationFn: (input: { email: string; name?: string }) => api.devLogin(input.email, input.name, onPhone ? digits : undefined),
    onSuccess: signIn,
  });

  const start = (input: { email: string; name?: string }) => {
    if (onPhone && digits.length !== 6) {
      setCodeError('Enter the 6-digit code shown on your computer.');
      codeRef.current?.focus();
      return;
    }
    setCodeError(null);
    login.mutate(input);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    start({ email: email.trim(), name: name.trim() || undefined });
  };

  const apiError = login.error instanceof ApiError ? login.error : null;
  const codeMessage = codeError ?? (apiError?.code === 'PHONE_CODE' ? apiError.message : null);
  const error = !apiError || apiError.code === 'PHONE_CODE'
    ? null
    : apiError.status !== 0
      ? apiError.message
      : onPhone
        ? 'Can’t reach Orbit on your computer. Is it running with `npm run dev:phone`, and is this phone on the same Wi-Fi?'
        : 'Can’t reach the Orbit API. Is `npm run dev` running?';

  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <section className="hidden flex-col justify-between bg-linear-to-br from-lilac-50 via-ivory to-peach-50 p-12 lg:flex">
        <Logo className="text-3xl" />
        <div className="flex justify-center">
          <OrbitIllustration />
        </div>
        <p className="max-w-sm text-sm text-ink-2">Discover what you’d love to do, decide together, and actually go.</p>
      </section>

      <section className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-sm">
          <Logo className="text-3xl lg:hidden" />
          {intro ? (
            <>
              <div className="mt-6 lg:mt-0">{intro}</div>
              <p className="mt-6 font-display text-xl font-semibold">Sign in to join</p>
            </>
          ) : (
            <>
              <h1 className="mt-6 font-display text-4xl leading-tight font-semibold lg:mt-0">Better plans, together.</h1>
              <p className="mt-2 text-ink-2">From saving ideas to making memories.</p>
            </>
          )}

          <form onSubmit={submit} className={intro ? 'mt-4 flex flex-col gap-4' : 'mt-8 flex flex-col gap-4'}>
            {onPhone && (
              <Field label="Code from your computer" error={codeMessage} hint="Shown under “On your phone” in Orbit on the computer running it.">
                {({ id, describedBy, invalid }) => (
                  <Input
                    ref={codeRef}
                    id={id}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={7}
                    placeholder="123 456"
                    value={code}
                    aria-invalid={invalid}
                    aria-describedby={describedBy}
                    onChange={(e) => {
                      setCode(e.target.value);
                      setCodeError(null);
                    }}
                    className="text-lg tracking-widest tabular-nums"
                  />
                )}
              </Field>
            )}
            <Field label="Email">
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  aria-describedby={describedBy}
                  onChange={(e) => setEmail(e.target.value)}
                />
              )}
            </Field>
            <Field label="Your name" optional hint="Shown to people you plan with.">
              {({ id, describedBy }) => (
                <Input id={id} autoComplete="given-name" value={name} aria-describedby={describedBy} onChange={(e) => setName(e.target.value)} />
              )}
            </Field>
            {error && <Banner tone="error">{error}</Banner>}
            <Button type="submit" size="lg" loading={login.isPending} icon={<ArrowRight className="size-4" />}>
              Continue
            </Button>
            <Button variant="secondary" size="lg" disabled title="Coming soon">
              Continue with Google · soon
            </Button>
          </form>

          <div className="mt-8 rounded-2xl border border-dashed border-line-2 p-4">
            <p className="text-xs font-semibold tracking-wide text-ink-3 uppercase">Development sign-in</p>
            <p className="mt-1 text-[13px] text-ink-2">
              {onPhone
                ? 'No password: the code above is what lets this phone in. Try the seeded sample plan:'
                : 'No password, local only. Try the seeded sample plan:'}
            </p>
            <div className="mt-3 flex flex-col gap-2">
              {DEMO_ACCOUNTS.map((a) => (
                <button
                  key={a.email}
                  type="button"
                  disabled={login.isPending}
                  onClick={() => start({ email: a.email })}
                  className="flex flex-col rounded-xl border border-line bg-paper px-3 py-2 text-left text-sm transition-colors hover:border-lilac-600"
                >
                  <span>
                    <span className="font-semibold">{a.name}</span>
                    <span className="ml-2 text-ink-3">{a.email}</span>
                  </span>
                  <span className="text-xs text-ink-3">{a.note}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
