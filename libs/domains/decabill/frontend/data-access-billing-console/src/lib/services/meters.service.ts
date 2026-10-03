import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/decabill/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/decabill/frontend/util-configuration';
import { Observable } from 'rxjs';

import type { CreateMeterDto, ListParams, MeterResponse, UpdateMeterDto } from '../types/billing.types';

@Injectable({
  providedIn: 'root',
})
export class MetersService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  private get apiUrl(): string {
    return this.environment.billing.urls.restApi;
  }

  listMeters(params?: ListParams): Observable<MeterResponse[]> {
    let httpParams = new HttpParams();

    if (params?.limit !== undefined) {
      httpParams = httpParams.set('limit', params.limit.toString());
    }

    if (params?.offset !== undefined) {
      httpParams = httpParams.set('offset', params.offset.toString());
    }

    if (params?.search?.trim()) {
      httpParams = httpParams.set('search', params.search.trim());
    }

    return this.http.get<MeterResponse[]>(`${this.apiUrl}/meters`, { params: httpParams });
  }

  getMeter(id: string): Observable<MeterResponse> {
    return this.http.get<MeterResponse>(`${this.apiUrl}/meters/${id}`);
  }

  createMeter(dto: CreateMeterDto): Observable<MeterResponse> {
    return this.http.post<MeterResponse>(`${this.apiUrl}/meters`, dto);
  }

  updateMeter(id: string, dto: UpdateMeterDto): Observable<MeterResponse> {
    return this.http.post<MeterResponse>(`${this.apiUrl}/meters/${id}`, dto);
  }

  deleteMeter(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/meters/${id}`);
  }
}
