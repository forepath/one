import { ChildProcess, SpawnOptions, spawn as nodeSpawn } from 'node:child_process';
import * as net from 'node:net';
import { constants as osConstants } from 'node:os';

import { FrameConnection } from './connection';
import {
  MICROVM_BRIDGE_PROTOCOL_VERSION,
  MICROVM_GUEST_AGENT_OOM_SCORE_ADJ,
  MICROVM_GUEST_DNS,
  MICROVM_GUEST_GATEWAY,
  MICROVM_GUEST_OOM_SCORE_ADJ_PATH,
  MICROVM_GUEST_WORKLOAD_OOM_SCORE_ADJ,
  MICROVM_INSTALL_DIR,
  MICROVM_RESYNC_MARKER,
} from './constants';
import { DataChannel, Frame, FrameType, decodeData, decodeJson, decodeResize } from './frame';
import {
  GENERIC_IDENTITY_DIR,
  GENERIC_WORKLOAD_PID_FILE,
  GenericRootError,
  HelperUser,
  PathKind,
  genericRootCommands,
  identityFiles,
  lwPtyArgv,
  resolverContent,
} from './generic-root';
import { CpuSample, computeGuestStats } from './guest-stats';
import { CONTROL_STREAM, WORKLOAD_STREAM } from './host-daemon';
import { BootConfig, parseBootConfig, parseExecRequest, parseOpenTcp, parseSignal } from './messages';
import {
  ResolvedUser,
  accountFiles,
  buildProcessEnv,
  resolveUserSpec,
  supplementaryGroups,
  wrapForUser,
} from './guest-users';

export interface GuestAgentOptions {
  /** Writes encoded frames to the virtio-serial port. */
  write: (bytes: Buffer) => void;
  readFile: (path: string) => string;
  /** Writes guest files (identity: hostname, hosts, resolver). */
  writeFile: (path: string, content: string) => void;
  spawn?: (command: string, args: string[], options: SpawnOptions) => ChildProcess;
  ids?: { uid: number; gid: number };
  pythonPath?: string;
  ptyHelperPath?: string;
  /** Gateway the loopback relay forwards to (the container's loopback as seen from the guest). */
  relayTarget?: string;
  log: (message: string) => void;
  /** Called once the workload exited and its status was reported. */
  onWorkloadExit: (code: number) => void;
  /**
   * Generic mode: the image root this agent was started for (`--root`). The boot configuration's `rootDir` must
   * match it; without it the agent only accepts bundled boot configurations (and the other way round).
   */
  rootDir?: string;
  /** Generic mode: the static workload / exec helper and busybox of the guest tools. */
  lwPtyPath?: string;
  busyboxPath?: string;
  /** Generic mode: tmpfs directory of the identity files, and the workload's namespace PID file. */
  identityDir?: string;
  pidFile?: string;
  /** Generic mode: runs a preparation command (mounts) synchronously; throws when it fails. */
  runSync?: (argv: string[]) => void;
  /** Generic mode: what a path is, without following symlinks. */
  pathKind?: (path: string) => PathKind;
  /** Generic mode: entries of a directory (empty when it doesn't exist). */
  listDir?: (path: string) => string[];
}

interface ExecSession {
  child: ChildProcess;
  control: NodeJS.WritableStream | null;
}

const SIGNAL_NUMBERS: Readonly<Record<string, number>> = osConstants.signals;

/**
 * Guest-side bridge endpoint. It starts the workload with the launcher's boot configuration, serves exec
 * sessions (optionally on a PTY) and TCP streams, relays guest loopback ports to the container's loopback and
 * stops the workload on request. It never trusts the host's input beyond the validated message schemas.
 */
export class GuestAgent {
  private connection: FrameConnection;
  private readonly spawn: NonNullable<GuestAgentOptions['spawn']>;
  private readonly ids: { uid: number; gid: number };
  private boot: BootConfig | null = null;
  private workload: ChildProcess | null = null;
  private readonly execs = new Map<number, ExecSession>();
  private readonly tcp = new Map<number, net.Socket>();
  private readonly relays: net.Server[] = [];
  private helloTimer: NodeJS.Timeout | null = null;
  private statsTimer: NodeJS.Timeout | null = null;
  private cpuSample: CpuSample | null = null;
  private stopping = false;
  /** The agent runs with oom_score_adj -1000 (set in start()); spawned processes get 0 (see spawnUnprotected). */
  private oomProtected = false;
  /** Guest OOM kills (`/proc/vmstat` oom_kill) when the workload started; null when unreadable. */
  private oomKillsAtStart: number | null = null;
  /** Output sources paused for lack of flow-control credit (resumed when the launcher re-attaches). */
  private readonly pausedOutputs = new Set<NodeJS.ReadableStream>();

  constructor(private readonly options: GuestAgentOptions) {
    this.spawn = options.spawn ?? nodeSpawn;
    this.ids = options.ids ?? { uid: process.getuid?.() ?? 0, gid: process.getgid?.() ?? 0 };
    this.connection = this.newConnection();
  }

  private newConnection(): FrameConnection {
    return new FrameConnection({
      write: this.options.write,
      onFrame: (frame) => this.onFrame(frame),
      onProtocolError: (error) => this.options.log(`bridge protocol error: ${error.message}`),
    });
  }

  /**
   * The launcher end of the port went away and came back: the microVM was live-migrated (M7 W10b) and a new launcher
   * daemon took over. What was in flight belonged to the old daemon, so the stream state starts over: exec sessions
   * and TCP streams are hung up (like a disconnected client), a partial frame is dropped with the old decoder, the
   * workload's output continues on a fresh window. The resync marker and a `HELLO { running }` let the new daemon
   * find the frame boundary and skip the BOOT (the workload keeps running).
   */
  reattach(): void {
    for (const [stream, session] of [...this.execs]) {
      this.execs.delete(stream);
      hangUp(session);
    }

    for (const socket of this.tcp.values()) {
      socket.destroy();
    }

    this.tcp.clear();
    this.connection = this.newConnection();

    if (this.workload) {
      this.connection.openOutbound(WORKLOAD_STREAM);
    }

    this.options.write(MICROVM_RESYNC_MARKER);
    this.connection.sendJson(FrameType.Hello, CONTROL_STREAM, {
      version: MICROVM_BRIDGE_PROTOCOL_VERSION,
      running: this.workload !== null,
    });

    for (const source of [...this.pausedOutputs]) {
      this.pausedOutputs.delete(source);
      source.resume();
    }

    this.options.log('launcher re-attached (live migration)');
  }

  /** Announce the agent until the launcher answers (the host end may connect after the guest booted). */
  start(): void {
    this.oomProtected = this.setOomScoreAdj(MICROVM_GUEST_AGENT_OOM_SCORE_ADJ);

    const hello = (): void =>
      this.connection.sendJson(FrameType.Hello, CONTROL_STREAM, { version: MICROVM_BRIDGE_PROTOCOL_VERSION });

    hello();
    this.helloTimer = setInterval(() => {
      if (!this.boot) {
        hello();
      }
    }, 1000);
  }

  receive(chunk: Buffer): void {
    this.connection.receive(chunk);
  }

  stop(): void {
    if (this.helloTimer) {
      clearInterval(this.helloTimer);
      this.helloTimer = null;
    }

    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }

    this.relays.forEach((server) => server.close());
  }

  private onFrame(frame: Frame): void {
    try {
      if (frame.stream === CONTROL_STREAM) {
        this.onControl(frame);
      } else if (frame.type === FrameType.OpenExec) {
        this.openExec(frame.stream, frame.payload);
      } else if (frame.type === FrameType.OpenTcp) {
        this.openTcp(frame.stream, frame.payload);
      } else if (this.execs.has(frame.stream)) {
        this.onExecFrame(frame);
      } else if (this.tcp.has(frame.stream)) {
        this.onTcpFrame(frame);
      }
    } catch (error) {
      this.connection.sendJson(FrameType.Error, frame.stream, { message: (error as Error).message });
    }
  }

  private onControl(frame: Frame): void {
    if (frame.type === FrameType.Boot) {
      if (this.boot) {
        return;
      }

      this.boot = parseBootConfig(decodeJson(frame.payload));

      if ((this.boot.rootDir ?? null) !== (this.options.rootDir ?? null)) {
        this.options.log(
          `boot configuration for root ${this.boot.rootDir ?? '/'} does not match this agent (${this.options.rootDir ?? '/'})`,
        );
        this.reportWorkloadExit(125);

        return;
      }

      this.startStats(this.boot.statsIntervalSeconds ?? 0);

      if (this.boot.rootDir) {
        if (!this.prepareGenericRoot(this.boot, this.boot.rootDir)) {
          this.reportWorkloadExit(125);

          return;
        }
      } else {
        this.applyIdentity(this.boot);
      }

      this.startRelays(this.boot.loopbackPorts);
      this.startWorkload(this.boot);
    } else if (frame.type === FrameType.Stop) {
      const message = decodeJson(frame.payload) as { graceSeconds?: unknown };
      const grace = typeof message?.graceSeconds === 'number' ? Math.min(Math.max(message.graceSeconds, 0), 3600) : 10;

      this.stopWorkload(grace);
    }
  }

  /** The container's identity as Docker set it up for the launcher: hostname, hosts and resolver settings. */
  private applyIdentity(boot: BootConfig): void {
    const writes: [string, string][] = [
      ['/etc/resolv.conf', resolverContent({ ...boot, dnsServers: boot.dnsServers ?? [MICROVM_GUEST_DNS] })],
    ];

    if (boot.hostname) {
      writes.push(['/proc/sys/kernel/hostname', boot.hostname], ['/etc/hostname', `${boot.hostname}\n`]);
    }

    if (boot.hosts) {
      writes.push(['/etc/hosts', boot.hosts]);
    }

    for (const [path, content] of writes) {
      try {
        this.options.writeFile(path, content);
      } catch (error) {
        this.options.log(`cannot write ${path}: ${(error as Error).message}`);
      }
    }
  }

  /**
   * Generic mode: identity files on the agent's tmpfs (bind-mounted into the image root, never written to the
   * image's writable layer), kernel filesystems below the image root. False (logged) when the root can't be prepared.
   */
  private prepareGenericRoot(boot: BootConfig, rootDir: string): boolean {
    const run = this.options.runSync;
    const pathKind = this.options.pathKind;
    const busybox = this.options.busyboxPath;

    if (!run || !pathKind || !busybox || !this.options.lwPtyPath) {
      this.options.log('generic mode needs the guest tools (busybox, lw-pty)');

      return false;
    }

    const identityDir = this.options.identityDir ?? GENERIC_IDENTITY_DIR;
    const identity = identityFiles(boot);

    try {
      run([busybox, 'mkdir', '-p', identityDir]);

      for (const [name, content] of identity) {
        this.options.writeFile(`${identityDir}/${name}`, content);
      }

      if (boot.hostname) {
        this.options.writeFile('/proc/sys/kernel/hostname', boot.hostname);
      }

      const plan = genericRootCommands({
        rootDir,
        busybox,
        identityDir,
        identity,
        pathKind,
        runIsEmpty: (this.options.listDir?.(`${rootDir}/run`) ?? []).length === 0,
      });

      for (const path of plan.createFiles) {
        this.options.writeFile(path, '');
      }

      for (const command of plan.commands) {
        run(command);
      }

      for (const path of plan.skipped) {
        this.options.log(`${path} of the image is a symlink or not a file: kept as is`);
      }

      return true;
    } catch (error) {
      const message =
        error instanceof GenericRootError
          ? error.message
          : `cannot prepare the image root: ${(error as Error).message}`;

      this.options.log(message);

      return false;
    }
  }

  private resolveUser(spec: string): ResolvedUser {
    const files = accountFiles(this.boot?.rootDir);

    return resolveUserSpec(spec, this.safeRead(files.passwd), this.safeRead(files.group));
  }

  private helperUser(user: ResolvedUser): HelperUser {
    return {
      uid: user.uid,
      gid: user.gid,
      groups: supplementaryGroups(user, this.safeRead(accountFiles(this.boot?.rootDir).group)),
    };
  }

  /** argv of a workload or exec process: generic mode through `lw-pty`, bundled mode as before. */
  private commandFor(
    mode: 'workload' | 'exec',
    argv: string[],
    user: ResolvedUser,
    cwd: string,
    tty: boolean,
  ): { argv: string[]; cwd: string } {
    const rootDir = this.boot?.rootDir;

    if (rootDir && this.options.lwPtyPath) {
      return {
        argv: lwPtyArgv({
          lwPty: this.options.lwPtyPath,
          mode,
          rootDir,
          pidFile: this.options.pidFile ?? GENERIC_WORKLOAD_PID_FILE,
          user: this.helperUser(user),
          cwd,
          tty,
          argv,
        }),
        cwd: '/',
      };
    }

    const command = wrapForUser(argv, user, this.ids);

    return {
      argv: tty
        ? [
            this.options.pythonPath ?? '/usr/bin/python3',
            '-I',
            this.options.ptyHelperPath ?? `${MICROVM_INSTALL_DIR}/pty-helper.py`,
            ...command,
          ]
        : command,
      cwd,
    };
  }

  /** `STATS` every n seconds (the launcher asked for them in the boot configuration). */
  private startStats(intervalSeconds: number): void {
    if (!intervalSeconds || this.statsTimer) {
      return;
    }

    const report = (): void => {
      try {
        const { stats, sample } = computeGuestStats(
          {
            meminfo: this.options.readFile('/proc/meminfo'),
            stat: this.options.readFile('/proc/stat'),
            loadavg: this.options.readFile('/proc/loadavg'),
          },
          this.cpuSample,
        );

        this.cpuSample = sample;
        this.connection.sendJson(FrameType.Stats, CONTROL_STREAM, stats);
      } catch (error) {
        this.options.log(`cannot read guest statistics: ${(error as Error).message}`);
      }
    };

    report();
    this.statsTimer = setInterval(report, intervalSeconds * 1000);
    this.statsTimer.unref?.();
  }

  /**
   * Spawns a workload / exec process with oom_score_adj 0 instead of the agent's -1000. The value is inherited at
   * fork, and spawn forks synchronously, so the agent drops its own protection only around the spawn call: no window
   * in which the child (or anything it forks) still has -1000.
   */
  private spawnUnprotected(command: string, args: string[], options: SpawnOptions): ChildProcess {
    if (!this.oomProtected) {
      return this.spawn(command, args, options);
    }

    this.setOomScoreAdj(MICROVM_GUEST_WORKLOAD_OOM_SCORE_ADJ);

    try {
      return this.spawn(command, args, options);
    } finally {
      this.oomProtected = this.setOomScoreAdj(MICROVM_GUEST_AGENT_OOM_SCORE_ADJ);
    }
  }

  private setOomScoreAdj(value: number): boolean {
    try {
      this.options.writeFile(MICROVM_GUEST_OOM_SCORE_ADJ_PATH, String(value));

      return true;
    } catch (error) {
      this.options.log(`cannot set oom_score_adj ${value}: ${(error as Error).message}`);

      return false;
    }
  }

  /** The guest kernel's OOM kill counter, or null when /proc/vmstat has none. */
  private oomKills(): number | null {
    const match = /^oom_kill (\d+)$/m.exec(this.safeRead('/proc/vmstat'));

    return match ? Number(match[1]) : null;
  }

  /** Makes a workload ended by the guest OOM killer visible in the guest log (its status is 137, SIGKILL). */
  private logOomKills(status: number): void {
    const before = this.oomKillsAtStart;
    const after = before === null ? null : this.oomKills();

    if (before !== null && after !== null && after > before) {
      this.options.log(
        `guest OOM killer ended ${after - before} process(es) while the workload ran (workload exit status ${status})`,
      );
    }
  }

  private safeRead(path: string): string {
    try {
      return this.options.readFile(path);
    } catch {
      return '';
    }
  }

  private startWorkload(boot: BootConfig): void {
    let child: ChildProcess;

    try {
      const user = this.resolveUser(boot.user);
      const { argv, cwd } = this.commandFor('workload', boot.argv, user, boot.workdir, false);

      this.oomKillsAtStart = this.oomKills();
      child = this.spawnUnprotected(argv[0], argv.slice(1), {
        cwd,
        env: buildProcessEnv(boot.env, [], user),
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });
    } catch (error) {
      this.options.log(`cannot start the workload: ${(error as Error).message}`);
      this.reportWorkloadExit(127);

      return;
    }

    this.workload = child;
    this.connection.openOutbound(WORKLOAD_STREAM);
    this.pipeOutput(WORKLOAD_STREAM, child.stdout, DataChannel.Stdout);
    this.pipeOutput(WORKLOAD_STREAM, child.stderr, DataChannel.Stderr);
    child.on('error', (error) => {
      this.options.log(`workload failed to start: ${error.message}`);
      this.reportWorkloadExit(127);
    });
    child.on('close', (code, signal) => {
      const status = exitStatus(code, signal);

      this.logOomKills(status);
      this.reportWorkloadExit(status);
    });
    this.connection.send(FrameType.Ready, CONTROL_STREAM);
  }

  private reportWorkloadExit(code: number): void {
    if (this.workload === null && this.boot === null) {
      return;
    }

    this.workload = null;
    this.boot = null;
    this.connection.whenWritable(WORKLOAD_STREAM, () => {
      this.connection.sendJson(FrameType.WorkloadExit, CONTROL_STREAM, { code });
      this.options.onWorkloadExit(code);
    });
  }

  private stopWorkload(graceSeconds: number): void {
    const workload = this.workload;

    if (!workload?.pid || this.stopping) {
      return;
    }

    this.stopping = true;
    signalGroup(workload.pid, this.boot?.stopSignal ?? 'SIGTERM');
    setTimeout(() => {
      if (this.workload === workload && workload.pid) {
        signalGroup(workload.pid, 'SIGKILL');
      }
    }, graceSeconds * 1000).unref();
  }

  private openExec(stream: number, payload: Buffer): void {
    const request = parseExecRequest(decodeJson(payload));
    const base = this.boot?.env ?? [];
    const user = this.resolveUser(request.user);
    const env = buildProcessEnv(base, request.env, user);
    const { argv, cwd } = this.commandFor(
      'exec',
      request.argv,
      user,
      request.workdir || this.boot?.workdir || '/',
      request.tty,
    );

    if (request.tty) {
      env['AGENSTRA_PTY_COLS'] = String(request.cols);
      env['AGENSTRA_PTY_ROWS'] = String(request.rows);
      env['TERM'] = env['TERM'] ?? 'xterm';
    }

    const child = this.spawnUnprotected(argv[0], argv.slice(1), {
      cwd,
      env,
      stdio: request.tty ? ['pipe', 'pipe', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'],
      detached: !request.tty,
    });
    const session: ExecSession = {
      child,
      control: request.tty ? ((child.stdio[3] as NodeJS.WritableStream | null) ?? null) : null,
    };

    this.execs.set(stream, session);
    this.connection.openOutbound(stream);
    child.stdin?.on('error', () => undefined);

    this.pipeOutput(stream, child.stdout, DataChannel.Stdout);
    this.pipeOutput(stream, child.stderr, DataChannel.Stderr);

    let spawnError: NodeJS.ErrnoException | null = null;

    child.on('error', (error: NodeJS.ErrnoException) => {
      spawnError = error;
    });
    child.on('close', (code, signal) => {
      // Like `docker exec`: a command that cannot be started reports on stderr and exits 127 (not found) / 126.
      const failed = spawnError as NodeJS.ErrnoException | null;

      if (failed) {
        this.connection.sendData(stream, DataChannel.Stderr, Buffer.from(`exec failed: ${failed.message}\n`));
      }

      const status = failed ? (failed.code === 'ENOENT' ? 127 : 126) : exitStatus(code, signal);

      this.connection.whenWritable(stream, () => {
        if (!this.execs.has(stream)) {
          return;
        }

        this.connection.sendJson(FrameType.Exit, stream, { code: status, signal: failed ? null : signal });
        this.connection.send(FrameType.Close, stream);
        this.connection.closeOutbound(stream);
        this.execs.delete(stream);
      });
    });
  }

  private onExecFrame(frame: Frame): void {
    const session = this.execs.get(frame.stream);

    if (!session) {
      return;
    }

    switch (frame.type) {
      case FrameType.Data: {
        const { data } = decodeData(frame.payload);

        if (session.child.stdin && !session.child.stdin.destroyed) {
          session.child.stdin.write(data, () => this.connection.grant(frame.stream, data.length));
        }

        break;
      }

      case FrameType.Eof:
        session.child.stdin?.end();
        break;
      case FrameType.Resize: {
        const { cols, rows } = decodeResize(frame.payload);

        session.control?.write(`resize ${cols} ${rows}\n`);
        break;
      }

      case FrameType.Signal: {
        const signal = parseSignal(frame.payload);

        if (signal && signal !== 'SIGWINCH') {
          if (session.control) {
            session.control.write(`signal ${SIGNAL_NUMBERS[signal]}\n`);
          } else if (session.child.pid) {
            signalGroup(session.child.pid, signal);
          }
        }

        break;
      }

      case FrameType.Close:
        this.execs.delete(frame.stream);
        this.connection.closeOutbound(frame.stream);
        hangUp(session);
        break;
      default:
        break;
    }
  }

  private openTcp(stream: number, payload: Buffer): void {
    const { port } = parseOpenTcp(decodeJson(payload));
    const socket = net.connect({ host: '127.0.0.1', port });

    this.tcp.set(stream, socket);
    this.connection.openOutbound(stream);
    socket.on('data', (chunk: Buffer) => {
      if (!this.connection.sendData(stream, DataChannel.Stdout, chunk)) {
        socket.pause();
        this.connection.whenWritable(stream, () => socket.resume());
      }
    });
    socket.on('end', () =>
      this.connection.whenWritable(stream, () => this.connection.send(FrameType.Eof, stream, Buffer.from([0]))),
    );
    socket.on('error', (error) => {
      if (this.tcp.has(stream)) {
        this.connection.sendJson(FrameType.Error, stream, { message: `port ${port}: ${error.message}` });
      }
    });
    socket.on('close', () => {
      if (this.tcp.delete(stream)) {
        this.connection.whenWritable(stream, () => {
          this.connection.send(FrameType.Close, stream);
          this.connection.closeOutbound(stream);
        });
      }
    });
  }

  private onTcpFrame(frame: Frame): void {
    const socket = this.tcp.get(frame.stream);

    if (!socket) {
      return;
    }

    if (frame.type === FrameType.Data) {
      const { data } = decodeData(frame.payload);

      socket.write(data, () => this.connection.grant(frame.stream, data.length));
    } else if (frame.type === FrameType.Eof) {
      socket.end();
    } else if (frame.type === FrameType.Close) {
      this.tcp.delete(frame.stream);
      this.connection.closeOutbound(frame.stream);
      socket.destroy();
    }
  }

  private pipeOutput(stream: number, source: NodeJS.ReadableStream | null, channel: DataChannel): void {
    if (!source) {
      return;
    }

    source.on('data', (chunk: Buffer) => {
      if (!this.connection.sendData(stream, channel, chunk)) {
        source.pause();
        this.pausedOutputs.add(source);
        this.connection.whenWritable(stream, () => {
          this.pausedOutputs.delete(source);
          source.resume();
        });
      }
    });
    source.on('error', () => undefined);
  }

  /** Guest `127.0.0.1:<port>` -> container loopback (e.g. the egress guard's explicit proxy in its netns). */
  private startRelays(ports: number[]): void {
    for (const port of ports) {
      const server = net.createServer((client) => {
        const upstream = net.connect({ host: this.options.relayTarget ?? MICROVM_GUEST_GATEWAY, port });

        client.pipe(upstream).pipe(client);
        client.on('error', () => upstream.destroy());
        upstream.on('error', () => client.destroy());
      });

      server.on('error', (error) => this.options.log(`loopback relay ${port}: ${error.message}`));
      server.listen(port, '127.0.0.1');
      this.relays.push(server);
    }
  }
}

function exitStatus(code: number | null, signal: NodeJS.Signals | null): number {
  if (code !== null && code >= 0) {
    return code;
  }

  const number = signal ? SIGNAL_NUMBERS[signal] : undefined;

  return number ? 128 + number : 1;
}

/** Ends an exec session whose client went away: SIGHUP to its process group (through the PTY helper for TTYs). */
function hangUp(session: ExecSession): void {
  if (session.child.exitCode !== null || !session.child.pid) {
    return;
  }

  if (session.control) {
    session.control.write(`signal ${SIGNAL_NUMBERS['SIGHUP']}\n`);
  } else {
    signalGroup(session.child.pid, 'SIGHUP');
  }
}

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // already gone
    }
  }
}
