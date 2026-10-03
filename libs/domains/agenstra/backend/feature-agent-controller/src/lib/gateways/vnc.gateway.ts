import { ClientUsersRepository, ensureClientAccess, type RequestWithUser, UserRole } from '@forepath/identity/backend';
import { resolveWebsocketCorsOriginEnv } from '@forepath/shared/shared/util-network-address';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import type { Server as HttpServer } from 'http';
import type { Server as SocketIoServer } from 'socket.io';
import { parse as parseUrl } from 'url';
import WebSocket = require('ws');

import { VNC_TICKET_SUBPROTOCOL_PREFIX, VNC_WEBSOCKET_PATH } from '../constants/vnc.constants';
import { ClientsRepository } from '../repositories/clients.repository';
import { ControllerVncTicketService } from '../services/controller-vnc-ticket.service';
import {
  extractVncTicketFromProtocols,
  isAllowedWebsocketOrigin,
  selectVncWebsocketProtocol,
} from '../utils/vnc-websocket.utils';

import { ClientsGateway } from './clients.gateway';

/**
 * Raw WebSocket gateway that proxies noVNC traffic to the manager VNC gateway.
 * Shares the Nest HTTP `PORT` with Socket.IO via path {@link VNC_WEBSOCKET_PATH}.
 * Auth is ticket-based; tickets are minted only after ensureClientAccess on REST.
 */
@Injectable()
export class VncGateway implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(VncGateway.name);
  private wss: WebSocket.Server | null = null;
  private upgradeListener:
    | ((request: import('http').IncomingMessage, socket: import('stream').Duplex, head: Buffer) => void)
    | null = null;
  private httpServer: HttpServer | null = null;

  constructor(
    private readonly clientsGateway: ClientsGateway,
    private readonly controllerVncTicketService: ControllerVncTicketService,
    private readonly clientsRepository: ClientsRepository,
    private readonly clientUsersRepository: ClientUsersRepository,
  ) {}

  onApplicationBootstrap(): void {
    const httpServer = resolveSocketIoHttpServer(this.clientsGateway.server);

    if (!httpServer) {
      this.logger.error('Socket.IO HTTP server unavailable; controller VNC gateway not started');

      return;
    }

    this.httpServer = httpServer;
    this.wss = new WebSocket.Server({
      noServer: true,
      handleProtocols: (protocols) => selectVncWebsocketProtocol(protocols, VNC_TICKET_SUBPROTOCOL_PREFIX),
    });
    this.wss.on('connection', (socket, request) => {
      void this.handleConnection(socket, request);
    });

    this.upgradeListener = (request, socket, head) => {
      const pathname = parseUrl(request.url || '').pathname;

      if (pathname !== VNC_WEBSOCKET_PATH) {
        return;
      }

      if (!isAllowedWebsocketOrigin(request.headers.origin, resolveWebsocketCorsOriginEnv())) {
        this.logger.warn('Rejected controller VNC upgrade: Origin not allowed');
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        socket.destroy();

        return;
      }

      this.wss?.handleUpgrade(request, socket, head, (ws) => {
        this.wss?.emit('connection', ws, request);
      });
    };

    httpServer.on('upgrade', this.upgradeListener);
    this.logger.log(`Controller VNC WebSocket gateway attached at path ${VNC_WEBSOCKET_PATH} on PORT`);
  }

  onModuleDestroy(): void {
    if (this.httpServer && this.upgradeListener) {
      this.httpServer.off('upgrade', this.upgradeListener);
    }

    try {
      this.wss?.close();
    } catch {
      // ignore
    }

    this.upgradeListener = null;
    this.wss = null;
    this.httpServer = null;
  }

  private async handleConnection(client: WebSocket, request: import('http').IncomingMessage): Promise<void> {
    let upstream: WebSocket | null = null;

    try {
      const ticket = extractVncTicketFromProtocols(request, VNC_TICKET_SUBPROTOCOL_PREFIX);
      const record = await this.controllerVncTicketService.consume(ticket);

      await ensureClientAccess(
        this.clientsRepository,
        this.clientUsersRepository,
        record.clientId,
        this.buildSyntheticRequest(record),
      );

      upstream = await this.connectUpstream(record.managerWsUrl, record.managerTicket, record.clientAuthHeader, {
        onMessage: (data, isBinary) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(data, { binary: isBinary });
          }
        },
        onClose: () => {
          if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
            client.close();
          }
        },
        onError: (error) => {
          this.logger.warn(`Upstream manager VNC error: ${error.message}`);
          if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
            client.close();
          }
        },
      });

      client.on('message', (data, isBinary) => {
        if (upstream && upstream.readyState === WebSocket.OPEN) {
          upstream.send(data, { binary: isBinary });
        }
      });

      client.on('close', () => {
        if (upstream && (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING)) {
          upstream.close();
        }
      });

      client.on('error', () => {
        if (upstream && (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING)) {
          upstream.close();
        }
      });
    } catch (error) {
      const err = error as { message?: string };

      this.logger.warn(`Rejected controller VNC connection: ${err.message}`);

      try {
        upstream?.close();
      } catch {
        // ignore
      }

      client.close(1008, 'Unauthorized');
    }
  }

  private buildSyntheticRequest(record: {
    subject: string;
    isApiKeyAuth: boolean;
    userRole?: UserRole;
  }): RequestWithUser {
    if (record.isApiKeyAuth) {
      return { apiKeyAuthenticated: true } as RequestWithUser;
    }

    return {
      user: {
        id: record.subject,
        roles: record.userRole === UserRole.ADMIN ? [UserRole.ADMIN] : [UserRole.USER],
      },
    } as RequestWithUser;
  }

  private connectUpstream(
    wsUrl: string,
    managerTicket: string,
    authorization: string,
    handlers: {
      onMessage: (data: WebSocket.RawData, isBinary: boolean) => void;
      onClose: () => void;
      onError: (error: Error) => void;
    },
  ): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const upstream = new WebSocket(wsUrl, [`${VNC_TICKET_SUBPROTOCOL_PREFIX}${managerTicket}`], {
        headers: {
          Authorization: authorization,
        },
      });

      // Attach forwarders before 'open' so the RFB greeting is not dropped.
      upstream.on('message', (data, isBinary) => {
        handlers.onMessage(data, isBinary);
      });
      upstream.on('close', () => {
        handlers.onClose();
      });
      upstream.on('error', (error) => {
        handlers.onError(error);
      });

      const onOpen = () => {
        cleanup();
        resolve(upstream);
      };

      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };

      const cleanup = () => {
        upstream.off('open', onOpen);
        upstream.off('error', onError);
      };

      upstream.once('open', onOpen);
      upstream.once('error', onError);
    });
  }
}

function resolveSocketIoHttpServer(
  io:
    | SocketIoServer
    | { server?: SocketIoServer; httpServer?: HttpServer; engine?: { httpServer?: HttpServer } }
    | undefined,
): HttpServer | null {
  if (!io) {
    return null;
  }

  // Root Socket.IO Server (no namespace)
  const direct = (io as { httpServer?: HttpServer }).httpServer;

  if (direct) {
    return direct;
  }

  // Nest injects a Namespace for namespaced gateways; parent Server holds httpServer.
  const parent = (io as { server?: SocketIoServer & { httpServer?: HttpServer; engine?: { httpServer?: HttpServer } } })
    .server;

  if (parent?.httpServer) {
    return parent.httpServer;
  }

  const engine =
    (io as { engine?: { httpServer?: HttpServer } }).engine ??
    (parent as { engine?: { httpServer?: HttpServer } } | undefined)?.engine;

  return engine?.httpServer ?? null;
}
