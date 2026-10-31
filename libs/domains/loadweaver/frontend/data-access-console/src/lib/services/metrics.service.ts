import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

import type { MetricEvent, MetricEventQuery, MetricQuery, MetricResult } from '../types/metrics.types';
import { ConsoleApi } from './console-api';

function params(query: object): HttpParams {
  let result = new HttpParams();

  for (const [key, value] of Object.entries(query))
    if (value !== undefined && value !== null && value !== '') result = result.set(key, String(value));

  return result;
}

/** Metrics and event markers (3.18), scoped by access; resolution picked by range. */
@Injectable({ providedIn: 'root' })
export class MetricsService extends ConsoleApi {
  private readonly http = inject(HttpClient);

  query(query: MetricQuery): Observable<MetricResult> {
    return this.http.get<MetricResult>(this.url('/metrics/query'), { params: params(query) });
  }

  events(query: MetricEventQuery = {}): Observable<MetricEvent[]> {
    return this.http.get<MetricEvent[]>(this.url('/metrics/events'), { params: params(query) });
  }

  /**
   * The metric names with samples in the last hour the caller can read
   * (`GET /metrics/names`, scope `metrics:read`).
   */
  names(): Observable<string[]> {
    return this.http.get<string[]>(this.url('/metrics/names'));
  }
}
