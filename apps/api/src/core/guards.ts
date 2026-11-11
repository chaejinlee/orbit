import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { getPlanRole, verifySessionToken } from '@orbit/db';
import { can, type Permission } from '@orbit/shared';
import { CONFIG, PRISMA, type AppRequest, type Config, type Db } from './tokens';

const IS_PUBLIC = 'orbit:public';
const PERMISSION = 'orbit:permission';

/** Opt a route out of authentication. Everything else requires a session. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** The permission a plan-scoped route needs (see @orbit/shared permissions). */
export const RequirePermission = (permission: Permission) => SetMetadata(PERMISSION, permission);

/**
 * Global: every request carries a valid bearer token for an existing user.
 * Public routes skip the requirement but still learn who's asking when a valid
 * token comes along (the invite preview says "you're already in this plan").
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(PRISMA) private readonly db: Db,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const header = req.headers.authorization ?? '';
    if (isPublic && !header) return true;
    const claims = await verifySessionToken(header.startsWith('Bearer ') ? header.slice(7) : '', this.config.authSecret);
    const user = claims
      ? await this.db.user.findUnique({ where: { id: claims.userId }, select: { id: true, name: true, email: true, color: true } })
      : null;
    if (user) req.user = user;
    if (isPublic) return true;
    if (!user) throw new UnauthorizedException('Please sign in again.');
    return true;
  }
}

/**
 * For routes under /plans/:planId. Fails closed: a route without
 * @RequirePermission is a server error, never an open door. Non-members get
 * 404 so plan ids can't be probed; members without the permission get 403.
 */
@Injectable()
export class PlanAccessGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(PRISMA) private readonly db: Db,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const permission = this.reflector.getAllAndOverride<Permission | undefined>(PERMISSION, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!permission) throw new InternalServerErrorException('Route is missing @RequirePermission.');

    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const planId = req.params.planId;
    if (!req.user || typeof planId !== 'string') throw new NotFoundException('Plan not found.');

    const role = await getPlanRole(this.db, planId, req.user.id);
    if (!role) throw new NotFoundException('Plan not found.');
    if (!can(role, permission)) {
      throw new ForbiddenException(`As a ${role.toLowerCase()}, you can’t do that in this plan.`);
    }
    req.planRole = role;
    return true;
  }
}
