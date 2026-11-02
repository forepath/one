/**
 * Fleet reaction to an unreachable or read-only cluster (3.43, user decision 2026-10-31): pure decisions over what the
 * fleet's health poll learnt. Unreachable comes from the fleet's own poll, read-only from the cluster's
 * `GET /api/cluster` → `controlPlane.database.readOnly` (its control plane serves reads from the external copy while
 * it can't write).
 */

/** What the health poll keeps of the cluster's database state (`controlPlane.database` of `GET /api/cluster`). */
export interface FleetClusterDatabase {
  readOnly: boolean;
  /** Why the cluster can't write (the cluster's own text, else a default). */
  reason: string | null;
  /** A short write pause (database handover / return in progress). */
  freeze: string | null;
  /** When the built-in control plane took the database over (3.43 takeover), if it did. */
  takenOverAt: string | null;
}

export type FleetAvailabilityState = 'reachable' | 'unreachable' | 'read-only';

export interface FleetAvailability {
  state: FleetAvailabilityState;
  /** Why writes are refused (null while reachable). */
  reason: string | null;
  /** A write pause the cluster reports (database handover / return), shown as context only. */
  freeze: string | null;
  /** When the built-in control plane took the database over (3.43), if the cluster reports it. */
  takenOverAt: string | null;
  /** When the fleet last polled the cluster (the state is as of then). */
  checkedAt: string | null;
}

/** Default text when a read-only cluster gives no reason (older control planes). */
export const CLUSTER_READ_ONLY_REASON =
  "the cluster's database members are unreachable; it is read-only until one is back";
export const CLUSTER_UNREACHABLE_REASON = 'the fleet cannot reach the cluster';

const MAX_REASON = 300;

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, MAX_REASON) : null;
}

/**
 * The database state from a `GET /api/cluster` body (null: the cluster doesn't report one — on-node installs report
 * `deployment: on-node`, older control planes nothing; both mean writable as far as the fleet knows).
 */
export function clusterDatabaseFrom(data: unknown): FleetClusterDatabase | null {
  const database = (data as { controlPlane?: { database?: unknown } } | null | undefined)?.controlPlane?.database;

  if (!database || typeof database !== 'object') return null;

  const d = database as Record<string, unknown>;
  const readOnly = d['readOnly'] === true;

  return {
    readOnly,
    reason: readOnly ? (text(d['readOnlyReason']) ?? CLUSTER_READ_ONLY_REASON) : null,
    freeze: text(d['freeze']),
    // Only while the database is on the external side (3.43 live test: control planes up to `:lw343-5` kept reporting
    // the last takeover after a handover moved the database back to the members).
    takenOverAt: d['location'] === 'members' ? null : text(d['takenOverAt']),
  };
}

/** Health as the poll stores it (only the fields used here). */
export interface AvailabilityHealthLike {
  state?: string;
  error?: string | null;
  checkedAt?: string | null;
  database?: FleetClusterDatabase | null;
}

/**
 * `unreachable`: the fleet's last poll didn't reach the cluster. `read-only`: it answered, but its control plane can't
 * write (3.43). Everything else (healthy, degraded, credential problems, not polled yet) is `reachable` here: those
 * have their own states and messages.
 */
export function clusterAvailability(health: AvailabilityHealthLike | null | undefined): FleetAvailability {
  const context = {
    freeze: health?.database?.freeze ?? null,
    takenOverAt: health?.database?.takenOverAt ?? null,
    checkedAt: health?.checkedAt ?? null,
  };

  if (health?.state === 'unreachable')
    // The database facts are from an earlier answer: not repeated while the cluster doesn't answer.
    return {
      state: 'unreachable',
      reason: text(health.error) ?? CLUSTER_UNREACHABLE_REASON,
      freeze: null,
      takenOverAt: null,
      checkedAt: context.checkedAt,
    };

  if (health?.database?.readOnly)
    return { state: 'read-only', reason: health.database.reason ?? CLUSTER_READ_ONLY_REASON, ...context };

  return { state: 'reachable', reason: null, ...context };
}

/** A poll older than this doesn't block writes in the relay any more (the cluster decides itself then). */
export const RELAY_BLOCK_MAX_AGE_MS = 5 * 60_000;

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** POSTs that only read (queries, previews): relayed to a read-only cluster, too (the console's list matches). */
export const RELAY_READ_POSTS: readonly RegExp[] = [/^dashboards\/query$/, /^topology\/preview$/];

/** Whether a relayed request changes something at the cluster (path without `/api/`, without leading slash). */
export function isRelayWrite(method: string, path: string): boolean {
  const upper = method.toUpperCase();

  if (READ_METHODS.has(upper)) return false;

  const clean = path.replace(/^\/+|\/+$/g, '');

  return !(upper === 'POST' && RELAY_READ_POSTS.some((p) => p.test(clean)));
}

/**
 * Relay backstop: the message a write to this cluster is refused with, without calling the cluster (null: relay it).
 * Reads always go through (an unreachable cluster answers them with its own error; a read-only one serves them).
 * Only a recent poll blocks (`RELAY_BLOCK_MAX_AGE_MS`), so a cluster that came back isn't refused for long.
 */
export function relayWriteBlock(
  method: string,
  path: string,
  health: AvailabilityHealthLike | null | undefined,
  clusterName: string,
  now: number = Date.now(),
): string | null {
  if (!isRelayWrite(method, path)) return null;

  const availability = clusterAvailability(health);

  if (availability.state === 'reachable') return null;

  const checked = health?.checkedAt ? Date.parse(health.checkedAt) : NaN;

  if (!Number.isFinite(checked) || now - checked > RELAY_BLOCK_MAX_AGE_MS) return null;

  return availability.state === 'unreachable'
    ? `cluster ${clusterName} is unreachable: changes through the fleet are paused until it answers again`
    : `cluster ${clusterName} is read-only (${availability.reason}): changes through the fleet are paused until it can write again`;
}
