import { createReducer, on } from '@ngrx/store';
import { BILLING_LIST_PAGE_SIZE, billingPageWindow } from '../../constants/list-paging.constants';

import type { AdminPromotionResponse, PromotionRedemptionResponse } from '../../types/promotions.types';

import {
  createAdminPromotion,
  createAdminPromotionFailure,
  createAdminPromotionSuccess,
  deactivateAdminPromotion,
  deactivateAdminPromotionFailure,
  deactivateAdminPromotionSuccess,
  loadAdminPromotionRedemptions,
  loadAdminPromotionRedemptionsFailure,
  loadAdminPromotionRedemptionsSuccess,
  loadAdminPromotions,
  loadAdminPromotionsFailure,
  loadAdminPromotionsSuccess,
  updateAdminPromotion,
  updateAdminPromotionFailure,
  updateAdminPromotionSuccess,
} from './admin-promotions.actions';

export interface AdminPromotionsState {
  promotions: AdminPromotionResponse[];
  /** Replace-page paging: server total, 1-based page and its size. */
  total: number;
  page: number;
  pageSize: number;
  redemptions: PromotionRedemptionResponse[];
  redemptionsTotal: number;
  redemptionsPage: number;
  redemptionsPageSize: number;
  /** Promotion whose redemptions are loaded (another one starts empty). */
  redemptionsPromotionId: string | null;
  loading: boolean;
  loadingRedemptions: boolean;
  creating: boolean;
  updating: boolean;
  deactivating: boolean;
  error: string | null;
  search: string | null;
}

export const initialAdminPromotionsState: AdminPromotionsState = {
  promotions: [],
  total: 0,
  page: 1,
  pageSize: BILLING_LIST_PAGE_SIZE,
  redemptions: [],
  redemptionsTotal: 0,
  redemptionsPage: 1,
  redemptionsPageSize: BILLING_LIST_PAGE_SIZE,
  redemptionsPromotionId: null,
  loading: false,
  loadingRedemptions: false,
  creating: false,
  updating: false,
  deactivating: false,
  error: null,
  search: null,
};

export const adminPromotionsReducer = createReducer(
  initialAdminPromotionsState,
  on(loadAdminPromotions, (state, { search, page, pageSize }) => {
    const window = billingPageWindow(page, pageSize ?? state.pageSize);

    return {
      ...state,
      loading: true,
      error: null,
      page: window.page,
      pageSize: window.pageSize,
      search: search?.trim() ? search.trim() : null,
    };
  }),
  on(loadAdminPromotionsSuccess, (state, { promotions, total }) => ({
    ...state,
    promotions,
    total,
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
    total: state.total + 1,
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
  on(loadAdminPromotionRedemptions, (state, { promotionId, page, pageSize }) => {
    const window = billingPageWindow(page, pageSize ?? state.redemptionsPageSize);
    const samePromotion = state.redemptionsPromotionId === promotionId;

    return {
      ...state,
      redemptions: samePromotion ? state.redemptions : [],
      redemptionsTotal: samePromotion ? state.redemptionsTotal : 0,
      redemptionsPromotionId: promotionId,
      loadingRedemptions: true,
      error: null,
      redemptionsPage: window.page,
      redemptionsPageSize: window.pageSize,
    };
  }),
  on(loadAdminPromotionRedemptionsSuccess, (state, { redemptions, total }) => ({
    ...state,
    redemptions,
    redemptionsTotal: total,
    loadingRedemptions: false,
    error: null,
  })),
  on(loadAdminPromotionRedemptionsFailure, (state, { error }) => ({
    ...state,
    loadingRedemptions: false,
    error,
  })),
);
