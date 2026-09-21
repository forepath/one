import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/shared/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import { Observable } from 'rxjs';

import type { PaginatedBillingAuditLogsResponse } from '../types/billing.types';
import type {
  AdminOfferDetailResponse,
  AdminOfferStatisticsParams,
  CreateAdminOfferDto,
  OfferListParams,
  OfferStatisticsResponse,
  PaginatedOffersResponse,
  UpdateAdminOfferDto,
} from '../types/offers.types';
import type { AdminOfferListItem } from '../types/offers.types';

@Injectable({
  providedIn: 'root',
})
export class AdminOffersService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  private get apiUrl(): string {
    return this.environment.billing.restApiUrl;
  }

  list(params?: OfferListParams): Observable<PaginatedOffersResponse<AdminOfferListItem>> {
    return this.http.get<PaginatedOffersResponse<AdminOfferListItem>>(`${this.apiUrl}/admin/billing/offers`, {
      params: this.buildListParams(params),
    });
  }

  get(id: string): Observable<AdminOfferDetailResponse> {
    return this.http.get<AdminOfferDetailResponse>(`${this.apiUrl}/admin/billing/offers/${id}`);
  }

  create(dto: CreateAdminOfferDto): Observable<AdminOfferDetailResponse> {
    return this.http.post<AdminOfferDetailResponse>(`${this.apiUrl}/admin/billing/offers`, dto);
  }

  update(id: string, dto: UpdateAdminOfferDto): Observable<AdminOfferDetailResponse> {
    return this.http.put<AdminOfferDetailResponse>(`${this.apiUrl}/admin/billing/offers/${id}`, dto);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/admin/billing/offers/${id}`);
  }

  archive(id: string): Observable<AdminOfferDetailResponse> {
    return this.http.post<AdminOfferDetailResponse>(`${this.apiUrl}/admin/billing/offers/${id}/archive`, {});
  }

  revoke(id: string): Observable<AdminOfferDetailResponse> {
    return this.http.post<AdminOfferDetailResponse>(`${this.apiUrl}/admin/billing/offers/${id}/revoke`, {});
  }

  getStatistics(params?: AdminOfferStatisticsParams): Observable<OfferStatisticsResponse> {
    return this.http.get<OfferStatisticsResponse>(`${this.apiUrl}/admin/billing/offers/statistics`, {
      params: this.buildStatisticsParams(params),
    });
  }

  listAuditLogs(
    offerId: string,
    params?: { limit?: number; offset?: number },
  ): Observable<PaginatedBillingAuditLogsResponse> {
    let httpParams = new HttpParams();

    if (params?.limit != null) {
      httpParams = httpParams.set('limit', String(params.limit));
    }

    if (params?.offset != null) {
      httpParams = httpParams.set('offset', String(params.offset));
    }

    return this.http.get<PaginatedBillingAuditLogsResponse>(
      `${this.apiUrl}/admin/billing/offers/${offerId}/audit-logs`,
      { params: httpParams },
    );
  }

  private buildListParams(params?: OfferListParams): HttpParams {
    let httpParams = new HttpParams();

    if (params?.limit != null) {
      httpParams = httpParams.set('limit', String(params.limit));
    }

    if (params?.offset != null) {
      httpParams = httpParams.set('offset', String(params.offset));
    }

    if (params?.search?.trim()) {
      httpParams = httpParams.set('search', params.search.trim());
    }

    if (params?.userId) {
      httpParams = httpParams.set('userId', params.userId);
    }

    return httpParams;
  }

  private buildStatisticsParams(params?: AdminOfferStatisticsParams): HttpParams {
    let httpParams = new HttpParams();

    if (params?.from) {
      httpParams = httpParams.set('from', params.from);
    }

    if (params?.to) {
      httpParams = httpParams.set('to', params.to);
    }

    if (params?.groupBy) {
      httpParams = httpParams.set('groupBy', params.groupBy);
    }

    if (params?.userId) {
      httpParams = httpParams.set('userId', params.userId);
    }

    return httpParams;
  }
}
