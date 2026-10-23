/**
 * Launcher-side entry point (`bridge-host.cjs`), bundled into the microVM worker image.
 *
 *   bridge-host.cjs daemon --guest-socket <path> --exec-socket <path> --boot-file <path> [--forward-ports 4096,6080]
 *                          [--resync]   (after a live migration: the guest re-attaches, no BOOT)
 *                          [--console-socket <path>] [--stop-grace <s>] [--ready-timeout <s>] [--stats-file <path>]
 *   bridge-host.cjs boot-config --out <file> --worker-env <file> --worker-workdir <file> [--user <u>]
 *                               [--loopback-ports 3128] -- <workload argv...>
 *   bridge-host.cjs boot-config --out <file> --process-file <boot-process.json> [--root-dir /newroot]   (generic)
 *   bridge-host.cjs exec [--user <u>] [--workdir <dir>] [--pass-env NAME]... -- <command...>   (= vm-exec)
 *   bridge-host.cjs net-config --net-file <net.json>          prints the guest MAC and the kernel cmdline (generic)
 *   bridge-host.cjs vm-domain --config <vm.json> --run-dir <dir> --out <domain.xml> [--seed-image <file>]  (full VM)
 *   bridge-host.cjs relay --socket <path>                      stdio <-> UNIX socket (vm-console)
 */
import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import * as net from 'node:net';

import {
  parseEnvSnapshot,
  parseGenericBootProcess,
  readBootSnapshot,
  readGenericBootSnapshot,
} from '../lib/boot-snapshot';
import {
  MICROVM_EXEC_BRIDGE_FAILURE_EXIT_CODE,
  MICROVM_EXEC_SOCKET,
  MICROVM_GENERIC_GUEST_ROOT,
  MICROVM_STATS_INTERVAL_SECONDS,
} from '../lib/constants';
import { runExecClient } from '../lib/exec-client';
import { ExecClientUsageError, parseExecClientArguments } from '../lib/exec-command';
import { HostDaemon, MICROVM_UNEXPECTED_STOP_EXIT_CODE } from '../lib/host-daemon';
import {
  LauncherArch,
  parseMicrovmNetConfig,
  parseVmLaunchConfig,
  renderGuestNetCmdline,
  renderVmDomainXml,
} from '../lib/launcher-config';
import { FORWARDABLE_SIGNALS, ForwardableSignal, GuestStats, parseBootConfig } from '../lib/messages';

/** How long `vm-exec` waits for the launcher daemon's exec socket (container start until the daemon listens). */
const EXEC_CONNECT_TIMEOUT_MS = 180_000;

const log = (message: string): void => {
  process.stderr.write(`agenstra-microvm: ${message}\n`);
};

function option(args: string[], name: string, fallback?: string): string {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;

  if (value === undefined) {
    if (fallback !== undefined) {
      return fallback;
    }

    throw new Error(`missing ${name}`);
  }

  return value;
}

function parsePorts(value: string): number[] {
  if (!value.trim()) {
    return [];
  }

  return value.split(',').map((entry) => {
    const port = Number(entry.trim());

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`invalid port ${entry}`);
    }

    return port;
  });
}

function connectWithRetry(path: string, deadline: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const attempt = (): void => {
      const socket = net.connect(path);

      socket.once('connect', () => resolve(socket));
      socket.once('error', (error) => {
        socket.destroy();

        if (Date.now() > deadline) {
          reject(error);
        } else {
          setTimeout(attempt, 100);
        }
      });
    };

    attempt();
  });
}

/** Atomically replaces the guest statistics file the node agent's metrics collector reads. */
function writeStats(path: string, stats: GuestStats): void {
  const temporary = `${path}.tmp`;

  try {
    writeFileSync(temporary, JSON.stringify({ ...stats, updatedAt: new Date().toISOString() }), { mode: 0o644 });
    renameSync(temporary, path);
  } catch (error) {
    log(`cannot write guest statistics: ${(error as Error).message}`);
  }
}

/** How long a re-attaching daemon (`--resync`, after a live migration) waits for the guest's marker. */
const RESYNC_TIMEOUT_MS = 10_000;

async function daemon(args: string[]): Promise<void> {
  const statsFile = option(args, '--stats-file', '');
  const boot = {
    ...parseBootConfig(JSON.parse(readFileSync(option(args, '--boot-file'), 'utf8')) as unknown),
    ...(statsFile ? { statsIntervalSeconds: MICROVM_STATS_INTERVAL_SECONDS } : {}),
  };
  const execSocketPath = option(args, '--exec-socket', MICROVM_EXEC_SOCKET);
  const readyTimeoutSeconds = Number(option(args, '--ready-timeout', '180'));
  const resync = args.includes('--resync');
  const host = new HostDaemon({
    ...(resync ? { resync: true } : {}),
    boot,
    ...(statsFile ? { onStats: (stats: GuestStats) => writeStats(statsFile, stats) } : {}),
    forwardPorts: parsePorts(option(args, '--forward-ports', '')),
    readyTimeoutMs: readyTimeoutSeconds * 1000,
    stopGraceSeconds: Number(option(args, '--stop-grace', '10')),
    stdout: (data, done) => process.stdout.write(data, () => done()),
    stderr: (data, done) => process.stderr.write(data, () => done()),
    log,
  });

  try {
    unlinkSync(execSocketPath);
  } catch {
    // not there
  }

  const execServer = net.createServer((socket) => host.handleExecClient(socket));

  process.umask(0o077);
  execServer.listen(execSocketPath);

  for (const port of parsePorts(option(args, '--forward-ports', ''))) {
    const server = net.createServer((socket) => host.handleTcpConnection(socket, port));

    server.on('error', (error) => log(`cannot forward port ${port}: ${error.message}`));
    server.listen(port, '0.0.0.0');
  }

  process.on('SIGTERM', () => host.requestStop());
  process.on('SIGINT', () => host.requestStop());

  const consoleSocketPath = option(args, '--console-socket', '');

  if (consoleSocketPath) {
    // Guest console (kernel and init messages) on stderr, line by line; never buffered on disk.
    void connectWithRetry(consoleSocketPath, Date.now() + readyTimeoutSeconds * 1000)
      .then((socket) => {
        let pending = '';

        socket.on('data', (chunk: Buffer) => {
          const lines = (pending + chunk.toString('utf8')).split(/\r?\n/);

          pending = (lines.pop() ?? '').slice(-4096);

          for (const line of lines) {
            if (line.trim()) {
              process.stderr.write(`agenstra-microvm console: ${line.slice(0, 4096)}\n`);
            }
          }
        });
        socket.on('error', () => undefined);
      })
      .catch((error: Error) => log(`guest console: ${error.message}`));
  }

  const attach = async (): Promise<void> => {
    const guest = await connectWithRetry(option(args, '--guest-socket'), Date.now() + readyTimeoutSeconds * 1000);
    let reconnecting = false;

    host.attachGuest(guest);
    guest.on('error', (error) => log(`guest bridge: ${error.message}`));
    guest.on('close', () => {
      if (reconnecting) {
        void attach().catch((error: Error) => log(`guest bridge: ${error.message}`));

        return;
      }

      host.detachGuest();
      execServer.close();
      process.exitCode = host.workloadExitCode ?? MICROVM_UNEXPECTED_STOP_EXIT_CODE;
      setTimeout(() => process.exit(), 200).unref();
    });

    if (resync) {
      // After a live migration: a guest that didn't see the launcher end go away never re-attaches; reconnecting
      // makes its port report the disconnect (virtio-serial PORT_OPEN 0 / 1).
      const timer = setInterval(() => {
        clearInterval(timer);

        if (host.isSynced) return;

        log('the guest did not re-attach yet: reconnecting to its port');
        reconnecting = true;
        guest.destroy();
      }, RESYNC_TIMEOUT_MS);

      timer.unref();
    }
  };

  await attach();
}

async function exec(args: string[]): Promise<number> {
  let parsed;

  try {
    parsed = parseExecClientArguments(args);
  } catch (error) {
    process.stderr.write(`vm-exec: ${(error as Error).message}\n`);

    return MICROVM_EXEC_BRIDGE_FAILURE_EXIT_CODE;
  }

  let socket: net.Socket;

  try {
    // `docker exec` may run right after the container started, before the launcher's daemon listens.
    socket = await connectWithRetry(MICROVM_EXEC_SOCKET, Date.now() + EXEC_CONNECT_TIMEOUT_MS);
  } catch (error) {
    process.stderr.write(`vm-exec: the microVM bridge is not available: ${(error as Error).message}\n`);

    return MICROVM_EXEC_BRIDGE_FAILURE_EXIT_CODE;
  }

  return runExecClient(socket, parsed, {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    env: process.env,
    onSignal: (handler) => {
      const listeners = FORWARDABLE_SIGNALS.filter((signal) => signal !== 'SIGKILL').map((signal) => {
        const listener = (): void => handler(signal as ForwardableSignal);

        process.on(signal, listener);

        return () => process.off(signal, listener);
      });

      return () => listeners.forEach((off) => off());
    },
  });
}

function bootConfig(args: string[]): void {
  const separator = args.indexOf('--');
  const options = separator >= 0 ? args.slice(0, separator) : args;
  const read = (path: string): string => {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return '';
    }
  };
  const processFile = option(options, '--process-file', '');

  if (processFile) {
    // Generic mode: the workload process comes from the node agent, not from this container's environment.
    const generic = readGenericBootSnapshot({
      process: parseGenericBootProcess(JSON.parse(readFileSync(processFile, 'utf8')) as unknown),
      hostname: read('/etc/hostname').trim(),
      hosts: read('/etc/hosts'),
      resolvConf: read('/etc/resolv.conf'),
      rootDir: option(options, '--root-dir', MICROVM_GENERIC_GUEST_ROOT),
    });

    writeFileSync(option(options, '--out'), JSON.stringify(generic), { mode: 0o600 });

    return;
  }

  const snapshot = readBootSnapshot({
    workerEnv: parseEnvSnapshot(read(option(options, '--worker-env'))),
    workerWorkdir: read(option(options, '--worker-workdir')).trim(),
    containerEnv: process.env,
    hostname: read('/etc/hostname').trim(),
    hosts: read('/etc/hosts'),
    resolvConf: read('/etc/resolv.conf'),
    argv: separator >= 0 ? args.slice(separator + 1) : [],
    user: option(options, '--user', ''),
    loopbackPorts: parsePorts(option(options, '--loopback-ports', '')),
  });

  writeFileSync(option(options, '--out'), JSON.stringify(snapshot), { mode: 0o600 });
}

function netConfig(args: string[]): void {
  const net = parseMicrovmNetConfig(JSON.parse(readFileSync(option(args, '--net-file'), 'utf8')) as unknown);

  process.stdout.write(`${net.mac}\n${renderGuestNetCmdline(net)}\n`);
}

function launcherArch(): LauncherArch {
  if (process.arch === 'x64') {
    return 'x86_64';
  }

  if (process.arch === 'arm64') {
    return 'aarch64';
  }

  throw new Error(`unsupported architecture ${process.arch}`);
}

function vmDomain(args: string[]): void {
  const config = parseVmLaunchConfig(JSON.parse(readFileSync(option(args, '--config'), 'utf8')) as unknown);
  const seedImage = option(args, '--seed-image', '');
  const domain = renderVmDomainXml({
    config,
    arch: launcherArch(),
    runDir: option(args, '--run-dir'),
    ...(seedImage ? { seedImage } : {}),
  });

  writeFileSync(option(args, '--out'), domain, { mode: 0o600 });
  // The launcher needs the devices for the VMM's groups and the taps to wait for.
  process.stdout.write(
    `${config.disks.map((disk) => disk.device).join(' ')}\n${config.nics.map((nic) => nic.tap).join(' ')}\n`,
  );
}

/** Relays stdio to a UNIX socket (serial console: raw TTY; VNC: binary RFB). Ends when either side closes. */
async function relay(args: string[]): Promise<number> {
  const socket = await connectWithRetry(option(args, '--socket'), Date.now() + 10_000);

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }

  return new Promise((resolve) => {
    process.stdin.pipe(socket);
    socket.pipe(process.stdout);
    socket.on('close', () => resolve(0));
    socket.on('error', (error) => {
      process.stderr.write(`vm-console: ${error.message}\n`);
      resolve(1);
    });
    process.stdin.on('end', () => socket.end());
  });
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  if (command === 'net-config') {
    netConfig(args);

    return;
  }

  if (command === 'vm-domain') {
    vmDomain(args);

    return;
  }

  if (command === 'relay') {
    process.exitCode = await relay(args);
    process.exit();
  }

  if (command === 'boot-config') {
    bootConfig(args);

    return;
  }

  if (command === 'daemon') {
    await daemon(args);

    return;
  }

  if (command === 'exec') {
    process.exitCode = await exec(args);

    return;
  }

  throw new ExecClientUsageError('usage: bridge-host.cjs daemon|exec|boot-config|net-config|vm-domain|relay ...');
}

main().catch((error: Error) => {
  log(error.message);
  process.exit(MICROVM_EXEC_BRIDGE_FAILURE_EXIT_CODE);
});
