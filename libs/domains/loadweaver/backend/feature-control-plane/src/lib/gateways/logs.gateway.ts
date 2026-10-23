import { buildRequestFromSocketUser, SocketAuthService, type SocketUserInfo } from '@forepath/identity/backend';
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
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Server, Socket } from 'socket.io';

import { LogQueryDto } from '../controllers/logs.controller';
import { LogsService, type LogFilter } from '../logs/logs.service';

const POLL_MS = 2_000;
const MAX_TAILS = 5_000;

type LogsSocket = Socket & { data: { userInfo?: SocketUserInfo } };

/**
 * Live tail (3.14): a client subscribes with a filter and gets every new matching line (`logLines`), checked with
 * the same access scoping as queries. Lines are read from the log store, so every replica can serve every tail.
 */
@WebSocketGateway({
  namespace: process.env.LOADWEAVER_LOGS_WEBSOCKET_NAMESPACE || 'socket/logs',
  cors: { origin: resolveWebsocketCorsOrigin() },
})
export class LogsGateway implements OnGatewayInit, OnGatewayDisconnect, OnModuleDestroy {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(LogsGateway.name);
  private readonly tails = new Map<string, { socket: LogsSocket; filter: LogFilter; cursor?: string; from: string }>();
  private timer: NodeJS.Timeout | null = null;
  private polling = false;

  constructor(
    private readonly socketAuth: SocketAuthService,
    private readonly logs: LogsService,
  ) {}

  afterInit(server: Server): void {
    server.use(async (socket, next) => {
      const header = socket.handshake?.headers?.authorization ?? socket.handshake?.auth?.['Authorization'];
      const userInfo = await this.socketAuth.validateAndGetUser(typeof header === 'string' ? header : undefined);

      if (!userInfo) {
        next(new Error('Unauthorized'));

        return;
      }

      (socket as LogsSocket).data = { userInfo };
      next();
    });
  }

  @SubscribeMessage('subscribe')
  async subscribe(@MessageBody() body: unknown, @ConnectedSocket() socket: Socket): Promise<void> {
    const dto = plainToInstance(LogQueryDto, body ?? {});
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });

    if (errors.length > 0 || this.tails.size >= MAX_TAILS) {
      socket.emit('error', { message: errors.length > 0 ? 'invalid filter' : 'too many tails' });

      return;
    }

    const filter: LogFilter = { ...dto, cursor: undefined, order: 'asc', to: undefined, tail: true };

    try {
      // Checks access right away (an unknown / foreign project fails here, not silently later).
      await this.logs.query(this.request(socket as LogsSocket), {
        ...filter,
        limit: 1,
        from: new Date().toISOString(),
      });
    } catch (error) {
      socket.emit('error', { message: error instanceof Error ? error.message : 'not allowed' });

      return;
    }

    this.tails.set(socket.id, { socket: socket as LogsSocket, filter, from: new Date().toISOString() });
    this.timer ??= setInterval(() => void this.poll(), POLL_MS);
  }

  @SubscribeMessage('unsubscribe')
  unsubscribe(@ConnectedSocket() socket: Socket): void {
    this.handleDisconnect(socket);
  }

  handleDisconnect(socket: Socket): void {
    this.tails.delete(socket.id);

    if (this.tails.size === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private request(socket: LogsSocket) {
    return buildRequestFromSocketUser(socket.data.userInfo as SocketUserInfo);
  }

  private async poll(): Promise<void> {
    if (this.polling) return;

    this.polling = true;

    try {
      for (const [id, tail] of this.tails) {
        try {
          const page = await this.logs.query(this.request(tail.socket), {
            ...tail.filter,
            from: tail.from,
            to: new Date().toISOString(),
            cursor: tail.cursor,
            limit: 500,
          });

          if (page.lines.length === 0) continue;

          tail.socket.emit('logLines', { lines: page.lines });
          // The next poll continues right after the last line sent (in the order they were stored).
          tail.cursor = page.after ?? tail.cursor;
        } catch (error) {
          // This caller may no longer see what it follows (e.g. removed from the project): end its tail only.
          tail.socket.emit('error', { message: error instanceof Error ? error.message : 'tail ended' });
          this.tails.delete(id);
        }
      }
    } finally {
      this.polling = false;
    }
  }
}
