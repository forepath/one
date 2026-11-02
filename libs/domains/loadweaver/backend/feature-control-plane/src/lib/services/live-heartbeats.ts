import type { ComponentVersions } from '@forepath/loadweaver/shared/util-agent-protocol';

import { databaseTarget } from '../database-handover/database-target.runtime';

/** What a heartbeat / hello / disconnect would have stored in the node's row. */
export interface LiveHeartbeat {
  lastSeenAt: Date;
  connected: boolean;
  usage?: { cpuMillis: number; memoryBytes: number; diskBytes: number };
  appliedRevision?: number;
  drift?: { containers: unknown[]; at: string };
  componentVersions?: ComponentVersions;
}

/** The fields of `lw_nodes` a live heartbeat overrides (a loaded `NodeEntity`, possibly a partial select). */
export interface LiveHeartbeatTarget {
  name?: string;
  lastSeenAt?: Date | null;
  connected?: boolean;
  usage?: LiveHeartbeat['usage'] | null;
  appliedRevision?: number | null;
  drift?: unknown;
  componentVersions?: ComponentVersions | null;
}

/**
 * Heartbeats received while the control plane serves read-only (3.43 fallback: the members' database is out of reach,
 * every write fails): the agents stay connected and keep reporting, but `lw_nodes` can't record it, so `lastSeenAt`
 * froze and every node looked disconnected after the heartbeat timeout (user, 2026-10-31: "everything shown reflects
 * the real state"). Kept per process; applied to each loaded `NodeEntity` (see its `@AfterLoad`) only during the
 * fallback, and only when newer than the stored row.
 */
const live = new Map<string, LiveHeartbeat>();

/** Records what a heartbeat / hello would have stored (merged with the previous live one). */
export function recordLiveHeartbeat(node: string, heartbeat: LiveHeartbeat): void {
  live.set(node, { ...live.get(node), ...heartbeat });
}

/** The agent's stream closed (the stored path sets `connected: false` with `lastSeenAt` now). */
export function recordLiveDisconnect(node: string, at = new Date()): void {
  recordLiveHeartbeat(node, { lastSeenAt: at, connected: false });
}

/** Forgets everything (tests; nothing else needs it: older entries lose against newer stored rows). */
export function clearLiveHeartbeats(): void {
  live.clear();
}

/**
 * Overrides a loaded node's liveness fields with the live heartbeat during the read-only fallback (no-op otherwise,
 * or when the stored row is as new). Partial selects get the fields too, which is harmless.
 */
export function applyLiveHeartbeat(node: LiveHeartbeatTarget, fallback = databaseTarget.fallback): void {
  const entry = fallback && node.name ? live.get(node.name) : undefined;

  if (!entry || (node.lastSeenAt && node.lastSeenAt.getTime() >= entry.lastSeenAt.getTime())) return;

  node.lastSeenAt = entry.lastSeenAt;
  node.connected = entry.connected;

  if (entry.usage) node.usage = entry.usage;

  if (entry.appliedRevision !== undefined) node.appliedRevision = entry.appliedRevision;

  if (entry.drift) node.drift = entry.drift;

  if (entry.componentVersions) node.componentVersions = entry.componentVersions;
}
