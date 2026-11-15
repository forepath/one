import { EventEmitter } from 'events';
import { Socket } from 'net';

import { isTcpPortOpen, waitForTcpPort } from './wait-for-tcp-port.util';

jest.mock('net', () => {
  const actual = jest.requireActual<typeof import('net')>('net');

  return {
    ...actual,
    Socket: jest.fn(),
  };
});

class FakeSocket extends EventEmitter {
  destroy = jest.fn();
  setTimeout = jest.fn();
  connect = jest.fn((_port: number, _host: string) => undefined);
}

describe('wait-for-tcp-port.util', () => {
  const MockSocket = Socket as unknown as jest.Mock;

  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('isTcpPortOpen', () => {
    it('resolves true on connect', async () => {
      const socket = new FakeSocket();

      MockSocket.mockImplementation(() => socket);

      const promise = isTcpPortOpen('1.2.3.4', 22, 1000);

      socket.emit('connect');

      await expect(promise).resolves.toBe(true);
      expect(socket.destroy).toHaveBeenCalled();
    });

    it('resolves false on timeout', async () => {
      const socket = new FakeSocket();

      MockSocket.mockImplementation(() => socket);

      const promise = isTcpPortOpen('1.2.3.4', 22, 1000);

      socket.emit('timeout');

      await expect(promise).resolves.toBe(false);
    });

    it('resolves false on error and ignores a second finish', async () => {
      const socket = new FakeSocket();

      MockSocket.mockImplementation(() => socket);

      const promise = isTcpPortOpen('1.2.3.4', 22, 1000);

      socket.emit('error', new Error('ECONNREFUSED'));
      socket.emit('connect');

      await expect(promise).resolves.toBe(false);
      expect(socket.destroy).toHaveBeenCalledTimes(1);
    });
  });

  describe('waitForTcpPort', () => {
    it('returns once the port accepts a connection', async () => {
      let attempt = 0;

      MockSocket.mockImplementation(() => {
        const socket = new FakeSocket();

        attempt += 1;
        const current = attempt;

        setImmediate(() => {
          if (current === 1) {
            socket.emit('error', new Error('refused'));
          } else {
            socket.emit('connect');
          }
        });

        return socket;
      });

      await expect(
        waitForTcpPort('1.2.3.4', 22, {
          timeoutMs: 1_000,
          pollIntervalMs: 10,
          connectTimeoutMs: 50,
        }),
      ).resolves.toBeUndefined();
      expect(attempt).toBeGreaterThanOrEqual(2);
    });

    it('throws when the deadline elapses without a connection', async () => {
      MockSocket.mockImplementation(() => {
        const socket = new FakeSocket();

        setImmediate(() => socket.emit('timeout'));

        return socket;
      });

      await expect(
        waitForTcpPort('1.2.3.4', 22, {
          timeoutMs: 60,
          pollIntervalMs: 15,
          connectTimeoutMs: 10,
        }),
      ).rejects.toThrow('Timed out waiting for 1.2.3.4:22 after 60ms');
    });
  });
});
