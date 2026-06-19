import type { CustomerProfileResponse } from '../../types/billing.types';

import { initialCustomerProfileState, type CustomerProfileState } from './customer-profile.reducer';
import {
  selectCustomerProfile,
  selectCustomerProfileError,
  selectCustomerProfileLoading,
  selectCustomerProfileLoadingAny,
  selectCustomerProfileState,
  selectCustomerProfileUpdating,
  selectHasCustomerProfile,
  selectIsCustomerProfileComplete,
} from './customer-profile.selectors';

describe('Customer Profile Selectors', () => {
  const mockProfile: CustomerProfileResponse = {
    id: 'cp-1',
    userId: 'user-1',
    firstName: 'John',
    lastName: 'Doe',
    email: 'john@example.com',
    addressLine1: '123 Main St',
    city: 'Berlin',
    country: 'DE',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
  const createState = (overrides?: Partial<CustomerProfileState>): CustomerProfileState => ({
    ...initialCustomerProfileState,
    ...overrides,
  });

  describe('selectCustomerProfileState', () => {
    it('should select the customer profile feature state', () => {
      const state = createState();
      const rootState = { customerProfile: state };

      expect(selectCustomerProfileState(rootState as never)).toEqual(state);
    });
  });

  describe('selectCustomerProfile', () => {
    it('should select profile', () => {
      const state = createState({ profile: mockProfile });
      const rootState = { customerProfile: state };

      expect(selectCustomerProfile(rootState as never)).toEqual(mockProfile);
    });
  });

  describe('selectCustomerProfileLoading', () => {
    it('should return loading state', () => {
      const state = createState({ loading: true });
      const rootState = { customerProfile: state };

      expect(selectCustomerProfileLoading(rootState as never)).toBe(true);
    });
  });

  describe('selectCustomerProfileUpdating', () => {
    it('should return updating state', () => {
      const state = createState({ updating: true });
      const rootState = { customerProfile: state };

      expect(selectCustomerProfileUpdating(rootState as never)).toBe(true);
    });
  });

  describe('selectCustomerProfileError', () => {
    it('should return error', () => {
      const state = createState({ error: 'Test error' });
      const rootState = { customerProfile: state };

      expect(selectCustomerProfileError(rootState as never)).toBe('Test error');
    });
  });

  describe('selectCustomerProfileLoadingAny', () => {
    it('should return true when loading or updating', () => {
      const state = createState({ loading: true });
      const rootState = { customerProfile: state };

      expect(selectCustomerProfileLoadingAny(rootState as never)).toBe(true);
    });
  });

  describe('selectHasCustomerProfile', () => {
    it('should return true when profile exists', () => {
      const state = createState({ profile: mockProfile });
      const rootState = { customerProfile: state };

      expect(selectHasCustomerProfile(rootState as never)).toBe(true);
    });
    it('should return false when profile is null', () => {
      const state = createState({ profile: null });
      const rootState = { customerProfile: state };

      expect(selectHasCustomerProfile(rootState as never)).toBe(false);
    });
  });

  describe('selectIsCustomerProfileComplete', () => {
    it('should return true when profile has required fields', () => {
      const state = createState({ profile: mockProfile });
      const rootState = { customerProfile: state };

      expect(selectIsCustomerProfileComplete(rootState as never)).toBe(true);
    });
    it('should return false when profile is null', () => {
      const state = createState({ profile: null });
      const rootState = { customerProfile: state };

      expect(selectIsCustomerProfileComplete(rootState as never)).toBe(false);
    });
    it('should return false when required field is null', () => {
      const incomplete = { ...mockProfile, firstName: null };
      const state = createState({ profile: incomplete });
      const rootState = { customerProfile: state };

      expect(selectIsCustomerProfileComplete(rootState as never)).toBe(false);
    });
  });
});
