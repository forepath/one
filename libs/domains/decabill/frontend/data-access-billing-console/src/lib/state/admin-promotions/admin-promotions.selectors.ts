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
