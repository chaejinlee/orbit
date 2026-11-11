import { Controller, Get, HttpStatus, Inject, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import {
  PHOTO_MAX_UPLOAD_BYTES,
  PHOTO_UPLOAD_TYPES,
  uploadPhotoQuery,
  type PhotoDTO,
  type UploadPhotoQuery,
} from '@orbit/shared';
import type { Response } from 'express';
import { PlanAccessGuard, Public, RequirePermission } from '../core/guards';
import { apiError, CurrentUser, ZodBody } from '../core/http';
import type { AppRequest, AuthUser } from '../core/tokens';
import { PHOTO_ERRORS, PhotosService } from './photos.service';

/** Reads the raw request body (the photo itself), refusing anything over `limit` bytes. */
async function readBody(req: AppRequest, limit: number): Promise<Buffer> {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) throw PHOTO_ERRORS.tooLarge();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) throw PHOTO_ERRORS.tooLarge();
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

@Controller('plans/:planId/photos')
@UseGuards(PlanAccessGuard)
export class PlanPhotosController {
  constructor(@Inject(PhotosService) private readonly photos: PhotosService) {}

  @Get()
  @RequirePermission('plan.view')
  list(@Param('planId') planId: string): Promise<PhotoDTO[]> {
    return this.photos.list(planId);
  }

  /**
   * The body is the photo itself (Content-Type image/jpeg, png, webp, gif or
   * avif). Checked after the permission guard, so a stranger's upload is
   * refused before it's read.
   */
  @Post()
  @RequirePermission('photo.upload')
  async upload(
    @Param('planId') planId: string,
    @Query(new ZodBody(uploadPhotoQuery)) query: UploadPhotoQuery,
    @CurrentUser() user: AuthUser,
    @Req() req: AppRequest,
  ): Promise<PhotoDTO> {
    const type = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    if (!(PHOTO_UPLOAD_TYPES as readonly string[]).includes(type)) throw PHOTO_ERRORS.unsupported();
    const body = await readBody(req, PHOTO_MAX_UPLOAD_BYTES);
    return this.photos.upload(planId, user, query.clientRequestId, body);
  }
}

/** Photo files, from signed links (an <img> can't send the session header). */
@Controller('photos')
export class PhotoFilesController {
  constructor(@Inject(PhotosService) private readonly photos: PhotosService) {}

  @Public()
  @Get(':photoId/:variant')
  async file(
    @Param('photoId') photoId: string,
    @Param('variant') variant: string,
    @Query('exp') exp: unknown,
    @Query('sig') sig: unknown,
    @Res() res: Response,
  ): Promise<void> {
    if ((variant !== 'full' && variant !== 'thumb') || !/^[A-Za-z0-9_-]{8,64}$/.test(photoId)) {
      throw apiError(HttpStatus.NOT_FOUND, 'PHOTO_NOT_FOUND', 'This photo is gone.');
    }
    await this.photos.send(res, photoId, variant, typeof exp === 'string' ? exp : '', typeof sig === 'string' ? sig : '');
  }
}
