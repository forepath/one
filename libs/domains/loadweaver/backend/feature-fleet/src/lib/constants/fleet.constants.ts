/** Queue of the fleet service (health polling, operations), one per deployment. */
export const FLEET_QUEUE_NAME = 'loadweaver-fleet';

/** Coordinator: enqueues one health poll per active cluster and retires clusters whose grace period ended. */
export const FLEET_HEALTH_COORDINATOR_JOB = 'fleet-health-coordinator';
/** Unit: one health poll of one cluster (idempotent id per cluster and minute). */
export const FLEET_HEALTH_POLL_JOB = 'fleet-health-poll';
/** Coordinator: re-enqueues operations that wait for something on a cluster (restore / plan state). */
export const FLEET_OPERATIONS_COORDINATOR_JOB = 'fleet-operations-coordinator';
/** Unit: runs the current step of one operation (idempotent id per operation, step and attempt). */
export const FLEET_OPERATION_STEP_JOB = 'fleet-operation-step';

/** Header the fleet sends with the acting fleet user; clusters record it for PATs with `fleet:on-behalf-of`. */
export const FLEET_ON_BEHALF_OF_HEADER = 'X-Loadweaver-On-Behalf-Of';

/** Socket.IO namespace of the fleet's socket relay. */
export const FLEET_SOCKET_NAMESPACE = process.env['LOADWEAVER_FLEET_WEBSOCKET_NAMESPACE'] || 'socket/fleet';

export const FLEET_ROLES = ['viewer', 'operator', 'admin'] as const;
export type FleetRole = (typeof FLEET_ROLES)[number];

export const FLEET_CLUSTER_STATES = ['active', 'teardown', 'retired'] as const;
export type FleetClusterState = (typeof FLEET_CLUSTER_STATES)[number];

export const FLEET_HEALTH_STATES = ['unknown', 'healthy', 'degraded', 'unreachable', 'credential-rejected'] as const;
export type FleetHealthState = (typeof FLEET_HEALTH_STATES)[number];

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = Number(process.env[name]);

  return Number.isFinite(raw) && raw >= min && raw <= max ? Math.floor(raw) : fallback;
}

/** Relay limits (overridable per deployment). */
export function fleetRelayLimits(): { timeoutMs: number; maxRequestBytes: number; maxResponseBytes: number } {
  return {
    timeoutMs: intEnv('FLEET_RELAY_TIMEOUT_MS', 60_000, 1_000, 3_600_000),
    maxRequestBytes: intEnv('FLEET_RELAY_MAX_REQUEST_BYTES', 11 * 1024 * 1024, 1024, 1024 ** 3),
    maxResponseBytes: intEnv('FLEET_RELAY_MAX_RESPONSE_BYTES', 1024 ** 3, 1024, 64 * 1024 ** 3),
  };
}

/** How long fleet views reuse what they fetched from a cluster. */
export function fleetCacheTtlMs(): number {
  return intEnv('FLEET_CACHE_TTL_MS', 30_000, 0, 3_600_000);
}

/** Timeout of one aggregation / health request to a cluster. */
export function fleetClusterRequestTimeoutMs(): number {
  return intEnv('FLEET_CLUSTER_REQUEST_TIMEOUT_MS', 10_000, 500, 120_000);
}

/** Timeout of one backup archive transfer (export + import) between clusters. */
export function fleetTransferTimeoutMs(): number {
  return intEnv('FLEET_TRANSFER_TIMEOUT_MS', 6 * 3_600_000, 60_000, 48 * 3_600_000);
}
