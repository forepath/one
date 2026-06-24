import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { BillingCapabilitiesState } from './billing-capabilities.reducer';

export const selectBillingCapabilitiesState = createFeatureSelector<BillingCapabilitiesState>('billingCapabilities');

export const selectBillingCapabilities = createSelector(selectBillingCapabilitiesState, (state) => state.capabilities);

export const selectDatevExportEnabled = createSelector(
  selectBillingCapabilities,
  (capabilities) => capabilities?.datevExportEnabled ?? false,
);

export const selectUnifiedExportAllowed = createSelector(
  selectBillingCapabilities,
  (capabilities) => capabilities?.unifiedExportAllowed ?? false,
);

export const selectBillingCapabilitiesLoading = createSelector(
  selectBillingCapabilitiesState,
  (state) => state.loading,
);
