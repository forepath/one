import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { SubscriptionMetersState } from './subscription-meters.reducer';

export const selectSubscriptionMetersState = createFeatureSelector<SubscriptionMetersState>('subscriptionMeters');
export const selectSubscriptionMeterSummaries = createSelector(
  selectSubscriptionMetersState,
  (state) => state.summaries,
);
export const selectSubscriptionMeterEntries = createSelector(selectSubscriptionMetersState, (state) => state.entries);
export const selectSubscriptionMetersSubscriptionId = createSelector(
  selectSubscriptionMetersState,
  (state) => state.subscriptionId,
);
export const selectSubscriptionMetersLoadingSummaries = createSelector(
  selectSubscriptionMetersState,
  (state) => state.loadingSummaries,
);
export const selectSubscriptionMetersLoadingEntries = createSelector(
  selectSubscriptionMetersState,
  (state) => state.loadingEntries,
);
export const selectSubscriptionMetersCreating = createSelector(
  selectSubscriptionMetersState,
  (state) => state.creating,
);
export const selectSubscriptionMetersUpdating = createSelector(
  selectSubscriptionMetersState,
  (state) => state.updating,
);
export const selectSubscriptionMetersDeleting = createSelector(
  selectSubscriptionMetersState,
  (state) => state.deleting,
);
export const selectSubscriptionMetersError = createSelector(selectSubscriptionMetersState, (state) => state.error);
export const selectSubscriptionMetersLoadingAny = createSelector(
  selectSubscriptionMetersState,
  (state) => state.loadingSummaries || state.loadingEntries || state.creating || state.updating || state.deleting,
);
