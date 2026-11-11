'use client';

import { isLoopbackHostname, type PhoneAccessDTO } from '@orbit/shared';
import { useQuery } from '@tanstack/react-query';
import { Smartphone } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { encode } from 'uqr';
import { api } from '@/lib/api';
import { cn } from '@/lib/format';
import { Banner, Dialog, IconButton, Skeleton } from './ui';

/**
 * Where this page was opened: `true` on the computer running Orbit
 * (localhost), `false` on another device such as a phone on the same Wi-Fi,
 * `null` until mounted (the server can't know).
 */
export function useOnThisComputer(): boolean | null {
  const [value, setValue] = useState<boolean | null>(null);
  useEffect(() => setValue(isLoopbackHostname(window.location.hostname)), []);
  return value;
}

/** The phone link carries the sign-in code after `#`, which never reaches a server log. */
export function phoneLink(url: string, code: string): string {
  return `${url}/#code=${code}`;
}

/** Reads `#code=123456` from a scanned phone link once, then drops it from the address bar. */
export function takeCodeFromLink(): string | null {
  const code = /(?:^#|&)code=(\d{6})(?:&|$)/.exec(window.location.hash)?.[1] ?? null;
  if (code) window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
  return code;
}

export function QrCode({ text, label, className }: { text: string; label: string; className?: string }) {
  const { path, size } = useMemo(() => {
    const { data } = encode(text, { ecc: 'M', border: 2 });
    let d = '';
    data.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) d += `M${x} ${y}h1v1h-1z`;
      }),
    );
    return { path: d, size: data.length };
  }, [text]);
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      className={cn('size-52 rounded-2xl border border-line bg-white p-1', className)}
    >
      <path d={path} fill="#24283b" />
    </svg>
  );
}

function PhoneInstructions({ access }: { access: Extract<PhoneAccessDTO, { enabled: true }> }) {
  const [url, ...others] = access.urls;
  if (!url) {
    return (
      <Banner tone="warning">
        This computer has no Wi-Fi or network address right now. Connect it to the same Wi-Fi as your phone, then open this again.
      </Banner>
    );
  }
  const code = `${access.code.slice(0, 3)} ${access.code.slice(3)}`;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        <QrCode text={phoneLink(url, access.code)} label={`QR code that opens ${url} on your phone`} />
        <div className="flex min-w-0 flex-col gap-3 text-sm">
          <div>
            <p className="text-xs font-semibold tracking-wide text-ink-3 uppercase">Sign-in code</p>
            <p className="font-display text-3xl font-semibold tracking-wider tabular-nums" aria-label={`Sign-in code ${access.code.split('').join(' ')}`}>
              {code}
            </p>
            <p className="text-xs text-ink-3">Filled in when you scan. The home-screen app asks for it once.</p>
          </div>
          <div>
            <p className="text-xs font-semibold tracking-wide text-ink-3 uppercase">Or type this address</p>
            <p className="font-semibold break-all select-all">{url}</p>
            {others.length > 0 && <p className="mt-1 text-xs text-ink-3">If it doesn’t open, try {others.join(' or ')}.</p>}
          </div>
        </div>
      </div>
      <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-ink-2">
        <li>Put your phone on the same Wi-Fi as this computer.</li>
        <li>Scan the QR code with the phone’s camera and open the link.</li>
        <li>Pick an account (or type your email) to sign in.</li>
        <li>
          To keep it as an app: on iPhone, Safari’s Share button → <span className="font-semibold">Add to Home Screen</span>. On Android, Chrome’s ⋮
          menu → <span className="font-semibold">Add to Home screen</span>.
        </li>
      </ol>
      <p className="text-xs text-ink-3">
        Orbit works on the phone while it runs here. If the page doesn’t load: allow incoming connections if macOS asks about “node”, and check that
        both are on the same Wi-Fi (some campus and café networks keep devices apart; a phone hotspot works).
      </p>
    </div>
  );
}

/** "On your phone": the QR code, link and sign-in code. Only shown on the computer running Orbit. */
export function PhoneAccessButton() {
  const onThisComputer = useOnThisComputer();
  const [open, setOpen] = useState(false);
  const access = useQuery({ queryKey: ['phone-access'], queryFn: api.phoneAccess, enabled: open, staleTime: 0 });
  if (!onThisComputer) return null;

  return (
    <>
      <IconButton label="Open on your phone" onClick={() => setOpen(true)}>
        <Smartphone className="size-4" />
      </IconButton>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Open Orbit on your phone"
        description="Your phone needs to be on the same Wi-Fi as this computer."
      >
        {access.isPending ? (
          <Skeleton className="h-52 w-full" />
        ) : access.error ? (
          <Banner tone="error">Couldn’t read the phone settings from the Orbit API. Is it still running?</Banner>
        ) : access.data.enabled ? (
          <PhoneInstructions access={access.data} />
        ) : (
          <div className="flex flex-col gap-3 text-sm text-ink-2">
            <p>Right now Orbit only opens on this computer.</p>
            <p>
              To use it on your phone, stop Orbit (Ctrl+C in its terminal) and start it with{' '}
              <code className="rounded bg-ink/5 px-1.5 py-0.5 text-[13px] text-ink">npm run dev:phone</code>. Then open this again for the QR code.
            </p>
            <p className="text-xs text-ink-3">
              A phone signs in with a code shown here, so other people on the same Wi-Fi can’t get in without it.
            </p>
          </div>
        )}
      </Dialog>
    </>
  );
}
