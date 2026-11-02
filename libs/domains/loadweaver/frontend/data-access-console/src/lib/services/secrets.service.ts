import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, type Observable } from 'rxjs';

import { ConsoleApi } from './console-api';

export interface SecretNamesResponse {
  items: { name: string }[];
}

export interface SecretNamesQuery {
  q?: string;
  limit?: number;
}

export interface SecretUsage {
  kind: string;
  project: string;
  name: string;
  pinnedVersion: number | null;
}

export interface SecretSummary {
  project: string;
  name: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
  reserved: boolean;
  usedBy: SecretUsage[];
}

export interface SecretInUseError {
  message: string;
  usedBy: SecretUsage[];
}

/** Write-only secret administration; values exist only in the submitted HTTP body. */
@Injectable({ providedIn: 'root' })
export class SecretsService extends ConsoleApi {
  private readonly http = inject(HttpClient);

  list(project: string): Observable<SecretSummary[]> {
    return this.http
      .get<{ items: SecretSummary[] }>(this.url(`/projects/${encodeURIComponent(project)}/secrets`))
      .pipe(map(({ items }) => items));
  }

  listAll(query: { project?: string; q?: string; limit?: number } = {}): Observable<SecretSummary[]> {
    let params = new HttpParams();
    if (query.project !== undefined) params = params.set('project', query.project);
    if (query.q !== undefined) params = params.set('q', query.q);
    if (query.limit !== undefined) params = params.set('limit', query.limit);
    return this.http.get<{ items: SecretSummary[] }>(this.url('/secrets'), { params }).pipe(map(({ items }) => items));
  }

  setValue(project: string, name: string, value: string): Observable<SecretSummary> {
    return this.http.put<SecretSummary>(
      this.url(`/projects/${encodeURIComponent(project)}/secrets/${encodeURIComponent(name)}`),
      { value },
    );
  }

  delete(project: string, name: string): Observable<void> {
    return this.http.delete<void>(
      this.url(`/projects/${encodeURIComponent(project)}/secrets/${encodeURIComponent(name)}`),
    );
  }

  listNames(project: string, query: SecretNamesQuery = {}): Observable<SecretNamesResponse> {
    let params = new HttpParams().set('limit', query.limit ?? 50);

    if (query.q !== undefined) params = params.set('q', query.q);

    return this.http.get<SecretNamesResponse>(this.url(`/projects/${encodeURIComponent(project)}/secrets/names`), {
      params,
    });
  }
}
