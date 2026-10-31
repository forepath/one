import { createReducer, on } from '@ngrx/store';

import type { HealthEntity, HealthHistory } from '../../types/health.types';
import {
  loadHealthEntity,
  loadHealthEntityFailure,
  loadHealthEntitySuccess,
  loadHealthHistory,
  loadHealthHistoryFailure,
  loadHealthHistorySuccess,
  loadHealthTree,
  loadHealthTreeFailure,
  loadHealthTreeSuccess,
} from './health.actions';

export interface ConsoleHealthState {
  /** The tree as a flat list (`parent` links). */
  entities: HealthEntity[];
  project: string | null;
  loading: boolean;
  error: string | null;
  /** The entity shown in the detail view, with its descendants. */
  detailKey: string | null;
  detail: HealthEntity[];
  detailLoading: boolean;
  detailError: string | null;
  history: HealthHistory | null;
  historyLoading: boolean;
  historyError: string | null;
}

export const initialConsoleHealthState: ConsoleHealthState = {
  entities: [],
  project: null,
  loading: false,
  error: null,
  detailKey: null,
  detail: [],
  detailLoading: false,
  detailError: null,
  history: null,
  historyLoading: false,
  historyError: null,
};

export const consoleHealthReducer = createReducer(
  initialConsoleHealthState,
  on(loadHealthTree, (state, { project, silent }) => ({
    ...state,
    entities: (project ?? null) === state.project ? state.entities : [],
    project: project ?? null,
    loading: !silent,
    error: null,
  })),
  on(loadHealthTreeSuccess, (state, { entities }) => ({ ...state, entities, loading: false })),
  on(loadHealthTreeFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(loadHealthEntity, (state, { key, silent }) => ({
    ...state,
    detailKey: key,
    detail: key === state.detailKey ? state.detail : [],
    detailLoading: !silent,
    detailError: null,
  })),
  on(loadHealthEntitySuccess, (state, { key, entities }) =>
    key === state.detailKey ? { ...state, detail: entities, detailLoading: false } : state,
  ),
  on(loadHealthEntityFailure, (state, { key, error }) =>
    key === state.detailKey ? { ...state, detailLoading: false, detailError: error } : state,
  ),
  on(loadHealthHistory, (state, { key }) => ({
    ...state,
    history: state.history?.key === key ? state.history : null,
    historyLoading: true,
    historyError: null,
  })),
  on(loadHealthHistorySuccess, (state, { history }) => ({ ...state, history, historyLoading: false })),
  on(loadHealthHistoryFailure, (state, { error }) => ({ ...state, historyLoading: false, historyError: error })),
);
