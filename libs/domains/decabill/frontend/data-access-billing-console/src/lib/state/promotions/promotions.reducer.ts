import { createReducer, on } from '@ngrx/store';

import { BILLING_LIST_PAGE_SIZE, billingPageWindow } from '../../constants/list-paging.constants';

import type {
  PromotionRedemptionContext,
  PromotionRedemptionResponse,
  PromotionValidationResponse,
  ValidatePromotionRequest,
} from '../../types/promotions.types';

import {
  clearPromotionValidation,
  loadActivePromotions,
  loadActivePromotionsFailure,
  loadActivePromotionsSuccess,
  loadPromotionRedemptions,
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
  activeSearch: string | null;
  redemptionsSearch: string | null;
  /** Replace-page paging of both tabs: server total, 1-based page and its size. */
  activeTotal: number;
  activePage: number;
  activePageSize: number;
  redemptionsTotal: number;
  redemptionsPage: number;
  redemptionsPageSize: number;
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
  activeSearch: null,
  redemptionsSearch: null,
  activeTotal: 0,
  activePage: 1,
  activePageSize: BILLING_LIST_PAGE_SIZE,
  redemptionsTotal: 0,
  redemptionsPage: 1,
  redemptionsPageSize: BILLING_LIST_PAGE_SIZE,
};

export function buildPromotionTargetKey(request: ValidatePromotionRequest): string {
  return `${request.code.trim().toLowerCase()}:${request.subscriptionId ?? request.planId ?? ''}:${request.redemptionContext}`;
}

export const promotionsReducer = createReducer(
  initialPromotionsState,
  on(loadActivePromotions, (state, { search, page, pageSize }) => {
    const window = billingPageWindow(page, pageSize ?? state.activePageSize);

    return {
      ...state,
      loadingActive: true,
      error: null,
      activePage: window.page,
      activePageSize: window.pageSize,
      activeSearch: search?.trim() ? search.trim() : null,
    };
  }),
  on(loadActivePromotionsSuccess, (state, { items, total }) => ({
    ...state,
    activePromotions: items,
    activeTotal: total,
    loadingActive: false,
    error: null,
  })),
  on(loadActivePromotionsFailure, (state, { error }) => ({
    ...state,
    loadingActive: false,
    error,
  })),
  on(loadPromotionRedemptions, (state, { search, page, pageSize }) => {
    const window = billingPageWindow(page, pageSize ?? state.redemptionsPageSize);

    return {
      ...state,
      loadingRedemptions: true,
      error: null,
      redemptionsPage: window.page,
      redemptionsPageSize: window.pageSize,
      redemptionsSearch: search?.trim() ? search.trim() : null,
    };
  }),
  on(loadPromotionRedemptionsSuccess, (state, { items, total }) => ({
    ...state,
    redemptions: items,
    redemptionsTotal: total,
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
  on(redeemPromotionSuccess, (state) => ({
    ...state,
    redeeming: false,
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
