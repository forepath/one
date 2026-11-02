import { createAction, props } from '@ngrx/store';

import type { MetricEvent, MetricQuery, MetricResult } from '../../types/metrics.types';

export const loadMetricNames = createAction('[ConsoleMetrics] Load Names');
export const loadMetricNamesSuccess = createAction('[ConsoleMetrics] Load Names Success', props<{ names: string[] }>());
export const loadMetricNamesFailure = createAction('[ConsoleMetrics] Load Names Failure', props<{ error: string }>());

/** The series of one metric and the event markers in its range. */
export const queryMetrics = createAction('[ConsoleMetrics] Query', props<{ query: MetricQuery }>());
export const queryMetricsSuccess = createAction(
  '[ConsoleMetrics] Query Success',
  props<{ query: MetricQuery; result: MetricResult }>(),
);
export const queryMetricsFailure = createAction('[ConsoleMetrics] Query Failure', props<{ error: string }>());
export const loadMetricEventsSuccess = createAction(
  '[ConsoleMetrics] Load Events Success',
  props<{ events: MetricEvent[] }>(),
);
