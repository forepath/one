import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

import type { ConsoleResource, JsonSchema, ResourceKey, ResourceKindInfo } from '../types/resources.types';
import { ConsoleApi } from './console-api';

/**
 * Desired state (3.29): resources the caller may read (cluster-level ones for cluster roles, project ones for whoever
 * may read the project) and the published JSON Schemas. Changes go through plans (`PlansService.create`).
 */
@Injectable({ providedIn: 'root' })
export class ResourcesService extends ConsoleApi {
  private readonly http = inject(HttpClient);

  /** Every readable resource, or those of one kind. */
  list<S = Record<string, unknown>>(kind?: string): Observable<ConsoleResource<S>[]> {
    return this.http.get<ConsoleResource<S>[]>(this.url('/resources'), {
      params: kind ? new HttpParams().set('kind', kind) : undefined,
    });
  }

  get(key: ResourceKey): Observable<ConsoleResource> {
    return this.http.get<ConsoleResource>(
      this.url(`/resources/${encodeURIComponent(key.kind)}/${encodeURIComponent(key.name)}`),
      { params: key.project ? new HttpParams().set('project', key.project) : undefined },
    );
  }

  /** Every kind with its description (public). */
  kinds(): Observable<ResourceKindInfo[]> {
    return this.http.get<ResourceKindInfo[]>(this.url('/schemas'));
  }

  /** The JSON Schema (draft 2020-12) of a kind (public). */
  schema(kind: string): Observable<JsonSchema> {
    return this.http.get<JsonSchema>(this.url(`/schemas/${encodeURIComponent(kind)}`));
  }
}
