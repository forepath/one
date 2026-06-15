import type { SubscriptionResponse } from '../../types/billing.types';

import { initialSubscriptionsState, type SubscriptionsState } from './subscriptions.reducer';
import {
  selectActiveSubscriptions,
  selectHasSubscriptions,
  selectPendingCancelSubscriptions,
  selectSelectedSubscription,
  selectSubscriptionById,
  selectSubscriptionsByPlanId,
  selectSubscriptionsByStatus,
  selectSubscriptionsCanceling,
  selectSubscriptionsCount,
  selectSubscriptionsCreating,
  selectSubscriptionsEntities,
  selectSubscriptionsError,
  selectSubscriptionsLoading,
  selectSubscriptionsLoadingAny,
  selectSubscriptionsResuming,
  selectSubscriptionsState,
  selectSubscriptionLoading,
} from './subscriptions.selectors';

describe('Subscriptions Selectors', () => {
  const mockSubscription: SubscriptionResponse = {
    id: 'sub-1',
    planId: 'plan-1',
    userId: 'user-1',
    status: 'active',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
  const mockSubscription2: SubscriptionResponse = {
    id: 'sub-2',
    planId: 'plan-1',
    userId: 'user-1',
    status: 'pending_cancel',
    createdAt: '2024-01-02T00:00:00Z',
    updatedAt: '2024-01-02T00:00:00Z',
  };
  const createState = (overrides?: Partial<SubscriptionsState>): SubscriptionsState => ({
    ...initialSubscriptionsState,
    ...overrides,
  });

  describe('selectSubscriptionsState', () => {
    it('should select the subscriptions feature state', () => {
      const state = createState();
      const rootState = { subscriptions: state };
      const result = selectSubscriptionsState(rootState as never);

      expect(result).toEqual(state);
    });
  });

  describe('selectSubscriptionsEntities', () => {
    it('should select entities', () => {
      const state = createState({
        entities: [mockSubscription, mockSubscription2],
      });
      const rootState = { subscriptions: state };
      const result = selectSubscriptionsEntities(rootState as never);

      expect(result).toEqual([mockSubscription, mockSubscription2]);
    });
  });

  describe('selectSelectedSubscription', () => {
    it('should select selectedSubscription', () => {
      const state = createState({
        selectedSubscription: mockSubscription,
      });
      const rootState = { subscriptions: state };
      const result = selectSelectedSubscription(rootState as never);

      expect(result).toEqual(mockSubscription);
    });
  });

  describe('selectSubscriptionsLoading', () => {
    it('should return loading state', () => {
      const state = createState({ loading: true });
      const rootState = { subscriptions: state };
      const result = selectSubscriptionsLoading(rootState as never);

      expect(result).toBe(true);
    });
  });

  describe('selectSubscriptionLoading', () => {
    it('should return loadingSubscription state', () => {
      const state = createState({ loadingSubscription: true });
      const rootState = { subscriptions: state };
      const result = selectSubscriptionLoading(rootState as never);

      expect(result).toBe(true);
    });
  });

  describe('selectSubscriptionsCreating', () => {
    it('should return creating state', () => {
      const state = createState({ creating: true });
      const rootState = { subscriptions: state };
      const result = selectSubscriptionsCreating(rootState as never);

      expect(result).toBe(true);
    });
  });

  describe('selectSubscriptionsCanceling', () => {
    it('should return canceling state', () => {
      const state = createState({ canceling: true });
      const rootState = { subscriptions: state };
      const result = selectSubscriptionsCanceling(rootState as never);

      expect(result).toBe(true);
    });
  });

  describe('selectSubscriptionsResuming', () => {
    it('should return resuming state', () => {
      const state = createState({ resuming: true });
      const rootState = { subscriptions: state };
      const result = selectSubscriptionsResuming(rootState as never);

      expect(result).toBe(true);
    });
  });

  describe('selectSubscriptionsError', () => {
    it('should return error', () => {
      const state = createState({ error: 'Test error' });
      const rootState = { subscriptions: state };
      const result = selectSubscriptionsError(rootState as never);

      expect(result).toBe('Test error');
    });

    it('should return null when no error', () => {
      const state = createState({ error: null });
      const rootState = { subscriptions: state };
      const result = selectSubscriptionsError(rootState as never);

      expect(result).toBeNull();
    });
  });

  describe('selectSubscriptionsLoadingAny', () => {
    it('should return true when any loading state is true', () => {
      const state = createState({ loading: true });
      const rootState = { subscriptions: state };
      const result = selectSubscriptionsLoadingAny(rootState as never);

      expect(result).toBe(true);
    });

    it('should return false when all loading states are false', () => {
      const state = createState({
        loading: false,
        loadingSubscription: false,
        creating: false,
        canceling: false,
        resuming: false,
      });
      const rootState = { subscriptions: state };
      const result = selectSubscriptionsLoadingAny(rootState as never);

      expect(result).toBe(false);
    });
  });

  describe('selectSubscriptionsCount', () => {
    it('should return count of subscriptions', () => {
      const state = createState({
        entities: [mockSubscription, mockSubscription2],
      });
      const rootState = { subscriptions: state };
      const result = selectSubscriptionsCount(rootState as never);

      expect(result).toBe(2);
    });

    it('should return 0 when no subscriptions', () => {
      const state = createState({ entities: [] });
      const rootState = { subscriptions: state };
      const result = selectSubscriptionsCount(rootState as never);

      expect(result).toBe(0);
    });
  });

  describe('selectSubscriptionById', () => {
    it('should return subscription by id', () => {
      const state = createState({
        entities: [mockSubscription, mockSubscription2],
      });
      const rootState = { subscriptions: state };
      const selector = selectSubscriptionById('sub-1');
      const result = selector(rootState as never);

      expect(result).toEqual(mockSubscription);
    });

    it('should return undefined when not found', () => {
      const state = createState({
        entities: [mockSubscription],
      });
      const rootState = { subscriptions: state };
      const selector = selectSubscriptionById('non-existent');
      const result = selector(rootState as never);

      expect(result).toBeUndefined();
    });
  });

  describe('selectSubscriptionsByPlanId', () => {
    it('should return subscriptions for planId', () => {
      const state = createState({
        entities: [mockSubscription, mockSubscription2],
      });
      const rootState = { subscriptions: state };
      const selector = selectSubscriptionsByPlanId('plan-1');
      const result = selector(rootState as never);

      expect(result).toEqual([mockSubscription, mockSubscription2]);
    });
  });

  describe('selectSubscriptionsByStatus', () => {
    it('should return subscriptions for status', () => {
      const state = createState({
        entities: [mockSubscription, mockSubscription2],
      });
      const rootState = { subscriptions: state };
      const selector = selectSubscriptionsByStatus('active');
      const result = selector(rootState as never);

      expect(result).toEqual([mockSubscription]);
    });
  });

  describe('selectActiveSubscriptions', () => {
    it('should return only active subscriptions', () => {
      const state = createState({
        entities: [mockSubscription, mockSubscription2],
      });
      const rootState = { subscriptions: state };
      const result = selectActiveSubscriptions(rootState as never);

      expect(result).toEqual([mockSubscription]);
    });
  });

  describe('selectHasSubscriptions', () => {
    it('should return true when there are subscriptions', () => {
      const state = createState({
        entities: [mockSubscription],
      });
      const rootState = { subscriptions: state };
      const result = selectHasSubscriptions(rootState as never);

      expect(result).toBe(true);
    });

    it('should return false when no subscriptions', () => {
      const state = createState({ entities: [] });
      const rootState = { subscriptions: state };
      const result = selectHasSubscriptions(rootState as never);

      expect(result).toBe(false);
    });
  });

  describe('selectPendingCancelSubscriptions', () => {
    it('should return only pending_cancel subscriptions', () => {
      const state = createState({
        entities: [mockSubscription, mockSubscription2],
      });
      const rootState = { subscriptions: state };
      const result = selectPendingCancelSubscriptions(rootState as never);

      expect(result).toEqual([mockSubscription2]);
    });
  });
});
