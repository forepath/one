import { IoAdapter } from '@nestjs/platform-socket.io';
import type { Socket } from 'socket.io';

import * as correlationStorage from './correlation-id.storage';
import * as tenantStorage from './tenant-id.storage';
import { getOrInitSocketTenantId, TenantAwareSocketIoAdapter } from './tenant-aware-socket-io.adapter';

describe('tenant-aware-socket-io.adapter', () => {
  describe('getOrInitSocketTenantId', () => {
    function mockSocket(overrides: Partial<Socket> = {}): Socket {
      return {
        data: {},
        handshake: { headers: {}, auth: {} },
        ...overrides,
      } as unknown as Socket;
    }

    it('uses existing socket.data tenantId when present', () => {
      const socket = mockSocket({ data: { tenantId: '  acme  ' } as unknown as Socket['data'] });

      expect(getOrInitSocketTenantId(socket)).toBe('acme');
    });

    it('initializes tenantId from handshake x-tenant header', () => {
      const socket = mockSocket({ handshake: { headers: { 'x-tenant': 'default' }, auth: {} } as never });

      expect(getOrInitSocketTenantId(socket)).toBe('default');
      expect((socket as unknown as { data: Record<string, unknown> }).data['tenantId']).toBe('default');
    });

    it('falls back to handshake auth tenantId', () => {
      const socket = mockSocket({ handshake: { headers: {}, auth: { tenantId: 'default' } } as never });

      expect(getOrInitSocketTenantId(socket)).toBe('default');
    });

    it('returns undefined when tenant cannot be resolved', () => {
      const socket = mockSocket({
        handshake: { headers: undefined, auth: { tenantId: 'not-configured' } } as never,
      });

      expect(getOrInitSocketTenantId(socket)).toBeUndefined();
    });
  });

  describe('TenantAwareSocketIoAdapter', () => {
    it('disconnects sockets without a valid tenant', () => {
      const serverHandlers: Record<string, (socket: Socket) => void> = {};
      const fakeServer = {
        on: (event: string, handler: (socket: Socket) => void) => {
          serverHandlers[event] = handler;
          return fakeServer;
        },
      } as unknown as { on: (event: string, handler: (socket: Socket) => void) => unknown };

      const ioSpy = jest.spyOn(IoAdapter.prototype, 'createIOServer').mockReturnValue(fakeServer as never);

      const adapter = new TenantAwareSocketIoAdapter(undefined);
      adapter.createIOServer(0);

      const disconnect = jest.fn();
      const socket = {
        data: {},
        handshake: { headers: undefined, auth: { tenantId: 'not-configured' } },
        disconnect,
        use: jest.fn(),
      } as unknown as Socket;

      serverHandlers['connection'](socket);

      expect(disconnect).toHaveBeenCalledWith(true);

      ioSpy.mockRestore();
    });

    it('wraps inbound socket packets in runWithCorrelationId and runWithTenantId', () => {
      const correlationSpy = jest.spyOn(correlationStorage, 'runWithCorrelationId');
      const tenantSpy = jest.spyOn(tenantStorage, 'runWithTenantId');

      const serverHandlers: Record<string, (socket: Socket) => void> = {};
      const fakeServer = {
        on: (event: string, handler: (socket: Socket) => void) => {
          serverHandlers[event] = handler;
          return fakeServer;
        },
      } as unknown as { on: (event: string, handler: (socket: Socket) => void) => unknown };

      const ioSpy = jest.spyOn(IoAdapter.prototype, 'createIOServer').mockReturnValue(fakeServer as never);

      const adapter = new TenantAwareSocketIoAdapter(undefined);
      adapter.createIOServer(0);

      let packetMiddleware: ((packet: unknown, next: () => void) => void) | undefined;
      const socket = {
        data: {},
        handshake: { headers: { 'x-tenant': 'default', 'x-correlation-id': 'corr-1' }, auth: {} },
        disconnect: jest.fn(),
        use: (fn: (packet: unknown, next: () => void) => void) => {
          packetMiddleware = fn;
        },
      } as unknown as Socket;

      serverHandlers['connection'](socket);

      const next = jest.fn();
      packetMiddleware?.(['event', { a: 1 }], next);

      expect(correlationSpy).toHaveBeenCalled();
      expect(tenantSpy).toHaveBeenCalledWith('default', expect.any(Function));
      expect(next).toHaveBeenCalled();

      correlationSpy.mockRestore();
      tenantSpy.mockRestore();
      ioSpy.mockRestore();
    });

    it('rejects packets when tenant cannot be resolved in middleware', () => {
      const serverHandlers: Record<string, (socket: Socket) => void> = {};
      const fakeServer = {
        on: (event: string, handler: (socket: Socket) => void) => {
          serverHandlers[event] = handler;
          return fakeServer;
        },
      } as unknown as { on: (event: string, handler: (socket: Socket) => void) => unknown };

      const ioSpy = jest.spyOn(IoAdapter.prototype, 'createIOServer').mockReturnValue(fakeServer as never);

      const adapter = new TenantAwareSocketIoAdapter(undefined);
      adapter.createIOServer(0);

      let packetMiddleware: ((packet: unknown, next: (error?: Error) => void) => void) | undefined;
      const socket = {
        data: {},
        handshake: { headers: { 'x-tenant': 'default' }, auth: {} },
        disconnect: jest.fn(),
        use: (fn: (packet: unknown, next: (error?: Error) => void) => void) => {
          packetMiddleware = fn;
        },
      } as unknown as Socket;

      serverHandlers['connection'](socket);

      (socket as unknown as { data: Record<string, unknown> }).data = {};
      (socket as unknown as { handshake: { headers?: undefined; auth: Record<string, unknown> } }).handshake = {
        headers: undefined,
        auth: { tenantId: 'not-configured' },
      };

      const next = jest.fn();
      packetMiddleware?.(['event'], next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Invalid tenant' }));

      ioSpy.mockRestore();
    });
  });
});
