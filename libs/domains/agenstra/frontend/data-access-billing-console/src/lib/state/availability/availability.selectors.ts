import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { AvailabilityState } from './availability.reducer';

export const selectAvailabilityState = createFeatureSelector<AvailabilityState>('availability');

export const selectAvailability = createSelector(selectAvailabilityState, (state) => state.availability);

export const selectAvailabilityAlternatives = createSelector(selectAvailabilityState, (state) => state.alternatives);

export const selectPricingPreview = createSelector(selectAvailabilityState, (state) => state.pricing);

export const selectAvailabilityLoading = createSelector(selectAvailabilityState, (state) => state.loadingAvailability);

export const selectAvailabilityAlternativesLoading = createSelector(
  selectAvailabilityState,
  (state) => state.loadingAlternatives,
);

export const selectPricingPreviewLoading = createSelector(selectAvailabilityState, (state) => state.loadingPricing);

export const selectAvailabilityError = createSelector(selectAvailabilityState, (state) => state.error);

export const selectAvailabilityLoadingAny = createSelector(
  selectAvailabilityLoading,
  selectAvailabilityAlternativesLoading,
  selectPricingPreviewLoading,
  (loadingAvailability, loadingAlternatives, loadingPricing) =>
    loadingAvailability || loadingAlternatives || loadingPricing,
);

export const selectIsAvailable = createSelector(
  selectAvailability,
  (availability) => availability?.isAvailable ?? false,
);

export const selectAvailabilityReason = createSelector(
  selectAvailability,
  (availability) => availability?.reason ?? null,
);

export const selectHasAlternatives = createSelector(
  selectAvailabilityAlternatives,
  (alternatives) => alternatives?.alternatives !== undefined && alternatives.alternatives !== null,
);
