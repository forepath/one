import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/decabill/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/decabill/frontend/util-configuration';
import { Observable } from 'rxjs';

import type { ListParams } from '../types/billing.types';
import type {
  AddSupplierProfileCustomDataDto,
  AdminSupplierProfileDetail,
  CreateAdminSupplierProfileDto,
  PaginatedAdminSupplierProfilesResponse,
  SupplierContractResponse,
  SupplierProfileDto,
  UpdateSupplierProfileCustomDataDto,
} from '../types/suppliers.types';

@Injectable({
  providedIn: 'root',
})
export class AdminSupplierProfilesService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  private get apiUrl(): string {
    return this.environment.billing.urls.restApi;
  }

  list(params?: ListParams): Observable<PaginatedAdminSupplierProfilesResponse> {
    let httpParams = new HttpParams();

    if (params?.limit != null) httpParams = httpParams.set('limit', String(params.limit));

    if (params?.offset != null) httpParams = httpParams.set('offset', String(params.offset));

    if (params?.search?.trim()) httpParams = httpParams.set('search', params.search.trim());

    return this.http.get<PaginatedAdminSupplierProfilesResponse>(`${this.apiUrl}/admin/billing/supplier-profiles`, {
      params: httpParams,
    });
  }

  getById(id: string): Observable<AdminSupplierProfileDetail> {
    return this.http.get<AdminSupplierProfileDetail>(`${this.apiUrl}/admin/billing/supplier-profiles/${id}`);
  }

  listContracts(id: string, search?: string): Observable<SupplierContractResponse[]> {
    let httpParams = new HttpParams();

    if (search?.trim()) httpParams = httpParams.set('search', search.trim());

    return this.http.get<SupplierContractResponse[]>(`${this.apiUrl}/admin/billing/supplier-profiles/${id}/contracts`, {
      params: httpParams,
    });
  }

  create(dto: CreateAdminSupplierProfileDto): Observable<AdminSupplierProfileDetail> {
    return this.http.post<AdminSupplierProfileDetail>(`${this.apiUrl}/admin/billing/supplier-profiles`, dto);
  }

  update(id: string, dto: SupplierProfileDto): Observable<AdminSupplierProfileDetail> {
    return this.http.post<AdminSupplierProfileDetail>(`${this.apiUrl}/admin/billing/supplier-profiles/${id}`, dto);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/admin/billing/supplier-profiles/${id}`);
  }

  addCustomData(id: string, dto: AddSupplierProfileCustomDataDto): Observable<AdminSupplierProfileDetail> {
    return this.http.post<AdminSupplierProfileDetail>(`${this.apiUrl}/admin/billing/supplier-profiles/${id}/data`, dto);
  }

  updateCustomData(
    id: string,
    key: string,
    dto: UpdateSupplierProfileCustomDataDto,
  ): Observable<AdminSupplierProfileDetail> {
    return this.http.post<AdminSupplierProfileDetail>(
      `${this.apiUrl}/admin/billing/supplier-profiles/${id}/data/${encodeURIComponent(key)}`,
      dto,
    );
  }

  deleteCustomData(id: string, key: string): Observable<AdminSupplierProfileDetail> {
    return this.http.delete<AdminSupplierProfileDetail>(
      `${this.apiUrl}/admin/billing/supplier-profiles/${id}/data/${encodeURIComponent(key)}`,
    );
  }
}
