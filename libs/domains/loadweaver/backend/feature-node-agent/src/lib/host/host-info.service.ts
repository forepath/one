import { readFile, statfs } from 'node:fs/promises';
import { arch, cpus, freemem, loadavg, release, totalmem } from 'node:os';

import type { NodeCapabilities, NodeOs, ResourceAmounts } from '@forepath/loadweaver/shared/util-agent-protocol';
import { Injectable } from '@nestjs/common';

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

  async capabilities(): Promise<NodeCapabilities> {
    const [wireguard, nftables, bird, drbd, criu] = await Promise.all([
      this.commands.available('wg', ['--version']),
      this.commands.available('nft', ['--version']),
      this.commands.available('birdc', ['-v']),
      this.commands.available('drbdadm', ['--version']),
      this.commands.available('criu', ['--version']),
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
      criu,
      dockerVersion: docker.ServerVersion,
    };
  }
}
