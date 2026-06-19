import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { of, throwError } from 'rxjs';

import { AvailabilityService } from '../../services/availability.service';
import type { AvailabilityResponse, PricingPreviewResponse } from '../../types/billing.types';

import {
  checkAvailability,
  checkAvailabilityAlternatives,
  checkAvailabilityAlternativesFailure,
  checkAvailabilityAlternativesSuccess,
  checkAvailabilityFailure,
  checkAvailabilitySuccess,
  previewPricing,
  previewPricingFailure,
  previewPricingSuccess,
} from './availability.actions';
import { checkAvailability$, checkAvailabilityAlternatives$, previewPricing$ } from './availability.effects';

describe('AvailabilityEffects', () => {
  let actions$: Actions;
  let availabilityService: jest.Mocked<AvailabilityService>;
  const mockAvailability: AvailabilityResponse = { isAvailable: true, reason: 'OK' };
  const mockPricing: PricingPreviewResponse = {
    basePrice: 100,
    marginPercent: 10,
    marginFixed: 5,
    totalPrice: 115,
  };
  const mockCheck = { serviceTypeId: 'st-1', region: 'eu', serverType: 'small' };

  beforeEach(() => {
    availabilityService = {
      checkAvailability: jest.fn(),
      checkAvailabilityAlternatives: jest.fn(),
      previewPricing: jest.fn(),
    } as never;

    TestBed.configureTestingModule({
      providers: [provideMockActions(() => actions$), { provide: AvailabilityService, useValue: availabilityService }],
    });

    actions$ = TestBed.inject(Actions);
  });

  describe('checkAvailability$', () => {
    it('should return checkAvailabilitySuccess on success', (done) => {
      actions$ = of(checkAvailability({ check: mockCheck }));
      availabilityService.checkAvailability.mockReturnValue(of(mockAvailability));

      checkAvailability$(actions$, availabilityService).subscribe((result) => {
        expect(result).toEqual(checkAvailabilitySuccess({ response: mockAvailability }));
        expect(availabilityService.checkAvailability).toHaveBeenCalledWith(mockCheck);
        done();
      });
    });

    it('should return checkAvailabilityFailure on error', (done) => {
      actions$ = of(checkAvailability({ check: mockCheck }));
      availabilityService.checkAvailability.mockReturnValue(throwError(() => new Error('Check failed')));

      checkAvailability$(actions$, availabilityService).subscribe((result) => {
        expect(result).toEqual(checkAvailabilityFailure({ error: 'Check failed' }));
        done();
      });
    });
  });

  describe('checkAvailabilityAlternatives$', () => {
    it('should return checkAvailabilityAlternativesSuccess on success', (done) => {
      actions$ = of(checkAvailabilityAlternatives({ check: mockCheck }));
      availabilityService.checkAvailabilityAlternatives.mockReturnValue(of(mockAvailability));

      checkAvailabilityAlternatives$(actions$, availabilityService).subscribe((result) => {
        expect(result).toEqual(checkAvailabilityAlternativesSuccess({ response: mockAvailability }));
        done();
      });
    });

    it('should return checkAvailabilityAlternativesFailure on error', (done) => {
      actions$ = of(checkAvailabilityAlternatives({ check: mockCheck }));
      availabilityService.checkAvailabilityAlternatives.mockReturnValue(
        throwError(() => new Error('Alternatives failed')),
      );

      checkAvailabilityAlternatives$(actions$, availabilityService).subscribe((result) => {
        expect(result).toEqual(checkAvailabilityAlternativesFailure({ error: 'Alternatives failed' }));
        done();
      });
    });
  });

  describe('previewPricing$', () => {
    it('should return previewPricingSuccess on success', (done) => {
      const preview = { planId: 'plan-1' };

      actions$ = of(previewPricing({ preview }));
      availabilityService.previewPricing.mockReturnValue(of(mockPricing));

      previewPricing$(actions$, availabilityService).subscribe((result) => {
        expect(result).toEqual(previewPricingSuccess({ response: mockPricing }));
        expect(availabilityService.previewPricing).toHaveBeenCalledWith(preview);
        done();
      });
    });

    it('should return previewPricingFailure on error', (done) => {
      actions$ = of(previewPricing({ preview: { planId: 'plan-1' } }));
      availabilityService.previewPricing.mockReturnValue(throwError(() => new Error('Pricing failed')));

      previewPricing$(actions$, availabilityService).subscribe((result) => {
        expect(result).toEqual(previewPricingFailure({ error: 'Pricing failed' }));
        done();
      });
    });
  });
});
