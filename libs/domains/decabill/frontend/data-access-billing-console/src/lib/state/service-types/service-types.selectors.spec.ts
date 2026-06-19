import type { ServiceTypeResponse } from '../../types/billing.types';

import { initialServiceTypesState, type ServiceTypesState } from './service-types.reducer';
import {
  selectActiveServiceTypes,
  selectHasServiceTypes,
  selectSelectedServiceType,
  selectServiceTypeById,
  selectServiceTypeByKey,
  selectServiceTypeLoading,
  selectServiceTypesCount,
  selectServiceTypesCreating,
  selectServiceTypesDeleting,
  selectServiceTypesEntities,
  selectServiceTypesError,
  selectServiceTypesLoading,
  selectServiceTypesLoadingAny,
  selectServiceTypesState,
  selectServiceTypesUpdating,
} from './service-types.selectors';

describe('Service Types Selectors', () => {
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
    isActive: false,
    createdAt: '2024-01-02T00:00:00Z',
    updatedAt: '2024-01-02T00:00:00Z',
  };
  const createState = (overrides?: Partial<ServiceTypesState>): ServiceTypesState => ({
    ...initialServiceTypesState,
    ...overrides,
  });

  describe('selectServiceTypesState', () => {
    it('should select the service types feature state', () => {
      const state = createState();
      const rootState = { serviceTypes: state };

      expect(selectServiceTypesState(rootState as never)).toEqual(state);
    });
  });

  describe('selectServiceTypesEntities', () => {
    it('should select entities', () => {
      const state = createState({ entities: [mockServiceType, mockServiceType2] });
      const rootState = { serviceTypes: state };

      expect(selectServiceTypesEntities(rootState as never)).toEqual([mockServiceType, mockServiceType2]);
    });
  });

  describe('selectSelectedServiceType', () => {
    it('should select selectedServiceType', () => {
      const state = createState({ selectedServiceType: mockServiceType });
      const rootState = { serviceTypes: state };

      expect(selectSelectedServiceType(rootState as never)).toEqual(mockServiceType);
    });
  });

  describe('selectServiceTypesLoading', () => {
    it('should return loading state', () => {
      const state = createState({ loading: true });
      const rootState = { serviceTypes: state };

      expect(selectServiceTypesLoading(rootState as never)).toBe(true);
    });
  });

  describe('selectServiceTypeLoading', () => {
    it('should return loadingServiceType state', () => {
      const state = createState({ loadingServiceType: true });
      const rootState = { serviceTypes: state };

      expect(selectServiceTypeLoading(rootState as never)).toBe(true);
    });
  });

  describe('selectServiceTypesCreating', () => {
    it('should return creating state', () => {
      const state = createState({ creating: true });
      const rootState = { serviceTypes: state };

      expect(selectServiceTypesCreating(rootState as never)).toBe(true);
    });
  });

  describe('selectServiceTypesUpdating', () => {
    it('should return updating state', () => {
      const state = createState({ updating: true });
      const rootState = { serviceTypes: state };

      expect(selectServiceTypesUpdating(rootState as never)).toBe(true);
    });
  });

  describe('selectServiceTypesDeleting', () => {
    it('should return deleting state', () => {
      const state = createState({ deleting: true });
      const rootState = { serviceTypes: state };

      expect(selectServiceTypesDeleting(rootState as never)).toBe(true);
    });
  });

  describe('selectServiceTypesError', () => {
    it('should return error', () => {
      const state = createState({ error: 'Test error' });
      const rootState = { serviceTypes: state };

      expect(selectServiceTypesError(rootState as never)).toBe('Test error');
    });
  });

  describe('selectServiceTypesLoadingAny', () => {
    it('should return true when any loading state is true', () => {
      const state = createState({ loading: true });
      const rootState = { serviceTypes: state };

      expect(selectServiceTypesLoadingAny(rootState as never)).toBe(true);
    });
  });

  describe('selectServiceTypesCount', () => {
    it('should return count', () => {
      const state = createState({ entities: [mockServiceType, mockServiceType2] });
      const rootState = { serviceTypes: state };

      expect(selectServiceTypesCount(rootState as never)).toBe(2);
    });
  });

  describe('selectServiceTypeById', () => {
    it('should return service type by id', () => {
      const state = createState({ entities: [mockServiceType, mockServiceType2] });
      const rootState = { serviceTypes: state };
      const selector = selectServiceTypeById('st-1');

      expect(selector(rootState as never)).toEqual(mockServiceType);
    });
    it('should return undefined when not found', () => {
      const state = createState({ entities: [mockServiceType] });
      const rootState = { serviceTypes: state };
      const selector = selectServiceTypeById('non-existent');

      expect(selector(rootState as never)).toBeUndefined();
    });
  });

  describe('selectServiceTypeByKey', () => {
    it('should return service type by key', () => {
      const state = createState({ entities: [mockServiceType, mockServiceType2] });
      const rootState = { serviceTypes: state };
      const selector = selectServiceTypeByKey('cursor');

      expect(selector(rootState as never)).toEqual(mockServiceType);
    });
  });

  describe('selectHasServiceTypes', () => {
    it('should return true when there are service types', () => {
      const state = createState({ entities: [mockServiceType] });
      const rootState = { serviceTypes: state };

      expect(selectHasServiceTypes(rootState as never)).toBe(true);
    });
    it('should return false when empty', () => {
      const state = createState({ entities: [] });
      const rootState = { serviceTypes: state };

      expect(selectHasServiceTypes(rootState as never)).toBe(false);
    });
  });

  describe('selectActiveServiceTypes', () => {
    it('should return only active service types', () => {
      const state = createState({ entities: [mockServiceType, mockServiceType2] });
      const rootState = { serviceTypes: state };

      expect(selectActiveServiceTypes(rootState as never)).toEqual([mockServiceType]);
    });
  });
});
