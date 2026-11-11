'use client';

import type { IdeaStatus, PersonDTO } from '@orbit/shared';
import { IDEA_STATUS_LABEL } from '@orbit/shared';
import { CircleExclamationPoint, Info, LoaderCircle, TriangleExclamationPoint, X } from 'lucide-react';
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '@/lib/format';

// ─── Buttons ────────────────────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-ink text-white hover:bg-ink/90 disabled:bg-ink/40',
  secondary: 'bg-paper text-ink border border-line-2 hover:bg-ivory disabled:text-ink-3',
  ghost: 'text-ink-2 hover:bg-ink/5 disabled:text-ink-3',
  danger: 'bg-paper text-rose-700 border border-rose/70 hover:bg-rose-50',
};
const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-5 text-[15px] gap-2 rounded-xl',
};

/** Button styling for links that navigate (never nest a <button> in an <a>). */
export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', className?: string): string {
  return cn(
    'inline-flex shrink-0 items-center justify-center font-semibold whitespace-nowrap transition-colors',
    BUTTON_VARIANT[variant],
    BUTTON_SIZE[size],
    className,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex shrink-0 items-center justify-center font-semibold whitespace-nowrap transition-colors disabled:cursor-not-allowed',
        BUTTON_VARIANT[variant],
        BUTTON_SIZE[size],
        className,
      )}
      {...rest}
    >
      {loading ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  active?: boolean;
}

export function IconButton({ label, active, className, children, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={active ?? undefined}
      className={cn(
        'inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-2 transition-colors hover:bg-ink/5 disabled:cursor-not-allowed disabled:opacity-40',
        active && 'bg-lilac-100 text-lilac-700 hover:bg-lilac-100',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

// ─── Form controls ──────────────────────────────────────────────────────────

const CONTROL =
  'w-full rounded-xl border border-line-2 bg-paper px-3 text-sm text-ink placeholder:text-ink-3 transition-colors hover:border-ink/25 focus:border-lilac-600 focus:outline-none focus:ring-2 focus:ring-lilac-100 disabled:bg-ivory disabled:text-ink-3 aria-[invalid=true]:border-rose-700';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cn(CONTROL, 'h-10', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...rest },
  ref,
) {
  return <textarea ref={ref} className={cn(CONTROL, 'min-h-20 py-2.5 leading-relaxed', className)} {...rest} />;
});

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(CONTROL, 'h-10 appearance-none bg-[length:16px] bg-[right_0.6rem_center] bg-no-repeat pr-8', className)} style={{ backgroundImage: CHEVRON }} {...rest}>
      {children}
    </select>
  );
}
const CHEVRON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23686d84' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")";

export function Field({
  label,
  hint,
  error,
  optional,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  optional?: boolean;
  children: (ids: { id: string; describedBy?: string; invalid: boolean }) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-semibold text-ink">
        {label}
        {optional && <span className="ml-1.5 font-normal text-ink-3">optional</span>}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {hint && !error && (
        <p id={hintId} className="text-xs text-ink-3">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs font-medium text-rose-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// ─── Display ────────────────────────────────────────────────────────────────

export type Tone = 'neutral' | 'lilac' | 'peach' | 'sage' | 'butter' | 'sky' | 'rose';

const TONE: Record<Tone, string> = {
  neutral: 'bg-ink/5 text-ink-2',
  lilac: 'bg-lilac-100 text-lilac-700',
  peach: 'bg-peach-50 text-peach-700',
  sage: 'bg-sage-50 text-sage-700',
  butter: 'bg-butter-50 text-butter-800',
  sky: 'bg-sky-50 text-sky-700',
  rose: 'bg-rose-50 text-rose-700',
};

export function Badge({ tone = 'neutral', className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap', TONE[tone], className)}>
      {children}
    </span>
  );
}

const STATUS_TONE: Record<IdeaStatus, Tone> = {
  saved: 'neutral',
  shortlisted: 'lilac',
  in_plan: 'sage',
  needs_decision: 'butter',
  archived: 'neutral',
};
const STATUS_DOT: Record<IdeaStatus, string> = {
  saved: 'bg-ink-3',
  shortlisted: 'bg-lilac-600',
  in_plan: 'bg-sage-700',
  needs_decision: 'bg-butter-800',
  archived: 'bg-ink-3',
};

export function StatusBadge({ status }: { status: IdeaStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]}>
      <span className={cn('size-1.5 rounded-full', STATUS_DOT[status])} aria-hidden />
      {IDEA_STATUS_LABEL[status]}
    </Badge>
  );
}

const PERSON: Record<string, string> = {
  lilac: 'bg-lilac text-ink',
  peach: 'bg-peach text-ink',
  sage: 'bg-sage text-ink',
  sky: 'bg-sky text-ink',
  butter: 'bg-butter text-ink',
  rose: 'bg-rose text-ink',
};

export function Avatar({ person, size = 'md', ring }: { person: PersonDTO; size?: 'sm' | 'md'; ring?: boolean }) {
  return (
    <span
      title={person.name}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold uppercase',
        size === 'sm' ? 'size-6 text-[10px]' : 'size-8 text-xs',
        ring && 'ring-2 ring-paper',
        PERSON[person.color] ?? PERSON.lilac,
      )}
    >
      {person.name.slice(0, 1)}
      <span className="sr-only">{person.name}</span>
    </span>
  );
}

export function AvatarStack({ people, max = 4, size = 'sm' }: { people: PersonDTO[]; max?: number; size?: 'sm' | 'md' }) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <span className="flex items-center -space-x-1.5">
      {shown.map((p) => (
        <Avatar key={p.id} person={p} size={size} ring />
      ))}
      {rest > 0 && (
        <span className="inline-flex size-6 items-center justify-center rounded-full bg-ink/10 text-[10px] font-semibold text-ink-2 ring-2 ring-paper">
          +{rest}
        </span>
      )}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-xl bg-ink/[0.06]', className)} aria-hidden />;
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-ink-3">
      <LoaderCircle className="size-4 animate-spin" aria-hidden />
      {label}
    </span>
  );
}

const BANNER = {
  info: { icon: Info, cls: 'bg-sky-50 text-sky-700 border-sky/60' },
  warning: { icon: TriangleExclamationPoint, cls: 'bg-butter-50 text-butter-800 border-butter' },
  error: { icon: CircleExclamationPoint, cls: 'bg-rose-50 text-rose-700 border-rose/70' },
} as const;

export function Banner({
  tone = 'info',
  children,
  action,
  className,
}: {
  tone?: keyof typeof BANNER;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const { icon: Icon, cls } = BANNER[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cn('flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-[13px]', cls, className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 leading-relaxed">{children}</div>
      {action}
    </div>
  );
}

// ─── Dialog (native <dialog>: focus trap, Esc and backdrop for free) ───────

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 'max-w-lg',
  initialFocus = 'field',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
  /** 'field': start in the first field (forms). 'none': leave focus where the browser puts it. */
  initialFocus?: 'field' | 'none';
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // showModal() focuses the first focusable element (the close button);
      // forms start in their first field instead.
      if (initialFocus === 'field') {
        dialog.querySelector<HTMLElement>('[data-dialog-body] :is(input, textarea, select):not([disabled])')?.focus();
      }
    }
    if (!open && dialog.open) dialog.close();
  }, [open, initialFocus]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        'm-auto w-[calc(100%-2rem)] rounded-3xl border border-line bg-paper p-0 text-ink shadow-lift backdrop:transition-opacity',
        width,
      )}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <header className="flex items-start justify-between gap-4 px-6 pt-5 pb-3">
            <div>
              <h2 id={titleId} className="font-display text-xl font-semibold">
                {title}
              </h2>
              {description && <p className="mt-1 text-sm text-ink-2">{description}</p>}
            </div>
            <IconButton label="Close" onClick={onClose} className="-mr-2">
              <X className="size-4" />
            </IconButton>
          </header>
          <div data-dialog-body className="min-h-0 flex-1 overflow-y-auto px-6 pb-5">
            {children}
          </div>
          {footer && <footer className="flex justify-end gap-2 border-t border-line px-6 py-4">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}
