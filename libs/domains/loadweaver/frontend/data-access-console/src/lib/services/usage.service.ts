import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

import type { UsageQuery, UsageReport } from '../types/usage.types';
import { ConsoleApi } from './console-api';

/** The query parameters of a usage query (the project goes into the path). */
export function usageParams(query: UsageQuery): HttpParams {
  let params = new HttpParams().set('granularity', query.granularity);

  if (query.from) params = params.set('from', query.from);

  if (query.to) params = params.set('to', query.to);

  return params;
}

/**
 * Usage metering (3.24): per project and meter by hour, day or month, and the CSV export. A project's usage for its
 * readers; all projects for cluster roles.
 */
@Injectable({ providedIn: 'root' })
export class ConsoleUsageService extends ConsoleApi {
  private readonly http = inject(HttpClient);

  private path(query: UsageQuery, suffix = ''): string {
    return this.url(
      query.project ? `/projects/${encodeURIComponent(query.project)}/usage${suffix}` : `/usage${suffix}`,
    );
  }

  report(query: UsageQuery): Observable<UsageReport> {
    return this.http.get<UsageReport>(this.path(query), { params: usageParams(query) });
  }

  exportCsv(query: UsageQuery): Observable<string> {
    return this.http.get(this.path(query, '/export'), { params: usageParams(query), responseType: 'text' });
  }
}
