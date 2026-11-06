import {
  attachMachineSocketSession,
  SocketAuthService,
  socketRoomsForUser,
  type SocketUserInfo,
  UserRole,
} from '@forepath/identity/backend';
import { getOrInitSocketTenantId, readIncomingTenantIdFromHandshake, runWithTenantId } from '@forepath/shared/backend';
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
  BILLING_WEBSOCKETS,
  PROJECTS_SOCKET_INBOUND_SCOPES,
  projectsSocketOutboundScopes,
} from '../../auth/billing-websocket.scopes';
import { getBillingUserIdFromSocketUser } from '../../utils/billing-socket-user.utils';
import { ProjectsRepository } from '../repositories/projects.repository';
import { ProjectBoardRealtimeService } from '../services/project-board-realtime.service';
import { ensureProjectReadable } from '../utils/project-access.utils';

interface SetProjectPayload {
  projectId?: string;
}

type ProjectSocket = Socket & { data: { userInfo?: SocketUserInfo; tenantId?: string } };

@WebSocketGateway({
  namespace: process.env.PROJECTS_WEBSOCKET_NAMESPACE || 'socket/projects',
  cors: {
    origin: resolveWebsocketCorsOrigin(),
  },
})
export class ProjectBoardGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(ProjectBoardGateway.name);
  private readonly selectedProjectBySocket = new Map<string, string>();
  private readonly settingProjectBySocket = new Map<string, string>();
  /** Rooms joined for the selected project (per-event rooms for PAT / app token sockets). */
  private readonly projectRoomsBySocket = new Map<string, string[]>();

  constructor(
    private readonly socketAuthService: SocketAuthService,
    private readonly projectsRepository: ProjectsRepository,
    private readonly projectBoardRealtime: ProjectBoardRealtimeService,
  ) {}

  afterInit(server: Server): void {
    this.projectBoardRealtime.attachServer(server);
    server.use(async (socket, next) => {
      const authHeader = socket.handshake?.headers?.authorization ?? socket.handshake?.auth?.Authorization;
      const tenantId = readIncomingTenantIdFromHandshake(
        socket.handshake?.headers as Record<string, unknown> | undefined,
        socket.handshake?.auth as Record<string, unknown> | undefined,
      );

      if (!tenantId) {
        this.logger.warn(`Projects WebSocket rejected: invalid tenant for socket ${socket.id}`);
        next(new Error('Invalid tenant'));

        return;
      }

      const header = typeof authHeader === 'string' ? authHeader : undefined;
      const authOptions = { websocket: BILLING_WEBSOCKETS.projects };
      const userInfo = await this.socketAuthService.validateAndGetUser(header, tenantId, authOptions);

      if (!userInfo) {
        this.logger.warn(`Projects WebSocket rejected: invalid authorization for socket ${socket.id}`);
        next(new Error('Unauthorized'));

        return;
      }

      (socket as ProjectSocket).data = { userInfo, tenantId };
      // PAT / app tokens: per-event scopes and live session re-checks (no-op for interactive sessions).
      attachMachineSocketSession(socket, userInfo, {
        inboundEvents: PROJECTS_SOCKET_INBOUND_SCOPES,
        revalidate: () => this.socketAuthService.validateAndGetUser(header, tenantId, authOptions),
        logger: this.logger,
      });
      next();
    });
  }

  handleConnection(socket: Socket): void {
    this.logger.debug(`Project board client connected: ${socket.id}`);
  }

  handleDisconnect(socket: Socket): void {
    const prev = this.selectedProjectBySocket.get(socket.id);

    if (prev) {
      this.leaveProjectRooms(socket, prev);
    }

    this.selectedProjectBySocket.delete(socket.id);
    this.projectRoomsBySocket.delete(socket.id);
    this.settingProjectBySocket.delete(socket.id);
  }

  @SubscribeMessage('setProject')
  async handleSetProject(@MessageBody() data: SetProjectPayload, @ConnectedSocket() socket: Socket): Promise<void> {
    const projectId = data?.projectId;

    if (!projectId) {
      socket.emit('error', { message: 'projectId is required' });

      return;
    }

    const currentSetting = this.settingProjectBySocket.get(socket.id);
    const currentSelected = this.selectedProjectBySocket.get(socket.id);

    if (currentSetting === projectId) {
      return;
    }

    if (currentSelected === projectId && !currentSetting) {
      socket.emit('setProjectSuccess', { message: 'Project context already set', projectId });

      return;
    }

    this.settingProjectBySocket.set(socket.id, projectId);

    try {
      const projectSocket = socket as ProjectSocket;
      const tenantId = projectSocket.data?.tenantId ?? getOrInitSocketTenantId(socket);

      if (!tenantId) {
        socket.emit('error', { message: 'Access denied' });

        return;
      }

      await runWithTenantId(tenantId, async () => {
        const userInfo = projectSocket.data?.userInfo;

        if (!userInfo || userInfo.isApiKeyAuth) {
          socket.emit('error', { message: 'User not authenticated' });

          return;
        }

        const userId = getBillingUserIdFromSocketUser(userInfo);

        if (!userId) {
          socket.emit('error', { message: 'User not authenticated' });

          return;
        }

        const project = await this.projectsRepository.findByIdOrThrow(projectId);

        // Same rule as REST: PAT / app tokens of admins need `projects:admin` for other users' projects.
        ensureProjectReadable(
          {
            userId,
            userRole: userInfo.userRole ?? UserRole.USER,
            isApiKeyAuth: false,
            amr: userInfo.amr,
            scopes: userInfo.scopes,
          },
          project,
          'projects:admin',
        );

        if (currentSelected && currentSelected !== projectId) {
          this.leaveProjectRooms(socket, currentSelected);
        }

        const rooms = socketRoomsForUser(
          userInfo,
          ProjectBoardRealtimeService.projectRoom(projectId),
          projectsSocketOutboundScopes(project.userId !== userId),
        );

        for (const room of rooms) {
          await socket.join(room);
        }

        this.projectRoomsBySocket.set(socket.id, rooms);
        this.selectedProjectBySocket.set(socket.id, projectId);
        socket.emit('setProjectSuccess', { message: 'Project context set', projectId });
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.warn(`setProject failed for socket ${socket.id}: ${message}`);
      socket.emit('error', {
        message: error instanceof ForbiddenException ? 'Access denied' : 'Unable to set project context',
      });
    } finally {
      this.settingProjectBySocket.delete(socket.id);
    }
  }

  private leaveProjectRooms(socket: Socket, projectId: string): void {
    const rooms = this.projectRoomsBySocket.get(socket.id) ?? [ProjectBoardRealtimeService.projectRoom(projectId)];

    for (const room of rooms) {
      void socket.leave(room);
    }

    this.projectRoomsBySocket.delete(socket.id);
  }
}
