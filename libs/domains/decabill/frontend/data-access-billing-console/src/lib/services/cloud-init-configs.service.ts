import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/shared/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import { Observable } from 'rxjs';

import type {
  CloudInitConfigResponse,
  CreateCloudInitConfigDto,
  ListParams,
  UpdateCloudInitConfigDto,
} from '../types/billing.types';

@Injectable({
  providedIn: 'root',
})
export class CloudInitConfigsService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  private get apiUrl(): string {
    return this.environment.billing.restApiUrl;
  }

  listCloudInitConfigs(params?: ListParams): Observable<CloudInitConfigResponse[]> {
    let httpParams = new HttpParams();

    if (params?.limit !== undefined) {
      httpParams = httpParams.set('limit', params.limit.toString());
    }

    if (params?.offset !== undefined) {
      httpParams = httpParams.set('offset', params.offset.toString());
    }

    return this.http.get<CloudInitConfigResponse[]>(`${this.apiUrl}/cloud-init-configs`, { params: httpParams });
  }

  getCloudInitConfig(id: string): Observable<CloudInitConfigResponse> {
    return this.http.get<CloudInitConfigResponse>(`${this.apiUrl}/cloud-init-configs/${id}`);
  }

  createCloudInitConfig(dto: CreateCloudInitConfigDto): Observable<CloudInitConfigResponse> {
    return this.http.post<CloudInitConfigResponse>(`${this.apiUrl}/cloud-init-configs`, dto);
  }

  updateCloudInitConfig(id: string, dto: UpdateCloudInitConfigDto): Observable<CloudInitConfigResponse> {
    return this.http.post<CloudInitConfigResponse>(`${this.apiUrl}/cloud-init-configs/${id}`, dto);
  }

  deleteCloudInitConfig(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/cloud-init-configs/${id}`);
  }
}
