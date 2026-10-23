import { rm } from 'node:fs/promises';
import { connect, type Socket } from 'node:net';
import { PassThrough, type Duplex } from 'node:stream';

import {
  agentMessage,
  LIVE_CHUNK_BYTES,
  type ConsoleOpen,
  type DesiredState,
  type Envelope,
  type ExecOpen,
  type FileRequest,
  type FileResponse,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import { Inject, Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import type Docker from 'dockerode';
import { COMPONENT_IMAGES } from '@forepath/loadweaver/shared/util-release';

import { CommandRunner } from '../host/command-runner';
import { DOCKER } from '../host/docker.provider';
import { VolumeManager } from '../volumes/volume.manager';
import {
  RESTORED_LABEL,
  restoredExecCommand,
  restoredKind,
  writeRestoredExecProcess,
} from '../workloads/restored-runtime';
import { WORKLOAD_LABEL } from '../workloads/workload-container';
import { runFileRequest } from './confined-fs';
import { guestExecOptions, guestFileRoot, guestKind, VM_CONSOLE_PATH } from './guest-target';
import { SerialConsoles } from './serial-console';
import { TunnelFirewall } from './tunnel-firewall';
import { componentImage } from '../updates/release-images';

/** The helper that enters the host's namespaces for a node shell (pinned by digest, section 6). */
export const NODE_SHELL_IMAGE = COMPONENT_IMAGES['node-shell'];
export const NODE_SHELL_LABEL = 'loadweaver.com/node-shell';
const DEFAULT_SHELL = ['/bin/sh', '-c', 'command -v bash >/dev/null 2>&1 && exec bash -l || exec sh -l'];
/** Output is sent in batches every 20 ms (or at 32 KiB), so a busy terminal doesn't flood the stream. */
const FLUSH_MS = 20;
const FLUSH_BYTES = 32 * 1024;
const MAX_SESSIONS = 32;
/** How long an ended terminal's exit code is waited for. */
const EXIT_WAIT_MS = 5_000;
/** A terminal without input for this long is closed (the control plane's idle limit, 3.19). */
export const TERMINAL_IDLE_MS = 30 * 60_000;
/** The longest tunnel the control plane grants (its `ttlSeconds` maximum): the node's own limit, should it miss the close. */
export const TUNNEL_MAX_MS = 8 * 3600_000;
/** Bytes queued towards a shell's stdin or a replica's port before the session is closed (a peer that doesn't read). */
export const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;

/** Sends one envelope; `false` when the stream's buffer is full (wait for `drained`). */
type Send = (envelope: Envelope) => unknown;

interface Output {
  pending: Buffer[];
  pendingBytes: number;
  timer: NodeJS.Timeout | null;
}

interface Terminal extends Output {
  stream: Duplex;
  resize(cols: number, rows: number): Promise<void>;
  exitCode(): Promise<number | null>;
  cleanup(): Promise<void>;
  idle?: NodeJS.Timeout;
  /** Machine exec (no TTY): Docker multiplexes stdout / stderr on the stream; stderr is buffered apart. */
  stderr?: Output;
  /** The replica the session runs in (closed when the replica migrates away). */
  replica?: string;
}

interface Tunnel {
  socket: Socket;
  expiry: NodeJS.Timeout;
  replica: string;
}

/** A session on a VM's serial console: one viewer of the VM's shared serial collector. */
interface SerialSession {
  containerId: string;
  detach: () => void;
  idle: NodeJS.Timeout;
}

/**
 * Live sessions on this node (3.19), each on its envelope channel: terminals (`docker exec` with a TTY in a replica;
 * a host shell through a short-lived privileged helper only when the cluster enables it), file operations (the
 * container's merged filesystem, or a volume mounted here as its primary) and debug tunnels to a replica's port.
 * The control plane decides who may; the node only acts within its own workloads and volumes.
 */
@Injectable()
export class LiveSessionsService implements OnModuleDestroy {
  private readonly logger = new Logger(LiveSessionsService.name);
  private send: Send | null = null;
  private readonly terminals = new Map<string, Terminal>();
  private readonly tunnels = new Map<string, Tunnel>();
  private readonly serialSessions = new Map<string, SerialSession>();
  /** One collector per running VM: boot log ring + fan-out to its console sessions (3.35). */
  readonly serial: SerialConsoles;
  /** Sources paused while the control-plane stream is full, resumed when it drains. */
  private readonly paused = new Set<Duplex>();
  private access: DesiredState['liveAccess'];

  constructor(
    @Inject(DOCKER) private readonly docker: Docker,
    private readonly volumes: VolumeManager,
    @Optional() commands?: CommandRunner,
  ) {
    this.firewall = commands ? new TunnelFirewall(commands) : null;
    this.serial = new SerialConsoles(docker);
  }

  private readonly firewall: TunnelFirewall | null;

  attach(send: Send): void {
    this.send = send;
  }

  /** The control-plane stream accepts data again: paused terminals and tunnels continue. */
  drained(): void {
    for (const source of this.paused) source.resume();

    this.paused.clear();
  }

  /** The cluster's live-access settings, from the desired state. */
  configure(access: DesiredState['liveAccess']): void {
    this.access = access;
  }

  async onModuleDestroy(): Promise<void> {
    await this.closeAll();
    this.serial.stop();
  }

  /** Serial collectors for the VMs on this node, from their start on (agent start, after `reset`). */
  async watchConsoles(): Promise<void> {
    await this.serial.watch();
  }

  /**
   * Ends every session: on shutdown and when the control-plane stream drops (nobody is attached to them anymore).
   * Terminals end their shells and node-shell helpers, tunnels their connections and firewall allowances.
   */
  async closeAll(): Promise<void> {
    for (const channel of [...this.tunnels.keys()]) this.closeTunnel(channel);

    for (const channel of [...this.terminals.keys()]) await this.closeTerminal(channel);

    for (const channel of [...this.serialSessions.keys()]) this.endSerial(channel);

    this.paused.clear();
  }

  /**
   * Leftovers of a previous agent process (crashed, killed): tunnel allowances in `lw_live` and node-shell helpers.
   * Called once at agent start, before any session exists.
   */
  async reset(): Promise<void> {
    await this.firewall?.flush();

    const helpers = await this.docker
      .listContainers({ all: true, filters: { label: [`${NODE_SHELL_LABEL}=true`] } })
      .catch(() => []);

    for (const helper of helpers)
      await this.docker
        .getContainer(helper.Id)
        .remove({ force: true })
        .catch(() => undefined);

    if (helpers.length > 0) this.logger.log(`Removed ${helpers.length} leftover node-shell helper(s)`);
  }

  /** Sends an envelope; pauses `source` until the stream drains when the stream's buffer is full. */
  private emit(envelope: Envelope, source?: Duplex): void {
    if (this.send?.(envelope) === false && source && !source.destroyed) {
      source.pause();
      this.paused.add(source);
    }
  }

  /** Writes towards a shell or a replica; a peer that stops reading ends the session instead of filling memory. */
  private write(target: Duplex, data: string, close: () => unknown): void {
    if (!target.write(Buffer.from(data, 'base64')) && target.writableLength > MAX_BUFFERED_BYTES) {
      this.logger.warn('Live session closed: the peer does not read');
      void close();
    }
  }

  private async container(replica: string): Promise<Docker.Container> {
    const [info] = await this.docker.listContainers({
      filters: { label: [`${WORKLOAD_LABEL}=${replica}`], status: ['running'] },
    });

    if (!info) throw new Error(`replica ${replica} doesn't run on this node`);

    return this.docker.getContainer(info.Id);
  }

  // Terminals.

  async openTerminal(channel: string, open: ExecOpen): Promise<void> {
    try {
      if (this.sessionCount() >= MAX_SESSIONS) throw new Error('too many terminal sessions on this node');

      const machine = open.tty === false;

      if (machine && open.target.kind !== 'replica') throw new Error('machine exec is only available in replicas');

      const terminal =
        open.target.kind === 'node' ? await this.nodeShell(open) : await this.execInReplica(open.target.replica, open);

      if (open.target.kind === 'replica') terminal.replica = open.target.replica;

      this.run(channel, terminal);

      if (!machine) await terminal.resize(open.cols, open.rows).catch(() => undefined);
    } catch (error) {
      this.refuse(channel, error);
    }
  }

  private sessionCount(): number {
    return this.terminals.size + this.serialSessions.size;
  }

  /** Ends a session that couldn't start, with the reason. */
  private refuse(channel: string, error: unknown): void {
    this.emit(
      agentMessage(
        'execExit',
        { code: null, error: (error instanceof Error ? error.message : String(error)).slice(0, 1024) },
        { channel },
      ),
    );
  }

  /** Wires a started session's stream to its channel: output batched, the end reported with the exit code. */
  private run(channel: string, terminal: Terminal): void {
    this.terminals.set(channel, terminal);

    if (terminal.stderr) {
      // Machine exec: binary stdout / stderr apart; no idle limit (watchers run without input), the control plane
      // bounds these sessions.
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const stderrOutput = terminal.stderr;

      let open = 2;
      // Done once both demultiplexed streams have delivered everything.
      const ended = () => {
        if (--open === 0) void this.finish(channel);
      };

      stdout.on('data', (chunk: Buffer) => this.buffer(channel, terminal, chunk));
      stderr.on('data', (chunk: Buffer) => this.buffer(channel, terminal, chunk, stderrOutput));
      stdout.on('end', ended);
      stderr.on('end', ended);
      this.docker.modem.demuxStream(terminal.stream, stdout, stderr);
      terminal.stream.on('end', () => {
        stdout.end();
        stderr.end();
      });
    } else {
      // Idle is measured by input only: a program printing on its own doesn't keep a forgotten session open.
      terminal.idle = setTimeout(() => void this.closeTerminal(channel), TERMINAL_IDLE_MS);
      terminal.stream.on('data', (chunk: Buffer) => this.buffer(channel, terminal, chunk));
      terminal.stream.on('end', () => void this.finish(channel));
    }

    terminal.stream.on('error', () => void this.finish(channel));
  }

  private async execInReplica(replica: string, open: ExecOpen): Promise<Terminal> {
    const container = await this.container(replica);
    const info = await container.inspect();

    // A restored replica (3.10) runs as an agent-managed runc / runsc container next to its placeholder.
    if (info.Config.Labels?.[RESTORED_LABEL])
      return await this.execInRestored(info.Id, open, restoredKind(info.Config.Labels));

    // microVMs: the command runs in the guest through the launcher's `vm-exec` (M7.2); full VMs have no exec.
    const kind = guestKind(info.Config.Labels);

    if (open.tty === false) {
      const exec = await container.exec(
        guestExecOptions(kind, {
          Cmd: open.command ?? DEFAULT_SHELL,
          AttachStdin: true,
          AttachStdout: true,
          AttachStderr: true,
          Tty: false,
          ...(open.user ? { User: open.user } : {}),
          ...(open.workingDir ? { WorkingDir: open.workingDir } : {}),
          ...(open.env?.length ? { Env: open.env } : {}),
        }),
      );
      const stream = (await exec.start({ hijack: true, stdin: true })) as unknown as Duplex;

      return {
        stream,
        resize: async () => undefined,
        exitCode: async () => (await exec.inspect()).ExitCode ?? null,
        cleanup: async () => undefined,
        pending: [],
        pendingBytes: 0,
        timer: null,
        stderr: { pending: [], pendingBytes: 0, timer: null },
      };
    }

    const exec = await container.exec(
      guestExecOptions(kind, {
        Cmd: open.command ?? DEFAULT_SHELL,
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: true,
        Env: ['TERM=xterm-256color'],
      }),
    );
    const stream = (await exec.start({ hijack: true, stdin: true, Tty: true })) as unknown as Duplex;

    return {
      stream,
      // In a microVM the vm-exec client forwards the exec's window size to the guest's PTY.
      resize: async (cols, rows) => void (await exec.resize({ h: rows, w: cols })),
      exitCode: async () => (await exec.inspect()).ExitCode ?? null,
      cleanup: async () => undefined,
      pending: [],
      pendingBytes: 0,
      timer: null,
    };
  }

  /**
   * Terminal in a restored replica: the node-shell helper provides the TTY and runs `runc exec -t` in the host's
   * namespaces; runc applies the replica's own capabilities, seccomp and AppArmor profile, so this is the same
   * access as `docker exec` (no node shell needed). gVisor replicas: `runsc exec` inside the sandbox.
   */
  private async execInRestored(holderId: string, open: ExecOpen, kind: 'runc' | 'runsc'): Promise<Terminal> {
    const tty = open.tty !== false;
    const command = open.command ?? DEFAULT_SHELL;
    // Machine exec: command, user, working directory and environment in a 0600 process spec, not on the helper's
    // command line (M6 review L2).
    const processFile = tty
      ? undefined
      : await writeRestoredExecProcess(holderId, command, {
          user: open.user,
          workingDir: open.workingDir,
          env: open.env,
        });
    const removeFile = async () => void (processFile ? await rm(processFile, { force: true }) : undefined);

    try {
      const terminal = await this.helperTerminal(
        [
          'nsenter',
          '-t',
          '1',
          '-m',
          '-u',
          '-i',
          '-n',
          '-p',
          '--',
          ...restoredExecCommand(holderId, command, tty, kind, undefined, { processFile }),
        ],
        tty,
      );
      const cleanup = terminal.cleanup;

      return processFile ? { ...terminal, cleanup: async () => (await cleanup(), await removeFile()) } : terminal;
    } catch (error) {
      await removeFile();
      throw error;
    }
  }

  /** Root on the host (3.19): disabled unless the cluster enables it, for cluster admins only (checked upstream). */
  private async nodeShell(open: ExecOpen): Promise<Terminal> {
    if (!this.access?.nodeShell) throw new Error('node shells are disabled for this cluster');

    return await this.helperTerminal([
      'nsenter',
      '-t',
      '1',
      '-m',
      '-u',
      '-i',
      '-n',
      '-p',
      '--',
      ...(open.command ?? DEFAULT_SHELL),
    ]);
  }

  /**
   * A TTY (or, for machine exec, plain multiplexed stdio) through a short-lived privileged helper in the host's
   * namespaces (removed with the session).
   */
  private async helperTerminal(command: string[], tty = true): Promise<Terminal> {
    const container = await this.docker.createContainer({
      Image: componentImage('node-shell'),
      Cmd: command,
      Tty: tty,
      OpenStdin: true,
      StdinOnce: true,
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Env: ['TERM=xterm-256color'],
      Labels: { [NODE_SHELL_LABEL]: 'true' },
      HostConfig: { Privileged: true, PidMode: 'host', NetworkMode: 'host', AutoRemove: true },
    });
    const stream = (await container.attach({
      stream: true,
      stdin: true,
      stdout: true,
      stderr: true,
      hijack: true,
    })) as unknown as Duplex;

    await container.start();

    return {
      stream,
      resize: async (cols, rows) => void (tty ? await container.resize({ h: rows, w: cols }) : undefined),
      exitCode: async () => (await container.wait().catch(() => ({ StatusCode: null }))).StatusCode ?? null,
      cleanup: async () => void (await container.remove({ force: true }).catch(() => undefined)),
      pending: [],
      pendingBytes: 0,
      timer: null,
      ...(tty ? {} : { stderr: { pending: [], pendingBytes: 0, timer: null } }),
    };
  }

  /** Buffers output of a session (`output`: the terminal itself = stdout, or its stderr buffer). */
  private buffer(channel: string, terminal: Terminal, chunk: Buffer, output: Output = terminal): void {
    output.pending.push(chunk);
    output.pendingBytes += chunk.length;

    if (output.pendingBytes >= FLUSH_BYTES) this.flush(channel, terminal, output);
    else output.timer ??= setTimeout(() => this.flush(channel, terminal, output), FLUSH_MS);
  }

  private flush(channel: string, terminal: Terminal, output: Output = terminal): void {
    if (output.timer) clearTimeout(output.timer);

    output.timer = null;

    const data = Buffer.concat(output.pending);
    const stderr = output !== terminal;

    output.pending = [];
    output.pendingBytes = 0;

    for (let i = 0; i < data.length; i += LIVE_CHUNK_BYTES)
      this.emit(
        agentMessage(
          'execOutput',
          {
            data: data.subarray(i, i + LIVE_CHUNK_BYTES).toString('base64'),
            ...(stderr ? { stream: 'stderr' as const } : {}),
          },
          { channel },
        ),
        terminal.stream,
      );
  }

  /** `closing`: ended by us (closed, idle, stream dropped), so the program isn't waited for. */
  private async finish(channel: string, closing = false, error?: string): Promise<void> {
    const terminal = this.terminals.get(channel);

    if (!terminal) return;

    this.terminals.delete(channel);
    clearTimeout(terminal.idle);
    this.paused.delete(terminal.stream);
    this.flush(channel, terminal);

    if (terminal.stderr) this.flush(channel, terminal, terminal.stderr);

    // A host shell's helper goes first: its program may ignore the closed stdin and run on.
    if (closing) await terminal.cleanup();

    let timer: NodeJS.Timeout | undefined;
    const code = await Promise.race([
      terminal.exitCode().catch(() => null),
      new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), EXIT_WAIT_MS))),
    ]);

    clearTimeout(timer);

    if (!closing) await terminal.cleanup();

    this.emit(agentMessage('execExit', { code, ...(error ? { error: error.slice(0, 1024) } : {}) }, { channel }));
  }

  /**
   * The replica left this node (live migration, 3.10 / M7 W10b): its terminals, machine execs and tunnels end with
   * `reason`; new sessions go to the node it runs on now.
   */
  async closeReplicaSessions(replica: string, reason: string): Promise<void> {
    for (const [channel, tunnel] of [...this.tunnels])
      if (tunnel.replica === replica) this.closeTunnel(channel, reason);

    for (const [channel, terminal] of [...this.terminals]) {
      if (terminal.replica !== replica) continue;

      terminal.stream.end();
      terminal.stream.destroy();
      await this.finish(channel, true, reason);
    }
  }

  /** Input towards a session; `eof` closes the program's stdin afterwards (machine exec). */
  input(channel: string, data: string, eof = false): void {
    const terminal = this.terminals.get(channel);

    if (!terminal) return this.serialInput(channel, data);

    terminal.idle?.refresh();

    if (data.length > 0) this.write(terminal.stream, data, () => this.closeTerminal(channel));

    if (eof && terminal.stderr && !terminal.stream.writableEnded) terminal.stream.end();
  }

  async resize(channel: string, cols: number, rows: number): Promise<void> {
    await this.terminals
      .get(channel)
      ?.resize(cols, rows)
      .catch(() => undefined);
  }

  async closeTerminal(channel: string): Promise<void> {
    const terminal = this.terminals.get(channel);

    if (!terminal) return this.endSerial(channel);

    // Ends the shell: closing stdin (the shell exits) and the connection.
    terminal.stream.end();
    terminal.stream.destroy();
    await this.finish(channel, true);
  }

  // VM consoles (3.35, feature `vm-consoles`).

  /**
   * A VM's console on a live channel; data then flows as for terminals (`execInput` / `execOutput` / `execClose` /
   * `execExit`). `serial`: a viewer of the VM's serial collector (boot log first, input to the serial line, resize
   * ignored: the guest owns the line). `vnc`: raw RFB of the graphical console through `vm-console vnc` in the
   * launcher (no TTY, binary-safe), one relay per session. Full VMs only; the commands are the agent's own.
   */
  async openConsole(channel: string, open: ConsoleOpen): Promise<void> {
    try {
      if (this.sessionCount() >= MAX_SESSIONS) throw new Error('too many terminal sessions on this node');

      if (this.terminals.has(channel) || this.serialSessions.has(channel)) throw new Error('channel in use');

      const container = await this.container(open.target.replica);
      const info = await container.inspect();

      if (guestKind(info.Config?.Labels) !== 'vm') throw new Error('consoles are only available for virtual machines');

      if (open.kind === 'serial') return this.openSerial(channel, info.Id, open.target.replica);

      const exec = await container.exec({
        Cmd: [VM_CONSOLE_PATH, 'vnc'],
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: false,
      });
      const stream = (await exec.start({ hijack: true, stdin: true })) as unknown as Duplex;

      this.run(channel, {
        stream,
        resize: async () => undefined,
        exitCode: async () => (await exec.inspect()).ExitCode ?? null,
        cleanup: async () => undefined,
        pending: [],
        pendingBytes: 0,
        timer: null,
        stderr: { pending: [], pendingBytes: 0, timer: null },
      });
    } catch (error) {
      this.refuse(channel, error);
    }
  }

  private openSerial(channel: string, containerId: string, replica: string): void {
    const session: SerialSession = {
      containerId,
      detach: () => undefined,
      idle: setTimeout(() => this.endSerial(channel), TERMINAL_IDLE_MS),
    };

    this.serialSessions.set(channel, session);
    session.detach = this.serial.view(containerId, replica, {
      output: (chunk) => {
        for (let i = 0; i < chunk.length; i += LIVE_CHUNK_BYTES)
          this.emit(
            agentMessage(
              'execOutput',
              { data: chunk.subarray(i, i + LIVE_CHUNK_BYTES).toString('base64') },
              { channel },
            ),
          );
      },
      ended: (reason) => this.endSerial(channel, reason),
    });
  }

  private serialInput(channel: string, data: string): void {
    const session = this.serialSessions.get(channel);

    if (!session || data.length === 0) return;

    session.idle.refresh();
    this.serial.input(session.containerId, Buffer.from(data, 'base64'));

    if (this.serial.backlog(session.containerId) > MAX_BUFFERED_BYTES) {
      this.logger.warn('Serial console session closed: the guest does not read');
      this.endSerial(channel, 'the guest does not read its serial console');
    }
  }

  /** Ends a serial console session (the VM keeps its collector and boot log). */
  private endSerial(channel: string, error?: string): void {
    const session = this.serialSessions.get(channel);

    if (!session) return;

    this.serialSessions.delete(channel);
    clearTimeout(session.idle);
    session.detach();
    this.emit(agentMessage('execExit', { code: null, ...(error ? { error } : {}) }, { channel }));
  }

  // Files.

  /** The directory a file request works in: the container's merged filesystem, or a volume mounted here. */
  private async fileRoot(request: FileRequest): Promise<string> {
    if (request.target.kind === 'volume') {
      const path = await this.volumes.mountedPath(request.target.volume);

      if (!path) throw new Error('the volume is not mounted on this node (its workload runs elsewhere or is stopped)');

      return path;
    }

    const info = await (await this.container(request.target.replica)).inspect();
    // microVMs: the guest's root (generic: the replica's overlay on the host; bundled: `/guest` in the image).
    const guestRoot = guestFileRoot(guestKind(info.Config?.Labels), info);

    if (guestRoot) return guestRoot;

    const merged = (info.GraphDriver?.Data as Record<string, string> | undefined)?.['MergedDir'];

    // A restored gVisor replica runs on a runc placeholder, but its files live in the sandbox.
    if (info.HostConfig?.Runtime?.startsWith('runsc') || restoredKind(info.Config?.Labels) === 'runsc')
      throw new Error('sandboxed replicas are not browsable');

    if (!merged) throw new Error('this container runtime has no browsable filesystem (e.g. sandboxed)');

    return merged;
  }

  async file(channel: string, request: FileRequest): Promise<void> {
    let response: FileResponse;

    try {
      response = await runFileRequest(await this.fileRoot(request), request);
    } catch (error) {
      response = {
        ok: false,
        error: { code: 'failed', message: (error instanceof Error ? error.message : String(error)).slice(0, 1024) },
      };
    }

    this.emit(agentMessage('fileResponse', response, { channel }));
  }

  // Tunnels.

  async openTunnel(channel: string, replica: string, port: number): Promise<void> {
    try {
      const info = await (await this.container(replica)).inspect();
      const address = Object.values(info.NetworkSettings.Networks ?? {})
        .map((n) => n.IPAddress || n.GlobalIPv6Address)
        .find((a) => !!a);

      if (!address) throw new Error('the replica has no address');

      // The temporary operator allowance (3.19), removed with the tunnel.
      await this.firewall?.allow(address, port, channel);

      const socket = connect({ host: address, port });
      const ended = (reason?: string) => {
        const tunnel = this.tunnels.get(channel);

        if (tunnel?.socket !== socket) return;

        this.tunnels.delete(channel);
        clearTimeout(tunnel.expiry);
        this.paused.delete(socket);
        this.emit(agentMessage('tunnelClose', reason ? { reason: reason.slice(0, 256) } : {}, { channel }));
      };

      this.tunnels.set(channel, {
        socket,
        replica,
        expiry: setTimeout(() => {
          ended('the tunnel expired');
          socket.destroy();
        }, TUNNEL_MAX_MS),
      });
      socket.on('data', (chunk: Buffer) => {
        for (let i = 0; i < chunk.length; i += LIVE_CHUNK_BYTES)
          this.emit(
            agentMessage(
              'tunnelData',
              { data: chunk.subarray(i, i + LIVE_CHUNK_BYTES).toString('base64') },
              { channel },
            ),
            socket,
          );
      });
      socket.on('close', () => {
        void this.firewall?.revoke(channel);
        ended();
      });
      socket.on('error', (error) => ended(error.message));
    } catch (error) {
      this.emit(
        agentMessage(
          'tunnelClose',
          { reason: (error instanceof Error ? error.message : String(error)).slice(0, 256) },
          { channel },
        ),
      );
    }
  }

  tunnelData(channel: string, data: string): void {
    const tunnel = this.tunnels.get(channel);

    if (tunnel) this.write(tunnel.socket, data, () => this.closeTunnel(channel, 'the replica does not read'));
  }

  /** Ends a tunnel; with a `reason` the control plane is told (it didn't ask for the close). */
  closeTunnel(channel: string, reason?: string): void {
    const tunnel = this.tunnels.get(channel);

    if (!tunnel) return;

    this.tunnels.delete(channel);
    clearTimeout(tunnel.expiry);
    this.paused.delete(tunnel.socket);
    tunnel.socket.destroy();

    if (reason) this.emit(agentMessage('tunnelClose', { reason }, { channel }));
  }
}
