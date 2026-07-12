import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/shared/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import { Observable } from 'rxjs';

import type {
  AdminPromotionResponse,
  CreateAdminPromotionDto,
  ListParams,
  PaginatedAdminPromotionsResponse,
  PaginatedPromotionRedemptionsResponse,
  UpdateAdminPromotionDto,
} from '../types/promotions.types';

@Injectable({
  providedIn: 'root',
})
export class AdminPromotionsService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  private get apiUrl(): string {
    return this.environment.billing.restApiUrl;
  }

  list(params?: ListParams): Observable<PaginatedAdminPromotionsResponse> {
    return this.http.get<PaginatedAdminPromotionsResponse>(`${this.apiUrl}/admin/billing/promotions`, {
      params: this.buildParams(params),
    });
  }

  get(id: string): Observable<AdminPromotionResponse> {
    return this.http.get<AdminPromotionResponse>(`${this.apiUrl}/admin/billing/promotions/${id}`);
  }

  create(dto: CreateAdminPromotionDto): Observable<AdminPromotionResponse> {
    return this.http.post<AdminPromotionResponse>(`${this.apiUrl}/admin/billing/promotions`, dto);
  }

  update(id: string, dto: UpdateAdminPromotionDto): Observable<AdminPromotionResponse> {
    return this.http.put<AdminPromotionResponse>(`${this.apiUrl}/admin/billing/promotions/${id}`, dto);
  }

  deactivate(id: string): Observable<AdminPromotionResponse> {
    return this.http.delete<AdminPromotionResponse>(`${this.apiUrl}/admin/billing/promotions/${id}`);
  }

  listRedemptions(id: string, params?: ListParams): Observable<PaginatedPromotionRedemptionsResponse> {
    return this.http.get<PaginatedPromotionRedemptionsResponse>(
      `${this.apiUrl}/admin/billing/promotions/${id}/redemptions`,
      { params: this.buildParams(params) },
    );
  }

  private buildParams(params?: ListParams): HttpParams {
    let httpParams = new HttpParams();

    if (params?.limit != null) httpParams = httpParams.set('limit', String(params.limit));

    if (params?.offset != null) httpParams = httpParams.set('offset', String(params.offset));

    return httpParams;
  }
}
