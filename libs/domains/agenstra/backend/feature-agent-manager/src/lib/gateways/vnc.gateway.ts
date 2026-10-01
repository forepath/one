import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import type { Server as HttpServer } from 'http';
import type { Server as SocketIoServer } from 'socket.io';
import { parse as parseUrl } from 'url';
import WebSocket = require('ws');

import { VNC_TICKET_SUBPROTOCOL_PREFIX, VNC_WEBSOCKET_PATH } from '../constants/vnc.constants';
import { VncBridgeService } from '../services/vnc-bridge.service';
import { VncTicketService } from '../services/vnc-ticket.service';
import {
  extractVncTicketFromProtocols,
  isAllowedWebsocketOrigin,
  selectVncWebsocketProtocol,
} from '../utils/vnc-websocket.utils';

import { AgentsGateway } from './agents.gateway';

/**
 * Raw WebSocket gateway for VNC/websockify binary proxying.
 * Shares `WEBSOCKET_PORT` with Socket.IO via path {@link VNC_WEBSOCKET_PATH}.
 * Separate protocol from Socket.IO — noVNC expects websockify framing.
 *
 * Ticket store is process-local: deploy a single manager replica (or sticky sessions)
 * so REST mint and `/vnc` consume hit the same instance.
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
    private readonly agentsGateway: AgentsGateway,
    private readonly vncTicketService: VncTicketService,
    private readonly vncBridgeService: VncBridgeService,
  ) {}

  onApplicationBootstrap(): void {
    const httpServer = resolveSocketIoHttpServer(this.agentsGateway.server);

    if (!httpServer) {
      this.logger.error('Socket.IO HTTP server unavailable; VNC gateway not started');

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

      if (!isAllowedWebsocketOrigin(request.headers.origin, process.env.WEBSOCKET_CORS_ORIGIN)) {
        this.logger.warn('Rejected manager VNC upgrade: Origin not allowed');
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        socket.destroy();

        return;
      }

      this.wss?.handleUpgrade(request, socket, head, (ws) => {
        this.wss?.emit('connection', ws, request);
      });
    };

    httpServer.on('upgrade', this.upgradeListener);
    this.logger.log(`VNC WebSocket gateway attached at path ${VNC_WEBSOCKET_PATH} on WEBSOCKET_PORT`);
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
    const sessionId = `mgr-vnc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    try {
      const ticket = extractVncTicketFromProtocols(request, VNC_TICKET_SUBPROTOCOL_PREFIX);
      const record = this.vncTicketService.consume(ticket);

      await this.vncBridgeService.open(sessionId, record.agentId, record.containerId, {
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
        onError: () => {
          if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
            client.close();
          }
        },
      });

      client.on('message', (data, isBinary) => {
        try {
          this.vncBridgeService.send(sessionId, data, isBinary);
        } catch (error) {
          const err = error as { message?: string };

          this.logger.debug(`VNC client→upstream send failed for ${sessionId}: ${err.message}`);
          client.close();
        }
      });

      client.on('close', () => {
        this.vncBridgeService.close(sessionId);
      });

      client.on('error', () => {
        this.vncBridgeService.close(sessionId);
      });
    } catch (error) {
      const err = error as { message?: string };

      this.logger.warn(`Rejected VNC WebSocket connection: ${err.message}`);
      client.close(1008, 'Unauthorized');
    }
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
