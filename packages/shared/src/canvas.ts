import { z } from 'zod';
import type { PersonDTO } from './api-types';
import { idempotencyKey } from './schemas';

// The free canvas around the idea cards: text, photos, emoji stickers and
// arrows. Items live in the plan's Yjs document (see yboard.ts); photo files
// live in storage with a row in SQL (see the photos API).

export const CANVAS_ITEM_KINDS = ['text', 'photo', 'sticker'] as const;
export type CanvasItemKind = (typeof CANVAS_ITEM_KINDS)[number];

export const TEXT_COLORS = ['plain', 'butter', 'rose', 'sage', 'sky', 'lilac'] as const;
export type TextColor = (typeof TEXT_COLORS)[number];

export const TEXT_SIZES = ['s', 'm', 'l'] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

/** Longer text belongs in a note card (which can be commented on and planned). */
export const CANVAS_TEXT_MAX_CHARS = 2000;

/** Item sizes, in canvas pixels. Readers clamp to these. */
export const ITEM_SIZE_LIMITS = { min: 24, max: 2400 } as const;

export const DEFAULT_ITEM_SIZE = {
  text: { w: 220, h: 0 }, // height follows the text
  sticker: { w: 72, h: 72 },
  photoWidth: 260,
} as const;

/** The quick picks. Any emoji can be typed in too. */
export const STICKER_GROUPS: ReadonlyArray<{ label: string; emoji: readonly string[] }> = [
  { label: 'Feelings', emoji: ['❤️', '😍', '🤩', '😋', '😂', '🥳', '🤔', '😴', '😱', '🙏', '👍', '👎'] },
  { label: 'Marks', emoji: ['⭐', '🔥', '✅', '❌', '❓', '❗', '💯', '📍', '💸', '⏰', '🚫', '💡'] },
  { label: 'Food & drink', emoji: ['🍜', '🍣', '🍕', '🍔', '🌮', '🍰', '🍦', '☕', '🧋', '🍺', '🍷', '🥂'] },
  { label: 'Going out', emoji: ['🏖️', '⛰️', '🏛️', '🎡', '🎬', '🎤', '🎨', '🛍️', '🏨', '✈️', '🚗', '📸'] },
];

const EMOJI_CHARS = /^[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}‍️⃣\u{E0020}-\u{E007F}#*0-9]+$/u;
const EMOJI_MARK = /[\p{Extended_Pictographic}\p{Regional_Indicator}⃣]/u;

/** One emoji (or a short run of them), never ordinary text. */
export function isSticker(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 16 && EMOJI_CHARS.test(value) && EMOJI_MARK.test(value);
}

/** The first emoji in what someone typed (e.g. from the system emoji keyboard), or null. */
export function firstSticker(input: string): string | null {
  const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  const parts = segmenter ? Array.from(segmenter.segment(input.trim()), (s) => s.segment) : Array.from(input.trim());
  return parts.find((p) => isSticker(p)) ?? null;
}

// ─── Photos ─────────────────────────────────────────────────────────────────

/** What the browser may send. It shrinks photos first, so this is generous. */
export const PHOTO_MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
/** Stored photos are at most this many pixels on their longer side. */
export const PHOTO_MAX_SIDE = 2048;
export const PHOTO_THUMB_SIDE = 640;
export const MAX_PLAN_PHOTOS = 300;
export const PHOTO_UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'] as const;

export const uploadPhotoQuery = z.object({
  /** Generated once per photo, so a retried upload stores it once. */
  clientRequestId: idempotencyKey,
});
export type UploadPhotoQuery = z.infer<typeof uploadPhotoQuery>;

export type PhotoErrorCode = 'PHOTO_EMPTY' | 'PHOTO_UNSUPPORTED' | 'PHOTO_TOO_LARGE' | 'TOO_MANY_PHOTOS';

export type PhotoVariant = 'full' | 'thumb';

export interface PhotoDTO {
  id: string;
  width: number;
  height: number;
  /** Path under the API (`/v1/...`), signed and valid for at least an hour. */
  url: string;
  thumbUrl: string;
  uploadedBy: PersonDTO;
  createdAt: string;
}
