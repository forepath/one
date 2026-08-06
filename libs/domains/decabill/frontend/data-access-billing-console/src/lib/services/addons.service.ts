import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/shared/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import { Observable } from 'rxjs';

import type {
  AddonModuleDetail,
  AddonResponse,
  AttachedMeterResponse,
  AttachMeterDto,
  CreateAddonDto,
  ListParams,
  UpdateAddonDto,
  UpdateAttachedMeterDto,
} from '../types/billing.types';

@Injectable({
  providedIn: 'root',
})
export class AddonsService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  private get apiUrl(): string {
    return this.environment.billing.restApiUrl;
  }

  listAddons(params?: ListParams): Observable<AddonResponse[]> {
    let httpParams = new HttpParams();

    if (params?.limit !== undefined) {
      httpParams = httpParams.set('limit', params.limit.toString());
    }

    if (params?.offset !== undefined) {
      httpParams = httpParams.set('offset', params.offset.toString());
    }

    return this.http.get<AddonResponse[]>(`${this.apiUrl}/addons`, { params: httpParams });
  }

  listAddonModules(): Observable<AddonModuleDetail[]> {
    return this.http.get<AddonModuleDetail[]>(`${this.apiUrl}/addons/modules`);
  }

  getAddon(id: string): Observable<AddonResponse> {
    return this.http.get<AddonResponse>(`${this.apiUrl}/addons/${id}`);
  }

  createAddon(dto: CreateAddonDto): Observable<AddonResponse> {
    return this.http.post<AddonResponse>(`${this.apiUrl}/addons`, dto);
  }

  updateAddon(id: string, dto: UpdateAddonDto): Observable<AddonResponse> {
    return this.http.post<AddonResponse>(`${this.apiUrl}/addons/${id}`, dto);
  }

  deleteAddon(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/addons/${id}`);
  }

  listAddonMeters(addonId: string): Observable<AttachedMeterResponse[]> {
    return this.http.get<AttachedMeterResponse[]>(`${this.apiUrl}/addons/${addonId}/meters`);
  }

  attachAddonMeter(addonId: string, dto: AttachMeterDto): Observable<AttachedMeterResponse> {
    return this.http.post<AttachedMeterResponse>(`${this.apiUrl}/addons/${addonId}/meters`, dto);
  }

  updateAddonMeter(addonId: string, meterId: string, dto: UpdateAttachedMeterDto): Observable<AttachedMeterResponse> {
    return this.http.post<AttachedMeterResponse>(`${this.apiUrl}/addons/${addonId}/meters/${meterId}`, dto);
  }

  detachAddonMeter(addonId: string, meterId: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/addons/${addonId}/meters/${meterId}`);
  }
}
