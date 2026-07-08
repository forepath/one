import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { of, throwError } from 'rxjs';

import { SERVICE_PLANS_BATCH_SIZE } from '../../constants/service-plans.constants';
import { PublicServicePlanOfferingsService } from '../../services/public-service-plan-offerings.service';
import type { PublicServicePlanOffering } from '../../types/portal-service-plans.types';

import {
  loadCheapestServicePlanOffering,
  loadCheapestServicePlanOfferingFailure,
  loadCheapestServicePlanOfferingSuccess,
  loadServicePlans,
  loadServicePlansBatch,
  loadServicePlansFailure,
  loadServicePlansSuccess,
} from './service-plans.actions';
import { loadCheapestServicePlanOffering$, loadServicePlans$, loadServicePlansBatch$ } from './service-plans.effects';

describe('Portal ServicePlansEffects', () => {
  let actions$: Actions;
  let offeringsService: jest.Mocked<PublicServicePlanOfferingsService>;
  const mockOffering: PublicServicePlanOffering = {
    id: 'sp-1',
    name: 'Basic',
    description: null,
    serviceTypeId: 'st-1',
    serviceTypeName: 'Cloud',
    billingIntervalType: 'month',
    billingIntervalValue: 1,
    totalPrice: 99,
    orderingHighlights: [],
    allowCustomerServerTypeSelection: false,
    withdrawalPolicy: {
      periodDays: 14,
      allowedAfterProvisioning: true,
      unprovisionedAlwaysWithdrawable: true,
      provisionedRefundPolicy: 'unused_period_prorated',
    },
  };
  const createOfferings = (count: number): PublicServicePlanOffering[] =>
    Array.from({ length: count }, (_, index) => ({
      ...mockOffering,
      id: `sp-${index}`,
      name: `Plan ${index}`,
    }));

  beforeEach(() => {
    offeringsService = {
      listOfferings: jest.fn(),
      getCheapestOffering: jest.fn(),
    } as never;

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => actions$),
        { provide: PublicServicePlanOfferingsService, useValue: offeringsService },
      ],
    });

    actions$ = TestBed.inject(Actions);
  });

  describe('loadServicePlans$', () => {
    it('should return loadServicePlansSuccess when batch is empty', (done) => {
      actions$ = of(loadServicePlans({ params: {} }));
      offeringsService.listOfferings.mockReturnValue(of([]));

      loadServicePlans$(actions$, offeringsService).subscribe((result) => {
        expect(result).toEqual(loadServicePlansSuccess({ servicePlans: [] }));
        done();
      });
    });

    it('should return loadServicePlansSuccess when batch is smaller than page size', (done) => {
      const partialBatch = createOfferings(3);

      actions$ = of(loadServicePlans({ params: {} }));
      offeringsService.listOfferings.mockReturnValue(of(partialBatch));

      loadServicePlans$(actions$, offeringsService).subscribe((result) => {
        expect(result).toEqual(loadServicePlansSuccess({ servicePlans: partialBatch }));
        done();
      });
    });

    it('should return loadServicePlansBatch when first page is full', (done) => {
      const fullBatch = createOfferings(SERVICE_PLANS_BATCH_SIZE);

      actions$ = of(loadServicePlans({ params: { limit: 25 } }));
      offeringsService.listOfferings.mockReturnValue(of(fullBatch));

      loadServicePlans$(actions$, offeringsService).subscribe((result) => {
        expect(result).toEqual(
          loadServicePlansBatch({
            offset: SERVICE_PLANS_BATCH_SIZE,
            accumulatedServicePlans: fullBatch,
          }),
        );
        expect(offeringsService.listOfferings).toHaveBeenCalledWith({
          limit: 25,
          offset: 0,
        });
        done();
      });
    });

    it.each([
      ['Error', () => new Error('Load failed'), 'Load failed'],
      ['string', () => 'Load failed', 'Load failed'],
      ['object message', () => ({ message: 'Load failed' }), 'Load failed'],
      ['unknown', () => ({ code: 500 }), 'An unexpected error occurred'],
    ])('should return loadServicePlansFailure on %s', (_label, errorFactory, expectedMessage, done) => {
      actions$ = of(loadServicePlans({ params: {} }));
      offeringsService.listOfferings.mockReturnValue(throwError(errorFactory));

      loadServicePlans$(actions$, offeringsService).subscribe((result) => {
        expect(result).toEqual(loadServicePlansFailure({ error: expectedMessage }));
        done();
      });
    });
  });

  describe('loadServicePlansBatch$', () => {
    it('should return loadServicePlansSuccess when follow-up batch is empty', (done) => {
      const accumulated = [mockOffering];

      actions$ = of(loadServicePlansBatch({ offset: 10, accumulatedServicePlans: accumulated }));
      offeringsService.listOfferings.mockReturnValue(of([]));

      loadServicePlansBatch$(actions$, offeringsService).subscribe((result) => {
        expect(result).toEqual(loadServicePlansSuccess({ servicePlans: accumulated }));
        done();
      });
    });

    it('should return loadServicePlansSuccess when follow-up batch is partial', (done) => {
      const accumulated = createOfferings(SERVICE_PLANS_BATCH_SIZE);
      const followUp = createOfferings(2);

      actions$ = of(loadServicePlansBatch({ offset: SERVICE_PLANS_BATCH_SIZE, accumulatedServicePlans: accumulated }));
      offeringsService.listOfferings.mockReturnValue(of(followUp));

      loadServicePlansBatch$(actions$, offeringsService).subscribe((result) => {
        expect(result).toEqual(loadServicePlansSuccess({ servicePlans: [...accumulated, ...followUp] }));
        done();
      });
    });

    it('should return loadServicePlansBatch when follow-up batch is full', (done) => {
      const accumulated = createOfferings(SERVICE_PLANS_BATCH_SIZE);
      const followUp = createOfferings(SERVICE_PLANS_BATCH_SIZE);

      actions$ = of(loadServicePlansBatch({ offset: SERVICE_PLANS_BATCH_SIZE, accumulatedServicePlans: accumulated }));
      offeringsService.listOfferings.mockReturnValue(of(followUp));

      loadServicePlansBatch$(actions$, offeringsService).subscribe((result) => {
        expect(result).toEqual(
          loadServicePlansBatch({
            offset: SERVICE_PLANS_BATCH_SIZE * 2,
            accumulatedServicePlans: [...accumulated, ...followUp],
          }),
        );
        done();
      });
    });

    it.each([
      ['Error', () => new Error('Batch failed'), 'Batch failed'],
      ['string', () => 'Batch failed', 'Batch failed'],
      ['object message', () => ({ message: 'Batch failed' }), 'Batch failed'],
      ['unknown', () => null, 'An unexpected error occurred'],
    ])('should return loadServicePlansFailure on %s', (_label, errorFactory, expectedMessage, done) => {
      actions$ = of(loadServicePlansBatch({ offset: 10, accumulatedServicePlans: [mockOffering] }));
      offeringsService.listOfferings.mockReturnValue(throwError(errorFactory));

      loadServicePlansBatch$(actions$, offeringsService).subscribe((result) => {
        expect(result).toEqual(loadServicePlansFailure({ error: expectedMessage }));
        done();
      });
    });
  });

  describe('loadCheapestServicePlanOffering$', () => {
    it('should return loadCheapestServicePlanOfferingSuccess on success', (done) => {
      actions$ = of(loadCheapestServicePlanOffering({}));
      offeringsService.getCheapestOffering.mockReturnValue(of(mockOffering));

      loadCheapestServicePlanOffering$(actions$, offeringsService).subscribe((result) => {
        expect(result).toEqual(loadCheapestServicePlanOfferingSuccess({ offering: mockOffering }));
        done();
      });
    });

    it('should return loadCheapestServicePlanOfferingFailure on error', (done) => {
      actions$ = of(loadCheapestServicePlanOffering({}));
      offeringsService.getCheapestOffering.mockReturnValue(throwError(() => new Error('Not found')));

      loadCheapestServicePlanOffering$(actions$, offeringsService).subscribe((result) => {
        expect(result).toEqual(loadCheapestServicePlanOfferingFailure({ error: 'Not found' }));
        done();
      });
    });
  });
});
