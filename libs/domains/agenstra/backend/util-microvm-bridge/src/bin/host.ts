/**
 * Launcher-side entry point (`bridge-host.cjs`), bundled into the microVM worker image.
 *
 *   bridge-host.cjs daemon --guest-socket <path> --exec-socket <path> --boot-file <path> [--forward-ports 4096,6080]
 *                          [--console-socket <path>] [--stop-grace <s>] [--ready-timeout <s>]
 *   bridge-host.cjs boot-config --out <file> --worker-env <file> --worker-workdir <file> [--user <u>]
 *                               [--loopback-ports 3128] -- <workload argv...>
 *   bridge-host.cjs exec [--user <u>] [--workdir <dir>] [--pass-env NAME]... -- <command...>   (= vm-exec)
 */
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import * as net from 'node:net';

import { parseEnvSnapshot, readBootSnapshot } from '../lib/boot-snapshot';
import { MICROVM_EXEC_BRIDGE_FAILURE_EXIT_CODE, MICROVM_EXEC_SOCKET } from '../lib/constants';
import { runExecClient } from '../lib/exec-client';
import { ExecClientUsageError, parseExecClientArguments } from '../lib/exec-command';
import { HostDaemon, MICROVM_UNEXPECTED_STOP_EXIT_CODE } from '../lib/host-daemon';
import { FORWARDABLE_SIGNALS, ForwardableSignal, parseBootConfig } from '../lib/messages';

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

async function daemon(args: string[]): Promise<void> {
  const boot = parseBootConfig(JSON.parse(readFileSync(option(args, '--boot-file'), 'utf8')) as unknown);
  const execSocketPath = option(args, '--exec-socket', MICROVM_EXEC_SOCKET);
  const readyTimeoutSeconds = Number(option(args, '--ready-timeout', '180'));
  const host = new HostDaemon({
    boot,
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

  const guest = await connectWithRetry(option(args, '--guest-socket'), Date.now() + readyTimeoutSeconds * 1000);

  host.attachGuest(guest);
  guest.on('error', (error) => log(`guest bridge: ${error.message}`));
  guest.on('close', () => {
    host.detachGuest();
    execServer.close();
    process.exitCode = host.workloadExitCode ?? MICROVM_UNEXPECTED_STOP_EXIT_CODE;
    setTimeout(() => process.exit(), 200).unref();
  });
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

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

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

  throw new ExecClientUsageError('usage: bridge-host.cjs daemon|exec ...');
}

main().catch((error: Error) => {
  log(error.message);
  process.exit(MICROVM_EXEC_BRIDGE_FAILURE_EXIT_CODE);
});
