import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { Server, ServerOptions, Socket } from 'socket.io';

import { runWithCorrelationId } from './correlation-id.storage';
import { readIncomingTenantIdFromHandshake } from './tenant-id.config';
import { runWithTenantId } from './tenant-id.storage';
import { getOrInitSocketCorrelationId } from './socket-io.adapter';

export function getOrInitSocketTenantId(socket: Socket): string | undefined {
  const anySocket = socket as unknown as {
    data?: Record<string, unknown>;
    handshake?: { headers?: Record<string, unknown>; auth?: Record<string, unknown> };
  };
  const existing = anySocket.data?.['tenantId'];

  if (typeof existing === 'string' && existing.trim()) {
    return existing.trim();
  }

  const incoming = readIncomingTenantIdFromHandshake(anySocket.handshake?.headers, anySocket.handshake?.auth);

  if (!incoming) {
    return undefined;
  }

  anySocket.data = anySocket.data ?? {};
  anySocket.data['tenantId'] = incoming;

  return incoming;
}

function attachSocketTenantContext(socket: Socket): void {
  const tenantId = getOrInitSocketTenantId(socket);

  if (!tenantId) {
    socket.disconnect(true);

    return;
  }

  getOrInitSocketCorrelationId(socket);

  socket.use((packet, next) => {
    const correlationId = getOrInitSocketCorrelationId(socket);
    const resolvedTenantId = getOrInitSocketTenantId(socket);

    if (!resolvedTenantId) {
      next(new Error('Invalid tenant'));

      return;
    }

    runWithCorrelationId(correlationId, () => {
      runWithTenantId(resolvedTenantId, () => next());
    });
  });
}

const boundNamespaces = new WeakSet<object>();

type ConnectionBindTarget = {
  on(event: 'connection', listener: (socket: Socket) => void): unknown;
};

function bindNamespaceConnections(namespace: ConnectionBindTarget): void {
  if (boundNamespaces.has(namespace)) {
    return;
  }

  boundNamespaces.add(namespace);
  namespace.on('connection', attachSocketTenantContext);
}

/**
 * Socket.IO adapter that binds correlation id and tenant id for every inbound event packet.
 *
 * Tenant id is sourced from handshake header `x-tenant` (validated against `TENANTS` env).
 * Sockets without a valid tenant are disconnected.
 */
export class TenantAwareSocketIoAdapter extends IoAdapter {
  override createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, options) as Server;

    bindNamespaceConnections(server as ConnectionBindTarget);

    if (typeof server.of === 'function') {
      const originalOf = server.of.bind(server);

      server.of = ((name, fn?) => {
        const namespace = originalOf(name, fn);

        bindNamespaceConnections(namespace as ConnectionBindTarget);

        return namespace;
      }) as Server['of'];
    }

    return server;
  }

  constructor(appOrHttpServer?: INestApplicationContext | unknown) {
    super(appOrHttpServer as never);
  }
}
