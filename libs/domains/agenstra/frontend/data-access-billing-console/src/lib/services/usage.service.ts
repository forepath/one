import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/shared/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import { Observable } from 'rxjs';

import type { CreateUsageRecordDto, UsageRecordResponse, UsageSummary } from '../types/billing.types';

@Injectable({
  providedIn: 'root',
})
export class UsageService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  /**
   * Get the base URL for the billing API.
   */
  private get apiUrl(): string {
    return this.environment.billing.restApiUrl;
  }

  /**
   * Get usage summary for a subscription.
   */
  getUsageSummary(subscriptionId: string): Observable<UsageSummary> {
    return this.http.get<UsageSummary>(`${this.apiUrl}/usage/summary/${subscriptionId}`);
  }

  /**
   * Record usage for a subscription.
   */
  recordUsage(record: CreateUsageRecordDto): Observable<UsageRecordResponse> {
    return this.http.post<UsageRecordResponse>(`${this.apiUrl}/usage/record`, record);
  }
}
