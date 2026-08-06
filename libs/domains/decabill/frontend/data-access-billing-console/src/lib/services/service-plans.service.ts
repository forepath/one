import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/shared/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import { Observable } from 'rxjs';

import type {
  AttachedMeterResponse,
  AttachMeterDto,
  CreateServicePlanDto,
  CloudInitConfigOrderField,
  ListParams,
  OrderProvisioningOption,
  PlanAddonOptionDto,
  ServicePlanResponse,
  UpdateAttachedMeterDto,
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

  getOrderProvisioningOptions(planId: string): Observable<OrderProvisioningOption[]> {
    return this.http.get<OrderProvisioningOption[]>(
      `${this.apiUrl}/service-plans/${planId}/order-provisioning-options`,
    );
  }

  getOrderAddons(planId: string): Observable<PlanAddonOptionDto[]> {
    return this.http.get<PlanAddonOptionDto[]>(`${this.apiUrl}/service-plans/${planId}/addons`);
  }

  getCloudInitOrderFields(planId: string, configId: string): Observable<CloudInitConfigOrderField[]> {
    return this.http.get<CloudInitConfigOrderField[]>(
      `${this.apiUrl}/service-plans/${planId}/cloud-init-configs/${configId}/order-fields`,
    );
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

  listPlanMeters(planId: string): Observable<AttachedMeterResponse[]> {
    return this.http.get<AttachedMeterResponse[]>(`${this.apiUrl}/service-plans/${planId}/meters`);
  }

  attachPlanMeter(planId: string, dto: AttachMeterDto): Observable<AttachedMeterResponse> {
    return this.http.post<AttachedMeterResponse>(`${this.apiUrl}/service-plans/${planId}/meters`, dto);
  }

  updatePlanMeter(planId: string, meterId: string, dto: UpdateAttachedMeterDto): Observable<AttachedMeterResponse> {
    return this.http.post<AttachedMeterResponse>(`${this.apiUrl}/service-plans/${planId}/meters/${meterId}`, dto);
  }

  detachPlanMeter(planId: string, meterId: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/service-plans/${planId}/meters/${meterId}`);
  }
}
