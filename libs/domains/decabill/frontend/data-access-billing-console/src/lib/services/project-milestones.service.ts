import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/decabill/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/decabill/frontend/util-configuration';
import { Observable } from 'rxjs';

import type {
  CreateProjectMilestoneDto,
  ListProjectMilestonesParams,
  ProjectMilestoneResponse,
  UpdateProjectMilestoneDto,
} from '../types/projects.types';

@Injectable({
  providedIn: 'root',
})
export class ProjectMilestonesService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  private get apiUrl(): string {
    return this.environment.billing.urls.restApi;
  }

  private milestonesUrl(projectId: string): string {
    return `${this.apiUrl}/projects/${projectId}/milestones`;
  }

  list(projectId: string, params?: ListProjectMilestonesParams): Observable<ProjectMilestoneResponse[]> {
    let httpParams = new HttpParams();

    if (params?.search?.trim()) {
      httpParams = httpParams.set('search', params.search.trim());
    }

    if (params?.limit != null) {
      httpParams = httpParams.set('limit', String(params.limit));
    }

    return this.http.get<ProjectMilestoneResponse[]>(this.milestonesUrl(projectId), { params: httpParams });
  }

  create(projectId: string, dto: CreateProjectMilestoneDto): Observable<ProjectMilestoneResponse> {
    return this.http.post<ProjectMilestoneResponse>(this.milestonesUrl(projectId), dto);
  }

  update(projectId: string, id: string, dto: UpdateProjectMilestoneDto): Observable<ProjectMilestoneResponse> {
    return this.http.post<ProjectMilestoneResponse>(`${this.milestonesUrl(projectId)}/${id}`, dto);
  }

  lock(projectId: string, id: string): Observable<ProjectMilestoneResponse> {
    return this.http.post<ProjectMilestoneResponse>(`${this.milestonesUrl(projectId)}/${id}/lock`, {});
  }

  delete(projectId: string, id: string): Observable<void> {
    return this.http.delete<void>(`${this.milestonesUrl(projectId)}/${id}`);
  }
}
