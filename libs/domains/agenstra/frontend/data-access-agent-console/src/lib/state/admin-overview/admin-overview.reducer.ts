import { createReducer, on } from '@ngrx/store';

import { loadAdminOverview, loadAdminOverviewFailure, loadAdminOverviewSuccess } from './admin-overview.actions';
import type { AdminOverviewParams, AdminOverviewResponse } from './admin-overview.types';

export interface AdminOverviewState {
  overview: AdminOverviewResponse | null;
  /** Params of the latest load (the viewed workspace and range). */
  params: AdminOverviewParams | null;
  loading: boolean;
  error: string | null;
}

export const initialAdminOverviewState: AdminOverviewState = {
  overview: null,
  params: null,
  loading: false,
  error: null,
};

export const adminOverviewReducer = createReducer(
  initialAdminOverviewState,
  on(loadAdminOverview, (state, { params }) => ({ ...state, params, loading: true, error: null })),
  on(loadAdminOverviewSuccess, (state, { overview }) => ({ ...state, overview, loading: false })),
  // A failed load must not keep showing the previous scope's figures.
  on(loadAdminOverviewFailure, (state, { error }) => ({ ...state, overview: null, loading: false, error })),
);
