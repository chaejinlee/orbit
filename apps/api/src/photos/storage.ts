import type { Response } from 'express';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

export const PHOTO_STORAGE = Symbol('PHOTO_STORAGE');

/**
 * Where photo files live. Keys are built only from server-generated ids
 * (`<planId>/<photoId>.<variant>.webp`), never from anything a client sent.
 * Local disk for now; object storage (e.g. Cloudflare R2) can implement the
 * same interface, with `send` redirecting to a short-lived storage URL.
 */
export interface PhotoStorage {
  put(key: string, data: Buffer): Promise<void>;
  remove(key: string): Promise<void>;
  /** Streams the file as the response (or 404s if it's missing). */
  send(res: Response, key: string, headers: Record<string, string>): Promise<void>;
}

const SAFE_KEY = /^[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{1,64}\.(full|thumb)\.webp$/;

export class LocalPhotoStorage implements PhotoStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private path(key: string): string {
    if (!SAFE_KEY.test(key)) throw new Error(`Unsafe photo key: ${key}`);
    const full = resolve(this.root, key);
    if (!full.startsWith(this.root + sep)) throw new Error(`Photo key escapes the uploads folder: ${key}`);
    return full;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const file = this.path(key);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, data, { flag: 'w' });
  }

  async remove(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }

  send(res: Response, key: string, headers: Record<string, string>): Promise<void> {
    this.path(key); // validates
    return new Promise((done, fail) => {
      res.sendFile(key, { root: this.root, headers, dotfiles: 'deny', lastModified: false }, (error?: Error & { status?: number; statusCode?: number }) => {
        if (!error) return done();
        if (res.headersSent) return done();
        const status = error.status ?? error.statusCode;
        if (status === 404) {
          res.status(404).json({ statusCode: 404, code: 'PHOTO_NOT_FOUND', message: 'This photo is gone.' });
          return done();
        }
        fail(error);
      });
    });
  }
}
