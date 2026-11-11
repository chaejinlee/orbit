import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@orbit/db';
import { MAX_PLAN_PHOTOS, PHOTO_MAX_SIDE, PHOTO_THUMB_SIDE, type PhotoDTO, type PhotoVariant } from '@orbit/shared';
import type { Response } from 'express';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import sharp from 'sharp';
import { apiError, isUniqueViolation, personSelect } from '../core/http';
import { CONFIG, PRISMA, type AuthUser, type Config, type Db } from '../core/tokens';
import { PHOTO_STORAGE, type PhotoStorage } from './storage';

const photoInclude = { uploadedBy: { select: personSelect } } satisfies Prisma.PlanPhotoInclude;
type PhotoRow = Prisma.PlanPhotoGetPayload<{ include: typeof photoInclude }>;

/** Bigger inputs are refused before decoding (a small file can still decode to a huge image). */
const MAX_INPUT_PIXELS = 60_000_000;
const HOUR_S = 3600;

export const PHOTO_ERRORS = {
  empty: () => apiError(HttpStatus.BAD_REQUEST, 'PHOTO_EMPTY', 'Choose a photo first.'),
  unsupported: () =>
    apiError(HttpStatus.UNSUPPORTED_MEDIA_TYPE, 'PHOTO_UNSUPPORTED', 'Orbit can’t read this file. Try a JPG, PNG, WebP or GIF photo.'),
  tooLarge: () => apiError(HttpStatus.PAYLOAD_TOO_LARGE, 'PHOTO_TOO_LARGE', 'This photo is too big. Try a smaller one.'),
  tooMany: () =>
    apiError(HttpStatus.CONFLICT, 'TOO_MANY_PHOTOS', `This plan already has ${MAX_PLAN_PHOTOS} photos, the most one plan can hold.`),
};

export interface ProcessedPhoto {
  full: Buffer;
  thumb: Buffer;
  width: number;
  height: number;
}

/**
 * Decodes whatever was uploaded and re-encodes it as WebP: turned upright
 * (EXIF orientation), at most PHOTO_MAX_SIDE px, and with all metadata dropped,
 * so a phone photo's GPS location never reaches the rest of the group. Anything
 * that doesn't decode as an image is refused. Animated GIFs keep the first frame.
 */
export async function processPhoto(input: Buffer): Promise<ProcessedPhoto> {
  const open = () => sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, animated: false, failOn: 'error' }).rotate();
  try {
    const meta = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
    if (!meta.format || !['jpeg', 'png', 'webp', 'gif', 'heif'].includes(meta.format)) throw PHOTO_ERRORS.unsupported();
    const fit = (side: number) => ({ width: side, height: side, fit: 'inside' as const, withoutEnlargement: true });
    const full = await open().resize(fit(PHOTO_MAX_SIDE)).webp({ quality: 80 }).toBuffer({ resolveWithObject: true });
    const thumb = await open().resize(fit(PHOTO_THUMB_SIDE)).webp({ quality: 72 }).toBuffer();
    return { full: full.data, thumb, width: full.info.width, height: full.info.height };
  } catch (error) {
    if (error instanceof Error && /pixel limit/i.test(error.message)) throw PHOTO_ERRORS.tooLarge();
    if (error instanceof Error && 'getStatus' in error) throw error;
    throw PHOTO_ERRORS.unsupported();
  }
}

const storageKey = (planId: string, photoId: string, variant: PhotoVariant) => `${planId}/${photoId}.${variant}.webp`;

@Injectable()
export class PhotosService {
  private readonly urlKey: Buffer;

  constructor(
    @Inject(PRISMA) private readonly db: Db,
    @Inject(CONFIG) config: Config,
    @Inject(PHOTO_STORAGE) private readonly storage: PhotoStorage,
  ) {
    // A key of its own, derived from the server secret: photo links can't be turned into sessions or vice versa.
    this.urlKey = createHmac('sha256', config.authSecret).update('orbit:photo-urls:v1').digest();
  }

  // ─── Signed links ─────────────────────────────────────────────────────────
  // <img> can't send the session header, so photo files are served from
  // links that carry their own signature. A link names one photo and one
  // size, and works for one to two hours. It stays the same within each
  // hour, so the browser can cache it.

  private signature(photoId: string, variant: PhotoVariant, exp: number): Buffer {
    return createHmac('sha256', this.urlKey).update(`${photoId}:${variant}:${exp}`).digest();
  }

  signedPath(photoId: string, variant: PhotoVariant, nowMs = Date.now()): string {
    const exp = (Math.floor(nowMs / 1000 / HOUR_S) + 2) * HOUR_S;
    const sig = this.signature(photoId, variant, exp).toString('base64url');
    return `/v1/photos/${encodeURIComponent(photoId)}/${variant}?exp=${exp}&sig=${sig}`;
  }

  /** Seconds the link stays valid, or null when it's forged, tampered with or expired. */
  checkSignature(photoId: string, variant: PhotoVariant, exp: string, sig: string, nowMs = Date.now()): number | null {
    if (!/^\d{1,12}$/.test(exp) || !/^[A-Za-z0-9_-]{43}$/.test(sig)) return null;
    const expS = Number(exp);
    const left = expS - Math.floor(nowMs / 1000);
    if (left <= 0 || left > 3 * HOUR_S) return null;
    const given = Buffer.from(sig, 'base64url');
    const expected = this.signature(photoId, variant, expS);
    return given.length === expected.length && timingSafeEqual(given, expected) ? left : null;
  }

  private toDTO(row: PhotoRow): PhotoDTO {
    return {
      id: row.id,
      width: row.width,
      height: row.height,
      url: this.signedPath(row.id, 'full'),
      thumbUrl: this.signedPath(row.id, 'thumb'),
      uploadedBy: row.uploadedBy,
      createdAt: row.createdAt.toISOString(),
    };
  }

  // ─── Upload and list ──────────────────────────────────────────────────────

  async list(planId: string): Promise<PhotoDTO[]> {
    const rows = await this.db.planPhoto.findMany({ where: { planId }, orderBy: { createdAt: 'asc' }, include: photoInclude });
    return rows.map((r) => this.toDTO(r));
  }

  private findReplay(user: AuthUser, clientRequestId: string) {
    return this.db.planPhoto.findUnique({
      where: { uploadedById_clientRequestId: { uploadedById: user.id, clientRequestId } },
      include: photoInclude,
    });
  }

  private replayed(row: PhotoRow, planId: string): PhotoDTO {
    if (row.planId !== planId) {
      throw apiError(HttpStatus.CONFLICT, 'REQUEST_ID_REUSED', 'That upload id was already used for another plan.');
    }
    return this.toDTO(row);
  }

  async upload(planId: string, user: AuthUser, clientRequestId: string, body: Buffer): Promise<PhotoDTO> {
    const earlier = await this.findReplay(user, clientRequestId);
    if (earlier) return this.replayed(earlier, planId);
    if (body.length === 0) throw PHOTO_ERRORS.empty();
    if ((await this.db.planPhoto.count({ where: { planId } })) >= MAX_PLAN_PHOTOS) throw PHOTO_ERRORS.tooMany();

    const photo = await processPhoto(body);
    const id = randomUUID();
    const keys = [storageKey(planId, id, 'full'), storageKey(planId, id, 'thumb')] as const;
    await this.storage.put(keys[0], photo.full);
    await this.storage.put(keys[1], photo.thumb);
    try {
      const row = await this.db.$transaction(async (tx) => {
        const created = await tx.planPhoto.create({
          data: {
            id,
            planId,
            uploadedById: user.id,
            width: photo.width,
            height: photo.height,
            bytes: photo.full.length,
            thumbBytes: photo.thumb.length,
            clientRequestId,
          },
          include: photoInclude,
        });
        await tx.activityEvent.create({ data: { planId, actorId: user.id, type: 'photo.uploaded', payload: { photoId: id } } });
        return created;
      });
      return this.toDTO(row);
    } catch (error) {
      await Promise.all(keys.map((k) => this.storage.remove(k).catch(() => {})));
      // The same upload sent twice at once: the first one won.
      if (isUniqueViolation(error)) {
        const winner = await this.findReplay(user, clientRequestId);
        if (winner) return this.replayed(winner, planId);
      }
      throw error;
    }
  }

  // ─── Serving files ────────────────────────────────────────────────────────

  async send(res: Response, photoId: string, variant: PhotoVariant, exp: string, sig: string): Promise<void> {
    const left = this.checkSignature(photoId, variant, exp, sig);
    if (left === null) throw apiError(HttpStatus.FORBIDDEN, 'PHOTO_LINK_INVALID', 'This photo link has expired. Reload the page.');
    const row = await this.db.planPhoto.findUnique({ where: { id: photoId }, select: { planId: true } });
    if (!row) throw apiError(HttpStatus.NOT_FOUND, 'PHOTO_NOT_FOUND', 'This photo is gone.');
    await this.storage.send(res, storageKey(row.planId, photoId, variant), {
      'Cache-Control': `private, max-age=${Math.min(left, HOUR_S)}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Disposition': 'inline; filename="orbit-photo.webp"',
    });
  }
}
