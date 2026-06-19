import type { BackorderResponse } from '../../types/billing.types';

import {
  cancelBackorder,
  cancelBackorderFailure,
  cancelBackorderSuccess,
  clearSelectedBackorder,
  loadBackorders,
  loadBackordersBatch,
  loadBackordersFailure,
  loadBackordersSuccess,
  retryBackorder,
  retryBackorderFailure,
  retryBackorderSuccess,
} from './backorders.actions';
import { backordersReducer, initialBackordersState, type BackordersState } from './backorders.reducer';

describe('backordersReducer', () => {
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
    status: 'retrying',
    requestedConfigSnapshot: {},
    providerErrors: {},
    preferredAlternatives: {},
    createdAt: '2024-01-02T00:00:00Z',
    updatedAt: '2024-01-02T00:00:00Z',
  };

  describe('initial state', () => {
    it('should return the initial state', () => {
      const action = { type: 'UNKNOWN' };

      expect(backordersReducer(undefined, action as never)).toEqual(initialBackordersState);
    });
  });

  describe('loadBackorders', () => {
    it('should set loading to true, clear entities and error', () => {
      const state: BackordersState = {
        ...initialBackordersState,
        entities: [mockBackorder],
        error: 'Previous error',
      };
      const newState = backordersReducer(state, loadBackorders({ params: {} }));

      expect(newState.loading).toBe(true);
      expect(newState.entities).toEqual([]);
      expect(newState.error).toBeNull();
    });
  });

  describe('loadBackordersBatch', () => {
    it('should set accumulated backorders and keep loading true', () => {
      const state: BackordersState = { ...initialBackordersState, loading: true };
      const newState = backordersReducer(
        state,
        loadBackordersBatch({ offset: 10, accumulatedBackorders: [mockBackorder, mockBackorder2] }),
      );

      expect(newState.entities).toEqual([mockBackorder, mockBackorder2]);
      expect(newState.loading).toBe(true);
    });
  });

  describe('loadBackordersSuccess', () => {
    it('should set backorders and set loading to false', () => {
      const state: BackordersState = { ...initialBackordersState, loading: true };
      const newState = backordersReducer(state, loadBackordersSuccess({ backorders: [mockBackorder, mockBackorder2] }));

      expect(newState.entities).toEqual([mockBackorder, mockBackorder2]);
      expect(newState.loading).toBe(false);
    });
  });

  describe('loadBackordersFailure', () => {
    it('should set error and set loading to false', () => {
      const state: BackordersState = { ...initialBackordersState, loading: true };
      const newState = backordersReducer(state, loadBackordersFailure({ error: 'Load failed' }));

      expect(newState.error).toBe('Load failed');
      expect(newState.loading).toBe(false);
    });
  });

  describe('retryBackorder', () => {
    it('should set retrying to true and clear error', () => {
      const state: BackordersState = { ...initialBackordersState, error: 'Previous error' };
      const newState = backordersReducer(state, retryBackorder({ id: 'bo-1' }));

      expect(newState.retrying).toBe(true);
      expect(newState.error).toBeNull();
    });
  });

  describe('retryBackorderSuccess', () => {
    it('should update backorder in list and selectedBackorder', () => {
      const state: BackordersState = {
        ...initialBackordersState,
        entities: [mockBackorder],
        selectedBackorder: mockBackorder,
        retrying: true,
      };
      const updated = { ...mockBackorder, status: 'retrying' as const };
      const newState = backordersReducer(state, retryBackorderSuccess({ backorder: updated }));

      expect(newState.entities[0]).toEqual(updated);
      expect(newState.selectedBackorder).toEqual(updated);
      expect(newState.retrying).toBe(false);
    });
  });

  describe('retryBackorderFailure', () => {
    it('should set error and set retrying to false', () => {
      const state: BackordersState = { ...initialBackordersState, retrying: true };
      const newState = backordersReducer(state, retryBackorderFailure({ error: 'Retry failed' }));

      expect(newState.error).toBe('Retry failed');
      expect(newState.retrying).toBe(false);
    });
  });

  describe('cancelBackorder', () => {
    it('should set canceling to true and clear error', () => {
      const state: BackordersState = { ...initialBackordersState, error: 'Previous error' };
      const newState = backordersReducer(state, cancelBackorder({ id: 'bo-1' }));

      expect(newState.canceling).toBe(true);
      expect(newState.error).toBeNull();
    });
  });

  describe('cancelBackorderSuccess', () => {
    it('should update backorder in list and selectedBackorder', () => {
      const state: BackordersState = {
        ...initialBackordersState,
        entities: [mockBackorder],
        selectedBackorder: mockBackorder,
        canceling: true,
      };
      const updated = { ...mockBackorder, status: 'cancelled' as const };
      const newState = backordersReducer(state, cancelBackorderSuccess({ backorder: updated }));

      expect(newState.entities[0]).toEqual(updated);
      expect(newState.selectedBackorder).toEqual(updated);
      expect(newState.canceling).toBe(false);
    });
  });

  describe('cancelBackorderFailure', () => {
    it('should set error and set canceling to false', () => {
      const state: BackordersState = { ...initialBackordersState, canceling: true };
      const newState = backordersReducer(state, cancelBackorderFailure({ error: 'Cancel failed' }));

      expect(newState.error).toBe('Cancel failed');
      expect(newState.canceling).toBe(false);
    });
  });

  describe('clearSelectedBackorder', () => {
    it('should clear selectedBackorder', () => {
      const state: BackordersState = {
        ...initialBackordersState,
        entities: [mockBackorder],
        selectedBackorder: mockBackorder,
      };
      const newState = backordersReducer(state, clearSelectedBackorder());

      expect(newState.selectedBackorder).toBeNull();
    });
  });
});
