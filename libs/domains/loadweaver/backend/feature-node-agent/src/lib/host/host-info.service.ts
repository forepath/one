import { readFile, stat, statfs } from 'node:fs/promises';
import { arch, cpus, freemem, hostname, loadavg, release, totalmem } from 'node:os';

import {
  kernelHostnameSchema,
  type NodeCapabilities,
  type NodeOs,
  type ResourceAmounts,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import { Injectable } from '@nestjs/common';

import { sandboxRuntimeOf } from '../workloads/restored-runtime';
import { CommandRunner } from './command-runner';

/** Parses `/etc/os-release` (KEY=value, optionally quoted). */
export function parseOsRelease(text: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const line of text.split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());

    if (!match) continue;

    result[match[1]] = match[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }

  return result;
}

/** Supported hosts (3.21): Debian 12 / 13, Ubuntu 22.04 / 24.04 LTS on amd64 / arm64. */
export function isSupportedOs(os: NodeOs): boolean {
  return (
    (os.id === 'debian' && ['12', '13'].includes(os.versionId)) ||
    (os.id === 'ubuntu' && ['22.04', '24.04'].includes(os.versionId))
  );
}

export function nodeArch(value: string = arch()): NodeOs['arch'] {
  if (value === 'x64') return 'amd64';

  if (value === 'arm64') return 'arm64';

  throw new Error(`unsupported architecture ${value}`);
}

/** Major version of a DRBD module version string (`9.2.20`, `/proc/drbd`'s `version: 9.2.20 (api:2/proto:86-122)`). */
export function drbdMajorVersion(text: string): number | null {
  const match = /(?:^|version:\s*)(\d+)\.\d+/m.exec(text.trim());

  return match ? Number(match[1]) : null;
}

/** The kernel node name (`uname -n`) DRBD matches `on` sections against; undefined if unusable there. */
export function kernelHostname(value: string = hostname()): string | undefined {
  return kernelHostnameSchema.safeParse(value).success ? value : undefined;
}

/** The hello's `hostname` field: omitted if the host name can't be used in DRBD configuration. */
export function optionalHostname(value: string | undefined): { hostname?: string } {
  return value ? { hostname: value } : {};
}

/** `criu --version` → `4.1.1`. */
export function criuVersionOf(output: string): string | undefined {
  return /Version:\s*([0-9][0-9A-Za-z.+~-]{0,31})/.exec(output)?.[1];
}

/** Restored replicas (runc and gVisor) need cgroup v2: the restored tasks live in a child of the container's cgroup. */
async function cgroupV2(): Promise<boolean> {
  return !!(await stat('/sys/fs/cgroup/cgroup.controllers').catch(() => null));
}

interface DockerInfo {
  ServerVersion?: string;
  Runtimes?: Record<string, unknown>;
}

/**
 * Inventory reported in `hello`: OS, capacity and capabilities. The scheduler only places `sandboxed`
 * workloads on nodes whose gVisor probe passed (3.1).
 */
@Injectable()
export class HostInfoService {
  constructor(private readonly commands: CommandRunner) {}

  async os(): Promise<NodeOs> {
    const fields = parseOsRelease(await readFile('/etc/os-release', 'utf8').catch(() => ''));

    return {
      id: fields['ID'] ?? 'unknown',
      versionId: fields['VERSION_ID'] ?? 'unknown',
      kernel: release(),
      arch: nodeArch(),
    };
  }

  async capacity(dataPath = '/var/lib'): Promise<ResourceAmounts> {
    const fs = await statfs(dataPath);

    return {
      cpuMillis: cpus().length * 1000,
      memoryBytes: totalmem(),
      diskBytes: Number(fs.blocks) * Number(fs.bsize),
    };
  }

  /** Current usage for heartbeats: memory in use, CPU as 1-minute load (in millicores), disk in use. */
  async usage(dataPath = '/var/lib'): Promise<ResourceAmounts> {
    const fs = await statfs(dataPath);

    return {
      cpuMillis: Math.round(loadavg()[0] * 1000),
      memoryBytes: totalmem() - freemem(),
      diskBytes: (Number(fs.blocks) - Number(fs.bfree)) * Number(fs.bsize),
    };
  }

  /**
   * DRBD 9 kernel module present (3.5): the loaded module's version (`/proc/drbd`) or, if not loaded, the version of
   * the module `modprobe drbd` would load (`modinfo`). Debian / Ubuntu kernels ship DRBD 8.4 in-tree; the DRBD 9
   * module comes with the Loadweaver release bundle.
   */
  async drbd9(): Promise<boolean> {
    const loaded = await readFile('/proc/drbd', 'utf8').catch(() => '');
    const version =
      loaded ||
      (await this.commands
        .run('modinfo', ['-F', 'version', 'drbd'])
        .then((r) => r.stdout)
        .catch(() => ''));

    return (drbdMajorVersion(version) ?? 0) >= 9;
  }

  /**
   * Live migration (3.10): CRIU usable through runc (`criu check` passes and runc runs) and gVisor's own checkpoint /
   * restore: the sandbox runtime registered with Docker uses gVisor's network stack (a restored sandbox copies the
   * placeholder's interfaces; `--network=host` / `none` runtimes don't qualify), its binary runs, and the host has
   * cgroup v2 (restored replicas run in a child of their placeholder's cgroup).
   */
  async checkpoint(
    runtimes: Record<string, { path?: string; runtimeArgs?: string[] }>,
    cgroup2?: boolean,
  ): Promise<NonNullable<NodeCapabilities['checkpoint']>> {
    const [criuCheck, criuVersion, runc] = await Promise.all([
      this.commands.run('criu', ['check'], { timeoutMs: 20_000 }).then(
        () => true,
        () => false,
      ),
      this.commands.run('criu', ['--version']).then(
        (r) => criuVersionOf(r.stdout),
        () => undefined,
      ),
      this.commands.available('runc', ['--version']),
    ]);
    const sandbox = sandboxRuntimeOf(runtimes);
    const runsc =
      !!sandbox && (cgroup2 ?? (await cgroupV2())) && (await this.commands.available(sandbox.binary, ['--version']));

    return { runc: criuCheck && runc, runsc, ...(criuVersion ? { criuVersion } : {}) };
  }

  /**
   * Node-to-node transfer rate for the freeze estimate (3.10): `LOADWEAVER_TRANSFER_BPS` if set, else the link
   * speed of the default route's interface; unknown (virtual NICs) → omitted, the control plane assumes its default.
   */
  async transferBitsPerSecond(env: NodeJS.ProcessEnv = process.env): Promise<number | undefined> {
    const configured = Number(env['LOADWEAVER_TRANSFER_BPS']);

    if (Number.isSafeInteger(configured) && configured > 0) return Math.min(configured, 1e12);

    const routes = await this.commands
      .json<{ dev?: string }[]>('ip', ['-j', 'route', 'show', 'default'])
      .catch(() => [] as { dev?: string }[]);
    const dev = routes[0]?.dev;

    if (!dev || !/^[A-Za-z0-9_.@-]{1,15}$/.test(dev)) return undefined;

    const mbps = Number((await readFile(`/sys/class/net/${dev}/speed`, 'utf8').catch(() => '')).trim());

    return Number.isSafeInteger(mbps) && mbps > 0 ? mbps * 1_000_000 : undefined;
  }

  async capabilities(): Promise<NodeCapabilities> {
    const [wireguard, nftables, bird, drbd, criu, drbd9] = await Promise.all([
      this.commands.available('wg', ['--version']),
      this.commands.available('nft', ['--version']),
      this.commands.available('birdc', ['-v']),
      this.commands.available('drbdadm', ['--version']),
      this.commands.available('criu', ['--version']),
      this.drbd9(),
    ]);
    let docker: DockerInfo = {};

    try {
      docker = await this.commands.json<DockerInfo>('docker', ['info', '--format', '{{json .}}'], {
        timeoutMs: 15_000,
      });
    } catch {
      docker = {};
    }

    const runtimes = Object.keys(docker.Runtimes ?? {});
    const sandboxed = runtimes.some((r) => r.startsWith('runsc'));

    return {
      runtimes: sandboxed ? ['runc', 'sandboxed'] : ['runc'],
      sandboxProbe: sandboxed ? 'ready' : 'missing',
      wireguard,
      nftables,
      bird,
      drbd,
      drbd9,
      criu,
      dockerVersion: docker.ServerVersion,
      checkpoint: await this.checkpoint(
        (docker.Runtimes ?? {}) as Record<string, { path?: string; runtimeArgs?: string[] }>,
      ),
      ...(await this.transferBitsPerSecond().then((bps) => (bps ? { transferBitsPerSecond: bps } : {}))),
    };
  }
}
