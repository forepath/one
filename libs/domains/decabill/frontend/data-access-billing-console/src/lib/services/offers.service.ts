import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/decabill/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/decabill/frontend/util-configuration';
import { Observable } from 'rxjs';

import type {
  CustomerOfferDetailResponse,
  CustomerOfferListItem,
  OffersSummaryResponse,
  PaginatedOffersResponse,
} from '../types/offers.types';

/** One page of the caller's offers (`limit` / `offset` / `search`). */
export interface CustomerOffersListParams {
  search?: string;
  limit?: number;
  offset?: number;
}

@Injectable({
  providedIn: 'root',
})
export class OffersService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  private get apiUrl(): string {
    return this.environment.billing.urls.restApi;
  }

  getSummary(): Observable<OffersSummaryResponse> {
    return this.http.get<OffersSummaryResponse>(`${this.apiUrl}/offers/summary`);
  }

  getPendingOffers(params?: CustomerOffersListParams): Observable<PaginatedOffersResponse<CustomerOfferListItem>> {
    return this.http.get<PaginatedOffersResponse<CustomerOfferListItem>>(`${this.apiUrl}/offers/pending`, {
      params: this.buildListParams(params),
    });
  }

  getHistoryOffers(params?: CustomerOffersListParams): Observable<PaginatedOffersResponse<CustomerOfferListItem>> {
    return this.http.get<PaginatedOffersResponse<CustomerOfferListItem>>(`${this.apiUrl}/offers/history`, {
      params: this.buildListParams(params),
    });
  }

  getOffer(id: string): Observable<CustomerOfferDetailResponse> {
    return this.http.get<CustomerOfferDetailResponse>(`${this.apiUrl}/offers/${id}`);
  }

  downloadOfferPdf(id: string): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/offers/${id}/pdf`, { responseType: 'blob' });
  }

  acceptOffer(id: string): Observable<CustomerOfferDetailResponse> {
    return this.http.post<CustomerOfferDetailResponse>(`${this.apiUrl}/offers/${id}/accept`, {});
  }

  declineOffer(id: string): Observable<CustomerOfferDetailResponse> {
    return this.http.post<CustomerOfferDetailResponse>(`${this.apiUrl}/offers/${id}/decline`, {});
  }

  private buildListParams(options?: CustomerOffersListParams): HttpParams {
    let params = new HttpParams();

    if (options?.search?.trim()) {
      params = params.set('search', options.search.trim());
    }

    if (options?.limit !== undefined) {
      params = params.set('limit', String(options.limit));
    }

    if (options?.offset !== undefined) {
      params = params.set('offset', String(options.offset));
    }

    return params;
  }
}
