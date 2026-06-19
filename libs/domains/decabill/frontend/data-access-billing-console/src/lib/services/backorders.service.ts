import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/shared/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import { Observable } from 'rxjs';

import type { BackorderCancelDto, BackorderResponse, BackorderRetryDto, ListParams } from '../types/billing.types';

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
    return this.environment.billing.restApiUrl;
  }

  /**
   * List all backorders for the current user with optional pagination.
   */
  listBackorders(params?: ListParams): Observable<BackorderResponse[]> {
    let httpParams = new HttpParams();

    if (params?.limit !== undefined) {
      httpParams = httpParams.set('limit', params.limit.toString());
    }

    if (params?.offset !== undefined) {
      httpParams = httpParams.set('offset', params.offset.toString());
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
