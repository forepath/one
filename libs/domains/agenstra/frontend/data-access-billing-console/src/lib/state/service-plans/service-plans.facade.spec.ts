import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';

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
import { ServicePlansFacade } from './service-plans.facade';

describe('ServicePlansFacade', () => {
  let facade: ServicePlansFacade;
  let store: jest.Mocked<Store>;
  const mockPlan: ServicePlanResponse = {
    id: 'sp-1',
    serviceTypeId: 'st-1',
    name: 'Basic',
    billingIntervalType: 'month',
    billingIntervalValue: 1,
    cancelAtPeriodEnd: false,
    minCommitmentDays: 0,
    noticeDays: 0,
    providerConfigDefaults: {},
    orderingHighlights: [],
    allowCustomerLocationSelection: false,
    isActive: true,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };

  beforeEach(() => {
    store = { select: jest.fn(), dispatch: jest.fn() } as never;

    TestBed.configureTestingModule({
      providers: [ServicePlansFacade, { provide: Store, useValue: store }],
    });

    facade = TestBed.inject(ServicePlansFacade);
  });

  describe('State Observables', () => {
    it('should return service plans observable', (done) => {
      store.select.mockReturnValue(of([mockPlan]));
      facade.getServicePlans$().subscribe((result) => {
        expect(result).toEqual([mockPlan]);
        done();
      });
    });

    it('should return selected service plan observable', (done) => {
      store.select.mockReturnValue(of(mockPlan));
      facade.getSelectedServicePlan$().subscribe((result) => {
        expect(result).toEqual(mockPlan);
        done();
      });
    });
  });

  describe('Action Methods', () => {
    it('should dispatch loadServicePlans', () => {
      const params: ListParams = { limit: 10 };

      facade.loadServicePlans(params);
      expect(store.dispatch).toHaveBeenCalledWith(loadServicePlans({ params }));
    });

    it('should dispatch loadServicePlan', () => {
      facade.loadServicePlan('sp-1');
      expect(store.dispatch).toHaveBeenCalledWith(loadServicePlan({ id: 'sp-1' }));
    });

    it('should dispatch createServicePlan', () => {
      const dto: CreateServicePlanDto = {
        serviceTypeId: 'st-1',
        name: 'New',
        billingIntervalType: 'month',
        billingIntervalValue: 1,
      };

      facade.createServicePlan(dto);
      expect(store.dispatch).toHaveBeenCalledWith(createServicePlan({ servicePlan: dto }));
    });

    it('should dispatch updateServicePlan', () => {
      const dto: UpdateServicePlanDto = { name: 'Updated' };

      facade.updateServicePlan('sp-1', dto);
      expect(store.dispatch).toHaveBeenCalledWith(updateServicePlan({ id: 'sp-1', servicePlan: dto }));
    });

    it('should dispatch deleteServicePlan', () => {
      facade.deleteServicePlan('sp-1');
      expect(store.dispatch).toHaveBeenCalledWith(deleteServicePlan({ id: 'sp-1' }));
    });

    it('should dispatch clearSelectedServicePlan', () => {
      facade.clearSelectedServicePlan();
      expect(store.dispatch).toHaveBeenCalledWith(clearSelectedServicePlan());
    });
  });
});
