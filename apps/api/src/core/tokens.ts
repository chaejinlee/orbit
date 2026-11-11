import type { PrismaClient, ServerEnv } from '@orbit/db';
import type { MemberRole } from '@orbit/shared';
import type { Request } from 'express';

/** DI tokens. Injection is always explicit (no emitDecoratorMetadata). */
export const PRISMA = Symbol('PRISMA');
export const CONFIG = Symbol('CONFIG');

export type Db = PrismaClient;
export type Config = ServerEnv;

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  color: string;
}

export interface AppRequest extends Request {
  user?: AuthUser;
  planRole?: MemberRole;
}
