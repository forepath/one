import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/shared/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import { Observable } from 'rxjs';

import type { ListParams } from '../types/billing.types';
import type { PaginatedProjectsResponse, ProjectResponse, ProjectSummaryResponse } from '../types/projects.types';

@Injectable({
  providedIn: 'root',
})
export class ProjectsService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  private get apiUrl(): string {
    return this.environment.billing.restApiUrl;
  }

  list(params?: ListParams): Observable<PaginatedProjectsResponse> {
    let httpParams = new HttpParams();

    if (params?.limit != null) httpParams = httpParams.set('limit', String(params.limit));

    if (params?.offset != null) httpParams = httpParams.set('offset', String(params.offset));

    return this.http.get<PaginatedProjectsResponse>(`${this.apiUrl}/projects`, { params: httpParams });
  }

  getById(projectId: string): Observable<ProjectResponse> {
    return this.http.get<ProjectResponse>(`${this.apiUrl}/projects/${projectId}`);
  }

  getSummary(projectId: string): Observable<ProjectSummaryResponse> {
    return this.http.get<ProjectSummaryResponse>(`${this.apiUrl}/projects/${projectId}/summary`);
  }
}
