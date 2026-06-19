import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { CustomerProfileState } from './customer-profile.reducer';

export const selectCustomerProfileState = createFeatureSelector<CustomerProfileState>('customerProfile');

export const selectCustomerProfile = createSelector(selectCustomerProfileState, (state) => state.profile);

export const selectCustomerProfileLoading = createSelector(selectCustomerProfileState, (state) => state.loading);

export const selectCustomerProfileUpdating = createSelector(selectCustomerProfileState, (state) => state.updating);

export const selectCustomerProfileError = createSelector(selectCustomerProfileState, (state) => state.error);

export const selectCustomerProfileLoadingAny = createSelector(
  selectCustomerProfileLoading,
  selectCustomerProfileUpdating,
  (loading, updating) => loading || updating,
);

export const selectHasCustomerProfile = createSelector(selectCustomerProfile, (profile) => profile !== null);

export const selectIsCustomerProfileComplete = createSelector(
  selectCustomerProfile,
  (profile) =>
    profile !== null &&
    profile.firstName !== null &&
    profile.lastName !== null &&
    profile.email !== null &&
    profile.addressLine1 !== null &&
    profile.city !== null &&
    profile.country !== null,
);
