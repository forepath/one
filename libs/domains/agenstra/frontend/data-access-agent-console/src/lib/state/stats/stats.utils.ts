import type { ContainerStatsPayload } from '../container-socket/container-socket.types';

import type { ContainerStatsEntry } from './stats.types';

/**
 * Map a successful containerStats socket payload into a store entry.
 */
export function buildContainerStatsEntry(
  data: ContainerStatsPayload,
  clientId: string | null,
  selectedAgentId: string | null,
  receivedAt: number = Date.now(),
): ContainerStatsEntry {
  return {
    stats: data.stats,
    status: data.status,
    timestamp: data.timestamp,
    receivedAt,
    clientId: clientId || 'unknown',
    // Prefer payload agentId so login-time snapshots attribute correctly before/without selection races.
    agentId: data.agentId || selectedAgentId || 'unknown',
  };
}

/**
 * True when the new tick would not change anything the UI cares about.
 * Skips repeated stopped heartbeats; keeps running ticks that move CPU/memory counters.
 */
export function isRedundantContainerStats(
  previous: ContainerStatsEntry | null | undefined,
  next: ContainerStatsEntry,
): boolean {
  if (!previous) {
    return false;
  }

  if (previous.clientId !== next.clientId || previous.agentId !== next.agentId) {
    return false;
  }

  const wasRunning = previous.status?.running === true;
  const isRunning = next.status?.running === true;

  if (wasRunning !== isRunning) {
    return false;
  }

  // Stopped heartbeats are identical for the UI — no need to re-dispatch.
  if (!isRunning) {
    return true;
  }

  // Status-only snapshot (stats still loading) should be replaced by a later full tick.
  const prevHasStats = previous.stats != null;
  const nextHasStats = next.stats != null;

  if (prevHasStats !== nextHasStats) {
    return false;
  }

  const prevMem = previous.stats?.memory_stats?.usage;
  const nextMem = next.stats?.memory_stats?.usage;
  const prevCpu = previous.stats?.cpu_stats?.cpu_usage?.total_usage;
  const nextCpu = next.stats?.cpu_stats?.cpu_usage?.total_usage;

  return prevMem === nextMem && prevCpu === nextCpu;
}
