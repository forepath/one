import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';

import type {
  AvailabilityCheckDto,
  AvailabilityResponse,
  PricingPreviewDto,
  PricingPreviewResponse,
} from '../../types/billing.types';

import {
  checkAvailability,
  checkAvailabilityAlternatives,
  clearAvailability,
  previewPricing,
} from './availability.actions';
import { AvailabilityFacade } from './availability.facade';

describe('AvailabilityFacade', () => {
  let facade: AvailabilityFacade;
  let store: jest.Mocked<Store>;
  const mockCheck: AvailabilityCheckDto = {
    serviceTypeId: 'st-1',
    region: 'eu',
    serverType: 'small',
  };
  const mockAvailability: AvailabilityResponse = { isAvailable: true, reason: 'OK' };
  const mockPricing: PricingPreviewResponse = {
    basePrice: 100,
    marginPercent: 10,
    marginFixed: 5,
    totalPrice: 115,
  };

  beforeEach(() => {
    store = { select: jest.fn(), dispatch: jest.fn() } as never;

    TestBed.configureTestingModule({
      providers: [AvailabilityFacade, { provide: Store, useValue: store }],
    });

    facade = TestBed.inject(AvailabilityFacade);
  });

  describe('State Observables', () => {
    it('should return availability observable', (done) => {
      store.select.mockReturnValue(of(mockAvailability));
      facade.getAvailability$().subscribe((result) => {
        expect(result).toEqual(mockAvailability);
        done();
      });
    });

    it('should return pricing preview observable', (done) => {
      store.select.mockReturnValue(of(mockPricing));
      facade.getPricingPreview$().subscribe((result) => {
        expect(result).toEqual(mockPricing);
        done();
      });
    });

    it('should return isAvailable observable', (done) => {
      store.select.mockReturnValue(of(true));
      facade.isAvailable$().subscribe((result) => {
        expect(result).toBe(true);
        done();
      });
    });
  });

  describe('Action Methods', () => {
    it('should dispatch checkAvailability', () => {
      facade.checkAvailability(mockCheck);
      expect(store.dispatch).toHaveBeenCalledWith(checkAvailability({ check: mockCheck }));
    });

    it('should dispatch checkAvailabilityAlternatives', () => {
      facade.checkAvailabilityAlternatives(mockCheck);
      expect(store.dispatch).toHaveBeenCalledWith(checkAvailabilityAlternatives({ check: mockCheck }));
    });

    it('should dispatch previewPricing', () => {
      const preview: PricingPreviewDto = { planId: 'plan-1' };

      facade.previewPricing(preview);
      expect(store.dispatch).toHaveBeenCalledWith(previewPricing({ preview }));
    });

    it('should dispatch clearAvailability', () => {
      facade.clearAvailability();
      expect(store.dispatch).toHaveBeenCalledWith(clearAvailability());
    });
  });
});
