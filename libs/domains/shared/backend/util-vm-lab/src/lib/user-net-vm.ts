import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { onLabExit } from './exit';
import { ensureLabLocks } from './locks';
import { assertHostMemory, DEFAULT_LAB_MAX_MEMORY_MB } from './memory';
import { docker, hostDockerEnv, run, type RunResult, runOrThrow, sleep } from './process';
import { openDockerSocketTunnel, openTcpTunnel, type Tunnel } from './tunnel';

/**
 * Single lab VM with QEMU user-mode networking (from Agenstra's isolation-lab): one container per VM (own memory
 * cgroup, `--device /dev/kvm`) running QEMU on a per-run overlay of the golden image; the guest's ssh is forwarded to
 * the container's loopback only, the test process reaches it with `docker exec … ssh` (nothing published on the lab
 * host, which also works where published loopback ports are unreachable: Docker Desktop on WSL2).
 */

export interface UserNetVmConfig {
  /** Name prefix (`<prefix>-vm-<name>-<run>`). */
  prefix: string;
  /** Label on the container / volume (value `run`). */
  label: string;
  qemuImage: string;
  goldenVolume: string;
  /** Root disk virtual size of the overlay. */
  diskGb: number;
  /** QEMU overhead next to the guest RAM. */
  overheadMb: number;
  /** Guest ssh port inside the container (QEMU `hostfwd` on 127.0.0.1). */
  sshPort: number;
  /** QEMU arguments (after `qemu-system-x86_64`) for the paths in the run volume. */
  qemuArgs: (paths: { diskPath: string; seedPath: string; serialPath: string; sshPort: number }) => string[];
  /** Per-run cloud-init user data for the generated ssh public key. */
  userData: (sshPublicKey: string) => string;
  /** Readiness probe run in the guest: ready when it exits 0 with this stdout. */
  readiness: { script: string; stdout: string };
  bootTimeoutMs: number;
  /** Lab memory guard of this process (default 7 GiB). */
  maxMemoryMb?: number;
}

export interface UserNetVm {
  name: string;
  readonly container: string;
  readonly memoryMb: number;
  /** Run a bash script in the guest (as root with `sudo: true`); never throws for non-zero exits. */
  exec(script: string, options?: { sudo?: boolean; timeoutMs?: number }): Promise<RunResult>;
  /** Run a bash script in the guest and throw when it fails; returns stdout. */
  execOrThrow(script: string, options?: { sudo?: boolean; timeoutMs?: number }): Promise<string>;
  /** Copy a local file into the guest (as root). */
  copyIn(localPath: string, remotePath: string, mode?: string): Promise<void>;
  /** Write content to a guest file (as root). */
  writeFile(remotePath: string, content: string | Buffer, mode?: string): Promise<void>;
  /** Local unix socket bridged to the guest's Docker API. */
  dockerSocket(): Promise<string>;
  /** Local TCP port (127.0.0.1) forwarded to `host:port` inside the guest. */
  forward(port: number, host?: string): Promise<Tunnel>;
  /** Load a local Docker image into the guest's Docker. */
  loadImage(image: string): Promise<void>;
  stop(): Promise<void>;
}

/** Per-run private key inside the VM container's run volume (never published, removed with the run). */
const CONTAINER_KEY_PATH = '/run-data/id_ed25519';
const RUNNING_KEY = Symbol.for('forepath.vm-lab.user-net-running');

function running(): Map<string, number> {
  const holder = globalThis as unknown as Record<symbol, Map<string, number> | undefined>;

  holder[RUNNING_KEY] ??= new Map();

  return holder[RUNNING_KEY] as Map<string, number>;
}

/** `docker exec` arguments running ssh into the guest from inside the VM's own container. */
function sshViaContainer(container: string, sshPort: number, remote: string, interactive = true): string[] {
  return [
    'exec',
    ...(interactive ? ['-i'] : []),
    container,
    'ssh',
    '-i',
    CONTAINER_KEY_PATH,
    '-p',
    String(sshPort),
    '-o',
    'StrictHostKeyChecking=no',
    '-o',
    'UserKnownHostsFile=/dev/null',
    '-o',
    'LogLevel=ERROR',
    '-o',
    'ConnectTimeout=5',
    '-o',
    'IdentitiesOnly=yes',
    '-o',
    'BatchMode=yes',
    'lab@127.0.0.1',
    remote,
  ];
}

/** Starts one user-network lab VM and waits until the readiness probe passes. */
export async function startUserNetVm(config: UserNetVmConfig, name: string, memoryMb: number): Promise<UserNetVm> {
  if (!/^[a-z0-9][a-z0-9-]{0,30}$/.test(name)) throw new Error(`Invalid lab VM name: ${name}`);

  const containerMb = memoryMb + config.overheadMb;
  const inUse = [...running().values()].reduce((sum, mb) => sum + mb, 0);
  const max = config.maxMemoryMb ?? DEFAULT_LAB_MAX_MEMORY_MB;

  if (inUse + containerMb > max)
    throw new Error(
      `lab VM ${name} needs ${containerMb} MiB; with ${inUse} MiB in use that exceeds the ${max} MiB guard`,
    );

  assertHostMemory(containerMb);
  await ensureLabLocks({ label: config.label });

  const runId = randomBytes(4).toString('hex');
  const container = `${config.prefix}-vm-${name}-${runId}`;
  const runVolume = `${container}-run`;
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `${config.prefix}-${name}-`));
  const keyPath = path.join(workDir, 'id_ed25519');
  const tunnels: Tunnel[] = [];
  const removeSync = () => {
    for (const t of tunnels.splice(0)) t.close();

    spawnSync('docker', ['rm', '-f', container], { env: hostDockerEnv() });
    spawnSync('docker', ['volume', 'rm', '-f', runVolume], { env: hostDockerEnv() });
    fs.rmSync(workDir, { recursive: true, force: true });
    running().delete(container);
  };
  const removeHook = onLabExit(removeSync);
  // Removes everything of this run (tunnels, container, run volume, key); safe to call repeatedly.
  const cleanup = async () => {
    for (const t of tunnels.splice(0)) t.close();

    await docker(['rm', '-f', container]).catch(() => undefined);
    await docker(['volume', 'rm', '-f', runVolume]).catch(() => undefined);
    fs.rmSync(workDir, { recursive: true, force: true });
    running().delete(container);
    removeHook();
  };
  /** Last lines of the guest's serial console (boot diagnostics). */
  const serialTail = () =>
    docker([
      'run',
      '--rm',
      '-v',
      `${runVolume}:/run-data:ro`,
      config.qemuImage,
      'tail',
      '-n',
      '80',
      '/run-data/serial.log',
    ]).catch(() => '(no serial console output)');

  running().set(container, containerMb);

  try {
    await runOrThrow('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', `lab@${container}`, '-f', keyPath]);

    const userData = config.userData(fs.readFileSync(`${keyPath}.pub`, 'utf-8'));
    const qemuArgs = config.qemuArgs({
      diskPath: '/run-data/disk.qcow2',
      seedPath: '/run-data/seed.img',
      serialPath: '/run-data/serial.log',
      sshPort: config.sshPort,
    });
    const script = [
      'set -euo pipefail',
      `qemu-img create -q -f qcow2 -b /golden/golden.qcow2 -F qcow2 /run-data/disk.qcow2 ${config.diskGb}G`,
      'printf "%s" "$LAB_USER_DATA" | base64 -d > /run-data/user-data',
      `printf 'instance-id: %s\\nlocal-hostname: %s\\n' "${container}" "${name}" > /run-data/meta-data`,
      'cloud-localds /run-data/seed.img /run-data/user-data /run-data/meta-data',
      `exec qemu-system-x86_64 ${qemuArgs.map((arg) => `'${arg}'`).join(' ')}`,
    ].join('\n');

    await docker(['volume', 'create', '--label', `${config.label}=run`, runVolume]);
    await docker([
      'run',
      '-d',
      '--name',
      container,
      '--label',
      `${config.label}=run`,
      '--device',
      '/dev/kvm',
      '--memory',
      `${containerMb}m`,
      '-v',
      `${config.goldenVolume}:/golden:ro`,
      '-v',
      `${runVolume}:/run-data`,
      '-e',
      `LAB_USER_DATA=${Buffer.from(userData).toString('base64')}`,
      config.qemuImage,
      'bash',
      '-c',
      script,
    ]);
    // The private key only lives in the run volume (removed with the run).
    await docker(['exec', '-i', container, 'sh', '-c', `umask 077 && cat > ${CONTAINER_KEY_PATH}`], {
      input: fs.readFileSync(keyPath),
    }).catch(async (error: unknown) => {
      const logs = await docker(['logs', '--tail', '60', container]).catch(() => '');

      throw new Error(`Lab VM ${name} did not start: ${(error as Error).message}\n${logs}`);
    });
    fs.rmSync(keyPath, { force: true });
  } catch (error) {
    await cleanup();
    throw error;
  }

  const ssh = (remote: string, input?: string | Buffer, timeoutMs = 10 * 60_000) =>
    run('docker', sshViaContainer(container, config.sshPort, remote), { input, timeoutMs, env: hostDockerEnv() });

  const vm: UserNetVm = {
    name,
    container,
    memoryMb,
    async exec(body, execOptions = {}) {
      const shell = execOptions.sudo ? 'sudo bash -s' : 'bash -s';

      return ssh(shell, `set -euo pipefail\n${body}\n`, execOptions.timeoutMs);
    },
    async execOrThrow(body, execOptions = {}) {
      const result = await vm.exec(body, execOptions);

      if (result.code !== 0)
        throw new Error(
          `Lab VM ${name}: script failed (${result.code}): ${(result.stderr || result.stdout).slice(-3000)}`,
        );

      return result.stdout;
    },
    async copyIn(localPath, remotePath, mode = '0644') {
      await vm.writeFile(remotePath, fs.readFileSync(localPath), mode);
    },
    async writeFile(remotePath, content, mode = '0644') {
      if (!/^\/[A-Za-z0-9._/-]+$/.test(remotePath) || !/^[0-7]{3,4}$/.test(mode))
        throw new Error(`Invalid lab VM path or mode: ${remotePath} ${mode}`);

      const result = await ssh(`sudo install -D -m ${mode} /dev/stdin ${remotePath}`, content);

      if (result.code !== 0) throw new Error(`Lab VM ${name}: copy to ${remotePath} failed: ${result.stderr}`);
    },
    async dockerSocket() {
      const tunnel = await openDockerSocketTunnel(
        (remote) => sshViaContainer(container, config.sshPort, remote),
        path.join(workDir, `docker-${tunnels.length}.sock`),
      );

      tunnels.push(tunnel);

      return tunnel.address.slice('unix:'.length);
    },
    async forward(port, host = '127.0.0.1') {
      const tunnel = await openTcpTunnel((remote) => sshViaContainer(container, config.sshPort, remote), host, port);

      tunnels.push(tunnel);

      return tunnel;
    },
    async loadImage(dockerImage) {
      const archive = path.join(workDir, `image-${randomBytes(4).toString('hex')}.tar`);

      try {
        await docker(['image', 'save', '-o', archive, dockerImage], { timeoutMs: 10 * 60_000 });

        const result = await ssh('docker load -q', fs.readFileSync(archive), 10 * 60_000);

        if (result.code !== 0) throw new Error(`Lab VM ${name}: docker load failed: ${result.stderr}`);
      } finally {
        fs.rmSync(archive, { force: true });
      }
    },
    async stop() {
      await cleanup();
    },
  };

  try {
    // Boot to ssh, then wait for the readiness probe (e.g. this instance's cloud-init + Docker).
    const deadline = Date.now() + config.bootTimeoutMs;
    let ready = false;

    while (Date.now() < deadline) {
      const state = (await docker(['inspect', '-f', '{{.State.Running}}', container])).trim();

      if (state !== 'true') {
        const logs = await docker(['logs', '--tail', '60', container]).catch(() => '');

        throw new Error(`Lab VM ${name} stopped while booting:\n${logs}\nSerial console:\n${await serialTail()}`);
      }

      const probe = await ssh(config.readiness.script, undefined, 60_000);

      if (probe.code === 0 && probe.stdout.trim() === config.readiness.stdout) {
        ready = true;
        break;
      }

      await sleep(3000);
    }

    if (!ready) throw new Error(`Lab VM ${name} did not become reachable. Serial console:\n${await serialTail()}`);
  } catch (error) {
    await vm.stop();
    throw error;
  }

  return vm;
}
