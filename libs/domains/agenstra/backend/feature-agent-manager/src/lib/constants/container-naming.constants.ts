import { EGRESS_GUARD_AGENT_LABEL, EGRESS_GUARD_NAME_PREFIX } from './egress-guard.constants';

/**
 * Docker container naming for agent environments: `agenstra-<role>-<agentId>`.
 * - `agenstra-worker-<agentId>`: the environment's worker container
 * - `agenstra-egress-<agentId>`: its egress guard sidecar (see {@link EGRESS_GUARD_NAME_PREFIX})
 * The agent id is assigned before any container is created, so names never change afterwards
 * (recreated containers take over the name of the container they replace).
 */
export const AGENT_WORKER_NAME_PREFIX = 'agenstra-worker-';

/** Container label carrying the owning agent id (shared by workers and egress guards). */
export const AGENT_ID_LABEL = EGRESS_GUARD_AGENT_LABEL;
/** Container label marking agent worker containers (value `1`). */
export const AGENT_WORKER_LABEL = 'io.agenstra.worker';

export function agentWorkerContainerName(agentId: string): string {
  return `${AGENT_WORKER_NAME_PREFIX}${agentId}`;
}
