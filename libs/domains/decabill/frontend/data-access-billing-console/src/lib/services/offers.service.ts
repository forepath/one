import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/shared/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import { Observable } from 'rxjs';

import type { CustomerOfferDetailResponse, CustomerOfferListItem, OffersSummaryResponse } from '../types/offers.types';

@Injectable({
  providedIn: 'root',
})
export class OffersService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  private get apiUrl(): string {
    return this.environment.billing.restApiUrl;
  }

  getSummary(): Observable<OffersSummaryResponse> {
    return this.http.get<OffersSummaryResponse>(`${this.apiUrl}/offers/summary`);
  }

  getPendingOffers(search?: string): Observable<CustomerOfferListItem[]> {
    return this.http.get<CustomerOfferListItem[]>(`${this.apiUrl}/offers/pending`, {
      params: this.buildSearchParams(search),
    });
  }

  getHistoryOffers(search?: string): Observable<CustomerOfferListItem[]> {
    return this.http.get<CustomerOfferListItem[]>(`${this.apiUrl}/offers/history`, {
      params: this.buildSearchParams(search),
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

  private buildSearchParams(search?: string): HttpParams {
    let params = new HttpParams();

    if (search?.trim()) {
      params = params.set('search', search.trim());
    }

    return params;
  }
}
