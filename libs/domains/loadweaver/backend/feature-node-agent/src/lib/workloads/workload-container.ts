import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { volumeDockerName, type WorkloadSpec } from '@forepath/loadweaver/shared/util-agent-protocol';
import { GVISOR_RUNTIMES } from '@forepath/shared/backend/util-container-runtime';
import {
  type GenericBootProcess,
  MICROVM_KVM_DEVICE,
  MICROVM_LAUNCHER_CAPABILITIES,
  MICROVM_LAUNCHER_OVERHEAD_MIB,
  MICROVM_RUN_CONFIG_DIR,
  MICROVM_TOOLS_DIR,
  MICROVM_VOLUMES_MOUNT,
} from '@forepath/shared/backend/util-microvm-bridge';
import type Docker from 'dockerode';

import { MICROVM_LABEL, VM_LABEL } from '../live/guest-target';
import { POD_NETWORK } from '../network/pod-network.manager';

export const WORKLOAD_LABEL = 'loadweaver.com/workload';
export const WORKLOAD_HASH_LABEL = 'loadweaver.com/spec-hash';
export const MANAGED_LABEL = 'loadweaver.com/managed';
/** Docker runtime of the sandboxed level, registered by the shared gVisor installer (3.1). */
export const SANDBOX_RUNTIME = GVISOR_RUNTIMES.systrap.runtime;
/** Docker runtime of the sandboxed-kvm level (gVisor's KVM platform, Netstack; never the `-hostnet` variants). */
export const SANDBOX_KVM_RUNTIME = GVISOR_RUNTIMES.kvm.runtime;

/**
 * The Docker runtime of a workload's exact isolation level (3.1: never up- or downgraded). microVMs run in the shared
 * launcher on runc (QEMU needs the host kernel's KVM; never gVisor).
 */
export function workloadDockerRuntime(spec: Pick<WorkloadSpec, 'runtime' | 'isolation'>): string {
  if (spec.isolation === 'microvm') return 'runc';

  if (spec.isolation === 'sandboxed-kvm') return SANDBOX_KVM_RUNTIME;

  return spec.runtime === 'sandboxed' ? SANDBOX_RUNTIME : 'runc';
}
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

/** What a launcher container needs from the node besides the spec (prepared by the workload manager). */
export interface MicrovmHostSide {
  /** Host run directory (tmpfs) with `boot-process.json` / `net.json` / `vm.json`, `seed/`, `stats/`. */
  runDir?: string;
  /** Generic: the mounted overlay (guest root), bind-mounted as `/guest`. */
  merged?: string;
  /** Full VMs: the DRBD block devices of the disks (passed through `rw`, no `m`). */
  blockDevices?: string[];
  /**
   * Generic: the host directory (shared mount) with one mount per filesystem volume (`<index>`), bind-mounted
   * `rslave` at `/lwvol`, so a volume mounted later (live migration target) shows up in the launcher. Bundled images
   * in migration mode: each `<index>` bind-mounted `rslave` at its target below `/guest`.
   */
  volumesDir?: string;
  /**
   * Bundled images whose launcher migrates live (M7 F5, image label `io.forepath.microvm.migration` with `bundled`):
   * `AGENSTRA_MICROVM_MIGRATION=1`, the run directory's `migration/` at `/run/loadweaver/vm/migration`, filesystem
   * volumes through {@link volumesDir} instead of Docker volume mounts (so a migration can hand them over).
   */
  bundledMigration?: boolean;
}

/** Docker create options for a workload. Secrets are bind-mounted read-only from their tmpfs files. */
export function containerOptions(
  spec: WorkloadSpec,
  options: {
    dnsServers: string[];
    secretFiles: { source: string; target: string }[];
    /** Docker network; default the pod bridge, a kept-address network for migrated addresses (3.10). */
    network?: string;
    /** Launcher workloads (`isolation: microvm`). */
    microvm?: MicrovmHostSide;
  },
): Docker.ContainerCreateOptions {
  if (microvmKind(spec)) return microvmContainerOptions(spec, { ...options, microvm: options.microvm ?? {} });

  const network = options.network ?? POD_NETWORK;
  const mounts = workloadMounts(spec, options.secretFiles, '');

  return {
    name: containerName(spec.id),
    Image: spec.image,
    ...(spec.command ? { Cmd: spec.command } : {}),
    ...(spec.entrypoint ? { Entrypoint: spec.entrypoint } : {}),
    Env: Object.entries(spec.environment).map(([k, v]) => `${k}=${v}`),
    Labels: workloadLabels(spec),
    ...(spec.hostname ? { Hostname: spec.hostname } : { Hostname: spec.service }),
    ...(spec.user ? { User: spec.user } : {}),
    ...(spec.workingDir ? { WorkingDir: spec.workingDir } : {}),
    ...(spec.stopSignal ? { StopSignal: spec.stopSignal } : {}),
    StopTimeout: Math.ceil(spec.stopGracePeriodMs / 1000),
    ...healthcheckOptions(spec),
    HostConfig: {
      NetworkMode: network,
      Runtime: workloadDockerRuntime(spec),
      RestartPolicy: restartPolicy(spec),
      ...(spec.resources.cpuLimitMillis ? { NanoCpus: spec.resources.cpuLimitMillis * 1_000_000 } : {}),
      ...(spec.resources.memoryLimitBytes ? { Memory: spec.resources.memoryLimitBytes } : {}),
      MemoryReservation: spec.resources.memoryBytes,
      CpuShares: cpuShares(spec),
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
      // Allow-listed host devices (3.1, feature `workload-devices`): only `/dev/kvm`, runc only (the plan enforces it).
      ...(spec.devices?.length
        ? {
            Devices: spec.devices.map((d) => ({
              PathOnHost: d.path,
              PathInContainer: d.path,
              CgroupPermissions: d.permissions ?? 'rwm',
            })),
          }
        : {}),
      Ulimits: Object.entries(spec.ulimits).map(([Name, l]) => ({ Name, Soft: l.soft, Hard: l.hard })),
      ExtraHosts: spec.extraHosts,
      Dns: options.dnsServers,
      DnsSearch: spec.dnsSearch,
      Mounts: mounts,
      LogConfig: LOG_CONFIG,
    },
    NetworkingConfig: endpointsConfig(spec, network),
  };
}

const LOG_CONFIG = { Type: 'json-file', Config: { 'max-size': '20m', 'max-file': '3' } };

function workloadLabels(spec: WorkloadSpec): Record<string, string> {
  return {
    ...spec.labels,
    [MANAGED_LABEL]: 'true',
    [WORKLOAD_LABEL]: spec.id,
    [WORKLOAD_HASH_LABEL]: spec.specHash,
  };
}

function restartPolicy(spec: WorkloadSpec): Docker.HostRestartPolicy {
  return {
    Name:
      spec.restart === 'always'
        ? 'always'
        : spec.restart === 'on-failure'
          ? 'on-failure'
          : spec.restart === 'unless-stopped'
            ? 'unless-stopped'
            : 'no',
  };
}

function cpuShares(spec: WorkloadSpec): number {
  return Math.max(2, Math.round((spec.resources.cpuMillis / 1000) * 1024));
}

function healthcheckOptions(spec: WorkloadSpec): Pick<Docker.ContainerCreateOptions, 'Healthcheck'> {
  if (!spec.healthcheck) return {};

  return {
    Healthcheck: spec.healthcheck.test
      ? {
          Test: spec.healthcheck.test,
          Interval: spec.healthcheck.intervalMs * NS_PER_MS,
          Timeout: spec.healthcheck.timeoutMs * NS_PER_MS,
          Retries: spec.healthcheck.retries,
          StartPeriod: spec.healthcheck.startPeriodMs * NS_PER_MS,
        }
      : { Test: ['NONE'] },
  };
}

function endpointsConfig(spec: WorkloadSpec, network: string): Docker.ContainerCreateOptions['NetworkingConfig'] {
  const v4 = spec.addresses.find((a) => !a.includes(':'));
  const v6 = spec.addresses.find((a) => a.includes(':'));

  return {
    EndpointsConfig: {
      [network]: {
        IPAMConfig: { ...(v4 ? { IPv4Address: v4 } : {}), ...(v6 ? { IPv6Address: v6 } : {}) },
        Aliases: [spec.service],
      },
    },
  };
}

/** Volumes, binds, tmpfs and secret files of a workload; `prefix` puts them below a launcher's guest root. */
function workloadMounts(
  spec: WorkloadSpec,
  secretFiles: { source: string; target: string }[],
  prefix: string,
): Docker.MountSettings[] {
  return [
    ...spec.volumes.map(
      (v): Docker.MountSettings =>
        v.type === 'volume'
          ? {
              Type: 'volume',
              Source: volumeName(v.volume),
              Target: `${prefix}${v.target}`,
              ReadOnly: v.readOnly,
              VolumeOptions: {
                NoCopy: false,
                Labels: { [MANAGED_LABEL]: 'true' },
                DriverConfig: { Name: VOLUME_DRIVER, Options: {} },
              },
            }
          : v.type === 'bind'
            ? { Type: 'bind', Source: v.source, Target: `${prefix}${v.target}`, ReadOnly: v.readOnly }
            : {
                Type: 'tmpfs',
                Source: '',
                Target: `${prefix}${v.target}`,
                ...(v.sizeBytes ? { TmpfsOptions: { SizeBytes: v.sizeBytes, Mode: 0o1777 } } : {}),
              },
    ),
    ...secretFiles.map(
      (f): Docker.MountSettings => ({ Type: 'bind', Source: f.source, Target: `${prefix}${f.target}`, ReadOnly: true }),
    ),
  ];
}

// --- microVM launchers (3.35, M7.2 / M7.3) -------------------------------------------------------------------------

export { MICROVM_LABEL, VM_LABEL };

/** The launcher kind of a container from its labels (`loadweaver.com/microvm`, `loadweaver.com/vm`); null otherwise. */
export function launcherKindOf(labels: Record<string, string> | undefined | null): MicrovmKind | null {
  if (labels?.[VM_LABEL]) return 'vm';

  const kind = labels?.[MICROVM_LABEL];

  return kind === 'generic' || kind === 'bundled' ? kind : null;
}
/** Where a launcher sees the guest root (generic) and where bundled images keep the workload's files. */
export const MICROVM_GUEST_MOUNT = '/guest';
export const MICROVM_TUN_DEVICE = '/dev/net/tun';
const LAUNCHER_PIDS_LIMIT = 1024;
/** CPU on top of the guest's vCPUs for virtiofsd and the bridge. */
const LAUNCHER_EXTRA_NANO_CPUS = 250_000_000;
const MIB = 1024 ** 2;

export type MicrovmKind = 'generic' | 'bundled' | 'vm';

/** How a workload runs in the launcher; null for containers. */
export function microvmKind(spec: Pick<WorkloadSpec, 'id' | 'isolation' | 'microvm' | 'vm'>): MicrovmKind | null {
  if (spec.isolation !== 'microvm') return null;

  if (spec.vm) return 'vm';

  if (spec.microvm?.mode === 'bundled') return 'bundled';

  if (spec.microvm?.mode === 'generic') return 'generic';

  throw new Error(`${spec.id}: a microvm workload needs microvm or vm settings`);
}

/**
 * Writable subdirectory of a VM / microVM launcher's run directory for QEMU live migration (M7.4, M7 W10b, bundled
 * images in migration mode M7 F5):
 * `incoming` (marker: start
 * the launcher waiting for an incoming migration, removed by the launcher when read, so a later restart cold-boots)
 * and `peer.sock` (the source's local end of the migration relay, owned by the VMM user).
 */
export const MICROVM_MIGRATION_SUBDIR = 'migration';

/** Per-replica directory of a generic microVM's filesystem volumes on tmpfs (shared mount, `/lwvol` in the launcher). */
export function microvmVolumesDir(runtimeDir: string, workloadId: string): string {
  return join(runtimeDir, 'vmvol', createHash('sha256').update(workloadId).digest('hex').slice(0, 24));
}

/** A filesystem volume of a generic microVM: its directory below `/lwvol` and its target in the guest. */
export interface GuestVolume {
  index: number;
  volume: string;
  target: string;
  readOnly: boolean;
}

/** The filesystem volumes of a generic microVM, parents first (the guest binds them in this order). */
export function guestVolumeList(spec: Pick<WorkloadSpec, 'volumes'>): GuestVolume[] {
  return spec.volumes
    .filter((v): v is Extract<WorkloadSpec['volumes'][number], { type: 'volume' }> => v.type === 'volume')
    .sort((a, b) => a.target.split('/').length - b.target.split('/').length || a.target.localeCompare(b.target))
    .map((v, index) => ({ index, volume: v.volume, target: v.target, readOnly: v.readOnly }));
}

/** Kernel command line of the guest's volume binds (`lw.vol=<index>:<hex target>:<ro|rw>`, initramfs-init-generic). */
export function guestVolumesCmdline(volumes: readonly GuestVolume[]): string {
  return volumes
    .map((v) => `lw.vol=${v.index}:${Buffer.from(v.target, 'utf8').toString('hex')}:${v.readOnly ? 'ro' : 'rw'}`)
    .join(' ');
}

/** Per-replica launcher run directory on tmpfs (bind-mounted at `/run/loadweaver/vm`). */
export function microvmRunDir(runtimeDir: string, workloadId: string): string {
  return join(runtimeDir, 'vm', createHash('sha256').update(workloadId).digest('hex').slice(0, 24));
}

/**
 * `boot-process.json` of a generic microVM: the image config merged with the compose overrides (control plane,
 * `microvm.process`); without it, the spec's own process fields.
 */
export function bootProcess(spec: WorkloadSpec): GenericBootProcess {
  const process = spec.microvm?.process;

  if (process) return { ...process };

  return {
    entrypoint: spec.entrypoint ?? [],
    cmd: spec.command ?? [],
    env: Object.entries(spec.environment).map(([k, v]) => `${k}=${v}`),
    user: spec.user ?? '',
    workingDir: spec.workingDir ?? '/',
    stopSignal: spec.stopSignal ?? 'SIGTERM',
  };
}

/** Guest sizing of a launcher workload. */
function guestSize(spec: WorkloadSpec): { vcpus: number; memoryMiB: number } {
  if (spec.vm) return { vcpus: spec.vm.vcpus, memoryMiB: spec.vm.memoryMiB };

  if (spec.microvm) return { vcpus: spec.microvm.vcpus, memoryMiB: spec.microvm.memoryMiB };

  throw new Error(`${spec.id}: no guest sizing`);
}

/**
 * Docker create options of a launcher container (3.35): runc, no Docker init (tini is the entrypoint), the launcher
 * capability set only, `no-new-privileges`, `/dev/kvm` (+ `/dev/net/tun` for tap networking, the VM's DRBD devices),
 * memory = guest + launcher overhead, CPU = vCPUs + 0.25 core. Generic microVMs boot the image root mounted at
 * `/guest` with the agent's run directory at `/run/loadweaver/vm`; volumes and secrets go below `/guest` (virtio-fs
 * submounts). Bundled images (Agenstra's label) run as they are, with their own user-mode networking; when their
 * launcher migrates live (M7 F5) in migration mode, with the migration directory and agent-mounted volumes.
 */
export function microvmContainerOptions(
  spec: WorkloadSpec,
  options: {
    dnsServers: string[];
    secretFiles: { source: string; target: string }[];
    network?: string;
    microvm: MicrovmHostSide;
  },
): Docker.ContainerCreateOptions {
  const kind = microvmKind(spec) as MicrovmKind;
  const network = options.network ?? POD_NETWORK;
  const { vcpus, memoryMiB } = guestSize(spec);
  const graceSeconds = Math.ceil(spec.stopGracePeriodMs / 1000);
  const runDir = options.microvm.runDir;

  const bundledMigration = kind === 'bundled' && options.microvm.bundledMigration === true;

  if ((kind !== 'bundled' || bundledMigration) && !runDir)
    throw new Error(`${spec.id}: the launcher run directory is not prepared`);

  if (kind === 'generic' && !options.microvm.merged) throw new Error(`${spec.id}: the guest root is not mounted`);

  // Filesystem volumes mounted by the agent (live migration hands them over): generic, bundled in migration mode.
  const agentVolumes = kind === 'generic' || bundledMigration;

  if (agentVolumes && guestVolumeList(spec).length > 0 && !options.microvm.volumesDir)
    throw new Error(`${spec.id}: the volume directory is not prepared`);

  const kvm = { PathOnHost: MICROVM_KVM_DEVICE, PathInContainer: MICROVM_KVM_DEVICE, CgroupPermissions: 'rwm' };
  const tun = { PathOnHost: MICROVM_TUN_DEVICE, PathInContainer: MICROVM_TUN_DEVICE, CgroupPermissions: 'rwm' };
  // QEMU live migration (M7.4, generic microVMs M7 W10b, bundled M7 F5): the incoming marker and the source's relay
  // socket.
  const migrationMount: Docker.MountSettings[] = runDir
    ? [
        {
          Type: 'bind',
          Source: join(runDir, MICROVM_MIGRATION_SUBDIR),
          Target: `${MICROVM_RUN_CONFIG_DIR}/${MICROVM_MIGRATION_SUBDIR}`,
          ReadOnly: false,
        },
      ]
    : [];
  const runMounts: Docker.MountSettings[] = !runDir
    ? []
    : kind === 'bundled'
      ? // Bundled: only the migration directory (the image's own launcher reads nothing else of the agent's).
        bundledMigration
        ? migrationMount
        : []
      : [
          { Type: 'bind', Source: runDir, Target: MICROVM_RUN_CONFIG_DIR, ReadOnly: true },
          { Type: 'bind', Source: join(runDir, 'stats'), Target: `${MICROVM_RUN_CONFIG_DIR}/stats`, ReadOnly: false },
          ...migrationMount,
        ];
  const guestRoot: Docker.MountSettings[] =
    kind === 'generic'
      ? [
          {
            Type: 'bind',
            Source: options.microvm.merged as string,
            Target: MICROVM_GUEST_MOUNT,
            ReadOnly: false,
            BindOptions: { Propagation: 'rprivate' },
          },
          // Filesystem volumes: mounted by the agent below the shared host directory (also later, on a migration
          // target after the hand-over), so the propagation is rslave; a virtiofsd of their own shares them.
          ...(guestVolumeList(spec).length > 0
            ? [
                {
                  Type: 'bind' as const,
                  Source: options.microvm.volumesDir ?? '',
                  Target: MICROVM_VOLUMES_MOUNT,
                  ReadOnly: false,
                  BindOptions: { Propagation: 'rslave' as const },
                },
              ]
            : []),
        ]
      : bundledMigration
        ? // Bundled in migration mode: each filesystem volume's directory at its target below /guest, `rslave`: on
          // a migration target the volume is mounted there after the hand-over and shows up in the running launcher.
          guestVolumeList(spec).map((volume) => ({
            Type: 'bind' as const,
            Source: join(options.microvm.volumesDir ?? '', String(volume.index)),
            Target: `${MICROVM_GUEST_MOUNT}${volume.target}`,
            ReadOnly: volume.readOnly,
            BindOptions: { Propagation: 'rslave' as const },
          }))
        : [];
  const env = [
    `AGENSTRA_MICROVM_MEMORY_MB=${memoryMiB}`,
    `AGENSTRA_MICROVM_VCPUS=${vcpus}`,
    `AGENSTRA_MICROVM_STOP_GRACE=${graceSeconds}`,
  ];
  const process =
    kind === 'generic'
      ? {
          Entrypoint: ['/usr/bin/tini', '--', `${MICROVM_TOOLS_DIR}/launch-generic`],
          Cmd: [],
          // The guest owns the IP: nothing is forwarded.
          Env: [...env, 'AGENSTRA_MICROVM_FORWARD_PORTS=', 'LW_MODE=generic'],
        }
      : kind === 'vm'
        ? {
            Entrypoint: ['/usr/bin/tini', '--', `${MICROVM_TOOLS_DIR}/launch-vm`],
            Cmd: [],
            Env: [`AGENSTRA_MICROVM_STOP_GRACE=${graceSeconds}`, 'LW_MODE=vm'],
          }
        : {
            // Bundled: the image's own launcher, entrypoint and settings; the compose process is the guest's.
            ...(spec.command ? { Cmd: spec.command } : {}),
            ...(spec.entrypoint ? { Entrypoint: spec.entrypoint } : {}),
            Env: [
              ...Object.entries(spec.environment).map(([k, v]) => `${k}=${v}`),
              ...env,
              ...(bundledMigration ? ['AGENSTRA_MICROVM_MIGRATION=1'] : []),
            ],
          };

  return {
    name: containerName(spec.id),
    Image: spec.image,
    ...process,
    // Live sessions route by these (exec / terminals / files into the guest; full VMs: consoles only).
    Labels: {
      ...workloadLabels(spec),
      ...(kind === 'vm' ? { [VM_LABEL]: spec.labels[VM_LABEL] || spec.service } : { [MICROVM_LABEL]: kind }),
    },
    ...(spec.hostname ? { Hostname: spec.hostname } : { Hostname: spec.service }),
    // The guest gets the stop signal (boot process); the launcher stops on SIGTERM and needs grace + boot teardown.
    StopSignal: 'SIGTERM',
    StopTimeout: graceSeconds + 10,
    ...healthcheckOptions(spec),
    HostConfig: {
      NetworkMode: network,
      Runtime: workloadDockerRuntime(spec),
      RestartPolicy: restartPolicy(spec),
      Init: false,
      Privileged: false,
      ReadonlyRootfs: kind !== 'bundled',
      ...(kind !== 'bundled' ? { Tmpfs: { '/tmp': 'rw,nosuid,nodev,size=16m' }, ShmSize: 64 * MIB } : {}),
      CapDrop: ['ALL'],
      CapAdd: [...MICROVM_LAUNCHER_CAPABILITIES],
      SecurityOpt: ['no-new-privileges'],
      Devices: [
        kvm,
        ...(kind !== 'bundled' ? [tun] : []),
        ...(options.microvm.blockDevices ?? []).map((d) => ({
          PathOnHost: d,
          PathInContainer: d,
          CgroupPermissions: 'rw',
        })),
      ],
      PidsLimit: LAUNCHER_PIDS_LIMIT,
      Memory: (memoryMiB + MICROVM_LAUNCHER_OVERHEAD_MIB) * MIB,
      MemoryReservation: spec.resources.memoryBytes,
      NanoCpus: vcpus * 1_000_000_000 + LAUNCHER_EXTRA_NANO_CPUS,
      CpuShares: cpuShares(spec),
      ExtraHosts: spec.extraHosts,
      Dns: options.dnsServers,
      DnsSearch: spec.dnsSearch,
      Mounts: [
        ...guestRoot,
        ...runMounts,
        ...(kind === 'vm'
          ? []
          : workloadMounts(
              // Generic: filesystem volumes go through /lwvol, bundled in migration mode through the volume
              // directory (above), not as Docker volume mounts below the image root.
              agentVolumes ? { ...spec, volumes: spec.volumes.filter((v) => v.type !== 'volume') } : spec,
              options.secretFiles,
              MICROVM_GUEST_MOUNT,
            )),
      ],
      LogConfig: LOG_CONFIG,
    },
    NetworkingConfig: endpointsConfig(spec, network),
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
