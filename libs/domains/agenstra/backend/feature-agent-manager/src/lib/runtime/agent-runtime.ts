import type { EffectiveEgressPolicy } from '@forepath/agenstra/shared/util-opencode-config';
import type { ContainerStats } from 'dockerode';

import type { IsolationReasonCode } from '../constants/container-isolation.constants';

/**
 * Where agent environments run (section 4 of the Loadweaver plan): one runtime per agent manager, i.e. per
 * workspace, chosen by `AGENT_RUNTIME`.
 * - `docker`: the Docker host the manager runs on (incl. the per-agent Squid egress guard), unchanged;
 * - `loadweaver`: Loadweaver deployments in a per-workspace project, egress filtered by Loadweaver's node proxies.
 */
export type AgentRuntimeKind = 'docker' | 'loadweaver';

export const AGENT_RUNTIME_KINDS: readonly AgentRuntimeKind[] = ['docker', 'loadweaver'];

/** `AGENT_RUNTIME` (default `docker`); anything else is a configuration error. */
export function resolveAgentRuntimeKind(env: NodeJS.ProcessEnv = process.env): AgentRuntimeKind {
  const value = (env['AGENT_RUNTIME'] ?? 'docker').trim().toLowerCase() || 'docker';

  if (!(AGENT_RUNTIME_KINDS as readonly string[]).includes(value)) {
    throw new Error(`AGENT_RUNTIME must be one of ${AGENT_RUNTIME_KINDS.join(', ')} (got '${value}')`);
  }

  return value as AgentRuntimeKind;
}

/** How environment changes are applied to a container (see {@link AgentRuntime.updateContainer}). */
export type EnvironmentApplyStrategy = 'restart' | 'recreate';

export interface DockerHostInfo {
  serverVersion: string | null;
  kernelVersion: string | null;
  defaultRuntime: string | null;
  /** Registered runtimes (name -> binary path / runtime type). */
  runtimes: Record<string, string | null>;
  /**
   * Arguments of registered runtimes as reported by Docker (name -> `runtimeArgs`, e.g.
   * `['--platform=kvm', '--network=host']`); `null` when Docker reports none. Runtimes registered as a
   * containerd shim (`runtimeType`, no `path`) are omitted: their options live in the shim configuration.
   */
  runtimeArgs: Record<string, string[] | null>;
}

export interface IsolationProbeOptions {
  /** Runtime requested for the probe container; omitted = Docker's default runtime. */
  runtime?: string;
  /** Runtime the probe container must report (defaults to `runtime`). */
  expectedRuntime?: string;
  image: string;
  timeoutMs: number;
  /** Also verify the egress guard topology (joining a namespace owned by a default-runtime container). */
  sharedNetworkNamespace?: boolean;
  /** Runtime used for the shared-namespace member (defaults to `runtime`). */
  sharedNetworkNamespaceRuntime?: string;
}

export type IsolationProbeResult =
  | { ok: true; gvisorKernelDetected?: boolean }
  | { ok: false; reasonCode: IsolationReasonCode; reason: string };

/** Container statistics in Docker's shape (the console computes CPU / memory / network from it). */
export type AgentContainerStats = ContainerStats;

export interface AgentContainerCreateOptions {
  image?: string;
  env?: Record<string, string | undefined>;
  volumes?: Array<{ hostPath: string; containerPath: string; readOnly?: boolean }>;
  ports?: Array<{ containerPort: number; hostPort?: number; hostIp?: string; protocol?: 'tcp' | 'udp' }>;
  network?: string;
  /**
   * Join another container's network namespace (`container:<id>`, e.g. the egress guard).
   * Ports are published on (and `network` belongs to) the namespace owner instead.
   */
  sharedNetworkContainerId?: string;
  capDrop?: string[];
  /**
   * Docker runtime of the container (container isolation level, e.g. `runc` / `runsc-systrap`).
   * Always set explicitly so the effective isolation never depends on the daemon default.
   */
  runtime?: string;
  /** Container name (`agenstra-worker-<agentId>`); Docker generates one when omitted. */
  name?: string;
  labels?: Record<string, string>;
  /**
   * Run the workload as a KVM microVM (isolation level `microvm`). The image must be a microVM worker image
   * (bridge protocol label); the launcher container runs on runc with `/dev/kvm` and the reduced launcher
   * capability set, and volumes / the managed environment file are mounted below the guest root.
   */
  microvm?: boolean;
  /**
   * Effective egress policy, for runtimes that filter egress themselves ({@link AgentRuntime.egress}): applied
   * together with the environment, so it never runs unfiltered. The Docker host runtime ignores it (the guard
   * sidecar is provisioned before the container).
   */
  egressPolicy?: EffectiveEgressPolicy | null;
}

export interface AgentContainerUpdateOptions {
  env?: Record<string, string | undefined>;
  /**
   * Move the container into another container's network namespace (egress guard).
   * Always recreates the container (network mode is immutable).
   */
  sharedNetworkContainerId?: string;
  capDrop?: string[];
  /**
   * Docker runtime the container must run on (the environment's persisted isolation level).
   * A recreated container always gets it explicitly, so a sandboxed environment can never come
   * back on another runtime. Without it the runtime of the current container is preserved.
   */
  runtime?: string;
}

export interface AgentContainerSummary {
  id: string;
  running: boolean;
  startedAt: Date | null;
  networkMode: string | null;
  labels: Record<string, string>;
}

/** One egress decision reported by a runtime that filters egress itself (aggregated by the collector). */
export interface AgentRuntimeEgressObservation {
  kind: 'web' | 'network' | 'guard';
  decision: 'allowed' | 'blocked' | 'observed' | 'error';
  occurredAt: Date;
  host: string | null;
  rule: string | null;
  method?: string;
  httpStatus?: number;
  url?: string;
  message?: string;
  count: number;
}

/**
 * Egress filtering done by the runtime (Loadweaver: Envoy policies compiled from the effective egress policy)
 * instead of the per-agent guard sidecar. Same policy semantics (modes, allow / deny, URL patterns, network_allow).
 */
export interface AgentRuntimeEgress {
  /** Applies the policy to the environment; resolves with a revision once it is in force. */
  applyPolicy(containerId: string, policy: EffectiveEgressPolicy): Promise<{ revision: string }>;
  /** Egress decisions since the cursor (opaque, runtime-defined); `cursor` is the next one. */
  collectEvents(
    containerId: string,
    cursor: string | null,
  ): Promise<{ observations: AgentRuntimeEgressObservation[]; cursor: string | null }>;
}

/**
 * The runtime of agent environments (containers). Extracted from the Docker host implementation
 * ({@link DockerService} / `DockerHostRuntime`, unchanged behind it); consumers depend on this contract only.
 * Container ids are opaque runtime-defined references.
 */
export abstract class AgentRuntime {
  abstract readonly kind: AgentRuntimeKind;
  /** Set by runtimes that filter egress themselves (no guard sidecar). */
  readonly egress?: AgentRuntimeEgress;

  // Lifecycle.
  abstract createContainer(options: AgentContainerCreateOptions): Promise<string>;
  abstract getEnvironmentApplyStrategy(
    containerId: string,
    expectedRuntime?: string,
  ): Promise<EnvironmentApplyStrategy>;
  abstract updateContainer(containerId: string, options: AgentContainerUpdateOptions): Promise<string>;
  abstract getContainerEnvironmentMap(containerId: string): Promise<Record<string, string>>;
  abstract deleteContainer(containerId: string): Promise<void>;
  abstract startContainer(containerId: string): Promise<void>;
  abstract stopContainer(containerId: string): Promise<void>;
  abstract restartContainer(containerId: string): Promise<void>;
  abstract renameContainerIfNeeded(
    containerId: string,
    name: string,
  ): Promise<'renamed' | 'unchanged' | 'conflict' | 'missing'>;
  abstract removeContainersByImageNameSubstring(imageSubstrings: string[]): Promise<number>;
  abstract ensureImageExists(image: string, onProgress?: (fraction: number) => void): Promise<void>;
  abstract ensureNetworkExists(name: string, driver?: string): Promise<void>;

  // Exec.
  abstract sendCommandToContainer(
    containerId: string,
    command: string | string[],
    input?: string | string[],
    checkExitCode?: boolean,
    options?: { user?: string; env?: string[] },
  ): Promise<string>;
  abstract startStreamingExec(
    containerId: string,
    command: string[],
    onLine: (line: string) => void,
  ): Promise<{ stop: () => Promise<void> }>;
  abstract getContainerHomeDirectory(containerId: string): Promise<string>;

  // Files.
  abstract readFileBytesFromContainer(
    containerId: string,
    filePath: string,
    options: { user: string; maxBytes: number },
  ): Promise<Buffer>;
  abstract putFilesIntoContainer(
    containerId: string,
    targetDirectory: string,
    files: ReadonlyArray<{ name: string; content: string | Buffer; mode?: number }>,
  ): Promise<void>;

  // Observation.
  abstract resolveContainerHttpBaseUrl(containerId: string, containerPort: number, depth?: number): Promise<string>;
  abstract getContainerStatus(containerId: string): Promise<{ running: boolean }>;
  abstract getContainerStats(containerId: string): Promise<AgentContainerStats>;
  abstract getContainerLogsSince(containerId: string, sinceSeconds: number, maxBytes?: number): Promise<string>;
  abstract inspectContainerSummary(containerId: string): Promise<AgentContainerSummary | null>;
  abstract listContainersByLabel(
    label: string,
  ): Promise<Array<{ id: string; labels: Record<string, string>; createdAt: Date }>>;

  // Egress guard sidecar (Docker host runtime).
  abstract createEgressGuardContainer(options: {
    name: string;
    image: string;
    labels: Record<string, string>;
    network?: string;
    publishPorts?: readonly number[];
    memoryBytes?: number;
  }): Promise<string>;

  // Isolation.
  abstract getDockerHostInfo(): Promise<DockerHostInfo>;
  abstract getImageId(image: string): Promise<string | null>;
  abstract runIsolationProbe(options: IsolationProbeOptions): Promise<IsolationProbeResult>;
  /**
   * Probes the `microvm` level: usable `/dev/kvm`, then a launcher + guest boot of the microVM worker image
   * (`ownerImage` is the already pulled probe image used for the cheap KVM pre-check).
   */
  abstract runMicrovmProbe(options: { image: string; ownerImage: string; timeoutMs: number }): Promise<IsolationProbeResult>;
  abstract removeStaleIsolationProbes(): Promise<number>;
}
