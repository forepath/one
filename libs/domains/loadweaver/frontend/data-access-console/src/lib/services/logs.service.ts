import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

import type { LogExportFormat, LogFilter, LogPage, LogQuery } from '../types/logs.types';
import { ConsoleApi } from './console-api';

/** The query parameters of a log filter (lists comma separated, empty values left out). */
export function logParams(query: LogQuery): HttpParams {
  let params = new HttpParams();

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;

    if (Array.isArray(value)) {
      if (value.length > 0) params = params.set(key, value.join(','));
    } else params = params.set(key, String(value));
  }

  return params;
}

/** Logs (3.14): query by time range, labels and full text, page by cursor, export; scoped by access. */
@Injectable({ providedIn: 'root' })
export class LogsService extends ConsoleApi {
  private readonly http = inject(HttpClient);

  query(query: LogQuery): Observable<LogPage> {
    return this.http.get<LogPage>(this.url('/logs'), { params: logParams(query) });
  }

  /** NDJSON or CSV of the filter (oldest first, up to the API's export limit). */
  export(filter: LogFilter, format: LogExportFormat): Observable<string> {
    return this.http.get(this.url('/logs/export'), {
      params: logParams({ ...filter }).set('format', format),
      responseType: 'text',
    });
  }
}
