import type { ServicePlanResponse } from '../../types/billing.types';

import { initialServicePlansState, type ServicePlansState } from './service-plans.reducer';
import {
  selectActiveServicePlans,
  selectHasServicePlans,
  selectSelectedServicePlan,
  selectServicePlanById,
  selectServicePlanLoading,
  selectServicePlansByServiceTypeId,
  selectServicePlansCount,
  selectServicePlansCreating,
  selectServicePlansDeleting,
  selectServicePlansEntities,
  selectServicePlansError,
  selectServicePlansLoading,
  selectServicePlansLoadingAny,
  selectServicePlansState,
  selectServicePlansUpdating,
} from './service-plans.selectors';

describe('Service Plans Selectors', () => {
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
    isActive: false,
    createdAt: '2024-01-02T00:00:00Z',
    updatedAt: '2024-01-02T00:00:00Z',
  };
  const createState = (overrides?: Partial<ServicePlansState>): ServicePlansState => ({
    ...initialServicePlansState,
    ...overrides,
  });

  describe('selectServicePlansState', () => {
    it('should select the service plans feature state', () => {
      const state = createState();

      expect(selectServicePlansState({ servicePlans: state } as never)).toEqual(state);
    });
  });

  describe('selectServicePlansEntities', () => {
    it('should select entities', () => {
      const state = createState({ entities: [mockPlan, mockPlan2] });

      expect(selectServicePlansEntities({ servicePlans: state } as never)).toEqual([mockPlan, mockPlan2]);
    });
  });

  describe('selectSelectedServicePlan', () => {
    it('should select selectedServicePlan', () => {
      const state = createState({ selectedServicePlan: mockPlan });

      expect(selectSelectedServicePlan({ servicePlans: state } as never)).toEqual(mockPlan);
    });
  });

  describe('selectServicePlansLoading', () => {
    it('should return loading state', () => {
      const state = createState({ loading: true });

      expect(selectServicePlansLoading({ servicePlans: state } as never)).toBe(true);
    });
  });

  describe('selectServicePlanLoading', () => {
    it('should return loadingServicePlan state', () => {
      const state = createState({ loadingServicePlan: true });

      expect(selectServicePlanLoading({ servicePlans: state } as never)).toBe(true);
    });
  });

  describe('selectServicePlansCreating', () => {
    it('should return creating state', () => {
      const state = createState({ creating: true });

      expect(selectServicePlansCreating({ servicePlans: state } as never)).toBe(true);
    });
  });

  describe('selectServicePlansUpdating', () => {
    it('should return updating state', () => {
      const state = createState({ updating: true });

      expect(selectServicePlansUpdating({ servicePlans: state } as never)).toBe(true);
    });
  });

  describe('selectServicePlansDeleting', () => {
    it('should return deleting state', () => {
      const state = createState({ deleting: true });

      expect(selectServicePlansDeleting({ servicePlans: state } as never)).toBe(true);
    });
  });

  describe('selectServicePlansError', () => {
    it('should return error', () => {
      const state = createState({ error: 'Test error' });

      expect(selectServicePlansError({ servicePlans: state } as never)).toBe('Test error');
    });
  });

  describe('selectServicePlansLoadingAny', () => {
    it('should return true when any loading state is true', () => {
      const state = createState({ loading: true });

      expect(selectServicePlansLoadingAny({ servicePlans: state } as never)).toBe(true);
    });
  });

  describe('selectServicePlansCount', () => {
    it('should return count', () => {
      const state = createState({ entities: [mockPlan, mockPlan2] });

      expect(selectServicePlansCount({ servicePlans: state } as never)).toBe(2);
    });
  });

  describe('selectServicePlanById', () => {
    it('should return plan by id', () => {
      const state = createState({ entities: [mockPlan, mockPlan2] });
      const selector = selectServicePlanById('sp-1');

      expect(selector({ servicePlans: state } as never)).toEqual(mockPlan);
    });
    it('should return undefined when not found', () => {
      const state = createState({ entities: [mockPlan] });
      const selector = selectServicePlanById('non-existent');

      expect(selector({ servicePlans: state } as never)).toBeUndefined();
    });
  });

  describe('selectServicePlansByServiceTypeId', () => {
    it('should return plans for serviceTypeId', () => {
      const state = createState({ entities: [mockPlan, mockPlan2] });
      const selector = selectServicePlansByServiceTypeId('st-1');

      expect(selector({ servicePlans: state } as never)).toEqual([mockPlan, mockPlan2]);
    });
  });

  describe('selectHasServicePlans', () => {
    it('should return true when there are plans', () => {
      const state = createState({ entities: [mockPlan] });

      expect(selectHasServicePlans({ servicePlans: state } as never)).toBe(true);
    });
    it('should return false when empty', () => {
      const state = createState({ entities: [] });

      expect(selectHasServicePlans({ servicePlans: state } as never)).toBe(false);
    });
  });

  describe('selectActiveServicePlans', () => {
    it('should return only active plans', () => {
      const state = createState({ entities: [mockPlan, mockPlan2] });

      expect(selectActiveServicePlans({ servicePlans: state } as never)).toEqual([mockPlan]);
    });
  });
});
