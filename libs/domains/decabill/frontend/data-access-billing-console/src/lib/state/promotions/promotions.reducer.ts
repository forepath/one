import { createReducer, on } from '@ngrx/store';

import type {
  PromotionRedemptionContext,
  PromotionRedemptionResponse,
  PromotionValidationResponse,
  ValidatePromotionRequest,
} from '../../types/promotions.types';

import {
  clearPromotionValidation,
  loadActivePromotions,
  loadActivePromotionsBatch,
  loadActivePromotionsFailure,
  loadActivePromotionsSuccess,
  loadPromotionRedemptions,
  loadPromotionRedemptionsBatch,
  loadPromotionRedemptionsFailure,
  loadPromotionRedemptionsSuccess,
  redeemPromotion,
  redeemPromotionFailure,
  redeemPromotionSuccess,
  validatePromotion,
  validatePromotionFailure,
  validatePromotionSuccess,
} from './promotions.actions';

export interface PromotionsState {
  activePromotions: PromotionRedemptionResponse[];
  redemptions: PromotionRedemptionResponse[];
  loadingActive: boolean;
  loadingRedemptions: boolean;
  validationPreview: PromotionValidationResponse | null;
  validationLoading: boolean;
  validationError: string | null;
  validationContext: PromotionRedemptionContext | null;
  validatedTargetKey: string | null;
  redeeming: boolean;
  redeemError: string | null;
  error: string | null;
}

export const initialPromotionsState: PromotionsState = {
  activePromotions: [],
  redemptions: [],
  loadingActive: false,
  loadingRedemptions: false,
  validationPreview: null,
  validationLoading: false,
  validationError: null,
  validationContext: null,
  validatedTargetKey: null,
  redeeming: false,
  redeemError: null,
  error: null,
};

export function buildPromotionTargetKey(request: ValidatePromotionRequest): string {
  return `${request.code.trim().toLowerCase()}:${request.subscriptionId ?? request.planId ?? ''}:${request.redemptionContext}`;
}

export const promotionsReducer = createReducer(
  initialPromotionsState,
  on(loadActivePromotions, (state) => ({
    ...state,
    activePromotions: [],
    loadingActive: true,
    error: null,
  })),
  on(loadActivePromotionsBatch, (state, { accumulated }) => ({
    ...state,
    activePromotions: accumulated,
    loadingActive: true,
  })),
  on(loadActivePromotionsSuccess, (state, { items }) => ({
    ...state,
    activePromotions: items,
    loadingActive: false,
    error: null,
  })),
  on(loadActivePromotionsFailure, (state, { error }) => ({
    ...state,
    loadingActive: false,
    error,
  })),
  on(loadPromotionRedemptions, (state) => ({
    ...state,
    redemptions: [],
    loadingRedemptions: true,
    error: null,
  })),
  on(loadPromotionRedemptionsBatch, (state, { accumulated }) => ({
    ...state,
    redemptions: accumulated,
    loadingRedemptions: true,
  })),
  on(loadPromotionRedemptionsSuccess, (state, { items }) => ({
    ...state,
    redemptions: items,
    loadingRedemptions: false,
    error: null,
  })),
  on(loadPromotionRedemptionsFailure, (state, { error }) => ({
    ...state,
    loadingRedemptions: false,
    error,
  })),
  on(validatePromotion, (state, { request }) => ({
    ...state,
    validationLoading: true,
    validationError: null,
    validationPreview: null,
    validationContext: request.redemptionContext,
    validatedTargetKey: null,
  })),
  on(validatePromotionSuccess, (state, { request, preview }) => ({
    ...state,
    validationLoading: false,
    validationPreview: preview,
    validationError: preview.valid ? null : (preview.message ?? null),
    validationContext: request.redemptionContext,
    validatedTargetKey: preview.valid ? buildPromotionTargetKey(request) : null,
  })),
  on(validatePromotionFailure, (state, { error }) => ({
    ...state,
    validationLoading: false,
    validationError: error,
    validationPreview: null,
    validatedTargetKey: null,
  })),
  on(clearPromotionValidation, (state) => ({
    ...state,
    validationPreview: null,
    validationLoading: false,
    validationError: null,
    validationContext: null,
    validatedTargetKey: null,
  })),
  on(redeemPromotion, (state) => ({
    ...state,
    redeeming: true,
    redeemError: null,
  })),
  on(redeemPromotionSuccess, (state, { redemption }) => ({
    ...state,
    redeeming: false,
    activePromotions: [redemption, ...state.activePromotions],
    redemptions: [redemption, ...state.redemptions],
    validationPreview: null,
    validationContext: null,
    validatedTargetKey: null,
  })),
  on(redeemPromotionFailure, (state, { error }) => ({
    ...state,
    redeeming: false,
    redeemError: error,
  })),
);
