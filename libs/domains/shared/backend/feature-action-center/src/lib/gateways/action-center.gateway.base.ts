import { Logger } from '@nestjs/common';
import type { OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';

import type { ActionCenterViewer } from '../interfaces/action-center.types';
import {
  ActionCenterRealtimeService,
  type ActionCenterSessionRevalidator,
} from '../services/action-center-realtime.service';

/** Result of a product's socket authentication. */
export interface ActionCenterSocketAuthResult {
  viewer: ActionCenterViewer;
  /** Re-runs the same checks later (token expiry, lock, revocation, role); `null` ends the session. */
  revalidate: ActionCenterSessionRevalidator;
}

type ActionCenterSocket = Socket & { data: { actionCenterAuth?: ActionCenterSocketAuthResult } };

/** Marks a namespace server whose auth middleware is installed (one per server, even with several gateway instances). */
const AUTH_MIDDLEWARE_INSTALLED = Symbol('actionCenterAuthMiddleware');

/**
 * Socket.IO gateway of the action center. Products subclass it with `@WebSocketGateway({ namespace, cors })` and
 * implement {@link authenticate}: only interactive admin / manager sessions may connect (machine tokens and static
 * credentials are rejected). The gateway accepts no inbound events; it only pushes `actionCenterSnapshot`.
 */
export abstract class ActionCenterGatewayBase implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  protected readonly logger = new Logger(this.constructor.name);

  protected constructor(protected readonly realtime: ActionCenterRealtimeService) {}

  /**
   * Authenticate the handshake: return the viewer for interactive admin / manager sessions of the socket's scope,
   * `null` otherwise.
   */
  protected abstract authenticate(socket: Socket): Promise<ActionCenterSocketAuthResult | null>;

  afterInit(server: Server): void {
    this.realtime.attach();

    const marked = server as Server & { [AUTH_MIDDLEWARE_INSTALLED]?: boolean };

    if (marked[AUTH_MIDDLEWARE_INSTALLED]) {
      return;
    }

    marked[AUTH_MIDDLEWARE_INSTALLED] = true;
    server.use(async (socket, next) => {
      let result: ActionCenterSocketAuthResult | null = null;

      try {
        result = await this.authenticate(socket);
      } catch (error) {
        this.logger.warn(`Action center socket auth failed: ${(error as Error)?.message ?? error}`);
      }

      if (!result) {
        next(new Error('Unauthorized'));

        return;
      }

      (socket as ActionCenterSocket).data = { ...(socket.data ?? {}), actionCenterAuth: result };
      next();
    });
  }

  handleConnection(socket: Socket): void {
    const auth = (socket as ActionCenterSocket).data?.actionCenterAuth;

    if (!auth) {
      socket.disconnect(true);

      return;
    }

    if (this.realtime.register({ socket, viewer: auth.viewer, revalidate: auth.revalidate })) {
      void this.realtime.pushToSocket(socket.id);
    }
  }

  handleDisconnect(socket: Socket): void {
    this.realtime.unregister(socket.id);
  }
}
