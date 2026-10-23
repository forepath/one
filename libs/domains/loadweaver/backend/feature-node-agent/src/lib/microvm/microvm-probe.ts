import { randomBytes } from 'node:crypto';
import { chown, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { WorkloadSpec } from '@forepath/loadweaver/shared/util-agent-protocol';
import { MICROVM_EXEC_CLIENT_PATH, MICROVM_VMM_UID } from '@forepath/shared/backend/util-microvm-bridge';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type Docker from 'dockerode';

import { CommandError, CommandRunner } from '../host/command-runner';
import { DOCKER } from '../host/docker.provider';
import { PROBE_LABEL } from '../host/managed-containers';
import { podGatewayCommands } from '../network/pod-network.manager';
import { containerOptions, MANAGED_LABEL, WORKLOAD_HASH_LABEL, WORKLOAD_LABEL } from '../workloads/workload-container';
import { GuestNetwork, guestNetConfig, guestNics } from './guest-network';
import { RootfsCache } from './rootfs-cache';
import { extractExportedTree } from './rootfs-unpack';

/**
 * The microVM boot probe (3.1 / 3.35, M7.2): a generic launcher boots the node shell image as guest with tap
 * networking on a small internal probe network and must pass: boot (workload output on stdout and stderr in
 * `docker logs`), exec exit codes through `vm-exec` (0 and 3), file coherence (the guest writes, the host reads the
 * guest root), the guest IP answering ICMP from the host, and a clean stop (exit 0). Timeout 240 s.
 *
 * The guest root is the node shell image's exported file system (a plain directory, not the overlay of the unpack
 * cache: the probe image is a local Docker image, the cache fetches registry blobs); the unpack cache is checked on
 * its own (tools present, layout writable).
 */

export const MICROVM_PROBE_TIMEOUT_MS = 240_000;
/** Internal bridge of the probe (TEST-NET-1, never routed): the guest gets `.2`, the host owns `.1`. */
export const PROBE_NETWORK = 'loadweaver-microvm-probe';
export const PROBE_BRIDGE = 'lwprobe0';
export const PROBE_SUBNET = '192.0.2.0/29';
export const PROBE_GUEST_ADDRESS = '192.0.2.2';
const STDOUT_MARK = 'lw-probe-stdout';
const STDERR_MARK = 'lw-probe-stderr';

export type MicrovmProbeResult =
  | { ok: true; unpackCache: boolean; thinPool: boolean }
  | { ok: false; reasonCode: string; reason: string; unpackCache: boolean; thinPool: boolean };

/** The synthetic workload of the probe (never reported, never reconciled: labelled as a probe only). */
export function probeSpec(launcher: string): WorkloadSpec {
  return {
    id: 'lw-probe/microvm/probe/0',
    project: 'lw-probe',
    deployment: 'microvm',
    service: 'probe',
    kind: 'service',
    image: launcher,
    environment: {},
    labels: {},
    addresses: [PROBE_GUEST_ADDRESS],
    dnsSearch: [],
    runtime: 'runc',
    isolation: 'microvm',
    resources: { cpuMillis: 250, memoryBytes: 256 * 1024 ** 2 },
    restart: 'no',
    stopGracePeriodMs: 10_000,
    init: false,
    readOnly: false,
    privileged: false,
    capAdd: [],
    capDrop: [],
    ulimits: {},
    extraHosts: [],
    volumes: [],
    secrets: [],
    specHash: '0'.repeat(32),
    microvm: {
      mode: 'generic',
      process: {
        entrypoint: ['/bin/sh', '-c'],
        // A clean stop: SIGTERM ends the workload with status 0.
        cmd: [`trap 'exit 0' TERM; echo ${STDOUT_MARK}; echo ${STDERR_MARK} >&2; sleep 3600 & wait`],
        env: ['PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'],
        user: '',
        workingDir: '/',
        stopSignal: 'SIGTERM',
      },
      vcpus: 1,
      memoryMiB: 256,
      rootfsBytes: 64 * 1024 ** 2,
    },
  };
}

/** Docker create options of the probe launcher: the workload options, relabelled as a probe, no restarts. */
export function probeContainerOptions(
  spec: WorkloadSpec,
  host: { runDir: string; merged: string },
  name: string,
): Docker.ContainerCreateOptions {
  const options = containerOptions(spec, { dnsServers: [], secretFiles: [], network: PROBE_NETWORK, microvm: host });
  const labels = { ...(options.Labels ?? {}) };

  for (const key of [MANAGED_LABEL, WORKLOAD_LABEL, WORKLOAD_HASH_LABEL]) delete labels[key];

  return {
    ...options,
    name,
    Labels: { ...labels, [PROBE_LABEL]: '1' },
    HostConfig: { ...options.HostConfig, RestartPolicy: { Name: 'no' } },
  };
}

class ProbeFailure extends Error {
  constructor(
    readonly reasonCode: string,
    message: string,
  ) {
    super(message);
  }
}

@Injectable()
export class MicrovmProbe {
  private readonly logger = new Logger(MicrovmProbe.name);
  /** Overridable in tests. */
  sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  now = () => Date.now();
  runtimeDir = () => process.env['LOADWEAVER_RUNTIME_DIR'] || '/run/loadweaver';

  constructor(
    private readonly commands: CommandRunner,
    @Inject(DOCKER) private readonly docker: Docker,
    private readonly rootfs: RootfsCache,
    private readonly network: GuestNetwork,
  ) {}

  async run(launcher: string, shellImage: string | null): Promise<MicrovmProbeResult> {
    const cache = await this.rootfs.available().catch(() => ({ unpackCache: false, thinPool: false }));
    const fail = (reasonCode: string, reason: string): MicrovmProbeResult => ({
      ok: false,
      reasonCode,
      reason,
      ...cache,
    });

    if (!cache.unpackCache)
      return fail(
        'E_MICROVM_BOOT_FAILED',
        'the image unpack cache is not usable (needs unshare, setfattr, mkfs.ext4 and a writable vmroot)',
      );

    if (!shellImage) return fail('E_PROBE_IMAGE_UNAVAILABLE', 'the probe image (node shell) is unavailable');

    const id = randomBytes(4).toString('hex');
    const name = `lw-probe-microvm-${id}`;
    const runDir = join(this.runtimeDir(), 'vm', `probe-${id}`);
    const root = join(this.rootfs.paths.root, 'probe', id);
    const deadline = this.now() + MICROVM_PROBE_TIMEOUT_MS;

    try {
      await this.boot(launcher, shellImage, name, runDir, root, deadline);
      await this.checks(name, root, deadline);
      await this.stop(name);

      return { ok: true, ...cache };
    } catch (error) {
      const failure =
        error instanceof ProbeFailure
          ? error
          : new ProbeFailure('E_MICROVM_BOOT_FAILED', error instanceof Error ? error.message : String(error));

      this.logger.warn(`microVM probe failed: ${failure.message}`);

      return fail(failure.reasonCode, failure.message);
    } finally {
      await this.commands.run('docker', ['rm', '-f', name], { timeoutMs: 30_000 }).catch(() => undefined);
      await rm(runDir, { recursive: true, force: true });
      await rm(root, { recursive: true, force: true });
    }
  }

  /** The probe network: internal bridge with the guests' link-local gateways (like the pod bridge). */
  async ensureNetwork(): Promise<void> {
    const existing = await this.docker.listNetworks({ filters: { name: [PROBE_NETWORK] } });

    if (!existing.some((n) => n.Name === PROBE_NETWORK))
      await this.docker.createNetwork({
        Name: PROBE_NETWORK,
        Driver: 'bridge',
        Internal: true,
        IPAM: { Driver: 'default', Config: [{ Subnet: PROBE_SUBNET, Gateway: '192.0.2.1' }] },
        Options: { 'com.docker.network.bridge.name': PROBE_BRIDGE },
        Labels: { [MANAGED_LABEL]: 'true' },
      });

    const current = await this.commands
      .json<{ ifname?: string; addr_info?: { local?: string }[] }[]>('ip', ['-j', 'addr', 'show', 'dev', PROBE_BRIDGE])
      .catch(() => []);

    for (const [command, ...args] of podGatewayCommands(current, false, PROBE_BRIDGE))
      await this.commands.run(command, args);
  }

  private async boot(
    launcher: string,
    shellImage: string,
    name: string,
    runDir: string,
    root: string,
    deadline: number,
  ): Promise<void> {
    const spec = probeSpec(launcher);

    // Guest root: the node shell image's file system.
    await mkdir(root, { recursive: true, mode: 0o755 });

    const source = await this.docker.createContainer({
      Image: shellImage,
      Entrypoint: ['/nonexistent'],
      Cmd: [],
      NetworkDisabled: true,
      Labels: { [PROBE_LABEL]: '1' },
    });

    try {
      await extractExportedTree((await source.export()) as unknown as AsyncIterable<Buffer>, '', root);
    } finally {
      await source.remove({ force: true }).catch(() => undefined);
    }

    await mkdir(join(runDir, 'stats'), { recursive: true, mode: 0o755 });
    await chown(join(runDir, 'stats'), MICROVM_VMM_UID, MICROVM_VMM_UID);
    await writeFile(join(runDir, 'boot-process.json'), JSON.stringify(spec.microvm?.process), { mode: 0o600 });
    await writeFile(join(runDir, 'net.json'), JSON.stringify(guestNetConfig(guestNics(spec)[0], 1500)), {
      mode: 0o644,
    });
    await this.ensureNetwork();

    const container = await this.docker.createContainer(probeContainerOptions(spec, { runDir, merged: root }, name));

    await container.start();
    await this.network.attach(container.id, spec);

    // Booted: the workload's stdout and stderr reached `docker logs`.
    for (;;) {
      const logs = await this.commands.run('docker', ['logs', name], { timeoutMs: 15_000 });

      if (logs.stdout.includes(STDOUT_MARK) && logs.stderr.includes(STDERR_MARK)) return;

      const state = await this.commands.run('docker', ['inspect', '--format', '{{.State.Running}}', name]);

      if (state.stdout.trim() !== 'true')
        throw new ProbeFailure('E_MICROVM_BOOT_FAILED', `the probe microVM exited: ${logs.stderr.trim().slice(-300)}`);

      if (this.now() > deadline) throw new ProbeFailure('E_PROBE_TIMEOUT', 'the probe microVM did not boot in time');

      await this.sleep(500);
    }
  }

  /** Exit status of `vm-exec` in the probe launcher. */
  private async exec(name: string, argv: string[]): Promise<number> {
    try {
      await this.commands.run('docker', ['exec', name, MICROVM_EXEC_CLIENT_PATH, '--', ...argv], { timeoutMs: 60_000 });

      return 0;
    } catch (error) {
      if (error instanceof CommandError && error.exitCode !== null) return error.exitCode;

      throw error;
    }
  }

  private async checks(name: string, root: string, deadline: number): Promise<void> {
    if ((await this.exec(name, ['/bin/true'])) !== 0)
      throw new ProbeFailure('E_MICROVM_BOOT_FAILED', 'vm-exec of /bin/true did not exit 0');

    const three = await this.exec(name, ['/bin/sh', '-c', 'exit 3']);

    if (three !== 3) throw new ProbeFailure('E_MICROVM_BOOT_FAILED', `vm-exec exit code ${three}, expected 3`);

    // File coherence: what the guest writes shows up in the host's guest root (virtio-fs, cache=auto ≤ 1 s).
    if ((await this.exec(name, ['/bin/sh', '-c', 'echo coherent > /lw-probe-x'])) !== 0)
      throw new ProbeFailure('E_MICROVM_BOOT_FAILED', 'the guest could not write its root');

    for (let attempt = 0; ; attempt++) {
      const content = await readFile(join(root, 'lw-probe-x'), 'utf8').catch(() => '');

      if (content.trim() === 'coherent') break;

      if (attempt >= 10 || this.now() > deadline)
        throw new ProbeFailure('E_MICROVM_BOOT_FAILED', 'the host does not see what the guest wrote');

      await this.sleep(200);
    }

    // The guest owns its IP (tap + tc redirect).
    await this.commands.run('ping', ['-c', '1', '-W', '2', PROBE_GUEST_ADDRESS], { timeoutMs: 10_000 }).catch(() => {
      throw new ProbeFailure('E_MICROVM_BOOT_FAILED', 'the guest address does not answer ICMP (tap networking)');
    });
  }

  private async stop(name: string): Promise<void> {
    await this.commands.run('docker', ['stop', '-t', '30', name], { timeoutMs: 60_000 });

    const code = (
      await this.commands.run('docker', ['inspect', '--format', '{{.State.ExitCode}}', name])
    ).stdout.trim();

    if (code !== '0') throw new ProbeFailure('E_MICROVM_BOOT_FAILED', `the probe microVM stopped with status ${code}`);
  }
}
