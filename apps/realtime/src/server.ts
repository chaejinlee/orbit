import { Forbidden, Unauthorized } from '@hocuspocus/common';
import { Database } from '@hocuspocus/extension-database';
import { Server, type Connection } from '@hocuspocus/server';
import { getPlanRole, verifySessionToken, type PrismaClient } from '@orbit/db';
import { can, parsePlanHint, type MemberRole } from '@orbit/shared';
import { planIdFromDocName } from '@orbit/shared/yboard';

export interface RealtimeContext {
  userId: string;
  planId: string;
  role: MemberRole;
  checkedAt: number;
}

export interface RealtimeOptions {
  prisma: PrismaClient;
  authSecret: string;
  port: number;
  /** Interface to listen on (default: this machine only). */
  address?: string;
  /** How stale a membership check may get while a socket stays open. */
  recheckMs?: number;
  /** Debounce (ms) before a changed document is written to Postgres. */
  debounce?: number;
  /** Most hints one connection may send per 10 seconds; extra ones are dropped. */
  hintLimit?: number;
}

const HINT_WINDOW_MS = 10_000;

function closeWith(event: { code: number; reason: string }, message: string): Error {
  return Object.assign(new Error(message), event);
}

/**
 * One Yjs document per plan (`plan:<id>`), holding the board layout and the
 * shared itinerary draft. Access mirrors the HTTP API exactly (same token,
 * same membership lookup, same permission matrix):
 *
 *  - connect: valid session + plan membership, otherwise the socket closes;
 *    roles without `board.edit` (viewers) get a read-only connection.
 *  - while open: membership is re-checked on incoming messages (at most every
 *    `recheckMs`). A removed member's next update is dropped and the socket is
 *    closed; a downgraded editor becomes read-only.
 *  - hints: any member, viewers included, may send a stateless "something
 *    changed" hint (comments, ideas, …; see @orbit/shared hints). The server
 *    re-encodes it with the sender's id and relays it to the plan's other
 *    connections. Hints carry no content, so relaying them is harmless.
 */
export function createRealtimeServer({
  prisma,
  authSecret,
  port,
  address = '127.0.0.1',
  recheckMs = 10_000,
  debounce = 2_000,
  hintLimit = 30,
}: RealtimeOptions) {
  const hintBudget = new WeakMap<Connection, { windowStart: number; count: number }>();
  const allowHint = (connection: Connection): boolean => {
    const now = Date.now();
    const budget = hintBudget.get(connection);
    if (!budget || now - budget.windowStart >= HINT_WINDOW_MS) {
      hintBudget.set(connection, { windowStart: now, count: 1 });
      return true;
    }
    budget.count += 1;
    return budget.count <= hintLimit;
  };

  return new Server<RealtimeContext>({
    port,
    address,
    quiet: true,
    debounce,

    async onAuthenticate({ token, documentName, connectionConfig }) {
      const planId = planIdFromDocName(documentName);
      if (!planId) throw closeWith(Forbidden, `Unknown document "${documentName}"`);
      const claims = await verifySessionToken(token, authSecret);
      if (!claims) throw closeWith(Unauthorized, 'Invalid session');
      const role = await getPlanRole(prisma, planId, claims.userId);
      if (!role) throw closeWith(Forbidden, 'Not a member of this plan');
      connectionConfig.readOnly = !can(role, 'board.edit');
      return { userId: claims.userId, planId, role, checkedAt: Date.now() } satisfies RealtimeContext;
    },

    async beforeHandleMessage({ context, connection }) {
      if (Date.now() - context.checkedAt < recheckMs) return;
      const role = await getPlanRole(prisma, context.planId, context.userId);
      context.checkedAt = Date.now();
      if (!role) throw closeWith(Forbidden, 'Membership revoked');
      context.role = role;
      connection.readOnly = !can(role, 'board.edit');
    },

    async onStateless({ connection, document, payload }) {
      const hint = parsePlanHint(payload);
      if (!hint || !allowHint(connection)) return;
      const { userId } = connection.context as RealtimeContext;
      document.broadcastStateless(JSON.stringify({ ...hint, by: userId }), (other) => other !== connection);
    },

    extensions: [
      new Database({
        fetch: async ({ documentName }) => {
          const planId = planIdFromDocName(documentName);
          if (!planId) return null;
          const row = await prisma.canvasDocument.findUnique({ where: { planId }, select: { state: true } });
          return row ? new Uint8Array(row.state) : null;
        },
        store: async ({ documentName, state }) => {
          const planId = planIdFromDocName(documentName);
          if (!planId) return;
          const bytes = new Uint8Array(state);
          await prisma.canvasDocument.upsert({
            where: { planId },
            create: { planId, state: bytes },
            update: { state: bytes },
          });
        },
      }),
    ],
  });
}
