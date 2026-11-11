import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, Inject, NotFoundException, Post, Req } from '@nestjs/common';
import { signSessionToken } from '@orbit/db';
import type { AuthResultDTO, MeDTO, PhoneAccessDTO } from '@orbit/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { Public } from '../core/guards';
import { CurrentUser, ZodBody } from '../core/http';
import { CONFIG, PRISMA, type AuthUser, type Config, type Db } from '../core/tokens';
import { fromThisComputer, PhoneAccess } from './phone-access';

const devLoginInput = z.object({
  email: z.email().max(254).transform((e) => e.toLowerCase()),
  name: z.string().trim().min(1).max(40).optional(),
  /** Phone mode: the 6-digit code shown on the computer running Orbit ("123 456" is fine). */
  phoneCode: z
    .string()
    .max(20)
    .transform((c) => c.replace(/\D/g, ''))
    .optional(),
});

function forbidden(code: string, message: string): HttpException {
  return new HttpException({ statusCode: HttpStatus.FORBIDDEN, code, message }, HttpStatus.FORBIDDEN);
}

const PERSON_COLORS = ['lilac', 'peach', 'sage', 'sky', 'butter', 'rose'] as const;

function colorFor(email: string): string {
  let hash = 0;
  for (const ch of email) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return PERSON_COLORS[hash % PERSON_COLORS.length]!;
}

function nameFrom(email: string): string {
  const local = email.split('@')[0] ?? 'Friend';
  const clean = local.replace(/[._-]+/g, ' ').trim();
  return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : 'Friend';
}

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(PRISMA) private readonly db: Db,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(PhoneAccess) private readonly phone: PhoneAccess,
  ) {}

  /**
   * Passwordless sign-in for local development only (Google/email sign-in
   * replaces it). Returns 404 unless AUTH_DEV_LOGIN=true outside production.
   * Only this computer may use it freely; in phone mode another device needs
   * the code this computer shows, otherwise it is refused.
   */
  @Public()
  @Post('dev-login')
  @HttpCode(200)
  async devLogin(@Req() req: Request, @Body(new ZodBody(devLoginInput)) body: z.infer<typeof devLoginInput>): Promise<AuthResultDTO> {
    if (!this.config.devLogin) throw new NotFoundException();
    if (!fromThisComputer(req)) {
      if (!this.phone.enabled) {
        throw forbidden('LOCAL_ONLY', 'Sign in on the computer running Orbit. To use a phone, start Orbit with `npm run dev:phone`.');
      }
      if (!this.phone.verify(body.phoneCode)) {
        throw forbidden(
          'PHONE_CODE',
          body.phoneCode
            ? 'That code doesn’t match. Check “On your phone” in Orbit on the computer running it.'
            : 'Enter the 6-digit code shown on the computer running Orbit.',
        );
      }
    }
    const user = await this.db.user.upsert({
      where: { email: body.email },
      update: {},
      create: { email: body.email, name: body.name ?? nameFrom(body.email), color: colorFor(body.email) },
    });
    const token = await signSessionToken({ userId: user.id, name: user.name }, this.config.authSecret);
    return { token, user: { id: user.id, name: user.name, email: user.email, color: user.color } };
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser): MeDTO {
    return user;
  }

  /** The phone link and code for "On your phone". Answers only on this computer. */
  @Public()
  @Get('phone')
  phoneAccess(@Req() req: Request): PhoneAccessDTO {
    if (!this.config.devLogin || !fromThisComputer(req)) throw new NotFoundException();
    if (!this.phone.enabled) return { enabled: false };
    return { enabled: true, urls: this.phone.urls(), code: this.phone.current() };
  }
}
