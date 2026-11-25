import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/decabill/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/decabill/frontend/util-configuration';
import { Observable } from 'rxjs';

import type {
  AdminProjectDetailResponse,
  AdminProjectsListParams,
  BillProjectTimeDto,
  BillProjectTimeResponse,
  CreateAdminProjectDto,
  PaginatedAdminProjectsResponse,
  ProjectResponse,
  ProjectUnbilledTimeBoundsResponse,
  ProjectTimeReportRequestDto,
  UpdateAdminProjectDto,
} from '../types/projects.types';
import type { SpoolJob } from '../types/spooler.types';

import { AdminSpoolerService } from './admin-spooler.service';

@Injectable({
  providedIn: 'root',
})
export class AdminProjectsService {
  private readonly http = inject(HttpClient);
  private readonly spooler = inject(AdminSpoolerService);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  private get apiUrl(): string {
    return this.environment.billing.urls.restApi;
  }

  list(params?: AdminProjectsListParams): Observable<PaginatedAdminProjectsResponse> {
    let httpParams = new HttpParams();

    if (params?.limit != null) httpParams = httpParams.set('limit', String(params.limit));

    if (params?.offset != null) httpParams = httpParams.set('offset', String(params.offset));

    if (params?.search?.trim()) httpParams = httpParams.set('search', params.search.trim());

    if (params?.userId) httpParams = httpParams.set('userId', params.userId);

    return this.http.get<PaginatedAdminProjectsResponse>(`${this.apiUrl}/admin/billing/projects`, {
      params: httpParams,
    });
  }

  getById(projectId: string): Observable<AdminProjectDetailResponse> {
    return this.http.get<AdminProjectDetailResponse>(`${this.apiUrl}/admin/billing/projects/${projectId}`);
  }

  create(dto: CreateAdminProjectDto): Observable<ProjectResponse> {
    return this.http.post<ProjectResponse>(`${this.apiUrl}/admin/billing/projects`, dto);
  }

  update(projectId: string, dto: UpdateAdminProjectDto): Observable<ProjectResponse> {
    return this.http.post<ProjectResponse>(`${this.apiUrl}/admin/billing/projects/${projectId}`, dto);
  }

  delete(projectId: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/admin/billing/projects/${projectId}`);
  }

  billTime(projectId: string, dto: BillProjectTimeDto): Observable<BillProjectTimeResponse> {
    return this.http.post<BillProjectTimeResponse>(`${this.apiUrl}/admin/billing/projects/${projectId}/bill-time`, dto);
  }

  getUnbilledTimeBounds(projectId: string): Observable<ProjectUnbilledTimeBoundsResponse> {
    return this.http.get<ProjectUnbilledTimeBoundsResponse>(
      `${this.apiUrl}/admin/billing/projects/${projectId}/unbilled-time-bounds`,
    );
  }

  /** Time report PDF, rendered by the spooler (the job and its file stay on the Spooler page). */
  generateTimeReport(projectId: string, dto: ProjectTimeReportRequestDto): Observable<Blob> {
    return this.spooler.spoolAndDownload(
      this.http.post<SpoolJob>(`${this.apiUrl}/admin/billing/projects/${projectId}/time-report/spool`, dto),
    );
  }
}
