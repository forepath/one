import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/shared/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import { Observable } from 'rxjs';

import type {
  CreateProjectMilestoneDto,
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
    return this.environment.billing.restApiUrl;
  }

  private milestonesUrl(projectId: string): string {
    return `${this.apiUrl}/projects/${projectId}/milestones`;
  }

  list(projectId: string): Observable<ProjectMilestoneResponse[]> {
    return this.http.get<ProjectMilestoneResponse[]>(this.milestonesUrl(projectId));
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
