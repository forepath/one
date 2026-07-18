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

function isNonEmptyProfileField(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Mirrors backend CustomerProfilesService.isProfileComplete required fields. */
export const selectIsCustomerProfileComplete = createSelector(selectCustomerProfile, (profile) => {
  if (profile === null) {
    return false;
  }

  return (
    isNonEmptyProfileField(profile.firstName) &&
    isNonEmptyProfileField(profile.lastName) &&
    isNonEmptyProfileField(profile.email) &&
    isNonEmptyProfileField(profile.addressLine1) &&
    isNonEmptyProfileField(profile.postalCode) &&
    isNonEmptyProfileField(profile.city) &&
    isNonEmptyProfileField(profile.country)
  );
});
