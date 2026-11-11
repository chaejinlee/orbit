'use client';

import { PHOTO_MAX_SIDE } from '@orbit/shared';

export class PhotoPrepError extends Error {}

export interface PreparedPhoto {
  blob: Blob;
  width: number;
  height: number;
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((done) => canvas.toBlob(done, type, quality));
}

/**
 * Shrinks a photo in the browser before it's sent: upright (EXIF orientation),
 * at most PHOTO_MAX_SIDE px, re-encoded (which also drops its metadata). A
 * 12 MB phone photo becomes a few hundred KB, so uploads are quick on mobile
 * data. The server re-encodes again, so this is a courtesy, not the check.
 * Safari decodes HEIC here, which the server can't.
 */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  if (file.type && !file.type.startsWith('image/')) throw new PhotoPrepError(`“${file.name}” isn’t a photo.`);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new PhotoPrepError(`Orbit can’t read “${file.name}”. Try a JPG, PNG or WebP photo.`);
  }
  const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new PhotoPrepError('This browser can’t prepare photos.');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  let blob = await toBlob(canvas, 'image/webp', 0.85);
  if (!blob || blob.type !== 'image/webp') {
    // Older Safari can't encode WebP. JPEG has no transparency: paint white under the photo.
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    blob = await toBlob(canvas, 'image/jpeg', 0.88);
  }
  if (!blob) throw new PhotoPrepError(`Orbit can’t read “${file.name}”.`);
  return { blob, width, height };
}

/** Image files from a drop, a paste or a file picker (other files are skipped). */
export function imageFiles(list: FileList | DataTransferItemList | null | undefined): File[] {
  if (!list) return [];
  const out: File[] = [];
  for (const entry of Array.from(list as ArrayLike<File | DataTransferItem>)) {
    const file = entry instanceof File ? entry : entry.kind === 'file' ? entry.getAsFile() : null;
    if (file && (file.type.startsWith('image/') || /\.(heic|heif|jpe?g|png|webp|gif|avif)$/i.test(file.name))) out.push(file);
  }
  return out;
}
