'use client';

import { firstSticker, STICKER_GROUPS } from '@orbit/shared';
import { useEffect, useRef, useState } from 'react';

/**
 * The sticker popover: quick picks, plus any emoji typed in (the system emoji
 * keyboard works there: ⌃⌘Space on a Mac, the emoji key on a phone).
 */
export function StickerPicker({ onPick, onClose }: { onPick: (emoji: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      // The toolbar button toggles the picker itself.
      if (ref.current && !ref.current.contains(target) && !target?.closest('[data-sticker-toggle]')) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const addTyped = () => {
    const emoji = firstSticker(typed);
    if (!emoji) return setError(true);
    onPick(emoji);
    setTyped('');
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Add a sticker"
      className="absolute top-full left-1/2 z-20 mt-2 w-[296px] -translate-x-1/2 rounded-2xl border border-line bg-paper p-3 shadow-lift"
    >
      {STICKER_GROUPS.map((group) => (
        <div key={group.label} className="mb-2">
          <p className="mb-1 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">{group.label}</p>
          <div className="grid grid-cols-6 gap-0.5">
            {group.emoji.map((emoji) => (
              <button
                key={emoji}
                type="button"
                aria-label={`Add ${emoji}`}
                onClick={() => onPick(emoji)}
                className="flex aspect-square items-center justify-center rounded-lg text-2xl hover:bg-ink/5"
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      ))}
      <form
        className="mt-1 flex items-center gap-2 border-t border-line pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          addTyped();
        }}
      >
        <input
          aria-label="Any emoji"
          placeholder="Any emoji…"
          value={typed}
          onChange={(e) => {
            setTyped(e.target.value);
            setError(false);
          }}
          className="h-9 min-w-0 flex-1 rounded-xl border border-line bg-paper px-3 text-sm outline-none focus:border-lilac-600"
        />
        <button type="submit" className="h-9 rounded-xl bg-ink px-3 text-sm font-semibold text-white disabled:opacity-40" disabled={!typed.trim()}>
          Add
        </button>
      </form>
      {error && <p className="mt-1.5 text-xs text-rose-700">That isn’t an emoji. Try the emoji keyboard.</p>}
    </div>
  );
}
