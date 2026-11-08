import type { ConnectionTestResult, DeploymentConnectionSummary } from '@forepath/agenstra/shared/util-opencode-config';
import { createReducer, on } from '@ngrx/store';

import {
  clearDeploymentConnectionsError,
  clearDeploymentConnectionTestResult,
  createDeploymentConnection,
  createDeploymentConnectionSuccess,
  deleteDeploymentConnection,
  deleteDeploymentConnectionSuccess,
  loadDeploymentConnections,
  loadDeploymentConnectionsFailure,
  loadDeploymentConnectionsSuccess,
  saveDeploymentConnectionFailure,
  testDeploymentConnection,
  testDeploymentConnectionFailure,
  testDeploymentConnectionSuccess,
  updateDeploymentConnection,
  updateDeploymentConnectionSuccess,
} from './deployment-connections.actions';
import type { DeploymentConnectionsQuery } from './deployment-connections.types';

export interface DeploymentConnectionsState {
  connections: DeploymentConnectionSummary[];
  /** Query of the listed page (reloaded after create / delete). */
  query: DeploymentConnectionsQuery;
  /** Server paging without a total: a full page means there may be a next one. */
  hasNext: boolean;
  loading: boolean;
  saving: boolean;
  /** Connections with an in-flight test. */
  testingIds: string[];
  /** Outcome of the latest single test (shown as page alert). */
  lastTest: { id: string; result: ConnectionTestResult } | null;
  error: string | null;
}

export const initialDeploymentConnectionsState: DeploymentConnectionsState = {
  connections: [],
  query: {},
  hasNext: false,
  loading: false,
  saving: false,
  testingIds: [],
  lastTest: null,
  error: null,
};

function upsert(
  connections: DeploymentConnectionSummary[],
  connection: DeploymentConnectionSummary,
): DeploymentConnectionSummary[] {
  return connections.some((existing) => existing.id === connection.id)
    ? connections.map((existing) => (existing.id === connection.id ? connection : existing))
    : [connection, ...connections];
}

export const deploymentConnectionsReducer = createReducer(
  initialDeploymentConnectionsState,
  on(loadDeploymentConnections, (state, { query }) => ({ ...state, query, loading: true, error: null })),
  on(loadDeploymentConnectionsSuccess, (state, { connections, hasNext }) => ({
    ...state,
    connections,
    hasNext,
    loading: false,
  })),
  on(loadDeploymentConnectionsFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(createDeploymentConnection, updateDeploymentConnection, deleteDeploymentConnection, (state) => ({
    ...state,
    saving: true,
    error: null,
  })),
  on(createDeploymentConnectionSuccess, updateDeploymentConnectionSuccess, (state, { connection }) => ({
    ...state,
    saving: false,
    connections: upsert(state.connections, connection),
  })),
  on(deleteDeploymentConnectionSuccess, (state, { id }) => ({
    ...state,
    saving: false,
    connections: state.connections.filter((connection) => connection.id !== id),
    lastTest: state.lastTest?.id === id ? null : state.lastTest,
  })),
  on(saveDeploymentConnectionFailure, (state, { error }) => ({ ...state, saving: false, error })),
  on(testDeploymentConnection, (state, { id }) => ({
    ...state,
    testingIds: [...state.testingIds.filter((existing) => existing !== id), id],
    lastTest: null,
    error: null,
  })),
  on(testDeploymentConnectionSuccess, (state, { id, result }) => ({
    ...state,
    testingIds: state.testingIds.filter((existing) => existing !== id),
    lastTest: { id, result },
    // The controller persisted the result: mirror it on the row until the next reload.
    connections: state.connections.map((connection) =>
      connection.id === id
        ? {
            ...connection,
            lastTestStatus: result.ok ? 'ok' : 'failed',
            lastTestMessage: result.message ?? null,
            lastTestedAt: result.testedAt,
          }
        : connection,
    ),
  })),
  on(testDeploymentConnectionFailure, (state, { id, error }) => ({
    ...state,
    testingIds: state.testingIds.filter((existing) => existing !== id),
    error,
  })),
  on(clearDeploymentConnectionsError, (state) => ({ ...state, error: null })),
  on(clearDeploymentConnectionTestResult, (state) => ({ ...state, lastTest: null })),
);
