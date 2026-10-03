import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/decabill/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/decabill/frontend/util-configuration';
import { Observable } from 'rxjs';

import type { ListParams } from '../types/billing.types';
import type {
  PaginatedProjectsResponse,
  ProjectResponse,
  ProjectSummaryResponse,
  ProjectsCatalogSummaryResponse,
} from '../types/projects.types';

@Injectable({
  providedIn: 'root',
})
export class ProjectsService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  private get apiUrl(): string {
    return this.environment.billing.urls.restApi;
  }

  list(params?: ListParams): Observable<PaginatedProjectsResponse> {
    let httpParams = new HttpParams();

    if (params?.limit != null) httpParams = httpParams.set('limit', String(params.limit));

    if (params?.offset != null) httpParams = httpParams.set('offset', String(params.offset));

    if (params?.search?.trim()) httpParams = httpParams.set('search', params.search.trim());

    return this.http.get<PaginatedProjectsResponse>(`${this.apiUrl}/projects`, { params: httpParams });
  }

  getById(projectId: string): Observable<ProjectResponse> {
    return this.http.get<ProjectResponse>(`${this.apiUrl}/projects/${projectId}`);
  }

  getCatalogSummary(): Observable<ProjectsCatalogSummaryResponse> {
    return this.http.get<ProjectsCatalogSummaryResponse>(`${this.apiUrl}/projects/summary`);
  }

  getSummary(projectId: string): Observable<ProjectSummaryResponse> {
    return this.http.get<ProjectSummaryResponse>(`${this.apiUrl}/projects/${projectId}/summary`);
  }
}
