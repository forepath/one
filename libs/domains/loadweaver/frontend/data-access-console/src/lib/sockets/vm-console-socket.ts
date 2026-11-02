import { inject, Injectable, OnDestroy } from '@angular/core';
import { Subject, type Observable } from 'rxjs';
import type { Socket } from 'socket.io-client';

import type { VmConsoleKind, VmConsoleSocketEvent } from '../types/virtual-machines.types';
import { ConsoleSocketService } from './console-socket';
import { newTerminalSessionId } from './terminal-socket';

function toArrayBuffer(data: unknown): ArrayBuffer | null {
  if (data instanceof ArrayBuffer) return data;

  if (ArrayBuffer.isView(data)) {
    const view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const copy = new Uint8Array(view.byteLength);

    copy.set(view);

    return copy.buffer;
  }

  return null;
}

/**
 * One `socket/consoles` connection for a page (provide it in the component): VM serial and graphical consoles
 * (3.35). Out: `openConsole` { sessionId, replica `<p>/lw-vm/<name>/0`, kind, cols, rows } / `consoleInput` (serial
 * text, VNC binary) / `consoleResize` / `closeConsole`; in: `consoleOpened` / `consoleOutput` / `consoleClosed` /
 * `error`, as `events$`. Sessions belong to the socket: a disconnect ends them on the server.
 */
@Injectable()
export class VmConsoleSocketClient implements OnDestroy {
  private readonly sockets = inject(ConsoleSocketService);
  private readonly subject = new Subject<VmConsoleSocketEvent>();
  private socket: Socket | null = null;
  private connecting: Promise<Socket | null> | null = null;
  private generation = 0;
  private destroyed = false;

  readonly events$: Observable<VmConsoleSocketEvent> = this.subject.asObservable();

  get connected(): boolean {
    return !!this.socket?.connected;
  }

  /** Opens the socket once; `false` without a URL or credentials (or when destroyed meanwhile). */
  async connect(): Promise<boolean> {
    if (this.destroyed) return false;

    if (this.socket) {
      if (this.socket.connected || this.socket.active) return true;

      this.disconnect();
    }

    const generation = this.generation;

    this.connecting ??= this.sockets.open('consoles').catch(() => null);

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
      this.subject.next({ type: 'connection', connected: false, error: 'No console connection (not signed in?)' });

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
    socket.on('consoleOpened', (event: { sessionId: string; kind: VmConsoleKind; recorded?: boolean }) =>
      this.subject.next({
        type: 'opened',
        sessionId: event?.sessionId,
        kind: event?.kind,
        recorded: !!event?.recorded,
      }),
    );
    socket.on('consoleOutput', (event: { sessionId: string; data: unknown }) => {
      const data = typeof event?.data === 'string' ? event.data : toArrayBuffer(event?.data);

      if (data !== null) this.subject.next({ type: 'output', sessionId: event.sessionId, data });
    });
    socket.on('consoleClosed', (event: { sessionId: string; exitCode?: number | null; error?: string }) =>
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
        message: event?.message || 'Console error',
      }),
    );
  }

  /** Opens a console; returns its session id (Socket.IO buffers emits until connected). */
  open(replica: string, kind: VmConsoleKind, size?: { cols: number; rows: number }): string {
    const sessionId = newTerminalSessionId();

    this.socket?.emit('openConsole', {
      sessionId,
      replica,
      kind,
      ...(size && size.cols > 0 && size.rows > 0 ? { cols: size.cols, rows: size.rows } : {}),
    });

    return sessionId;
  }

  /** Serial: UTF-8 text; VNC: binary RFB. */
  input(sessionId: string, data: string | ArrayBuffer): void {
    this.socket?.emit('consoleInput', { sessionId, data });
  }

  resize(sessionId: string, cols: number, rows: number): void {
    if (cols > 0 && rows > 0) this.socket?.emit('consoleResize', { sessionId, cols, rows });
  }

  close(sessionId: string): void {
    this.socket?.emit('closeConsole', { sessionId });
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
