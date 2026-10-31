import { createReducer, on } from '@ngrx/store';

import type { UsageQuery, UsageReport } from '../../types/usage.types';
import { loadUsage, loadUsageFailure, loadUsageSuccess } from './usage.actions';

export interface ConsoleUsageState {
  query: UsageQuery | null;
  report: UsageReport | null;
  loading: boolean;
  error: string | null;
}

export const initialConsoleUsageState: ConsoleUsageState = {
  query: null,
  report: null,
  loading: false,
  error: null,
};

export const consoleUsageReducer = createReducer(
  initialConsoleUsageState,
  on(loadUsage, (state, { query }) => ({ ...state, query, loading: true, error: null })),
  // Answers of an older query (the filter changed meanwhile) are dropped.
  on(loadUsageSuccess, (state, { query, report }) =>
    query === state.query ? { ...state, report, loading: false } : state,
  ),
  on(loadUsageFailure, (state, { query, error }) =>
    query === state.query ? { ...state, report: null, loading: false, error } : state,
  ),
);
