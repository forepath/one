import { randomUUID } from 'node:crypto';

import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { Server, ServerOptions, Socket } from 'socket.io';

import { runWithCorrelationId } from './correlation-id.storage';

const MAX_INCOMING_ID_LENGTH = 128;
const CORRELATION_ID_HEADER = 'x-correlation-id';
const REQUEST_ID_HEADER = 'x-request-id';

export function readIncomingCorrelationIdFromHeaders(headers: Record<string, unknown> | undefined): string | undefined {
  if (!headers) {
    return undefined;
  }

  const a = headers[CORRELATION_ID_HEADER];
  const b = headers[REQUEST_ID_HEADER];
  const raw =
    (typeof a === 'string' ? a : Array.isArray(a) ? a[0] : undefined) ??
    (typeof b === 'string' ? b : Array.isArray(b) ? b[0] : undefined);
  const trimmed = raw?.trim();

  if (!trimmed) {
    return undefined;
  }

  return trimmed.length > MAX_INCOMING_ID_LENGTH ? trimmed.slice(0, MAX_INCOMING_ID_LENGTH) : trimmed;
}

export function getOrInitSocketCorrelationId(socket: Socket): string {
  const anySocket = socket as unknown as {
    data?: Record<string, unknown>;
    handshake?: { headers?: Record<string, unknown> };
  };
  const existing = anySocket.data?.['correlationId'];

  if (typeof existing === 'string' && existing.trim()) {
    return existing.trim();
  }

  const incoming = readIncomingCorrelationIdFromHeaders(anySocket.handshake?.headers);
  const id = incoming ?? randomUUID();

  anySocket.data = anySocket.data ?? {};
  anySocket.data['correlationId'] = id;

  return id;
}

/**
 * Socket.IO adapter that binds a correlation id for every inbound event packet.
 *
 * Correlation id is sourced from handshake headers `x-correlation-id` / `x-request-id`,
 * or generated once per socket and stored at `socket.data.correlationId`.
 */
export class CorrelationAwareSocketIoAdapter extends IoAdapter {
  override createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, options) as Server;

    server.on('connection', (socket: Socket) => {
      getOrInitSocketCorrelationId(socket);

      socket.use((packet, next) => {
        const correlationId = getOrInitSocketCorrelationId(socket);
        runWithCorrelationId(correlationId, () => next());
      });
    });

    return server;
  }

  constructor(appOrHttpServer?: INestApplicationContext | unknown) {
    super(appOrHttpServer as never);
  }
}
