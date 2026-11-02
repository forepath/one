import { inject, Injectable, OnDestroy } from '@angular/core';
import { Subject, type Observable } from 'rxjs';
import type { Socket } from 'socket.io-client';

import type { CreateTerminalRequest, TerminalSocketEvent } from '../types/live.types';
import { ConsoleSocketService } from './console-socket';

let counter = 0;

/** A session id the gateway accepts (`[A-Za-z0-9_-]{1,64}`), unique in this browser. */
export function newTerminalSessionId(): string {
  counter = (counter + 1) % 1_000_000;

  return `t${Date.now().toString(36)}${counter.toString(36)}`;
}

/**
 * One `socket/terminals` connection for a page (provide it in the component): `createTerminal` / `terminalInput` /
 * `terminalResize` / `closeTerminal` out, `terminalCreated` / `terminalOutput` / `terminalClosed` / `error` in, as
 * `events$`. Sessions belong to the socket: a disconnect ends them on the server (`connection` false).
 */
@Injectable()
export class TerminalSocketClient implements OnDestroy {
  private readonly sockets = inject(ConsoleSocketService);
  private readonly subject = new Subject<TerminalSocketEvent>();
  private socket: Socket | null = null;
  private connecting: Promise<Socket | null> | null = null;
  /** Bumped by `disconnect()`: a connect started before it must not adopt its socket. */
  private generation = 0;
  private destroyed = false;

  readonly events$: Observable<TerminalSocketEvent> = this.subject.asObservable();

  get connected(): boolean {
    return !!this.socket?.connected;
  }

  /**
   * Opens the socket once; `false` without a URL or credentials, or when the client was disconnected / destroyed
   * while the socket was being opened (the new socket is closed then). A dead socket (neither connected nor
   * reconnecting — e.g. reconnection attempts exhausted) is replaced by a fresh one.
   */
  async connect(): Promise<boolean> {
    if (this.destroyed) return false;

    if (this.socket) {
      if (this.socket.connected || this.socket.active) return true;

      this.disconnect();
    }

    const generation = this.generation;

    this.connecting ??= this.sockets.open('terminals').catch(() => null);

    const socket = await this.connecting;

    if (this.destroyed || generation !== this.generation) {
      if (socket && socket !== this.socket) {
        socket.removeAllListeners();
        socket.disconnect();
      }

      return false;
    }

    if (!socket) {
      this.connecting = null;
      this.subject.next({ type: 'connection', connected: false, error: 'No terminal connection (not signed in?)' });

      return false;
    }

    if (this.socket !== socket) this.listen(socket);

    return true;
  }

  private listen(socket: Socket): void {
    this.socket = socket;
    socket.on('connect', () => this.subject.next({ type: 'connection', connected: true }));
    socket.on('disconnect', () => this.subject.next({ type: 'connection', connected: false }));
    socket.on('connect_error', (error: Error) =>
      this.subject.next({ type: 'connection', connected: false, error: error?.message || 'Connection failed' }),
    );
    socket.on('terminalCreated', (event: { sessionId: string; recorded?: boolean }) =>
      this.subject.next({ type: 'created', sessionId: event?.sessionId, recorded: !!event?.recorded }),
    );
    socket.on('terminalOutput', (event: { sessionId: string; data: string }) => {
      if (typeof event?.data === 'string')
        this.subject.next({ type: 'output', sessionId: event.sessionId, data: event.data });
    });
    socket.on('terminalClosed', (event: { sessionId: string; exitCode?: number | null; error?: string }) =>
      this.subject.next({
        type: 'closed',
        sessionId: event?.sessionId,
        exitCode: event?.exitCode ?? null,
        ...(event?.error ? { error: event.error } : {}),
      }),
    );
    socket.on('error', (event: { sessionId?: string; message?: string } | undefined) =>
      this.subject.next({
        type: 'error',
        ...(event?.sessionId ? { sessionId: event.sessionId } : {}),
        message: event?.message || 'Terminal error',
      }),
    );
  }

  /** Socket.IO buffers emits until connected. */
  create(request: CreateTerminalRequest): void {
    this.socket?.emit('createTerminal', request);
  }

  input(sessionId: string, data: string): void {
    this.socket?.emit('terminalInput', { sessionId, data });
  }

  resize(sessionId: string, cols: number, rows: number): void {
    this.socket?.emit('terminalResize', { sessionId, cols, rows });
  }

  close(sessionId: string): void {
    this.socket?.emit('closeTerminal', { sessionId });
  }

  disconnect(): void {
    const socket = this.socket;

    this.generation++;
    this.socket = null;
    this.connecting = null;

    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.disconnect();
    this.subject.complete();
  }
}
