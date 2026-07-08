import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/shared/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import { Observable } from 'rxjs';

import type {
  CreateServiceTypeDto,
  ListParams,
  ProviderDetail,
  ProviderLocation,
  ServerType,
  ServiceTypeResponse,
  UpdateServiceTypeDto,
} from '../types/billing.types';

@Injectable({
  providedIn: 'root',
})
export class ServiceTypesService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  /**
   * Get the base URL for the billing API.
   */
  private get apiUrl(): string {
    return this.environment.billing.restApiUrl;
  }

  /**
   * Get all registered provider details (id, displayName, configSchema).
   */
  getProviderDetails(): Observable<ProviderDetail[]> {
    return this.http.get<ProviderDetail[]>(`${this.apiUrl}/service-types/providers`);
  }

  /**
   * Get server types with specs and pricing for a provider (e.g. hetzner).
   * Used for server type dropdown and to auto-set plan base price when configSchema.basePriceFromField is set.
   */
  getProviderServerTypes(providerId: string): Observable<ServerType[]> {
    return this.http.get<ServerType[]>(
      `${this.apiUrl}/service-types/providers/${encodeURIComponent(providerId)}/server-types`,
    );
  }

  /**
   * Get geography options with human-readable labels for a provider (e.g. hetzner).
   */
  getProviderLocations(providerId: string, serviceTypeId?: string): Observable<ProviderLocation[]> {
    let params = new HttpParams();

    if (serviceTypeId?.trim()) {
      params = params.set('serviceTypeId', serviceTypeId);
    }

    return this.http.get<ProviderLocation[]>(
      `${this.apiUrl}/service-types/providers/${encodeURIComponent(providerId)}/locations`,
      { params },
    );
  }

  /**
   * List all service types with optional pagination.
   */
  listServiceTypes(params?: ListParams): Observable<ServiceTypeResponse[]> {
    let httpParams = new HttpParams();

    if (params?.limit !== undefined) {
      httpParams = httpParams.set('limit', params.limit.toString());
    }

    if (params?.offset !== undefined) {
      httpParams = httpParams.set('offset', params.offset.toString());
    }

    return this.http.get<ServiceTypeResponse[]>(`${this.apiUrl}/service-types`, {
      params: httpParams,
    });
  }

  /**
   * Get a service type by ID.
   */
  getServiceType(id: string): Observable<ServiceTypeResponse> {
    return this.http.get<ServiceTypeResponse>(`${this.apiUrl}/service-types/${id}`);
  }

  /**
   * Create a new service type (admin only).
   */
  createServiceType(serviceType: CreateServiceTypeDto): Observable<ServiceTypeResponse> {
    return this.http.post<ServiceTypeResponse>(`${this.apiUrl}/service-types`, serviceType);
  }

  /**
   * Update an existing service type (admin only).
   */
  updateServiceType(id: string, serviceType: UpdateServiceTypeDto): Observable<ServiceTypeResponse> {
    return this.http.post<ServiceTypeResponse>(`${this.apiUrl}/service-types/${id}`, serviceType);
  }

  /**
   * Delete a service type (admin only).
   */
  deleteServiceType(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/service-types/${id}`);
  }
}
