import type { AdminCustomerProfilesState } from './admin-customer-profiles.reducer';
import {
  selectAdminCustomerProfiles,
  selectAdminCustomerProfilesCreating,
  selectAdminCustomerProfilesDeleting,
  selectAdminCustomerProfilesError,
  selectAdminCustomerProfilesLoading,
  selectAdminCustomerProfilesState,
  selectAdminCustomerProfilesUpdating,
} from './admin-customer-profiles.selectors';

describe('adminCustomerProfilesSelectors', () => {
  const state: AdminCustomerProfilesState = {
    profiles: [{ id: 'p-1', userId: 'u-1', isComplete: true, createdAt: '', updatedAt: '' }],
    loading: true,
    creating: true,
    updating: true,
    deleting: true,
    error: 'err',
  };
  const rootState = { adminCustomerProfiles: state };

  it('selects state slice', () => {
    expect(selectAdminCustomerProfilesState(rootState as never)).toEqual(state);
  });

  it('selects profiles', () => {
    expect(selectAdminCustomerProfiles(rootState as never)).toEqual(state.profiles);
  });

  it('selects loading flags', () => {
    expect(selectAdminCustomerProfilesLoading(rootState as never)).toBe(true);
    expect(selectAdminCustomerProfilesCreating(rootState as never)).toBe(true);
    expect(selectAdminCustomerProfilesUpdating(rootState as never)).toBe(true);
    expect(selectAdminCustomerProfilesDeleting(rootState as never)).toBe(true);
  });

  it('selects error', () => {
    expect(selectAdminCustomerProfilesError(rootState as never)).toBe('err');
  });
});
