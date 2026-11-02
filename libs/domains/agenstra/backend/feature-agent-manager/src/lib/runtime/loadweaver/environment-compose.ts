import {
  LOADWEAVER_API_VERSION,
  LOADWEAVER_EGRESS_NETWORK_LABEL,
  LOADWEAVER_ROLE_LABEL,
  type LoadweaverEgressNetwork,
  type LoadweaverResourceDocument,
} from '@forepath/agenstra/shared/util-opencode-config';
import { parse, stringify } from 'yaml';

import { AGENT_ENVIRONMENT_FILE_PATH } from '../../utils/agent-environment-file.utils';

import {
  LoadweaverIsolationMappingError,
  isLoadweaverRuntime,
  type LoadweaverEnvironmentRuntime,
} from './isolation-mapping';

/** The one service of an environment deployment. */
export const ENVIRONMENT_SERVICE = 'worker';
/** The workspace volume (the agent's repository and files). */
export const ENVIRONMENT_VOLUME = 'workspace';
/** Prefix of environment deployments (`env-<agent id without dashes>`). */
export const ENVIRONMENT_DEPLOYMENT_PREFIX = 'env-';

/** What an environment deployment is made of (kept in its compose file, so the manager can always read it back). */
export interface EnvironmentSpec {
  image: string;
  /** Where the workspace volume is mounted (the provider's base path, e.g. `/app`). */
  workspacePath: string;
  /** Loadweaver runtime of the environment's isolation level, 1:1 (`isolation-mapping.ts`). */
  runtime: LoadweaverEnvironmentRuntime;
  labels: Record<string, string>;
  network: LoadweaverEgressNetwork;
  capDrop: string[];
  /** Version of the environment secret (the env file); pinned, so a new version recreates the container. */
  secretVersion: number;
  /** `0` while stopped. */
  replicas: 0 | 1;
  volumeSize: string;
  /**
   * Guest size of a `microvm` environment (compose `deploy.resources.limits`; the node sizes the guest from them and
   * adds the launcher overhead) and its CPU reservation (`deploy.resources.reservations`: the scheduler's CPU request;
   * the guest memory stays fully reserved). Unset for the other levels.
   */
  microvm?: MicrovmEnvironmentSize;
}

export interface MicrovmEnvironmentSize {
  /** Guest vCPUs (compose `cpus`, e.g. `2`). */
  cpus: string;
  /** Guest memory (compose size, e.g. `2g`); also its reservation (no memory overcommit for microVMs). */
  memory: string;
  /**
   * CPUs the scheduler reserves for the environment (compose `reservations.cpus`, > 0 and at most `cpus`); unset = the
   * limit (`LOADWEAVER_ENVIRONMENT_MICROVM_CPU_RESERVATION`).
   */
  cpuReservation?: string;
}

/**
 * Container ports the bundled microVM launcher forwards into the guest (OpenCode, VNC websocket): the manager reaches
 * them through the environment's service address, as for containers.
 */
export const MICROVM_ENVIRONMENT_FORWARD_PORTS = '4096,6080';

/** Default guest size of microVM environments (`LOADWEAVER_ENVIRONMENT_MICROVM_CPUS` / `_MEMORY`). */
export const MICROVM_ENVIRONMENT_SIZE_DEFAULT: MicrovmEnvironmentSize = { cpus: '2', memory: '2g' };

/**
 * The launcher environment of a microVM environment (Agenstra's microVM image in Loadweaver's bundled mode): ports
 * forwarded into the guest, no loopback relay (the image's default relays the egress guard's proxy port; on
 * Loadweaver the node proxy filters egress, there is no guard). The entrypoint is the image's
 * (`AGENSTRA_MICROVM_ENTRYPOINT`); memory / vCPUs come from the node agent (from the guest size). Nothing secret.
 */
function microvmEnvironment(): Record<string, string> {
  return {
    AGENSTRA_MICROVM_FORWARD_PORTS: MICROVM_ENVIRONMENT_FORWARD_PORTS,
    AGENSTRA_MICROVM_LOOPBACK_PORTS: '',
  };
}

/** `env-<32 hex>` from an agent id (UUID); deterministic, so the deployment is found again after a restart. */
export function environmentDeployment(agentId: string): string {
  const hex = agentId.toLowerCase().replace(/[^0-9a-f]/g, '');

  if (hex.length < 12) throw new Error(`cannot derive an environment name from '${agentId}'`);

  return `${ENVIRONMENT_DEPLOYMENT_PREFIX}${hex.slice(0, 32)}`;
}

export function environmentSecret(deployment: string): string {
  return `${deployment}-env`;
}

/** The compose file of an environment (a plain compose file with `x-loadweaver` extensions). */
export function environmentCompose(project: string, deployment: string, spec: EnvironmentSpec): string {
  const microvm = spec.runtime === 'microvm';
  const size = microvm ? (spec.microvm ?? MICROVM_ENVIRONMENT_SIZE_DEFAULT) : null;

  return stringify({
    services: {
      [ENVIRONMENT_SERVICE]: {
        image: spec.image,
        restart: 'unless-stopped',
        labels: {
          ...spec.labels,
          [LOADWEAVER_ROLE_LABEL]: 'environment',
          [LOADWEAVER_EGRESS_NETWORK_LABEL]: spec.network,
        },
        // The whole environment (secrets included) comes from the env file: never in the plan or `docker inspect`.
        // Paths are the guest's: for microVMs the node agent mounts volumes and secrets below the launcher's `/guest`.
        secrets: [{ source: 'environment', target: AGENT_ENVIRONMENT_FILE_PATH }],
        volumes: [`${ENVIRONMENT_VOLUME}:${spec.workspacePath}`],
        // MicroVMs: no `cap_drop` / `cap_add` / `init` / `devices` — the node agent applies the launcher's fixed host
        // settings (runc, `Init: false`, all capabilities dropped but the launcher set, `/dev/kvm`, no-new-privileges).
        ...(!microvm && spec.capDrop.length > 0 ? { cap_drop: spec.capDrop } : {}),
        ...(size
          ? {
              environment: microvmEnvironment(),
              deploy: {
                resources: {
                  limits: { cpus: size.cpus, memory: size.memory },
                  // CPU reservation configurable (default: the limit); memory always fully reserved.
                  reservations: { cpus: size.cpuReservation ?? size.cpus, memory: size.memory },
                },
              },
            }
          : {}),
        'x-loadweaver': { replicas: spec.replicas, runtime: spec.runtime },
      },
    },
    volumes: { [ENVIRONMENT_VOLUME]: { 'x-loadweaver': { size: spec.volumeSize } } },
    secrets: {
      environment: { 'x-loadweaver-ref': `secret://${project}/${environmentSecret(deployment)}@${spec.secretVersion}` },
    },
  });
}

export function environmentDocument(
  project: string,
  deployment: string,
  spec: EnvironmentSpec,
): LoadweaverResourceDocument {
  return {
    apiVersion: LOADWEAVER_API_VERSION,
    kind: 'Deployment',
    metadata: { name: deployment, project, labels: { 'agenstra.io/environment': deployment } },
    spec: { compose: environmentCompose(project, deployment, spec) },
  };
}

/** Reads an environment's spec back from its compose file (`null` when it isn't one of ours). */
export function parseEnvironmentCompose(compose: string, volumeSize: string): EnvironmentSpec | null {
  const doc = parse(compose) as {
    services?: Record<string, Record<string, unknown>>;
    volumes?: Record<string, { 'x-loadweaver'?: { size?: string } }>;
    secrets?: Record<string, { 'x-loadweaver-ref'?: string }>;
  } | null;
  const service = doc?.services?.[ENVIRONMENT_SERVICE];

  if (!service || typeof service['image'] !== 'string') return null;

  const labels = { ...((service['labels'] as Record<string, string> | undefined) ?? {}) };
  const network = labels[LOADWEAVER_EGRESS_NETWORK_LABEL] === 'filtered' ? 'filtered' : 'open';
  const x = (service['x-loadweaver'] as { replicas?: number; runtime?: unknown } | undefined) ?? {};
  // Exact mapping back: no runtime is Loadweaver's default (`runc`), anything unknown is an error (never guessed).
  const runtime = x.runtime === undefined ? 'runc' : x.runtime;

  if (!isLoadweaverRuntime(runtime))
    throw new LoadweaverIsolationMappingError(`Environment compose has an unknown runtime '${String(runtime)}'`);

  const resources = (
    service['deploy'] as
      | { resources?: { limits?: { cpus?: unknown; memory?: unknown }; reservations?: { cpus?: unknown } } }
      | undefined
  )?.resources;
  const limits = resources?.limits;
  const cpus = limits?.cpus !== undefined ? String(limits.cpus) : MICROVM_ENVIRONMENT_SIZE_DEFAULT.cpus;
  const mount = ((service['volumes'] as string[] | undefined) ?? []).find((v) =>
    v.startsWith(`${ENVIRONMENT_VOLUME}:`),
  );
  const ref = doc?.secrets?.['environment']?.['x-loadweaver-ref'] ?? '';

  delete labels[LOADWEAVER_ROLE_LABEL];
  delete labels[LOADWEAVER_EGRESS_NETWORK_LABEL];

  return {
    image: service['image'],
    workspacePath: mount ? mount.slice(ENVIRONMENT_VOLUME.length + 1) : '/app',
    runtime,
    labels,
    network,
    capDrop: (service['cap_drop'] as string[] | undefined) ?? [],
    secretVersion: Number(/@(\d+)$/.exec(ref)?.[1] ?? 0),
    replicas: x.replicas === 0 ? 0 : 1,
    volumeSize: doc?.volumes?.[ENVIRONMENT_VOLUME]?.['x-loadweaver']?.size ?? volumeSize,
    ...(runtime === 'microvm'
      ? {
          microvm: {
            cpus,
            memory: limits?.memory !== undefined ? String(limits.memory) : MICROVM_ENVIRONMENT_SIZE_DEFAULT.memory,
            // Environments created before the reservation was configurable reserve their limit.
            cpuReservation: resources?.reservations?.cpus !== undefined ? String(resources.reservations.cpus) : cpus,
          },
        }
      : {}),
  };
}
