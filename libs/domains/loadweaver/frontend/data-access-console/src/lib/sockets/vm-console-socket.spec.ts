import { TestBed } from '@angular/core/testing';

import type { VmConsoleSocketEvent } from '../types/virtual-machines.types';
import { ConsoleSocketService } from './console-socket';
import { VmConsoleSocketClient } from './vm-console-socket';

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

describe('VmConsoleSocketClient (3.35)', () => {
  it('speaks the consoles protocol: serial text and VNC binary', async () => {
    const socket = fakeSocket();
    const sockets = { open: jest.fn().mockResolvedValue(socket) };

    TestBed.configureTestingModule({
      providers: [VmConsoleSocketClient, { provide: ConsoleSocketService, useValue: sockets }],
    });

    const client = TestBed.inject(VmConsoleSocketClient);
    const events: VmConsoleSocketEvent[] = [];

    client.events$.subscribe((event) => events.push(event));
    expect(await client.connect()).toBe(true);
    expect(sockets.open).toHaveBeenCalledWith('consoles');

    const serial = client.open('shop/lw-vm/db1/0', 'serial', { cols: 120, rows: 30 });
    const vnc = client.open('shop/lw-vm/db1/0', 'vnc');
    const bytes = new Uint8Array([1, 2, 3]).buffer;

    client.input(serial, 'root\r');
    client.input(vnc, bytes);
    client.resize(serial, 100, 40);
    client.close(vnc);

    expect(socket.emit.mock.calls).toEqual([
      ['openConsole', { sessionId: serial, replica: 'shop/lw-vm/db1/0', kind: 'serial', cols: 120, rows: 30 }],
      ['openConsole', { sessionId: vnc, replica: 'shop/lw-vm/db1/0', kind: 'vnc' }],
      ['consoleInput', { sessionId: serial, data: 'root\r' }],
      ['consoleInput', { sessionId: vnc, data: bytes }],
      ['consoleResize', { sessionId: serial, cols: 100, rows: 40 }],
      ['closeConsole', { sessionId: vnc }],
    ]);

    socket.handlers['consoleOpened']({ sessionId: vnc, kind: 'vnc', recorded: false });
    socket.handlers['consoleOutput']({ sessionId: serial, data: 'login: ' });
    socket.handlers['consoleOutput']({ sessionId: vnc, data: new Uint8Array([82, 70, 66]) });
    socket.handlers['consoleClosed']({ sessionId: vnc, exitCode: 0 });
    socket.handlers['error']({ sessionId: serial, message: 'not allowed' });

    expect(events[0]).toEqual({ type: 'opened', sessionId: vnc, kind: 'vnc', recorded: false });
    expect(events[1]).toEqual({ type: 'output', sessionId: serial, data: 'login: ' });
    expect(events[2]).toMatchObject({ type: 'output', sessionId: vnc });
    expect([...new Uint8Array((events[2] as { data: ArrayBuffer }).data)]).toEqual([82, 70, 66]);
    expect(events.slice(3)).toEqual([
      { type: 'closed', sessionId: vnc, exitCode: 0 },
      { type: 'error', sessionId: serial, message: 'not allowed' },
    ]);
  });
});
