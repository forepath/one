import {
  clearAdminUpdatesError,
  loadAdminUpdatesFull,
  loadAdminUpdatesFullFailure,
  loadAdminUpdatesFullSuccess,
  loadAdminUpdatesStatus,
  loadAdminUpdatesStatusFailure,
  loadAdminUpdatesStatusSuccess,
  triggerAdminUpdateCheck,
  triggerAdminUpdateCheckFailure,
  triggerAdminUpdateCheckSuccess,
} from './admin-updates.actions';
import { adminUpdatesReducer, initialAdminUpdatesState } from './admin-updates.reducer';
import type { UpdatesFullState, UpdatesStatusSummary } from '../../types/updates.types';

describe('adminUpdatesReducer', () => {
  const baseStatus = (over: Partial<UpdatesStatusSummary> = {}): UpdatesStatusSummary => ({
    installedVersion: '1.0.0',
    latestVersion: '1.1.0',
    updateState: 'update_available',
    lastCheckAt: '2024-01-01T00:00:00Z',
    lastCheckStatus: 'success',
    instanceCount: 1,
    outdatedInstanceCount: 0,
    ...over,
  });

  const baseFullState = (over: Partial<UpdatesFullState> = {}): UpdatesFullState => ({
    ...baseStatus(),
    release: null,
    instances: [],
    scopedChangelog: { product: [], shared: [] },
    ...over,
  });

  it('returns initial state for unknown action', () => {
    expect(adminUpdatesReducer(undefined, { type: 'UNKNOWN' } as never)).toEqual(initialAdminUpdatesState);
  });

  it('handles status load lifecycle', () => {
    let state = adminUpdatesReducer(initialAdminUpdatesState, loadAdminUpdatesStatus());

    expect(state.statusLoading).toBe(true);

    const status = baseStatus();

    state = adminUpdatesReducer(state, loadAdminUpdatesStatusSuccess({ status }));
    expect(state.statusLoading).toBe(false);
    expect(state.status).toEqual(status);

    state = adminUpdatesReducer(state, loadAdminUpdatesStatusFailure({ error: 'failed' }));
    expect(state.statusLoading).toBe(false);
    expect(state.checking).toBe(false);
    expect(state.error).toBe('failed');
  });

  it('handles full load lifecycle', () => {
    let state = adminUpdatesReducer(initialAdminUpdatesState, loadAdminUpdatesFull());

    expect(state.fullLoading).toBe(true);

    const fullState = baseFullState();

    state = adminUpdatesReducer(state, loadAdminUpdatesFullSuccess({ fullState }));
    expect(state.fullLoading).toBe(false);
    expect(state.fullState).toEqual(fullState);
    expect(state.status?.installedVersion).toBe('1.0.0');

    state = adminUpdatesReducer(state, loadAdminUpdatesFullFailure({ error: 'boom' }));
    expect(state.fullLoading).toBe(false);
    expect(state.checking).toBe(false);
    expect(state.error).toBe('boom');
  });

  it('keeps the channel and prerelease flag of products with release channels', () => {
    const fullState = baseFullState({
      channel: 'beta',
      release: {
        tagName: 'v1.1.0-beta.1',
        name: '1.1.0-beta.1',
        body: '',
        htmlUrl: 'https://example.com/releases/v1.1.0-beta.1',
        publishedAt: '2024-01-01T00:00:00Z',
        changelog: [{ text: 'new rollout', scope: 'product', product: 'loadweaver' }],
        scopedChangelog: { product: [], shared: [] },
        prerelease: true,
      },
    });
    const state = adminUpdatesReducer(initialAdminUpdatesState, loadAdminUpdatesFullSuccess({ fullState }));

    expect(state.fullState?.channel).toBe('beta');
    expect(state.status?.channel).toBe('beta');
    expect(state.fullState?.release?.prerelease).toBe(true);
    expect(state.fullState?.release?.changelog[0].product).toBe('loadweaver');
  });

  it('handles trigger check lifecycle', () => {
    let state = adminUpdatesReducer(initialAdminUpdatesState, triggerAdminUpdateCheck());

    expect(state.checking).toBe(true);

    state = adminUpdatesReducer(
      state,
      triggerAdminUpdateCheckSuccess({
        result: { jobId: 'job-1', enqueuedAt: '2024-01-01T00:00:00Z' },
        previousLastCheckAt: null,
      }),
    );
    expect(state.checking).toBe(true);

    state = adminUpdatesReducer(state, triggerAdminUpdateCheckFailure({ error: 'queue down' }));
    expect(state.checking).toBe(false);
    expect(state.error).toBe('queue down');
  });

  it('clears error', () => {
    const state = adminUpdatesReducer({ ...initialAdminUpdatesState, error: 'x' }, clearAdminUpdatesError());

    expect(state.error).toBeNull();
  });
});
