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

export const selectGlobalViewsAllowed = createSelector(
  selectBillingCapabilities,
  (capabilities) => capabilities?.globalViewsAllowed ?? false,
);

export const selectViewableTenants = createSelector(
  selectBillingCapabilities,
  (capabilities) => capabilities?.viewableTenants ?? [],
);

export const selectFileSigningEnabled = createSelector(
  selectBillingCapabilities,
  (capabilities) => capabilities?.fileSigningEnabled ?? false,
);

export const selectAccountingEnabled = createSelector(
  selectBillingCapabilities,
  (capabilities) => capabilities?.accountingEnabled ?? false,
);

export const selectAccountingGlobalAccess = createSelector(
  selectBillingCapabilities,
  (capabilities) => capabilities?.accountingGlobalAccess ?? false,
);

export const selectEinvoiceFormats = createSelector(
  selectBillingCapabilities,
  (capabilities) => capabilities?.einvoiceFormats ?? [],
);

export const selectEinvoiceDefaultFormat = createSelector(
  selectBillingCapabilities,
  (capabilities) => capabilities?.einvoiceDefaultFormat ?? null,
);

export const selectBillingCapabilitiesLoading = createSelector(
  selectBillingCapabilitiesState,
  (state) => state.loading,
);

/** Documents can be sent as letters (postal provider configured for the tenant). */
export const selectPostalDeliveryAvailable = createSelector(
  selectBillingCapabilities,
  (capabilities) => capabilities?.postalDelivery?.available === true,
);
