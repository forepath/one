import type { AvailabilityResponse, PricingPreviewResponse } from '../../types/billing.types';

import {
  checkAvailability,
  checkAvailabilityAlternatives,
  checkAvailabilityAlternativesFailure,
  checkAvailabilityAlternativesSuccess,
  checkAvailabilityFailure,
  checkAvailabilitySuccess,
  clearAvailability,
  previewPricing,
  previewPricingFailure,
  previewPricingSuccess,
} from './availability.actions';
import { availabilityReducer, initialAvailabilityState, type AvailabilityState } from './availability.reducer';

describe('availabilityReducer', () => {
  const mockAvailability: AvailabilityResponse = {
    isAvailable: true,
    reason: 'Available',
  };
  const mockPricing: PricingPreviewResponse = {
    basePrice: 100,
    marginPercent: 10,
    marginFixed: 5,
    totalPrice: 115,
  };

  describe('initial state', () => {
    it('should return the initial state', () => {
      const action = { type: 'UNKNOWN' };

      expect(availabilityReducer(undefined, action as never)).toEqual(initialAvailabilityState);
    });
  });

  describe('checkAvailability', () => {
    it('should set loadingAvailability to true and clear error', () => {
      const state: AvailabilityState = { ...initialAvailabilityState, error: 'Previous error' };
      const newState = availabilityReducer(
        state,
        checkAvailability({ check: { serviceTypeId: 'st-1', region: 'eu', serverType: 'small' } }),
      );

      expect(newState.loadingAvailability).toBe(true);
      expect(newState.error).toBeNull();
    });
  });

  describe('checkAvailabilitySuccess', () => {
    it('should set availability and set loadingAvailability to false', () => {
      const state: AvailabilityState = { ...initialAvailabilityState, loadingAvailability: true };
      const newState = availabilityReducer(state, checkAvailabilitySuccess({ response: mockAvailability }));

      expect(newState.availability).toEqual(mockAvailability);
      expect(newState.loadingAvailability).toBe(false);
      expect(newState.error).toBeNull();
    });
  });

  describe('checkAvailabilityFailure', () => {
    it('should set error and set loadingAvailability to false', () => {
      const state: AvailabilityState = { ...initialAvailabilityState, loadingAvailability: true };
      const newState = availabilityReducer(state, checkAvailabilityFailure({ error: 'Check failed' }));

      expect(newState.error).toBe('Check failed');
      expect(newState.loadingAvailability).toBe(false);
    });
  });

  describe('checkAvailabilityAlternatives', () => {
    it('should set loadingAlternatives to true and clear error', () => {
      const state: AvailabilityState = { ...initialAvailabilityState, error: 'Previous error' };
      const newState = availabilityReducer(
        state,
        checkAvailabilityAlternatives({ check: { serviceTypeId: 'st-1', region: 'eu', serverType: 'small' } }),
      );

      expect(newState.loadingAlternatives).toBe(true);
      expect(newState.error).toBeNull();
    });
  });

  describe('checkAvailabilityAlternativesSuccess', () => {
    it('should set alternatives and set loadingAlternatives to false', () => {
      const state: AvailabilityState = { ...initialAvailabilityState, loadingAlternatives: true };
      const newState = availabilityReducer(state, checkAvailabilityAlternativesSuccess({ response: mockAvailability }));

      expect(newState.alternatives).toEqual(mockAvailability);
      expect(newState.loadingAlternatives).toBe(false);
      expect(newState.error).toBeNull();
    });
  });

  describe('checkAvailabilityAlternativesFailure', () => {
    it('should set error and set loadingAlternatives to false', () => {
      const state: AvailabilityState = { ...initialAvailabilityState, loadingAlternatives: true };
      const newState = availabilityReducer(
        state,
        checkAvailabilityAlternativesFailure({ error: 'Alternatives failed' }),
      );

      expect(newState.error).toBe('Alternatives failed');
      expect(newState.loadingAlternatives).toBe(false);
    });
  });

  describe('previewPricing', () => {
    it('should set loadingPricing to true and clear error', () => {
      const state: AvailabilityState = { ...initialAvailabilityState, error: 'Previous error' };
      const newState = availabilityReducer(state, previewPricing({ preview: { planId: 'plan-1' } }));

      expect(newState.loadingPricing).toBe(true);
      expect(newState.error).toBeNull();
    });
  });

  describe('previewPricingSuccess', () => {
    it('should set pricing and set loadingPricing to false', () => {
      const state: AvailabilityState = { ...initialAvailabilityState, loadingPricing: true };
      const newState = availabilityReducer(state, previewPricingSuccess({ response: mockPricing }));

      expect(newState.pricing).toEqual(mockPricing);
      expect(newState.loadingPricing).toBe(false);
      expect(newState.error).toBeNull();
    });
  });

  describe('previewPricingFailure', () => {
    it('should set error and set loadingPricing to false', () => {
      const state: AvailabilityState = { ...initialAvailabilityState, loadingPricing: true };
      const newState = availabilityReducer(state, previewPricingFailure({ error: 'Pricing failed' }));

      expect(newState.error).toBe('Pricing failed');
      expect(newState.loadingPricing).toBe(false);
    });
  });

  describe('clearAvailability', () => {
    it('should reset to initial state', () => {
      const state: AvailabilityState = {
        ...initialAvailabilityState,
        availability: mockAvailability,
        pricing: mockPricing,
      };
      const newState = availabilityReducer(state, clearAvailability());

      expect(newState).toEqual(initialAvailabilityState);
    });
  });
});
