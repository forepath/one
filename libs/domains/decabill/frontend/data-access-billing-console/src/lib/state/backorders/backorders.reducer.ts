import { createReducer, on } from '@ngrx/store';

import type { BackorderResponse } from '../../types/billing.types';

import {
  cancelBackorder,
  cancelBackorderFailure,
  cancelBackorderSuccess,
  clearSelectedBackorder,
  loadBackorders,
  loadBackordersBatch,
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
}

export const initialBackordersState: BackordersState = {
  entities: [],
  selectedBackorder: null,
  loading: false,
  retrying: false,
  canceling: false,
  error: null,
};

export const backordersReducer = createReducer(
  initialBackordersState,
  // Load Backorders
  on(loadBackorders, (state) => ({
    ...state,
    entities: [],
    loading: true,
    error: null,
  })),
  on(loadBackordersBatch, (state, { accumulatedBackorders }) => ({
    ...state,
    entities: accumulatedBackorders,
    loading: true,
    error: null,
  })),
  on(loadBackordersSuccess, (state, { backorders }) => ({
    ...state,
    entities: backorders,
    loading: false,
    error: null,
  })),
  on(loadBackordersFailure, (state, { error }) => ({
    ...state,
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
