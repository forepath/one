import { createHash } from 'crypto';

import {
  GVISOR_ISOLATION_LEVELS,
  type GvisorIsolationLevel,
  ISOLATION_LEVEL_RANK,
  ISOLATION_LEVELS,
  type IsolationLevel,
  type IsolationSelectionSource,
  resolveGvisorLevelRuntimes,
  STANDARD_ISOLATION_RUNTIME,
} from '../constants/container-isolation.constants';
import type {
  AgentIsolationSelectionDto,
  HostIsolationCapabilitiesDto,
  IsolationLevelCapabilityDto,
} from '../dto/container-isolation.dto';

export function isIsolationLevel(value: unknown): value is IsolationLevel {
  return typeof value === 'string' && (ISOLATION_LEVELS as readonly string[]).includes(value);
}

/** Whether a level runs on gVisor (`sandboxed`, `sandboxed-kvm`). */
export function isGvisorIsolationLevel(level: IsolationLevel): level is GvisorIsolationLevel {
  return (GVISOR_ISOLATION_LEVELS as readonly string[]).includes(level);
}

/** Whether a level runs the workload as a KVM microVM (launcher container of the microVM image). */
export function isMicrovmIsolationLevel(level: IsolationLevel): level is 'microvm' {
  return level === 'microvm';
}

/**
 * Whether a level depends on more than Docker's default runtime (gVisor or a microVM). Such environments get
 * their runtime pinned explicitly, report runtime failures and are never retried on a weaker level.
 */
export function isEnhancedIsolationLevel(level: IsolationLevel): level is GvisorIsolationLevel | 'microvm' {
  return isGvisorIsolationLevel(level) || isMicrovmIsolationLevel(level);
}

/**
 * Docker runtime name backing an isolation level on this host (the Netstack variant for gVisor levels). MicroVM
 * launchers always run on runc: the VM is the boundary, and QEMU needs the host kernel's KVM (never gVisor).
 */
export function runtimeForIsolationLevel(level: IsolationLevel, env: NodeJS.ProcessEnv = process.env): string {
  return isGvisorIsolationLevel(level) ? resolveGvisorLevelRuntimes(level, env).runtime : STANDARD_ISOLATION_RUNTIME;
}

/**
 * Docker runtime a gVisor container must use on its network: workers sharing their egress guard's
 * namespace (`container:<id>`) or attached to a user-defined network need the kernel network stack
 * variant (`--network=host`) of their level, workers on the default bridge the Netstack variant.
 * Runtimes of no gVisor level (runc, unknown runtimes) are returned unchanged. Security relevant:
 * Netstack inside a guard namespace would take over its interfaces and bypass the guard's netfilter
 * rules and loopback proxy.
 */
export function mapGvisorRuntimeForNetwork(
  runtime: string,
  sharesNetworkNamespace: boolean,
  env: NodeJS.ProcessEnv = process.env,
): string {
  for (const level of GVISOR_ISOLATION_LEVELS) {
    const runtimes = resolveGvisorLevelRuntimes(level, env);

    if (runtime === runtimes.runtime || runtime === runtimes.sharedNetnsRuntime) {
      return sharesNetworkNamespace ? runtimes.sharedNetnsRuntime : runtimes.runtime;
    }
  }

  return runtime;
}

/** Isolation level persisted for an environment; rows created before isolation levels are `standard`. */
export function effectiveIsolationLevel(stored: string | null | undefined): IsolationLevel {
  return isIsolationLevel(stored) ? stored : 'standard';
}

/**
 * `updateContainer` options pinning the environment's runtime on every recreate path. gVisor
 * environments (sandboxed, sandboxed-kvm) always get their level's runtime explicitly (they never
 * silently come back on runc or another gVisor platform), microVM launchers always get runc (never a gVisor
 * daemon default); standard environments keep Docker's default runtime exactly as before isolation levels
 * existed (the current container's runtime is carried over).
 */
export function isolationRuntimeOptions(
  agent: { isolationLevel?: string | null } | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): { runtime?: string } {
  if (!agent) {
    return {};
  }

  const level = effectiveIsolationLevel(agent.isolationLevel);

  return isEnhancedIsolationLevel(level) ? { runtime: runtimeForIsolationLevel(level, env) } : {};
}

/** Expected-runtime argument list for `getEnvironmentApplyStrategy` (empty for standard environments). */
export function isolationRuntimeArgs(
  agent: { isolationLevel?: string | null } | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): [] | [string] {
  const { runtime } = isolationRuntimeOptions(agent, env);

  return runtime ? [runtime] : [];
}

/**
 * Docker runtime to request when creating a container of a level: the level's gVisor runtime for
 * `sandboxed` / `sandboxed-kvm`, runc for `microvm`; nothing (Docker's default runtime, normally runc) for
 * `standard`.
 */
export function containerRuntimeForIsolationLevel(
  level: IsolationLevel,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return isEnhancedIsolationLevel(level) ? runtimeForIsolationLevel(level, env) : undefined;
}

/** Ready levels, strongest first. */
export function availableIsolationLevels(levels: HostIsolationCapabilitiesDto['levels']): IsolationLevel[] {
  return [...ISOLATION_LEVELS]
    .filter((level) => levels[level]?.state === 'ready')
    .sort((a, b) => ISOLATION_LEVEL_RANK[b] - ISOLATION_LEVEL_RANK[a]);
}

/**
 * Strongest ready level. The standard (runc) floor is mandatory: when it is not ready the host
 * cannot run environments at all and no level is recommended, even if gVisor would work.
 */
export function strongestAvailableIsolationLevel(
  levels: HostIsolationCapabilitiesDto['levels'],
): IsolationLevel | null {
  if (levels.standard?.state !== 'ready') {
    return null;
  }

  return availableIsolationLevels(levels)[0] ?? null;
}

export type IsolationResolutionErrorCode =
  | 'invalid-level'
  | 'host-not-runnable'
  | 'level-unavailable'
  | 'stale-revision';

export class IsolationResolutionError extends Error {
  constructor(
    readonly code: IsolationResolutionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'IsolationResolutionError';
  }
}

export interface IsolationResolution {
  level: IsolationLevel;
  automaticSelection: IsolationLevel;
  selectionSource: IsolationSelectionSource;
}

/**
 * Validate an isolation request against the current host capabilities.
 * - Omitted level resolves to the recommendation (strongest ready level).
 * - An explicit level must be ready; it is never silently replaced by another level.
 * - A capability revision, when supplied, must match the current one (stale forms are rejected).
 */
export function resolveIsolationRequest(
  capabilities: Pick<HostIsolationCapabilitiesDto, 'revision' | 'levels'>,
  request: { isolationLevel?: unknown; capabilityRevision?: unknown },
): IsolationResolution {
  const requested = request.isolationLevel;

  if (requested !== undefined && requested !== null && !isIsolationLevel(requested)) {
    throw new IsolationResolutionError(
      'invalid-level',
      `Isolation level must be one of: ${ISOLATION_LEVELS.join(', ')}`,
    );
  }

  const automaticSelection = strongestAvailableIsolationLevel(capabilities.levels);

  if (!automaticSelection) {
    throw new IsolationResolutionError(
      'host-not-runnable',
      'This agent manager host cannot run environments: the standard Docker (runc) baseline is not available',
    );
  }

  const revision = request.capabilityRevision;

  if (revision !== undefined && revision !== null && revision !== '' && revision !== capabilities.revision) {
    throw new IsolationResolutionError(
      'stale-revision',
      'The isolation capabilities of this workspace changed since the form was opened. Review the isolation level and try again.',
    );
  }

  if (!isIsolationLevel(requested)) {
    return { level: automaticSelection, automaticSelection, selectionSource: 'automatic' };
  }

  if (capabilities.levels[requested]?.state !== 'ready') {
    throw new IsolationResolutionError(
      'level-unavailable',
      `Isolation level '${requested}' is not available on this agent manager host`,
    );
  }

  return {
    level: requested,
    automaticSelection,
    selectionSource:
      ISOLATION_LEVEL_RANK[requested] < ISOLATION_LEVEL_RANK[automaticSelection] ? 'user-override' : 'user-confirmed',
  };
}

function optionalString(value: unknown, maxLength: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength ? value : null;
}

/**
 * Build the persisted selection record. Only the selecting user id is taken from the (controller
 * supplied) input; every other field is derived from the resolution so callers cannot forge it.
 */
export function buildIsolationSelection(
  resolution: IsolationResolution,
  capabilityRevision: string,
  input?: unknown,
  now: Date = new Date(),
): AgentIsolationSelectionDto {
  const selectedBy =
    input && typeof input === 'object' ? optionalString((input as Record<string, unknown>)['selectedBy'], 255) : null;

  return {
    automaticSelection: resolution.automaticSelection,
    effectiveSelection: resolution.level,
    selectionSource: resolution.selectionSource,
    selectedBy,
    selectedAt: now.toISOString(),
    capabilityRevision,
  };
}

/** Deterministic `sha256:` revision over the probed host state. */
export function computeIsolationCapabilityRevision(input: {
  dockerVersion?: string | null;
  kernelVersion?: string | null;
  runtimes: Record<string, string | null | undefined>;
  probeImageId?: string | null;
  microvmImageId?: string | null;
  levels: Record<IsolationLevel, Pick<IsolationLevelCapabilityDto, 'runtime' | 'state' | 'reasonCode'>>;
}): string {
  const canonical = JSON.stringify({
    microvmImageId: input.microvmImageId ?? null,
    dockerVersion: input.dockerVersion ?? null,
    kernelVersion: input.kernelVersion ?? null,
    runtimes: Object.keys(input.runtimes)
      .sort()
      .map((name) => [name, input.runtimes[name] ?? null]),
    probeImageId: input.probeImageId ?? null,
    levels: ISOLATION_LEVELS.map((level) => [
      level,
      input.levels[level].runtime,
      input.levels[level].state,
      input.levels[level].reasonCode ?? null,
    ]),
  });

  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}
