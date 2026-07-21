import {
  createAdminCustomerProfile,
  createAdminCustomerProfileFailure,
  createAdminCustomerProfileSuccess,
  deleteAdminCustomerProfile,
  deleteAdminCustomerProfileFailure,
  deleteAdminCustomerProfileSuccess,
  loadAdminCustomerProfiles,
  loadAdminCustomerProfilesBatch,
  loadAdminCustomerProfileTrustScore,
  loadAdminCustomerProfileTrustScoreFailure,
  loadAdminCustomerProfileTrustScoreSuccess,
  loadAdminCustomerProfilesFailure,
  loadAdminCustomerProfilesSuccess,
  recomputeAdminCustomerProfileTrustScore,
  recomputeAdminCustomerProfileTrustScoreFailure,
  recomputeAdminCustomerProfileTrustScoreSuccess,
  updateAdminCustomerProfile,
  updateAdminCustomerProfileFailure,
  updateAdminCustomerProfileSuccess,
} from './admin-customer-profiles.actions';
import { adminCustomerProfilesReducer, initialAdminCustomerProfilesState } from './admin-customer-profiles.reducer';

describe('adminCustomerProfilesReducer', () => {
  const listItem = {
    id: 'p-1',
    userId: 'u-1',
    isComplete: false,
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
  };
  const trustDetail = {
    profileId: 'p-1',
    userId: 'u-1',
    score: 120,
    level: 'green' as const,
    baseScore: 100,
    computedAt: '2024-01-03',
    factors: [],
    sources: ['internal_billing'],
  };
  const profileResponse = {
    id: 'p-1',
    userId: 'u-1',
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    country: 'DE',
    createdAt: '2024-01-01',
    updatedAt: '2024-01-02',
  };

  it('sets loading on load', () => {
    const state = adminCustomerProfilesReducer(initialAdminCustomerProfilesState, loadAdminCustomerProfiles());

    expect(state.loading).toBe(true);
    expect(state.profiles).toEqual([]);
    expect(state.error).toBeNull();
  });

  it('stores accumulated profiles on batch', () => {
    const state = adminCustomerProfilesReducer(
      initialAdminCustomerProfilesState,
      loadAdminCustomerProfilesBatch({ offset: 10, accumulatedProfiles: [listItem] }),
    );

    expect(state.profiles).toEqual([listItem]);
    expect(state.loading).toBe(true);
  });

  it('stores profiles on success', () => {
    const state = adminCustomerProfilesReducer(
      { ...initialAdminCustomerProfilesState, loading: true },
      loadAdminCustomerProfilesSuccess({ profiles: [listItem] }),
    );

    expect(state.profiles).toEqual([listItem]);
    expect(state.loading).toBe(false);
  });

  it('stores error on load failure', () => {
    const state = adminCustomerProfilesReducer(
      { ...initialAdminCustomerProfilesState, loading: true },
      loadAdminCustomerProfilesFailure({ error: 'Load failed' }),
    );

    expect(state.loading).toBe(false);
    expect(state.error).toBe('Load failed');
  });

  it('sets creating on create', () => {
    const state = adminCustomerProfilesReducer(
      initialAdminCustomerProfilesState,
      createAdminCustomerProfile({
        dto: { userId: 'u-1', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
      }),
    );

    expect(state.creating).toBe(true);
  });

  it('prepends profile on create success', () => {
    const state = adminCustomerProfilesReducer(
      { ...initialAdminCustomerProfilesState, profiles: [listItem], creating: true },
      createAdminCustomerProfileSuccess({ profile: profileResponse }),
    );

    expect(state.creating).toBe(false);
    expect(state.profiles).toHaveLength(2);
    expect(state.profiles[0].firstName).toBe('Ada');
  });

  it('stores error on create failure', () => {
    const state = adminCustomerProfilesReducer(
      { ...initialAdminCustomerProfilesState, creating: true },
      createAdminCustomerProfileFailure({ error: 'Create failed' }),
    );

    expect(state.creating).toBe(false);
    expect(state.error).toBe('Create failed');
  });

  it('updates profile on update success', () => {
    const state = adminCustomerProfilesReducer(
      { ...initialAdminCustomerProfilesState, profiles: [listItem], updating: true },
      updateAdminCustomerProfileSuccess({ profile: profileResponse }),
    );

    expect(state.updating).toBe(false);
    expect(state.profiles[0].firstName).toBe('Ada');
    expect(state.profiles[0].updatedAt).toBe('2024-01-02');
  });

  it('stores error on update failure', () => {
    const state = adminCustomerProfilesReducer(
      { ...initialAdminCustomerProfilesState, updating: true },
      updateAdminCustomerProfileFailure({ error: 'Update failed' }),
    );

    expect(state.updating).toBe(false);
    expect(state.error).toBe('Update failed');
  });

  it('removes profile on delete success', () => {
    const state = adminCustomerProfilesReducer(
      { ...initialAdminCustomerProfilesState, profiles: [listItem], deleting: true },
      deleteAdminCustomerProfileSuccess({ id: 'p-1' }),
    );

    expect(state.deleting).toBe(false);
    expect(state.profiles).toEqual([]);
  });

  it('stores error on delete failure', () => {
    const state = adminCustomerProfilesReducer(
      { ...initialAdminCustomerProfilesState, deleting: true },
      deleteAdminCustomerProfileFailure({ error: 'Delete failed' }),
    );

    expect(state.deleting).toBe(false);
    expect(state.error).toBe('Delete failed');
  });

  it('stores trust detail on load success', () => {
    const loadingState = adminCustomerProfilesReducer(
      { ...initialAdminCustomerProfilesState, profiles: [listItem] },
      loadAdminCustomerProfileTrustScore({ id: 'p-1' }),
    );
    const state = adminCustomerProfilesReducer(
      loadingState,
      loadAdminCustomerProfileTrustScoreSuccess({ detail: trustDetail }),
    );

    expect(state.trustScoreLoading).toBe(false);
    expect(state.trustScoreDetail?.score).toBe(120);
    expect(state.profiles[0].trustLevel).toBe('green');
  });

  it('stores trust detail on recompute success', () => {
    const refreshingState = adminCustomerProfilesReducer(
      { ...initialAdminCustomerProfilesState, profiles: [listItem] },
      recomputeAdminCustomerProfileTrustScore({ id: 'p-1' }),
    );
    const state = adminCustomerProfilesReducer(
      refreshingState,
      recomputeAdminCustomerProfileTrustScoreSuccess({ detail: trustDetail }),
    );

    expect(state.trustScoreRefreshing).toBe(false);
    expect(state.trustScoreDetail?.level).toBe('green');
  });

  it('stores trust errors', () => {
    const loadErrorState = adminCustomerProfilesReducer(
      { ...initialAdminCustomerProfilesState, trustScoreLoading: true },
      loadAdminCustomerProfileTrustScoreFailure({ error: 'Trust load failed' }),
    );
    const recomputeErrorState = adminCustomerProfilesReducer(
      { ...initialAdminCustomerProfilesState, trustScoreRefreshing: true },
      recomputeAdminCustomerProfileTrustScoreFailure({ error: 'Trust recompute failed' }),
    );

    expect(loadErrorState.error).toBe('Trust load failed');
    expect(recomputeErrorState.error).toBe('Trust recompute failed');
  });
});
