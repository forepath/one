import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

import type { Draft, DraftOpInput, DraftPatchRequest, DraftPreview, DraftStatus } from '../types/drafts.types';
import type { Plan } from '../types/plans.types';
import { ConsoleApi } from './console-api';

/**
 * Workspace drafts (3.36): shared, server-side drafts of resource changes. Writes carry the version they are based on
 * (`If-Match`); a 409 answers with the current draft (`error.draft`) or the conflicting ops (`error.conflicts`).
 */
@Injectable({ providedIn: 'root' })
export class DraftsService extends ConsoleApi {
  private readonly http = inject(HttpClient);

  list(status: DraftStatus = 'open'): Observable<Draft[]> {
    return this.http.get<Draft[]>(this.url('/drafts'), { params: new HttpParams().set('status', status) });
  }

  get(id: string): Observable<Draft> {
    return this.http.get<Draft>(this.url(`/drafts/${encodeURIComponent(id)}`));
  }

  create(title: string, ops: DraftOpInput[] = []): Observable<Draft> {
    return this.http.post<Draft>(this.url('/drafts'), { title, ...(ops.length ? { ops } : {}) });
  }

  patch(id: string, version: number, request: DraftPatchRequest): Observable<Draft> {
    return this.http.patch<Draft>(this.url(`/drafts/${encodeURIComponent(id)}`), request, {
      headers: ifMatch(version),
    });
  }

  /** Dry run: nothing is stored. */
  preview(id: string): Observable<DraftPreview> {
    return this.http.post<DraftPreview>(this.url(`/drafts/${encodeURIComponent(id)}/preview`), {});
  }

  submit(id: string, version: number): Observable<Plan> {
    return this.http.post<Plan>(
      this.url(`/drafts/${encodeURIComponent(id)}/submit`),
      {},
      { headers: ifMatch(version) },
    );
  }

  discard(id: string, version: number): Observable<Draft> {
    return this.http.post<Draft>(
      this.url(`/drafts/${encodeURIComponent(id)}/discard`),
      {},
      { headers: ifMatch(version) },
    );
  }
}

function ifMatch(version: number): HttpHeaders {
  return new HttpHeaders({ 'If-Match': `"${version}"` });
}
