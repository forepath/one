import {
  buildRequestFromSocketUser,
  getAuthenticationMethod,
  PatBearerAuthGuard,
  SocketAuthService,
  UsersAuthGuard,
  type RequestWithUser,
} from '@forepath/identity/backend';
import { LIVE_CHUNK_BYTES } from '@forepath/loadweaver/shared/util-agent-protocol';
import { resolveWebsocketCorsOrigin } from '@forepath/shared/shared/util-network-address';
import { Logger, OnModuleDestroy, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { DataSource } from 'typeorm';
import { z } from 'zod';

import { LiveAccessService, type LiveTarget } from '../live/live-access.service';
import { LiveBroker } from '../live/live-broker';
import { clientBacklog, MAX_CLIENT_BUFFERED_PACKETS, TokenBucket } from '../live/rate.utils';
import { actorFromRequest, AuditLogService } from '../services/audit-log.service';

/** The PAT scope of this channel (3.17): machine credentials may exec here and nowhere else live. */
export const LIVE_EXEC_SCOPE = 'live:exec';
/** The agent-protocol feature a node needs for machine exec. */
export const EXEC_STDIO_FEATURE = 'exec-stdio';

const MAX_SESSIONS_PER_SOCKET = 128;
const MAX_SESSIONS_PER_USER = 256;
/** New sessions per user: 20 per second, bursts of 200 (an agent manager listing a file tree). */
const START_RATE = 20;
const START_BURST = 200;
/** Stdin per session: 8 MiB/s, bursts of 32 MiB. */
const STDIN_RATE = 8 * 1024 * 1024;
const STDIN_BURST = 32 * 1024 * 1024;
/** Open sessions are re-checked (access) this often; the longest a session may run. */
const CHECK_MS = 60_000;
const MAX_SESSION_MS = 24 * 3_600_000;
/** A node that doesn't confirm the end of a session within this time doesn't keep it open. */
const CLOSE_WAIT_MS = 5_000;
const EXEC_ID = /^[A-Za-z0-9_-]{1,64}$/;

const binary = z.custom<Uint8Array>((v) => v instanceof Uint8Array || v instanceof ArrayBuffer, 'binary data expected');

const execSchema = z
  .object({
    execId: z.string().regex(EXEC_ID),
    replica: z.string().regex(/^[a-z0-9-]{1,63}\/[a-z0-9-]{1,63}\/[a-z0-9_.-]{1,63}\/\d{1,4}$/),
    command: z.array(z.string().max(32768)).min(1).max(256),
    user: z
      .string()
      .regex(/^[A-Za-z0-9_.-]{1,32}(:[A-Za-z0-9_.-]{1,32})?$/)
      .optional(),
    workingDir: z
      .string()
      .max(4096)
      .regex(/^\/[^\0]*$/)
      .optional(),
    env: z
      .array(
        z
          .string()
          .max(32768)
          .regex(/^[A-Za-z_][A-Za-z0-9_.-]*=[^\0]*$/),
      )
      .max(256)
      .optional(),
  })
  .strict();
const stdinSchema = z
  .object({ execId: z.string().regex(EXEC_ID), data: binary.optional(), eof: z.boolean().optional() })
  .strict();
const killSchema = z.object({ execId: z.string().regex(EXEC_ID) }).strict();

interface ExecSession {
  execId: string;
  socket: Socket;
  channel: string;
  target: LiveTarget;
  req: RequestWithUser;
  userId: string;
  command: string;
  stdin: TokenBucket;
  startedAt: number;
  bytes: { stdin: number; stdout: number; stderr: number };
  /** Messages towards the node, in order (sends are async). */
  queue: Promise<void>;
  deadline: NodeJS.Timeout;
  /** `execClose` was sent (once). */
  closing: boolean;
  closed: boolean;
}

type ExecSocket = Socket & {
  data: {
    req?: RequestWithUser;
    /** The handshake's credentials, re-validated before every `exec` and every minute (M6 review M4). */
    header?: string;
    /** Disconnects the socket when the token expires. */
    expiry?: NodeJS.Timeout;
  };
};

/** Largest delay `setTimeout` takes (longer-lived tokens are caught by the minute check). */
const MAX_TIMER_MS = 2 ** 31 - 1;

/** `exp` of a JWT bearer token in ms (not verified here: the guards did that); null for other credentials. */
export function bearerExpiresAt(header: string): number | null {
  const token = header.replace(/^Bearer\s+/i, '');
  const parts = token.split('.');

  if (parts.length !== 3) return null;

  try {
    const exp = (JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { exp?: unknown }).exp;

    return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/** A minimal HTTP execution context so the HTTP auth guards validate the handshake's bearer token. */
function handshakeContext(req: object, handler: () => void, cls: object): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}), getNext: () => undefined }),
    getHandler: () => handler,
    getClass: () => cls,
    getType: () => 'http',
    getArgs: () => [req],
    getArgByIndex: () => req,
    switchToRpc: () => {
      throw new Error('not rpc');
    },
    switchToWs: () => {
      throw new Error('not ws');
    },
  } as unknown as ExecutionContext;
}

/**
 * Machine exec (3.19, Agenstra on Loadweaver): non-interactive commands in a replica for machine credentials, e.g.
 * Agenstra's agent manager. Unlike the terminal namespace, this one accepts personal access tokens, but only with
 * the `live:exec` scope; interactive sessions and the static API key work too. Operators and admins of the replica's
 * project only.
 *
 * Events: `exec` { execId, replica, command[], user?, workingDir?, env? } → `started`; `stdin` { execId, data?
 * (binary), eof? }; `kill`; output as `stdout` / `stderr` { execId, data (binary) }; `exit` { execId, exitCode,
 * error? }; failures as `error` { execId?, message }. Binary-safe end to end, no TTY, no resize. Rate-limited (session
 * starts per user, stdin bytes per session), bounded (sessions per socket / user, 24 h), access re-checked every
 * minute, and every session is in the audit log (`exec.run`: node, program, exit code, duration, bytes).
 */
@WebSocketGateway({
  namespace: process.env.LOADWEAVER_EXEC_WEBSOCKET_NAMESPACE || 'socket/exec',
  cors: { origin: resolveWebsocketCorsOrigin() },
  // Up to one stdin chunk of LIVE_CHUNK_BYTES plus framing.
  maxHttpBufferSize: 2 * LIVE_CHUNK_BYTES,
})
export class ExecGateway implements OnGatewayInit, OnGatewayDisconnect, OnModuleDestroy {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(ExecGateway.name);
  private readonly sessions = new Map<string, ExecSession>();
  private readonly starts = new Map<string, TokenBucket>();
  private checks: NodeJS.Timeout | null = null;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly socketAuth: SocketAuthService,
    private readonly live: LiveBroker,
    private readonly liveAccess: LiveAccessService,
    private readonly audit: AuditLogService,
    private readonly moduleRef: ModuleRef,
  ) {}

  afterInit(server: Server): void {
    server.use(async (socket, next) => {
      try {
        const header = socket.handshake?.headers?.authorization ?? socket.handshake?.auth?.['Authorization'];
        const credentials = typeof header === 'string' ? header : undefined;
        const req = await this.authenticate(credentials);

        if (!req || !credentials) return next(new Error('Unauthorized'));

        const expiresAt = bearerExpiresAt(credentials);

        if (expiresAt !== null && expiresAt <= Date.now()) return next(new Error('Unauthorized'));

        (socket as ExecSocket).data = {
          req,
          header: credentials,
          // The socket lives no longer than its token (M6 review M4).
          ...(expiresAt !== null
            ? {
                expiry: setTimeout(
                  () => void this.revoke(socket, 'token expired'),
                  Math.min(expiresAt - Date.now(), MAX_TIMER_MS),
                ),
              }
            : {}),
        };
        next();
      } catch {
        next(new Error('Unauthorized'));
      }
    });
    this.checks = setInterval(() => void this.check(), CHECK_MS);
  }

  onModuleDestroy(): void {
    if (this.checks) clearInterval(this.checks);
  }

  /**
   * The handshake's credentials, validated like an HTTP request: PATs (users / keycloak mode) by the same guards as
   * the API (revocation, expiry, scope changes and demotion take effect immediately) and only with `live:exec`;
   * otherwise the socket handshake of the other namespaces (interactive sessions, the static API key).
   */
  async authenticate(header: string | undefined): Promise<RequestWithUser | null> {
    if (!header) return null;

    const method = getAuthenticationMethod();

    if (method === 'users' || method === 'keycloak') {
      const guard = this.moduleRef.get<CanActivate>(method === 'users' ? UsersAuthGuard : PatBearerAuthGuard, {
        strict: false,
      });
      const req = {
        headers: { authorization: header },
        url: '/socket/exec',
        originalUrl: '/socket/exec',
      } as unknown as RequestWithUser;

      await guard.canActivate(handshakeContext(req, () => undefined, ExecGateway));

      if (req.user?.amr?.includes('pat')) return req.user.scopes?.includes(LIVE_EXEC_SCOPE) ? req : null;

      if (req.user) return req;
    }

    const info = await this.socketAuth.validateAndGetUser(header);

    return info ? buildRequestFromSocketUser(info) : null;
  }

  private key(socket: Socket, execId: string): string {
    return `${socket.id}:${execId}`;
  }

  private fail(socket: Socket, execId: string | undefined, message: string): void {
    socket.emit('error', { ...(execId ? { execId } : {}), message });
  }

  /**
   * Re-validates the socket's handshake credentials like a new HTTP request (revocation, expiry, scope changes, PAT
   * `live:exec`): on success the fresh identity replaces the handshake's (also for the socket's sessions), otherwise
   * the socket's sessions end and the socket is disconnected (M6 review M4).
   */
  async revalidate(socket: Socket): Promise<RequestWithUser | null> {
    const data = (socket as ExecSocket).data ?? {};
    const header = data.header;
    const expiresAt = header ? bearerExpiresAt(header) : null;
    const req =
      header && (expiresAt === null || expiresAt > Date.now())
        ? await this.authenticate(header).catch(() => null)
        : null;

    if (!req) {
      await this.revoke(socket, 'credentials no longer valid');

      return null;
    }

    data.req = req;

    for (const session of this.sessions.values()) if (session.socket === socket) session.req = req;

    return req;
  }

  /** Ends the socket's sessions and disconnects it. */
  private async revoke(socket: Socket, reason: string): Promise<void> {
    const data = (socket as ExecSocket).data;

    if (data?.expiry) clearTimeout(data.expiry);

    await Promise.all([...this.sessions.values()].filter((s) => s.socket === socket).map((s) => this.close(s, reason)));
    this.fail(socket, undefined, reason);
    socket.disconnect?.(true);
  }

  /** Credentials and access re-checked for open sessions: a revoked / expired token or a removed role ends them. */
  private async check(): Promise<void> {
    // Start buckets of users without sessions are refilled by now (a minute at 20/s): forget them.
    const active = new Set([...this.sessions.values()].map((s) => s.userId));

    for (const user of [...this.starts.keys()]) if (!active.has(user)) this.starts.delete(user);

    for (const socket of new Set([...this.sessions.values()].map((s) => s.socket))) await this.revalidate(socket);

    for (const session of [...this.sessions.values()].filter((s) => !s.closing))
      await this.liveAccess
        .replica(session.req, session.target.target.slice('replica/'.length), 'machine-exec')
        .catch(() => this.close(session, 'access revoked'));
  }

  @SubscribeMessage('exec')
  async exec(@MessageBody() body: unknown, @ConnectedSocket() socket: Socket): Promise<void> {
    const parsed = execSchema.safeParse(body ?? {});

    if (!parsed.success) return this.fail(socket, undefined, 'invalid payload');

    const dto = parsed.data;
    // Never the handshake's identity as is: the token may have been revoked or expired since (M6 review M4).
    const req = await this.revalidate(socket);

    if (!req) return;
    const actor = actorFromRequest(req);
    const userId = String(actor.id ?? actor.type);

    if (this.sessions.has(this.key(socket, dto.execId))) return this.fail(socket, dto.execId, 'session exists');

    const all = [...this.sessions.values()];

    if (all.filter((s) => s.socket === socket).length >= MAX_SESSIONS_PER_SOCKET)
      return this.fail(socket, dto.execId, 'too many sessions');

    if (all.filter((s) => s.userId === userId).length >= MAX_SESSIONS_PER_USER)
      return this.fail(socket, dto.execId, 'too many sessions');

    let bucket = this.starts.get(userId);

    if (!bucket) {
      bucket = new TokenBucket(START_RATE, START_BURST);
      this.starts.set(userId, bucket);
    }

    if (!bucket.take(1)) return this.fail(socket, dto.execId, 'rate limit exceeded');

    let target: LiveTarget;

    try {
      target = await this.liveAccess.replica(req, dto.replica, 'machine-exec');
    } catch (error) {
      return this.fail(socket, dto.execId, error instanceof Error ? error.message : 'not allowed');
    }

    const [node]: { protocol_features: string[] | null }[] = await this.dataSource.query(
      `SELECT protocol_features FROM lw_nodes WHERE name = $1`,
      [target.node],
    );

    if (!(node?.protocol_features ?? []).includes(EXEC_STDIO_FEATURE))
      return this.fail(socket, dto.execId, `the agent on node ${target.node} does not support machine exec`);

    const session: ExecSession = {
      execId: dto.execId,
      socket,
      channel: '',
      target,
      req,
      userId,
      // The program only: arguments may carry secrets.
      command: (dto.command[0].split('/').at(-1) ?? '').slice(0, 64),
      stdin: new TokenBucket(STDIN_RATE, STDIN_BURST),
      startedAt: Date.now(),
      bytes: { stdin: 0, stdout: 0, stderr: 0 },
      queue: Promise.resolve(),
      deadline: setTimeout(() => void this.close(session, 'session time limit reached'), MAX_SESSION_MS),
      closing: false,
      closed: false,
    };

    session.channel = this.live.openChannel((type, payload) => {
      if (type === 'execOutput') {
        const data = Buffer.from(String(payload['data'] ?? ''), 'base64');
        const stream = payload['stream'] === 'stderr' ? 'stderr' : 'stdout';

        session.bytes[stream] += data.length;

        // socket.io has no backpressure: a client that doesn't read ends its session instead of filling memory.
        if (clientBacklog(socket) > MAX_CLIENT_BUFFERED_PACKETS) return void this.close(session, 'client too slow');

        socket.emit(stream, { execId: session.execId, data });
      } else if (type === 'execExit') {
        void this.finish(session, (payload['code'] as number | null) ?? null, payload['error'] as string | undefined);
      }
    });
    this.sessions.set(this.key(socket, dto.execId), session);

    try {
      await this.send(session, 'execOpen', {
        target: { kind: 'replica', replica: dto.replica },
        command: dto.command,
        cols: 80,
        rows: 24,
        tty: false,
        ...(dto.user ? { user: dto.user } : {}),
        ...(dto.workingDir ? { workingDir: dto.workingDir } : {}),
        ...(dto.env?.length ? { env: dto.env } : {}),
      });
      socket.emit('started', { execId: dto.execId });
    } catch (error) {
      await this.finish(session, null, error instanceof Error ? error.message : 'node not reachable');
    }
  }

  /** Sends towards the node in order (stdin chunks must not overtake each other). */
  private send(
    session: ExecSession,
    type: 'execOpen' | 'execInput' | 'execClose',
    payload: Record<string, unknown>,
  ): Promise<void> {
    const sent = session.queue.then(() => this.live.send(session.target.node, session.channel, type, payload));

    session.queue = sent.catch(() => undefined);

    return sent;
  }

  @SubscribeMessage('stdin')
  async stdin(@MessageBody() body: unknown, @ConnectedSocket() socket: Socket): Promise<void> {
    const parsed = stdinSchema.safeParse(body);
    const session = parsed.success ? this.sessions.get(this.key(socket, parsed.data.execId)) : undefined;

    if (!parsed.success || !session)
      return this.fail(socket, parsed.success ? parsed.data.execId : undefined, 'unknown session');

    const raw = parsed.data.data;
    const data = raw ? Buffer.from(raw instanceof ArrayBuffer ? new Uint8Array(raw) : raw) : Buffer.alloc(0);

    if (data.length > 0 && !session.stdin.take(data.length))
      return this.fail(socket, session.execId, 'stdin rate limit exceeded');

    session.bytes.stdin += data.length;

    for (let i = 0; i < data.length || (i === 0 && parsed.data.eof); i += LIVE_CHUNK_BYTES) {
      const last = i + LIVE_CHUNK_BYTES >= data.length;

      await this.send(session, 'execInput', {
        data: data.subarray(i, i + LIVE_CHUNK_BYTES).toString('base64'),
        ...(last && parsed.data.eof ? { eof: true } : {}),
      }).catch(() => undefined);
    }
  }

  @SubscribeMessage('kill')
  async kill(@MessageBody() body: unknown, @ConnectedSocket() socket: Socket): Promise<void> {
    const parsed = killSchema.safeParse(body);
    const session = parsed.success ? this.sessions.get(this.key(socket, parsed.data.execId)) : undefined;

    if (session) await this.close(session, 'killed');
  }

  handleDisconnect(socket: Socket): void {
    const expiry = (socket as ExecSocket).data?.expiry;

    if (expiry) clearTimeout(expiry);

    for (const session of [...this.sessions.values()].filter((s) => s.socket === socket))
      void this.close(session, 'disconnected');
  }

  /** Asks the node to end the session; `execExit` finishes it (or the timeout does). */
  private async close(session: ExecSession, reason: string): Promise<void> {
    if (session.closed || session.closing) return;

    session.closing = true;

    await this.send(session, 'execClose', {}).catch(() => undefined);
    setTimeout(() => void this.finish(session, null, reason), CLOSE_WAIT_MS).unref();
  }

  private async finish(session: ExecSession, code: number | null, error?: string): Promise<void> {
    if (session.closed) return;

    session.closed = true;
    clearTimeout(session.deadline);
    this.sessions.delete(this.key(session.socket, session.execId));
    this.live.closeChannel(session.channel);
    session.socket.emit('exit', { execId: session.execId, exitCode: code, ...(error ? { error } : {}) });

    await this.audit
      .recordStandalone({
        actor: actorFromRequest(session.req),
        action: 'exec.run',
        target: session.target.target,
        project: session.target.project,
        details: {
          node: session.target.node,
          command: session.command,
          exitCode: code,
          seconds: Math.round((Date.now() - session.startedAt) / 1000),
          ...session.bytes,
          ...(error ? { error: error.slice(0, 200) } : {}),
        },
      })
      .catch((e: unknown) => this.logger.warn(`Exec session not audited: ${String(e)}`));
  }
}
