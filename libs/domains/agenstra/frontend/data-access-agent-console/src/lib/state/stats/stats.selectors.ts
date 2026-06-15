import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { StatsState } from './stats.reducer';
import type { ContainerStatsEntry } from './stats.types';

export const selectStatsState = createFeatureSelector<StatsState>('stats');

// Base selectors
export const selectStatsByContainer = createSelector(selectStatsState, (state) => state.statsByContainer);

export const selectRunningOverrides = createSelector(selectStatsState, (state) => state.runningOverrides);

/**
 * Generate composite key for stats lookup
 */
function getStatsKey(clientId: string, agentId: string): string {
  return `${clientId}:${agentId}`;
}

/**
 * Select stats history for a specific container (clientId:agentId)
 * @param clientId - The client ID
 * @param agentId - The agent ID
 */
export const selectContainerStats = (clientId: string, agentId: string) =>
  createSelector(selectStatsByContainer, (statsByContainer) => {
    const key = getStatsKey(clientId, agentId);

    return statsByContainer[key] || [];
  });

/**
 * Select the most recent stats entry for a specific container
 * @param clientId - The client ID
 * @param agentId - The agent ID
 */
export const selectCurrentContainerStats = (clientId: string, agentId: string) =>
  createSelector(selectContainerStats(clientId, agentId), (stats) => {
    return stats.length > 0 ? stats[stats.length - 1] : null;
  });

/**
 * Select container run status (running true/false) for a specific container.
 * Prefers the optimistic override (set after start/stop/restart success) so the UI updates
 * immediately; when a new containerStats event arrives the override is cleared and socket data is used.
 * @param clientId - The client ID
 * @param agentId - The agent ID
 */
export const selectContainerRunningStatus = (clientId: string, agentId: string) =>
  createSelector(selectCurrentContainerStats(clientId, agentId), selectRunningOverrides, (entry, overrides) => {
    const key = getStatsKey(clientId, agentId);

    if (key in overrides) return overrides[key];

    if (entry?.status != null) return entry.status.running;

    return null;
  });

/**
 * Select stats entries for a specific container within a time range
 * @param clientId - The client ID
 * @param agentId - The agent ID
 * @param startTime - Start timestamp (Date.now() or ISO string)
 * @param endTime - End timestamp (Date.now() or ISO string), or null for "now"
 */
export const selectContainerStatsInRange = (
  clientId: string,
  agentId: string,
  startTime: number | string,
  endTime: number | string | null,
) =>
  createSelector(selectContainerStats(clientId, agentId), (stats) => {
    const start = typeof startTime === 'string' ? new Date(startTime).getTime() : startTime;
    const end = endTime === null ? Date.now() : typeof endTime === 'string' ? new Date(endTime).getTime() : endTime;

    return stats.filter((entry) => {
      const entryTime = typeof entry.timestamp === 'string' ? new Date(entry.timestamp).getTime() : entry.timestamp;

      return entryTime >= start && entryTime <= end;
    });
  });

/**
 * Select stats entries for a specific container from a start time to now
 * @param clientId - The client ID
 * @param agentId - The agent ID
 * @param startTime - Start timestamp (Date.now() or ISO string)
 */
export const selectContainerStatsFromTime = (clientId: string, agentId: string, startTime: number | string) =>
  selectContainerStatsInRange(clientId, agentId, startTime, null);

/**
 * Select the count of stats entries for a specific container
 * @param clientId - The client ID
 * @param agentId - The agent ID
 */
export const selectContainerStatsCount = (clientId: string, agentId: string) =>
  createSelector(selectContainerStats(clientId, agentId), (stats) => stats.length);

/**
 * Select all container keys (clientId:agentId) that have stats
 */
export const selectContainersWithStats = createSelector(selectStatsByContainer, (statsByContainer) =>
  Object.keys(statsByContainer),
);

/**
 * Select stats entries for a specific container, limited to the most recent N entries
 * @param clientId - The client ID
 * @param agentId - The agent ID
 * @param limit - Maximum number of entries to return
 */
export const selectContainerStatsLimited = (clientId: string, agentId: string, limit: number) =>
  createSelector(selectContainerStats(clientId, agentId), (stats) => stats.slice(-limit));

/**
 * Select stats entries for a specific container, filtered by a custom predicate
 * @param clientId - The client ID
 * @param agentId - The agent ID
 * @param predicate - Filter function
 */
export const selectContainerStatsFiltered = (
  clientId: string,
  agentId: string,
  predicate: (entry: ContainerStatsEntry) => boolean,
) => createSelector(selectContainerStats(clientId, agentId), (stats) => stats.filter(predicate));
