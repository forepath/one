import type { CheckpointRuntime } from '@forepath/loadweaver/shared/util-agent-protocol';
import type { ServiceSpec } from '@forepath/loadweaver/shared/util-compose';
import type { Runtime } from '@forepath/loadweaver/shared/util-model';

/**
 * Per-service choice of the migration method (3.10): live where eligible, blue / green for stateless replicas,
 * short stop otherwise. Pure; the planner feeds it the nodes, the volume placement and the replica's memory.
 */

/**
 * `live` = CRIU pre-copy through runc; `stop-and-copy` = gVisor checkpoint / restore without pre-copy (systrap or KVM
 * platform, restored on the same platform); `vm-live` = QEMU live migration with memory pre-copy (3.35, M7.4): full
 * VMs (disks dual-primary on DRBD, plan label `vm-live (QEMU)`) and generic microVMs (writable layer and tmpfs
 * pre-copied, virtio-fs state migrated, filesystem volumes handed over in the freeze; plan label
 * `microvm-live (QEMU)`, M7 W10b) and bundled microVMs (Agenstra's images whose launcher has the incoming mode, M7 F5;
 * plan label {@link BUNDLED_MICROVM_LIVE_LABEL}: user-mode networking resets the guest's open connections). All run
 * the same session phases; the node tells them apart by the spec.
 */
export type MigrationMethod = 'live' | 'stop-and-copy' | 'vm-live' | 'blue-green' | 'short-stop';

/**
 * What a session migrates with (control plane only): the wire's checkpoint runtimes plus `qemu` for `vm-live`, which
 * travels as its own messages (`vmMigration*`), never as a `CheckpointRuntime`.
 */
export type SessionRuntime = CheckpointRuntime | 'qemu';

/** Keys of the fixed per-method overhead: the gVisor KVM platform has its own (`runsc-kvm`). */
export type OverheadKey = SessionRuntime | 'runsc-kvm';

export const LIVE_MIGRATION_FEATURE = 'live-migration';
/** QEMU live migration of VMs / generic microVMs (`vmMigrationPrepare` / `Start` / `Switchover`). */
export const VM_MIGRATION_FEATURE = 'vm-migration';
/** The isolation ladder (gVisor-KVM checkpoints restore on the same platform only). */
export const ISOLATION_LADDER_FEATURE = 'isolation-ladder';
/**
 * Node capability (M7 W10b): the node's microVM launcher migrates generic microVMs live (virtio-fs state migration:
 * QEMU >= 10.0, virtiofsd >= 1.13, from the launcher image's labels; microVM level ready).
 */
export const MICROVM_MIGRATION_CAPABILITY = 'microvmMigration';
/**
 * Node capability (M7 F5): the node agent migrates bundled microVMs (their image brings its own launcher with the
 * incoming mode; microVM level ready). Agents without it fall back.
 */
export const MICROVM_BUNDLED_MIGRATION_CAPABILITY = 'microvmBundledMigration';
/**
 * Plan label of a bundled microVM's live migration: QEMU's user-mode network (slirp) state stays in the source's
 * launcher, so the guest's open TCP connections are reset; processes, memory and files move.
 */
export const BUNDLED_MICROVM_LIVE_LABEL = 'microvm-live (QEMU; guest connections reset: user-mode networking)';

/** QEMU's device state in the final round (virtio queues, CPU registers, …), next to the dirty memory. */
export const QEMU_DEVICE_STATE_BYTES = 2 * 1024 ** 2;

export interface EligibilityNode {
  name: string;
  /** Agent-protocol features the node advertised (3.26). */
  features: readonly string[];
  /** The node's reported capabilities (hello). */
  capabilities: Record<string, unknown> | null;
  reachable: boolean;
}

export interface EligibilityOptions {
  /** Longest acceptable freeze (final dump → running on the target). */
  freezeBudgetMs: number;
  /** Link speed when the nodes don't report one. */
  defaultLinkBitsPerSecond: number;
  /** Share of the replica's memory dirtied per second (when no measurement exists). */
  dirtyFractionPerSecond: number;
  /** Duration of the last pre-copy round: what it dirties is frozen in the final dump. */
  finalRoundMs: number;
  /**
   * Fixed dump + restore cost per runtime, without the transfer. runc: final dump ≈ 0.4 s (spike). runsc (VM lab,
   * step 1c): `runsc checkpoint` 0.16–0.9 s + placeholder start and `runsc restore` 0.6–3.3 s, typically ≈ 1.1–1.7 s.
   * runsc-kvm: initial 2.5 s until the VM lab measured it (M7.1). qemu: switch-over + resume, initial 300 ms (M7.4).
   */
  overheadMs: Record<OverheadKey, number>;
  /** Content of a tmpfs without a size (runc / runsc: never pre-dumped, so it counts fully). */
  defaultTmpfsBytes: number;
  /**
   * Generic microVMs (M7 W10b): the final pass over the writable layer and tmpfs volumes while the guest is stopped
   * (initial 250 ms, lab-measured later), and the hand-over of each filesystem volume (unmount, demote, promote,
   * mount; initial 400 ms).
   */
  microvmSyncMs: number;
  volumeHandoverMs: number;
}

export const DEFAULT_ELIGIBILITY_OPTIONS: EligibilityOptions = {
  freezeBudgetMs: 3_000,
  defaultLinkBitsPerSecond: 1_000_000_000,
  dirtyFractionPerSecond: 0.05,
  finalRoundMs: 250,
  overheadMs: { runc: 400, runsc: 2_000, 'runsc-kvm': 2_500, qemu: 300 },
  defaultTmpfsBytes: 64 * 1024 ** 2,
  microvmSyncMs: 250,
  volumeHandoverMs: 400,
};

/** Options from the environment (`LOADWEAVER_LIVE_MIGRATION_*`), falling back to the defaults. */
export function eligibilityOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): EligibilityOptions {
  const num = (key: string, fallback: number, min: number, max: number) => {
    const value = Number(env[key]);

    return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
  };
  const d = DEFAULT_ELIGIBILITY_OPTIONS;

  return {
    ...d,
    freezeBudgetMs: num('LOADWEAVER_LIVE_MIGRATION_FREEZE_BUDGET_MS', d.freezeBudgetMs, 100, 600_000),
    defaultLinkBitsPerSecond: num('LOADWEAVER_LIVE_MIGRATION_LINK_BPS', d.defaultLinkBitsPerSecond, 1e6, 1e12),
    dirtyFractionPerSecond: num('LOADWEAVER_LIVE_MIGRATION_DIRTY_FRACTION', d.dirtyFractionPerSecond, 0, 1),
  };
}

export interface MigrationEstimate {
  memoryBytes: number;
  tmpfsBytes: number;
  /** What is transferred while the replica is frozen. */
  frozenBytes: number;
  linkBitsPerSecond: number;
  freezeMs: number;
}

export interface MigrationChoice {
  method: MigrationMethod;
  /** Session runtime for `live` / `stop-and-copy` (runc / runsc) and `vm-live` (qemu). */
  runtime?: SessionRuntime;
  /** Why the replica is not migrated live (absent when it is). */
  reason?: string;
  /**
   * As shown in plans: `live`, `stop-and-copy (gVisor)`, `stop-and-copy (gVisor KVM)`, `vm-live (QEMU)`,
   * `microvm-live (QEMU)`, `short-stop (<reason>)`, `blue-green (<reason>)`.
   */
  label: string;
  estimate?: MigrationEstimate;
}

export interface EligibilityInput {
  service: Pick<
    ServiceSpec,
    'kind' | 'runtime' | 'liveMigration' | 'privileged' | 'networkMode' | 'devices' | 'volumes' | 'resources'
  >;
  /** The service has replicated volumes. */
  stateful: boolean;
  /** Volumes whose current placement has no synchronous replica on the target. */
  unsyncedVolumes: readonly string[];
  source: EligibilityNode | undefined;
  target: EligibilityNode | undefined;
  /** Measured memory of the replica (latest `replica.memory_bytes`), if any. */
  memoryBytes?: number;
  /**
   * Launcher workloads (`runtime: microvm`, 3.35): a full VM (with its CPU model), or a microVM in generic / bundled
   * mode (from the pinned image inspection; `unknown` while the image isn't inspected yet). A bundled image migrates
   * live only when its launcher declares the `bundled` mode in `io.forepath.microvm.migration` (launchers since M7 F5:
   * Agenstra's `launch` with its incoming mode; older images fall back).
   */
  launcher?:
    | { kind: 'vm'; cpuModel: 'host-model' | 'host-passthrough' }
    | { kind: 'bundled'; migration?: boolean }
    | { kind: 'generic' | 'unknown' };
  /** Agent features the target needs to run the replica at all (`replicaAgentFeatures`, a hard placement rule). */
  targetFeatures?: readonly string[];
}

/** Whether a node can checkpoint / restore at a level (gVisor KVM: same platform on both ends, M7.1). */
export function checkpointSupport(node: EligibilityNode, runtime: CheckpointRuntime, platform?: 'kvm'): boolean {
  const checkpoint = node.capabilities?.['checkpoint'] as
    | { runc?: unknown; runsc?: unknown; runscKvm?: unknown }
    | undefined;

  if (platform === 'kvm') return checkpoint?.runscKvm === true && levelReady(node, 'sandboxed-kvm');

  return checkpoint?.[runtime] === true;
}

/** The node reports the level ready (nodes without the isolation ladder report no list: only the old levels). */
function levelReady(node: EligibilityNode, level: Runtime): boolean {
  const runtimes = node.capabilities?.['runtimes'];

  return Array.isArray(runtimes) && runtimes.includes(level);
}

function cpuFlagsHash(node: EligibilityNode): string | null {
  const hash = node.capabilities?.['cpuFlagsHash'];

  return typeof hash === 'string' && hash.length > 0 ? hash : null;
}

function linkSpeed(source: EligibilityNode, target: EligibilityNode, fallback: number): number {
  const speeds = [source, target]
    .map((n) => n.capabilities?.['transferBitsPerSecond'])
    .filter((v): v is number => typeof v === 'number' && v > 0);

  return speeds.length > 0 ? Math.min(...speeds) : fallback;
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GiB`
    : bytes >= 1024 ** 2
      ? `${Math.round(bytes / 1024 ** 2)} MiB`
      : `${Math.round(bytes / 1024)} KiB`;
}

function formatRate(bitsPerSecond: number): string {
  return bitsPerSecond >= 1e9
    ? `${+(bitsPerSecond / 1e9).toFixed(1)} Gbit/s`
    : `${Math.round(bitsPerSecond / 1e6)} Mbit/s`;
}

/**
 * The freeze a migration would cause (3.10): runc and QEMU pre-copy, so only what the last round dirtied is frozen
 * (QEMU: plus its device state, ~2 MiB); gVisor (either platform) freezes the whole memory. tmpfs counts fully for
 * runc / runsc (never pre-dumped); a generic microVM's tmpfs volumes are pre-copied with its writable layer, so only
 * what the last round dirtied counts (a VM has none).
 */
export function estimateFreeze(
  input: Pick<EligibilityInput, 'service' | 'memoryBytes'>,
  runtime: SessionRuntime,
  linkBitsPerSecond: number,
  options: EligibilityOptions,
  platform?: 'kvm',
): MigrationEstimate {
  const { service } = input;
  const memoryBytes =
    input.memoryBytes ?? service.resources.limits.memoryBytes ?? service.resources.requests.memoryBytes;
  const tmpfsBytes = service.volumes
    .filter((v): v is Extract<typeof v, { type: 'tmpfs' }> => v.type === 'tmpfs')
    .reduce((sum, v) => sum + (v.sizeBytes ?? options.defaultTmpfsBytes), 0);
  // runc / qemu: only what the last pre-copy round dirtied; runsc: no pre-copy, the whole memory is frozen.
  const memoryFrozen =
    runtime === 'runsc'
      ? memoryBytes
      : Math.ceil(memoryBytes * options.dirtyFractionPerSecond * (options.finalRoundMs / 1000)) +
        (runtime === 'qemu' ? QEMU_DEVICE_STATE_BYTES : 0);
  const tmpfsFrozen =
    runtime === 'qemu'
      ? Math.ceil(tmpfsBytes * options.dirtyFractionPerSecond * (options.finalRoundMs / 1000))
      : tmpfsBytes;
  const frozenBytes = memoryFrozen + tmpfsFrozen;
  const overhead = options.overheadMs[runtime === 'runsc' && platform === 'kvm' ? 'runsc-kvm' : runtime];
  const freezeMs = Math.ceil((frozenBytes * 8 * 1000) / linkBitsPerSecond) + overhead;

  return { memoryBytes, tmpfsBytes, frozenBytes, linkBitsPerSecond, freezeMs };
}

/**
 * Chooses the method for one moving replica (3.10, per isolation level M7): runc → CRIU pre-copy (`live`);
 * sandboxed → gVisor checkpoint (`stop-and-copy`); sandboxed-kvm → gVisor checkpoint on the KVM platform, restored on
 * the same platform only; full VMs → QEMU live migration (`vm-live`, DRBD dual-primary during the switch); generic
 * microVMs (with or without filesystem volumes) → QEMU live migration with virtio-fs state (`microvm-live (QEMU)`)
 * when both nodes' launchers can (capability `microvmMigration`); bundled microVMs only when their launcher declares
 * it and both agents can (capability `microvmBundledMigration`; guest connections reset); otherwise short stop /
 * blue-green. The first reason against wins.
 */
export function chooseMigrationMethod(
  input: EligibilityInput,
  options: EligibilityOptions = DEFAULT_ELIGIBILITY_OPTIONS,
): MigrationChoice {
  const { service, source, target } = input;
  const fallback = (reason: string): MigrationChoice => {
    const method: MigrationMethod = input.stateful ? 'short-stop' : 'blue-green';

    return { method, reason, label: `${method} (${reason})` };
  };
  const level = service.runtime as Runtime;
  const bind = service.volumes.find((v) => v.type === 'bind');

  if (service.kind !== 'service') return fallback('one-off jobs are not checkpointed');

  if (!service.liveMigration) return fallback('live migration disabled for the service');

  if (!source?.reachable) return fallback('source node unreachable');

  if (!target) return fallback('unknown target node');

  if (service.privileged) return fallback('privileged container');

  if (service.networkMode === 'host') return fallback('host network');

  if (service.devices.length > 0) return fallback(`device access (${service.devices.join(', ')})`);

  if (bind) return fallback(`bind mount of host path ${bind.source}`);

  if (input.stateful && input.unsyncedVolumes.length > 0)
    return fallback(`volume ${input.unsyncedVolumes[0]} has no synchronous replica on ${target.name}`);

  const missing = (input.targetFeatures ?? []).find((f) => !target.features.includes(f));

  if (missing) return fallback(`agent on ${target.name} lacks the feature ${missing} this replica needs`);

  if (level === 'microvm') return chooseQemuMigration(input, source, target, options, fallback);

  const platform = level === 'sandboxed-kvm' ? ('kvm' as const) : undefined;
  const runtime: CheckpointRuntime = level === 'sandboxed' || platform ? 'runsc' : 'runc';

  for (const node of [source, target]) {
    if (!node.features.includes(LIVE_MIGRATION_FEATURE))
      return fallback(`agent on ${node.name} does not support live migration`);

    if (platform && !node.features.includes(ISOLATION_LADDER_FEATURE))
      return fallback(`agent on ${node.name} has no gVisor KVM platform support`);

    if (!checkpointSupport(node, runtime, platform))
      return fallback(
        platform
          ? `no gVisor KVM checkpoint support on ${node.name} (restore must use the same platform)`
          : `no ${runtime === 'runc' ? 'CRIU' : 'gVisor'} checkpoint support on ${node.name}`,
      );
  }

  const estimate = estimateFreeze(
    input,
    runtime,
    linkSpeed(source, target, options.defaultLinkBitsPerSecond),
    options,
    platform,
  );

  if (estimate.freezeMs > options.freezeBudgetMs) return { ...fallback(overBudget(estimate, options)), estimate };

  if (runtime === 'runc') return { method: 'live', runtime, label: 'live', estimate };

  return {
    method: 'stop-and-copy',
    runtime,
    label: platform ? 'stop-and-copy (gVisor KVM)' : 'stop-and-copy (gVisor)',
    estimate,
  };
}

function overBudget(estimate: MigrationEstimate, options: EligibilityOptions): string {
  return `estimated freeze ${(estimate.freezeMs / 1000).toFixed(1)} s for ${formatBytes(estimate.frozenBytes)} at ${formatRate(estimate.linkBitsPerSecond)} exceeds ${(options.freezeBudgetMs / 1000).toFixed(1)} s`;
}

/**
 * Launcher workloads (M7.4, M7 W10b): QEMU live migration of full VMs and generic microVMs. VM disks stay on DRBD
 * (dual-primary only between the prepare and commit / abort confirmations); a microVM's filesystem volumes are handed
 * over during the freeze (single primary, never mounted twice), its writable layer and tmpfs volumes pre-copied. Every
 * volume needs a synchronous replica on the target (checked before); the workload IP is kept.
 */
function chooseQemuMigration(
  input: EligibilityInput,
  source: EligibilityNode,
  target: EligibilityNode,
  options: EligibilityOptions,
  fallback: (reason: string) => MigrationChoice,
): MigrationChoice {
  const launcher = input.launcher ?? { kind: 'unknown' as const };

  if (launcher.kind === 'bundled' && !launcher.migration)
    return fallback(
      'bundled microVM: its launcher has no live migration (image built before the incoming mode; label io.forepath.microvm.migration without bundled)',
    );

  if (launcher.kind === 'unknown') return fallback('microVM image not inspected yet');

  for (const node of [source, target]) {
    for (const feature of [VM_MIGRATION_FEATURE, LIVE_MIGRATION_FEATURE])
      if (!node.features.includes(feature)) return fallback(`agent on ${node.name} does not support VM live migration`);
  }

  if (launcher.kind === 'generic')
    for (const node of [source, target])
      if (node.capabilities?.[MICROVM_MIGRATION_CAPABILITY] !== true)
        return fallback(
          `no microVM live migration on ${node.name} (its launcher needs virtio-fs state migration: QEMU 10.0+, virtiofsd 1.13+)`,
        );

  // Bundled: the image is its own launcher (its labels vouch for QEMU / virtiofsd); the agents must drive it.
  if (launcher.kind === 'bundled')
    for (const node of [source, target])
      if (node.capabilities?.[MICROVM_BUNDLED_MIGRATION_CAPABILITY] !== true)
        return fallback(`no bundled microVM live migration on ${node.name} (agent or microVM level)`);

  // MicroVM launchers boot their guests with `host-passthrough` as well.
  if (launcher.kind !== 'vm' || launcher.cpuModel === 'host-passthrough') {
    const [a, b] = [cpuFlagsHash(source), cpuFlagsHash(target)];

    if (!a || !b || a !== b)
      return fallback(`cpu model host-passthrough needs identical CPUs on ${source.name} and ${target.name}`);
  }

  const qemu = estimateFreeze(input, 'qemu', linkSpeed(source, target, options.defaultLinkBitsPerSecond), options);
  // A microVM's freeze also holds the final guest tree pass and the hand-over of each filesystem volume.
  const fsVolumes = input.service.volumes.filter((v) => v.type === 'volume').length;
  const estimate =
    launcher.kind === 'vm'
      ? qemu
      : { ...qemu, freezeMs: qemu.freezeMs + options.microvmSyncMs + fsVolumes * options.volumeHandoverMs };

  if (estimate.freezeMs > options.freezeBudgetMs) return { ...fallback(overBudget(estimate, options)), estimate };

  return {
    method: 'vm-live',
    runtime: 'qemu',
    label:
      launcher.kind === 'vm'
        ? 'vm-live (QEMU)'
        : launcher.kind === 'bundled'
          ? BUNDLED_MICROVM_LIVE_LABEL
          : 'microvm-live (QEMU)',
    estimate,
  };
}
