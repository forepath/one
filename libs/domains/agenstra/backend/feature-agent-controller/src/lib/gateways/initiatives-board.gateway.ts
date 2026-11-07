import {
  ClientUsersRepository,
  SocketAuthService,
  attachMachineSocketSession,
  buildRequestFromSocketUser,
  ensureClientAccess,
  socketRoomsForUser,
  type SocketUserInfo,
} from '@forepath/identity/backend';
import { resolveWebsocketCorsOrigin } from '@forepath/shared/shared/util-network-address';
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

import {
  AGENSTRA_WEBSOCKETS,
  INITIATIVES_SOCKET_INBOUND_SCOPES,
  INITIATIVES_SOCKET_OUTBOUND_SCOPES,
} from '../auth/agenstra-websocket.scopes';
import { ClientsRepository } from '../repositories/clients.repository';
import { InitiativeBoardRealtimeService } from '../services/initiative-board-realtime.service';

interface SetClientPayload {
  clientId?: string;
}

/**
 * Live Initiatives board (`socket/initiatives`): listen-only, joins the workspace room after `setClient` (workspace
 * access checked like REST). Every command is a REST call.
 */
@WebSocketGateway({
  namespace: process.env.INITIATIVES_WEBSOCKET_NAMESPACE || 'socket/initiatives',
  cors: {
    origin: resolveWebsocketCorsOrigin(),
  },
})
export class InitiativesBoardGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(InitiativesBoardGateway.name);
  private readonly selectedClientBySocket = new Map<string, string>();
  private readonly settingClientBySocket = new Map<string, string>();

  constructor(
    private readonly clientsRepository: ClientsRepository,
    private readonly clientUsersRepository: ClientUsersRepository,
    private readonly socketAuthService: SocketAuthService,
    private readonly initiativeBoardRealtime: InitiativeBoardRealtimeService,
  ) {}

  afterInit(server: Server): void {
    this.initiativeBoardRealtime.attachServer(server);
    server.use(async (socket, next) => {
      const authHeader = socket.handshake?.headers?.authorization ?? socket.handshake?.auth?.Authorization;
      const authOptions = { websocket: AGENSTRA_WEBSOCKETS.initiatives };
      const userInfo = await this.socketAuthService.validateAndGetUser(authHeader, undefined, authOptions);

      if (!userInfo) {
        this.logger.warn(`Initiatives WS rejected: missing or invalid authorization for socket ${socket.id}`);
        next(new Error('Unauthorized'));

        return;
      }

      (socket as Socket & { data: { userInfo: typeof userInfo } }).data = { userInfo };
      // PAT / app tokens: per-event scopes and live session re-checks (no-op for interactive sessions).
      attachMachineSocketSession(socket, userInfo, {
        inboundEvents: INITIATIVES_SOCKET_INBOUND_SCOPES,
        revalidate: () => this.socketAuthService.validateAndGetUser(authHeader, undefined, authOptions),
        logger: this.logger,
      });
      next();
    });
  }

  handleConnection(socket: Socket): void {
    this.logger.debug(`Initiatives board client connected: ${socket.id}`);
  }

  handleDisconnect(socket: Socket): void {
    const prev = this.selectedClientBySocket.get(socket.id);

    if (prev) {
      this.leaveClientRooms(socket, prev);
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
      this.logger.debug(`setClient already in progress for initiatives socket ${socket.id} and clientId ${clientId}`);

      return;
    }

    if (currentSelected === clientId && !currentSetting) {
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
        this.leaveClientRooms(socket, currentSelected);
      }

      for (const room of this.clientRooms(socket, clientId)) {
        await socket.join(room);
      }
      this.selectedClientBySocket.set(socket.id, clientId);
      socket.emit('setClientSuccess', { message: 'Client context set', clientId });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.warn(`setClient failed for initiatives socket ${socket.id}: ${message}`);
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

  /** Workspace room for interactive sockets; scope-permitted per-event rooms for PAT / app token sockets. */
  private clientRooms(socket: Socket, clientId: string): string[] {
    const userInfo = (socket as Socket & { data?: { userInfo?: SocketUserInfo } }).data?.userInfo;

    return socketRoomsForUser(
      userInfo,
      InitiativeBoardRealtimeService.clientRoom(clientId),
      INITIATIVES_SOCKET_OUTBOUND_SCOPES,
    );
  }

  private leaveClientRooms(socket: Socket, clientId: string): void {
    for (const room of this.clientRooms(socket, clientId)) {
      void socket.leave(room);
    }
  }
}
