import { createReducer, on } from '@ngrx/store';

import type {
  MeterHistoryFilters,
  SubscriptionItemDetailResponse,
  SubscriptionMeterHistory,
  SubscriptionMeterSummary,
} from '../../types/billing.types';

import {
  applyFilters,
  clearServiceDetail,
  enterServiceDetail,
  loadDetailFailure,
  loadDetailSuccess,
  loadHistory,
  loadHistoryFailure,
  loadHistorySuccess,
  markServiceDetailSshAccessGranted,
  meterSummaryPush,
  resetFilters,
  updateDisplayName,
  updateDisplayNameFailure,
  updateDisplayNameSuccess,
} from './service-detail.actions';
import { DEFAULT_METER_HISTORY_FILTERS } from './service-detail.constants';

export interface ServiceDetailState {
  subscriptionId: string | null;
  itemId: string | null;
  adminMode: boolean;
  detail: SubscriptionItemDetailResponse | null;
  history: SubscriptionMeterHistory | null;
  filters: MeterHistoryFilters;
  loadingDetail: boolean;
  loadingHistory: boolean;
  renaming: boolean;
  error: string | null;
  metersFromSocket: SubscriptionMeterSummary[] | null;
}

export const initialServiceDetailState: ServiceDetailState = {
  subscriptionId: null,
  itemId: null,
  adminMode: false,
  detail: null,
  history: null,
  filters: DEFAULT_METER_HISTORY_FILTERS,
  loadingDetail: false,
  loadingHistory: false,
  renaming: false,
  error: null,
  metersFromSocket: null,
};

export const serviceDetailReducer = createReducer(
  initialServiceDetailState,
  on(enterServiceDetail, (state, { subscriptionId, itemId, adminMode }) => ({
    ...state,
    subscriptionId,
    itemId,
    adminMode: adminMode === true,
    loadingDetail: true,
    loadingHistory: true,
    error: null,
    metersFromSocket: null,
  })),
  on(loadDetailSuccess, (state, { detail }) => ({
    ...state,
    detail,
    loadingDetail: false,
    error: null,
  })),
  on(loadDetailFailure, (state, { error }) => ({
    ...state,
    loadingDetail: false,
    error,
  })),
  on(loadHistory, (state, { filters }) => ({
    ...state,
    filters,
    loadingHistory: true,
    error: null,
  })),
  on(loadHistorySuccess, (state, { history }) => ({
    ...state,
    history,
    loadingHistory: false,
    error: null,
  })),
  on(loadHistoryFailure, (state, { error }) => ({
    ...state,
    loadingHistory: false,
    error,
  })),
  on(applyFilters, (state, { filters }) => ({
    ...state,
    filters,
    loadingHistory: true,
    error: null,
  })),
  on(resetFilters, (state) => ({
    ...state,
    filters: DEFAULT_METER_HISTORY_FILTERS,
    loadingHistory: true,
    error: null,
  })),
  on(updateDisplayName, (state) => ({
    ...state,
    renaming: true,
    error: null,
  })),
  on(updateDisplayNameSuccess, (state, { displayName }) => ({
    ...state,
    renaming: false,
    detail: state.detail ? { ...state.detail, displayName } : state.detail,
    error: null,
  })),
  on(updateDisplayNameFailure, (state, { error }) => ({
    ...state,
    renaming: false,
    error,
  })),
  on(markServiceDetailSshAccessGranted, (state) => ({
    ...state,
    detail: state.detail ? { ...state.detail, sshAccessGranted: true } : state.detail,
  })),
  on(meterSummaryPush, (state, { subscriptionId, meters }) =>
    state.subscriptionId === subscriptionId
      ? {
          ...state,
          metersFromSocket: meters,
        }
      : state,
  ),
  on(clearServiceDetail, () => initialServiceDetailState),
);
