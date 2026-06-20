import type { SubscriptionResponse } from '../../types/billing.types';

import {
  cancelSubscription,
  cancelSubscriptionFailure,
  cancelSubscriptionSuccess,
  clearSelectedSubscription,
  createSubscription,
  createSubscriptionFailure,
  createSubscriptionSuccess,
  loadSubscription,
  loadSubscriptionFailure,
  loadSubscriptions,
  loadSubscriptionsBatch,
  loadSubscriptionsFailure,
  loadSubscriptionsSuccess,
  loadSubscriptionSuccess,
  resumeSubscription,
  resumeSubscriptionFailure,
  resumeSubscriptionSuccess,
} from './subscriptions.actions';
import { subscriptionsReducer, initialSubscriptionsState, type SubscriptionsState } from './subscriptions.reducer';

describe('subscriptionsReducer', () => {
  const mockSubscription: SubscriptionResponse = {
    id: 'sub-1',
    planId: 'plan-1',
    userId: 'user-1',
    status: 'active',
    currentPeriodStart: '2024-01-01',
    currentPeriodEnd: '2024-02-01',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
  const mockSubscription2: SubscriptionResponse = {
    id: 'sub-2',
    planId: 'plan-2',
    userId: 'user-1',
    status: 'pending_cancel',
    createdAt: '2024-01-02T00:00:00Z',
    updatedAt: '2024-01-02T00:00:00Z',
  };

  describe('initial state', () => {
    it('should return the initial state', () => {
      const action = { type: 'UNKNOWN' };
      const state = subscriptionsReducer(undefined, action as never);

      expect(state).toEqual(initialSubscriptionsState);
    });
  });

  describe('loadSubscriptions', () => {
    it('should set loading to true, clear entities and error', () => {
      const state: SubscriptionsState = {
        ...initialSubscriptionsState,
        entities: [mockSubscription],
        error: 'Previous error',
      };
      const newState = subscriptionsReducer(state, loadSubscriptions({ params: {} }));

      expect(newState.loading).toBe(true);
      expect(newState.entities).toEqual([]);
      expect(newState.error).toBeNull();
    });
  });

  describe('loadSubscriptionsBatch', () => {
    it('should set accumulated subscriptions and keep loading true', () => {
      const state: SubscriptionsState = {
        ...initialSubscriptionsState,
        loading: true,
      };
      const newState = subscriptionsReducer(
        state,
        loadSubscriptionsBatch({ offset: 10, accumulatedSubscriptions: [mockSubscription, mockSubscription2] }),
      );

      expect(newState.entities).toEqual([mockSubscription, mockSubscription2]);
      expect(newState.loading).toBe(true);
      expect(newState.error).toBeNull();
    });
  });

  describe('loadSubscriptionsSuccess', () => {
    it('should set subscriptions and set loading to false', () => {
      const state: SubscriptionsState = {
        ...initialSubscriptionsState,
        loading: true,
      };
      const newState = subscriptionsReducer(
        state,
        loadSubscriptionsSuccess({ subscriptions: [mockSubscription, mockSubscription2] }),
      );

      expect(newState.entities).toEqual([mockSubscription, mockSubscription2]);
      expect(newState.loading).toBe(false);
      expect(newState.error).toBeNull();
    });
  });

  describe('loadSubscriptionsFailure', () => {
    it('should set error and set loading to false', () => {
      const state: SubscriptionsState = {
        ...initialSubscriptionsState,
        loading: true,
      };
      const newState = subscriptionsReducer(state, loadSubscriptionsFailure({ error: 'Load failed' }));

      expect(newState.error).toBe('Load failed');
      expect(newState.loading).toBe(false);
    });
  });

  describe('loadSubscription', () => {
    it('should set loadingSubscription to true and clear error', () => {
      const state: SubscriptionsState = {
        ...initialSubscriptionsState,
        error: 'Previous error',
      };
      const newState = subscriptionsReducer(state, loadSubscription({ id: 'sub-1' }));

      expect(newState.loadingSubscription).toBe(true);
      expect(newState.error).toBeNull();
    });
  });

  describe('loadSubscriptionSuccess', () => {
    it('should update subscription in list and set selectedSubscription', () => {
      const state: SubscriptionsState = {
        ...initialSubscriptionsState,
        entities: [mockSubscription],
        loadingSubscription: true,
      };
      const updatedSubscription = { ...mockSubscription, status: 'canceled' as const };
      const newState = subscriptionsReducer(state, loadSubscriptionSuccess({ subscription: updatedSubscription }));

      expect(newState.entities[0]).toEqual(updatedSubscription);
      expect(newState.selectedSubscription).toEqual(updatedSubscription);
      expect(newState.loadingSubscription).toBe(false);
    });

    it('should add subscription to list if not present', () => {
      const state: SubscriptionsState = {
        ...initialSubscriptionsState,
        entities: [],
        loadingSubscription: true,
      };
      const newState = subscriptionsReducer(state, loadSubscriptionSuccess({ subscription: mockSubscription }));

      expect(newState.entities).toContainEqual(mockSubscription);
      expect(newState.selectedSubscription).toEqual(mockSubscription);
    });
  });

  describe('loadSubscriptionFailure', () => {
    it('should set error and set loadingSubscription to false', () => {
      const state: SubscriptionsState = {
        ...initialSubscriptionsState,
        loadingSubscription: true,
      };
      const newState = subscriptionsReducer(state, loadSubscriptionFailure({ error: 'Load failed' }));

      expect(newState.error).toBe('Load failed');
      expect(newState.loadingSubscription).toBe(false);
    });
  });

  describe('createSubscription', () => {
    it('should set creating to true and clear error', () => {
      const state: SubscriptionsState = {
        ...initialSubscriptionsState,
        error: 'Previous error',
      };
      const newState = subscriptionsReducer(state, createSubscription({ subscription: {} as never }));

      expect(newState.creating).toBe(true);
      expect(newState.error).toBeNull();
    });
  });

  describe('createSubscriptionSuccess', () => {
    it('should add subscription to list and set selectedSubscription', () => {
      const state: SubscriptionsState = {
        ...initialSubscriptionsState,
        entities: [mockSubscription],
        creating: true,
      };
      const newState = subscriptionsReducer(state, createSubscriptionSuccess({ subscription: mockSubscription2 }));

      expect(newState.entities).toContainEqual(mockSubscription2);
      expect(newState.selectedSubscription).toEqual(mockSubscription2);
      expect(newState.creating).toBe(false);
    });
  });

  describe('createSubscriptionFailure', () => {
    it('should set error and set creating to false', () => {
      const state: SubscriptionsState = {
        ...initialSubscriptionsState,
        creating: true,
      };
      const newState = subscriptionsReducer(state, createSubscriptionFailure({ error: 'Create failed' }));

      expect(newState.error).toBe('Create failed');
      expect(newState.creating).toBe(false);
    });
  });

  describe('cancelSubscription', () => {
    it('should set canceling to true and clear error', () => {
      const state: SubscriptionsState = {
        ...initialSubscriptionsState,
        error: 'Previous error',
      };
      const newState = subscriptionsReducer(state, cancelSubscription({ id: 'sub-1' }));

      expect(newState.canceling).toBe(true);
      expect(newState.error).toBeNull();
    });
  });

  describe('cancelSubscriptionSuccess', () => {
    it('should update subscription in list and selectedSubscription', () => {
      const state: SubscriptionsState = {
        ...initialSubscriptionsState,
        entities: [mockSubscription],
        selectedSubscription: mockSubscription,
        canceling: true,
      };
      const updatedSubscription = { ...mockSubscription, status: 'canceled' as const };
      const newState = subscriptionsReducer(state, cancelSubscriptionSuccess({ subscription: updatedSubscription }));

      expect(newState.entities[0]).toEqual(updatedSubscription);
      expect(newState.selectedSubscription).toEqual(updatedSubscription);
      expect(newState.canceling).toBe(false);
    });
  });

  describe('cancelSubscriptionFailure', () => {
    it('should set error and set canceling to false', () => {
      const state: SubscriptionsState = {
        ...initialSubscriptionsState,
        canceling: true,
      };
      const newState = subscriptionsReducer(state, cancelSubscriptionFailure({ error: 'Cancel failed' }));

      expect(newState.error).toBe('Cancel failed');
      expect(newState.canceling).toBe(false);
    });
  });

  describe('resumeSubscription', () => {
    it('should set resuming to true and clear error', () => {
      const state: SubscriptionsState = {
        ...initialSubscriptionsState,
        error: 'Previous error',
      };
      const newState = subscriptionsReducer(state, resumeSubscription({ id: 'sub-1' }));

      expect(newState.resuming).toBe(true);
      expect(newState.error).toBeNull();
    });
  });

  describe('resumeSubscriptionSuccess', () => {
    it('should update subscription in list and selectedSubscription', () => {
      const state: SubscriptionsState = {
        ...initialSubscriptionsState,
        entities: [mockSubscription2],
        selectedSubscription: mockSubscription2,
        resuming: true,
      };
      const updatedSubscription = { ...mockSubscription2, status: 'active' as const };
      const newState = subscriptionsReducer(state, resumeSubscriptionSuccess({ subscription: updatedSubscription }));

      expect(newState.entities[0]).toEqual(updatedSubscription);
      expect(newState.selectedSubscription).toEqual(updatedSubscription);
      expect(newState.resuming).toBe(false);
    });
  });

  describe('resumeSubscriptionFailure', () => {
    it('should set error and set resuming to false', () => {
      const state: SubscriptionsState = {
        ...initialSubscriptionsState,
        resuming: true,
      };
      const newState = subscriptionsReducer(state, resumeSubscriptionFailure({ error: 'Resume failed' }));

      expect(newState.error).toBe('Resume failed');
      expect(newState.resuming).toBe(false);
    });
  });

  describe('clearSelectedSubscription', () => {
    it('should clear selectedSubscription', () => {
      const state: SubscriptionsState = {
        ...initialSubscriptionsState,
        entities: [mockSubscription],
        selectedSubscription: mockSubscription,
      };
      const newState = subscriptionsReducer(state, clearSelectedSubscription());

      expect(newState.selectedSubscription).toBeNull();
      expect(newState.entities).toEqual([mockSubscription]);
    });
  });
});
