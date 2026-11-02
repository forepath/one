import { createReducer, on } from '@ngrx/store';

import type { MetricEvent, MetricQuery, MetricResult } from '../../types/metrics.types';
import {
  loadMetricEventsSuccess,
  loadMetricNames,
  loadMetricNamesFailure,
  loadMetricNamesSuccess,
  queryMetrics,
  queryMetricsFailure,
  queryMetricsSuccess,
} from './metrics.actions';

export interface ConsoleMetricsState {
  names: string[];
  namesLoading: boolean;
  namesError: string | null;
  query: MetricQuery | null;
  result: MetricResult | null;
  loading: boolean;
  error: string | null;
  events: MetricEvent[];
}

export const initialConsoleMetricsState: ConsoleMetricsState = {
  names: [],
  namesLoading: false,
  namesError: null,
  query: null,
  result: null,
  loading: false,
  error: null,
  events: [],
};

export const consoleMetricsReducer = createReducer(
  initialConsoleMetricsState,
  on(loadMetricNames, (state) => ({ ...state, namesLoading: true, namesError: null })),
  on(loadMetricNamesSuccess, (state, { names }) => ({ ...state, names, namesLoading: false })),
  on(loadMetricNamesFailure, (state, { error }) => ({ ...state, namesLoading: false, namesError: error })),
  on(queryMetrics, (state, { query }) => ({
    ...state,
    query,
    result: state.query?.metric === query.metric ? state.result : null,
    loading: true,
    error: null,
  })),
  on(queryMetricsSuccess, (state, { query, result }) =>
    query === state.query ? { ...state, result, loading: false } : state,
  ),
  on(queryMetricsFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(loadMetricEventsSuccess, (state, { events }) => ({ ...state, events })),
);
