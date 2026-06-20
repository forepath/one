import type { ServerInfoResponse, SubscriptionResponse } from '../../types/billing.types';

import {
  initialSubscriptionServerInfoState,
  type SubscriptionServerInfoState,
} from './subscription-server-info.reducer';
import {
  selectOverviewServerInfoError,
  selectOverviewServerInfoLoading,
  selectServerActionInProgress,
  selectServerActionInProgressForSubscriptionId,
  selectServerInfoBySubscriptionId,
  selectSubscriptionsWithServerInfo,
} from './subscription-server-info.selectors';

describe('Subscription Server Info Selectors', () => {
  const createServerInfoState = (overrides?: Partial<SubscriptionServerInfoState>): SubscriptionServerInfoState => ({
    ...initialSubscriptionServerInfoState,
    ...overrides,
  });
  const mockSubscription: SubscriptionResponse = {
    id: 'sub-1',
    number: 'SUB-001',
    planId: 'plan-1',
    userId: 'user-1',
    status: 'active',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
  const mockServerInfo: ServerInfoResponse = {
    name: 'server-1',
    publicIp: '1.2.3.4',
    status: 'running',
  };

  describe('selectServerInfoBySubscriptionId', () => {
    it('should select serverInfoBySubscriptionId from feature state', () => {
      const serverInfoBySubscriptionId = { 'sub-1': mockServerInfo };
      const state = createServerInfoState({ serverInfoBySubscriptionId });
      const rootState = { subscriptionServerInfo: state };

      expect(selectServerInfoBySubscriptionId(rootState as never)).toEqual(serverInfoBySubscriptionId);
    });
  });

  describe('selectOverviewServerInfoLoading', () => {
    it('should return loading', () => {
      const state = createServerInfoState({ loading: true });
      const rootState = { subscriptionServerInfo: state };

      expect(selectOverviewServerInfoLoading(rootState as never)).toBe(true);
    });
  });

  describe('selectOverviewServerInfoError', () => {
    it('should return error', () => {
      const state = createServerInfoState({ error: 'Test error' });
      const rootState = { subscriptionServerInfo: state };

      expect(selectOverviewServerInfoError(rootState as never)).toBe('Test error');
    });
  });

  describe('selectServerActionInProgress', () => {
    it('should return actionInProgress map', () => {
      const state = createServerInfoState({ actionInProgress: { 'sub-1': 'start' } });
      const rootState = { subscriptionServerInfo: state };

      expect(selectServerActionInProgress(rootState as never)).toEqual({ 'sub-1': 'start' });
    });
  });

  describe('selectServerActionInProgressForSubscriptionId', () => {
    it('should return action for subscription', () => {
      const state = createServerInfoState({ actionInProgress: { 'sub-1': 'restart' } });
      const rootState = { subscriptionServerInfo: state };

      expect(selectServerActionInProgressForSubscriptionId('sub-1')(rootState as never)).toBe('restart');
    });
    it('should return undefined when no action in progress', () => {
      const state = createServerInfoState({ actionInProgress: {} });
      const rootState = { subscriptionServerInfo: state };

      expect(selectServerActionInProgressForSubscriptionId('sub-1')(rootState as never)).toBeUndefined();
    });
  });

  describe('selectSubscriptionsWithServerInfo', () => {
    it('should return subscriptions that have server info as SubscriptionWithServerInfo array', () => {
      const subscriptionsState = {
        entities: [mockSubscription],
        selectedSubscription: null,
        loading: false,
        loadingSubscription: false,
        creating: false,
        canceling: false,
        resuming: false,
        error: null,
      };
      const serverInfoState = createServerInfoState({
        serverInfoBySubscriptionId: { 'sub-1': mockServerInfo },
        activeItemIdBySubscriptionId: { 'sub-1': 'item-1' },
      });
      const rootState = {
        subscriptions: subscriptionsState,
        subscriptionServerInfo: serverInfoState,
      };
      const result = selectSubscriptionsWithServerInfo(rootState as never);

      expect(result).toHaveLength(1);
      expect(result[0].subscription).toEqual(mockSubscription);
      expect(result[0].serverInfo).toEqual(mockServerInfo);
      expect(result[0].itemId).toBe('item-1');
      expect(result[0].service).toBe('controller');
    });

    it('should exclude subscriptions without server info', () => {
      const subscriptionsState = {
        entities: [mockSubscription, { ...mockSubscription, id: 'sub-2', number: 'SUB-002' }],
        selectedSubscription: null,
        loading: false,
        loadingSubscription: false,
        creating: false,
        canceling: false,
        resuming: false,
        error: null,
      };
      const serverInfoState = createServerInfoState({
        serverInfoBySubscriptionId: { 'sub-1': mockServerInfo },
        activeItemIdBySubscriptionId: { 'sub-1': 'item-1' },
      });
      const rootState = {
        subscriptions: subscriptionsState,
        subscriptionServerInfo: serverInfoState,
      };
      const result = selectSubscriptionsWithServerInfo(rootState as never);

      expect(result).toHaveLength(1);
      expect(result[0].subscription.id).toBe('sub-1');
    });

    it('should return empty array when no subscriptions have server info', () => {
      const subscriptionsState = {
        entities: [mockSubscription],
        selectedSubscription: null,
        loading: false,
        loadingSubscription: false,
        creating: false,
        canceling: false,
        resuming: false,
        error: null,
      };
      const serverInfoState = createServerInfoState({
        serverInfoBySubscriptionId: {},
        activeItemIdBySubscriptionId: {},
      });
      const rootState = {
        subscriptions: subscriptionsState,
        subscriptionServerInfo: serverInfoState,
      };
      const result = selectSubscriptionsWithServerInfo(rootState as never);

      expect(result).toHaveLength(0);
    });

    it('should exclude non-active subscriptions (e.g. canceled) even when they have server info', () => {
      const canceledSubscription = { ...mockSubscription, id: 'sub-canceled', status: 'canceled' as const };
      const subscriptionsState = {
        entities: [mockSubscription, canceledSubscription],
        selectedSubscription: null,
        loading: false,
        loadingSubscription: false,
        creating: false,
        canceling: false,
        resuming: false,
        error: null,
      };
      const serverInfoState = createServerInfoState({
        serverInfoBySubscriptionId: {
          'sub-1': mockServerInfo,
          'sub-canceled': mockServerInfo,
        },
        activeItemIdBySubscriptionId: { 'sub-1': 'item-1', 'sub-canceled': 'item-2' },
      });
      const rootState = {
        subscriptions: subscriptionsState,
        subscriptionServerInfo: serverInfoState,
      };
      const result = selectSubscriptionsWithServerInfo(rootState as never);

      expect(result).toHaveLength(1);
      expect(result[0].subscription.id).toBe('sub-1');
      expect(result[0].subscription.status).toBe('active');
    });
  });
});
