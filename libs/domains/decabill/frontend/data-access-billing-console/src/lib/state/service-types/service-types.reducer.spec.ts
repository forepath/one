import type { ServiceTypeResponse } from '../../types/billing.types';

import {
  clearSelectedServiceType,
  createServiceType,
  createServiceTypeFailure,
  createServiceTypeSuccess,
  deleteServiceType,
  deleteServiceTypeFailure,
  deleteServiceTypeSuccess,
  loadProviderDetails,
  loadProviderDetailsFailure,
  loadProviderDetailsSuccess,
  loadServiceType,
  loadServiceTypeFailure,
  loadServiceTypes,
  loadServiceTypesBatch,
  loadServiceTypesFailure,
  loadServiceTypesSuccess,
  loadServiceTypeSuccess,
  updateServiceType,
  updateServiceTypeFailure,
  updateServiceTypeSuccess,
} from './service-types.actions';
import { serviceTypesReducer, initialServiceTypesState, type ServiceTypesState } from './service-types.reducer';

describe('serviceTypesReducer', () => {
  const mockServiceType: ServiceTypeResponse = {
    id: 'st-1',
    key: 'cursor',
    name: 'Cursor',
    provider: 'provider-1',
    configSchema: {},
    isActive: true,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
  const mockServiceType2: ServiceTypeResponse = {
    id: 'st-2',
    key: 'opencode',
    name: 'OpenCode',
    provider: 'provider-1',
    configSchema: {},
    isActive: true,
    createdAt: '2024-01-02T00:00:00Z',
    updatedAt: '2024-01-02T00:00:00Z',
  };

  describe('initial state', () => {
    it('should return the initial state', () => {
      const action = { type: 'UNKNOWN' };
      const state = serviceTypesReducer(undefined, action as never);

      expect(state).toEqual(initialServiceTypesState);
    });
  });

  describe('loadProviderDetails', () => {
    it('should set providerDetailsLoading to true and clear providerDetailsError', () => {
      const state: ServiceTypesState = {
        ...initialServiceTypesState,
        providerDetailsError: 'Previous error',
      };
      const newState = serviceTypesReducer(state, loadProviderDetails());

      expect(newState.providerDetailsLoading).toBe(true);
      expect(newState.providerDetailsError).toBeNull();
    });
  });

  describe('loadProviderDetailsSuccess', () => {
    it('should set provider details and set providerDetailsLoading to false', () => {
      const state: ServiceTypesState = { ...initialServiceTypesState, providerDetailsLoading: true };
      const providerDetails = [{ id: 'hetzner', displayName: 'Hetzner Cloud', configSchema: {} }];
      const newState = serviceTypesReducer(state, loadProviderDetailsSuccess({ providerDetails }));

      expect(newState.providerDetails).toEqual(providerDetails);
      expect(newState.providerDetailsLoading).toBe(false);
      expect(newState.providerDetailsError).toBeNull();
    });
  });

  describe('loadProviderDetailsFailure', () => {
    it('should set providerDetailsError and set providerDetailsLoading to false', () => {
      const state: ServiceTypesState = { ...initialServiceTypesState, providerDetailsLoading: true };
      const newState = serviceTypesReducer(state, loadProviderDetailsFailure({ error: 'Load failed' }));

      expect(newState.providerDetailsError).toBe('Load failed');
      expect(newState.providerDetailsLoading).toBe(false);
    });
  });

  describe('loadServiceTypes', () => {
    it('should set loading to true, clear entities and error', () => {
      const state: ServiceTypesState = {
        ...initialServiceTypesState,
        entities: [mockServiceType],
        error: 'Previous error',
      };
      const newState = serviceTypesReducer(state, loadServiceTypes({ params: {} }));

      expect(newState.loading).toBe(true);
      expect(newState.entities).toEqual([]);
      expect(newState.error).toBeNull();
    });
  });

  describe('loadServiceTypesBatch', () => {
    it('should set accumulated service types and keep loading true', () => {
      const state: ServiceTypesState = { ...initialServiceTypesState, loading: true };
      const newState = serviceTypesReducer(
        state,
        loadServiceTypesBatch({ offset: 10, accumulatedServiceTypes: [mockServiceType, mockServiceType2] }),
      );

      expect(newState.entities).toEqual([mockServiceType, mockServiceType2]);
      expect(newState.loading).toBe(true);
    });
  });

  describe('loadServiceTypesSuccess', () => {
    it('should set service types and set loading to false', () => {
      const state: ServiceTypesState = { ...initialServiceTypesState, loading: true };
      const newState = serviceTypesReducer(
        state,
        loadServiceTypesSuccess({ serviceTypes: [mockServiceType, mockServiceType2] }),
      );

      expect(newState.entities).toEqual([mockServiceType, mockServiceType2]);
      expect(newState.loading).toBe(false);
    });
  });

  describe('loadServiceTypesFailure', () => {
    it('should set error and set loading to false', () => {
      const state: ServiceTypesState = { ...initialServiceTypesState, loading: true };
      const newState = serviceTypesReducer(state, loadServiceTypesFailure({ error: 'Load failed' }));

      expect(newState.error).toBe('Load failed');
      expect(newState.loading).toBe(false);
    });
  });

  describe('loadServiceType', () => {
    it('should set loadingServiceType to true and clear error', () => {
      const state: ServiceTypesState = { ...initialServiceTypesState, error: 'Previous error' };
      const newState = serviceTypesReducer(state, loadServiceType({ id: 'st-1' }));

      expect(newState.loadingServiceType).toBe(true);
      expect(newState.error).toBeNull();
    });
  });

  describe('loadServiceTypeSuccess', () => {
    it('should update service type in list and set selectedServiceType', () => {
      const state: ServiceTypesState = {
        ...initialServiceTypesState,
        entities: [mockServiceType],
        loadingServiceType: true,
      };
      const updated = { ...mockServiceType, name: 'Updated Name' };
      const newState = serviceTypesReducer(state, loadServiceTypeSuccess({ serviceType: updated }));

      expect(newState.entities[0]).toEqual(updated);
      expect(newState.selectedServiceType).toEqual(updated);
      expect(newState.loadingServiceType).toBe(false);
    });
  });

  describe('loadServiceTypeFailure', () => {
    it('should set error and set loadingServiceType to false', () => {
      const state: ServiceTypesState = { ...initialServiceTypesState, loadingServiceType: true };
      const newState = serviceTypesReducer(state, loadServiceTypeFailure({ error: 'Load failed' }));

      expect(newState.error).toBe('Load failed');
      expect(newState.loadingServiceType).toBe(false);
    });
  });

  describe('createServiceType', () => {
    it('should set creating to true and clear error', () => {
      const state: ServiceTypesState = { ...initialServiceTypesState, error: 'Previous error' };
      const newState = serviceTypesReducer(state, createServiceType({ serviceType: {} as never }));

      expect(newState.creating).toBe(true);
      expect(newState.error).toBeNull();
    });
  });

  describe('createServiceTypeSuccess', () => {
    it('should add service type and set selectedServiceType', () => {
      const state: ServiceTypesState = {
        ...initialServiceTypesState,
        entities: [mockServiceType],
        creating: true,
      };
      const newState = serviceTypesReducer(state, createServiceTypeSuccess({ serviceType: mockServiceType2 }));

      expect(newState.entities).toContainEqual(mockServiceType2);
      expect(newState.selectedServiceType).toEqual(mockServiceType2);
      expect(newState.creating).toBe(false);
    });
  });

  describe('createServiceTypeFailure', () => {
    it('should set error and set creating to false', () => {
      const state: ServiceTypesState = { ...initialServiceTypesState, creating: true };
      const newState = serviceTypesReducer(state, createServiceTypeFailure({ error: 'Create failed' }));

      expect(newState.error).toBe('Create failed');
      expect(newState.creating).toBe(false);
    });
  });

  describe('updateServiceType', () => {
    it('should set updating to true and clear error', () => {
      const state: ServiceTypesState = { ...initialServiceTypesState, error: 'Previous error' };
      const newState = serviceTypesReducer(state, updateServiceType({ id: 'st-1', serviceType: {} }));

      expect(newState.updating).toBe(true);
      expect(newState.error).toBeNull();
    });
  });

  describe('updateServiceTypeSuccess', () => {
    it('should update service type in list and selectedServiceType', () => {
      const state: ServiceTypesState = {
        ...initialServiceTypesState,
        entities: [mockServiceType],
        selectedServiceType: mockServiceType,
        updating: true,
      };
      const updated = { ...mockServiceType, name: 'Updated Name' };
      const newState = serviceTypesReducer(state, updateServiceTypeSuccess({ serviceType: updated }));

      expect(newState.entities[0]).toEqual(updated);
      expect(newState.selectedServiceType).toEqual(updated);
      expect(newState.updating).toBe(false);
    });
  });

  describe('updateServiceTypeFailure', () => {
    it('should set error and set updating to false', () => {
      const state: ServiceTypesState = { ...initialServiceTypesState, updating: true };
      const newState = serviceTypesReducer(state, updateServiceTypeFailure({ error: 'Update failed' }));

      expect(newState.error).toBe('Update failed');
      expect(newState.updating).toBe(false);
    });
  });

  describe('deleteServiceType', () => {
    it('should set deleting to true and clear error', () => {
      const state: ServiceTypesState = { ...initialServiceTypesState, error: 'Previous error' };
      const newState = serviceTypesReducer(state, deleteServiceType({ id: 'st-1' }));

      expect(newState.deleting).toBe(true);
      expect(newState.error).toBeNull();
    });
  });

  describe('deleteServiceTypeSuccess', () => {
    it('should remove service type and clear selected if matching', () => {
      const state: ServiceTypesState = {
        ...initialServiceTypesState,
        entities: [mockServiceType, mockServiceType2],
        selectedServiceType: mockServiceType,
        deleting: true,
      };
      const newState = serviceTypesReducer(state, deleteServiceTypeSuccess({ id: 'st-1' }));

      expect(newState.entities).not.toContainEqual(mockServiceType);
      expect(newState.entities).toContainEqual(mockServiceType2);
      expect(newState.selectedServiceType).toBeNull();
      expect(newState.deleting).toBe(false);
    });
  });

  describe('deleteServiceTypeFailure', () => {
    it('should set error and set deleting to false', () => {
      const state: ServiceTypesState = { ...initialServiceTypesState, deleting: true };
      const newState = serviceTypesReducer(state, deleteServiceTypeFailure({ error: 'Delete failed' }));

      expect(newState.error).toBe('Delete failed');
      expect(newState.deleting).toBe(false);
    });
  });

  describe('clearSelectedServiceType', () => {
    it('should clear selectedServiceType', () => {
      const state: ServiceTypesState = {
        ...initialServiceTypesState,
        entities: [mockServiceType],
        selectedServiceType: mockServiceType,
      };
      const newState = serviceTypesReducer(state, clearSelectedServiceType());

      expect(newState.selectedServiceType).toBeNull();
    });
  });
});
