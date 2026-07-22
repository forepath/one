import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { AdminBillingState } from './admin-billing.reducer';

export const selectAdminBillingState = createFeatureSelector<AdminBillingState>('adminBilling');

export const selectAdminBillingSummary = createSelector(selectAdminBillingState, (state) => state.summary);
export const selectAdminBillingSummaryLoading = createSelector(
  selectAdminBillingState,
  (state) => state.summaryLoading,
);
export const selectAdminBillingSummaryError = createSelector(selectAdminBillingState, (state) => state.summaryError);

export const selectBillNowLoading = createSelector(selectAdminBillingState, (state) => state.billNowLoading);
export const selectBillNowResult = createSelector(selectAdminBillingState, (state) => state.billNowResult);
export const selectBillNowError = createSelector(selectAdminBillingState, (state) => state.billNowError);

export const selectAdminOpenOverdueItems = createSelector(selectAdminBillingState, (state) => state.openOverdueItems);
export const selectAdminOpenOverdueTotal = createSelector(selectAdminBillingState, (state) => state.openOverdueTotal);
export const selectAdminOpenOverdueLoading = createSelector(
  selectAdminBillingState,
  (state) => state.openOverdueLoading,
);
export const selectAdminOpenOverdueError = createSelector(selectAdminBillingState, (state) => state.openOverdueError);

export const selectAdminActionLoading = createSelector(selectAdminBillingState, (state) => state.actionLoading);
export const selectAdminActionError = createSelector(selectAdminBillingState, (state) => state.actionError);

export const selectAdminStatisticsSummary = createSelector(selectAdminBillingState, (state) => state.statisticsSummary);
export const selectAdminStatisticsSummaryLoading = createSelector(
  selectAdminBillingState,
  (state) => state.statisticsSummaryLoading,
);
export const selectAdminStatisticsByProduct = createSelector(
  selectAdminBillingState,
  (state) => state.statisticsByProduct,
);
export const selectAdminStatisticsByProductLoading = createSelector(
  selectAdminBillingState,
  (state) => state.statisticsByProductLoading,
);
export const selectAdminStatisticsByCountry = createSelector(
  selectAdminBillingState,
  (state) => state.statisticsByCountry,
);
export const selectAdminStatisticsByCountryLoading = createSelector(
  selectAdminBillingState,
  (state) => state.statisticsByCountryLoading,
);
export const selectAdminStatisticsError = createSelector(selectAdminBillingState, (state) => state.statisticsError);

export const selectAdminAuditLogsByInvoice = createSelector(
  selectAdminBillingState,
  (state) => state.auditLogsByInvoice,
);
export const selectAdminAuditLogsLoading = createSelector(selectAdminBillingState, (state) => state.auditLogsLoading);
export const selectAdminAuditLogsError = createSelector(selectAdminBillingState, (state) => state.auditLogsError);
