import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import type {
  CreateServicePlanDto,
  ListParams,
  ServicePlanResponse,
  UpdateServicePlanDto,
} from '../../types/billing.types';

import {
  clearSelectedServicePlan,
  createServicePlan,
  deleteServicePlan,
  loadServicePlan,
  loadServicePlans,
  updateServicePlan,
} from './service-plans.actions';
import {
  selectActiveServicePlans,
  selectHasServicePlans,
  selectSelectedServicePlan,
  selectServicePlanById,
  selectServicePlanLoading,
  selectServicePlansByServiceTypeId,
  selectServicePlansCount,
  selectServicePlansCreating,
  selectServicePlansDeleting,
  selectServicePlansEntities,
  selectServicePlansError,
  selectServicePlansLoading,
  selectServicePlansLoadingAny,
  selectServicePlansUpdating,
} from './service-plans.selectors';

@Injectable({
  providedIn: 'root',
})
export class ServicePlansFacade {
  private readonly store = inject(Store);

  getServicePlans$(): Observable<ServicePlanResponse[]> {
    return this.store.select(selectServicePlansEntities);
  }

  getSelectedServicePlan$(): Observable<ServicePlanResponse | null> {
    return this.store.select(selectSelectedServicePlan);
  }

  getServicePlansLoading$(): Observable<boolean> {
    return this.store.select(selectServicePlansLoading);
  }

  getServicePlanLoading$(): Observable<boolean> {
    return this.store.select(selectServicePlanLoading);
  }

  getServicePlansCreating$(): Observable<boolean> {
    return this.store.select(selectServicePlansCreating);
  }

  getServicePlansUpdating$(): Observable<boolean> {
    return this.store.select(selectServicePlansUpdating);
  }

  getServicePlansDeleting$(): Observable<boolean> {
    return this.store.select(selectServicePlansDeleting);
  }

  getServicePlansLoadingAny$(): Observable<boolean> {
    return this.store.select(selectServicePlansLoadingAny);
  }

  getServicePlansError$(): Observable<string | null> {
    return this.store.select(selectServicePlansError);
  }

  getServicePlansCount$(): Observable<number> {
    return this.store.select(selectServicePlansCount);
  }

  hasServicePlans$(): Observable<boolean> {
    return this.store.select(selectHasServicePlans);
  }

  getServicePlanById$(id: string): Observable<ServicePlanResponse | undefined> {
    return this.store.select(selectServicePlanById(id));
  }

  getServicePlansByServiceTypeId$(serviceTypeId: string): Observable<ServicePlanResponse[]> {
    return this.store.select(selectServicePlansByServiceTypeId(serviceTypeId));
  }

  getActiveServicePlans$(): Observable<ServicePlanResponse[]> {
    return this.store.select(selectActiveServicePlans);
  }

  loadServicePlans(params?: ListParams): void {
    this.store.dispatch(loadServicePlans({ params }));
  }

  loadServicePlan(id: string): void {
    this.store.dispatch(loadServicePlan({ id }));
  }

  createServicePlan(servicePlan: CreateServicePlanDto): void {
    this.store.dispatch(createServicePlan({ servicePlan }));
  }

  updateServicePlan(id: string, servicePlan: UpdateServicePlanDto): void {
    this.store.dispatch(updateServicePlan({ id, servicePlan }));
  }

  deleteServicePlan(id: string): void {
    this.store.dispatch(deleteServicePlan({ id }));
  }

  clearSelectedServicePlan(): void {
    this.store.dispatch(clearSelectedServicePlan());
  }
}
