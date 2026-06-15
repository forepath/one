import { initialAvailabilityState, type AvailabilityState } from './availability.reducer';
import {
  selectAvailability,
  selectAvailabilityAlternatives,
  selectAvailabilityAlternativesLoading,
  selectAvailabilityError,
  selectAvailabilityLoading,
  selectAvailabilityLoadingAny,
  selectAvailabilityReason,
  selectAvailabilityState,
  selectHasAlternatives,
  selectIsAvailable,
  selectPricingPreview,
  selectPricingPreviewLoading,
} from './availability.selectors';

describe('Availability Selectors', () => {
  const createState = (overrides?: Partial<AvailabilityState>): AvailabilityState => ({
    ...initialAvailabilityState,
    ...overrides,
  });

  describe('selectAvailabilityState', () => {
    it('should select the availability feature state', () => {
      const state = createState();
      const rootState = { availability: state };

      expect(selectAvailabilityState(rootState as never)).toEqual(state);
    });
  });

  describe('selectAvailability', () => {
    it('should select availability', () => {
      const availability = { isAvailable: true, reason: 'OK' };
      const state = createState({ availability });
      const rootState = { availability: state };

      expect(selectAvailability(rootState as never)).toEqual(availability);
    });
  });

  describe('selectAvailabilityAlternatives', () => {
    it('should select alternatives', () => {
      const alternatives = { isAvailable: false, alternatives: {} };
      const state = createState({ alternatives });
      const rootState = { availability: state };

      expect(selectAvailabilityAlternatives(rootState as never)).toEqual(alternatives);
    });
  });

  describe('selectPricingPreview', () => {
    it('should select pricing', () => {
      const pricing = { basePrice: 100, marginPercent: 10, marginFixed: 5, totalPrice: 115 };
      const state = createState({ pricing });
      const rootState = { availability: state };

      expect(selectPricingPreview(rootState as never)).toEqual(pricing);
    });
  });

  describe('selectAvailabilityLoading', () => {
    it('should return loadingAvailability state', () => {
      const state = createState({ loadingAvailability: true });
      const rootState = { availability: state };

      expect(selectAvailabilityLoading(rootState as never)).toBe(true);
    });
  });

  describe('selectAvailabilityAlternativesLoading', () => {
    it('should return loadingAlternatives state', () => {
      const state = createState({ loadingAlternatives: true });
      const rootState = { availability: state };

      expect(selectAvailabilityAlternativesLoading(rootState as never)).toBe(true);
    });
  });

  describe('selectPricingPreviewLoading', () => {
    it('should return loadingPricing state', () => {
      const state = createState({ loadingPricing: true });
      const rootState = { availability: state };

      expect(selectPricingPreviewLoading(rootState as never)).toBe(true);
    });
  });

  describe('selectAvailabilityError', () => {
    it('should return error', () => {
      const state = createState({ error: 'Test error' });
      const rootState = { availability: state };

      expect(selectAvailabilityError(rootState as never)).toBe('Test error');
    });
  });

  describe('selectAvailabilityLoadingAny', () => {
    it('should return true when any loading state is true', () => {
      const state = createState({ loadingAvailability: true });
      const rootState = { availability: state };

      expect(selectAvailabilityLoadingAny(rootState as never)).toBe(true);
    });
  });

  describe('selectIsAvailable', () => {
    it('should return true when availability.isAvailable is true', () => {
      const state = createState({ availability: { isAvailable: true } });
      const rootState = { availability: state };

      expect(selectIsAvailable(rootState as never)).toBe(true);
    });
    it('should return false when availability is null', () => {
      const state = createState({ availability: null });
      const rootState = { availability: state };

      expect(selectIsAvailable(rootState as never)).toBe(false);
    });
  });

  describe('selectAvailabilityReason', () => {
    it('should return reason when availability exists', () => {
      const state = createState({ availability: { isAvailable: false, reason: 'Not available' } });
      const rootState = { availability: state };

      expect(selectAvailabilityReason(rootState as never)).toBe('Not available');
    });
    it('should return null when availability is null', () => {
      const state = createState({ availability: null });
      const rootState = { availability: state };

      expect(selectAvailabilityReason(rootState as never)).toBeNull();
    });
  });

  describe('selectHasAlternatives', () => {
    it('should return true when alternatives has alternatives property', () => {
      const state = createState({ alternatives: { isAvailable: false, alternatives: { key: 'value' } } });
      const rootState = { availability: state };

      expect(selectHasAlternatives(rootState as never)).toBe(true);
    });
    it('should return false when alternatives is null', () => {
      const state = createState({ alternatives: null });
      const rootState = { availability: state };

      expect(selectHasAlternatives(rootState as never)).toBe(false);
    });
  });
});
