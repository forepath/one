import { PassThrough, type Duplex } from 'node:stream';
import { createInterface } from 'node:readline';

import { Logger } from '@nestjs/common';
import type Docker from 'dockerode';

import { MANAGED_LABEL, WORKLOAD_LABEL } from '../workloads/workload-container';
import { VM_CONSOLE_PATH, VM_LABEL } from './guest-target';

/** Serial output kept per VM for "show boot log": replayed to every viewer that opens the console (3.35). */
export const SERIAL_LOG_BYTES = 1024 * 1024;
/** The collector re-attaches after this (doubling up to the maximum) while the VM's console isn't there yet. */
export const SERIAL_RETRY_MS = 1_000;
export const SERIAL_RETRY_MAX_MS = 30_000;
/** A collector that ran this long was attached: the next retry starts from the minimum again. */
const SERIAL_STABLE_MS = 10_000;

/** A ring of the last `capacity` bytes. */
export class SerialLog {
  private chunks: Buffer[] = [];
  private bytes = 0;

  constructor(private readonly capacity = SERIAL_LOG_BYTES) {}

  append(chunk: Buffer): void {
    if (chunk.length >= this.capacity) {
      this.chunks = [Buffer.from(chunk.subarray(chunk.length - this.capacity))];
      this.bytes = this.capacity;

      return;
    }

    this.chunks.push(chunk);
    this.bytes += chunk.length;

    while (this.bytes > this.capacity) {
      const first = this.chunks[0];
      const excess = this.bytes - this.capacity;

      if (first.length <= excess) {
        this.chunks.shift();
        this.bytes -= first.length;
      } else {
        this.chunks[0] = first.subarray(excess);
        this.bytes -= excess;
      }
    }
  }

  get size(): number {
    return this.bytes;
  }

  snapshot(): Buffer {
    return Buffer.concat(this.chunks, this.bytes);
  }
}

export interface SerialViewer {
  output(chunk: Buffer): void;
  /** The console is gone (the VM's container stopped). */
  ended(reason: string): void;
}

interface SerialConsole {
  containerId: string;
  replica: string;
  log: SerialLog;
  viewers: Set<SerialViewer>;
  /** The collector's exec (`vm-console serial` without a TTY): `null` while it (re-)attaches. */
  stream: Duplex | null;
  retry: NodeJS.Timeout | null;
  delay: number;
  closed: boolean;
}

/**
 * Serial consoles of the full VMs on this node (3.35). The VM's serial port is a UNIX socket in its launcher that
 * takes one client, and output nobody reads is lost; so the node keeps **one** collector per running VM (`docker
 * exec <launcher> vm-console serial`, agent-internal, never rewritten to `vm-exec`) from the container's start on.
 * It keeps the last MiB in a ring (boot log) and fans the output out to every open console session; their input goes
 * to the same serial line. The ring lives as long as the container: a restart starts a new log.
 */
export class SerialConsoles {
  private readonly logger = new Logger(SerialConsoles.name);
  private readonly consoles = new Map<string, SerialConsole>();
  private events: NodeJS.ReadableStream | null = null;
  private stopped = false;

  constructor(private readonly docker: Docker) {}

  /** Collectors for the VMs already running, then for every VM container that starts (agent start). */
  async watch(): Promise<void> {
    this.stopped = false;

    try {
      this.events = await this.docker.getEvents({
        filters: {
          type: ['container'],
          event: ['start', 'die', 'destroy'],
          label: [`${MANAGED_LABEL}=true`, VM_LABEL],
        },
      });
      createInterface({ input: this.events }).on('line', (line) => {
        try {
          const event = JSON.parse(line) as {
            id?: string;
            Action?: string;
            status?: string;
            Actor?: { ID?: string; Attributes?: Record<string, string> };
          };
          const id = event.Actor?.ID ?? event.id;
          const replica = event.Actor?.Attributes?.[WORKLOAD_LABEL];
          const action = event.Action ?? event.status;

          if (!id) return;

          if (action === 'start' && replica) this.ensure(id, replica);
          else if (action === 'die' || action === 'destroy') this.end(id, 'the virtual machine stopped');
        } catch {
          // not an event line
        }
      });
    } catch (error) {
      this.logger.warn(`Docker events for VM consoles: ${error instanceof Error ? error.message : String(error)}`);
    }

    const running = await this.docker
      .listContainers({ filters: { label: [`${MANAGED_LABEL}=true`, VM_LABEL], status: ['running'] } })
      .catch(() => []);

    for (const container of running) {
      const replica = container.Labels?.[WORKLOAD_LABEL];

      if (replica) this.ensure(container.Id, replica);
    }
  }

  /** Agent shutdown: collectors and the event stream end (the VMs keep running). */
  stop(): void {
    this.stopped = true;
    (this.events as (NodeJS.ReadableStream & { destroy?: () => void }) | null)?.destroy?.();
    this.events = null;

    for (const id of [...this.consoles.keys()]) this.end(id, 'the node agent stopped');
  }

  /** The console of a VM container (its collector started if it isn't yet). */
  ensure(containerId: string, replica: string): SerialConsole {
    let serial = this.consoles.get(containerId);

    if (!serial) {
      serial = {
        containerId,
        replica,
        log: new SerialLog(),
        viewers: new Set(),
        stream: null,
        retry: null,
        delay: SERIAL_RETRY_MS,
        closed: false,
      };
      this.consoles.set(containerId, serial);
      void this.collect(serial);
    }

    return serial;
  }

  /** A session joins: the boot log first, then live output. Returns the function that ends the viewing. */
  view(containerId: string, replica: string, viewer: SerialViewer): () => void {
    const serial = this.ensure(containerId, replica);
    const log = serial.log.snapshot();

    if (log.length > 0) viewer.output(log);

    serial.viewers.add(viewer);

    return () => void serial.viewers.delete(viewer);
  }

  /** Input of a session towards the serial line (dropped while the collector re-attaches). */
  input(containerId: string, data: Buffer): boolean {
    const stream = this.consoles.get(containerId)?.stream;

    if (!stream || stream.destroyed) return false;

    stream.write(data);

    return true;
  }

  /** The collector's backlog towards the serial line (a guest that doesn't read). */
  backlog(containerId: string): number {
    return this.consoles.get(containerId)?.stream?.writableLength ?? 0;
  }

  /** The current boot log of a VM container (tests, diagnostics). */
  logOf(containerId: string): Buffer | null {
    return this.consoles.get(containerId)?.log.snapshot() ?? null;
  }

  private end(containerId: string, reason: string): void {
    const serial = this.consoles.get(containerId);

    if (!serial) return;

    serial.closed = true;
    this.consoles.delete(containerId);

    if (serial.retry) clearTimeout(serial.retry);

    serial.stream?.destroy();

    for (const viewer of serial.viewers) viewer.ended(reason);

    serial.viewers.clear();
  }

  private async collect(serial: SerialConsole): Promise<void> {
    if (serial.closed || this.stopped) return;

    const startedAt = Date.now();

    try {
      const container = this.docker.getContainer(serial.containerId);
      const exec = await container.exec({
        Cmd: [VM_CONSOLE_PATH, 'serial'],
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: false,
      });
      const stream = (await exec.start({ hijack: true, stdin: true })) as unknown as Duplex;

      if (serial.closed) {
        stream.destroy();

        return;
      }

      const stdout = new PassThrough();
      const stderr = new PassThrough();

      serial.stream = stream;
      this.docker.modem.demuxStream(stream, stdout, stderr);
      stdout.on('data', (chunk: Buffer) => {
        serial.log.append(chunk);

        for (const viewer of serial.viewers) viewer.output(chunk);
      });
      // The relay's own complaints (e.g. "the VM has no serial console" while it boots) aren't console output.
      stderr.resume();

      let done = false;
      const ended = () => {
        if (done) return;

        done = true;
        stdout.end();
        stderr.end();

        if (serial.stream === stream) serial.stream = null;

        void this.reattach(serial, startedAt);
      };

      stream.on('end', ended);
      stream.on('close', ended);
      stream.on('error', ended);
    } catch (error) {
      this.logger.debug(
        `Serial console of ${serial.replica}: ${error instanceof Error ? error.message : String(error)}`,
      );
      await this.reattach(serial, startedAt);
    }
  }

  /** The collector ended: again while the container runs (the VM boots, or rebooted its console), else the end. */
  private async reattach(serial: SerialConsole, startedAt: number): Promise<void> {
    if (serial.closed || this.stopped) return;

    const running = await this.docker
      .getContainer(serial.containerId)
      .inspect()
      .then((info) => info.State?.Running === true)
      .catch(() => false);

    if (serial.closed) return;

    if (!running) return this.end(serial.containerId, 'the virtual machine stopped');

    serial.delay = Date.now() - startedAt >= SERIAL_STABLE_MS ? SERIAL_RETRY_MS : serial.delay;
    serial.retry = setTimeout(() => {
      serial.retry = null;
      void this.collect(serial);
    }, serial.delay);
    serial.delay = Math.min(serial.delay * 2, SERIAL_RETRY_MAX_MS);
  }
}
