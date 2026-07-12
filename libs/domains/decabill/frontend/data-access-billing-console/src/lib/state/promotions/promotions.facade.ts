import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';

import type {
  PromotionRedemptionContext,
  RedeemPromotionRequest,
  ValidatePromotionRequest,
} from '../../types/promotions.types';

import {
  clearPromotionValidation,
  loadActivePromotions,
  loadPromotionRedemptions,
  redeemPromotion,
  validatePromotion,
} from './promotions.actions';
import {
  selectActivePromotions,
  selectActivePromotionsLoading,
  selectCanRedeemPromotion,
  selectPromotionRedeemError,
  selectPromotionRedeeming,
  selectPromotionRedemptions,
  selectPromotionRedemptionsLoading,
  selectPromotionValidationErrorForContext,
  selectPromotionValidationLoadingForContext,
  selectPromotionValidationPreviewForContext,
} from './promotions.selectors';

@Injectable()
export class PromotionsFacade {
  private readonly store = inject(Store);

  getActivePromotions$() {
    return this.store.select(selectActivePromotions);
  }

  getRedemptions$() {
    return this.store.select(selectPromotionRedemptions);
  }

  getActiveLoading$() {
    return this.store.select(selectActivePromotionsLoading);
  }

  getRedemptionsLoading$() {
    return this.store.select(selectPromotionRedemptionsLoading);
  }

  getValidationPreview$(context: PromotionRedemptionContext) {
    return this.store.select(selectPromotionValidationPreviewForContext(context));
  }

  getValidationLoading$(context: PromotionRedemptionContext) {
    return this.store.select(selectPromotionValidationLoadingForContext(context));
  }

  getValidationError$(context: PromotionRedemptionContext) {
    return this.store.select(selectPromotionValidationErrorForContext(context));
  }

  getRedeeming$() {
    return this.store.select(selectPromotionRedeeming);
  }

  getRedeemError$() {
    return this.store.select(selectPromotionRedeemError);
  }

  canRedeem$(request: ValidatePromotionRequest | null) {
    return this.store.select(selectCanRedeemPromotion(request));
  }

  loadActivePromotions(): void {
    this.store.dispatch(loadActivePromotions());
  }

  loadRedemptions(): void {
    this.store.dispatch(loadPromotionRedemptions());
  }

  validatePromotion(request: ValidatePromotionRequest): void {
    this.store.dispatch(validatePromotion({ request }));
  }

  clearValidation(): void {
    this.store.dispatch(clearPromotionValidation());
  }

  redeemPromotion(request: RedeemPromotionRequest): void {
    this.store.dispatch(redeemPromotion({ request }));
  }
}
