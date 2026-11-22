import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { AdminOverviewState } from './admin-overview.reducer';

export const selectAdminOverviewState = createFeatureSelector<AdminOverviewState>('adminOverview');

export const selectAdminOverview = createSelector(selectAdminOverviewState, (state) => state.overview);
export const selectAdminOverviewParams = createSelector(selectAdminOverviewState, (state) => state.params);
export const selectAdminOverviewLoading = createSelector(selectAdminOverviewState, (state) => state.loading);
export const selectAdminOverviewError = createSelector(selectAdminOverviewState, (state) => state.error);
