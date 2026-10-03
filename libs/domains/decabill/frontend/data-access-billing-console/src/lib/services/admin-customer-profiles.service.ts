import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/decabill/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/decabill/frontend/util-configuration';
import { Observable } from 'rxjs';

import type {
  AdminCustomerProfileDetail,
  AdminCustomerProfileListItem,
  CustomerTrustScoreDetail,
  CreateAdminCustomerProfileDto,
  CustomerProfileDto,
  CustomerProfileResponse,
  ListParams,
  PaginatedAdminCustomerProfilesResponse,
  AddCustomerProfileCustomDataDto,
  UpdateCustomerProfileCustomDataDto,
} from '../types/billing.types';

@Injectable({
  providedIn: 'root',
})
export class AdminCustomerProfilesService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  private get apiUrl(): string {
    return this.environment.billing.urls.restApi;
  }

  list(params?: ListParams): Observable<PaginatedAdminCustomerProfilesResponse> {
    let httpParams = new HttpParams();

    if (params?.limit != null) httpParams = httpParams.set('limit', String(params.limit));

    if (params?.offset != null) httpParams = httpParams.set('offset', String(params.offset));

    if (params?.search?.trim()) httpParams = httpParams.set('search', params.search.trim());

    return this.http.get<PaginatedAdminCustomerProfilesResponse>(`${this.apiUrl}/admin/billing/customer-profiles`, {
      params: httpParams,
    });
  }

  getById(id: string): Observable<AdminCustomerProfileDetail> {
    return this.http.get<AdminCustomerProfileDetail>(`${this.apiUrl}/admin/billing/customer-profiles/${id}`);
  }

  getTrustScore(id: string): Observable<CustomerTrustScoreDetail> {
    return this.http.get<CustomerTrustScoreDetail>(`${this.apiUrl}/admin/billing/customer-profiles/${id}/trust-score`);
  }

  recomputeTrustScore(id: string): Observable<CustomerTrustScoreDetail> {
    return this.http.post<CustomerTrustScoreDetail>(
      `${this.apiUrl}/admin/billing/customer-profiles/${id}/trust-score/recompute`,
      {},
    );
  }

  create(dto: CreateAdminCustomerProfileDto): Observable<CustomerProfileResponse> {
    return this.http.post<CustomerProfileResponse>(`${this.apiUrl}/admin/billing/customer-profiles`, dto);
  }

  update(id: string, dto: CustomerProfileDto): Observable<CustomerProfileResponse> {
    return this.http.post<CustomerProfileResponse>(`${this.apiUrl}/admin/billing/customer-profiles/${id}`, dto);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/admin/billing/customer-profiles/${id}`);
  }

  addCustomData(id: string, dto: AddCustomerProfileCustomDataDto): Observable<AdminCustomerProfileDetail> {
    return this.http.post<AdminCustomerProfileDetail>(`${this.apiUrl}/admin/billing/customer-profiles/${id}/data`, dto);
  }

  updateCustomData(
    id: string,
    key: string,
    dto: UpdateCustomerProfileCustomDataDto,
  ): Observable<AdminCustomerProfileDetail> {
    return this.http.post<AdminCustomerProfileDetail>(
      `${this.apiUrl}/admin/billing/customer-profiles/${id}/data/${encodeURIComponent(key)}`,
      dto,
    );
  }

  deleteCustomData(id: string, key: string): Observable<AdminCustomerProfileDetail> {
    return this.http.delete<AdminCustomerProfileDetail>(
      `${this.apiUrl}/admin/billing/customer-profiles/${id}/data/${encodeURIComponent(key)}`,
    );
  }
}
