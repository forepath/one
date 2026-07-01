import { SocketAuthService, type SocketUserInfo, UserRole } from '@forepath/identity/backend';
import { getOrInitSocketTenantId, readIncomingTenantIdFromHandshake, runWithTenantId } from '@forepath/shared/backend';
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

import { getBillingUserIdFromSocketUser } from '../../utils/billing-socket-user.utils';
import { ProjectsRepository } from '../repositories/projects.repository';
import { ProjectBoardRealtimeService } from '../services/project-board-realtime.service';
import { ensureProjectReadable } from '../utils/project-access.utils';

interface SetProjectPayload {
  projectId?: string;
}

type ProjectSocket = Socket & { data: { userInfo?: SocketUserInfo; tenantId?: string } };

@WebSocketGateway(parseInt(process.env.WEBSOCKET_PORT || '8082', 10), {
  namespace: process.env.PROJECTS_WEBSOCKET_NAMESPACE || 'projects',
  cors: {
    origin: process.env.WEBSOCKET_CORS_ORIGIN || '*',
  },
})
export class ProjectBoardGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(ProjectBoardGateway.name);
  private readonly selectedProjectBySocket = new Map<string, string>();
  private readonly settingProjectBySocket = new Map<string, string>();

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

      const userInfo = await this.socketAuthService.validateAndGetUser(
        typeof authHeader === 'string' ? authHeader : undefined,
        tenantId,
      );

      if (!userInfo) {
        this.logger.warn(`Projects WebSocket rejected: invalid authorization for socket ${socket.id}`);
        next(new Error('Unauthorized'));

        return;
      }

      (socket as ProjectSocket).data = { userInfo, tenantId };
      next();
    });
  }

  handleConnection(socket: Socket): void {
    this.logger.debug(`Project board client connected: ${socket.id}`);
  }

  handleDisconnect(socket: Socket): void {
    const prev = this.selectedProjectBySocket.get(socket.id);

    if (prev) {
      void socket.leave(ProjectBoardRealtimeService.projectRoom(prev));
    }

    this.selectedProjectBySocket.delete(socket.id);
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

        ensureProjectReadable(
          {
            userId,
            userRole: userInfo.userRole ?? UserRole.USER,
            isApiKeyAuth: false,
          },
          project,
        );

        if (currentSelected && currentSelected !== projectId) {
          await socket.leave(ProjectBoardRealtimeService.projectRoom(currentSelected));
        }

        await socket.join(ProjectBoardRealtimeService.projectRoom(projectId));
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
}
