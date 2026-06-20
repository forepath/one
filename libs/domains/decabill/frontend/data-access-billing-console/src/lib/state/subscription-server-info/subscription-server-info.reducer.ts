import { createReducer, on } from '@ngrx/store';

import type { ServerInfoResponse } from '../../types/billing.types';
import { billingOptimisticOnlineStatus } from '../../utils/server-info-provider.utils';

import {
  billingDashboardStatusPush,
  loadOverviewServerInfo,
  loadOverviewServerInfoFailure,
  loadOverviewServerInfoSuccess,
  refreshSubscriptionServerInfoSuccess,
  restartServer,
  restartServerFailure,
  startServer,
  startServerFailure,
  startServerSuccess,
  stopServer,
  stopServerFailure,
  stopServerSuccess,
} from './subscription-server-info.actions';

export type ServerActionType = 'start' | 'stop' | 'restart';

const MAX_STATUS_HISTORY = 500;

export interface BillingStatusHistoryEntry {
  generatedAt: string;
  subscriptionId: string;
  itemId: string;
  status: string;
}

export interface SubscriptionServerInfoState {
  serverInfoBySubscriptionId: Record<string, ServerInfoResponse>;
  activeItemIdBySubscriptionId: Record<string, string>;
  /** Service (controller/manager) per subscription id from active item. */
  serviceBySubscriptionId: Record<string, 'controller' | 'manager'>;
  loading: boolean;
  error: string | null;
  actionInProgress: Record<string, ServerActionType>;
  /** Ring buffer of recent WebSocket status snapshots (capped). */
  billingStatusHistory: BillingStatusHistoryEntry[];
}

export const initialSubscriptionServerInfoState: SubscriptionServerInfoState = {
  serverInfoBySubscriptionId: {},
  activeItemIdBySubscriptionId: {},
  serviceBySubscriptionId: {},
  loading: false,
  error: null,
  actionInProgress: {},
  billingStatusHistory: [],
};

function setActionInProgress(
  state: SubscriptionServerInfoState,
  subscriptionId: string,
  action: ServerActionType | null,
): Record<string, ServerActionType> {
  const next = { ...state.actionInProgress };

  if (action === null) {
    delete next[subscriptionId];
  } else {
    next[subscriptionId] = action;
  }

  return next;
}

export const subscriptionServerInfoReducer = createReducer(
  initialSubscriptionServerInfoState,
  on(loadOverviewServerInfo, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),
  on(
    loadOverviewServerInfoSuccess,
    (state, { serverInfoBySubscriptionId, activeItemIdBySubscriptionId, serviceBySubscriptionId }) => ({
      ...state,
      serverInfoBySubscriptionId: serverInfoBySubscriptionId ?? {},
      activeItemIdBySubscriptionId: activeItemIdBySubscriptionId ?? {},
      serviceBySubscriptionId: serviceBySubscriptionId ?? {},
      loading: false,
      error: null,
    }),
  ),
  on(loadOverviewServerInfoFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),
  on(billingDashboardStatusPush, (state, { generatedAt, items }) => {
    const serverInfoBySubscriptionId = { ...state.serverInfoBySubscriptionId };
    const activeItemIdBySubscriptionId = { ...state.activeItemIdBySubscriptionId };
    const serviceBySubscriptionId = { ...state.serviceBySubscriptionId };
    const actionInProgress = { ...state.actionInProgress };
    const history = [...state.billingStatusHistory];

    for (const item of items) {
      serverInfoBySubscriptionId[item.subscriptionId] = {
        name: item.name,
        publicIp: item.publicIp,
        privateIp: item.privateIp,
        status: item.status,
        metadata: item.metadata,
        hostname: item.hostname ?? null,
        hostnameFqdn: item.hostnameFqdn ?? null,
      };
      activeItemIdBySubscriptionId[item.subscriptionId] = item.itemId;
      serviceBySubscriptionId[item.subscriptionId] = item.service;
      delete actionInProgress[item.subscriptionId];
      history.push({
        generatedAt,
        subscriptionId: item.subscriptionId,
        itemId: item.itemId,
        status: item.status,
      });
    }

    const billingStatusHistory = history.slice(-MAX_STATUS_HISTORY);

    return {
      ...state,
      serverInfoBySubscriptionId,
      activeItemIdBySubscriptionId,
      serviceBySubscriptionId,
      actionInProgress,
      billingStatusHistory,
      loading: false,
      error: null,
    };
  }),
  on(refreshSubscriptionServerInfoSuccess, (state, { subscriptionId, serverInfo, clearActionInProgress }) => {
    const next: SubscriptionServerInfoState = {
      ...state,
      serverInfoBySubscriptionId: { ...state.serverInfoBySubscriptionId, [subscriptionId]: serverInfo },
    };

    if (clearActionInProgress !== false) {
      next.actionInProgress = setActionInProgress(state, subscriptionId, null);
    }

    return next;
  }),
  on(startServer, (state, { subscriptionId }) => ({
    ...state,
    actionInProgress: setActionInProgress(state, subscriptionId, 'start'),
  })),
  on(startServerSuccess, (state, { subscriptionId }) => {
    const existing = state.serverInfoBySubscriptionId[subscriptionId];
    const serverInfoBySubscriptionId = existing
      ? {
          ...state.serverInfoBySubscriptionId,
          [subscriptionId]: {
            ...existing,
            status: billingOptimisticOnlineStatus(existing.metadata),
          },
        }
      : state.serverInfoBySubscriptionId;

    return { ...state, serverInfoBySubscriptionId };
  }),
  on(startServerFailure, (state, { subscriptionId }) => ({
    ...state,
    actionInProgress: setActionInProgress(state, subscriptionId, null),
  })),
  on(stopServer, (state, { subscriptionId }) => ({
    ...state,
    actionInProgress: setActionInProgress(state, subscriptionId, 'stop'),
  })),
  on(stopServerSuccess, (state, { subscriptionId }) => {
    const existing = state.serverInfoBySubscriptionId[subscriptionId];
    const serverInfoBySubscriptionId = existing
      ? { ...state.serverInfoBySubscriptionId, [subscriptionId]: { ...existing, status: 'off' } }
      : state.serverInfoBySubscriptionId;

    return { ...state, serverInfoBySubscriptionId };
  }),
  on(stopServerFailure, (state, { subscriptionId }) => ({
    ...state,
    actionInProgress: setActionInProgress(state, subscriptionId, null),
  })),
  on(restartServer, (state, { subscriptionId }) => ({
    ...state,
    actionInProgress: setActionInProgress(state, subscriptionId, 'restart'),
  })),
  on(restartServerFailure, (state, { subscriptionId }) => ({
    ...state,
    actionInProgress: setActionInProgress(state, subscriptionId, null),
  })),
);
