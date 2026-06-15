import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import type {
  CreateServiceTypeDto,
  ListParams,
  ProviderDetail,
  ServiceTypeResponse,
  UpdateServiceTypeDto,
} from '../../types/billing.types';

import {
  clearSelectedServiceType,
  createServiceType,
  deleteServiceType,
  loadProviderDetails,
  loadServiceType,
  loadServiceTypes,
  updateServiceType,
} from './service-types.actions';
import {
  selectActiveServiceTypes,
  selectHasServiceTypes,
  selectProviderDetails,
  selectProviderDetailsError,
  selectProviderDetailsLoading,
  selectSelectedServiceType,
  selectServiceTypeById,
  selectServiceTypeByKey,
  selectServiceTypeLoading,
  selectServiceTypesCount,
  selectServiceTypesCreating,
  selectServiceTypesDeleting,
  selectServiceTypesEntities,
  selectServiceTypesError,
  selectServiceTypesLoading,
  selectServiceTypesLoadingAny,
  selectServiceTypesUpdating,
} from './service-types.selectors';

/**
 * Facade for service types state management.
 * Provides a clean API for components to interact with service types state
 * without directly accessing the NgRx store.
 */
@Injectable({
  providedIn: 'root',
})
export class ServiceTypesFacade {
  private readonly store = inject(Store);

  /**
   * Get all registered provider details (id, displayName, configSchema).
   */
  getProviderDetails$(): Observable<ProviderDetail[]> {
    return this.store.select(selectProviderDetails);
  }

  /**
   * Get loading state for provider details.
   */
  getProviderDetailsLoading$(): Observable<boolean> {
    return this.store.select(selectProviderDetailsLoading);
  }

  /**
   * Get error state for provider details.
   */
  getProviderDetailsError$(): Observable<string | null> {
    return this.store.select(selectProviderDetailsError);
  }

  /**
   * Load provider details from the API.
   */
  loadProviderDetails(): void {
    this.store.dispatch(loadProviderDetails());
  }

  /**
   * Get all service types.
   */
  getServiceTypes$(): Observable<ServiceTypeResponse[]> {
    return this.store.select(selectServiceTypesEntities);
  }

  /**
   * Get the selected service type.
   */
  getSelectedServiceType$(): Observable<ServiceTypeResponse | null> {
    return this.store.select(selectSelectedServiceType);
  }

  /**
   * Get loading state for service types list.
   */
  getServiceTypesLoading$(): Observable<boolean> {
    return this.store.select(selectServiceTypesLoading);
  }

  /**
   * Get loading state for a single service type operation.
   */
  getServiceTypeLoading$(): Observable<boolean> {
    return this.store.select(selectServiceTypeLoading);
  }

  /**
   * Get creating state.
   */
  getServiceTypesCreating$(): Observable<boolean> {
    return this.store.select(selectServiceTypesCreating);
  }

  /**
   * Get updating state.
   */
  getServiceTypesUpdating$(): Observable<boolean> {
    return this.store.select(selectServiceTypesUpdating);
  }

  /**
   * Get deleting state.
   */
  getServiceTypesDeleting$(): Observable<boolean> {
    return this.store.select(selectServiceTypesDeleting);
  }

  /**
   * Get combined loading state (true if any operation is loading).
   */
  getServiceTypesLoadingAny$(): Observable<boolean> {
    return this.store.select(selectServiceTypesLoadingAny);
  }

  /**
   * Get error state.
   */
  getServiceTypesError$(): Observable<string | null> {
    return this.store.select(selectServiceTypesError);
  }

  /**
   * Get count of service types.
   */
  getServiceTypesCount$(): Observable<number> {
    return this.store.select(selectServiceTypesCount);
  }

  /**
   * Check if there are any service types.
   */
  hasServiceTypes$(): Observable<boolean> {
    return this.store.select(selectHasServiceTypes);
  }

  /**
   * Get a specific service type by ID.
   */
  getServiceTypeById$(id: string): Observable<ServiceTypeResponse | undefined> {
    return this.store.select(selectServiceTypeById(id));
  }

  /**
   * Get a specific service type by key.
   */
  getServiceTypeByKey$(key: string): Observable<ServiceTypeResponse | undefined> {
    return this.store.select(selectServiceTypeByKey(key));
  }

  /**
   * Get active service types only.
   */
  getActiveServiceTypes$(): Observable<ServiceTypeResponse[]> {
    return this.store.select(selectActiveServiceTypes);
  }

  /**
   * Load all service types with optional pagination.
   */
  loadServiceTypes(params?: ListParams): void {
    this.store.dispatch(loadServiceTypes({ params }));
  }

  /**
   * Load a specific service type by ID.
   */
  loadServiceType(id: string): void {
    this.store.dispatch(loadServiceType({ id }));
  }

  /**
   * Create a new service type.
   */
  createServiceType(serviceType: CreateServiceTypeDto): void {
    this.store.dispatch(createServiceType({ serviceType }));
  }

  /**
   * Update an existing service type.
   */
  updateServiceType(id: string, serviceType: UpdateServiceTypeDto): void {
    this.store.dispatch(updateServiceType({ id, serviceType }));
  }

  /**
   * Delete a service type.
   */
  deleteServiceType(id: string): void {
    this.store.dispatch(deleteServiceType({ id }));
  }

  /**
   * Clear the selected service type.
   */
  clearSelectedServiceType(): void {
    this.store.dispatch(clearSelectedServiceType());
  }
}
