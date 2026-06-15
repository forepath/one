import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/shared/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import { Observable } from 'rxjs';

import type {
  AvailabilityCheckDto,
  AvailabilityResponse,
  PricingPreviewDto,
  PricingPreviewResponse,
} from '../types/billing.types';

@Injectable({
  providedIn: 'root',
})
export class AvailabilityService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  /**
   * Get the base URL for the billing API.
   */
  private get apiUrl(): string {
    return this.environment.billing.restApiUrl;
  }

  /**
   * Check availability for a service configuration.
   */
  checkAvailability(check: AvailabilityCheckDto): Observable<AvailabilityResponse> {
    return this.http.post<AvailabilityResponse>(`${this.apiUrl}/availability/check`, check);
  }

  /**
   * Check availability with alternatives for a service configuration.
   */
  checkAvailabilityAlternatives(check: AvailabilityCheckDto): Observable<AvailabilityResponse> {
    return this.http.post<AvailabilityResponse>(`${this.apiUrl}/availability/alternatives`, check);
  }

  /**
   * Preview pricing for a plan.
   */
  previewPricing(preview: PricingPreviewDto): Observable<PricingPreviewResponse> {
    return this.http.post<PricingPreviewResponse>(`${this.apiUrl}/pricing/preview`, preview);
  }
}
