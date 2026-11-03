import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/decabill/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/decabill/frontend/util-configuration';
import { Observable } from 'rxjs';

import type {
  BackorderCancelDto,
  BackorderResponse,
  BackorderRetryDto,
  BackordersListParams,
} from '../types/billing.types';

@Injectable({
  providedIn: 'root',
})
export class BackordersService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  /**
   * Get the base URL for the billing API.
   */
  private get apiUrl(): string {
    return this.environment.billing.urls.restApi;
  }

  /**
   * One page of the current user's backorders (`limit` / `offset` / `search`; `status` narrows it, e.g. pending).
   */
  listBackorders(params?: BackordersListParams): Observable<BackorderResponse[]> {
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

    if (params?.status?.length) {
      httpParams = httpParams.set('status', params.status.join(','));
    }

    return this.http.get<BackorderResponse[]>(`${this.apiUrl}/backorders`, {
      params: httpParams,
    });
  }

  /**
   * Retry a backorder.
   */
  retryBackorder(id: string, dto?: BackorderRetryDto): Observable<BackorderResponse> {
    return this.http.post<BackorderResponse>(`${this.apiUrl}/backorders/${id}/retry`, dto ?? {});
  }

  /**
   * Cancel a backorder.
   */
  cancelBackorder(id: string, dto?: BackorderCancelDto): Observable<BackorderResponse> {
    return this.http.post<BackorderResponse>(`${this.apiUrl}/backorders/${id}/cancel`, dto ?? {});
  }
}
