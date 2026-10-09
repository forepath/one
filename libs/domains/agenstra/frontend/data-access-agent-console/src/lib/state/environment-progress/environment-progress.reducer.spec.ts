import { statusPatchReceived, statusSnapshotReceived } from '../notifications/notifications.actions';

import {
  environmentProgressReceived,
  loadEnvironmentProgress,
  loadEnvironmentProgressFailure,
  loadEnvironmentProgressSuccess,
} from './environment-progress.actions';
import { environmentProgressReducer, initialEnvironmentProgressState } from './environment-progress.reducer';
import type { EnvironmentProgress } from './environment-progress.types';

function op(overrides: Partial<EnvironmentProgress> = {}): EnvironmentProgress {
  return {
    operationId: 'op-1',
    agentId: 'agent-1',
    agentName: 'Agent',
    operation: 'update',
    status: 'running',
    step: 'recreatingContainer',
    stepIndex: 1,
    stepCount: 3,
    progress: 50,
    startedAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:10Z',
    ...overrides,
  };
}

describe('environmentProgressReducer', () => {
  const clientId = 'client-1';

  it('should mark loading and reset liveLoaded on load', () => {
    const state = environmentProgressReducer(
      { ...initialEnvironmentProgressState, liveLoaded: { [clientId]: true }, errors: { [clientId]: 'x' } },
      loadEnvironmentProgress({ clientId }),
    );

    expect(state.loading[clientId]).toBe(true);
    expect(state.liveLoaded[clientId]).toBe(false);
    expect(state.errors[clientId]).toBeNull();
  });

  it('should store running operations on load success', () => {
    const state = environmentProgressReducer(
      initialEnvironmentProgressState,
      loadEnvironmentProgressSuccess({
        clientId,
        operations: [op(), op({ operationId: 'done', status: 'completed' })],
      }),
    );

    expect(Object.keys(state.liveByClientId[clientId])).toEqual(['op-1']);
    expect(state.liveLoaded[clientId]).toBe(true);
    expect(state.loading[clientId]).toBe(false);
  });

  it('should keep newer socket state when the REST snapshot is older', () => {
    let state = environmentProgressReducer(
      initialEnvironmentProgressState,
      environmentProgressReceived({ clientId, progress: op({ progress: 80, updatedAt: '2024-01-01T00:00:20Z' }) }),
    );

    state = environmentProgressReducer(state, loadEnvironmentProgressSuccess({ clientId, operations: [op()] }));

    expect(state.liveByClientId[clientId]['op-1'].progress).toBe(80);
  });

  it('should store errors on load failure', () => {
    const state = environmentProgressReducer(
      initialEnvironmentProgressState,
      loadEnvironmentProgressFailure({ clientId, error: 'boom' }),
    );

    expect(state.errors[clientId]).toBe('boom');
    expect(state.loading[clientId]).toBe(false);
  });

  it('should retain operations started while a REST snapshot is in flight', () => {
    let state = environmentProgressReducer(initialEnvironmentProgressState, loadEnvironmentProgress({ clientId }));

    state = environmentProgressReducer(state, environmentProgressReceived({ clientId, progress: op() }));
    state = environmentProgressReducer(state, loadEnvironmentProgressSuccess({ clientId, operations: [] }));

    expect(state.liveByClientId[clientId]['op-1']).toEqual(op());
  });

  it.each(['completed', 'failed'] as const)(
    'should not resurrect an operation that %s while a REST snapshot was in flight',
    (status) => {
      let state = environmentProgressReducer(initialEnvironmentProgressState, loadEnvironmentProgress({ clientId }));

      state = environmentProgressReducer(
        state,
        environmentProgressReceived({
          clientId,
          progress: op({ status, updatedAt: '2024-01-01T00:00:11Z' }),
        }),
      );
      state = environmentProgressReducer(state, loadEnvironmentProgressSuccess({ clientId, operations: [op()] }));

      expect(state.liveByClientId[clientId]).toEqual({});
    },
  );

  it('should discard stale operations on a fresh snapshot after reconnecting', () => {
    let state = environmentProgressReducer(
      initialEnvironmentProgressState,
      environmentProgressReceived({ clientId, progress: op() }),
    );

    state = environmentProgressReducer(state, loadEnvironmentProgress({ clientId }));
    state = environmentProgressReducer(state, loadEnvironmentProgressSuccess({ clientId, operations: [] }));

    expect(state.liveByClientId[clientId]).toEqual({});
  });

  describe('environmentProgressReceived', () => {
    it('should upsert running operations', () => {
      const state = environmentProgressReducer(
        initialEnvironmentProgressState,
        environmentProgressReceived({ clientId, progress: op() }),
      );

      expect(state.liveByClientId[clientId]['op-1'].progress).toBe(50);
    });

    it('should ignore stale events', () => {
      let state = environmentProgressReducer(
        initialEnvironmentProgressState,
        environmentProgressReceived({ clientId, progress: op({ progress: 60 }) }),
      );

      state = environmentProgressReducer(
        state,
        environmentProgressReceived({ clientId, progress: op({ progress: 10, updatedAt: '2024-01-01T00:00:00Z' }) }),
      );

      expect(state.liveByClientId[clientId]['op-1'].progress).toBe(60);
    });

    it('should remove operations on terminal status', () => {
      let state = environmentProgressReducer(
        initialEnvironmentProgressState,
        environmentProgressReceived({ clientId, progress: op() }),
      );

      state = environmentProgressReducer(
        state,
        environmentProgressReceived({
          clientId,
          progress: op({ status: 'failed', updatedAt: '2024-01-01T00:00:11Z' }),
        }),
      );

      expect(state.liveByClientId[clientId]).toEqual({});
    });

    it('should return the same state for unknown terminal operations', () => {
      const state = environmentProgressReducer(
        initialEnvironmentProgressState,
        environmentProgressReceived({ clientId, progress: op({ status: 'completed' }) }),
      );

      expect(state).toBe(initialEnvironmentProgressState);
    });

    it('should ignore terminal events older than the current running event', () => {
      let state = environmentProgressReducer(
        initialEnvironmentProgressState,
        environmentProgressReceived({ clientId, progress: op() }),
      );

      state = environmentProgressReducer(
        state,
        environmentProgressReceived({
          clientId,
          progress: op({ status: 'failed', updatedAt: '2024-01-01T00:00:00Z' }),
        }),
      );

      expect(state.liveByClientId[clientId]['op-1']).toEqual(op());
    });
  });

  describe('status socket', () => {
    it('should replace polled progress on snapshot', () => {
      const state = environmentProgressReducer(
        { ...initialEnvironmentProgressState, polledByClientId: { other: [op()] } },
        statusSnapshotReceived({
          snapshot: {
            generatedAt: '2024-01-01T00:00:00Z',
            environments: [],
            clients: [],
            spacesHasAttention: false,
            environmentProgress: [{ clientId, operations: [op()] }],
          },
        }),
      );

      expect(Object.keys(state.polledByClientId)).toEqual([clientId]);
    });

    it('should set and clear per-client progress on patch', () => {
      let state = environmentProgressReducer(
        initialEnvironmentProgressState,
        statusPatchReceived({
          patch: { generatedAt: 'x', environmentProgress: [{ clientId, operations: [op()] }] },
        }),
      );

      expect(state.polledByClientId[clientId]).toHaveLength(1);

      state = environmentProgressReducer(
        state,
        statusPatchReceived({ patch: { generatedAt: 'y', environmentProgress: [{ clientId, operations: [] }] } }),
      );

      expect(state.polledByClientId[clientId]).toBeUndefined();
    });

    it('should ignore patches without progress', () => {
      const state = environmentProgressReducer(
        initialEnvironmentProgressState,
        statusPatchReceived({ patch: { generatedAt: 'x', clients: [] } }),
      );

      expect(state).toBe(initialEnvironmentProgressState);
    });
  });
});
