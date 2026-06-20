import type { BackorderResponse } from '../../types/billing.types';

import { initialBackordersState, type BackordersState } from './backorders.reducer';
import {
  selectBackorderById,
  selectBackordersByStatus,
  selectBackordersCanceling,
  selectBackordersCount,
  selectBackordersEntities,
  selectBackordersError,
  selectBackordersLoading,
  selectBackordersLoadingAny,
  selectBackordersRetrying,
  selectBackordersState,
  selectHasBackorders,
  selectPendingBackorders,
  selectSelectedBackorder,
} from './backorders.selectors';

describe('Backorders Selectors', () => {
  const mockBackorder: BackorderResponse = {
    id: 'bo-1',
    userId: 'user-1',
    serviceTypeId: 'st-1',
    planId: 'plan-1',
    status: 'pending',
    requestedConfigSnapshot: {},
    providerErrors: {},
    preferredAlternatives: {},
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
  const mockBackorder2: BackorderResponse = {
    id: 'bo-2',
    userId: 'user-1',
    serviceTypeId: 'st-1',
    planId: 'plan-1',
    status: 'fulfilled',
    requestedConfigSnapshot: {},
    providerErrors: {},
    preferredAlternatives: {},
    createdAt: '2024-01-02T00:00:00Z',
    updatedAt: '2024-01-02T00:00:00Z',
  };
  const createState = (overrides?: Partial<BackordersState>): BackordersState => ({
    ...initialBackordersState,
    ...overrides,
  });

  describe('selectBackordersState', () => {
    it('should select the backorders feature state', () => {
      const state = createState();
      const rootState = { backorders: state };

      expect(selectBackordersState(rootState as never)).toEqual(state);
    });
  });

  describe('selectBackordersEntities', () => {
    it('should select entities', () => {
      const state = createState({ entities: [mockBackorder, mockBackorder2] });
      const rootState = { backorders: state };

      expect(selectBackordersEntities(rootState as never)).toEqual([mockBackorder, mockBackorder2]);
    });
  });

  describe('selectSelectedBackorder', () => {
    it('should select selectedBackorder', () => {
      const state = createState({ selectedBackorder: mockBackorder });
      const rootState = { backorders: state };

      expect(selectSelectedBackorder(rootState as never)).toEqual(mockBackorder);
    });
  });

  describe('selectBackordersLoading', () => {
    it('should return loading state', () => {
      const state = createState({ loading: true });
      const rootState = { backorders: state };

      expect(selectBackordersLoading(rootState as never)).toBe(true);
    });
  });

  describe('selectBackordersRetrying', () => {
    it('should return retrying state', () => {
      const state = createState({ retrying: true });
      const rootState = { backorders: state };

      expect(selectBackordersRetrying(rootState as never)).toBe(true);
    });
  });

  describe('selectBackordersCanceling', () => {
    it('should return canceling state', () => {
      const state = createState({ canceling: true });
      const rootState = { backorders: state };

      expect(selectBackordersCanceling(rootState as never)).toBe(true);
    });
  });

  describe('selectBackordersError', () => {
    it('should return error', () => {
      const state = createState({ error: 'Test error' });
      const rootState = { backorders: state };

      expect(selectBackordersError(rootState as never)).toBe('Test error');
    });
  });

  describe('selectBackordersLoadingAny', () => {
    it('should return true when any loading state is true', () => {
      const state = createState({ loading: true });
      const rootState = { backorders: state };

      expect(selectBackordersLoadingAny(rootState as never)).toBe(true);
    });
  });

  describe('selectBackordersCount', () => {
    it('should return count', () => {
      const state = createState({ entities: [mockBackorder, mockBackorder2] });
      const rootState = { backorders: state };

      expect(selectBackordersCount(rootState as never)).toBe(2);
    });
  });

  describe('selectBackorderById', () => {
    it('should return backorder by id', () => {
      const state = createState({ entities: [mockBackorder, mockBackorder2] });
      const rootState = { backorders: state };
      const selector = selectBackorderById('bo-1');

      expect(selector(rootState as never)).toEqual(mockBackorder);
    });
    it('should return undefined when not found', () => {
      const state = createState({ entities: [mockBackorder] });
      const rootState = { backorders: state };
      const selector = selectBackorderById('non-existent');

      expect(selector(rootState as never)).toBeUndefined();
    });
  });

  describe('selectBackordersByStatus', () => {
    it('should return backorders for status', () => {
      const state = createState({ entities: [mockBackorder, mockBackorder2] });
      const rootState = { backorders: state };
      const selector = selectBackordersByStatus('pending');

      expect(selector(rootState as never)).toEqual([mockBackorder]);
    });
  });

  describe('selectPendingBackorders', () => {
    it('should return pending or retrying backorders', () => {
      const state = createState({ entities: [mockBackorder, mockBackorder2] });
      const rootState = { backorders: state };

      expect(selectPendingBackorders(rootState as never)).toEqual([mockBackorder]);
    });
  });

  describe('selectHasBackorders', () => {
    it('should return true when there are backorders', () => {
      const state = createState({ entities: [mockBackorder] });
      const rootState = { backorders: state };

      expect(selectHasBackorders(rootState as never)).toBe(true);
    });
    it('should return false when empty', () => {
      const state = createState({ entities: [] });
      const rootState = { backorders: state };

      expect(selectHasBackorders(rootState as never)).toBe(false);
    });
  });
});
