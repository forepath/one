import {
  AGENSTRA_CONTEXT_MCP_BIN_PATH,
  compileEgressPolicyForLoadweaver,
  loadweaverEgressNetwork,
  type EffectiveEgressPolicy,
  type LoadweaverResourceDocument,
} from '@forepath/agenstra/shared/util-opencode-config';
import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { stringify } from 'yaml';

import {
  AGENT_CONTEXT_MCP_ENABLED_ENV,
  AGENT_CONTEXT_MCP_MANAGER_URL_ENV,
} from '../../constants/agent-context.constants';
import { AGENT_ID_LABEL } from '../../constants/container-naming.constants';
import {
  IsolationReasonCode,
  resolveGvisorLevelRuntimes,
  resolveMicrovmImage,
  STANDARD_ISOLATION_RUNTIME,
} from '../../constants/container-isolation.constants';
import {
  AGENT_ENVIRONMENT_FILE_PATH,
  assertValidEnvironmentVariableName,
  parseEnvironmentFile,
  serializeEnvironmentFile,
} from '../../utils/agent-environment-file.utils';
import { parseShellCommand } from '../../utils/shell-words.utils';
import {
  AgentRuntime,
  type AgentContainerCreateOptions,
  type AgentContainerStats,
  type AgentContainerSummary,
  type AgentContainerUpdateOptions,
  type AgentRuntimeEgress,
  type AgentRuntimeEgressObservation,
  type DockerHostInfo,
  type EnvironmentApplyStrategy,
  type IsolationProbeOptions,
  type IsolationProbeResult,
} from '../agent-runtime';

import {
  ENVIRONMENT_DEPLOYMENT_PREFIX,
  ENVIRONMENT_SERVICE,
  environmentDeployment,
  environmentDocument,
  environmentSecret,
  MICROVM_ENVIRONMENT_SIZE_DEFAULT,
  parseEnvironmentCompose,
  type EnvironmentSpec,
  type MicrovmEnvironmentSize,
} from './environment-compose';
import {
  isolationLevelOfContainerRuntime,
  LOADWEAVER_RUNTIME_FOR_LEVEL,
  loadweaverRuntimeForContainer,
  loadweaverRuntimeForUpdate,
  type LoadweaverEnvironmentRuntime,
} from './isolation-mapping';
import {
  LoadweaverApiError,
  LoadweaverClient,
  type LoadweaverDeploymentStatus,
  type LoadweaverIsolationCapabilities,
  type LoadweaverIsolationLevelCapability,
} from './loadweaver-client';

/** Image label of workers bundling the context MCP server (`AGENT_CONTEXT_MCP_IMAGE_LABEL`). */
const LOADWEAVER_CONTEXT_MCP_IMAGE_LABEL = 'io.agenstra.context-mcp';

/** Container ids of this runtime: `lw:<deployment>`. */
export const LOADWEAVER_CONTAINER_PREFIX = 'lw:';
/** How long a new / started environment may take to run (image pull, placement, volume). */
const START_TIMEOUT_MS = 15 * 60_000;
const POLL_MS = 2_000;
/** Egress events per collection. */
const EVENTS_PAGE = 500;

/** Loadweaver replica states of a running container (`unhealthy` still runs; OpenCode's health is checked apart). */
const RUNNING_STATES = new Set(['running', 'healthy', 'unhealthy']);

/** How long the control plane's aggregated isolation capabilities are reused (probes of all four levels share one). */
const CAPABILITIES_CACHE_MS = 60_000;

/**
 * Guest size of microVM environments (`LOADWEAVER_ENVIRONMENT_MICROVM_CPUS` / `LOADWEAVER_ENVIRONMENT_MICROVM_MEMORY`)
 * and their CPU reservation (`LOADWEAVER_ENVIRONMENT_MICROVM_CPU_RESERVATION`, default the CPU limit; > 0 and at most
 * the limit, anything else is a configuration error thrown at startup). The memory is always fully reserved.
 */
export function loadweaverMicrovmSize(env: NodeJS.ProcessEnv = process.env): MicrovmEnvironmentSize {
  const raw = env['LOADWEAVER_ENVIRONMENT_MICROVM_CPUS']?.trim();
  const memory = env['LOADWEAVER_ENVIRONMENT_MICROVM_MEMORY']?.trim();
  const reservation = env['LOADWEAVER_ENVIRONMENT_MICROVM_CPU_RESERVATION']?.trim();
  const cpus = raw && /^\d+(\.\d+)?$/.test(raw) && Number(raw) > 0 ? raw : MICROVM_ENVIRONMENT_SIZE_DEFAULT.cpus;

  if (
    reservation &&
    !(/^\d+(\.\d+)?$/.test(reservation) && Number(reservation) > 0 && Number(reservation) <= Number(cpus))
  )
    throw new Error(
      `LOADWEAVER_ENVIRONMENT_MICROVM_CPU_RESERVATION must be a CPU count > 0 and at most the CPU limit ${cpus} (LOADWEAVER_ENVIRONMENT_MICROVM_CPUS), got '${reservation}'`,
    );

  return {
    cpus,
    memory: memory && /^\d+(\.\d+)?[kKmMgG]?[bB]?$/.test(memory) ? memory : MICROVM_ENVIRONMENT_SIZE_DEFAULT.memory,
    cpuReservation: reservation || cpus,
  };
}

/**
 * Manager API port(s) environments must always reach (the agent context MCP at `AGENT_CONTEXT_MCP_MANAGER_URL`, the
 * Loadweaver equivalent of the egress guard's platform allows); none while the context MCP is disabled.
 */
export function loadweaverManagerPorts(env: NodeJS.ProcessEnv = process.env): number[] {
  if (env[AGENT_CONTEXT_MCP_ENABLED_ENV]?.trim().toLowerCase() === 'false') return [];

  const raw = env[AGENT_CONTEXT_MCP_MANAGER_URL_ENV]?.trim();

  if (!raw) return [];

  try {
    const url = new URL(raw);

    if (url.protocol !== 'http:' && url.protocol !== 'https:') return [];

    return [url.port ? Number.parseInt(url.port, 10) : url.protocol === 'https:' ? 443 : 80];
  } catch {
    return [];
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Splits stdout into trimmed, non-empty lines (the Docker runtime's line semantics). */
class LineSplitter {
  private rest = '';

  constructor(private readonly onLine: (line: string) => void) {}

  push(chunk: Buffer): void {
    const parts = (this.rest + chunk.toString('utf8')).split('\n');

    this.rest = parts.pop() ?? '';

    for (const line of parts) if (line.trim()) this.onLine(line.trim());
  }

  end(): void {
    if (this.rest.trim()) this.onLine(this.rest.trim());

    this.rest = '';
  }
}

/**
 * Agent environments on a Loadweaver cluster (Loadweaver plan, section 4 step 2): each environment is one Deployment
 * (compose, `x-loadweaver.runtime` = the isolation level 1:1, `isolation-mapping.ts`; microVMs run Agenstra's microVM
 * image as a bundled microVM) in the workspace's project, created / changed /
 * deleted through plan + apply (source `api`) with a project-scoped operator PAT. The manager reaches OpenCode and
 * VNC through the environment's service address (standing project policy, manager → environments); commands run over
 * Loadweaver's machine exec channel (`live:exec`), files go through `/live/files`, logs / stats come from the logs and
 * metrics APIs. Egress filtering is Loadweaver's node proxy, configured from Agenstra's effective egress policy
 * ({@link compileEgressPolicyForLoadweaver}); its decisions come back from the logs API.
 */
@Injectable()
export class LoadweaverRuntime extends AgentRuntime implements OnModuleDestroy {
  readonly kind = 'loadweaver' as const;
  override readonly egress: AgentRuntimeEgress = {
    applyPolicy: (containerId, policy) => this.applyEgressPolicy(containerId, policy),
    collectEvents: (containerId, cursor) => this.collectEgressEvents(containerId, cursor),
  };

  private readonly logger = new Logger(LoadweaverRuntime.name);
  /** Environment files (the processes' environment) by deployment; the secret itself is write-only. */
  private readonly environments = new Map<string, Record<string, string>>();
  /** Image capability labels by `<deployment>@<image>` (see {@link imageLabels}). */
  private readonly imageLabelCache = new Map<string, Record<string, string>>();

  /** Size of new microVM environments, validated at startup (an invalid CPU reservation fails the manager's start). */
  private readonly microvmSize: MicrovmEnvironmentSize;

  constructor(private readonly client: LoadweaverClient) {
    super();
    this.microvmSize = loadweaverMicrovmSize();
  }

  onModuleDestroy(): void {
    this.client.close();
  }

  // Ids.

  private deployment(containerId: string): string {
    if (!containerId.startsWith(LOADWEAVER_CONTAINER_PREFIX))
      throw new NotFoundException(`Container with ID '${containerId}' not found`);

    const deployment = containerId.slice(LOADWEAVER_CONTAINER_PREFIX.length);

    if (!deployment.startsWith(ENVIRONMENT_DEPLOYMENT_PREFIX) || !/^[a-z0-9-]{1,63}$/.test(deployment))
      throw new NotFoundException(`Container with ID '${containerId}' not found`);

    return deployment;
  }

  private replica(deployment: string): string {
    return `${this.client.project}/${deployment}/${ENVIRONMENT_SERVICE}/0`;
  }

  private async spec(deployment: string): Promise<EnvironmentSpec> {
    const resource = await this.client.getResource<{ spec: { compose: string } }>('Deployment', deployment);
    const spec = resource ? parseEnvironmentCompose(resource.spec.compose, this.client.config.volumeSize) : null;

    if (!spec) throw new NotFoundException(`Container with ID '${LOADWEAVER_CONTAINER_PREFIX}${deployment}' not found`);

    return spec;
  }

  private async status(deployment: string): Promise<LoadweaverDeploymentStatus> {
    const status = await this.client.deploymentStatus(deployment);

    if (!status)
      throw new NotFoundException(`Container with ID '${LOADWEAVER_CONTAINER_PREFIX}${deployment}' not found`);

    return status;
  }

  private async waitRunning(deployment: string): Promise<void> {
    const deadline = Date.now() + START_TIMEOUT_MS;

    for (;;) {
      const replica = (await this.client.deploymentStatus(deployment))?.replicas[0];

      if (replica && RUNNING_STATES.has(replica.state)) return;

      if (replica && ['failed', 'exited'].includes(replica.state) && replica.message)
        throw new Error(`environment ${deployment} failed to start: ${replica.message}`);

      if (Date.now() > deadline) throw new Error(`environment ${deployment} did not start within 15 minutes`);

      await sleep(POLL_MS);
    }
  }

  /** Applies the deployment (and other resources) in one plan. */
  private async apply(
    documents: LoadweaverResourceDocument[],
    extra: Parameters<LoadweaverClient['applyChange']>[0] = {},
  ) {
    return await this.client.applyChange({
      ...(documents.length > 0 ? { documents: documents.map((d) => stringify(d)).join('---\n') } : {}),
      ...extra,
    });
  }

  private sanitize(env: Record<string, string | undefined>): Record<string, string> {
    const result: Record<string, string> = {};

    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) continue;

      try {
        assertValidEnvironmentVariableName(key);
      } catch {
        this.logger.warn('Skipping environment variable with an invalid name');
        continue;
      }

      if (value.includes('\0')) {
        this.logger.warn(`Skipping environment variable ${key}: value contains a NUL character`);
        continue;
      }

      result[key] = value;
    }

    return result;
  }

  /** Stores the environment file as the deployment's secret; returns its version. */
  private async storeEnvironment(deployment: string, env: Record<string, string>): Promise<number> {
    const version = await this.client.putSecret(
      environmentSecret(deployment),
      serializeEnvironmentFile(env).toString('utf-8'),
    );

    this.environments.set(deployment, env);

    return version;
  }

  // Lifecycle.

  async createContainer(options: AgentContainerCreateOptions): Promise<string> {
    const agentId = options.labels?.[AGENT_ID_LABEL] ?? options.name?.replace(/^agenstra-worker-/, '') ?? '';
    const deployment = environmentDeployment(agentId);
    const env = this.sanitize({ ...(options.env ?? {}) });
    const workspace = (options.volumes ?? []).find((v) => !v.readOnly);
    const egress = options.egressPolicy
      ? compileEgressPolicyForLoadweaver(options.egressPolicy, {
          project: this.client.project,
          deployment,
          managerPorts: loadweaverManagerPorts(),
        })
      : null;

    if (egress?.issues.length) throw new BadRequestException(`Egress policy: ${egress.issues.join('; ')}`);

    // Resolved before anything is stored: an unknown isolation level is refused, never downgraded. Whether the
    // cluster can run it is the plan's answer (exact level, no fallback): a failed plan fails the creation.
    const runtime = loadweaverRuntimeForContainer(options.runtime ?? STANDARD_ISOLATION_RUNTIME, {
      microvm: options.microvm,
    });
    const secretVersion = await this.storeEnvironment(deployment, env);
    const spec: EnvironmentSpec = {
      // A microVM environment always runs a microVM image (never the plain worker image as a generic guest).
      image:
        options.image ||
        (runtime === 'microvm'
          ? resolveMicrovmImage()
          : process.env['AGENT_DEFAULT_IMAGE'] || 'ghcr.io/forepath/agenstra-manager-worker:latest'),
      workspacePath: workspace?.containerPath ?? '/app',
      runtime,
      labels: options.labels ?? {},
      network: loadweaverEgressNetwork(options.egressPolicy?.mode ?? 'off'),
      capDrop: options.capDrop ?? [],
      secretVersion,
      replicas: 1,
      volumeSize: this.client.config.volumeSize,
      // Agenstra's microVM image (the caller passes it) as a bundled microVM, sized for the worker.
      ...(runtime === 'microvm' ? { microvm: this.microvmSize } : {}),
    };

    try {
      // The environment and its egress policies in one plan: it never runs unfiltered.
      await this.apply([environmentDocument(this.client.project, deployment, spec), ...(egress?.documents ?? [])]);
      await this.waitRunning(deployment);
    } catch (error) {
      await this.deleteContainer(`${LOADWEAVER_CONTAINER_PREFIX}${deployment}`).catch(() => undefined);

      throw error;
    }

    return `${LOADWEAVER_CONTAINER_PREFIX}${deployment}`;
  }

  /** Every change is a new container version through a plan (the workspace volume stays). */
  async getEnvironmentApplyStrategy(containerId: string): Promise<EnvironmentApplyStrategy> {
    await this.spec(this.deployment(containerId));

    return 'recreate';
  }

  async updateContainer(containerId: string, options: AgentContainerUpdateOptions): Promise<string> {
    const deployment = this.deployment(containerId);
    const spec = await this.spec(deployment);
    // Checked first: an unknown or impossible level change changes nothing (no new secret version either).
    const runtime = options.runtime ? loadweaverRuntimeForUpdate(spec.runtime, options.runtime) : undefined;
    let changed = false;

    if (options.env) {
      const current = await this.getContainerEnvironmentMap(containerId);
      const next = { ...current };

      for (const [key, value] of Object.entries(options.env)) {
        if (value === undefined) delete next[key];
        else next[key] = value;
      }

      spec.secretVersion = await this.storeEnvironment(deployment, this.sanitize(next));
      changed = true;
    }

    if (runtime) {
      changed ||= runtime !== spec.runtime;
      spec.runtime = runtime;
    }

    if (options.capDrop) {
      spec.capDrop = options.capDrop;
      changed = true;
    }

    if (changed) {
      await this.apply([environmentDocument(this.client.project, deployment, spec)]);

      if (spec.replicas > 0) await this.waitRunning(deployment);
    }

    return containerId;
  }

  async getContainerEnvironmentMap(containerId: string): Promise<Record<string, string>> {
    const deployment = this.deployment(containerId);
    const cached = this.environments.get(deployment);

    if (cached) return { ...cached };

    // After a manager restart: read the mounted env file (the secret API is write-only).
    const file = await this.client.exec(this.replica(deployment), ['cat', '--', AGENT_ENVIRONMENT_FILE_PATH], {
      user: '0',
    });

    if (file.exitCode !== 0)
      throw new Error(file.error ?? file.stderr.toString('utf8').trim() ?? 'env file unreadable');

    const env = parseEnvironmentFile(file.stdout);

    this.environments.set(deployment, env);

    return { ...env };
  }

  async deleteContainer(containerId: string): Promise<void> {
    const deployment = this.deployment(containerId);
    const policies = (await this.client.listResources('Policy')).filter(
      (p) => p.metadata.name === `${deployment}-egress` || p.metadata.name.startsWith(`${deployment}-egress-`),
    );
    const exists = (await this.client.getResource('Deployment', deployment)) !== null;

    if (exists || policies.length > 0)
      await this.apply([], {
        delete: [
          ...(exists ? [{ kind: 'Deployment', name: deployment, project: this.client.project }] : []),
          ...policies.map((p) => ({ kind: 'Policy', name: p.metadata.name, project: this.client.project })),
        ],
      });

    await this.client.deleteSecret(environmentSecret(deployment));
    this.environments.delete(deployment);
  }

  private async scale(containerId: string, replicas: 0 | 1): Promise<void> {
    const deployment = this.deployment(containerId);
    const spec = await this.spec(deployment);

    if (spec.replicas !== replicas) {
      spec.replicas = replicas;
      await this.apply([environmentDocument(this.client.project, deployment, spec)]);
    }

    if (replicas === 1) await this.waitRunning(deployment);
  }

  async startContainer(containerId: string): Promise<void> {
    await this.scale(containerId, 1);
  }

  async stopContainer(containerId: string): Promise<void> {
    await this.scale(containerId, 0);
  }

  /** A stop and a start (the workspace volume stays; the replica may come back on another node). */
  async restartContainer(containerId: string): Promise<void> {
    await this.scale(containerId, 0);
    await this.scale(containerId, 1);
  }

  async renameContainerIfNeeded(containerId: string): Promise<'renamed' | 'unchanged' | 'conflict' | 'missing'> {
    return (await this.client.deploymentStatus(this.deployment(containerId))) ? 'unchanged' : 'missing';
  }

  async removeContainersByImageNameSubstring(): Promise<number> {
    return 0;
  }

  /** Loadweaver pins and pulls the image on the node when the plan is applied. */
  async ensureImageExists(_image: string, onProgress?: (fraction: number) => void): Promise<void> {
    onProgress?.(1);
  }

  async ensureNetworkExists(): Promise<void> {
    return;
  }

  // Exec. MicroVM environments need no rewrite here: the node agent runs every machine exec into a microVM replica
  // inside the guest through the launcher's `vm-exec` (Loadweaver M7 W7, `toMicrovmExecOptions`: user, working
  // directory, env names as arguments, values in the exec env), so commands, users and paths are the guest's. Wrapping
  // here as well would run `vm-exec` inside the guest.

  private async execEnv(containerId: string, extra?: string[]): Promise<string[]> {
    const env = await this.getContainerEnvironmentMap(containerId).catch(() => ({}) as Record<string, string>);

    return [...Object.entries(env).map(([k, v]) => `${k}=${v}`), ...(extra ?? [])];
  }

  private notFound(containerId: string, error?: string): Error {
    return /not found|unknown replica|doesn't run/i.test(error ?? '')
      ? new NotFoundException(`Container with ID '${containerId}' not found`)
      : new Error(error ?? 'exec failed');
  }

  async sendCommandToContainer(
    containerId: string,
    command: string | string[],
    input?: string | string[],
    checkExitCode = false,
    options?: { user?: string; env?: string[] },
  ): Promise<string> {
    const deployment = this.deployment(containerId);
    const argv = Array.isArray(command) ? command : parseShellCommand(command.trim());
    // Same input handling as the Docker runtime: literal `\n` become newlines, every line ends with one.
    const lines =
      input === undefined
        ? []
        : (Array.isArray(input) ? input : [input]).flatMap((line) => line.replace(/\\n/g, '\n').split(/\r?\n/));
    const stdin = Buffer.from(lines.map((l) => (l.endsWith('\n') ? l : `${l}\n`)).join(''), 'utf8');
    const output: Buffer[] = [];
    const handle = await this.client.startExec(
      this.replica(deployment),
      argv,
      { ...(options?.user ? { user: options.user } : {}), env: await this.execEnv(containerId, options?.env) },
      // Interleaved in arrival order, like Docker's combined output.
      { stdout: (d) => output.push(d), stderr: (d) => output.push(d) },
    );

    if (stdin.length > 0) handle.write(stdin);

    handle.end();

    const result = await handle.done;
    const text = Buffer.concat(output).toString('utf-8').trim();

    if (result.exitCode === null && result.error) throw this.notFound(containerId, result.error);

    if (checkExitCode && result.exitCode !== 0 && result.exitCode !== null)
      throw new Error(text || `Command failed with exit code ${result.exitCode}`);

    return text;
  }

  async startStreamingExec(
    containerId: string,
    command: string[],
    onLine: (line: string) => void,
  ): Promise<{ stop: () => Promise<void> }> {
    const deployment = this.deployment(containerId);
    const stdout = new LineSplitter(onLine);
    const stderr = new LineSplitter(onLine);
    const handle = await this.client.startExec(
      this.replica(deployment),
      command,
      { env: await this.execEnv(containerId) },
      { stdout: (d) => stdout.push(d), stderr: (d) => stderr.push(d) },
    );

    void handle.done.then(() => (stdout.end(), stderr.end()));

    return {
      stop: async () => {
        handle.kill();
        await handle.done;
      },
    };
  }

  async getContainerHomeDirectory(containerId: string): Promise<string> {
    const deployment = this.deployment(containerId);
    const result = await this.client.exec(
      this.replica(deployment),
      ['sh', '-c', 'printf %s "${HOME:-/home/agenstra}"'],
      {
        user: 'agenstra',
        env: await this.execEnv(containerId),
      },
    );

    if (result.exitCode === null && result.error) throw this.notFound(containerId, result.error);

    return result.stdout.toString('utf8').trim() || '/home/agenstra';
  }

  // Files.

  async readFileBytesFromContainer(
    containerId: string,
    filePath: string,
    options: { user: string; maxBytes: number },
  ): Promise<Buffer> {
    const deployment = this.deployment(containerId);
    // As the user (permissions apply), regular files only, at most one byte beyond the limit (binary-safe channel).
    const result = await this.client.exec(
      this.replica(deployment),
      [
        'sh',
        '-c',
        'if [ ! -e "$1" ]; then echo "cat: $1: No such file or directory" >&2; exit 1; fi; ' +
          'if [ ! -f "$1" ]; then echo "cat: $1: Not a regular file" >&2; exit 1; fi; ' +
          'exec head -c "$2" -- "$1"',
        'sh',
        filePath,
        String(options.maxBytes + 1),
      ],
      { user: options.user, env: await this.execEnv(containerId) },
    );
    const stderr = result.stderr.toString('utf8');

    if (result.exitCode === null && result.error) throw this.notFound(containerId, result.error);

    if (result.exitCode !== 0) {
      if (stderr.includes('No such file') || stderr.includes('not found'))
        throw new NotFoundException(`File not found: ${filePath}`);

      throw new Error(stderr.trim() || `Reading ${filePath} failed with exit code ${result.exitCode}`);
    }

    if (result.stdout.length > options.maxBytes)
      throw new BadRequestException(`File size exceeds maximum allowed size of ${options.maxBytes} bytes`);

    return result.stdout;
  }

  async putFilesIntoContainer(
    containerId: string,
    targetDirectory: string,
    files: ReadonlyArray<{ name: string; content: string | Buffer; mode?: number }>,
  ): Promise<void> {
    const target = `replica:${this.replica(this.deployment(containerId))}`;

    for (const file of files)
      await this.client.writeFile(
        target,
        `${targetDirectory.replace(/\/+$/, '')}/${file.name}`,
        Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content, 'utf8'),
      );
  }

  // Observation.

  async resolveContainerHttpBaseUrl(containerId: string, containerPort: number): Promise<string> {
    const status = await this.status(this.deployment(containerId));
    const service = status.services.find((s) => s.name === ENVIRONMENT_SERVICE);
    const address =
      service?.addressV4 ?? (service?.addressV6 ? `[${service.addressV6}]` : null) ?? status.replicas[0]?.addresses[0];

    if (!address) throw new Error(`environment ${status.deployment} has no address yet`);

    return `http://${address}:${containerPort}`;
  }

  async getContainerStatus(containerId: string): Promise<{ running: boolean }> {
    const status = await this.status(this.deployment(containerId));

    return { running: status.replicas.some((r) => RUNNING_STATES.has(r.state)) };
  }

  /** CPU and memory of the replica from the metrics store, in Docker's stats shape (one CPU of 1e9 ns per second). */
  async getContainerStats(containerId: string): Promise<AgentContainerStats> {
    const replica = this.replica(this.deployment(containerId));
    const latest = async (metric: string): Promise<number> => {
      const result = (await this.client.metrics({
        metric,
        entity: replica,
        from: new Date(Date.now() - 5 * 60_000).toISOString(),
      })) as { series?: { points?: [string, number][] }[] };
      const points = result.series?.[0]?.points ?? [];

      return points.at(-1)?.[1] ?? 0;
    };
    const [cores, memory] = await Promise.all([latest('replica.cpu_cores'), latest('replica.memory_bytes')]);
    const cpu = (total: number) => ({
      cpu_usage: { total_usage: total, percpu_usage: [total], usage_in_kernelmode: 0, usage_in_usermode: total },
      system_cpu_usage: total === 0 ? 0 : 1e9,
      online_cpus: 1,
      throttling_data: { periods: 0, throttled_periods: 0, throttled_time: 0 },
    });

    return {
      read: new Date().toISOString(),
      preread: new Date(Date.now() - 1000).toISOString(),
      cpu_stats: cpu(Math.round(cores * 1e9)),
      precpu_stats: cpu(0),
      memory_stats: { usage: memory, max_usage: memory, limit: 0, stats: {}, failcnt: 0 },
    } as unknown as AgentContainerStats;
  }

  async getContainerLogsSince(containerId: string, sinceSeconds: number, maxBytes = 8 * 1024 * 1024): Promise<string> {
    const { lines } = await this.client.logs({
      sources: 'container',
      project: this.client.project,
      replica: this.replica(this.deployment(containerId)),
      from: new Date(sinceSeconds * 1000).toISOString(),
      order: 'asc',
      limit: '1000',
    });
    let text = '';

    for (const line of lines) {
      const next = `${line.at} ${line.message}\n`;

      if (text.length + next.length > maxBytes) break;

      text += next;
    }

    return text;
  }

  async inspectContainerSummary(containerId: string): Promise<AgentContainerSummary | null> {
    let deployment: string;

    try {
      deployment = this.deployment(containerId);
    } catch {
      return null;
    }

    const status = await this.client.deploymentStatus(deployment);

    if (!status) return null;

    const spec = await this.spec(deployment).catch(() => null);
    const running = status.replicas.some((r) => RUNNING_STATES.has(r.state));

    return {
      id: containerId,
      running,
      startedAt: null,
      networkMode: null,
      labels: { ...(spec && running ? await this.imageLabels(deployment, spec.image) : {}), ...(spec?.labels ?? {}) },
    };
  }

  /**
   * Capability labels of the environment's image, as Docker merges them into a container's labels: Loadweaver's API
   * doesn't expose image labels, so the one the manager needs (`io.agenstra.context-mcp`, the bundled context MCP
   * server of `Dockerfile.worker`) is derived from the image content once per deployment and image.
   */
  private async imageLabels(deployment: string, image: string): Promise<Record<string, string>> {
    const key = `${deployment}@${image}`;
    const cached = this.imageLabelCache.get(key);

    if (cached) return cached;

    let exitCode: number | null = null;

    try {
      ({ exitCode } = await this.client.exec(this.replica(deployment), ['test', '-f', AGENSTRA_CONTEXT_MCP_BIN_PATH], {
        user: '0',
      }));
    } catch {
      // Not answered (replica starting / moving): unknown, asked again next time.
    }

    if (exitCode === null) return {};

    const labels: Record<string, string> = exitCode === 0 ? { [LOADWEAVER_CONTEXT_MCP_IMAGE_LABEL]: '1' } : {};

    this.imageLabelCache.set(key, labels);

    return labels;
  }

  async listContainersByLabel(): Promise<Array<{ id: string; labels: Record<string, string>; createdAt: Date }>> {
    return [];
  }

  /** No guard sidecars: Loadweaver's node proxy filters egress ({@link egress}). */
  async createEgressGuardContainer(): Promise<string> {
    throw new BadRequestException('Egress guard sidecars are not used on Loadweaver (the node proxy filters egress)');
  }

  // Isolation (Loadweaver plan 3.35, M7.5): all four levels map 1:1 to Loadweaver runtimes. A level is ready when at
  // least one schedulable node in the project's placement passed the level's probe — the control plane's aggregated
  // view (`GET /projects/:p/isolation-capabilities`), reused for 60 s so one probe round asks once. Environments
  // still run at exactly their level: no capacity for it fails the plan, and the creation, never a weaker level.

  private capabilitiesCache: { at: number; value: LoadweaverIsolationCapabilities } | null = null;
  private capabilitiesInFlight: Promise<LoadweaverIsolationCapabilities> | null = null;

  /** The control plane's per-level view of the project's placement (cached {@link CAPABILITIES_CACHE_MS}). */
  private async capabilityView(): Promise<LoadweaverIsolationCapabilities> {
    if (this.capabilitiesCache && Date.now() - this.capabilitiesCache.at < CAPABILITIES_CACHE_MS)
      return this.capabilitiesCache.value;

    this.capabilitiesInFlight ??= this.client
      .isolationCapabilities()
      .then((value) => {
        this.capabilitiesCache = { at: Date.now(), value };

        return value;
      })
      .finally(() => (this.capabilitiesInFlight = null));

    return await this.capabilitiesInFlight;
  }

  /**
   * Every level's runtimes, with the runtime arguments the shared gVisor installer registers (so the levels reach
   * their probe, which answers from the control plane's view with its per-node reasons). Fails when the control plane
   * doesn't answer (Agenstra then reports every level as unavailable, like an unreachable Docker daemon).
   */
  async getDockerHostInfo(): Promise<DockerHostInfo> {
    await this.capabilityView();

    const sandboxed = resolveGvisorLevelRuntimes('sandboxed');
    const kvm = resolveGvisorLevelRuntimes('sandboxed-kvm');
    // Same shape as Docker's `runtimeArgs` for runtimes registered by the shared gVisor installer.
    const runtimeArgs: Record<string, string[] | null> = {
      [STANDARD_ISOLATION_RUNTIME]: null,
      [sandboxed.runtime]: ['--platform=systrap'],
      [sandboxed.sharedNetnsRuntime]: ['--platform=systrap', '--network=host'],
      [kvm.runtime]: ['--platform=kvm'],
      [kvm.sharedNetnsRuntime]: ['--platform=kvm', '--network=host'],
    };

    return {
      serverVersion: 'loadweaver',
      kernelVersion: null,
      defaultRuntime: STANDARD_ISOLATION_RUNTIME,
      runtimes: Object.fromEntries(Object.keys(runtimeArgs).map((name) => [name, null])),
      runtimeArgs,
    };
  }

  async getImageId(): Promise<string | null> {
    return null;
  }

  /** A level's probe result from the aggregated view (`gvisorKernelDetected` for the gVisor levels). */
  private async levelProbe(runtime: LoadweaverEnvironmentRuntime): Promise<IsolationProbeResult> {
    let level: LoadweaverIsolationLevelCapability | undefined;

    try {
      level = (await this.capabilityView()).levels[runtime];
    } catch (error) {
      return {
        ok: false,
        reasonCode: IsolationReasonCode.PROBE_START_FAILED,
        reason: `Loadweaver isolation capabilities unavailable: ${(error as Error).message}`.slice(0, 300),
      };
    }

    if (level?.state === 'ready')
      return runtime === 'sandboxed' || runtime === 'sandboxed-kvm'
        ? { ok: true, gvisorKernelDetected: true }
        : { ok: true };

    return {
      ok: false,
      // The control plane reports Agenstra's reason codes (node probes, Loadweaver plan 3.1).
      reasonCode: (level?.reasonCode ?? IsolationReasonCode.RUNTIME_NOT_REGISTERED) as IsolationReasonCode,
      reason:
        `Loadweaver: no schedulable node in project ${this.client.project} runs ${runtime}` +
        (level
          ? ` (${level.state}${level.reason ? `: ${level.reason}` : ''})`
          : ' (not reported by the control plane)'),
    };
  }

  async runIsolationProbe(options: IsolationProbeOptions): Promise<IsolationProbeResult> {
    const name = options.runtime ?? options.expectedRuntime ?? STANDARD_ISOLATION_RUNTIME;
    const level = isolationLevelOfContainerRuntime(name);

    if (!level)
      return {
        ok: false,
        reasonCode: IsolationReasonCode.RUNTIME_NOT_REGISTERED,
        reason: `Container runtime '${name}' has no Loadweaver equivalent`,
      };

    return await this.levelProbe(LOADWEAVER_RUNTIME_FOR_LEVEL[level]);
  }

  /** Ready when a schedulable node in the placement passed the `microvm` probe (its boot probe microVM included). */
  async runMicrovmProbe(): Promise<IsolationProbeResult> {
    return await this.levelProbe('microvm');
  }

  async removeStaleIsolationProbes(): Promise<number> {
    return 0;
  }

  // Egress.

  /**
   * Agenstra's effective egress policy as Loadweaver policies of the environment (plus its egress class label), one
   * plan; policies the environment no longer needs are deleted in the same plan.
   */
  private async applyEgressPolicy(containerId: string, policy: EffectiveEgressPolicy): Promise<{ revision: string }> {
    const deployment = this.deployment(containerId);
    const compiled = compileEgressPolicyForLoadweaver(policy, {
      project: this.client.project,
      deployment,
      managerPorts: loadweaverManagerPorts(),
    });

    if (compiled.issues.length > 0) throw new Error(`Egress policy: ${compiled.issues.join('; ')}`);

    const spec = await this.spec(deployment);
    const names = new Set(compiled.documents.map((d) => d.metadata.name));
    const stale = (await this.client.listResources('Policy')).filter(
      (p) =>
        (p.metadata.name === compiled.prefix || p.metadata.name.startsWith(`${compiled.prefix}-`)) &&
        !names.has(p.metadata.name),
    );
    const documents = [...compiled.documents];

    // Between open and filtered the environment's label changes, so it is recreated (the volume stays).
    if (spec.network !== compiled.network) {
      spec.network = compiled.network;
      documents.unshift(environmentDocument(this.client.project, deployment, spec));
    }

    const plan = await this.apply(documents, {
      ...(stale.length > 0
        ? { delete: stale.map((p) => ({ kind: 'Policy', name: p.metadata.name, project: this.client.project })) }
        : {}),
    });

    return { revision: plan.id };
  }

  /** Egress decisions of the environment from Loadweaver's logs (node proxy access lines attributed to it). */
  private async collectEgressEvents(
    containerId: string,
    cursor: string | null,
  ): Promise<{ observations: AgentRuntimeEgressObservation[]; cursor: string | null }> {
    const deployment = this.deployment(containerId);
    let lines: Awaited<ReturnType<LoadweaverClient['logs']>>['lines'];

    try {
      ({ lines } = await this.client.logs({
        sources: 'proxy',
        project: this.client.project,
        deployment,
        ...(cursor ? { from: cursor } : { from: new Date(Date.now() - 3_600_000).toISOString() }),
        order: 'asc',
        limit: String(EVENTS_PAGE),
      }));
    } catch (error) {
      if (error instanceof LoadweaverApiError && error.status === 404) return { observations: [], cursor };

      throw error;
    }

    const observations: AgentRuntimeEgressObservation[] = [];
    let latest = cursor;

    for (const line of lines) {
      // `from` is inclusive: lines at the cursor were collected last time.
      if (cursor && line.at <= cursor) continue;

      latest = !latest || line.at > latest ? line.at : latest;

      const fields = line.fields ?? {};
      const decision = fields['egressDecision'];

      if (decision !== 'allowed' && decision !== 'blocked' && decision !== 'observed') continue;

      let entry: { method?: string; status?: string | number } = {};

      try {
        entry = JSON.parse(line.message) as typeof entry;
      } catch {
        // not an access line
      }

      const status = Number(entry.status);

      observations.push({
        kind: 'web',
        decision,
        occurredAt: new Date(line.at),
        host: typeof fields['egressHost'] === 'string' ? fields['egressHost'] : null,
        rule: typeof fields['egressRule'] === 'string' ? fields['egressRule'] : null,
        ...(entry.method && entry.method !== '-' ? { method: entry.method } : {}),
        ...(Number.isInteger(status) && status > 0 ? { httpStatus: status } : {}),
        count: 1,
      });
    }

    return { observations, cursor: latest };
  }
}
