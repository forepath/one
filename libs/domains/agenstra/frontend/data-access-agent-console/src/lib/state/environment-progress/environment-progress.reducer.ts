import { createReducer, on } from '@ngrx/store';

import { statusPatchReceived, statusSnapshotReceived } from '../notifications/notifications.actions';

import {
  environmentProgressReceived,
  loadEnvironmentProgress,
  loadEnvironmentProgressFailure,
  loadEnvironmentProgressSuccess,
} from './environment-progress.actions';
import type { ClientEnvironmentProgress, EnvironmentProgress } from './environment-progress.types';

export interface EnvironmentProgressState {
  /**
   * Live operations of workspaces selected on the clients socket (REST snapshot + forwarded socket events),
   * keyed by clientId then operationId.
   */
  liveByClientId: Record<string, Record<string, EnvironmentProgress>>;
  /** Socket updates received during a REST request, including terminal events. */
  snapshotUpdatesByClientId: Record<string, Record<string, EnvironmentProgress>>;
  /** Whether the REST snapshot for a workspace has been loaded (live data is authoritative afterwards). */
  liveLoaded: Record<string, boolean>;
  /** Operations of all accessible workspaces from the status socket (statusSnapshot / statusPatch). */
  polledByClientId: Record<string, EnvironmentProgress[]>;
  loading: Record<string, boolean>;
  errors: Record<string, string | null>;
}

export const initialEnvironmentProgressState: EnvironmentProgressState = {
  liveByClientId: {},
  snapshotUpdatesByClientId: {},
  liveLoaded: {},
  polledByClientId: {},
  loading: {},
  errors: {},
};

function isNewer(candidate: EnvironmentProgress, existing: EnvironmentProgress | undefined): boolean {
  if (!existing) {
    return true;
  }

  const candidateAt = Date.parse(candidate.updatedAt);
  const existingAt = Date.parse(existing.updatedAt);

  if (!Number.isNaN(candidateAt) && !Number.isNaN(existingAt) && candidateAt !== existingAt) {
    return candidateAt > existingAt;
  }

  return candidate.progress >= existing.progress;
}

function runningOnly(operations: EnvironmentProgress[] | undefined): EnvironmentProgress[] {
  return (operations ?? []).filter((operation) => operation.status === 'running');
}

function applyPolled(
  current: Record<string, EnvironmentProgress[]>,
  entries: ClientEnvironmentProgress[],
): Record<string, EnvironmentProgress[]> {
  const next = { ...current };

  for (const entry of entries) {
    const operations = runningOnly(entry.operations);

    if (operations.length) {
      next[entry.clientId] = operations;
    } else {
      delete next[entry.clientId];
    }
  }

  return next;
}

export const environmentProgressReducer = createReducer(
  initialEnvironmentProgressState,
  on(loadEnvironmentProgress, (state, { clientId }) => ({
    ...state,
    snapshotUpdatesByClientId: { ...state.snapshotUpdatesByClientId, [clientId]: {} },
    // Live data may be stale after reselecting / reconnecting; fall back to polled data until reloaded.
    liveLoaded: { ...state.liveLoaded, [clientId]: false },
    loading: { ...state.loading, [clientId]: true },
    errors: { ...state.errors, [clientId]: null },
  })),
  on(loadEnvironmentProgressSuccess, (state, { clientId, operations }) => {
    const existing = state.liveByClientId[clientId] ?? {};
    const byId: Record<string, EnvironmentProgress> = {};

    for (const operation of runningOnly(operations)) {
      const current = existing[operation.operationId];

      // A socket event may have overtaken the REST response; keep the newer state.
      byId[operation.operationId] = current && !isNewer(operation, current) ? current : operation;
    }

    for (const update of Object.values(state.snapshotUpdatesByClientId[clientId] ?? {})) {
      if (update.status !== 'running') {
        delete byId[update.operationId];
      } else if (isNewer(update, byId[update.operationId])) {
        byId[update.operationId] = update;
      }
    }

    return {
      ...state,
      liveByClientId: { ...state.liveByClientId, [clientId]: byId },
      snapshotUpdatesByClientId: { ...state.snapshotUpdatesByClientId, [clientId]: {} },
      liveLoaded: { ...state.liveLoaded, [clientId]: true },
      loading: { ...state.loading, [clientId]: false },
      errors: { ...state.errors, [clientId]: null },
    };
  }),
  on(loadEnvironmentProgressFailure, (state, { clientId, error }) => ({
    ...state,
    snapshotUpdatesByClientId: { ...state.snapshotUpdatesByClientId, [clientId]: {} },
    loading: { ...state.loading, [clientId]: false },
    errors: { ...state.errors, [clientId]: error },
  })),
  on(environmentProgressReceived, (state, { clientId, progress }) => {
    const existing = state.liveByClientId[clientId] ?? {};
    const updates = state.snapshotUpdatesByClientId[clientId] ?? {};
    const current = updates[progress.operationId] ?? existing[progress.operationId];

    if (!isNewer(progress, current) || current?.status === 'completed' || current?.status === 'failed') {
      return state;
    }

    const snapshotUpdatesByClientId = state.loading[clientId]
      ? {
          ...state.snapshotUpdatesByClientId,
          [clientId]: { ...updates, [progress.operationId]: progress },
        }
      : state.snapshotUpdatesByClientId;

    if (progress.status !== 'running') {
      if (!current && !state.loading[clientId]) {
        return state;
      }

      const { [progress.operationId]: _removed, ...remaining } = existing;

      return {
        ...state,
        snapshotUpdatesByClientId,
        liveByClientId: { ...state.liveByClientId, [clientId]: remaining },
      };
    }

    return {
      ...state,
      snapshotUpdatesByClientId,
      liveByClientId: {
        ...state.liveByClientId,
        [clientId]: { ...existing, [progress.operationId]: progress },
      },
    };
  }),
  on(statusSnapshotReceived, (state, { snapshot }) => ({
    ...state,
    polledByClientId: applyPolled({}, snapshot.environmentProgress ?? []),
  })),
  on(statusPatchReceived, (state, { patch }) =>
    patch.environmentProgress?.length
      ? { ...state, polledByClientId: applyPolled(state.polledByClientId, patch.environmentProgress) }
      : state,
  ),
);
