import type { MicrovmArchitecture, MicrovmSpec, WorkloadSpec } from '@forepath/loadweaver/shared/util-agent-protocol';
import type { HealthCheck, ServiceSpec } from '@forepath/loadweaver/shared/util-compose';
import { COMPONENT_IMAGES, IMAGE_OVERRIDE_ENV } from '@forepath/loadweaver/shared/util-release';
import {
  MICROVM_BRIDGE_PROTOCOL_VERSION,
  MICROVM_EXEC_CLIENT_PATH,
  MICROVM_LAUNCHER_OVERHEAD_MIB,
  MICROVM_MIGRATION_LABEL,
  MICROVM_PROTOCOL_LABEL,
} from '@forepath/shared/backend/util-microvm-bridge';

/**
 * MicroVM workloads (3.35, M7.2): `x-loadweaver.runtime: microvm` turns a compose service into a QEMU microVM in the
 * hardened launcher container. The mode is decided at plan time from the pinned image's labels: images carrying
 * Agenstra's microVM label run as their own launcher (`bundled`), any other image becomes the guest root of the
 * shared launcher (`generic`) — unpacked from its digest-pinned layers on the node.
 */

const MiB = 1024 ** 2;
const GiB = 1024 ** 3;

/** Memory and CPU the launcher itself needs per microVM (QEMU, virtiofsd, bridge); added to scheduler requests. */
export const MICROVM_LAUNCHER_OVERHEAD = { cpuMillis: 250, memoryBytes: MICROVM_LAUNCHER_OVERHEAD_MIB * MiB } as const;
/** Guest memory without any compose resources. */
export const DEFAULT_MICROVM_MEMORY_BYTES = 512 * MiB;
/** Per-replica writable layer without `x-loadweaver.microvm.rootfsSize`. */
export const DEFAULT_MICROVM_ROOTFS_BYTES = 10 * GiB;
/** Boot budget added to a microVM's health check start period. */
export const MICROVM_BOOT_BUDGET_MS = 15_000;
export const MICROVM_MAX_VCPUS = 64;
export const MICROVM_MIN_MEMORY_MIB = 128;

/** The launcher image the control plane puts into generic microVM / full VM specs (override: release env). */
export function microvmLauncherImage(env: NodeJS.ProcessEnv = process.env): string {
  return env[IMAGE_OVERRIDE_ENV['microvm-launcher']] || COMPONENT_IMAGES['microvm-launcher'];
}

/** One layer of a pinned image as the node verifies it while unpacking. */
export interface ImageLayer {
  digest: string;
  diffId: string;
  size: number;
  mediaType: string;
}

/** A pinned VM image artifact (`util-model` `vm-image.ts`): what a full VM's boot disk is initialized from. */
export interface VmImageInspection {
  arch: 'amd64' | 'arm64';
  format: 'qcow2' | 'raw';
  layerDigest: string;
  virtualSize: number;
  firmware: ('uefi' | 'bios')[];
  guestAgent?: boolean;
  /**
   * A KubeVirt containerDisk (a regular image whose layer holds `/disk/*.qcow2|*.img`), detected at plan time: the
   * disk's path in `layerDigest`'s tar (the node unpacks it). Firmware is assumed (UEFI, plus BIOS on amd64).
   */
  containerDisk?: { path: string };
}

/**
 * What the image resolver read from a pinned image at plan time (persisted with the deployment state, so the compile
 * never talks to a registry): the platform manifest, labels, the process config and the layers — or, for VM image
 * artifacts, the disk layer.
 */
export interface ImageInspection {
  /** Digest of the platform manifest the layers belong to (for an index: the chosen child). */
  manifestDigest: string;
  /** `linux/amd64` etc.; the platforms of an index (empty for a single-platform manifest without config platform). */
  platform: string;
  platforms: string[];
  labels: Record<string, string>;
  config: {
    entrypoint?: string[];
    cmd?: string[];
    env?: string[];
    user?: string;
    workingDir?: string;
    stopSignal?: string;
    healthcheck?: { test: string[]; intervalMs?: number; timeoutMs?: number; retries?: number; startPeriodMs?: number };
  };
  /** The layers of `platform` (for multi-arch inspections: the first available cluster architecture). */
  layers: ImageLayer[];
  /**
   * Mixed-arch clusters (3.35): the layers of every cluster architecture the image has (`inspectImageArchitectures`);
   * absent for single-arch clusters and older states. Generic microVMs then carry `microvm.platformLayers`.
   */
  platformLayers?: Partial<Record<MicrovmArchitecture, ImageLayer[]>>;
  vmImage?: VmImageInspection;
}

/**
 * The node architectures a pinned microVM / VM image can run on (3.35): the `platformLayers` architectures, a VM
 * image's architecture, else the inspected platform's one. `undefined`: no restriction known. The scheduler keeps the
 * replicas off nodes of other architectures (`SchedulerService.architectures`).
 */
export function imageArchitectures(inspection: ImageInspection | null | undefined): string[] | undefined {
  if (!inspection) return undefined;

  if (inspection.platformLayers) {
    const arches = Object.keys(inspection.platformLayers).sort();

    return arches.length > 0 ? arches : undefined;
  }

  if (inspection.vmImage) return [inspection.vmImage.arch];

  const arch = inspection.platform.split('/')[1];

  return arch ? [arch] : undefined;
}

/** Whether a pinned image is its own microVM launcher (Agenstra's label with a bridge protocol this build speaks). */
export function isBundledMicrovmImage(inspection: Pick<ImageInspection, 'labels'> | undefined): boolean {
  return inspection?.labels[MICROVM_PROTOCOL_LABEL] === String(MICROVM_BRIDGE_PROTOCOL_VERSION);
}

/**
 * Whether a bundled image's own launcher migrates live (M7 W10b / F5): it lists the `bundled` mode in
 * `io.forepath.microvm.migration`. Images built FROM the shared launcher inherit its label: since M7 F5 the launcher
 * declares `generic,vm,bundled` (Agenstra's `launch` has an incoming mode); images built on an older launcher carry
 * `generic,vm` only and fall back to a short stop / blue-green.
 */
export function bundledMicrovmMigration(inspection: Pick<ImageInspection, 'labels'> | undefined): boolean {
  return (inspection?.labels[MICROVM_MIGRATION_LABEL] ?? '')
    .split(',')
    .map((mode) => mode.trim())
    .includes('bundled');
}

/** Guest vCPUs and memory (3.35): limits, else the compose requests, else 1 vCPU / 512 MiB. */
export function microvmSizing(service: Pick<ServiceSpec, 'resources'>): { vcpus: number; memoryMiB: number } {
  const fromCompose = service.resources.source === 'compose';
  const cpuMillis = service.resources.limits.cpuMillis ?? (fromCompose ? service.resources.requests.cpuMillis : 1000);
  const memoryBytes =
    service.resources.limits.memoryBytes ??
    (fromCompose ? service.resources.requests.memoryBytes : DEFAULT_MICROVM_MEMORY_BYTES);

  return {
    vcpus: Math.min(MICROVM_MAX_VCPUS, Math.max(1, Math.ceil(cpuMillis / 1000))),
    memoryMiB: Math.max(MICROVM_MIN_MEMORY_MIB, Math.ceil(memoryBytes / MiB)),
  };
}

/**
 * Scheduler requests of a microVM replica (honest capacity, M7.2): the guest memory (at least the compose request)
 * and the compose CPU request, each plus the launcher overhead.
 */
export function microvmRequests(service: Pick<ServiceSpec, 'resources'>): { cpuMillis: number; memoryBytes: number } {
  const { memoryMiB } = microvmSizing(service);

  return {
    cpuMillis: service.resources.requests.cpuMillis + MICROVM_LAUNCHER_OVERHEAD.cpuMillis,
    memoryBytes:
      Math.max(service.resources.requests.memoryBytes, memoryMiB * MiB) + MICROVM_LAUNCHER_OVERHEAD.memoryBytes,
  };
}

/**
 * A health check run inside the guest (M7.2): `CMD x` → `CMD vm-exec -- x`, `CMD-SHELL x` → `vm-exec -- /bin/sh -c
 * x`; the boot budget is added to the start period.
 */
export function microvmHealthcheck(healthcheck: HealthCheck | undefined): HealthCheck | undefined {
  if (!healthcheck) return undefined;

  if (!healthcheck.test) return healthcheck;

  const [kind, ...rest] = healthcheck.test;
  const command = kind === 'CMD-SHELL' ? ['/bin/sh', '-c', rest.join(' ')] : kind === 'CMD' ? rest : healthcheck.test;

  return {
    ...healthcheck,
    test: ['CMD', MICROVM_EXEC_CLIENT_PATH, '--', ...command],
    startPeriodMs: healthcheck.startPeriodMs + MICROVM_BOOT_BUDGET_MS,
  };
}

/** The image's own health check (Docker reports durations in ns) as a compose one. */
function imageHealthcheck(inspection: ImageInspection | undefined): HealthCheck | undefined {
  const hc = inspection?.config.healthcheck;

  if (!hc || hc.test.length === 0 || hc.test[0] === 'NONE') return undefined;

  return {
    test: hc.test,
    intervalMs: hc.intervalMs ?? 30_000,
    timeoutMs: hc.timeoutMs ?? 30_000,
    retries: hc.retries ?? 3,
    startPeriodMs: hc.startPeriodMs ?? 0,
  };
}

/** The guest process (image config merged with the compose overrides, Docker's rules). */
export function microvmProcess(
  service: Pick<ServiceSpec, 'entrypoint' | 'command' | 'environment' | 'user' | 'workingDir' | 'stopSignal'>,
  inspection: ImageInspection | undefined,
): NonNullable<MicrovmSpec['process']> {
  const config = inspection?.config ?? {};
  const env = new Map<string, string>();

  for (const entry of config.env ?? []) {
    const eq = entry.indexOf('=');

    env.set(eq < 0 ? entry : entry.slice(0, eq), eq < 0 ? '' : entry.slice(eq + 1));
  }

  for (const [key, value] of Object.entries(service.environment)) env.set(key, value);

  const workingDir = service.workingDir ?? config.workingDir;

  return {
    entrypoint: service.entrypoint ?? config.entrypoint ?? [],
    // A compose entrypoint resets the image's command (Docker's rule).
    cmd: service.command ?? (service.entrypoint ? [] : (config.cmd ?? [])),
    env: [...env].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`),
    user: service.user ?? (config.user || 'root'),
    workingDir: workingDir?.startsWith('/') ? workingDir : '/',
    stopSignal: service.stopSignal ?? config.stopSignal ?? 'SIGTERM',
  };
}

/** Plan-time problems of a microVM service with its inspected image (errors reject the plan). */
export function microvmIssues(
  service: ServiceSpec,
  inspection: ImageInspection | undefined,
): { level: 'error' | 'warning'; path: string; message: string }[] {
  const issues: { level: 'error' | 'warning'; path: string; message: string }[] = [];
  const path = `services.${service.name}`;

  if (service.deviceAccess.length > 0 || service.devices.length > 0)
    issues.push({ level: 'error', path: `${path}.devices`, message: 'a microVM cannot pass host devices through' });

  if (!inspection) return issues;

  if (inspection.vmImage)
    issues.push({
      level: 'error',
      path: `${path}.image`,
      message: `${service.image} is a VM image artifact; use a VirtualMachine resource for it`,
    });
  else if (!isBundledMicrovmImage(inspection)) {
    if (inspection.labels[MICROVM_PROTOCOL_LABEL] !== undefined)
      issues.push({
        level: 'error',
        path: `${path}.image`,
        message: `${service.image} speaks microVM bridge protocol ${inspection.labels[MICROVM_PROTOCOL_LABEL]}; this release supports ${MICROVM_BRIDGE_PROTOCOL_VERSION}`,
      });

    const process = microvmProcess(service, inspection);

    if (process.entrypoint.length === 0 && process.cmd.length === 0)
      issues.push({
        level: 'error',
        path: `${path}.image`,
        message: `${service.image} has no entrypoint or command; set one in compose`,
      });

    if (inspection.layers.length === 0)
      issues.push({ level: 'error', path: `${path}.image`, message: `${service.image} has no layers to boot from` });

    const shellCheck = (service.healthcheck ?? imageHealthcheck(inspection))?.test?.[0] === 'CMD-SHELL';

    if (shellCheck)
      issues.push({
        level: 'warning',
        path: `${path}.healthcheck`,
        message: 'the health check runs through /bin/sh inside the guest; the image must have it',
      });
  }

  return issues;
}

function copyPlatformLayers(
  platformLayers: NonNullable<ImageInspection['platformLayers']>,
): NonNullable<MicrovmSpec['platformLayers']> {
  return Object.fromEntries(
    Object.entries(platformLayers)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([arch, layers]) => [arch, (layers ?? []).map((l) => ({ ...l }))]),
  );
}

/**
 * The microVM part of a workload spec (M7.2): `image` (the launcher for generic mode, the service image itself for
 * bundled images), the `microvm` field, and the process fields the launcher container must not get (generic mode
 * runs the image's process inside the guest).
 */
export function compileMicrovm(
  service: ServiceSpec,
  image: string,
  inspection: ImageInspection | undefined,
  launcherImage: string = microvmLauncherImage(),
): Pick<WorkloadSpec, 'image' | 'microvm' | 'healthcheck'> & { generic: boolean } {
  const { vcpus, memoryMiB } = microvmSizing(service);
  const rootfsBytes = service.microvm?.rootfsBytes ?? DEFAULT_MICROVM_ROOTFS_BYTES;
  if (isBundledMicrovmImage(inspection)) {
    // The bundled image is its own launcher: its own health check stays as Docker runs it.
    const healthcheck = microvmHealthcheck(service.healthcheck);

    return {
      generic: false,
      image,
      microvm: { mode: 'bundled', vcpus, memoryMiB, rootfsBytes },
      ...(healthcheck ? { healthcheck } : {}),
    };
  }

  // Generic: the launcher's own image has no health check of the guest; the image's one runs inside the guest.
  const healthcheck = microvmHealthcheck(service.healthcheck ?? imageHealthcheck(inspection));

  return {
    generic: true,
    image: launcherImage,
    microvm: {
      mode: 'generic',
      guestImage: image,
      // Mixed-arch clusters: every architecture's layers (the node picks its own); single-arch: `layers` as before.
      ...(inspection?.platformLayers
        ? { platformLayers: copyPlatformLayers(inspection.platformLayers) }
        : inspection
          ? { layers: inspection.layers.map((l) => ({ ...l })) }
          : {}),
      ...(inspection ? { process: microvmProcess(service, inspection) } : {}),
      vcpus,
      memoryMiB,
      rootfsBytes,
    },
    ...(healthcheck ? { healthcheck } : {}),
  };
}
