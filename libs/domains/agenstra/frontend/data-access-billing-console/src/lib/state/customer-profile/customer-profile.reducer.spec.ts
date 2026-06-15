import type { CustomerProfileResponse } from '../../types/billing.types';

import {
  clearCustomerProfile,
  loadCustomerProfile,
  loadCustomerProfileFailure,
  loadCustomerProfileSuccess,
  updateCustomerProfile,
  updateCustomerProfileFailure,
  updateCustomerProfileSuccess,
} from './customer-profile.actions';
import {
  customerProfileReducer,
  initialCustomerProfileState,
  type CustomerProfileState,
} from './customer-profile.reducer';

describe('customerProfileReducer', () => {
  const mockProfile: CustomerProfileResponse = {
    id: 'cp-1',
    userId: 'user-1',
    firstName: 'John',
    lastName: 'Doe',
    email: 'john@example.com',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };

  describe('initial state', () => {
    it('should return the initial state', () => {
      const action = { type: 'UNKNOWN' };

      expect(customerProfileReducer(undefined, action as never)).toEqual(initialCustomerProfileState);
    });
  });

  describe('loadCustomerProfile', () => {
    it('should set loading to true and clear error', () => {
      const state: CustomerProfileState = { ...initialCustomerProfileState, error: 'Previous error' };
      const newState = customerProfileReducer(state, loadCustomerProfile());

      expect(newState.loading).toBe(true);
      expect(newState.error).toBeNull();
    });
  });

  describe('loadCustomerProfileSuccess', () => {
    it('should set profile and set loading to false', () => {
      const state: CustomerProfileState = { ...initialCustomerProfileState, loading: true };
      const newState = customerProfileReducer(state, loadCustomerProfileSuccess({ profile: mockProfile }));

      expect(newState.profile).toEqual(mockProfile);
      expect(newState.loading).toBe(false);
      expect(newState.error).toBeNull();
    });
  });

  describe('loadCustomerProfileFailure', () => {
    it('should set error and set loading to false', () => {
      const state: CustomerProfileState = { ...initialCustomerProfileState, loading: true };
      const newState = customerProfileReducer(state, loadCustomerProfileFailure({ error: 'Load failed' }));

      expect(newState.error).toBe('Load failed');
      expect(newState.loading).toBe(false);
    });
  });

  describe('updateCustomerProfile', () => {
    it('should set updating to true and clear error', () => {
      const state: CustomerProfileState = { ...initialCustomerProfileState, error: 'Previous error' };
      const newState = customerProfileReducer(state, updateCustomerProfile({ profile: {} }));

      expect(newState.updating).toBe(true);
      expect(newState.error).toBeNull();
    });
  });

  describe('updateCustomerProfileSuccess', () => {
    it('should set profile and set updating to false', () => {
      const state: CustomerProfileState = {
        ...initialCustomerProfileState,
        profile: mockProfile,
        updating: true,
      };
      const updated = { ...mockProfile, firstName: 'Jane' };
      const newState = customerProfileReducer(state, updateCustomerProfileSuccess({ profile: updated }));

      expect(newState.profile).toEqual(updated);
      expect(newState.updating).toBe(false);
      expect(newState.error).toBeNull();
    });
  });

  describe('updateCustomerProfileFailure', () => {
    it('should set error and set updating to false', () => {
      const state: CustomerProfileState = { ...initialCustomerProfileState, updating: true };
      const newState = customerProfileReducer(state, updateCustomerProfileFailure({ error: 'Update failed' }));

      expect(newState.error).toBe('Update failed');
      expect(newState.updating).toBe(false);
    });
  });

  describe('clearCustomerProfile', () => {
    it('should reset to initial state', () => {
      const state: CustomerProfileState = {
        ...initialCustomerProfileState,
        profile: mockProfile,
      };
      const newState = customerProfileReducer(state, clearCustomerProfile());

      expect(newState).toEqual(initialCustomerProfileState);
    });
  });
});
