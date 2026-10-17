import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { volumeDockerName, type WorkloadSpec } from '@forepath/loadweaver/shared/util-agent-protocol';
import type Docker from 'dockerode';

import { POD_NETWORK } from '../network/pod-network.manager';

export const WORKLOAD_LABEL = 'loadweaver.com/workload';
export const WORKLOAD_HASH_LABEL = 'loadweaver.com/spec-hash';
export const MANAGED_LABEL = 'loadweaver.com/managed';
/** Docker runtime of the sandboxed level, registered by the shared gVisor installer (3.1). */
export const SANDBOX_RUNTIME = 'runsc-systrap';
/** Replicated volumes are provided by the node agent's Docker volume plugin (3.5). */
export const VOLUME_DRIVER = 'loadweaver';

const NS_PER_MS = 1_000_000;

/** Container names are derived from the workload id: `lw-<project>-<deployment>-<service>-<replica>-<hash8>`. */
export function containerName(id: string): string {
  const readable = id.replace(/[^a-z0-9_.-]/gi, '-').slice(0, 80);

  return `lw-${readable}-${createHash('sha256').update(id).digest('hex').slice(0, 8)}`;
}

/** Docker volume names can't contain `/`; replicated volumes are named after their id. */
export const volumeName = volumeDockerName;

/** Per-workload directory for secret files; must live on tmpfs (`/run`), never on disk (3.22). */
export function secretDir(runtimeDir: string, workloadId: string): string {
  return join(runtimeDir, 'secrets', createHash('sha256').update(workloadId).digest('hex').slice(0, 24));
}

/** Docker create options for a workload. Secrets are bind-mounted read-only from their tmpfs files. */
export function containerOptions(
  spec: WorkloadSpec,
  options: { dnsServers: string[]; secretFiles: { source: string; target: string }[] },
): Docker.ContainerCreateOptions {
  const v4 = spec.addresses.find((a) => !a.includes(':'));
  const v6 = spec.addresses.find((a) => a.includes(':'));
  const mounts: Docker.MountSettings[] = [
    ...spec.volumes.map(
      (v): Docker.MountSettings =>
        v.type === 'volume'
          ? {
              Type: 'volume',
              Source: volumeName(v.volume),
              Target: v.target,
              ReadOnly: v.readOnly,
              VolumeOptions: {
                NoCopy: false,
                Labels: { [MANAGED_LABEL]: 'true' },
                DriverConfig: { Name: VOLUME_DRIVER, Options: {} },
              },
            }
          : v.type === 'bind'
            ? { Type: 'bind', Source: v.source, Target: v.target, ReadOnly: v.readOnly }
            : {
                Type: 'tmpfs',
                Source: '',
                Target: v.target,
                ...(v.sizeBytes ? { TmpfsOptions: { SizeBytes: v.sizeBytes, Mode: 0o1777 } } : {}),
              },
    ),
    ...options.secretFiles.map(
      (f): Docker.MountSettings => ({ Type: 'bind', Source: f.source, Target: f.target, ReadOnly: true }),
    ),
  ];

  return {
    name: containerName(spec.id),
    Image: spec.image,
    ...(spec.command ? { Cmd: spec.command } : {}),
    ...(spec.entrypoint ? { Entrypoint: spec.entrypoint } : {}),
    Env: Object.entries(spec.environment).map(([k, v]) => `${k}=${v}`),
    Labels: {
      ...spec.labels,
      [MANAGED_LABEL]: 'true',
      [WORKLOAD_LABEL]: spec.id,
      [WORKLOAD_HASH_LABEL]: spec.specHash,
    },
    ...(spec.hostname ? { Hostname: spec.hostname } : { Hostname: spec.service }),
    ...(spec.user ? { User: spec.user } : {}),
    ...(spec.workingDir ? { WorkingDir: spec.workingDir } : {}),
    ...(spec.stopSignal ? { StopSignal: spec.stopSignal } : {}),
    StopTimeout: Math.ceil(spec.stopGracePeriodMs / 1000),
    ...(spec.healthcheck
      ? {
          Healthcheck: spec.healthcheck.test
            ? {
                Test: spec.healthcheck.test,
                Interval: spec.healthcheck.intervalMs * NS_PER_MS,
                Timeout: spec.healthcheck.timeoutMs * NS_PER_MS,
                Retries: spec.healthcheck.retries,
                StartPeriod: spec.healthcheck.startPeriodMs * NS_PER_MS,
              }
            : { Test: ['NONE'] },
        }
      : {}),
    HostConfig: {
      NetworkMode: POD_NETWORK,
      Runtime: spec.runtime === 'sandboxed' ? SANDBOX_RUNTIME : 'runc',
      RestartPolicy: {
        Name:
          spec.restart === 'always'
            ? 'always'
            : spec.restart === 'on-failure'
              ? 'on-failure'
              : spec.restart === 'unless-stopped'
                ? 'unless-stopped'
                : 'no',
      },
      ...(spec.resources.cpuLimitMillis ? { NanoCpus: spec.resources.cpuLimitMillis * 1_000_000 } : {}),
      ...(spec.resources.memoryLimitBytes ? { Memory: spec.resources.memoryLimitBytes } : {}),
      MemoryReservation: spec.resources.memoryBytes,
      CpuShares: Math.max(2, Math.round((spec.resources.cpuMillis / 1000) * 1024)),
      CapAdd: spec.capAdd,
      // NET_RAW only when asked for: raw sockets let a workload forge its neighbours' addresses (and identities, 3.7).
      CapDrop: [
        ...new Set([
          ...spec.capDrop,
          ...(spec.capAdd.some((c) => ['NET_RAW', 'ALL'].includes(c.toUpperCase().replace(/^CAP_/, '')))
            ? []
            : ['NET_RAW']),
        ]),
      ],
      ReadonlyRootfs: spec.readOnly,
      Privileged: spec.privileged,
      Init: spec.init,
      Ulimits: Object.entries(spec.ulimits).map(([Name, l]) => ({ Name, Soft: l.soft, Hard: l.hard })),
      ExtraHosts: spec.extraHosts,
      Dns: options.dnsServers,
      DnsSearch: spec.dnsSearch,
      Mounts: mounts,
      LogConfig: { Type: 'json-file', Config: { 'max-size': '20m', 'max-file': '3' } },
    },
    NetworkingConfig: {
      EndpointsConfig: {
        [POD_NETWORK]: {
          IPAMConfig: { ...(v4 ? { IPv4Address: v4 } : {}), ...(v6 ? { IPv6Address: v6 } : {}) },
          Aliases: [spec.service],
        },
      },
    },
  };
}

export type WorkloadState =
  | 'pending'
  | 'pulling'
  | 'starting'
  | 'running'
  | 'healthy'
  | 'unhealthy'
  | 'exited'
  | 'failed';

/** Maps Docker's container state to the workload state reported to the control plane. */
export function workloadState(info: Pick<Docker.ContainerInspectInfo, 'State'>): {
  state: WorkloadState;
  exitCode?: number;
} {
  const s = info.State;

  if (s.Running) {
    const health = (s as { Health?: { Status?: string } }).Health?.Status;

    return {
      state:
        health === 'healthy'
          ? 'healthy'
          : health === 'unhealthy'
            ? 'unhealthy'
            : health === 'starting'
              ? 'starting'
              : 'running',
    };
  }

  if (s.Status === 'created') return { state: 'starting' };

  return { state: s.ExitCode === 0 ? 'exited' : 'failed', exitCode: s.ExitCode };
}
