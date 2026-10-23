import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

import type { Alert, AlertExportFormat, AlertListQuery, AlertSilence, CreateAlertSilence } from '../types/alerts.types';
import { ConsoleApi } from './console-api';

function listParams(query: AlertListQuery): HttpParams {
  let params = new HttpParams();

  if (query.state) params = params.set('state', query.state);

  if (query.project) params = params.set('project', query.project);

  if (query.limit) params = params.set('limit', query.limit);

  return params;
}

/** Alerts, acknowledgements and silences (3.18). */
@Injectable({ providedIn: 'root' })
export class AlertsService extends ConsoleApi {
  private readonly http = inject(HttpClient);

  /** Newest first; `state` defaults to `open` (pending and firing). */
  list(query: AlertListQuery = {}): Observable<Alert[]> {
    return this.http.get<Alert[]>(this.url('/alerts'), { params: listParams(query) });
  }

  /** The export as text (CSV or JSON) with the list's filters; `state` defaults to `all`. */
  export(query: AlertListQuery, format: AlertExportFormat): Observable<string> {
    return this.http.get(this.url('/alerts/export'), {
      params: listParams(query).set('format', format),
      responseType: 'text',
    });
  }

  /** One alert in any state (`GET /alerts/{id}`); 404 when it doesn't exist or isn't visible. */
  get(id: string): Observable<Alert> {
    return this.http.get<Alert>(this.url(`/alerts/${encodeURIComponent(id)}`));
  }

  acknowledge(id: string): Observable<Alert> {
    return this.http.post<Alert>(this.url(`/alerts/${encodeURIComponent(id)}/acknowledge`), {});
  }

  /** Active and upcoming silences; `expired` includes ended ones. */
  silences(expired = false): Observable<AlertSilence[]> {
    return this.http.get<AlertSilence[]>(this.url('/alerts/silences'), {
      params: expired ? new HttpParams().set('expired', 'true') : undefined,
    });
  }

  createSilence(silence: CreateAlertSilence): Observable<AlertSilence> {
    return this.http.post<AlertSilence>(this.url('/alerts/silences'), silence);
  }

  /** Ends a silence now; it stays as history. */
  endSilence(id: string): Observable<void> {
    return this.http.delete<void>(this.url(`/alerts/silences/${encodeURIComponent(id)}`));
  }
}
