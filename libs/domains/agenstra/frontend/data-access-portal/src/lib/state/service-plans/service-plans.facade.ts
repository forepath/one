import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import type {
  PublicServicePlanOffering,
  PublicServicePlanOfferingsListParams,
} from '../../types/portal-service-plans.types';

import { loadCheapestServicePlanOffering, loadServicePlans } from './service-plans.actions';
import {
  selectCheapestServicePlanOffering,
  selectCheapestServicePlanOfferingError,
  selectCheapestServicePlanOfferingLoaded,
  selectCheapestServicePlanOfferingLoading,
  selectHasServicePlans,
  selectServicePlansByServiceTypeId,
  selectServicePlanById,
  selectServicePlansCount,
  selectServicePlansEntities,
  selectServicePlansError,
  selectServicePlansLoaded,
  selectServicePlansLoading,
} from './service-plans.selectors';

@Injectable({
  providedIn: 'root',
})
export class ServicePlansFacade {
  private readonly store = inject(Store);

  getServicePlans$(): Observable<PublicServicePlanOffering[]> {
    return this.store.select(selectServicePlansEntities);
  }

  getCheapestServicePlanOffering$(): Observable<PublicServicePlanOffering | null> {
    return this.store.select(selectCheapestServicePlanOffering);
  }

  getServicePlansLoading$(): Observable<boolean> {
    return this.store.select(selectServicePlansLoading);
  }

  getCheapestServicePlanOfferingLoading$(): Observable<boolean> {
    return this.store.select(selectCheapestServicePlanOfferingLoading);
  }

  getServicePlansLoaded$(): Observable<boolean> {
    return this.store.select(selectServicePlansLoaded);
  }

  getCheapestServicePlanOfferingLoaded$(): Observable<boolean> {
    return this.store.select(selectCheapestServicePlanOfferingLoaded);
  }

  getServicePlansError$(): Observable<string | null> {
    return this.store.select(selectServicePlansError);
  }

  getCheapestServicePlanOfferingError$(): Observable<string | null> {
    return this.store.select(selectCheapestServicePlanOfferingError);
  }

  getServicePlansCount$(): Observable<number> {
    return this.store.select(selectServicePlansCount);
  }

  hasServicePlans$(): Observable<boolean> {
    return this.store.select(selectHasServicePlans);
  }

  getServicePlanById$(id: string): Observable<PublicServicePlanOffering | undefined> {
    return this.store.select(selectServicePlanById(id));
  }

  getServicePlansByServiceTypeId$(serviceTypeId: string): Observable<PublicServicePlanOffering[]> {
    return this.store.select(selectServicePlansByServiceTypeId(serviceTypeId));
  }

  loadServicePlans(params?: PublicServicePlanOfferingsListParams): void {
    this.store.dispatch(loadServicePlans({ params }));
  }

  loadCheapestServicePlanOffering(serviceTypeId?: string): void {
    this.store.dispatch(loadCheapestServicePlanOffering({ serviceTypeId }));
  }
}
