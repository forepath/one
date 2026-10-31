import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { AdminPromotionsState } from './admin-promotions.reducer';

export const selectAdminPromotionsState = createFeatureSelector<AdminPromotionsState>('adminPromotions');

export const selectAdminPromotions = createSelector(selectAdminPromotionsState, (state) => state.promotions);
export const selectAdminPromotionsLoading = createSelector(selectAdminPromotionsState, (state) => state.loading);
export const selectAdminPromotionRedemptions = createSelector(selectAdminPromotionsState, (state) => state.redemptions);
export const selectAdminPromotionRedemptionsLoading = createSelector(
  selectAdminPromotionsState,
  (state) => state.loadingRedemptions,
);
export const selectAdminPromotionsCreating = createSelector(selectAdminPromotionsState, (state) => state.creating);
export const selectAdminPromotionsUpdating = createSelector(selectAdminPromotionsState, (state) => state.updating);
export const selectAdminPromotionsDeactivating = createSelector(
  selectAdminPromotionsState,
  (state) => state.deactivating,
);
export const selectAdminPromotionsError = createSelector(selectAdminPromotionsState, (state) => state.error);
export const selectAdminPromotionsTotal = createSelector(selectAdminPromotionsState, (state) => state.total);
export const selectAdminPromotionsPage = createSelector(selectAdminPromotionsState, (state) => state.page);
export const selectAdminPromotionsPageSize = createSelector(selectAdminPromotionsState, (state) => state.pageSize);
export const selectAdminPromotionRedemptionsTotal = createSelector(
  selectAdminPromotionsState,
  (state) => state.redemptionsTotal,
);
