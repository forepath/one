import * as net from 'node:net';

import { FrameConnection } from './connection';
import { MICROVM_BRIDGE_PROTOCOL_VERSION } from './constants';
import { DataChannel, Frame, FrameType, decodeData, decodeJson } from './frame';
import { BootConfig, parseErrorMessage, parseExecRequest } from './messages';

/** Stream ids: 0 control, 1 workload output, 2.. allocated by the launcher daemon for exec and TCP streams. */
export const CONTROL_STREAM = 0;
export const WORKLOAD_STREAM = 1;
const FIRST_DYNAMIC_STREAM = 2;

/** Exit status of the launcher when the guest went away without reporting a workload exit. */
export const MICROVM_UNEXPECTED_STOP_EXIT_CODE = 255;

export interface HostDaemonOptions {
  boot: BootConfig;
  /** Guest TCP ports exposed on the container's network namespace (e.g. 4096, 6080). */
  forwardPorts: number[];
  /** How long exec/TCP requests wait for the guest agent before failing. */
  readyTimeoutMs: number;
  /** Grace period the guest gives the workload after a stop request before SIGKILL. */
  stopGraceSeconds: number;
  stdout: (data: Buffer, done: () => void) => void;
  stderr: (data: Buffer, done: () => void) => void;
  log: (message: string) => void;
}

interface RelayedExec {
  client: FrameConnection;
  clientStream: number;
  socket: net.Socket;
  /** Client frames received before the guest got the session (the guest may still be booting). */
  queued: Frame[] | null;
}

/**
 * Launcher-side bridge endpoint. It speaks to the guest agent over the virtio-serial socket and
 *  - hands the workload configuration to the guest and relays the workload's stdout/stderr to the container,
 *  - relays exec sessions of `vm-exec` clients (UNIX socket) end to end, including flow control,
 *  - terminates TCP connections on the forwarded container ports and tunnels them into the guest,
 *  - turns a container stop into a guest stop and reports the workload's exit status.
 */
export class HostDaemon {
  private guest: FrameConnection | null = null;
  private ready = false;
  private nextStream = FIRST_DYNAMIC_STREAM;
  private readonly execs = new Map<number, RelayedExec>();
  private readonly tcp = new Map<number, net.Socket>();
  private readonly pending: { run: () => void; fail: (message: string) => void; timer: NodeJS.Timeout }[] = [];
  private workloadExit: number | null = null;
  private stopRequested = false;

  constructor(private readonly options: HostDaemonOptions) {}

  get workloadExitCode(): number | null {
    return this.workloadExit;
  }

  get isReady(): boolean {
    return this.ready;
  }

  /** Attach the guest transport (virtio-serial socket). */
  attachGuest(socket: net.Socket | (NodeJS.ReadWriteStream & { write(chunk: Buffer): boolean })): void {
    const connection = new FrameConnection({
      write: (bytes) => {
        socket.write(bytes);
      },
      onFrame: (frame) => this.onGuestFrame(frame),
      onProtocolError: (error) => {
        this.options.log(`guest bridge protocol error: ${error.message}`);
        (socket as net.Socket).destroy?.();
      },
    });

    this.guest = connection;
    connection.openOutbound(CONTROL_STREAM);
    socket.on('data', (chunk: Buffer) => connection.receive(chunk));
  }

  /** The guest transport closed (QEMU exited). Fails everything still open. */
  detachGuest(): void {
    this.guest = null;
    this.ready = false;

    for (const entry of this.pending.splice(0)) {
      clearTimeout(entry.timer);
      entry.fail('the microVM stopped');
    }

    for (const [stream, relay] of this.execs) {
      relay.client.sendJson(FrameType.Error, relay.clientStream, { message: 'the microVM stopped' });
      relay.socket.end();
      this.execs.delete(stream);
    }

    for (const [stream, socket] of this.tcp) {
      socket.destroy();
      this.tcp.delete(stream);
    }
  }

  /** Ask the guest to stop the workload (container stop). */
  requestStop(): void {
    this.stopRequested = true;

    if (this.guest && this.ready) {
      this.guest.sendJson(FrameType.Stop, CONTROL_STREAM, { graceSeconds: this.options.stopGraceSeconds });
    }
  }

  /** Serve one `vm-exec` client connection. */
  handleExecClient(socket: net.Socket): void {
    const client = new FrameConnection({
      write: (bytes) => {
        socket.write(bytes);
      },
      onFrame: (frame) => this.onClientFrame(client, socket, frame),
      onProtocolError: () => socket.destroy(),
    });

    socket.on('data', (chunk: Buffer) => client.receive(chunk));
    socket.on('error', () => undefined);
    socket.on('close', () => {
      for (const [stream, relay] of this.execs) {
        if (relay.client === client) {
          this.execs.delete(stream);

          if (relay.queued === null) {
            this.guest?.send(FrameType.Signal, stream, Buffer.from('SIGHUP'));
            this.guest?.send(FrameType.Close, stream);
          }
        }
      }
    });
  }

  /** Serve one TCP connection on a forwarded container port. */
  handleTcpConnection(socket: net.Socket, port: number): void {
    socket.pause();
    socket.on('error', () => undefined);
    this.whenReady(
      () => {
        const guest = this.guest;

        if (!guest || socket.destroyed) {
          socket.destroy();

          return;
        }

        const stream = this.allocateStream();

        this.tcp.set(stream, socket);
        guest.openOutbound(stream);
        guest.sendJson(FrameType.OpenTcp, stream, { port });
        socket.on('data', (chunk: Buffer) => {
          if (!guest.sendData(stream, DataChannel.Stdin, chunk)) {
            socket.pause();
            guest.whenWritable(stream, () => socket.resume());
          }
        });
        socket.on('end', () => guest.whenWritable(stream, () => guest.send(FrameType.Eof, stream, Buffer.from([0]))));
        socket.on('close', () => {
          if (this.tcp.delete(stream)) {
            guest.closeOutbound(stream);
            guest.send(FrameType.Close, stream);
          }
        });
        socket.resume();
      },
      () => socket.destroy(),
    );
  }

  private onClientFrame(client: FrameConnection, socket: net.Socket, frame: Frame): void {
    if (frame.type === FrameType.OpenExec) {
      let request;

      try {
        request = parseExecRequest(decodeJson(frame.payload));
      } catch (error) {
        client.sendJson(FrameType.Error, frame.stream, { message: (error as Error).message });

        return;
      }

      const stream = this.allocateStream();
      const relay: RelayedExec = { client, clientStream: frame.stream, socket, queued: [] };

      this.execs.set(stream, relay);
      this.whenReady(
        () => {
          if (!this.execs.has(stream)) {
            return;
          }

          if (!this.guest || socket.destroyed) {
            this.execs.delete(stream);
            client.sendJson(FrameType.Error, frame.stream, { message: 'the microVM is not running' });

            return;
          }

          this.guest.sendJson(FrameType.OpenExec, stream, request);

          for (const queued of relay.queued ?? []) {
            this.forwardClientFrame(stream, queued);
          }

          relay.queued = null;
        },
        (message) => {
          this.execs.delete(stream);
          client.sendJson(FrameType.Error, frame.stream, { message });
        },
      );

      return;
    }

    const stream = this.globalStreamFor(client, frame.stream);
    const relay = stream === null ? undefined : this.execs.get(stream);

    if (stream === null || !relay) {
      return;
    }

    if (relay.queued) {
      relay.queued.push(frame);

      return;
    }

    this.forwardClientFrame(stream, frame);
  }

  private forwardClientFrame(stream: number, frame: Frame): void {
    if (!this.guest) {
      return;
    }

    if (frame.type === FrameType.Close) {
      this.execs.delete(stream);
    }

    if (
      frame.type === FrameType.Data ||
      frame.type === FrameType.Eof ||
      frame.type === FrameType.Window ||
      frame.type === FrameType.Resize ||
      frame.type === FrameType.Signal ||
      frame.type === FrameType.Close
    ) {
      this.guest.sendControl(frame.type, stream, frame.payload);
    }
  }

  private onGuestFrame(frame: Frame): void {
    if (frame.stream === CONTROL_STREAM) {
      this.onControlFrame(frame);

      return;
    }

    if (frame.stream === WORKLOAD_STREAM) {
      if (frame.type === FrameType.Data) {
        const { channel, data } = decodeData(frame.payload);
        const write = channel === DataChannel.Stderr ? this.options.stderr : this.options.stdout;

        write(data, () => this.guest?.grant(WORKLOAD_STREAM, data.length));
      }

      return;
    }

    const relay = this.execs.get(frame.stream);

    if (relay) {
      relay.client.sendControl(frame.type, relay.clientStream, frame.payload);

      if (frame.type === FrameType.Close) {
        this.execs.delete(frame.stream);
      }

      return;
    }

    const socket = this.tcp.get(frame.stream);

    if (!socket) {
      return;
    }

    switch (frame.type) {
      case FrameType.Data: {
        const { data } = decodeData(frame.payload);

        socket.write(data, () => this.guest?.grant(frame.stream, data.length));
        break;
      }

      case FrameType.Eof:
        socket.end();
        break;
      case FrameType.Error:
        this.options.log(`forwarded connection failed: ${parseErrorMessage(safeJson(frame.payload))}`);
        this.tcp.delete(frame.stream);
        this.guest?.closeOutbound(frame.stream);
        socket.destroy();
        break;
      case FrameType.Close:
        this.tcp.delete(frame.stream);
        this.guest?.closeOutbound(frame.stream);
        socket.destroy();
        break;
      default:
        break;
    }
  }

  private onControlFrame(frame: Frame): void {
    const guest = this.guest;

    if (!guest) {
      return;
    }

    switch (frame.type) {
      case FrameType.Hello: {
        const hello = safeJson(frame.payload) as { version?: unknown } | null;

        if (hello?.version !== MICROVM_BRIDGE_PROTOCOL_VERSION) {
          this.options.log(
            `guest agent speaks protocol ${String(hello?.version)}, expected ${MICROVM_BRIDGE_PROTOCOL_VERSION}`,
          );
          guest.sendJson(FrameType.Stop, CONTROL_STREAM, { graceSeconds: 0 });

          return;
        }

        guest.sendJson(FrameType.Boot, CONTROL_STREAM, this.options.boot);
        break;
      }

      case FrameType.Ready:
        this.ready = true;
        this.options.log('workload started in the microVM');

        for (const entry of this.pending.splice(0)) {
          clearTimeout(entry.timer);
          entry.run();
        }

        if (this.stopRequested) {
          this.requestStop();
        }

        break;
      case FrameType.WorkloadExit: {
        const message = safeJson(frame.payload) as { code?: unknown } | null;
        const code = typeof message?.code === 'number' && Number.isInteger(message.code) ? message.code : 1;

        this.workloadExit = Math.min(Math.max(code, 0), 255);
        this.options.log(`workload exited with status ${this.workloadExit}`);
        break;
      }

      case FrameType.Error:
        this.options.log(`guest agent error: ${parseErrorMessage(safeJson(frame.payload))}`);
        break;
      default:
        break;
    }
  }

  private whenReady(run: () => void, fail: (message: string) => void): void {
    if (this.ready) {
      run();

      return;
    }

    const entry = {
      run,
      fail,
      timer: setTimeout(() => {
        const index = this.pending.indexOf(entry);

        if (index >= 0) {
          this.pending.splice(index, 1);
        }

        fail('the microVM did not become ready in time');
      }, this.options.readyTimeoutMs),
    };

    this.pending.push(entry);
  }

  private allocateStream(): number {
    const stream = this.nextStream;

    this.nextStream = this.nextStream >= 0xfffffff0 ? FIRST_DYNAMIC_STREAM : this.nextStream + 1;

    return stream;
  }

  private globalStreamFor(client: FrameConnection, clientStream: number): number | null {
    for (const [stream, relay] of this.execs) {
      if (relay.client === client && relay.clientStream === clientStream) {
        return stream;
      }
    }

    return null;
  }
}

function safeJson(payload: Buffer): unknown {
  try {
    return decodeJson(payload);
  } catch {
    return null;
  }
}
