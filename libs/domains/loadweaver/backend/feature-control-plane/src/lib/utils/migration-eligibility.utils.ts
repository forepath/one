import type { CheckpointRuntime } from '@forepath/loadweaver/shared/util-agent-protocol';
import type { ServiceSpec } from '@forepath/loadweaver/shared/util-compose';

/**
 * Per-service choice of the migration method (3.10): live where eligible, blue / green for stateless replicas,
 * short stop otherwise. Pure; the planner feeds it the nodes, the volume placement and the replica's memory.
 */

/** `live` = CRIU pre-copy through runc; `stop-and-copy` = gVisor checkpoint / restore without pre-copy. */
export type MigrationMethod = 'live' | 'stop-and-copy' | 'blue-green' | 'short-stop';

export const LIVE_MIGRATION_FEATURE = 'live-migration';

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
   */
  overheadMs: Record<CheckpointRuntime, number>;
  /** Content of a tmpfs without a size (it is never pre-dumped, so it counts fully). */
  defaultTmpfsBytes: number;
}

export const DEFAULT_ELIGIBILITY_OPTIONS: EligibilityOptions = {
  freezeBudgetMs: 3_000,
  defaultLinkBitsPerSecond: 1_000_000_000,
  dirtyFractionPerSecond: 0.05,
  finalRoundMs: 250,
  overheadMs: { runc: 400, runsc: 2_000 },
  defaultTmpfsBytes: 64 * 1024 ** 2,
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
  /** Checkpoint runtime for `live` / `stop-and-copy`. */
  runtime?: CheckpointRuntime;
  /** Why the replica is not migrated live (absent when it is). */
  reason?: string;
  /** As shown in plans: `live`, `stop-and-copy (gVisor)`, `short-stop (<reason>)`, `blue-green (<reason>)`. */
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
}

function checkpointSupport(node: EligibilityNode, runtime: CheckpointRuntime): boolean {
  const checkpoint = node.capabilities?.['checkpoint'] as { runc?: unknown; runsc?: unknown } | undefined;

  return checkpoint?.[runtime] === true;
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

/** The freeze a checkpoint migration would cause (3.10): tmpfs is never pre-dumped and counts fully. */
export function estimateFreeze(
  input: Pick<EligibilityInput, 'service' | 'memoryBytes'>,
  runtime: CheckpointRuntime,
  linkBitsPerSecond: number,
  options: EligibilityOptions,
): MigrationEstimate {
  const { service } = input;
  const memoryBytes =
    input.memoryBytes ?? service.resources.limits.memoryBytes ?? service.resources.requests.memoryBytes;
  const tmpfsBytes = service.volumes
    .filter((v): v is Extract<typeof v, { type: 'tmpfs' }> => v.type === 'tmpfs')
    .reduce((sum, v) => sum + (v.sizeBytes ?? options.defaultTmpfsBytes), 0);
  // runc: only what the last pre-copy round dirtied; runsc: no pre-copy, the whole memory is frozen.
  const memoryFrozen =
    runtime === 'runc'
      ? Math.ceil(memoryBytes * options.dirtyFractionPerSecond * (options.finalRoundMs / 1000))
      : memoryBytes;
  const frozenBytes = memoryFrozen + tmpfsBytes;
  const freezeMs = Math.ceil((frozenBytes * 8 * 1000) / linkBitsPerSecond) + options.overheadMs[runtime];

  return { memoryBytes, tmpfsBytes, frozenBytes, linkBitsPerSecond, freezeMs };
}

/** Chooses the method for one moving replica (3.10); the first reason against a checkpoint migration wins. */
export function chooseMigrationMethod(
  input: EligibilityInput,
  options: EligibilityOptions = DEFAULT_ELIGIBILITY_OPTIONS,
): MigrationChoice {
  const { service, source, target } = input;
  const fallback = (reason: string): MigrationChoice => {
    const method: MigrationMethod = input.stateful ? 'short-stop' : 'blue-green';

    return { method, reason, label: `${method} (${reason})` };
  };
  const runtime: CheckpointRuntime = service.runtime === 'sandboxed' ? 'runsc' : 'runc';
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

  for (const node of [source, target]) {
    if (!node.features.includes(LIVE_MIGRATION_FEATURE))
      return fallback(`agent on ${node.name} does not support live migration`);

    if (!checkpointSupport(node, runtime))
      return fallback(`no ${runtime === 'runc' ? 'CRIU' : 'gVisor'} checkpoint support on ${node.name}`);
  }

  const estimate = estimateFreeze(input, runtime, linkSpeed(source, target, options.defaultLinkBitsPerSecond), options);

  if (estimate.freezeMs > options.freezeBudgetMs)
    return {
      ...fallback(
        `estimated freeze ${(estimate.freezeMs / 1000).toFixed(1)} s for ${formatBytes(estimate.frozenBytes)} at ${formatRate(estimate.linkBitsPerSecond)} exceeds ${(options.freezeBudgetMs / 1000).toFixed(1)} s`,
      ),
      estimate,
    };

  return runtime === 'runc'
    ? { method: 'live', runtime, label: 'live', estimate }
    : { method: 'stop-and-copy', runtime, label: 'stop-and-copy (gVisor)', estimate };
}
