import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/shared/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import { Observable } from 'rxjs';

import type {
  CreateProjectTicketCommentDto,
  CreateProjectTicketDto,
  ListProjectTicketsParams,
  ProjectTicketActivityResponse,
  ProjectTicketCommentResponse,
  ProjectTicketResponse,
  UpdateProjectTicketDto,
} from '../types/projects.types';

@Injectable({
  providedIn: 'root',
})
export class ProjectTicketsService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  private get apiUrl(): string {
    return this.environment.billing.restApiUrl;
  }

  private ticketsUrl(projectId: string): string {
    return `${this.apiUrl}/projects/${projectId}/tickets`;
  }

  list(params: ListProjectTicketsParams): Observable<ProjectTicketResponse[]> {
    let httpParams = new HttpParams();

    if (params.status) httpParams = httpParams.set('status', params.status);

    if (params.parentId === null) {
      httpParams = httpParams.set('parentId', 'null');
    } else if (params.parentId !== undefined) {
      httpParams = httpParams.set('parentId', params.parentId);
    }

    return this.http.get<ProjectTicketResponse[]>(this.ticketsUrl(params.projectId), { params: httpParams });
  }

  getById(projectId: string, ticketId: string, includeDescendants = false): Observable<ProjectTicketResponse> {
    let httpParams = new HttpParams();

    if (includeDescendants) httpParams = httpParams.set('includeDescendants', 'true');

    return this.http.get<ProjectTicketResponse>(`${this.ticketsUrl(projectId)}/${ticketId}`, { params: httpParams });
  }

  create(projectId: string, dto: CreateProjectTicketDto): Observable<ProjectTicketResponse> {
    return this.http.post<ProjectTicketResponse>(this.ticketsUrl(projectId), dto);
  }

  update(projectId: string, ticketId: string, dto: UpdateProjectTicketDto): Observable<ProjectTicketResponse> {
    return this.http.post<ProjectTicketResponse>(`${this.ticketsUrl(projectId)}/${ticketId}`, dto);
  }

  delete(projectId: string, ticketId: string): Observable<void> {
    return this.http.delete<void>(`${this.ticketsUrl(projectId)}/${ticketId}`);
  }

  listComments(projectId: string, ticketId: string): Observable<ProjectTicketCommentResponse[]> {
    return this.http.get<ProjectTicketCommentResponse[]>(`${this.ticketsUrl(projectId)}/${ticketId}/comments`);
  }

  addComment(
    projectId: string,
    ticketId: string,
    dto: CreateProjectTicketCommentDto,
  ): Observable<ProjectTicketCommentResponse> {
    return this.http.post<ProjectTicketCommentResponse>(`${this.ticketsUrl(projectId)}/${ticketId}/comments`, dto);
  }

  listActivity(
    projectId: string,
    ticketId: string,
    limit = 100,
    offset = 0,
  ): Observable<ProjectTicketActivityResponse[]> {
    const httpParams = new HttpParams().set('limit', String(limit)).set('offset', String(offset));

    return this.http.get<ProjectTicketActivityResponse[]>(`${this.ticketsUrl(projectId)}/${ticketId}/activity`, {
      params: httpParams,
    });
  }
}
