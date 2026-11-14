import { initialAdminUpdatesState } from './admin-updates.reducer';
import {
  selectAdminUpdatesFullState,
  selectAdminUpdatesHasAttention,
  selectAdminUpdatesStatus,
} from './admin-updates.selectors';

describe('adminUpdatesSelectors', () => {
  it('selects status and full state', () => {
    const status = {
      installedVersion: '1.0.0',
      latestVersion: '1.1.0',
      updateState: 'update_available' as const,
      lastCheckAt: null,
      lastCheckStatus: 'success' as const,
      instanceCount: 2,
      outdatedInstanceCount: 1,
    };
    const fullState = {
      ...status,
      release: null,
      instances: [],
      scopedChangelog: { product: [], shared: [] },
    };
    const state = {
      adminUpdates: {
        ...initialAdminUpdatesState,
        status,
        fullState,
      },
    };

    expect(selectAdminUpdatesStatus(state)).toEqual(status);
    expect(selectAdminUpdatesFullState(state)).toEqual(fullState);
  });

  it('detects attention when update is available', () => {
    const state = {
      adminUpdates: {
        ...initialAdminUpdatesState,
        status: {
          installedVersion: '1.0.0',
          latestVersion: '1.1.0',
          updateState: 'update_available' as const,
          lastCheckAt: null,
          lastCheckStatus: 'success' as const,
          instanceCount: 1,
          outdatedInstanceCount: 0,
        },
      },
    };

    expect(selectAdminUpdatesHasAttention(state)).toBe(true);
  });

  it('detects attention when instances are outdated', () => {
    const state = {
      adminUpdates: {
        ...initialAdminUpdatesState,
        status: {
          installedVersion: '1.0.0',
          latestVersion: '1.0.0',
          updateState: 'up_to_date' as const,
          lastCheckAt: null,
          lastCheckStatus: 'success' as const,
          instanceCount: 2,
          outdatedInstanceCount: 1,
        },
      },
    };

    expect(selectAdminUpdatesHasAttention(state)).toBe(true);
  });

  it('returns false when status is missing', () => {
    expect(selectAdminUpdatesHasAttention({ adminUpdates: initialAdminUpdatesState })).toBe(false);
  });
});
