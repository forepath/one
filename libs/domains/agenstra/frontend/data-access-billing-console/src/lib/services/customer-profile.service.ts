import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/shared/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import { Observable } from 'rxjs';

import type { CustomerProfileDto, CustomerProfileResponse } from '../types/billing.types';

@Injectable({
  providedIn: 'root',
})
export class CustomerProfileService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  /**
   * Get the base URL for the billing API.
   */
  private get apiUrl(): string {
    return this.environment.billing.restApiUrl;
  }

  /**
   * Get the current user's customer profile.
   */
  getCustomerProfile(): Observable<CustomerProfileResponse> {
    return this.http.get<CustomerProfileResponse>(`${this.apiUrl}/customer-profile`);
  }

  /**
   * Update the current user's customer profile.
   */
  updateCustomerProfile(profile: CustomerProfileDto): Observable<CustomerProfileResponse> {
    return this.http.post<CustomerProfileResponse>(`${this.apiUrl}/customer-profile`, profile);
  }
}
