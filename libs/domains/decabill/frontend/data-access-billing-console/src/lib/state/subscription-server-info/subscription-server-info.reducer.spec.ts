import type { ServerInfoResponse } from '../../types/billing.types';

import {
  billingDashboardStatusPush,
  loadOverviewServerInfo,
  loadOverviewServerInfoFailure,
  loadOverviewServerInfoSuccess,
  refreshSubscriptionServerInfoSuccess,
  restartServer,
  restartServerSuccess,
  startServer,
  startServerFailure,
  startServerSuccess,
  stopServer,
  stopServerSuccess,
} from './subscription-server-info.actions';
import {
  initialSubscriptionServerInfoState,
  subscriptionServerInfoReducer,
  type SubscriptionServerInfoState,
} from './subscription-server-info.reducer';

describe('subscriptionServerInfoReducer', () => {
  const mockServerInfo: ServerInfoResponse = {
    name: 'my-server',
    publicIp: '1.2.3.4',
    privateIp: '10.0.0.1',
    status: 'running',
  };

  describe('initial state', () => {
    it('should return the initial state for unknown action', () => {
      const action = { type: 'UNKNOWN' };

      expect(subscriptionServerInfoReducer(undefined, action as never)).toEqual(initialSubscriptionServerInfoState);
    });
  });

  describe('loadOverviewServerInfo', () => {
    it('should set loading to true and clear error', () => {
      const state: SubscriptionServerInfoState = {
        ...initialSubscriptionServerInfoState,
        error: 'Previous error',
      };
      const newState = subscriptionServerInfoReducer(state, loadOverviewServerInfo());

      expect(newState.loading).toBe(true);
      expect(newState.error).toBeNull();
    });
  });

  describe('loadOverviewServerInfoSuccess', () => {
    it('should set serverInfoBySubscriptionId, activeItemIdBySubscriptionId and set loading to false', () => {
      const state: SubscriptionServerInfoState = {
        ...initialSubscriptionServerInfoState,
        loading: true,
      };
      const serverInfoBySubscriptionId = { 'sub-1': mockServerInfo };
      const activeItemIdBySubscriptionId = { 'sub-1': 'item-1' };
      const newState = subscriptionServerInfoReducer(
        state,
        loadOverviewServerInfoSuccess({ serverInfoBySubscriptionId, activeItemIdBySubscriptionId }),
      );

      expect(newState.serverInfoBySubscriptionId).toEqual(serverInfoBySubscriptionId);
      expect(newState.activeItemIdBySubscriptionId).toEqual(activeItemIdBySubscriptionId);
      expect(newState.loading).toBe(false);
      expect(newState.error).toBeNull();
    });
  });

  describe('loadOverviewServerInfoFailure', () => {
    it('should set error and set loading to false', () => {
      const state: SubscriptionServerInfoState = {
        ...initialSubscriptionServerInfoState,
        loading: true,
      };
      const newState = subscriptionServerInfoReducer(state, loadOverviewServerInfoFailure({ error: 'Load failed' }));

      expect(newState.error).toBe('Load failed');
      expect(newState.loading).toBe(false);
    });
  });

  describe('refreshSubscriptionServerInfoSuccess', () => {
    it('should merge server info for the subscription', () => {
      const state: SubscriptionServerInfoState = {
        ...initialSubscriptionServerInfoState,
        serverInfoBySubscriptionId: { 'sub-1': mockServerInfo },
      };
      const updated = { ...mockServerInfo, status: 'stopped' };
      const newState = subscriptionServerInfoReducer(
        state,
        refreshSubscriptionServerInfoSuccess({ subscriptionId: 'sub-1', serverInfo: updated }),
      );

      expect(newState.serverInfoBySubscriptionId['sub-1']).toEqual(updated);
    });

    it('should clear actionInProgress when clearActionInProgress is not false', () => {
      const state: SubscriptionServerInfoState = {
        ...initialSubscriptionServerInfoState,
        actionInProgress: { 'sub-1': 'start' },
      };
      const newState = subscriptionServerInfoReducer(
        state,
        refreshSubscriptionServerInfoSuccess({
          subscriptionId: 'sub-1',
          serverInfo: mockServerInfo,
          clearActionInProgress: true,
        }),
      );

      expect(newState.actionInProgress['sub-1']).toBeUndefined();
    });

    it('should not clear actionInProgress when clearActionInProgress is false', () => {
      const state: SubscriptionServerInfoState = {
        ...initialSubscriptionServerInfoState,
        actionInProgress: { 'sub-1': 'start' },
      };
      const newState = subscriptionServerInfoReducer(
        state,
        refreshSubscriptionServerInfoSuccess({
          subscriptionId: 'sub-1',
          serverInfo: mockServerInfo,
          clearActionInProgress: false,
        }),
      );

      expect(newState.actionInProgress['sub-1']).toBe('start');
    });
  });

  describe('billingDashboardStatusPush', () => {
    it('should clear actionInProgress for subscriptions included in the push', () => {
      const state: SubscriptionServerInfoState = {
        ...initialSubscriptionServerInfoState,
        actionInProgress: { 'sub-1': 'restart', 'sub-2': 'stop' },
        serverInfoBySubscriptionId: {
          'sub-1': mockServerInfo,
          'sub-2': { ...mockServerInfo, publicIp: '5.5.5.5' },
        },
      };
      const newState = subscriptionServerInfoReducer(
        state,
        billingDashboardStatusPush({
          generatedAt: '2025-01-01T00:00:00.000Z',
          items: [
            {
              subscriptionId: 'sub-1',
              itemId: 'item-1',
              service: 'controller',
              name: 's1',
              publicIp: '1.1.1.1',
              status: 'running',
            },
          ],
        }),
      );

      expect(newState.actionInProgress['sub-1']).toBeUndefined();
      expect(newState.actionInProgress['sub-2']).toBe('stop');
    });
  });

  describe('startServer', () => {
    it('should set actionInProgress for subscription', () => {
      const newState = subscriptionServerInfoReducer(
        initialSubscriptionServerInfoState,
        startServer({ subscriptionId: 'sub-1', itemId: 'item-1' }),
      );

      expect(newState.actionInProgress['sub-1']).toBe('start');
    });
  });

  describe('startServerSuccess', () => {
    it('should keep actionInProgress until a status push and set server info status to running', () => {
      const state: SubscriptionServerInfoState = {
        ...initialSubscriptionServerInfoState,
        actionInProgress: { 'sub-1': 'start' },
        serverInfoBySubscriptionId: {
          'sub-1': { name: 'my-server', publicIp: '1.2.3.4', status: 'off' },
        },
      };
      const newState = subscriptionServerInfoReducer(
        state,
        startServerSuccess({ subscriptionId: 'sub-1', itemId: 'item-1' }),
      );

      expect(newState.actionInProgress['sub-1']).toBe('start');
      expect(newState.serverInfoBySubscriptionId['sub-1'].status).toBe('running');
    });

    it('should set server info status to active for DigitalOcean on start success', () => {
      const state: SubscriptionServerInfoState = {
        ...initialSubscriptionServerInfoState,
        actionInProgress: { 'sub-1': 'start' },
        serverInfoBySubscriptionId: {
          'sub-1': {
            name: 'droplet',
            publicIp: '1.2.3.4',
            status: 'off',
            metadata: { provider: 'digital-ocean' },
          },
        },
      };
      const newState = subscriptionServerInfoReducer(
        state,
        startServerSuccess({ subscriptionId: 'sub-1', itemId: 'item-1' }),
      );

      expect(newState.serverInfoBySubscriptionId['sub-1'].status).toBe('active');
    });

    it('should leave actionInProgress when subscription has no server info', () => {
      const state: SubscriptionServerInfoState = {
        ...initialSubscriptionServerInfoState,
        actionInProgress: { 'sub-1': 'start' },
      };
      const newState = subscriptionServerInfoReducer(
        state,
        startServerSuccess({ subscriptionId: 'sub-1', itemId: 'item-1' }),
      );

      expect(newState.actionInProgress['sub-1']).toBe('start');
      expect(newState.serverInfoBySubscriptionId).toEqual({});
    });
  });

  describe('startServerFailure', () => {
    it('should clear actionInProgress for subscription', () => {
      const state: SubscriptionServerInfoState = {
        ...initialSubscriptionServerInfoState,
        actionInProgress: { 'sub-1': 'start' },
      };
      const newState = subscriptionServerInfoReducer(
        state,
        startServerFailure({ subscriptionId: 'sub-1', error: 'Failed' }),
      );

      expect(newState.actionInProgress['sub-1']).toBeUndefined();
    });
  });

  describe('stopServer', () => {
    it('should set actionInProgress for subscription', () => {
      const newState = subscriptionServerInfoReducer(
        initialSubscriptionServerInfoState,
        stopServer({ subscriptionId: 'sub-1', itemId: 'item-1' }),
      );

      expect(newState.actionInProgress['sub-1']).toBe('stop');
    });
  });

  describe('stopServerSuccess', () => {
    it('should keep actionInProgress until a status push and set server info status to off', () => {
      const state: SubscriptionServerInfoState = {
        ...initialSubscriptionServerInfoState,
        actionInProgress: { 'sub-1': 'stop' },
        serverInfoBySubscriptionId: {
          'sub-1': { name: 'my-server', publicIp: '1.2.3.4', status: 'running' },
        },
      };
      const newState = subscriptionServerInfoReducer(
        state,
        stopServerSuccess({ subscriptionId: 'sub-1', itemId: 'item-1' }),
      );

      expect(newState.actionInProgress['sub-1']).toBe('stop');
      expect(newState.serverInfoBySubscriptionId['sub-1'].status).toBe('off');
    });

    it('should leave actionInProgress when subscription has no server info', () => {
      const state: SubscriptionServerInfoState = {
        ...initialSubscriptionServerInfoState,
        actionInProgress: { 'sub-1': 'stop' },
      };
      const newState = subscriptionServerInfoReducer(
        state,
        stopServerSuccess({ subscriptionId: 'sub-1', itemId: 'item-1' }),
      );

      expect(newState.actionInProgress['sub-1']).toBe('stop');
      expect(newState.serverInfoBySubscriptionId).toEqual({});
    });
  });

  describe('restartServer', () => {
    it('should set actionInProgress for subscription', () => {
      const newState = subscriptionServerInfoReducer(
        initialSubscriptionServerInfoState,
        restartServer({ subscriptionId: 'sub-1', itemId: 'item-1' }),
      );

      expect(newState.actionInProgress['sub-1']).toBe('restart');
    });
  });

  describe('restartServerSuccess', () => {
    it('should not clear actionInProgress (cleared on next billing status push)', () => {
      const state: SubscriptionServerInfoState = {
        ...initialSubscriptionServerInfoState,
        actionInProgress: { 'sub-1': 'restart' },
      };
      const newState = subscriptionServerInfoReducer(
        state,
        restartServerSuccess({ subscriptionId: 'sub-1', itemId: 'item-1' }),
      );

      expect(newState.actionInProgress['sub-1']).toBe('restart');
    });
  });
});
