import { jwtVerify, SignJWT } from 'jose';
import type { MemberRole } from '@orbit/shared';
import type { PrismaClient } from './generated/prisma/client';

// Session tokens and membership lookups shared by the HTTP API and the
// realtime server, so both enforce access exactly the same way.

const ISSUER = 'orbit';
const AUDIENCE = 'orbit-app';

export interface SessionClaims {
  userId: string;
  name: string;
}

function key(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signSessionToken(claims: SessionClaims, secret: string, ttl = '30d'): Promise<string> {
  return new SignJWT({ name: claims.name })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(key(secret));
}

/** Returns null for anything that is not a valid, unexpired Orbit token. */
export async function verifySessionToken(token: string, secret: string): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
    });
    if (typeof payload.sub !== 'string') return null;
    return { userId: payload.sub, name: typeof payload.name === 'string' ? payload.name : '' };
  } catch {
    return null;
  }
}

export async function getPlanRole(
  prisma: PrismaClient,
  planId: string,
  userId: string,
): Promise<MemberRole | null> {
  const member = await prisma.planMember.findUnique({
    where: { planId_userId: { planId, userId } },
    select: { role: true, plan: { select: { archivedAt: true } } },
  });
  return member && !member.plan.archivedAt ? member.role : null;
}
