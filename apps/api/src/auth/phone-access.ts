import { Inject, Injectable, Logger } from '@nestjs/common';
import { lanAddresses } from '@orbit/db';
import { hostnameOfHost, isLoopbackAddress, isLoopbackHostname } from '@orbit/shared';
import type { Request } from 'express';
import { randomInt, timingSafeEqual } from 'node:crypto';
import { CONFIG, type Config } from '../core/tokens';

/** Wrong codes before the code is replaced. Ten guesses at a 6-digit code: 1 in 100,000. */
export const MAX_PHONE_CODE_MISSES = 10;

/**
 * A request made on the computer running Orbit: it comes from a loopback
 * address and is addressed to a loopback host. Checking the Host header too
 * means a web page that points its own domain at 127.0.0.1 (DNS rebinding)
 * doesn't count as this computer.
 */
export function fromThisComputer(req: Pick<Request, 'headers' | 'socket'>): boolean {
  const host = hostnameOfHost(req.headers.host);
  return isLoopbackAddress(req.socket.remoteAddress) && host != null && isLoopbackHostname(host);
}

function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * Phone mode (BIND_HOST=0.0.0.0, `npm run dev:phone`). The dev sign-in has no
 * password, so any device other than this computer must also send the 6-digit
 * code this computer shows. The code only lives in memory: a new one on every
 * start, and a new one after too many wrong guesses. Phones that already
 * signed in keep their session either way.
 */
@Injectable()
export class PhoneAccess {
  private readonly log = new Logger('Phone');
  private code = newCode();
  private misses = 0;

  constructor(@Inject(CONFIG) private readonly config: Config) {}

  get enabled(): boolean {
    return this.config.lanMode && this.config.devLogin;
  }

  current(): string {
    return this.code;
  }

  /** Where a phone on the same network opens Orbit, most likely first. */
  urls(): string[] {
    return lanAddresses().map((ip) => `http://${ip}:${this.config.webPort}`);
  }

  /** True when `attempt` is the current code. An empty attempt isn't a guess. */
  verify(attempt: string | undefined): boolean {
    if (!attempt) return false;
    if (attempt.length === this.code.length && timingSafeEqual(Buffer.from(attempt), Buffer.from(this.code))) return true;
    this.misses += 1;
    if (this.misses >= MAX_PHONE_CODE_MISSES) {
      this.code = newCode();
      this.misses = 0;
      this.log.warn(`${MAX_PHONE_CODE_MISSES} wrong phone codes, so the code changed. New code: ${this.code}`);
    }
    return false;
  }
}
