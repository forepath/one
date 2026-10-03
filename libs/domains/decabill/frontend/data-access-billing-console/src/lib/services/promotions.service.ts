import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/decabill/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/decabill/frontend/util-configuration';
import { Observable } from 'rxjs';

import type {
  ListParams,
  PaginatedPromotionRedemptionsResponse,
  PromotionRedemptionResponse,
  PromotionValidationResponse,
  RedeemPromotionRequest,
  ValidatePromotionRequest,
} from '../types/promotions.types';

@Injectable({
  providedIn: 'root',
})
export class PromotionsService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  private get apiUrl(): string {
    return this.environment.billing.urls.restApi;
  }

  validate(dto: ValidatePromotionRequest): Observable<PromotionValidationResponse> {
    return this.http.post<PromotionValidationResponse>(`${this.apiUrl}/promotions/validate`, dto);
  }

  redeem(dto: RedeemPromotionRequest): Observable<PromotionRedemptionResponse> {
    return this.http.post<PromotionRedemptionResponse>(`${this.apiUrl}/promotions/redeem`, dto);
  }

  listRedemptions(params?: ListParams): Observable<PaginatedPromotionRedemptionsResponse> {
    return this.http.get<PaginatedPromotionRedemptionsResponse>(`${this.apiUrl}/promotions/redemptions`, {
      params: this.buildParams(params),
    });
  }

  listActive(params?: ListParams): Observable<PaginatedPromotionRedemptionsResponse> {
    return this.http.get<PaginatedPromotionRedemptionsResponse>(`${this.apiUrl}/promotions/active`, {
      params: this.buildParams(params),
    });
  }

  private buildParams(params?: ListParams): HttpParams {
    let httpParams = new HttpParams();

    if (params?.limit != null) httpParams = httpParams.set('limit', String(params.limit));

    if (params?.offset != null) httpParams = httpParams.set('offset', String(params.offset));

    if (params?.search?.trim()) httpParams = httpParams.set('search', params.search.trim());

    return httpParams;
  }
}
