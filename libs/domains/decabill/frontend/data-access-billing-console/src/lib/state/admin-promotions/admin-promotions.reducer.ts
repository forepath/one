import { createReducer, on } from '@ngrx/store';

import type { AdminPromotionResponse, PromotionRedemptionResponse } from '../../types/promotions.types';

import {
  createAdminPromotion,
  createAdminPromotionFailure,
  createAdminPromotionSuccess,
  deactivateAdminPromotion,
  deactivateAdminPromotionFailure,
  deactivateAdminPromotionSuccess,
  loadAdminPromotionRedemptions,
  loadAdminPromotionRedemptionsBatch,
  loadAdminPromotionRedemptionsFailure,
  loadAdminPromotionRedemptionsSuccess,
  loadAdminPromotions,
  loadAdminPromotionsBatch,
  loadAdminPromotionsFailure,
  loadAdminPromotionsSuccess,
  updateAdminPromotion,
  updateAdminPromotionFailure,
  updateAdminPromotionSuccess,
} from './admin-promotions.actions';

export interface AdminPromotionsState {
  promotions: AdminPromotionResponse[];
  redemptions: PromotionRedemptionResponse[];
  loading: boolean;
  loadingRedemptions: boolean;
  creating: boolean;
  updating: boolean;
  deactivating: boolean;
  error: string | null;
}

export const initialAdminPromotionsState: AdminPromotionsState = {
  promotions: [],
  redemptions: [],
  loading: false,
  loadingRedemptions: false,
  creating: false,
  updating: false,
  deactivating: false,
  error: null,
};

export const adminPromotionsReducer = createReducer(
  initialAdminPromotionsState,
  on(loadAdminPromotions, (state) => ({
    ...state,
    promotions: [],
    loading: true,
    error: null,
  })),
  on(loadAdminPromotionsBatch, (state, { accumulated }) => ({
    ...state,
    promotions: accumulated,
    loading: true,
  })),
  on(loadAdminPromotionsSuccess, (state, { promotions }) => ({
    ...state,
    promotions,
    loading: false,
    error: null,
  })),
  on(loadAdminPromotionsFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),
  on(createAdminPromotion, (state) => ({ ...state, creating: true, error: null })),
  on(createAdminPromotionSuccess, (state, { promotion }) => ({
    ...state,
    creating: false,
    promotions: [promotion, ...state.promotions],
  })),
  on(createAdminPromotionFailure, (state, { error }) => ({ ...state, creating: false, error })),
  on(updateAdminPromotion, (state) => ({ ...state, updating: true, error: null })),
  on(updateAdminPromotionSuccess, (state, { promotion }) => ({
    ...state,
    updating: false,
    promotions: state.promotions.map((item) => (item.id === promotion.id ? promotion : item)),
  })),
  on(updateAdminPromotionFailure, (state, { error }) => ({ ...state, updating: false, error })),
  on(deactivateAdminPromotion, (state) => ({ ...state, deactivating: true, error: null })),
  on(deactivateAdminPromotionSuccess, (state, { promotion }) => ({
    ...state,
    deactivating: false,
    promotions: state.promotions.map((item) => (item.id === promotion.id ? promotion : item)),
  })),
  on(deactivateAdminPromotionFailure, (state, { error }) => ({ ...state, deactivating: false, error })),
  on(loadAdminPromotionRedemptions, (state) => ({
    ...state,
    redemptions: [],
    loadingRedemptions: true,
    error: null,
  })),
  on(loadAdminPromotionRedemptionsBatch, (state, { accumulated }) => ({
    ...state,
    redemptions: accumulated,
    loadingRedemptions: true,
  })),
  on(loadAdminPromotionRedemptionsSuccess, (state, { redemptions }) => ({
    ...state,
    redemptions,
    loadingRedemptions: false,
    error: null,
  })),
  on(loadAdminPromotionRedemptionsFailure, (state, { error }) => ({
    ...state,
    loadingRedemptions: false,
    error,
  })),
);
