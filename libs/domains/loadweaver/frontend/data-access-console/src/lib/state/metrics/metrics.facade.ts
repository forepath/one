import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';

import type { MetricQuery } from '../../types/metrics.types';
import { loadMetricNames, queryMetrics } from './metrics.actions';
import {
  selectMetricEvents,
  selectMetricNames,
  selectMetricNamesError,
  selectMetricNamesLoading,
  selectMetricQuery,
  selectMetricResult,
  selectMetricsError,
  selectMetricsLoading,
} from './metrics.selectors';

@Injectable()
export class ConsoleMetricsFacade {
  private readonly store = inject(Store);

  readonly names$ = this.store.select(selectMetricNames);
  readonly namesLoading$ = this.store.select(selectMetricNamesLoading);
  readonly namesError$ = this.store.select(selectMetricNamesError);
  readonly query$ = this.store.select(selectMetricQuery);
  readonly result$ = this.store.select(selectMetricResult);
  readonly loading$ = this.store.select(selectMetricsLoading);
  readonly error$ = this.store.select(selectMetricsError);
  readonly events$ = this.store.select(selectMetricEvents);

  loadNames(): void {
    this.store.dispatch(loadMetricNames());
  }

  query(query: MetricQuery): void {
    this.store.dispatch(queryMetrics({ query }));
  }
}
