import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

import type { DashboardQueryRequest, DashboardQueryResult, DashboardResource } from '../types/metrics.types';
import { ConsoleApi } from './console-api';

/** Custom dashboards (3.18): `Dashboard` resources, their widgets run through the query builder. */
@Injectable({ providedIn: 'root' })
export class DashboardsService extends ConsoleApi {
  private readonly http = inject(HttpClient);

  /** The dashboards the caller may read (cluster-wide ones for cluster roles, their projects' ones). */
  list(): Observable<DashboardResource[]> {
    return this.http.get<DashboardResource[]>(this.url('/resources'), {
      params: new HttpParams().set('kind', 'Dashboard'),
    });
  }

  query(request: DashboardQueryRequest): Observable<DashboardQueryResult> {
    return this.http.post<DashboardQueryResult>(this.url('/dashboards/query'), request);
  }
}
