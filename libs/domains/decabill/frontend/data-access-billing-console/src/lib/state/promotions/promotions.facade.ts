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
  selectActivePromotionsTotal,
  selectCanRedeemPromotion,
  selectPromotionRedeemError,
  selectPromotionRedeeming,
  selectPromotionRedemptions,
  selectPromotionRedemptionsLoading,
  selectPromotionRedemptionsTotal,
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

  getActiveTotal$() {
    return this.store.select(selectActivePromotionsTotal);
  }

  getRedemptionsTotal$() {
    return this.store.select(selectPromotionRedemptionsTotal);
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

  /** One page of the active promotions (replace-page; page 1 by default). */
  loadActivePromotions(params?: { search?: string; page?: number; pageSize?: number }): void {
    this.store.dispatch(
      loadActivePromotions({ search: params?.search, page: params?.page, pageSize: params?.pageSize }),
    );
  }

  /** One page of the redemption history (replace-page; page 1 by default). */
  loadRedemptions(params?: { search?: string; page?: number; pageSize?: number }): void {
    this.store.dispatch(
      loadPromotionRedemptions({ search: params?.search, page: params?.page, pageSize: params?.pageSize }),
    );
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
