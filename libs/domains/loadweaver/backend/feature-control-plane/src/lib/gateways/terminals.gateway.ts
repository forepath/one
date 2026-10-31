import { StringDecoder } from 'node:string_decoder';

import { buildRequestFromSocketUser, SocketAuthService, type SocketUserInfo } from '@forepath/identity/backend';
import { FileStorageScope, FileStorageService } from '@forepath/shared/backend/util-file-storage';
import { resolveWebsocketCorsOrigin } from '@forepath/shared/shared/util-network-address';
import { Logger, OnModuleDestroy } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { InjectDataSource } from '@nestjs/typeorm';
import { Server, Socket } from 'socket.io';
import { DataSource } from 'typeorm';
import { z } from 'zod';

import { LiveAccessService, type LiveTarget } from '../live/live-access.service';
import { LiveBroker } from '../live/live-broker';
import { clientBacklog, MAX_CLIENT_BUFFERED_PACKETS, TokenBucket } from '../live/rate.utils';
import { AsciicastRecorder } from '../live/recording.utils';
import { actorFromRequest, AuditLogService } from '../services/audit-log.service';

const MAX_SESSIONS_PER_SOCKET = 10;
const MAX_SESSIONS_PER_USER = 20;
/** Typed and pasted input: 256 KiB/s, bursts of 1 MiB. */
const INPUT_RATE = 256 * 1024;
const INPUT_BURST = 1024 * 1024;
/** Open sessions are re-checked (access, heartbeat for crash cleanup) this often. */
const CHECK_MS = 60_000;
const IDLE_MS = 30 * 60_000;
const SESSION_ID = /^[A-Za-z0-9_-]{1,64}$/;

const createSchema = z
  .object({
    sessionId: z.string().regex(SESSION_ID).optional(),
    target: z.union([
      z
        .object({ replica: z.string().regex(/^[a-z0-9-]{1,63}\/[a-z0-9-]{1,63}\/[a-z0-9_.-]{1,63}\/\d{1,4}$/) })
        .strict(),
      z.object({ node: z.string().regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/) }).strict(),
    ]),
    shell: z
      .string()
      .regex(/^\/[A-Za-z0-9_./-]{1,64}$/)
      .optional(),
    cols: z.number().int().min(1).max(1000).default(80),
    rows: z.number().int().min(1).max(1000).default(24),
  })
  .strict();
const inputSchema = z.object({ sessionId: z.string().regex(SESSION_ID), data: z.string().max(64 * 1024) }).strict();
const resizeSchema = z
  .object({
    sessionId: z.string().regex(SESSION_ID),
    cols: z.number().int().min(1).max(1000),
    rows: z.number().int().min(1).max(1000),
  })
  .strict();
const closeSchema = z.object({ sessionId: z.string().regex(SESSION_ID) }).strict();

interface Session {
  sessionId: string;
  socket: Socket;
  channel: string;
  target: LiveTarget;
  /** Re-checked every minute: a removed role or a disabled host shell ends the session. */
  recheck: () => Promise<LiveTarget>;
  userId: string;
  dbId: string;
  input: TokenBucket;
  startedAt: number;
  decoder: StringDecoder;
  recorder: AsciicastRecorder | null;
  idle: NodeJS.Timeout;
  closed: boolean;
}

type TerminalSocket = Socket & { data: { userInfo?: SocketUserInfo } };

/**
 * Terminals (3.19) with Agenstra's events: `createTerminal` → `terminalCreated`, `terminalInput`, `terminalResize`,
 * `closeTerminal`, output as `terminalOutput` (UTF-8 text), `terminalClosed` with the exit code. The browser never
 * talks to a node: the session runs over the node's stream, wherever it is connected (LiveBroker). Every session is
 * audited and listed; recorded when the policy says so (a banner flag in `terminalCreated`).
 */
@WebSocketGateway({
  namespace: process.env.LOADWEAVER_TERMINALS_WEBSOCKET_NAMESPACE || 'socket/terminals',
  cors: { origin: resolveWebsocketCorsOrigin() },
})
export class TerminalsGateway implements OnGatewayInit, OnGatewayDisconnect, OnModuleDestroy {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(TerminalsGateway.name);
  private readonly sessions = new Map<string, Session>();
  private checks: NodeJS.Timeout | null = null;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly socketAuth: SocketAuthService,
    private readonly live: LiveBroker,
    private readonly liveAccess: LiveAccessService,
    private readonly audit: AuditLogService,
    private readonly files: FileStorageService,
  ) {}

  afterInit(server: Server): void {
    server.use(async (socket, next) => {
      const header = socket.handshake?.headers?.authorization ?? socket.handshake?.auth?.['Authorization'];
      const userInfo = await this.socketAuth.validateAndGetUser(typeof header === 'string' ? header : undefined);

      if (!userInfo) {
        next(new Error('Unauthorized'));

        return;
      }

      (socket as TerminalSocket).data = { userInfo };
      next();
    });
    this.checks = setInterval(() => void this.check(), CHECK_MS);
  }

  onModuleDestroy(): void {
    if (this.checks) clearInterval(this.checks);
  }

  /** Heartbeat for the open sessions (a crashed replica's are closed by the sweep), access re-checked. */
  private async check(): Promise<void> {
    const sessions = [...this.sessions.values()];

    if (sessions.length === 0) return;

    await this.dataSource
      .query(`UPDATE lw_terminal_sessions SET seen_at = now() WHERE id = ANY($1::uuid[])`, [
        sessions.map((s) => s.dbId),
      ])
      .catch((e: unknown) => this.logger.warn(`Terminal heartbeat: ${String(e)}`));

    for (const session of sessions) await session.recheck().catch(() => this.close(session, 'access revoked'));
  }

  private key(socket: Socket, sessionId: string): string {
    return `${socket.id}:${sessionId}`;
  }

  private fail(socket: Socket, sessionId: string | undefined, message: string): void {
    socket.emit('error', { ...(sessionId ? { sessionId } : {}), message });
  }

  @SubscribeMessage('createTerminal')
  async create(@MessageBody() body: unknown, @ConnectedSocket() socket: Socket): Promise<void> {
    const parsed = createSchema.safeParse(body ?? {});

    if (!parsed.success) return this.fail(socket, undefined, 'invalid payload');

    const dto = parsed.data;
    const sessionId = dto.sessionId ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

    if ([...this.sessions.values()].filter((s) => s.socket === socket).length >= MAX_SESSIONS_PER_SOCKET)
      return this.fail(socket, sessionId, 'too many terminals');

    if (this.sessions.has(this.key(socket, sessionId))) return this.fail(socket, sessionId, 'session exists');

    const req = buildRequestFromSocketUser((socket as TerminalSocket).data.userInfo as SocketUserInfo);
    const userId = String(actorFromRequest(req).id ?? actorFromRequest(req).type);

    if ([...this.sessions.values()].filter((s) => s.userId === userId).length >= MAX_SESSIONS_PER_USER)
      return this.fail(socket, sessionId, 'too many terminals');

    const ref = dto.target;
    const recheck = () =>
      'node' in ref ? this.liveAccess.nodeShell(req, ref.node) : this.liveAccess.replica(req, ref.replica, 'exec');
    let target: LiveTarget;

    try {
      target = await recheck();
    } catch (error) {
      return this.fail(socket, sessionId, error instanceof Error ? error.message : 'not allowed');
    }

    const recorded = await this.liveAccess.recorded(target);
    const actor = actorFromRequest(req);
    const startedAt = Date.now();
    const [row]: { id: string }[] = await this.dataSource.transaction(async (manager) => {
      const inserted = await manager.query(
        `INSERT INTO lw_terminal_sessions (user_id, project, target, node, recorded) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [actor.id ?? actor.type, target.project, target.target, target.node, recorded],
      );

      await this.audit.record(manager, {
        actor,
        action: 'terminal.open',
        target: target.target,
        project: target.project,
        details: { node: target.node, recorded, session: inserted[0].id },
      });

      return inserted;
    });
    const session: Session = {
      sessionId,
      socket,
      channel: '',
      target,
      recheck,
      userId,
      dbId: row.id,
      input: new TokenBucket(INPUT_RATE, INPUT_BURST),
      startedAt,
      decoder: new StringDecoder('utf8'),
      recorder: recorded ? new AsciicastRecorder(startedAt, dto.cols, dto.rows, target.target) : null,
      idle: setTimeout(() => void this.close(session, 'idle'), IDLE_MS),
      closed: false,
    };

    session.channel = this.live.openChannel((type, payload) => {
      if (type === 'execOutput') {
        const text = session.decoder.write(Buffer.from(String(payload['data'] ?? ''), 'base64'));

        session.recorder?.output(text);

        // socket.io has no backpressure: a client that doesn't read ends its session instead of filling memory.
        if (clientBacklog(socket) > MAX_CLIENT_BUFFERED_PACKETS) return void this.close(session, 'client too slow');

        socket.emit('terminalOutput', { sessionId, data: text });
      } else if (type === 'execExit') {
        void this.finish(session, (payload['code'] as number | null) ?? null, payload['error'] as string | undefined);
      }
    });
    this.sessions.set(this.key(socket, sessionId), session);

    try {
      await this.live.send(target.node, session.channel, 'execOpen', {
        target: 'node' in dto.target ? { kind: 'node' } : { kind: 'replica', replica: dto.target.replica },
        ...(dto.shell ? { command: [dto.shell] } : {}),
        cols: dto.cols,
        rows: dto.rows,
      });
      socket.emit('terminalCreated', { sessionId, recorded });
    } catch (error) {
      await this.finish(session, null, error instanceof Error ? error.message : 'node not reachable');
    }
  }

  /** Only input keeps a session from idling out (a chatty process doesn't). */
  private touch(session: Session): void {
    session.idle.refresh();
  }

  @SubscribeMessage('terminalInput')
  async input(@MessageBody() body: unknown, @ConnectedSocket() socket: Socket): Promise<void> {
    const parsed = inputSchema.safeParse(body);
    const session = parsed.success ? this.sessions.get(this.key(socket, parsed.data.sessionId)) : undefined;

    if (!parsed.success || !session)
      return this.fail(socket, parsed.success ? parsed.data.sessionId : undefined, 'unknown session');

    if (!session.input.take(Buffer.byteLength(parsed.data.data)))
      return this.fail(socket, parsed.data.sessionId, 'input rate limit exceeded');

    this.touch(session);
    await this.live
      .send(session.target.node, session.channel, 'execInput', {
        data: Buffer.from(parsed.data.data, 'utf8').toString('base64'),
      })
      .catch(() => undefined);
  }

  @SubscribeMessage('terminalResize')
  async resize(@MessageBody() body: unknown, @ConnectedSocket() socket: Socket): Promise<void> {
    const parsed = resizeSchema.safeParse(body);
    const session = parsed.success ? this.sessions.get(this.key(socket, parsed.data.sessionId)) : undefined;

    if (!parsed.success || !session)
      return this.fail(socket, parsed.success ? parsed.data.sessionId : undefined, 'unknown session');

    session.recorder?.resize(parsed.data.cols, parsed.data.rows);
    await this.live
      .send(session.target.node, session.channel, 'execResize', { cols: parsed.data.cols, rows: parsed.data.rows })
      .catch(() => undefined);
  }

  @SubscribeMessage('closeTerminal')
  async closeTerminal(@MessageBody() body: unknown, @ConnectedSocket() socket: Socket): Promise<void> {
    const parsed = closeSchema.safeParse(body);
    const session = parsed.success ? this.sessions.get(this.key(socket, parsed.data.sessionId)) : undefined;

    if (session) await this.close(session, 'closed');
  }

  handleDisconnect(socket: Socket): void {
    for (const session of [...this.sessions.values()].filter((s) => s.socket === socket))
      void this.close(session, 'disconnected');
  }

  /** Asks the node to end the session; `execExit` finishes it (or the timeout does). */
  private async close(session: Session, reason: string): Promise<void> {
    if (session.closed) return;

    await this.live.send(session.target.node, session.channel, 'execClose', {}).catch(() => undefined);
    // A node that doesn't answer doesn't keep the session open.
    setTimeout(() => void this.finish(session, null, reason), 5_000).unref();
  }

  private async finish(session: Session, code: number | null, error?: string): Promise<void> {
    if (session.closed) return;

    session.closed = true;
    clearTimeout(session.idle);
    this.sessions.delete(this.key(session.socket, session.sessionId));
    this.live.closeChannel(session.channel);
    session.socket.emit('terminalClosed', {
      sessionId: session.sessionId,
      exitCode: code,
      ...(error ? { error } : {}),
    });

    let recordingKey: string | null = null;

    if (session.recorder) {
      const at = new Date(session.startedAt);

      recordingKey = `${at.getUTCFullYear()}/${String(at.getUTCMonth() + 1).padStart(2, '0')}/${session.dbId}.cast`;

      try {
        await this.files.writeFile(FileStorageScope.loadweaverRecordings, recordingKey, session.recorder.take());
      } catch (e) {
        this.logger.warn(`Recording ${session.dbId} not stored: ${String(e)}`);
        recordingKey = null;
      } finally {
        session.recorder.dispose();
      }
    }

    await this.dataSource
      .transaction(async (manager) => {
        await manager.query(
          `UPDATE lw_terminal_sessions SET ended_at = now(), exit_code = $2, recording_key = $3 WHERE id = $1`,
          [session.dbId, code, recordingKey],
        );
        await this.audit.record(manager, {
          actor: actorFromRequest(
            buildRequestFromSocketUser((session.socket as TerminalSocket).data.userInfo as SocketUserInfo),
          ),
          action: 'terminal.close',
          target: session.target.target,
          project: session.target.project,
          details: {
            session: session.dbId,
            exitCode: code,
            seconds: Math.round((Date.now() - session.startedAt) / 1000),
            ...(error ? { error: error.slice(0, 200) } : {}),
          },
        });
      })
      .catch((e: unknown) => this.logger.warn(`Terminal session ${session.dbId} not recorded: ${String(e)}`));
  }
}
