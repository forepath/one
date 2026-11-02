import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

import type { HealthEntity, HealthHistory, HealthHistoryQuery, HealthTreeQuery } from '../types/health.types';
import { ConsoleApi } from './console-api';

/** The explained health tree (3.25). */
@Injectable({ providedIn: 'root' })
export class HealthService extends ConsoleApi {
  private readonly http = inject(HttpClient);

  /** What the caller may see; optionally one project or one entity (`root`) and its descendants. */
  tree(query: HealthTreeQuery = {}): Observable<HealthEntity[]> {
    let params = new HttpParams();

    if (query.project) params = params.set('project', query.project);

    if (query.root) params = params.set('root', query.root);

    return this.http.get<HealthEntity[]>(this.url('/health/tree'), { params });
  }

  /** Changes of one entity in a range (default the last 30 days) and the time spent per state. */
  history(query: HealthHistoryQuery): Observable<HealthHistory> {
    let params = new HttpParams().set('key', query.key);

    if (query.from) params = params.set('from', query.from);

    if (query.to) params = params.set('to', query.to);

    return this.http.get<HealthHistory>(this.url('/health/history'), { params });
  }
}
