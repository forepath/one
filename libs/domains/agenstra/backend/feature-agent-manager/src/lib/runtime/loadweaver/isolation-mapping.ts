import { BadRequestException } from '@nestjs/common';

import {
  GVISOR_ISOLATION_LEVELS,
  ISOLATION_LEVELS,
  ISOLATION_RUNTIME_FAILURE_CODE,
  type IsolationLevel,
  resolveGvisorLevelRuntimes,
  STANDARD_ISOLATION_RUNTIME,
} from '../../constants/container-isolation.constants';

/**
 * Loadweaver's isolation levels (`x-loadweaver.runtime`, Loadweaver plan 3.1), in ladder order. Re-declared here so
 * the agent manager stays free of Loadweaver model imports (the control plane speaks the same strings).
 */
export const LOADWEAVER_RUNTIMES = ['runc', 'sandboxed', 'sandboxed-kvm', 'microvm'] as const;
export type LoadweaverEnvironmentRuntime = (typeof LOADWEAVER_RUNTIMES)[number];

/**
 * Agenstra isolation level → Loadweaver runtime, 1:1 (Loadweaver plan 3.35, M7.5). gVisor levels use Loadweaver's
 * Netstack variants (the node proxy does egress, there is no guard namespace), `microvm` runs Agenstra's microVM image
 * as a bundled microVM (the image is its own launcher).
 */
export const LOADWEAVER_RUNTIME_FOR_LEVEL: Readonly<Record<IsolationLevel, LoadweaverEnvironmentRuntime>> = {
  standard: 'runc',
  sandboxed: 'sandboxed',
  'sandboxed-kvm': 'sandboxed-kvm',
  microvm: 'microvm',
};

const LEVEL_FOR_LOADWEAVER_RUNTIME: Readonly<Record<LoadweaverEnvironmentRuntime, IsolationLevel>> = {
  runc: 'standard',
  sandboxed: 'sandboxed',
  'sandboxed-kvm': 'sandboxed-kvm',
  microvm: 'microvm',
};

/** `400` with Agenstra's `E_ISOLATION_RUNTIME_FAILED`: an isolation level is never guessed, downgraded or upgraded. */
export class LoadweaverIsolationMappingError extends BadRequestException {
  readonly code = ISOLATION_RUNTIME_FAILURE_CODE;

  constructor(message: string) {
    super({ statusCode: 400, error: 'Bad Request', code: ISOLATION_RUNTIME_FAILURE_CODE, message });
  }
}

export function isLoadweaverRuntime(value: unknown): value is LoadweaverEnvironmentRuntime {
  return typeof value === 'string' && (LOADWEAVER_RUNTIMES as readonly string[]).includes(value);
}

/** The Loadweaver runtime of an Agenstra isolation level; anything else throws (no fallback). */
export function toLoadweaverRuntime(level: string): LoadweaverEnvironmentRuntime {
  if (!(ISOLATION_LEVELS as readonly string[]).includes(level))
    throw new LoadweaverIsolationMappingError(`Isolation level '${level}' has no Loadweaver runtime`);

  return LOADWEAVER_RUNTIME_FOR_LEVEL[level as IsolationLevel];
}

/** The Agenstra isolation level of a Loadweaver runtime; anything else throws (no fallback). */
export function toIsolationLevel(runtime: string): IsolationLevel {
  if (!isLoadweaverRuntime(runtime))
    throw new LoadweaverIsolationMappingError(`Loadweaver runtime '${runtime}' is not an Agenstra isolation level`);

  return LEVEL_FOR_LOADWEAVER_RUNTIME[runtime];
}

/**
 * The isolation level of an Agenstra container runtime name (what the agent manager passes as `runtime`): `runc` →
 * standard, the configured gVisor runtimes of a level (both network variants) → that level. `null` for other names.
 */
export function isolationLevelOfContainerRuntime(
  runtime: string,
  env: NodeJS.ProcessEnv = process.env,
): IsolationLevel | null {
  if (runtime === STANDARD_ISOLATION_RUNTIME) return 'standard';

  for (const level of GVISOR_ISOLATION_LEVELS) {
    const runtimes = resolveGvisorLevelRuntimes(level, env);

    if (runtime === runtimes.runtime || runtime === runtimes.sharedNetnsRuntime) return level;
  }

  return null;
}

/**
 * The Loadweaver runtime of a new environment from the container create options: `microvm` (the launcher's own
 * runtime is runc, Agenstra passes `runc` with it), otherwise the level of the container runtime. Unknown runtime
 * names throw: an environment never runs on a level it didn't ask for.
 */
export function loadweaverRuntimeForContainer(
  runtime: string,
  options: { microvm?: boolean } = {},
  env: NodeJS.ProcessEnv = process.env,
): LoadweaverEnvironmentRuntime {
  if (options.microvm) {
    if (runtime !== STANDARD_ISOLATION_RUNTIME)
      throw new LoadweaverIsolationMappingError(`A microVM environment's launcher runs on runc, not '${runtime}'`);

    return 'microvm';
  }

  const level = isolationLevelOfContainerRuntime(runtime, env);

  if (!level) throw new LoadweaverIsolationMappingError(`Container runtime '${runtime}' has no Loadweaver equivalent`);

  return toLoadweaverRuntime(level);
}

/**
 * The Loadweaver runtime after an update that pins the environment's container runtime. A microVM environment gets
 * its launcher's runtime (`runc`) pinned and stays `microvm`; nothing ever moves into or out of a microVM by an
 * update (the image and the guest layout differ), and an unknown runtime throws.
 */
export function loadweaverRuntimeForUpdate(
  current: LoadweaverEnvironmentRuntime,
  runtime: string,
  env: NodeJS.ProcessEnv = process.env,
): LoadweaverEnvironmentRuntime {
  if (current === 'microvm') {
    if (runtime !== STANDARD_ISOLATION_RUNTIME)
      throw new LoadweaverIsolationMappingError(`A microVM environment can't move to container runtime '${runtime}'`);

    return 'microvm';
  }

  return loadweaverRuntimeForContainer(runtime, {}, env);
}
