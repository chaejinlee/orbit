import {
  BadRequestException,
  createParamDecorator,
  type ExecutionContext,
  HttpException,
  type HttpStatus,
  type PipeTransform,
} from '@nestjs/common';
import { Prisma } from '@orbit/db';
import type { z } from 'zod';
import type { AppRequest, AuthUser } from './tokens';

/** Validates a request body against a shared zod schema (the same one the browser uses). */
export class ZodBody<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: z.ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw new BadRequestException({
      statusCode: 400,
      code: 'VALIDATION_FAILED',
      message: result.error.issues[0]?.message ?? 'Invalid request.',
      issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const user = ctx.switchToHttp().getRequest<AppRequest>().user;
  if (!user) throw new Error('CurrentUser used on a route without authentication.');
  return user;
});

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export const personSelect = { id: true, name: true, color: true } as const;

/** An error the web app can act on: `code` is stable, `message` is shown to people. */
export function apiError(status: HttpStatus, code: string, message: string): HttpException {
  return new HttpException({ statusCode: status, code, message }, status);
}
