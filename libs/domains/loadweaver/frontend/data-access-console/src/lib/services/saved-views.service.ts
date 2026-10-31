import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { type Observable, of, throwError } from 'rxjs';

import type { CreateSavedViewRequest, SavedView, UpdateSavedViewRequest } from '../types/saved-views.types';
import { ConsoleApi } from './console-api';

/**
 * Saved views / filters per user, server-side (3.37): `GET/POST/PATCH/DELETE /views`. Only the caller's own views; in
 * fleet mode the verified person's on the active cluster (relayed only with the signed identity claim).
 */
@Injectable({ providedIn: 'root' })
export class ConsoleSavedViewsService extends ConsoleApi {
  private readonly http = inject(HttpClient);

  /** Whether views can be stored: not on the fleet views (fleet mode without an active cluster, nothing to call). */
  available(): boolean {
    return this.endpoints.hasClusterApi();
  }

  /** The caller's views, sorted by scope and name; only one scope when given (none without a cluster API). */
  list(scope?: string): Observable<SavedView[]> {
    if (!this.available()) return of([]);

    return this.http.get<SavedView[]>(this.url('/views'), {
      params: scope ? new HttpParams().set('scope', scope) : undefined,
    });
  }

  /** 409 when the scope already has a view of this name. */
  create(request: CreateSavedViewRequest): Observable<SavedView> {
    if (!this.available()) return unavailable();

    return this.http.post<SavedView>(this.url('/views'), request);
  }

  update(id: string, request: UpdateSavedViewRequest): Observable<SavedView> {
    if (!this.available()) return unavailable();

    return this.http.patch<SavedView>(this.url(`/views/${encodeURIComponent(id)}`), request);
  }

  remove(id: string): Observable<void> {
    if (!this.available()) return unavailable();

    return this.http.delete<void>(this.url(`/views/${encodeURIComponent(id)}`));
  }
}

function unavailable(): Observable<never> {
  return throwError(() => new Error('saved views need an active cluster'));
}
