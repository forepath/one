import { GVISOR_RUNTIMES, type GvisorPlatform } from '@forepath/shared/backend/util-container-runtime';

/**
 * Container isolation levels for agent (environment) workers.
 *
 * - `standard`: Docker's default OCI runtime (`runc`). Shares the host kernel; this is the setup every
 *   agent manager supported before isolation levels existed and the mandatory floor of every host.
 * - `sandboxed`: gVisor (`runsc`, systrap platform) registered as a dedicated Docker runtime. Workloads
 *   run on gVisor's userspace application kernel; only offered when the runtime passes the probe.
 * - `sandboxed-kvm`: gVisor on its KVM platform (`runsc --platform=kvm`). The application kernel runs
 *   in a hardware-virtualized address space and system calls trap into it through KVM instead of
 *   seccomp; needs `/dev/kvm` on the host and is only offered when its runtime passes the probe.
 * - `microvm`: the workload runs as a KVM microVM with its own guest kernel (libvirt/QEMU inside a hardened
 *   runc launcher container of the `agenstra-manager-worker-microvm` image); needs `/dev/kvm` on the host and
 *   is only offered when a probe microVM boots and passes the full worker contract.
 *
 * Levels are ranked; a higher rank means stronger isolation.
 */
export type IsolationLevel = 'standard' | 'sandboxed' | 'sandboxed-kvm' | 'microvm';

export const ISOLATION_LEVELS: readonly IsolationLevel[] = [
  'standard',
  'sandboxed',
  'sandboxed-kvm',
  'microvm',
] as const;

export const ISOLATION_LEVEL_RANK: Readonly<Record<IsolationLevel, number>> = {
  standard: 1,
  sandboxed: 2,
  'sandboxed-kvm': 3,
  microvm: 4,
};

/** Isolation levels backed by gVisor. */
export type GvisorIsolationLevel = Exclude<IsolationLevel, 'standard' | 'microvm'>;

export const GVISOR_ISOLATION_LEVELS: readonly GvisorIsolationLevel[] = ['sandboxed', 'sandboxed-kvm'] as const;

/** gVisor platform backing each gVisor isolation level. */
export const GVISOR_ISOLATION_LEVEL_PLATFORM: Readonly<Record<GvisorIsolationLevel, GvisorPlatform>> = {
  sandboxed: 'systrap',
  'sandboxed-kvm': 'kvm',
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
export const SANDBOXED_ISOLATION_RUNTIME_DEFAULT = GVISOR_RUNTIMES.systrap.runtime;
/**
 * Default Docker runtime name of the sandboxed level for workers that join their egress guard's
 * network namespace (`runsc --network=host`): gVisor's own network stack (Netstack) would take over
 * the shared namespace's interfaces and bypass the guard's netfilter rules and loopback proxy, so
 * guarded sandboxed workers use the namespace's kernel network stack, which the guard controls.
 */
export const SANDBOXED_SHARED_NETNS_ISOLATION_RUNTIME_DEFAULT = GVISOR_RUNTIMES.systrap.sharedNetnsRuntime;
/** Default Docker runtime name of the sandboxed-kvm level (registered by the host preparation when KVM is available). */
export const SANDBOXED_KVM_ISOLATION_RUNTIME_DEFAULT = GVISOR_RUNTIMES.kvm.runtime;
/** Default sandboxed-kvm runtime for workers sharing their egress guard's network namespace (`--network=host`). */
export const SANDBOXED_KVM_SHARED_NETNS_ISOLATION_RUNTIME_DEFAULT = GVISOR_RUNTIMES.kvm.sharedNetnsRuntime;

/**
 * Machine-readable `code` of the `400` response when a gVisor or microVM environment container could not be
 * started (the environment was not created and is never retried on a weaker runtime).
 */
export const ISOLATION_RUNTIME_FAILURE_CODE = 'E_ISOLATION_RUNTIME_FAILED';

/** Default image of microVM workers (the worker image below `/guest` of a libvirt/QEMU launcher). */
export const MICROVM_IMAGE_DEFAULT = 'ghcr.io/forepath/agenstra-manager-worker-microvm:latest';

/** Container path below which a microVM worker keeps its guest root filesystem (volumes, archives). */
export const MICROVM_GUEST_ROOT = '/guest';

/** Operator-facing description of the microVM level (used in failure messages). */
export const MICROVM_ISOLATION_LEVEL_DESCRIPTION = 'microvm (KVM microVM)';

/**
 * Capabilities of a microVM launcher container (a strict subset of Docker's defaults): virtiofsd needs them to
 * give the guest root normal file semantics and to confine itself to /guest (chroot sandbox); the VMM itself runs
 * unprivileged. Never NET_ADMIN / NET_RAW /
 * SYS_ADMIN: the launcher shares the egress guard's network namespace.
 */
export const MICROVM_LAUNCHER_CAPABILITIES: readonly string[] = [
  'CHOWN',
  'DAC_OVERRIDE',
  'FOWNER',
  'FSETID',
  'SETUID',
  'SETGID',
  'MKNOD',
  'KILL',
  'SETPCAP',
  'SYS_CHROOT',
] as const;

/** Host device every microVM launcher gets (and the only one). */
export const MICROVM_KVM_DEVICE = '/dev/kvm';

/** Operator-facing description of the runtime of a gVisor level (used in failure messages). */
export const GVISOR_ISOLATION_LEVEL_DESCRIPTION: Readonly<Record<GvisorIsolationLevel, string>> = {
  sandboxed: 'sandboxed (gVisor)',
  'sandboxed-kvm': 'sandboxed-kvm (gVisor on KVM)',
};

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
  /** The KVM platform cannot open `/dev/kvm` (no hardware virtualization exposed to the host). */
  KVM_UNAVAILABLE: 'E_KVM_UNAVAILABLE',
  /** A runtime is registered under the expected name but with another gVisor platform / network mode. */
  RUNTIME_MISCONFIGURED: 'E_RUNTIME_MISCONFIGURED',
  /** The configured microVM image does not implement the microVM bridge protocol this manager speaks. */
  MICROVM_IMAGE_UNSUPPORTED: 'E_MICROVM_IMAGE_UNSUPPORTED',
  /** A probe microVM did not boot or its workload contract failed. */
  MICROVM_BOOT_FAILED: 'E_MICROVM_BOOT_FAILED',
} as const;

export type IsolationReasonCode = (typeof IsolationReasonCode)[keyof typeof IsolationReasonCode];

const DEFAULT_PROBE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MIN_PROBE_INTERVAL_MS = 60 * 1000;
const DEFAULT_PROBE_TIMEOUT_MS = 90 * 1000;
const DEFAULT_MICROVM_PROBE_TIMEOUT_MS = 240 * 1000;
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

/** Docker runtime name of the sandboxed-kvm level (`AGENT_SANDBOX_KVM_RUNTIME`, default `runsc-kvm`). */
export function resolveSandboxedKvmIsolationRuntime(env: NodeJS.ProcessEnv = process.env): string {
  const configured = readEnv(env, 'AGENT_SANDBOX_KVM_RUNTIME');

  return configured && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(configured)
    ? configured
    : SANDBOXED_KVM_ISOLATION_RUNTIME_DEFAULT;
}

/**
 * Docker runtime name of the sandboxed-kvm level for workers sharing their egress guard's network
 * namespace (`AGENT_SANDBOX_KVM_SHARED_NETNS_RUNTIME`, default `runsc-kvm-hostnet`).
 */
export function resolveSandboxedKvmSharedNetnsIsolationRuntime(env: NodeJS.ProcessEnv = process.env): string {
  const configured = readEnv(env, 'AGENT_SANDBOX_KVM_SHARED_NETNS_RUNTIME');

  return configured && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(configured)
    ? configured
    : SANDBOXED_KVM_SHARED_NETNS_ISOLATION_RUNTIME_DEFAULT;
}

/** Administrative switch (`AGENT_ISOLATION_SANDBOX_KVM_ENABLED=false` disables the sandboxed-kvm level). */
export function isSandboxedKvmIsolationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (readEnv(env, 'AGENT_ISOLATION_SANDBOX_KVM_ENABLED') ?? 'true').toLowerCase() !== 'false';
}

/** Docker runtimes backing a gVisor isolation level on this manager (Netstack + kernel network stack variant). */
export interface GvisorLevelRuntimes {
  platform: GvisorPlatform;
  runtime: string;
  sharedNetnsRuntime: string;
}

/** Runtimes of a gVisor isolation level, resolved from the environment. */
export function resolveGvisorLevelRuntimes(
  level: GvisorIsolationLevel,
  env: NodeJS.ProcessEnv = process.env,
): GvisorLevelRuntimes {
  return level === 'sandboxed-kvm'
    ? {
        platform: GVISOR_ISOLATION_LEVEL_PLATFORM[level],
        runtime: resolveSandboxedKvmIsolationRuntime(env),
        sharedNetnsRuntime: resolveSandboxedKvmSharedNetnsIsolationRuntime(env),
      }
    : {
        platform: GVISOR_ISOLATION_LEVEL_PLATFORM[level],
        runtime: resolveSandboxedIsolationRuntime(env),
        sharedNetnsRuntime: resolveSandboxedSharedNetnsIsolationRuntime(env),
      };
}

/** Administrative switch of a gVisor isolation level. */
export function isGvisorIsolationLevelEnabled(
  level: GvisorIsolationLevel,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return level === 'sandboxed-kvm' ? isSandboxedKvmIsolationEnabled(env) : isSandboxedIsolationEnabled(env);
}

/** Environment variable of a gVisor level's administrative switch (for operator-facing reasons). */
export function gvisorIsolationLevelSwitch(level: GvisorIsolationLevel): string {
  return level === 'sandboxed-kvm' ? 'AGENT_ISOLATION_SANDBOX_KVM_ENABLED' : 'AGENT_ISOLATION_SANDBOX_ENABLED';
}

/** Administrative switch (`AGENT_ISOLATION_MICROVM_ENABLED=false` disables the microvm level). */
export function isMicrovmIsolationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (readEnv(env, 'AGENT_ISOLATION_MICROVM_ENABLED') ?? 'true').toLowerCase() !== 'false';
}

/**
 * Image of microVM workers (`AGENT_MICROVM_IMAGE`, default {@link MICROVM_IMAGE_DEFAULT}). It is used for every
 * microVM environment instead of the agent provider's worker image and is also the microvm probe image.
 */
export function resolveMicrovmImage(env: NodeJS.ProcessEnv = process.env): string {
  return readEnv(env, 'AGENT_MICROVM_IMAGE') ?? MICROVM_IMAGE_DEFAULT;
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

/**
 * Upper bound for the microvm probe (`AGENT_ISOLATION_MICROVM_PROBE_TIMEOUT_MS`, default 4min): it boots a
 * microVM, which takes considerably longer than a container start, especially under nested virtualization.
 */
export function resolveMicrovmProbeTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  return readPositiveInt(env, 'AGENT_ISOLATION_MICROVM_PROBE_TIMEOUT_MS', DEFAULT_MICROVM_PROBE_TIMEOUT_MS, 30_000);
}

/** Consecutive runtime failures of a gVisor or microVM level that trigger a re-probe (`AGENT_ISOLATION_FAILURE_THRESHOLD`, default 3). */
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
