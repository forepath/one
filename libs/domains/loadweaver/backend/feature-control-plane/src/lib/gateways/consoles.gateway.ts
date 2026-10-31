import { StringDecoder } from 'node:string_decoder';

import { buildRequestFromSocketUser, SocketAuthService, type SocketUserInfo } from '@forepath/identity/backend';
import { LIVE_CHUNK_BYTES } from '@forepath/loadweaver/shared/util-agent-protocol';
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

/** The agent-protocol feature a node needs for VM consoles (3.35). */
export const VM_CONSOLES_FEATURE = 'vm-consoles';
export type ConsoleKind = 'serial' | 'vnc';

const MAX_SESSIONS_PER_SOCKET = 4;
const MAX_SESSIONS_PER_USER = 8;
/** New consoles per user: one per second, bursts of 5 (a page opening serial + VNC, a reconnect). */
const OPEN_RATE = 1;
const OPEN_BURST = 5;
/** Typed and pasted serial input: 256 KiB/s, bursts of 1 MiB (as terminals). */
const SERIAL_INPUT_RATE = 256 * 1024;
const SERIAL_INPUT_BURST = 1024 * 1024;
/** VNC client → server (keys, pointer, update requests, clipboard): 2 MiB/s, bursts of 8 MiB. */
const VNC_INPUT_RATE = 2 * 1024 * 1024;
const VNC_INPUT_BURST = 8 * 1024 * 1024;
/** Open sessions are re-checked (access, heartbeat for crash cleanup) this often. */
const CHECK_MS = 60_000;
/** Without input for this long a console is closed (noVNC sends update requests while it is shown). */
const IDLE_MS = 30 * 60_000;
const CLOSE_WAIT_MS = 5_000;
const SESSION_ID = /^[A-Za-z0-9_-]{1,64}$/;
const VM_REPLICA = /^[a-z0-9-]{1,63}\/lw-vm\/[a-z0-9_.-]{1,63}\/0$/;

const binary = z.custom<Uint8Array>((v) => v instanceof Uint8Array || v instanceof ArrayBuffer, 'binary data expected');

const openSchema = z
  .object({
    sessionId: z.string().regex(SESSION_ID).optional(),
    /** The VM's replica, `<project>/lw-vm/<name>/0`. */
    replica: z.string().regex(VM_REPLICA),
    kind: z.enum(['serial', 'vnc']),
    cols: z.number().int().min(1).max(1000).default(80),
    rows: z.number().int().min(1).max(1000).default(24),
  })
  .strict();
/** Serial: UTF-8 text (as terminals); VNC: binary RFB. */
const inputSchema = z
  .object({
    sessionId: z.string().regex(SESSION_ID),
    data: z.union([z.string().max(64 * 1024), binary]),
  })
  .strict();
const resizeSchema = z
  .object({
    sessionId: z.string().regex(SESSION_ID),
    cols: z.number().int().min(1).max(1000),
    rows: z.number().int().min(1).max(1000),
  })
  .strict();
const closeSchema = z.object({ sessionId: z.string().regex(SESSION_ID) }).strict();

interface ConsoleSession {
  sessionId: string;
  kind: ConsoleKind;
  socket: Socket;
  channel: string;
  target: LiveTarget;
  /** `<project>/<name>` of the VM. */
  vm: string;
  replica: string;
  recheck: () => Promise<LiveTarget>;
  userId: string;
  dbId: string;
  input: TokenBucket;
  startedAt: number;
  decoder: StringDecoder;
  recorder: AsciicastRecorder | null;
  bytes: { in: number; out: number };
  /** Messages towards the node, in order (sends are async). */
  queue: Promise<void>;
  idle: NodeJS.Timeout;
  closing: boolean;
  closed: boolean;
}

type ConsoleSocket = Socket & { data: { userInfo?: SocketUserInfo } };

const toBuffer = (data: Uint8Array | ArrayBuffer): Buffer =>
  data instanceof ArrayBuffer ? Buffer.from(data) : Buffer.from(data.buffer, data.byteOffset, data.byteLength);

/**
 * VM consoles (3.35) over the audited live path: the serial console in the browser terminal and the graphical
 * console for noVNC. The browser never talks to a node: `consoleOpen` and the exec data messages run over the node's
 * stream wherever it is connected (LiveBroker). Roles as terminals: the VM project's operators and admins, developers
 * when the project allows exec. Every session is audited (`vm.console.open` / `vm.console.close`) and listed with the
 * terminal sessions (target `virtual-machine/<project>/<name>/console/<kind>`); serial consoles are recorded like
 * terminals when the policy says so, VNC sessions record their metadata and duration only (no RFB recording).
 *
 * Events (namespace `socket/consoles`, handshake `Authorization` as for terminals):
 * - `openConsole` { sessionId?, replica: `<p>/lw-vm/<name>/0`, kind: 'serial' | 'vnc', cols?, rows? } →
 *   `consoleOpened` { sessionId, kind, recorded };
 * - `consoleInput` { sessionId, data }: serial UTF-8 text, VNC binary RFB (ArrayBuffer / Uint8Array);
 * - `consoleResize` { sessionId, cols, rows } (serial; the guest owns the line, only the recording follows);
 * - `closeConsole` { sessionId };
 * - output `consoleOutput` { sessionId, data }: serial text (the VM's boot log first), VNC binary RFB;
 * - `consoleClosed` { sessionId, exitCode, error? }; failures `error` { sessionId?, message }.
 */
@WebSocketGateway({
  namespace: process.env.LOADWEAVER_CONSOLES_WEBSOCKET_NAMESPACE || 'socket/consoles',
  cors: { origin: resolveWebsocketCorsOrigin() },
  // Up to one input chunk of LIVE_CHUNK_BYTES plus framing.
  maxHttpBufferSize: 2 * LIVE_CHUNK_BYTES,
})
export class ConsolesGateway implements OnGatewayInit, OnGatewayDisconnect, OnModuleDestroy {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(ConsolesGateway.name);
  private readonly sessions = new Map<string, ConsoleSession>();
  private readonly opens = new Map<string, TokenBucket>();
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
      const userInfo = await this.socketAuth
        .validateAndGetUser(typeof header === 'string' ? header : undefined)
        .catch(() => null);

      if (!userInfo) return next(new Error('Unauthorized'));

      (socket as ConsoleSocket).data = { userInfo };
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
      .catch((e: unknown) => this.logger.warn(`Console heartbeat: ${String(e)}`));

    for (const session of sessions) await session.recheck().catch(() => this.close(session, 'access revoked'));
  }

  private key(socket: Socket, sessionId: string): string {
    return `${socket.id}:${sessionId}`;
  }

  private fail(socket: Socket, sessionId: string | undefined, message: string): void {
    socket.emit('error', { ...(sessionId ? { sessionId } : {}), message });
  }

  /** Sends towards the node in order; a failed send ends the session. */
  private toNode(session: ConsoleSession, type: 'execInput' | 'execClose', payload: Record<string, unknown>): void {
    session.queue = session.queue
      .then(() => this.live.send(session.target.node, session.channel, type, payload))
      .catch(() => void this.finish(session, null, 'node not reachable'));
  }

  @SubscribeMessage('openConsole')
  async open(@MessageBody() body: unknown, @ConnectedSocket() socket: Socket): Promise<void> {
    const parsed = openSchema.safeParse(body ?? {});

    if (!parsed.success) return this.fail(socket, undefined, 'invalid payload');

    const dto = parsed.data;
    const sessionId = dto.sessionId ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

    if ([...this.sessions.values()].filter((s) => s.socket === socket).length >= MAX_SESSIONS_PER_SOCKET)
      return this.fail(socket, sessionId, 'too many consoles');

    if (this.sessions.has(this.key(socket, sessionId))) return this.fail(socket, sessionId, 'session exists');

    const req = buildRequestFromSocketUser((socket as ConsoleSocket).data.userInfo as SocketUserInfo);
    const actor = actorFromRequest(req);
    const userId = String(actor.id ?? actor.type);

    if ([...this.sessions.values()].filter((s) => s.userId === userId).length >= MAX_SESSIONS_PER_USER)
      return this.fail(socket, sessionId, 'too many consoles');

    let opens = this.opens.get(userId);

    if (!opens) this.opens.set(userId, (opens = new TokenBucket(OPEN_RATE, OPEN_BURST)));

    if (!opens.take(1)) return this.fail(socket, sessionId, 'rate limit exceeded');

    const recheck = () => this.liveAccess.console(req, dto.replica, dto.kind);
    let target: LiveTarget;

    try {
      target = await recheck();
    } catch (error) {
      return this.fail(socket, sessionId, error instanceof Error ? error.message : 'not allowed');
    }

    const [node]: { protocol_features: string[] | null }[] = await this.dataSource.query(
      `SELECT protocol_features FROM lw_nodes WHERE name = $1`,
      [target.node],
    );

    if (!(node?.protocol_features ?? []).includes(VM_CONSOLES_FEATURE))
      return this.fail(socket, sessionId, `the agent on node ${target.node} does not support VM consoles`);

    const [project, , name] = dto.replica.split('/');
    const vm = `${project}/${name}`;
    // VNC: metadata and duration only (recording RFB is out of scope, 3.35).
    const recorded = dto.kind === 'serial' && (await this.liveAccess.recorded(target));
    const startedAt = Date.now();
    const [row]: { id: string }[] = await this.dataSource.transaction(async (manager) => {
      const inserted = await manager.query(
        `INSERT INTO lw_terminal_sessions (user_id, project, target, node, recorded) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [actor.id ?? actor.type, target.project, `virtual-machine/${vm}/console/${dto.kind}`, target.node, recorded],
      );

      await this.audit.record(manager, {
        actor,
        action: 'vm.console.open',
        target: `virtual-machine/${vm}`,
        project: target.project,
        details: { kind: dto.kind, replica: dto.replica, node: target.node, recorded, session: inserted[0].id },
      });

      return inserted;
    });
    const session: ConsoleSession = {
      sessionId,
      kind: dto.kind,
      socket,
      channel: '',
      target,
      vm,
      replica: dto.replica,
      recheck,
      userId,
      dbId: row.id,
      input:
        dto.kind === 'serial'
          ? new TokenBucket(SERIAL_INPUT_RATE, SERIAL_INPUT_BURST)
          : new TokenBucket(VNC_INPUT_RATE, VNC_INPUT_BURST),
      startedAt,
      decoder: new StringDecoder('utf8'),
      recorder: recorded ? new AsciicastRecorder(startedAt, dto.cols, dto.rows, `virtual-machine/${vm}`) : null,
      bytes: { in: 0, out: 0 },
      queue: Promise.resolve(),
      idle: setTimeout(() => void this.close(session, 'idle'), IDLE_MS).unref(),
      closing: false,
      closed: false,
    };

    session.channel = this.live.openChannel((type, payload) => {
      if (type === 'execOutput') {
        // The relay's own stderr (e.g. "the VM has no vnc console") isn't console output.
        if (payload['stream'] === 'stderr') return;

        const data = Buffer.from(String(payload['data'] ?? ''), 'base64');

        session.bytes.out += data.length;

        // socket.io has no backpressure: a client that doesn't read ends its session instead of filling memory.
        if (clientBacklog(socket) > MAX_CLIENT_BUFFERED_PACKETS) return void this.close(session, 'client too slow');

        if (session.kind === 'vnc') return void socket.emit('consoleOutput', { sessionId, data });

        const text = session.decoder.write(data);

        session.recorder?.output(text);
        socket.emit('consoleOutput', { sessionId, data: text });
      } else if (type === 'execExit') {
        void this.finish(session, (payload['code'] as number | null) ?? null, payload['error'] as string | undefined);
      }
    });
    this.sessions.set(this.key(socket, sessionId), session);

    try {
      await this.live.send(target.node, session.channel, 'consoleOpen', {
        target: { kind: 'replica', replica: dto.replica },
        kind: dto.kind,
        ...(dto.kind === 'serial' ? { cols: dto.cols, rows: dto.rows } : {}),
      });
      socket.emit('consoleOpened', { sessionId, kind: dto.kind, recorded });
    } catch (error) {
      await this.finish(session, null, error instanceof Error ? error.message : 'node not reachable');
    }
  }

  @SubscribeMessage('consoleInput')
  async input(@MessageBody() body: unknown, @ConnectedSocket() socket: Socket): Promise<void> {
    const parsed = inputSchema.safeParse(body);
    const session = parsed.success ? this.sessions.get(this.key(socket, parsed.data.sessionId)) : undefined;

    if (!parsed.success || !session || session.closing)
      return this.fail(socket, parsed.success ? parsed.data.sessionId : undefined, 'unknown session');

    const raw = parsed.data.data;

    // Serial consoles take text, VNC binary RFB.
    if ((session.kind === 'serial') !== (typeof raw === 'string'))
      return this.fail(socket, session.sessionId, 'invalid payload');

    const data = typeof raw === 'string' ? Buffer.from(raw, 'utf8') : toBuffer(raw);

    if (data.length > LIVE_CHUNK_BYTES) return this.fail(socket, session.sessionId, 'invalid payload');

    if (!session.input.take(data.length)) return this.fail(socket, session.sessionId, 'input rate limit exceeded');

    session.idle.refresh();
    session.bytes.in += data.length;
    this.toNode(session, 'execInput', { data: data.toString('base64') });
  }

  @SubscribeMessage('consoleResize')
  async resize(@MessageBody() body: unknown, @ConnectedSocket() socket: Socket): Promise<void> {
    const parsed = resizeSchema.safeParse(body);
    const session = parsed.success ? this.sessions.get(this.key(socket, parsed.data.sessionId)) : undefined;

    if (!parsed.success || !session)
      return this.fail(socket, parsed.success ? parsed.data.sessionId : undefined, 'unknown session');

    // The guest owns the serial line's size (`stty` in the guest); only the recording follows the viewer.
    session.recorder?.resize(parsed.data.cols, parsed.data.rows);
  }

  @SubscribeMessage('closeConsole')
  async closeConsole(@MessageBody() body: unknown, @ConnectedSocket() socket: Socket): Promise<void> {
    const parsed = closeSchema.safeParse(body);
    const session = parsed.success ? this.sessions.get(this.key(socket, parsed.data.sessionId)) : undefined;

    if (session) await this.close(session, 'closed');
  }

  handleDisconnect(socket: Socket): void {
    for (const session of [...this.sessions.values()].filter((s) => s.socket === socket))
      void this.close(session, 'disconnected');
  }

  /** Asks the node to end the session; `execExit` finishes it (or the timeout does). */
  private async close(session: ConsoleSession, reason: string): Promise<void> {
    if (session.closed || session.closing) return;

    session.closing = true;
    this.toNode(session, 'execClose', {});
    // A node that doesn't answer doesn't keep the session open.
    setTimeout(() => void this.finish(session, null, reason), CLOSE_WAIT_MS).unref();
  }

  private async finish(session: ConsoleSession, code: number | null, error?: string): Promise<void> {
    if (session.closed) return;

    session.closed = true;
    clearTimeout(session.idle);
    this.sessions.delete(this.key(session.socket, session.sessionId));
    this.live.closeChannel(session.channel);
    session.socket.emit('consoleClosed', {
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
            buildRequestFromSocketUser((session.socket as ConsoleSocket).data.userInfo as SocketUserInfo),
          ),
          action: 'vm.console.close',
          target: `virtual-machine/${session.vm}`,
          project: session.target.project,
          details: {
            kind: session.kind,
            session: session.dbId,
            seconds: Math.round((Date.now() - session.startedAt) / 1000),
            bytesIn: session.bytes.in,
            bytesOut: session.bytes.out,
            ...(error ? { error: error.slice(0, 200) } : {}),
          },
        });
      })
      .catch((e: unknown) => this.logger.warn(`Console session ${session.dbId} not recorded: ${String(e)}`));
  }
}
