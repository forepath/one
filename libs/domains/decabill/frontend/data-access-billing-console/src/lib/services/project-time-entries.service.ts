import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/shared/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import { Observable } from 'rxjs';

import type { ListParams } from '../types/billing.types';
import type {
  CreateProjectTimeEntryDto,
  PaginatedProjectTimeEntriesResponse,
  ProjectTimeEntryResponse,
  UpdateProjectTimeEntryDto,
} from '../types/projects.types';

export interface ProjectTimeEntriesListParams extends ListParams {
  ticketId?: string;
}

@Injectable({
  providedIn: 'root',
})
export class ProjectTimeEntriesService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  private get apiUrl(): string {
    return this.environment.billing.restApiUrl;
  }

  private timeEntriesUrl(projectId: string): string {
    return `${this.apiUrl}/projects/${projectId}/time-entries`;
  }

  list(projectId: string, params?: ProjectTimeEntriesListParams): Observable<PaginatedProjectTimeEntriesResponse> {
    let httpParams = new HttpParams();

    if (params?.limit != null) httpParams = httpParams.set('limit', String(params.limit));

    if (params?.offset != null) httpParams = httpParams.set('offset', String(params.offset));

    if (params?.ticketId) httpParams = httpParams.set('ticketId', params.ticketId);

    return this.http.get<PaginatedProjectTimeEntriesResponse>(this.timeEntriesUrl(projectId), {
      params: httpParams,
    });
  }

  create(projectId: string, dto: CreateProjectTimeEntryDto): Observable<ProjectTimeEntryResponse> {
    return this.http.post<ProjectTimeEntryResponse>(this.timeEntriesUrl(projectId), dto);
  }

  update(projectId: string, id: string, dto: UpdateProjectTimeEntryDto): Observable<ProjectTimeEntryResponse> {
    return this.http.post<ProjectTimeEntryResponse>(`${this.timeEntriesUrl(projectId)}/${id}`, dto);
  }

  delete(projectId: string, id: string): Observable<void> {
    return this.http.delete<void>(`${this.timeEntriesUrl(projectId)}/${id}`);
  }
}
