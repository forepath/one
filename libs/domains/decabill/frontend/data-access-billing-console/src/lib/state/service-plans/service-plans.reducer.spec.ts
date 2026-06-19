import type { ServicePlanResponse } from '../../types/billing.types';

import {
  clearSelectedServicePlan,
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
import { servicePlansReducer, initialServicePlansState, type ServicePlansState } from './service-plans.reducer';

describe('servicePlansReducer', () => {
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
  const mockPlan2: ServicePlanResponse = {
    id: 'sp-2',
    serviceTypeId: 'st-1',
    name: 'Pro',
    billingIntervalType: 'month',
    billingIntervalValue: 1,
    cancelAtPeriodEnd: false,
    minCommitmentDays: 0,
    noticeDays: 0,
    providerConfigDefaults: {},
    orderingHighlights: [],
    allowCustomerLocationSelection: false,
    isActive: true,
    createdAt: '2024-01-02T00:00:00Z',
    updatedAt: '2024-01-02T00:00:00Z',
  };

  describe('initial state', () => {
    it('should return the initial state', () => {
      const action = { type: 'UNKNOWN' };

      expect(servicePlansReducer(undefined, action as never)).toEqual(initialServicePlansState);
    });
  });

  describe('loadServicePlans', () => {
    it('should set loading to true, clear entities and error', () => {
      const state: ServicePlansState = {
        ...initialServicePlansState,
        entities: [mockPlan],
        error: 'Previous error',
      };
      const newState = servicePlansReducer(state, loadServicePlans({ params: {} }));

      expect(newState.loading).toBe(true);
      expect(newState.entities).toEqual([]);
      expect(newState.error).toBeNull();
    });
  });

  describe('loadServicePlansBatch', () => {
    it('should set accumulated plans and keep loading true', () => {
      const state: ServicePlansState = { ...initialServicePlansState, loading: true };
      const newState = servicePlansReducer(
        state,
        loadServicePlansBatch({ offset: 10, accumulatedServicePlans: [mockPlan, mockPlan2] }),
      );

      expect(newState.entities).toEqual([mockPlan, mockPlan2]);
      expect(newState.loading).toBe(true);
    });
  });

  describe('loadServicePlansSuccess', () => {
    it('should set service plans and set loading to false', () => {
      const state: ServicePlansState = { ...initialServicePlansState, loading: true };
      const newState = servicePlansReducer(state, loadServicePlansSuccess({ servicePlans: [mockPlan, mockPlan2] }));

      expect(newState.entities).toEqual([mockPlan, mockPlan2]);
      expect(newState.loading).toBe(false);
    });
  });

  describe('loadServicePlansFailure', () => {
    it('should set error and set loading to false', () => {
      const state: ServicePlansState = { ...initialServicePlansState, loading: true };
      const newState = servicePlansReducer(state, loadServicePlansFailure({ error: 'Load failed' }));

      expect(newState.error).toBe('Load failed');
      expect(newState.loading).toBe(false);
    });
  });

  describe('loadServicePlan', () => {
    it('should set loadingServicePlan to true and clear error', () => {
      const state: ServicePlansState = { ...initialServicePlansState, error: 'Previous error' };
      const newState = servicePlansReducer(state, loadServicePlan({ id: 'sp-1' }));

      expect(newState.loadingServicePlan).toBe(true);
      expect(newState.error).toBeNull();
    });
  });

  describe('loadServicePlanSuccess', () => {
    it('should update plan in list and set selectedServicePlan', () => {
      const state: ServicePlansState = {
        ...initialServicePlansState,
        entities: [mockPlan],
        loadingServicePlan: true,
      };
      const updated = { ...mockPlan, name: 'Updated Name' };
      const newState = servicePlansReducer(state, loadServicePlanSuccess({ servicePlan: updated }));

      expect(newState.entities[0]).toEqual(updated);
      expect(newState.selectedServicePlan).toEqual(updated);
      expect(newState.loadingServicePlan).toBe(false);
    });
  });

  describe('loadServicePlanFailure', () => {
    it('should set error and set loadingServicePlan to false', () => {
      const state: ServicePlansState = { ...initialServicePlansState, loadingServicePlan: true };
      const newState = servicePlansReducer(state, loadServicePlanFailure({ error: 'Load failed' }));

      expect(newState.error).toBe('Load failed');
      expect(newState.loadingServicePlan).toBe(false);
    });
  });

  describe('createServicePlan', () => {
    it('should set creating to true and clear error', () => {
      const state: ServicePlansState = { ...initialServicePlansState, error: 'Previous error' };
      const newState = servicePlansReducer(state, createServicePlan({ servicePlan: {} as never }));

      expect(newState.creating).toBe(true);
      expect(newState.error).toBeNull();
    });
  });

  describe('createServicePlanSuccess', () => {
    it('should add plan and set selectedServicePlan', () => {
      const state: ServicePlansState = {
        ...initialServicePlansState,
        entities: [mockPlan],
        creating: true,
      };
      const newState = servicePlansReducer(state, createServicePlanSuccess({ servicePlan: mockPlan2 }));

      expect(newState.entities).toContainEqual(mockPlan2);
      expect(newState.selectedServicePlan).toEqual(mockPlan2);
      expect(newState.creating).toBe(false);
    });
  });

  describe('createServicePlanFailure', () => {
    it('should set error and set creating to false', () => {
      const state: ServicePlansState = { ...initialServicePlansState, creating: true };
      const newState = servicePlansReducer(state, createServicePlanFailure({ error: 'Create failed' }));

      expect(newState.error).toBe('Create failed');
      expect(newState.creating).toBe(false);
    });
  });

  describe('updateServicePlan', () => {
    it('should set updating to true and clear error', () => {
      const state: ServicePlansState = { ...initialServicePlansState, error: 'Previous error' };
      const newState = servicePlansReducer(state, updateServicePlan({ id: 'sp-1', servicePlan: {} }));

      expect(newState.updating).toBe(true);
      expect(newState.error).toBeNull();
    });
  });

  describe('updateServicePlanSuccess', () => {
    it('should update plan in list and selectedServicePlan', () => {
      const state: ServicePlansState = {
        ...initialServicePlansState,
        entities: [mockPlan],
        selectedServicePlan: mockPlan,
        updating: true,
      };
      const updated = { ...mockPlan, name: 'Updated Name' };
      const newState = servicePlansReducer(state, updateServicePlanSuccess({ servicePlan: updated }));

      expect(newState.entities[0]).toEqual(updated);
      expect(newState.selectedServicePlan).toEqual(updated);
      expect(newState.updating).toBe(false);
    });
  });

  describe('updateServicePlanFailure', () => {
    it('should set error and set updating to false', () => {
      const state: ServicePlansState = { ...initialServicePlansState, updating: true };
      const newState = servicePlansReducer(state, updateServicePlanFailure({ error: 'Update failed' }));

      expect(newState.error).toBe('Update failed');
      expect(newState.updating).toBe(false);
    });
  });

  describe('deleteServicePlan', () => {
    it('should set deleting to true and clear error', () => {
      const state: ServicePlansState = { ...initialServicePlansState, error: 'Previous error' };
      const newState = servicePlansReducer(state, deleteServicePlan({ id: 'sp-1' }));

      expect(newState.deleting).toBe(true);
      expect(newState.error).toBeNull();
    });
  });

  describe('deleteServicePlanSuccess', () => {
    it('should remove plan and clear selected if matching', () => {
      const state: ServicePlansState = {
        ...initialServicePlansState,
        entities: [mockPlan, mockPlan2],
        selectedServicePlan: mockPlan,
        deleting: true,
      };
      const newState = servicePlansReducer(state, deleteServicePlanSuccess({ id: 'sp-1' }));

      expect(newState.entities).not.toContainEqual(mockPlan);
      expect(newState.selectedServicePlan).toBeNull();
      expect(newState.deleting).toBe(false);
    });
  });

  describe('deleteServicePlanFailure', () => {
    it('should set error and set deleting to false', () => {
      const state: ServicePlansState = { ...initialServicePlansState, deleting: true };
      const newState = servicePlansReducer(state, deleteServicePlanFailure({ error: 'Delete failed' }));

      expect(newState.error).toBe('Delete failed');
      expect(newState.deleting).toBe(false);
    });
  });

  describe('clearSelectedServicePlan', () => {
    it('should clear selectedServicePlan', () => {
      const state: ServicePlansState = {
        ...initialServicePlansState,
        entities: [mockPlan],
        selectedServicePlan: mockPlan,
      };
      const newState = servicePlansReducer(state, clearSelectedServicePlan());

      expect(newState.selectedServicePlan).toBeNull();
    });
  });
});
