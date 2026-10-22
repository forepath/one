import { spawn } from 'child_process';
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';

import {
  buildIsolationLabQemuArgs,
  buildIsolationLabRunUserData,
  ISOLATION_LAB_LABEL,
  ISOLATION_LAB_PREFIX,
  type IsolationLabVmOptions,
} from '../../lib/isolation-lab.config';

import { ensureGoldenImage, ensureQemuImage } from './images';
import { docker, type ProcessResult, runProcess, runProcessOrThrow, sleep } from './process';

const GUEST_SSH_PORT = 2222;
/** Per-run private key inside the VM container's run volume (never published, removed with the run). */
const CONTAINER_KEY_PATH = '/run-data/id_ed25519';

export interface LabVm {
  name: string;
  /** Run a bash script in the guest (as root with `sudo: true`); never throws for non-zero exits. */
  exec(script: string, options?: { sudo?: boolean; timeoutMs?: number }): Promise<ProcessResult>;
  /** Run a bash script in the guest and throw when it fails; returns stdout. */
  execOrThrow(script: string, options?: { sudo?: boolean; timeoutMs?: number }): Promise<string>;
  /** Copy a local file into the guest (as root). */
  copyIn(localPath: string, remotePath: string, mode?: string): Promise<void>;
  /** Write content to a guest file (as root). */
  writeFile(remotePath: string, content: string | Buffer, mode?: string): Promise<void>;
  /** Local unix socket bridged to the guest's Docker API (the manager services talk to it). */
  dockerSocket(): Promise<string>;
  /** Load a local Docker image into the guest's Docker. */
  loadImage(image: string): Promise<void>;
  stop(): Promise<void>;
}

/** Lab host environment for `docker` processes (never a lab socket a spec may have exported). */
function hostDockerEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };

  delete env['DOCKER_HOST'];

  return env;
}

/**
 * `docker exec` arguments running SSH into the guest from inside the VM's own container (QEMU user
 * networking forwards the guest's SSH to the container's loopback). Nothing is published on the lab host,
 * which also works where published loopback ports are not reachable (Docker Desktop on WSL2).
 */
function sshViaContainer(container: string, remote: string, interactive = true): string[] {
  return [
    'exec',
    ...(interactive ? ['-i'] : []),
    container,
    'ssh',
    '-i',
    CONTAINER_KEY_PATH,
    '-p',
    String(GUEST_SSH_PORT),
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

/**
 * Start a lab VM: one container per VM (own memory cgroup, `--device /dev/kvm`) running QEMU on a
 * per-run overlay of the golden image. The test process reaches the guest with SSH through the container.
 */
export async function startLabVm(name: string, options: IsolationLabVmOptions = {}): Promise<LabVm> {
  if (!/^[a-z0-9][a-z0-9-]{0,30}$/.test(name)) {
    throw new Error(`Invalid lab VM name: ${name}`);
  }

  const golden = await ensureGoldenImage();
  const image = await ensureQemuImage();
  const runId = randomBytes(4).toString('hex');
  const container = `${ISOLATION_LAB_PREFIX}-vm-${name}-${runId}`;
  const runVolume = `${container}-run`;
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `${ISOLATION_LAB_PREFIX}-${name}-`));
  const keyPath = path.join(workDir, 'id_ed25519');
  const bridges: net.Server[] = [];
  const bridgeConnections = new Set<net.Socket>();
  const memoryMb = options.memoryMb ?? 3072;
  // Removes everything of this run (socket bridges, container, run volume, key); safe to call repeatedly.
  const cleanup = async () => {
    // Open API streams (logs, attach, exec) must not keep the bridges (and the run) alive.
    for (const connection of bridgeConnections) {
      connection.destroy();
    }

    for (const bridge of bridges.splice(0)) {
      bridge.close();
    }

    await docker(['rm', '-f', container]).catch(() => undefined);
    await docker(['volume', 'rm', '-f', runVolume]).catch(() => undefined);
    fs.rmSync(workDir, { recursive: true, force: true });
  };
  /** Last lines of the guest's serial console (boot diagnostics). */
  const serialTail = () =>
    docker(['run', '--rm', '-v', `${runVolume}:/run-data:ro`, image, 'tail', '-n', '80', '/run-data/serial.log']).catch(
      () => '(no serial console output)',
    );

  try {
    await runProcessOrThrow('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', `lab@${container}`, '-f', keyPath]);

    const userData = buildIsolationLabRunUserData({
      hostname: name,
      sshPublicKey: fs.readFileSync(`${keyPath}.pub`, 'utf-8'),
    });
    const qemuArgs = buildIsolationLabQemuArgs({
      ...options,
      memoryMb,
      diskPath: '/run-data/disk.qcow2',
      seedPath: '/run-data/seed.img',
      serialPath: '/run-data/serial.log',
      sshPort: GUEST_SSH_PORT,
    });
    const script = [
      'set -euo pipefail',
      'qemu-img create -q -f qcow2 -b /golden/golden.qcow2 -F qcow2 /run-data/disk.qcow2 30G',
      'printf "%s" "$LAB_USER_DATA" | base64 -d > /run-data/user-data',
      `printf 'instance-id: %s\\nlocal-hostname: %s\\n' "${container}" "${name}" > /run-data/meta-data`,
      'cloud-localds /run-data/seed.img /run-data/user-data /run-data/meta-data',
      `exec qemu-system-x86_64 ${qemuArgs.map((arg) => `'${arg}'`).join(' ')}`,
    ].join('\n');

    await docker(['volume', 'create', '--label', `${ISOLATION_LAB_LABEL}=run`, runVolume]);
    await docker([
      'run',
      '-d',
      '--name',
      container,
      '--label',
      `${ISOLATION_LAB_LABEL}=run`,
      '--device',
      '/dev/kvm',
      '--memory',
      `${memoryMb + 768}m`,
      '-v',
      `${golden}:/golden:ro`,
      '-v',
      `${runVolume}:/run-data`,
      '-e',
      `LAB_USER_DATA=${Buffer.from(userData).toString('base64')}`,
      image,
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
    runProcess('docker', sshViaContainer(container, remote), { input, timeoutMs, env: hostDockerEnv() });

  const vm: LabVm = {
    name,
    async exec(body, execOptions = {}) {
      const shell = execOptions.sudo ? 'sudo bash -s' : 'bash -s';

      return ssh(shell, `set -euo pipefail\n${body}\n`, execOptions.timeoutMs);
    },
    async execOrThrow(body, execOptions = {}) {
      const result = await vm.exec(body, execOptions);

      if (result.code !== 0) {
        throw new Error(
          `Lab VM ${name}: script failed (${result.code}): ${(result.stderr || result.stdout).slice(-3000)}`,
        );
      }

      return result.stdout;
    },
    async copyIn(localPath, remotePath, mode = '0644') {
      await vm.writeFile(remotePath, fs.readFileSync(localPath), mode);
    },
    async writeFile(remotePath, content, mode = '0644') {
      if (!/^\/[A-Za-z0-9._/-]+$/.test(remotePath) || !/^[0-7]{3,4}$/.test(mode)) {
        throw new Error(`Invalid lab VM path or mode: ${remotePath} ${mode}`);
      }

      const result = await ssh(`sudo install -D -m ${mode} /dev/stdin ${remotePath}`, content);

      if (result.code !== 0) {
        throw new Error(`Lab VM ${name}: copy to ${remotePath} failed: ${result.stderr}`);
      }
    },
    async dockerSocket() {
      const socketPath = path.join(workDir, `docker-${bridges.length}.sock`);
      // Every connection to the local socket becomes a `docker system dial-stdio` session in the guest
      // (the Docker CLI's own stdio proxy to the daemon socket), carried over SSH.
      // Half-open: Docker clients close their write side after sending stdin and keep reading the output.
      const bridge = net.createServer({ allowHalfOpen: true }, (connection) => {
        const child = spawn('docker', sshViaContainer(container, 'docker system dial-stdio'), {
          env: hostDockerEnv(),
          stdio: ['pipe', 'pipe', 'ignore'],
        });

        bridgeConnections.add(connection);
        connection.pipe(child.stdin);
        // The socket ends once the child's output is fully drained (not on process exit).
        child.stdout.pipe(connection);
        connection.on('close', () => {
          bridgeConnections.delete(connection);
          child.kill('SIGTERM');
        });
        connection.on('error', () => child.kill('SIGTERM'));
        child.on('error', () => connection.destroy());
        child.stdin.on('error', () => connection.destroy());
      });

      await new Promise<void>((resolve, reject) => {
        bridge.once('error', reject);
        bridge.listen(socketPath, () => resolve());
      });
      bridges.push(bridge);

      return socketPath;
    },
    async loadImage(dockerImage) {
      const archive = path.join(workDir, `image-${randomBytes(4).toString('hex')}.tar`);

      try {
        await docker(['image', 'save', '-o', archive, dockerImage], { timeoutMs: 10 * 60_000 });

        const result = await ssh('docker load -q', fs.readFileSync(archive), 10 * 60_000);

        if (result.code !== 0) {
          throw new Error(`Lab VM ${name}: docker load failed: ${result.stderr}`);
        }
      } finally {
        fs.rmSync(archive, { force: true });
      }
    },
    async stop() {
      await cleanup();
    },
  };

  try {
    // Boot to SSH, then wait for this instance's cloud-init (lab user, keys) to finish.
    const deadline = Date.now() + 8 * 60_000;
    let ready = false;

    while (Date.now() < deadline) {
      const running = (await docker(['inspect', '-f', '{{.State.Running}}', container])).trim();

      if (running !== 'true') {
        const logs = await docker(['logs', '--tail', '60', container]).catch(() => '');

        throw new Error(`Lab VM ${name} stopped while booting:\n${logs}\nSerial console:\n${await serialTail()}`);
      }

      const probe = await ssh(
        'cloud-init status --wait >/dev/null 2>&1; systemctl is-active docker',
        undefined,
        60_000,
      );

      if (probe.code === 0 && probe.stdout.trim() === 'active') {
        ready = true;
        break;
      }

      await sleep(3000);
    }

    if (!ready) {
      throw new Error(`Lab VM ${name} did not become reachable. Serial console:\n${await serialTail()}`);
    }
  } catch (error) {
    await vm.stop();
    throw error;
  }

  return vm;
}
