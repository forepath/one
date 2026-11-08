import type { DeploymentConnectionSummary } from '@forepath/agenstra/shared/util-opencode-config';

import {
  clearDeploymentConnectionsError,
  createDeploymentConnection,
  createDeploymentConnectionSuccess,
  deleteDeploymentConnectionSuccess,
  loadDeploymentConnections,
  loadDeploymentConnectionsSuccess,
  saveDeploymentConnectionFailure,
  testDeploymentConnection,
  testDeploymentConnectionFailure,
  testDeploymentConnectionSuccess,
  updateDeploymentConnectionSuccess,
} from './deployment-connections.actions';
import { deploymentConnectionsReducer, initialDeploymentConnectionsState } from './deployment-connections.reducer';

function connection(overrides: Partial<DeploymentConnectionSummary> = {}): DeploymentConnectionSummary {
  return {
    id: 'k1',
    label: 'GitHub',
    provider: 'github',
    baseUrl: null,
    authType: 'app',
    appId: '1',
    installationId: '2',
    username: null,
    workspaceAccess: 'all',
    allowedClientIds: [],
    lastTestStatus: 'untested',
    lastTestMessage: null,
    lastTestedAt: null,
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('deploymentConnectionsReducer', () => {
  it('loads a page and remembers the query', () => {
    let state = deploymentConnectionsReducer(
      initialDeploymentConnectionsState,
      loadDeploymentConnections({ query: { search: 'git', limit: 10 } }),
    );

    expect(state).toMatchObject({ loading: true, query: { search: 'git', limit: 10 } });
    state = deploymentConnectionsReducer(
      state,
      loadDeploymentConnectionsSuccess({ connections: [connection()], hasNext: true }),
    );
    expect(state).toMatchObject({ loading: false, hasNext: true, connections: [connection()] });
  });

  it('upserts saved connections and removes deleted ones', () => {
    let state = deploymentConnectionsReducer(
      initialDeploymentConnectionsState,
      createDeploymentConnection({ dto: { label: 'x', provider: 'gitlab' } }),
    );

    expect(state.saving).toBe(true);
    state = deploymentConnectionsReducer(state, createDeploymentConnectionSuccess({ connection: connection() }));
    state = deploymentConnectionsReducer(
      state,
      updateDeploymentConnectionSuccess({ connection: connection({ label: 'Renamed' }) }),
    );
    expect(state.connections.map((c) => c.label)).toEqual(['Renamed']);
    state = deploymentConnectionsReducer(state, deleteDeploymentConnectionSuccess({ id: 'k1' }));
    expect(state.connections).toEqual([]);
    expect(state.saving).toBe(false);
  });

  it('keeps the backend message of a refused delete', () => {
    const state = deploymentConnectionsReducer(
      { ...initialDeploymentConnectionsState, saving: true },
      saveDeploymentConnectionFailure({ error: 'Connection is used by 2 deployment workflows' }),
    );

    expect(state).toMatchObject({ saving: false, error: 'Connection is used by 2 deployment workflows' });
    expect(deploymentConnectionsReducer(state, clearDeploymentConnectionsError()).error).toBeNull();
  });

  it('tracks tests and mirrors the persisted result on the row', () => {
    let state = { ...initialDeploymentConnectionsState, connections: [connection()] };

    state = deploymentConnectionsReducer(state, testDeploymentConnection({ id: 'k1' }));
    expect(state.testingIds).toEqual(['k1']);
    state = deploymentConnectionsReducer(
      state,
      testDeploymentConnectionSuccess({ id: 'k1', result: { ok: false, message: 'Bad key', testedAt: 't1' } }),
    );
    expect(state.testingIds).toEqual([]);
    expect(state.lastTest).toEqual({ id: 'k1', result: { ok: false, message: 'Bad key', testedAt: 't1' } });
    expect(state.connections[0]).toMatchObject({
      lastTestStatus: 'failed',
      lastTestMessage: 'Bad key',
      lastTestedAt: 't1',
    });

    state = deploymentConnectionsReducer(state, testDeploymentConnection({ id: 'k1' }));
    state = deploymentConnectionsReducer(state, testDeploymentConnectionFailure({ id: 'k1', error: 'boom' }));
    expect(state).toMatchObject({ testingIds: [], error: 'boom' });
  });
});
