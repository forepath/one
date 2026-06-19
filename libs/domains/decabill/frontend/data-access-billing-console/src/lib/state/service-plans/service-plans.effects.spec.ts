import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { of, throwError } from 'rxjs';

import { ServicePlansService } from '../../services/service-plans.service';
import type { ServicePlanResponse } from '../../types/billing.types';

import {
  createServicePlan,
  createServicePlanFailure,
  createServicePlanSuccess,
  deleteServicePlan,
  deleteServicePlanFailure,
  deleteServicePlanSuccess,
  loadServicePlan,
  loadServicePlanFailure,
  loadServicePlans,
  loadServicePlansBatch,
  loadServicePlansFailure,
  loadServicePlansSuccess,
  loadServicePlanSuccess,
  updateServicePlan,
  updateServicePlanFailure,
  updateServicePlanSuccess,
} from './service-plans.actions';
import {
  createServicePlan$,
  deleteServicePlan$,
  loadServicePlan$,
  loadServicePlans$,
  loadServicePlansBatch$,
  updateServicePlan$,
} from './service-plans.effects';

describe('ServicePlansEffects', () => {
  let actions$: Actions;
  let servicePlansService: jest.Mocked<ServicePlansService>;
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
    servicePlansService = {
      listServicePlans: jest.fn(),
      getServicePlan: jest.fn(),
      createServicePlan: jest.fn(),
      updateServicePlan: jest.fn(),
      deleteServicePlan: jest.fn(),
    } as never;

    TestBed.configureTestingModule({
      providers: [provideMockActions(() => actions$), { provide: ServicePlansService, useValue: servicePlansService }],
    });

    actions$ = TestBed.inject(Actions);
  });

  describe('loadServicePlans$', () => {
    it('should return loadServicePlansSuccess when batch is empty', (done) => {
      actions$ = of(loadServicePlans({ params: {} }));
      servicePlansService.listServicePlans.mockReturnValue(of([]));

      loadServicePlans$(actions$, servicePlansService).subscribe((result) => {
        expect(result).toEqual(loadServicePlansSuccess({ servicePlans: [] }));
        done();
      });
    });

    it('should return loadServicePlansFailure on error', (done) => {
      actions$ = of(loadServicePlans({ params: {} }));
      servicePlansService.listServicePlans.mockReturnValue(throwError(() => new Error('Load failed')));

      loadServicePlans$(actions$, servicePlansService).subscribe((result) => {
        expect(result).toEqual(loadServicePlansFailure({ error: 'Load failed' }));
        done();
      });
    });
  });

  describe('loadServicePlansBatch$', () => {
    it('should return loadServicePlansSuccess when batch is empty', (done) => {
      const accumulated = [mockPlan];

      actions$ = of(loadServicePlansBatch({ offset: 10, accumulatedServicePlans: accumulated }));
      servicePlansService.listServicePlans.mockReturnValue(of([]));

      loadServicePlansBatch$(actions$, servicePlansService).subscribe((result) => {
        expect(result).toEqual(loadServicePlansSuccess({ servicePlans: accumulated }));
        done();
      });
    });
  });

  describe('loadServicePlan$', () => {
    it('should return loadServicePlanSuccess on success', (done) => {
      actions$ = of(loadServicePlan({ id: 'sp-1' }));
      servicePlansService.getServicePlan.mockReturnValue(of(mockPlan));

      loadServicePlan$(actions$, servicePlansService).subscribe((result) => {
        expect(result).toEqual(loadServicePlanSuccess({ servicePlan: mockPlan }));
        done();
      });
    });

    it('should return loadServicePlanFailure on error', (done) => {
      actions$ = of(loadServicePlan({ id: 'sp-1' }));
      servicePlansService.getServicePlan.mockReturnValue(throwError(() => new Error('Load failed')));

      loadServicePlan$(actions$, servicePlansService).subscribe((result) => {
        expect(result).toEqual(loadServicePlanFailure({ error: 'Load failed' }));
        done();
      });
    });
  });

  describe('createServicePlan$', () => {
    it('should return createServicePlanSuccess on success', (done) => {
      actions$ = of(createServicePlan({ servicePlan: {} as never }));
      servicePlansService.createServicePlan.mockReturnValue(of(mockPlan));

      createServicePlan$(actions$, servicePlansService).subscribe((result) => {
        expect(result).toEqual(createServicePlanSuccess({ servicePlan: mockPlan }));
        done();
      });
    });

    it('should return createServicePlanFailure on error', (done) => {
      actions$ = of(createServicePlan({ servicePlan: {} as never }));
      servicePlansService.createServicePlan.mockReturnValue(throwError(() => new Error('Create failed')));

      createServicePlan$(actions$, servicePlansService).subscribe((result) => {
        expect(result).toEqual(createServicePlanFailure({ error: 'Create failed' }));
        done();
      });
    });
  });

  describe('updateServicePlan$', () => {
    it('should return updateServicePlanSuccess on success', (done) => {
      const updated = { ...mockPlan, name: 'Updated' };

      actions$ = of(updateServicePlan({ id: 'sp-1', servicePlan: { name: 'Updated' } }));
      servicePlansService.updateServicePlan.mockReturnValue(of(updated));

      updateServicePlan$(actions$, servicePlansService).subscribe((result) => {
        expect(result).toEqual(updateServicePlanSuccess({ servicePlan: updated }));
        done();
      });
    });

    it('should return updateServicePlanFailure on error', (done) => {
      actions$ = of(updateServicePlan({ id: 'sp-1', servicePlan: {} }));
      servicePlansService.updateServicePlan.mockReturnValue(throwError(() => new Error('Update failed')));

      updateServicePlan$(actions$, servicePlansService).subscribe((result) => {
        expect(result).toEqual(updateServicePlanFailure({ error: 'Update failed' }));
        done();
      });
    });
  });

  describe('deleteServicePlan$', () => {
    it('should return deleteServicePlanSuccess on success', (done) => {
      actions$ = of(deleteServicePlan({ id: 'sp-1' }));
      servicePlansService.deleteServicePlan.mockReturnValue(of(undefined));

      deleteServicePlan$(actions$, servicePlansService).subscribe((result) => {
        expect(result).toEqual(deleteServicePlanSuccess({ id: 'sp-1' }));
        done();
      });
    });

    it('should return deleteServicePlanFailure on error', (done) => {
      actions$ = of(deleteServicePlan({ id: 'sp-1' }));
      servicePlansService.deleteServicePlan.mockReturnValue(throwError(() => new Error('Delete failed')));

      deleteServicePlan$(actions$, servicePlansService).subscribe((result) => {
        expect(result).toEqual(deleteServicePlanFailure({ error: 'Delete failed' }));
        done();
      });
    });
  });
});
