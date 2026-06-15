import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/shared/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import { Observable } from 'rxjs';

import type {
  AtlassianConnectionTestResultDto,
  AtlassianSiteConnectionDto,
  CreateAtlassianSiteConnectionDto,
  CreateExternalImportConfigDto,
  ExternalImportConfigDto,
  UpdateAtlassianSiteConnectionDto,
  ListAtlassianConnectionsParams,
  ListExternalImportConfigsParams,
  UpdateExternalImportConfigDto,
} from '../state/context-import/context-import.types';

@Injectable({
  providedIn: 'root',
})
export class ContextImportAdminService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  private get baseUrl(): string {
    return `${this.environment.controller.restApiUrl}/imports/atlassian`;
  }

  listConnections(params?: ListAtlassianConnectionsParams): Observable<AtlassianSiteConnectionDto[]> {
    let httpParams = new HttpParams();

    if (params?.limit !== undefined) {
      httpParams = httpParams.set('limit', params.limit.toString());
    }

    if (params?.offset !== undefined) {
      httpParams = httpParams.set('offset', params.offset.toString());
    }

    return this.http.get<AtlassianSiteConnectionDto[]>(`${this.baseUrl}/connections`, { params: httpParams });
  }

  getConnection(id: string): Observable<AtlassianSiteConnectionDto> {
    return this.http.get<AtlassianSiteConnectionDto>(`${this.baseUrl}/connections/${id}`);
  }

  createConnection(dto: CreateAtlassianSiteConnectionDto): Observable<AtlassianSiteConnectionDto> {
    return this.http.post<AtlassianSiteConnectionDto>(`${this.baseUrl}/connections`, dto);
  }

  updateConnection(id: string, dto: UpdateAtlassianSiteConnectionDto): Observable<AtlassianSiteConnectionDto> {
    return this.http.put<AtlassianSiteConnectionDto>(`${this.baseUrl}/connections/${id}`, dto);
  }

  deleteConnection(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/connections/${id}`);
  }

  testConnection(id: string): Observable<AtlassianConnectionTestResultDto> {
    return this.http.post<AtlassianConnectionTestResultDto>(`${this.baseUrl}/connections/${id}/test`, {});
  }

  listConfigs(params?: ListExternalImportConfigsParams): Observable<ExternalImportConfigDto[]> {
    let httpParams = new HttpParams();

    if (params?.limit !== undefined) {
      httpParams = httpParams.set('limit', params.limit.toString());
    }

    if (params?.offset !== undefined) {
      httpParams = httpParams.set('offset', params.offset.toString());
    }

    return this.http.get<ExternalImportConfigDto[]>(`${this.baseUrl}/configs`, { params: httpParams });
  }

  getConfig(id: string): Observable<ExternalImportConfigDto> {
    return this.http.get<ExternalImportConfigDto>(`${this.baseUrl}/configs/${id}`);
  }

  createConfig(dto: CreateExternalImportConfigDto): Observable<ExternalImportConfigDto> {
    return this.http.post<ExternalImportConfigDto>(`${this.baseUrl}/configs`, dto);
  }

  updateConfig(id: string, dto: UpdateExternalImportConfigDto): Observable<ExternalImportConfigDto> {
    return this.http.put<ExternalImportConfigDto>(`${this.baseUrl}/configs/${id}`, dto);
  }

  deleteConfig(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/configs/${id}`);
  }

  runConfig(id: string): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/configs/${id}/run`, {});
  }

  clearMarkers(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/configs/${id}/markers`);
  }
}
