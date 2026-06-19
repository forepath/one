import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/shared/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import { Observable } from 'rxjs';

import type {
  CreateServicePlanDto,
  ListParams,
  ServicePlanResponse,
  UpdateServicePlanDto,
} from '../types/billing.types';

@Injectable({
  providedIn: 'root',
})
export class ServicePlansService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  /**
   * Get the base URL for the billing API.
   */
  private get apiUrl(): string {
    return this.environment.billing.restApiUrl;
  }

  /**
   * List all service plans with optional pagination.
   */
  listServicePlans(params?: ListParams): Observable<ServicePlanResponse[]> {
    let httpParams = new HttpParams();

    if (params?.limit !== undefined) {
      httpParams = httpParams.set('limit', params.limit.toString());
    }

    if (params?.offset !== undefined) {
      httpParams = httpParams.set('offset', params.offset.toString());
    }

    return this.http.get<ServicePlanResponse[]>(`${this.apiUrl}/service-plans`, {
      params: httpParams,
    });
  }

  /**
   * Get a service plan by ID.
   */
  getServicePlan(id: string): Observable<ServicePlanResponse> {
    return this.http.get<ServicePlanResponse>(`${this.apiUrl}/service-plans/${id}`);
  }

  /**
   * Create a new service plan (admin only).
   */
  createServicePlan(servicePlan: CreateServicePlanDto): Observable<ServicePlanResponse> {
    return this.http.post<ServicePlanResponse>(`${this.apiUrl}/service-plans`, servicePlan);
  }

  /**
   * Update an existing service plan (admin only).
   */
  updateServicePlan(id: string, servicePlan: UpdateServicePlanDto): Observable<ServicePlanResponse> {
    return this.http.post<ServicePlanResponse>(`${this.apiUrl}/service-plans/${id}`, servicePlan);
  }

  /**
   * Delete a service plan (admin only).
   */
  deleteServicePlan(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/service-plans/${id}`);
  }
}
