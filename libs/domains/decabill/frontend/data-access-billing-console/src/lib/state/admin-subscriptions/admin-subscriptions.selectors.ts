import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { AdminSubscriptionsState } from './admin-subscriptions.reducer';

export const selectAdminSubscriptionsState = createFeatureSelector<AdminSubscriptionsState>('adminSubscriptions');

export const selectAdminSubscriptions = createSelector(selectAdminSubscriptionsState, (state) => state.subscriptions);

export const selectAdminSubscriptionsLoading = createSelector(selectAdminSubscriptionsState, (state) => state.loading);

export const selectAdminSubscriptionsCanceling = createSelector(
  selectAdminSubscriptionsState,
  (state) => state.canceling,
);

export const selectAdminSubscriptionsWithdrawing = createSelector(
  selectAdminSubscriptionsState,
  (state) => state.withdrawing,
);

export const selectAdminSubscriptionsInstantCanceling = createSelector(
  selectAdminSubscriptionsState,
  (state) => state.instantCanceling,
);

export const selectAdminSubscriptionsResuming = createSelector(
  selectAdminSubscriptionsState,
  (state) => state.resuming,
);

export const selectAdminSubscriptionsError = createSelector(selectAdminSubscriptionsState, (state) => state.error);

export const selectAdminSubscriptionsTotal = createSelector(selectAdminSubscriptionsState, (state) => state.total);

export const selectAdminSubscriptionsPage = createSelector(selectAdminSubscriptionsState, (state) => state.page);

export const selectAdminSubscriptionsPageSize = createSelector(
  selectAdminSubscriptionsState,
  (state) => state.pageSize,
);
