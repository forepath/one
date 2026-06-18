import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/shared/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import { Observable } from 'rxjs';

import type {
  AdminCustomerProfileDetail,
  AdminCustomerProfileListItem,
  CreateAdminCustomerProfileDto,
  CustomerProfileDto,
  CustomerProfileResponse,
  ListParams,
  PaginatedAdminCustomerProfilesResponse,
} from '../types/billing.types';

@Injectable({
  providedIn: 'root',
})
export class AdminCustomerProfilesService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  private get apiUrl(): string {
    return this.environment.billing.restApiUrl;
  }

  list(params?: ListParams): Observable<PaginatedAdminCustomerProfilesResponse> {
    let httpParams = new HttpParams();

    if (params?.limit != null) httpParams = httpParams.set('limit', String(params.limit));

    if (params?.offset != null) httpParams = httpParams.set('offset', String(params.offset));

    return this.http.get<PaginatedAdminCustomerProfilesResponse>(`${this.apiUrl}/admin/billing/customer-profiles`, {
      params: httpParams,
    });
  }

  getById(id: string): Observable<AdminCustomerProfileDetail> {
    return this.http.get<AdminCustomerProfileDetail>(`${this.apiUrl}/admin/billing/customer-profiles/${id}`);
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
}
