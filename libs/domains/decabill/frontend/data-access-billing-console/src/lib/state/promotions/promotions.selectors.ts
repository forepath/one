import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { PromotionRedemptionContext, ValidatePromotionRequest } from '../../types/promotions.types';

import { buildPromotionTargetKey, type PromotionsState } from './promotions.reducer';

export const selectPromotionsState = createFeatureSelector<PromotionsState>('promotions');

export const selectActivePromotions = createSelector(selectPromotionsState, (state) => state.activePromotions);
export const selectPromotionRedemptions = createSelector(selectPromotionsState, (state) => state.redemptions);
export const selectActivePromotionsLoading = createSelector(selectPromotionsState, (state) => state.loadingActive);
export const selectPromotionRedemptionsLoading = createSelector(
  selectPromotionsState,
  (state) => state.loadingRedemptions,
);
export const selectPromotionValidationPreview = createSelector(
  selectPromotionsState,
  (state) => state.validationPreview,
);
export const selectPromotionValidationLoading = createSelector(
  selectPromotionsState,
  (state) => state.validationLoading,
);
export const selectPromotionValidationError = createSelector(selectPromotionsState, (state) => state.validationError);
export const selectPromotionRedeeming = createSelector(selectPromotionsState, (state) => state.redeeming);
export const selectPromotionRedeemError = createSelector(selectPromotionsState, (state) => state.redeemError);

export const selectPromotionValidationPreviewForContext = (context: PromotionRedemptionContext) =>
  createSelector(selectPromotionsState, (state) =>
    state.validationContext === context ? state.validationPreview : null,
  );

export const selectPromotionValidationErrorForContext = (context: PromotionRedemptionContext) =>
  createSelector(selectPromotionsState, (state) =>
    state.validationContext === context ? state.validationError : null,
  );

export const selectPromotionValidationLoadingForContext = (context: PromotionRedemptionContext) =>
  createSelector(selectPromotionsState, (state) =>
    state.validationContext === context ? state.validationLoading : false,
  );

export const selectCanRedeemPromotion = (request: ValidatePromotionRequest | null) =>
  createSelector(selectPromotionsState, (state) => {
    if (!request?.code?.trim() || !state.validatedTargetKey || !state.validationPreview?.valid) {
      return false;
    }

    return state.validatedTargetKey === buildPromotionTargetKey(request);
  });
