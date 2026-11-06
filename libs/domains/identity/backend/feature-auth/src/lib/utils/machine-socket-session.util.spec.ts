import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  socketBroadcastRooms,
  socketRoomsForUser,
  type SocketEventScopes,
  type SocketUserInfo,
  UserRole,
} from '@forepath/identity/backend';
import { Server, type Socket } from 'socket.io';
import { io as connectClient, type Socket as ClientSocket } from 'socket.io-client';

import {
  attachMachineSocketSession,
  MACHINE_SOCKET_SESSION_INVALID_MESSAGE,
  type MachineSessionSocket,
} from './machine-socket-session.util';

const INBOUND: SocketEventScopes = {
  read: ['websocket:test:read', 'tickets:read'],
  write: ['websocket:test:write', 'tickets:write'],
};
const OUTBOUND: SocketEventScopes = {
  ticketUpsert: ['tickets:read'],
  secretChanged: ['secrets:read'],
};
const machine = (scopes: string[], exp?: number): SocketUserInfo => ({
  userId: 'u1',
  userRole: UserRole.USER,
  isApiKeyAuth: false,
  amr: ['pat'],
  scopes,
  exp,
  user: { id: 'u1', roles: ['user'], amr: ['pat'], scopes },
});
const interactive: SocketUserInfo = {
  userId: 'u1',
  userRole: UserRole.USER,
  isApiKeyAuth: false,
  amr: ['pwd'],
  user: { id: 'u1', roles: ['user'], amr: ['pwd'] },
};

function fakeSocket() {
  const middlewares: Array<(packet: unknown[], next: (err?: Error) => void) => void> = [];
  const listeners: Record<string, Array<() => void>> = {};
  const socket = {
    id: 'fake',
    use: jest.fn((fn) => middlewares.push(fn)),
    on: jest.fn((event: string, fn: () => void) => (listeners[event] ??= []).push(fn)),
    emit: jest.fn(),
    disconnect: jest.fn(),
  } satisfies MachineSessionSocket;

  return {
    socket,
    /** Runs the middleware and resolves with whether `next()` was called. */
    send: async (event: string) => {
      const next = jest.fn();

      middlewares[0]([event, {}], next);

      // queue + revalidate promises
      for (let i = 0; i < 10; i++) {
        await Promise.resolve();
      }

      return next.mock.calls.length > 0;
    },
    fireDisconnect: () => listeners['disconnect']?.forEach((fn) => fn()),
  };
}

describe('attachMachineSocketSession', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('is a no-op for interactive sockets', () => {
    const { socket } = fakeSocket();

    attachMachineSocketSession(socket, interactive, { inboundEvents: INBOUND, revalidate: jest.fn() });

    expect(socket.use).not.toHaveBeenCalled();
    expect(socket.on).not.toHaveBeenCalled();
  });

  it('rejects unlisted and unscoped inbound events without re-validation', async () => {
    const { socket, send } = fakeSocket();
    const revalidate = jest.fn();
    const user = machine(['websocket:test:read', 'tickets:read']);

    attachMachineSocketSession(socket, user, { inboundEvents: INBOUND, revalidate, revalidateIntervalMs: 60_000 });

    await expect(send('write')).resolves.toBe(false);
    await expect(send('createTerminal')).resolves.toBe(false);
    expect(socket.emit).toHaveBeenCalledWith('error', { message: 'Insufficient token scope for event: write' });
    expect(socket.emit).toHaveBeenCalledWith('error', {
      message: 'Insufficient token scope for event: createTerminal',
    });
    expect(revalidate).not.toHaveBeenCalled();
  });

  it('re-validates the session before every permitted inbound event', async () => {
    const { socket, send } = fakeSocket();
    const user = machine(['websocket:test:read', 'tickets:read']);
    const revalidate = jest.fn().mockResolvedValue(user);

    attachMachineSocketSession(socket, user, { inboundEvents: INBOUND, revalidate, revalidateIntervalMs: 60_000 });

    await expect(send('read')).resolves.toBe(true);
    await expect(send('read')).resolves.toBe(true);
    expect(revalidate).toHaveBeenCalledTimes(2);
  });

  it('closes the socket when the session was revoked', async () => {
    const { socket, send } = fakeSocket();
    const user = machine(['websocket:test:read', 'tickets:read']);

    attachMachineSocketSession(socket, user, {
      inboundEvents: INBOUND,
      revalidate: jest.fn().mockResolvedValue(null),
      revalidateIntervalMs: 60_000,
    });

    await expect(send('read')).resolves.toBe(false);
    expect(socket.emit).toHaveBeenCalledWith('error', { message: MACHINE_SOCKET_SESSION_INVALID_MESSAGE });
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('closes the socket when the live scopes changed', async () => {
    const { socket, send } = fakeSocket();
    const user = machine(['websocket:test:read', 'tickets:read']);

    attachMachineSocketSession(socket, user, {
      inboundEvents: INBOUND,
      revalidate: jest.fn().mockResolvedValue(machine(['websocket:test:read', 'tickets:read', 'tickets:write'])),
      revalidateIntervalMs: 60_000,
    });

    await expect(send('read')).resolves.toBe(false);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('closes the socket when re-validation throws', async () => {
    const { socket, send } = fakeSocket();

    attachMachineSocketSession(socket, machine(['websocket:test:read', 'tickets:read']), {
      inboundEvents: INBOUND,
      revalidate: jest.fn().mockRejectedValue(new Error('db down')),
      revalidateIntervalMs: 60_000,
    });

    await expect(send('read')).resolves.toBe(false);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('periodically re-validates listen-only sockets', async () => {
    jest.useFakeTimers();
    const { socket } = fakeSocket();
    const user = machine(['websocket:test:read']);
    const revalidate = jest.fn().mockResolvedValueOnce(user).mockResolvedValueOnce(null);

    attachMachineSocketSession(socket, user, { inboundEvents: INBOUND, revalidate, revalidateIntervalMs: 10_000 });

    await jest.advanceTimersByTimeAsync(10_000);
    expect(revalidate).toHaveBeenCalledTimes(1);
    expect(socket.disconnect).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(10_000);
    expect(revalidate).toHaveBeenCalledTimes(2);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('closes the socket when the token expires, without waiting for the interval', async () => {
    jest.useFakeTimers();
    const { socket } = fakeSocket();
    const exp = Math.floor(Date.now() / 1000) + 5;
    const user = machine(['websocket:test:read'], exp);
    const revalidate = jest.fn().mockResolvedValue(user);

    attachMachineSocketSession(socket, user, { inboundEvents: INBOUND, revalidate, revalidateIntervalMs: 60_000 });

    await jest.advanceTimersByTimeAsync(5_000);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(revalidate).not.toHaveBeenCalled();
  });

  it('stops re-validating after disconnect', async () => {
    jest.useFakeTimers();
    const { socket, fireDisconnect } = fakeSocket();
    const revalidate = jest.fn();

    attachMachineSocketSession(socket, machine(['websocket:test:read']), {
      inboundEvents: INBOUND,
      revalidate,
      revalidateIntervalMs: 10_000,
    });
    fireDisconnect();
    await jest.advanceTimersByTimeAsync(30_000);

    expect(revalidate).not.toHaveBeenCalled();
  });
});

describe('machine socket session over a real Socket.IO server', () => {
  let httpServer: HttpServer;
  let io: Server;
  let url: string;
  const clients: ClientSocket[] = [];
  let sessions: Map<string, SocketUserInfo | null>;
  let handled: string[];

  beforeEach(async () => {
    sessions = new Map();
    handled = [];
    httpServer = createServer();
    io = new Server(httpServer);

    const nsp = io.of('/test');

    // Mirrors the gateways: authenticate, store identity, attach the machine session guard.
    nsp.use((socket, next) => {
      const token = String(socket.handshake.auth?.token ?? '');
      const userInfo = sessions.get(token);

      if (!userInfo) {
        next(new Error('Unauthorized'));

        return;
      }

      socket.data = { userInfo };
      attachMachineSocketSession(socket, userInfo, {
        inboundEvents: INBOUND,
        revalidate: async () => sessions.get(token) ?? null,
        revalidateIntervalMs: 60_000,
      });
      next();
    });
    nsp.on('connection', (socket: Socket) => {
      for (const room of socketRoomsForUser(socket.data.userInfo, 'board', OUTBOUND)) {
        void socket.join(room);
      }

      socket.on('read', (_payload, ack?: (value: string) => void) => {
        handled.push('read');
        ack?.('ok');
      });
      socket.on('write', () => handled.push('write'));
    });

    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}/test`;
  });

  afterEach(async () => {
    clients.splice(0).forEach((client) => client.disconnect());
    await new Promise<void>((resolve) => io.close(() => resolve()));
  });

  const connect = async (token: string) => {
    const client = connectClient(url, { auth: { token }, transports: ['websocket'], reconnection: false });

    clients.push(client);
    await new Promise<void>((resolve, reject) => {
      client.once('connect', () => resolve());
      client.once('connect_error', reject);
    });

    return client;
  };
  const tick = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));

  it('dispatches permitted events and rejects unscoped ones with an error', async () => {
    sessions.set('pat', machine(['websocket:test:read', 'tickets:read']));
    const client = await connect('pat');
    const errors: unknown[] = [];

    client.on('error', (payload: unknown) => errors.push(payload));
    await expect(client.timeout(2_000).emitWithAck('read', {})).resolves.toBe('ok');
    client.emit('write', {});
    client.emit('createTerminal', {});
    await tick();

    expect(handled).toEqual(['read']);
    expect(errors).toEqual([
      { message: 'Insufficient token scope for event: write' },
      { message: 'Insufficient token scope for event: createTerminal' },
    ]);
  });

  it('delivers broadcasts only for permitted events and never via the shared room alone', async () => {
    sessions.set('pat', machine(['websocket:test:read', 'tickets:read']));
    sessions.set('pwd', interactive);
    const machineClient = await connect('pat');
    const interactiveClient = await connect('pwd');
    const machineEvents: string[] = [];
    const interactiveEvents: string[] = [];

    machineClient.onAny((event: string) => machineEvents.push(event));
    interactiveClient.onAny((event: string) => interactiveEvents.push(event));
    await tick();

    const nsp = io.of('/test');

    nsp.to(socketBroadcastRooms('board', 'ticketUpsert')).emit('ticketUpsert', {});
    nsp.to(socketBroadcastRooms('board', 'secretChanged')).emit('secretChanged', {});
    // A broadcaster that is not scope-aware only reaches interactive sockets (fail-closed).
    nsp.to('board').emit('legacyEvent', {});
    await tick();

    expect(machineEvents).toEqual(['ticketUpsert']);
    expect(interactiveEvents).toEqual(['ticketUpsert', 'secretChanged', 'legacyEvent']);
  });

  it('disconnects a machine socket on its next event once the token is revoked', async () => {
    sessions.set('pat', machine(['websocket:test:read', 'tickets:read']));
    const client = await connect('pat');
    const disconnected = new Promise<string>((resolve) => client.once('disconnect', resolve));
    const errors: unknown[] = [];

    client.on('error', (payload: unknown) => errors.push(payload));
    sessions.delete('pat');
    client.emit('read', {});

    await expect(disconnected).resolves.toBe('io server disconnect');
    expect(handled).toEqual([]);
    expect(errors).toEqual([{ message: MACHINE_SOCKET_SESSION_INVALID_MESSAGE }]);
  });

  it('leaves interactive sockets untouched', async () => {
    sessions.set('pwd', interactive);
    const client = await connect('pwd');

    client.emit('write', {});
    client.emit('unlisted', {});
    await tick();

    expect(handled).toEqual(['write']);
    expect(client.connected).toBe(true);
  });
});
