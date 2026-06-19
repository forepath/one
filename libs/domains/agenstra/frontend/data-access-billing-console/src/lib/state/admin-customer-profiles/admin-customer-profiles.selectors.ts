import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { AdminCustomerProfilesState } from './admin-customer-profiles.reducer';

export const selectAdminCustomerProfilesState =
  createFeatureSelector<AdminCustomerProfilesState>('adminCustomerProfiles');

export const selectAdminCustomerProfiles = createSelector(selectAdminCustomerProfilesState, (state) => state.profiles);

export const selectAdminCustomerProfilesLoading = createSelector(
  selectAdminCustomerProfilesState,
  (state) => state.loading,
);

export const selectAdminCustomerProfilesCreating = createSelector(
  selectAdminCustomerProfilesState,
  (state) => state.creating,
);

export const selectAdminCustomerProfilesUpdating = createSelector(
  selectAdminCustomerProfilesState,
  (state) => state.updating,
);

export const selectAdminCustomerProfilesDeleting = createSelector(
  selectAdminCustomerProfilesState,
  (state) => state.deleting,
);

export const selectAdminCustomerProfilesError = createSelector(
  selectAdminCustomerProfilesState,
  (state) => state.error,
);
