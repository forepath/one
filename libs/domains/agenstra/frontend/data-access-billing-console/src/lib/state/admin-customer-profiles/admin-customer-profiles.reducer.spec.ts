import { loadAdminCustomerProfiles, loadAdminCustomerProfilesSuccess } from './admin-customer-profiles.actions';
import { adminCustomerProfilesReducer, initialAdminCustomerProfilesState } from './admin-customer-profiles.reducer';

describe('adminCustomerProfilesReducer', () => {
  it('sets loading on load', () => {
    const state = adminCustomerProfilesReducer(initialAdminCustomerProfilesState, loadAdminCustomerProfiles());

    expect(state.loading).toBe(true);
  });

  it('stores profiles on success', () => {
    const profiles = [
      {
        id: 'p-1',
        userId: 'u-1',
        isComplete: false,
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01',
      },
    ];
    const state = adminCustomerProfilesReducer(
      { ...initialAdminCustomerProfilesState, loading: true },
      loadAdminCustomerProfilesSuccess({ profiles }),
    );

    expect(state.profiles).toEqual(profiles);
    expect(state.loading).toBe(false);
  });
});
