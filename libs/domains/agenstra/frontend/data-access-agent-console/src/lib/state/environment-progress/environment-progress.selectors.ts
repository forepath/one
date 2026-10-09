import { createFeatureSelector, createSelector } from '@ngrx/store';

import { selectAgentsEntities } from '../agents/agents.selectors';
import { selectSelectedClientId } from '../container-socket/container-socket.selectors';

import type { EnvironmentProgressState } from './environment-progress.reducer';
import type { EnvironmentProgress, WorkspaceEnvironmentProgress } from './environment-progress.types';
import {
  buildWorkspaceEnvironmentProgress,
  findCreateEnvironmentProgress,
  indexEnvironmentProgressByAgentId,
  sortEnvironmentProgress,
} from './environment-progress.utils';

export const selectEnvironmentProgressState = createFeatureSelector<EnvironmentProgressState>('environmentProgress');

export const selectEnvironmentProgressLiveByClientId = createSelector(
  selectEnvironmentProgressState,
  (state) => state.liveByClientId,
);

export const selectEnvironmentProgressLiveLoaded = createSelector(
  selectEnvironmentProgressState,
  (state) => state.liveLoaded,
);

export const selectEnvironmentProgressPolledByClientId = createSelector(
  selectEnvironmentProgressState,
  (state) => state.polledByClientId,
);

/**
 * Running operations per workspace. The workspace selected on the clients socket uses live data
 * (REST snapshot + socket events) once loaded; all other workspaces use the status-socket data.
 */
export const selectEnvironmentProgressByClientId = createSelector(
  selectEnvironmentProgressLiveByClientId,
  selectEnvironmentProgressLiveLoaded,
  selectEnvironmentProgressPolledByClientId,
  selectSelectedClientId,
  (liveByClientId, liveLoaded, polledByClientId, selectedClientId): Record<string, EnvironmentProgress[]> => {
    const result: Record<string, EnvironmentProgress[]> = {};

    for (const [clientId, operations] of Object.entries(polledByClientId)) {
      if (operations.length) {
        result[clientId] = sortEnvironmentProgress(operations);
      }
    }

    if (selectedClientId && liveLoaded[selectedClientId]) {
      const live = Object.values(liveByClientId[selectedClientId] ?? {});

      if (live.length) {
        result[selectedClientId] = sortEnvironmentProgress(live);
      } else {
        delete result[selectedClientId];
      }
    }

    return result;
  },
);

/** Aggregated (average + stacked segments) progress per workspace with running operations. */
export const selectWorkspaceEnvironmentProgressByClientId = createSelector(
  selectEnvironmentProgressByClientId,
  (byClientId): Record<string, WorkspaceEnvironmentProgress> => {
    const result: Record<string, WorkspaceEnvironmentProgress> = {};

    for (const [clientId, operations] of Object.entries(byClientId)) {
      const aggregate = buildWorkspaceEnvironmentProgress(clientId, operations);

      if (aggregate) {
        result[clientId] = aggregate;
      }
    }

    return result;
  },
);

export const selectClientEnvironmentProgress = (clientId: string) =>
  createSelector(selectEnvironmentProgressByClientId, (byClientId) => byClientId[clientId] ?? []);

/** Running operation per environment (agentId) of a workspace. */
export const selectClientEnvironmentProgressByAgentId = (clientId: string) =>
  createSelector(selectClientEnvironmentProgress(clientId), (operations) =>
    indexEnvironmentProgressByAgentId(operations),
  );

/**
 * Operations of environments not (yet) in the loaded environment list of a workspace, e.g. creates
 * that are still provisioning; rendered as placeholder rows.
 */
export const selectClientPendingEnvironmentProgress = (clientId: string) =>
  createSelector(selectClientEnvironmentProgress(clientId), selectAgentsEntities, (operations, entities) => {
    const knownIds = new Set((entities[clientId] ?? []).map((agent) => agent.id));

    return operations.filter((operation) => !operation.agentId || !knownIds.has(operation.agentId));
  });

export const selectWorkspaceEnvironmentProgress = (clientId: string) =>
  createSelector(selectWorkspaceEnvironmentProgressByClientId, (byClientId) => byClientId[clientId] ?? null);

/** Running operation of one environment (e.g. for the update modal). */
export const selectEnvironmentProgressForAgent = (clientId: string, agentId: string) =>
  createSelector(selectClientEnvironmentProgressByAgentId(clientId), (byAgentId) => byAgentId[agentId] ?? null);

/** Running create operation of a new environment, matched by name (e.g. for the create modal). */
export const selectCreateEnvironmentProgress = (clientId: string, agentName: string) =>
  createSelector(selectClientEnvironmentProgress(clientId), (operations) =>
    findCreateEnvironmentProgress(operations, agentName),
  );
