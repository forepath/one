import {
  ClientUsersRepository,
  SocketAuthService,
  buildRequestFromSocketUser,
  ensureClientAccess,
} from '@forepath/identity/backend';
import { ForbiddenException, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

import { ClientsRepository } from '../repositories/clients.repository';
import { TicketBoardRealtimeService } from '../services/ticket-board-realtime.service';

interface SetClientPayload {
  clientId?: string;
}

@WebSocketGateway(parseInt(process.env.WEBSOCKET_PORT || '8081', 10), {
  namespace: process.env.TICKETS_WEBSOCKET_NAMESPACE || 'tickets',
  cors: {
    origin: process.env.WEBSOCKET_CORS_ORIGIN || '*',
  },
})
export class TicketsBoardGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(TicketsBoardGateway.name);
  private readonly selectedClientBySocket = new Map<string, string>();
  private readonly settingClientBySocket = new Map<string, string>();

  constructor(
    private readonly clientsRepository: ClientsRepository,
    private readonly clientUsersRepository: ClientUsersRepository,
    private readonly socketAuthService: SocketAuthService,
    private readonly ticketBoardRealtime: TicketBoardRealtimeService,
  ) {}

  afterInit(server: Server): void {
    this.ticketBoardRealtime.attachServer(server);
    server.use(async (socket, next) => {
      const authHeader = socket.handshake?.headers?.authorization ?? socket.handshake?.auth?.Authorization;
      const userInfo = await this.socketAuthService.validateAndGetUser(authHeader);

      if (!userInfo) {
        this.logger.warn(`Tickets WS rejected: missing or invalid authorization for socket ${socket.id}`);
        next(new Error('Unauthorized'));

        return;
      }

      (socket as Socket & { data: { userInfo: typeof userInfo } }).data = { userInfo };
      next();
    });
  }

  handleConnection(socket: Socket): void {
    this.logger.debug(`Tickets board client connected: ${socket.id}`);
  }

  handleDisconnect(socket: Socket): void {
    const prev = this.selectedClientBySocket.get(socket.id);

    if (prev) {
      void socket.leave(TicketBoardRealtimeService.clientRoom(prev));
    }

    this.selectedClientBySocket.delete(socket.id);
    this.settingClientBySocket.delete(socket.id);
  }

  @SubscribeMessage('setClient')
  async handleSetClient(@MessageBody() data: SetClientPayload, @ConnectedSocket() socket: Socket): Promise<void> {
    const clientId = data?.clientId;

    if (!clientId) {
      socket.emit('error', { message: 'clientId is required' });

      return;
    }

    const currentSetting = this.settingClientBySocket.get(socket.id);
    const currentSelected = this.selectedClientBySocket.get(socket.id);

    if (currentSetting === clientId) {
      this.logger.debug(`setClient already in progress for socket ${socket.id} and clientId ${clientId}`);

      return;
    }

    if (currentSelected === clientId && !currentSetting) {
      this.logger.debug(`Client ${clientId} already selected for tickets socket ${socket.id}`);
      socket.emit('setClientSuccess', { message: 'Client context already set', clientId });

      return;
    }

    this.settingClientBySocket.set(socket.id, clientId);

    try {
      const userInfo = (socket as Socket & { data?: { userInfo?: Parameters<typeof buildRequestFromSocketUser>[0] } })
        .data?.userInfo;

      if (!userInfo) {
        this.settingClientBySocket.delete(socket.id);
        socket.emit('error', { message: 'Unauthorized' });

        return;
      }

      await ensureClientAccess(
        this.clientsRepository,
        this.clientUsersRepository,
        clientId,
        buildRequestFromSocketUser(userInfo),
      );

      if (currentSelected && currentSelected !== clientId) {
        await socket.leave(TicketBoardRealtimeService.clientRoom(currentSelected));
      }

      await socket.join(TicketBoardRealtimeService.clientRoom(clientId));
      this.selectedClientBySocket.set(socket.id, clientId);
      socket.emit('setClientSuccess', { message: 'Client context set', clientId });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.warn(`setClient failed for socket ${socket.id}: ${message}`);
      socket.emit('error', {
        message:
          error instanceof ForbiddenException
            ? 'You do not have access to this client'
            : 'Unable to set client context',
      });
    } finally {
      this.settingClientBySocket.delete(socket.id);
    }
  }
}
