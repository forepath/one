import { createFeatureSelector, createSelector } from '@ngrx/store';

import type {
  ProvisioningServiceKind,
  ProvisioningStatus,
  ServerInfoResponse,
  SubscriptionResponse,
} from '../../types/billing.types';
import { selectSubscriptionsEntities } from '../subscriptions/subscriptions.selectors';

import type { ServerActionType, SubscriptionServerInfoState } from './subscription-server-info.reducer';

export interface SubscriptionWithServerInfo {
  subscription: SubscriptionResponse;
  serverInfo?: ServerInfoResponse;
  itemId: string;
  /** Product service from active item config. Defaults to controller. */
  service: ProvisioningServiceKind;
  provisioningStatus: ProvisioningStatus;
}

const selectSubscriptionServerInfoState = createFeatureSelector<SubscriptionServerInfoState>('subscriptionServerInfo');

export const selectServerInfoBySubscriptionId = createSelector(
  selectSubscriptionServerInfoState,
  (state) => state.serverInfoBySubscriptionId,
);

export const selectActiveItemIdBySubscriptionId = createSelector(
  selectSubscriptionServerInfoState,
  (state) => state.activeItemIdBySubscriptionId,
);

export const selectServiceBySubscriptionId = createSelector(
  selectSubscriptionServerInfoState,
  (state) => state.serviceBySubscriptionId,
);

export const selectProvisioningStatusBySubscriptionId = createSelector(
  selectSubscriptionServerInfoState,
  (state) => state.provisioningStatusBySubscriptionId,
);

export const selectOverviewServerInfoLoading = createSelector(
  selectSubscriptionServerInfoState,
  (state) => state.loading,
);

export const selectOverviewServerInfoError = createSelector(selectSubscriptionServerInfoState, (state) => state.error);

export const selectBillingStatusHistory = createSelector(
  selectSubscriptionServerInfoState,
  (state) => state.billingStatusHistory,
);

export const selectServerActionInProgress = createSelector(
  selectSubscriptionServerInfoState,
  (state) => state.actionInProgress,
);

export const selectServerActionInProgressForSubscriptionId = (subscriptionId: string) =>
  createSelector(
    selectServerActionInProgress,
    (actionInProgress): ServerActionType | undefined => actionInProgress[subscriptionId],
  );

export const selectSubscriptionsWithServerInfo = createSelector(
  selectSubscriptionsEntities,
  selectServerInfoBySubscriptionId,
  selectActiveItemIdBySubscriptionId,
  selectServiceBySubscriptionId,
  selectProvisioningStatusBySubscriptionId,
  (
    subscriptions,
    serverInfoBySubscriptionId,
    activeItemIdBySubscriptionId,
    serviceBySubscriptionId,
    provisioningStatusBySubscriptionId,
  ): SubscriptionWithServerInfo[] =>
    subscriptions
      .filter((sub) => sub.status === 'active' && activeItemIdBySubscriptionId[sub.id] != null)
      .map((subscription) => ({
        subscription,
        serverInfo: serverInfoBySubscriptionId[subscription.id],
        itemId: activeItemIdBySubscriptionId[subscription.id],
        service: serviceBySubscriptionId[subscription.id] ?? 'controller',
        provisioningStatus: provisioningStatusBySubscriptionId[subscription.id] ?? 'active',
      })),
);
