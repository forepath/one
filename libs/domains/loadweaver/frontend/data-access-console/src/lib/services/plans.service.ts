import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

import type { CreatePlanRequest, Plan, PlanListQuery } from '../types/plans.types';
import { ConsoleApi } from './console-api';

/** Plan → apply (3.8): review, approve, apply, cancel and discard plans. */
@Injectable({ providedIn: 'root' })
export class PlansService extends ConsoleApi {
  private readonly http = inject(HttpClient);

  /** The newest plans the caller may see, filtered by status and project on the server. */
  list(query: PlanListQuery = {}): Observable<Plan[]> {
    let params = new HttpParams().set('limit', query.limit ?? 50);

    if (query.status) params = params.set('status', query.status);

    if (query.project) params = params.set('project', query.project);

    return this.http.get<Plan[]>(this.url('/plans'), { params });
  }

  /** Plans a change (nothing is written until the plan is applied); 400 carries the issues per document and path. */
  create(request: CreatePlanRequest): Observable<Plan> {
    return this.http.post<Plan>(this.url('/plans'), request);
  }

  get(id: string): Observable<Plan> {
    return this.http.get<Plan>(this.url(`/plans/${encodeURIComponent(id)}`));
  }

  /** `confirm`: confirms the unacknowledged pins in the plan's warnings (3.12). */
  apply(id: string, confirm = false): Observable<Plan> {
    return this.http.post<Plan>(this.url(`/plans/${encodeURIComponent(id)}/apply`), { confirm });
  }

  approve(id: string): Observable<Plan> {
    return this.http.post<Plan>(this.url(`/plans/${encodeURIComponent(id)}/approve`), {});
  }

  /** Stops a running apply at the next safe point; it then rolls back. */
  cancel(id: string): Observable<Plan> {
    return this.http.post<Plan>(this.url(`/plans/${encodeURIComponent(id)}/cancel`), {});
  }

  discard(id: string): Observable<Plan> {
    return this.http.post<Plan>(this.url(`/plans/${encodeURIComponent(id)}/discard`), {});
  }
}
