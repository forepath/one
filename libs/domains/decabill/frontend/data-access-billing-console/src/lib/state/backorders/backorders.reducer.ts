import { createReducer, on } from '@ngrx/store';

import { BILLING_LIST_PAGE_SIZE } from '../../constants/list-paging.constants';

import type { BackorderResponse } from '../../types/billing.types';

import {
  cancelBackorder,
  cancelBackorderFailure,
  cancelBackorderSuccess,
  clearSelectedBackorder,
  loadBackorders,
  loadBackordersFailure,
  loadBackordersSuccess,
  retryBackorder,
  retryBackorderFailure,
  retryBackorderSuccess,
} from './backorders.actions';

export interface BackordersState {
  entities: BackorderResponse[];
  selectedBackorder: BackorderResponse | null;
  loading: boolean;
  retrying: boolean;
  canceling: boolean;
  error: string | null;
  /** Replace-page paging: next page exists, 1-based page and its size. */
  hasMore: boolean;
  page: number;
  pageSize: number;
}

export const initialBackordersState: BackordersState = {
  entities: [],
  selectedBackorder: null,
  loading: false,
  retrying: false,
  canceling: false,
  error: null,
  hasMore: false,
  page: 1,
  pageSize: BILLING_LIST_PAGE_SIZE,
};

export const backordersReducer = createReducer(
  initialBackordersState,
  // Load Backorders
  on(loadBackorders, (state, { params }) => {
    const pageSize = params?.limit && params.limit > 0 ? params.limit : BILLING_LIST_PAGE_SIZE;

    return {
      ...state,
      loading: true,
      error: null,
      page: Math.floor((params?.offset ?? 0) / pageSize) + 1,
      pageSize,
    };
  }),
  on(loadBackordersSuccess, (state, { backorders, hasMore }) => ({
    ...state,
    entities: backorders,
    hasMore,
    loading: false,
    error: null,
  })),
  on(loadBackordersFailure, (state, { error }) => ({
    ...state,
    entities: [],
    hasMore: false,
    loading: false,
    error,
  })),
  // Retry Backorder
  on(retryBackorder, (state) => ({
    ...state,
    retrying: true,
    error: null,
  })),
  on(retryBackorderSuccess, (state, { backorder }) => ({
    ...state,
    entities: state.entities.map((b) => (b.id === backorder.id ? backorder : b)),
    selectedBackorder: state.selectedBackorder?.id === backorder.id ? backorder : state.selectedBackorder,
    retrying: false,
    error: null,
  })),
  on(retryBackorderFailure, (state, { error }) => ({
    ...state,
    retrying: false,
    error,
  })),
  // Cancel Backorder
  on(cancelBackorder, (state) => ({
    ...state,
    canceling: true,
    error: null,
  })),
  on(cancelBackorderSuccess, (state, { backorder }) => ({
    ...state,
    entities: state.entities.map((b) => (b.id === backorder.id ? backorder : b)),
    selectedBackorder: state.selectedBackorder?.id === backorder.id ? backorder : state.selectedBackorder,
    canceling: false,
    error: null,
  })),
  on(cancelBackorderFailure, (state, { error }) => ({
    ...state,
    canceling: false,
    error,
  })),
  // Clear Selected Backorder
  on(clearSelectedBackorder, (state) => ({
    ...state,
    selectedBackorder: null,
  })),
);
