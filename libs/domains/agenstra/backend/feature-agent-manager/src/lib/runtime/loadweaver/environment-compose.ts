import {
  LOADWEAVER_API_VERSION,
  LOADWEAVER_EGRESS_NETWORK_LABEL,
  LOADWEAVER_ROLE_LABEL,
  type LoadweaverEgressNetwork,
  type LoadweaverResourceDocument,
} from '@forepath/agenstra/shared/util-opencode-config';
import { parse, stringify } from 'yaml';

import { AGENT_ENVIRONMENT_FILE_PATH } from '../../utils/agent-environment-file.utils';

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
  /** `sandboxed` (gVisor) or `runc`, from the environment's isolation level. */
  runtime: 'sandboxed' | 'runc';
  labels: Record<string, string>;
  network: LoadweaverEgressNetwork;
  capDrop: string[];
  /** Version of the environment secret (the env file); pinned, so a new version recreates the container. */
  secretVersion: number;
  /** `0` while stopped. */
  replicas: 0 | 1;
  volumeSize: string;
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
        secrets: [{ source: 'environment', target: AGENT_ENVIRONMENT_FILE_PATH }],
        volumes: [`${ENVIRONMENT_VOLUME}:${spec.workspacePath}`],
        ...(spec.capDrop.length > 0 ? { cap_drop: spec.capDrop } : {}),
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
  const x = (service['x-loadweaver'] as { replicas?: number; runtime?: string } | undefined) ?? {};
  const mount = ((service['volumes'] as string[] | undefined) ?? []).find((v) =>
    v.startsWith(`${ENVIRONMENT_VOLUME}:`),
  );
  const ref = doc?.secrets?.['environment']?.['x-loadweaver-ref'] ?? '';

  delete labels[LOADWEAVER_ROLE_LABEL];
  delete labels[LOADWEAVER_EGRESS_NETWORK_LABEL];

  return {
    image: service['image'],
    workspacePath: mount ? mount.slice(ENVIRONMENT_VOLUME.length + 1) : '/app',
    runtime: x.runtime === 'runc' ? 'runc' : 'sandboxed',
    labels,
    network,
    capDrop: (service['cap_drop'] as string[] | undefined) ?? [],
    secretVersion: Number(/@(\d+)$/.exec(ref)?.[1] ?? 0),
    replicas: x.replicas === 0 ? 0 : 1,
    volumeSize: doc?.volumes?.[ENVIRONMENT_VOLUME]?.['x-loadweaver']?.size ?? volumeSize,
  };
}
