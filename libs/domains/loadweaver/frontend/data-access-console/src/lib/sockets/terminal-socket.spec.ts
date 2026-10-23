import { TestBed } from '@angular/core/testing';

import type { TerminalSocketEvent } from '../types/live.types';
import { ConsoleSocketService } from './console-socket';
import { newTerminalSessionId, TerminalSocketClient } from './terminal-socket';

// The real socket service pulls in the identity lib (Keycloak, ES modules only).
jest.mock('./console-socket', () => ({ ConsoleSocketService: class {} }));

function fakeSocket() {
  const handlers: Record<string, (payload?: unknown) => void> = {};

  return {
    handlers,
    connected: true,
    active: true,
    on: jest.fn((event: string, handler: (payload?: unknown) => void) => (handlers[event] = handler)),
    emit: jest.fn(),
    removeAllListeners: jest.fn(),
    disconnect: jest.fn(),
  };
}

describe('TerminalSocketClient', () => {
  function create(socket: ReturnType<typeof fakeSocket> | null) {
    const sockets = { open: jest.fn().mockResolvedValue(socket) };

    TestBed.configureTestingModule({
      providers: [TerminalSocketClient, { provide: ConsoleSocketService, useValue: sockets }],
    });

    const client = TestBed.inject(TerminalSocketClient);
    const events: TerminalSocketEvent[] = [];

    client.events$.subscribe((event) => events.push(event));

    return { client, events, sockets };
  }

  it('makes valid session ids', () => {
    expect(newTerminalSessionId()).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(newTerminalSessionId()).not.toBe(newTerminalSessionId());
  });

  it('speaks the terminals protocol', async () => {
    const socket = fakeSocket();
    const { client, events, sockets } = create(socket);

    expect(await client.connect()).toBe(true);
    expect(await client.connect()).toBe(true);
    expect(sockets.open).toHaveBeenCalledTimes(1);
    expect(sockets.open).toHaveBeenCalledWith('terminals');

    client.create({ sessionId: 't1', target: { replica: 'shop/web/api/0' }, cols: 120, rows: 32 });
    client.input('t1', 'ls\r');
    client.resize('t1', 100, 30);
    client.close('t1');

    expect(socket.emit.mock.calls).toEqual([
      ['createTerminal', { sessionId: 't1', target: { replica: 'shop/web/api/0' }, cols: 120, rows: 32 }],
      ['terminalInput', { sessionId: 't1', data: 'ls\r' }],
      ['terminalResize', { sessionId: 't1', cols: 100, rows: 30 }],
      ['closeTerminal', { sessionId: 't1' }],
    ]);

    socket.handlers['connect']();
    socket.handlers['terminalCreated']({ sessionId: 't1', recorded: true });
    socket.handlers['terminalOutput']({ sessionId: 't1', data: 'hello' });
    socket.handlers['terminalClosed']({ sessionId: 't1', exitCode: 0 });
    socket.handlers['error']({ sessionId: 't2', message: 'forbidden' });
    socket.handlers['disconnect']();

    expect(events).toEqual([
      { type: 'connection', connected: true },
      { type: 'created', sessionId: 't1', recorded: true },
      { type: 'output', sessionId: 't1', data: 'hello' },
      { type: 'closed', sessionId: 't1', exitCode: 0 },
      { type: 'error', sessionId: 't2', message: 'forbidden' },
      { type: 'connection', connected: false },
    ]);

    TestBed.resetTestingModule();
    expect(socket.disconnect).toHaveBeenCalled();
  });

  it('reports a missing connection', async () => {
    const { client, events } = create(null);

    expect(await client.connect()).toBe(false);
    expect(events[0]).toMatchObject({ type: 'connection', connected: false });
  });

  it('replaces a dead socket (not connected, not reconnecting) with a fresh one', async () => {
    const dead = fakeSocket();
    const fresh = fakeSocket();
    const { client, sockets } = create(dead);

    expect(await client.connect()).toBe(true);

    // Still reconnecting: kept.
    dead.connected = false;
    expect(await client.connect()).toBe(true);
    expect(sockets.open).toHaveBeenCalledTimes(1);

    // Reconnection given up: disposed and reopened.
    dead.active = false;
    sockets.open.mockResolvedValue(fresh);
    expect(await client.connect()).toBe(true);
    expect(sockets.open).toHaveBeenCalledTimes(2);
    expect(dead.removeAllListeners).toHaveBeenCalled();
    expect(dead.disconnect).toHaveBeenCalled();

    client.input('t1', 'x');
    expect(fresh.emit).toHaveBeenCalledWith('terminalInput', { sessionId: 't1', data: 'x' });
    expect(dead.emit).not.toHaveBeenCalled();
  });

  it('closes a socket that opens after the client was destroyed', async () => {
    const socket = fakeSocket();
    let resolve!: (value: ReturnType<typeof fakeSocket>) => void;
    const { client, sockets } = create(null);

    sockets.open.mockReturnValue(new Promise((r) => (resolve = r)));

    const connecting = client.connect();

    client.ngOnDestroy();
    resolve(socket);

    expect(await connecting).toBe(false);
    expect(socket.disconnect).toHaveBeenCalled();
    expect(socket.on).not.toHaveBeenCalled();
    expect(await client.connect()).toBe(false);
    expect(sockets.open).toHaveBeenCalledTimes(1);
  });

  it('closes a socket that opens after a disconnect', async () => {
    const socket = fakeSocket();
    let resolve!: (value: ReturnType<typeof fakeSocket>) => void;
    const { client, sockets } = create(null);

    sockets.open.mockReturnValue(new Promise((r) => (resolve = r)));

    const connecting = client.connect();

    client.disconnect();
    resolve(socket);

    expect(await connecting).toBe(false);
    expect(socket.disconnect).toHaveBeenCalled();
    expect(client.connected).toBe(false);
  });
});
