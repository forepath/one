/**
 * Container isolation levels for agent (environment) workers.
 *
 * - `standard`: Docker's default OCI runtime (`runc`). Shares the host kernel; this is the setup every
 *   agent manager supported before isolation levels existed and the mandatory floor of every host.
 * - `sandboxed`: gVisor (`runsc`, systrap platform) registered as a dedicated Docker runtime. Workloads
 *   run on gVisor's userspace application kernel; only offered when the runtime passes the probe.
 *
 * Levels are ranked; a higher rank means stronger isolation.
 */
export type IsolationLevel = 'standard' | 'sandboxed';

export const ISOLATION_LEVELS: readonly IsolationLevel[] = ['standard', 'sandboxed'] as const;

export const ISOLATION_LEVEL_RANK: Readonly<Record<IsolationLevel, number>> = {
  standard: 1,
  sandboxed: 2,
};

/** Runtime state of an isolation level on this host (derived from real probes, never from config alone). */
export type IsolationRuntimeState =
  | 'ready'
  | 'unsupported'
  | 'installation-failed'
  | 'probe-failed'
  | 'disabled-by-admin';

export const ISOLATION_RUNTIME_STATES: readonly IsolationRuntimeState[] = [
  'ready',
  'unsupported',
  'installation-failed',
  'probe-failed',
  'disabled-by-admin',
] as const;

/** How the effective isolation level of an environment was chosen. */
export type IsolationSelectionSource = 'automatic' | 'user-confirmed' | 'user-override';

/** Docker runtime of the standard level (Docker's built-in default). */
export const STANDARD_ISOLATION_RUNTIME = 'runc';
/** Default Docker runtime name of the sandboxed level (registered by the host preparation). */
export const SANDBOXED_ISOLATION_RUNTIME_DEFAULT = 'runsc-systrap';
/**
 * Default Docker runtime name of the sandboxed level for workers that join their egress guard's
 * network namespace (`runsc --network=host`): gVisor's own network stack (Netstack) would take over
 * the shared namespace's interfaces and bypass the guard's netfilter rules and loopback proxy, so
 * guarded sandboxed workers use the namespace's kernel network stack, which the guard controls.
 */
export const SANDBOXED_SHARED_NETNS_ISOLATION_RUNTIME_DEFAULT = 'runsc-systrap-hostnet';

/** Stable reason codes reported alongside non-ready isolation states. */
export const IsolationReasonCode = {
  RUNTIME_NOT_REGISTERED: 'E_RUNTIME_NOT_REGISTERED',
  DOCKER_UNAVAILABLE: 'E_DOCKER_BASELINE_UNAVAILABLE',
  RUNC_PROBE_FAILED: 'E_RUNC_PROBE_FAILED',
  PROBE_PENDING: 'E_PROBE_PENDING',
  PROBE_IMAGE_UNAVAILABLE: 'E_PROBE_IMAGE_UNAVAILABLE',
  PROBE_START_FAILED: 'E_PROBE_START_FAILED',
  PROBE_EXEC_FAILED: 'E_PROBE_EXEC_FAILED',
  PROBE_FILESYSTEM_FAILED: 'E_PROBE_FILESYSTEM_FAILED',
  PROBE_LOGS_FAILED: 'E_PROBE_LOGS_FAILED',
  PROBE_RUNTIME_MISMATCH: 'E_PROBE_RUNTIME_MISMATCH',
  PROBE_TIMEOUT: 'E_PROBE_TIMEOUT',
  SHARED_NETNS_FAILED: 'E_SHARED_NETNS_FAILED',
  SHARED_NETNS_RUNTIME_NOT_REGISTERED: 'E_SHARED_NETNS_RUNTIME_NOT_REGISTERED',
  REPEATED_RUNTIME_FAILURES: 'E_REPEATED_RUNTIME_FAILURES',
  DISABLED_BY_ADMIN: 'E_DISABLED_BY_ADMIN',
} as const;

export type IsolationReasonCode = (typeof IsolationReasonCode)[keyof typeof IsolationReasonCode];

const DEFAULT_PROBE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MIN_PROBE_INTERVAL_MS = 60 * 1000;
const DEFAULT_PROBE_TIMEOUT_MS = 90 * 1000;
const DEFAULT_FAILURE_THRESHOLD = 3;

function readEnv(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]?.trim();

  return value ? value : undefined;
}

function readPositiveInt(env: NodeJS.ProcessEnv, key: string, fallback: number, min = 1): number {
  const raw = readEnv(env, key);
  const parsed = raw ? parseInt(raw, 10) : NaN;

  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
}

/**
 * Docker runtime name of the sandboxed level (`AGENT_SANDBOX_RUNTIME`, default `runsc-systrap`).
 * Restricted to a conservative charset so it can never smuggle options into Docker requests.
 */
export function resolveSandboxedIsolationRuntime(env: NodeJS.ProcessEnv = process.env): string {
  const configured = readEnv(env, 'AGENT_SANDBOX_RUNTIME');

  return configured && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(configured)
    ? configured
    : SANDBOXED_ISOLATION_RUNTIME_DEFAULT;
}

/**
 * Docker runtime name of the sandboxed level for workers sharing their egress guard's network
 * namespace (`AGENT_SANDBOX_SHARED_NETNS_RUNTIME`, default `runsc-systrap-hostnet`).
 */
export function resolveSandboxedSharedNetnsIsolationRuntime(env: NodeJS.ProcessEnv = process.env): string {
  const configured = readEnv(env, 'AGENT_SANDBOX_SHARED_NETNS_RUNTIME');

  return configured && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(configured)
    ? configured
    : SANDBOXED_SHARED_NETNS_ISOLATION_RUNTIME_DEFAULT;
}

/** Administrative switch (`AGENT_ISOLATION_SANDBOX_ENABLED=false` disables the sandboxed level). */
export function isSandboxedIsolationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (readEnv(env, 'AGENT_ISOLATION_SANDBOX_ENABLED') ?? 'true').toLowerCase() !== 'false';
}

/** Background re-probe switch (`AGENT_ISOLATION_PROBE_ENABLED=false` probes only on demand / startup). */
export function isIsolationProbeSchedulerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (readEnv(env, 'AGENT_ISOLATION_PROBE_ENABLED') ?? 'true').toLowerCase() !== 'false';
}

/** Periodic re-probe interval (`AGENT_ISOLATION_PROBE_INTERVAL_MS`, default 6h, min 1min). */
export function resolveIsolationProbeIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  return readPositiveInt(env, 'AGENT_ISOLATION_PROBE_INTERVAL_MS', DEFAULT_PROBE_INTERVAL_MS, MIN_PROBE_INTERVAL_MS);
}

/** Upper bound for a single runtime probe (`AGENT_ISOLATION_PROBE_TIMEOUT_MS`, default 90s). */
export function resolveIsolationProbeTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  return readPositiveInt(env, 'AGENT_ISOLATION_PROBE_TIMEOUT_MS', DEFAULT_PROBE_TIMEOUT_MS, 5_000);
}

/** Consecutive sandboxed runtime failures that trigger a re-probe (`AGENT_ISOLATION_FAILURE_THRESHOLD`, default 3). */
export function resolveIsolationFailureThreshold(env: NodeJS.ProcessEnv = process.env): number {
  return readPositiveInt(env, 'AGENT_ISOLATION_FAILURE_THRESHOLD', DEFAULT_FAILURE_THRESHOLD);
}

/**
 * Image used for runtime probes: `AGENT_ISOLATION_PROBE_IMAGE`, otherwise the worker image actually used
 * for environments, so the probe exercises the real worker image contract.
 */
export function resolveIsolationProbeImage(env: NodeJS.ProcessEnv = process.env): string {
  return (
    readEnv(env, 'AGENT_ISOLATION_PROBE_IMAGE') ??
    readEnv(env, 'OPENCODE_AGENT_DOCKER_IMAGE') ??
    readEnv(env, 'AGENT_DEFAULT_IMAGE') ??
    'ghcr.io/forepath/agenstra-manager-worker:latest'
  );
}

/** Container label marking short-lived isolation probe containers (value `1`). */
export const ISOLATION_PROBE_LABEL = 'io.agenstra.isolation-probe';
/** Docker volume / container name prefix of isolation probes. */
export const ISOLATION_PROBE_NAME_PREFIX = 'agenstra-isolation-probe-';
