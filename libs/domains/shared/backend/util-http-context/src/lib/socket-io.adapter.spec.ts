import { IoAdapter } from '@nestjs/platform-socket.io';
import type { Socket } from 'socket.io';

import { getOrInitSocketCorrelationId, readIncomingCorrelationIdFromHeaders } from './socket-io.adapter';
import { CorrelationAwareSocketIoAdapter } from './socket-io.adapter';
import * as correlationStorage from './correlation-id.storage';

describe('socket-io.adapter helpers', () => {
  describe('readIncomingCorrelationIdFromHeaders', () => {
    it('prefers x-correlation-id over x-request-id', () => {
      expect(
        readIncomingCorrelationIdFromHeaders({
          'x-correlation-id': 'corr-1',
          'x-request-id': 'req-1',
        }),
      ).toBe('corr-1');
    });

    it('falls back to x-request-id', () => {
      expect(readIncomingCorrelationIdFromHeaders({ 'x-request-id': 'req-2' })).toBe('req-2');
    });

    it('trims and truncates overly long ids', () => {
      const long = `  ${'a'.repeat(200)}  `;
      const out = readIncomingCorrelationIdFromHeaders({ 'x-correlation-id': long });
      expect(out?.length).toBe(128);
    });

    it('returns undefined for empty values', () => {
      expect(readIncomingCorrelationIdFromHeaders({ 'x-correlation-id': '   ' })).toBeUndefined();
      expect(readIncomingCorrelationIdFromHeaders(undefined)).toBeUndefined();
    });
  });

  describe('getOrInitSocketCorrelationId', () => {
    function mockSocket(overrides: Partial<Socket> = {}): Socket {
      return {
        data: {},
        handshake: { headers: {} },
        ...overrides,
      } as unknown as Socket;
    }

    it('uses existing socket.data correlationId when present', () => {
      const socket = mockSocket({ data: { correlationId: 'existing' } as unknown as Socket['data'] });
      expect(getOrInitSocketCorrelationId(socket)).toBe('existing');
      expect((socket as unknown as { data: Record<string, unknown> }).data['correlationId']).toBe('existing');
    });

    it('initializes correlationId from handshake headers', () => {
      const socket = mockSocket({ handshake: { headers: { 'x-request-id': 'req-9' } } as never });
      expect(getOrInitSocketCorrelationId(socket)).toBe('req-9');
      expect((socket as unknown as { data: Record<string, unknown> }).data['correlationId']).toBe('req-9');
    });

    it('generates an id when neither data nor headers provide one', () => {
      const socket = mockSocket();
      const id = getOrInitSocketCorrelationId(socket);
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(10);
      expect((socket as unknown as { data: Record<string, unknown> }).data['correlationId']).toBe(id);
    });
  });

  describe('CorrelationAwareSocketIoAdapter', () => {
    it('wraps inbound socket packets in runWithCorrelationId', () => {
      const runSpy = jest.spyOn(correlationStorage, 'runWithCorrelationId');

      const serverHandlers: Record<string, (socket: Socket) => void> = {};
      const fakeServer = {
        on: (event: string, handler: (socket: Socket) => void) => {
          serverHandlers[event] = handler;
          return fakeServer;
        },
      } as unknown as { on: (event: string, handler: (socket: Socket) => void) => unknown };

      const ioSpy = jest.spyOn(IoAdapter.prototype, 'createIOServer').mockReturnValue(fakeServer as never);

      const adapter = new CorrelationAwareSocketIoAdapter(undefined);
      adapter.createIOServer(0);

      expect(typeof serverHandlers['connection']).toBe('function');

      let packetMiddleware: ((packet: unknown, next: () => void) => void) | undefined;
      const socket = {
        data: {},
        handshake: { headers: { 'x-correlation-id': 'sock-corr' } },
        use: (fn: (packet: unknown, next: () => void) => void) => {
          packetMiddleware = fn;
        },
      } as unknown as Socket;

      serverHandlers['connection'](socket);

      expect(packetMiddleware).toBeDefined();

      const next = jest.fn();
      packetMiddleware?.(['event', { a: 1 }], next);

      expect(runSpy).toHaveBeenCalled();
      expect(runSpy.mock.calls[0][0]).toBe('sock-corr');
      expect(next).toHaveBeenCalled();

      runSpy.mockRestore();
      ioSpy.mockRestore();
    });
  });
});
