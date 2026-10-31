import { createReducer, on } from '@ngrx/store';

import type { AdminSubscriptionListItem } from '../../types/billing.types';
import { patchSubscriptionItemDisplayName } from '../../utils/patch-subscription-item-display-name.util';
import { BILLING_LIST_PAGE_SIZE, billingPageWindow } from '../../constants/list-paging.constants';
import { updateDisplayNameSuccess } from '../service-detail/service-detail.actions';

import {
  adminCancelSubscription,
  adminCancelSubscriptionFailure,
  adminCancelSubscriptionSuccess,
  adminResumeSubscription,
  adminResumeSubscriptionFailure,
  adminResumeSubscriptionSuccess,
  adminWithdrawSubscription,
  adminWithdrawSubscriptionFailure,
  adminWithdrawSubscriptionSuccess,
  adminInstantCancelSubscription,
  adminInstantCancelSubscriptionFailure,
  adminInstantCancelSubscriptionSuccess,
  loadAdminSubscriptions,
  loadAdminSubscriptionsFailure,
  loadAdminSubscriptionsSuccess,
} from './admin-subscriptions.actions';

export interface AdminSubscriptionsState {
  subscriptions: AdminSubscriptionListItem[];
  loading: boolean;
  canceling: boolean;
  withdrawing: boolean;
  instantCanceling: boolean;
  resuming: boolean;
  error: string | null;
  /** Replace-page paging: total of the server list, 1-based page and its size. */
  total: number;
  page: number;
  pageSize: number;
  search: string | null;
  userId: string | null;
}

export const initialAdminSubscriptionsState: AdminSubscriptionsState = {
  subscriptions: [],
  loading: false,
  canceling: false,
  withdrawing: false,
  instantCanceling: false,
  resuming: false,
  error: null,
  total: 0,
  page: 1,
  pageSize: BILLING_LIST_PAGE_SIZE,
  search: null,
  userId: null,
};

function upsertSubscription(
  subscriptions: AdminSubscriptionListItem[],
  updated: AdminSubscriptionListItem,
): AdminSubscriptionListItem[] {
  const index = subscriptions.findIndex((subscription) => subscription.id === updated.id);

  if (index === -1) {
    return subscriptions;
  }

  return subscriptions.map((subscription) => (subscription.id === updated.id ? updated : subscription));
}

export const adminSubscriptionsReducer = createReducer(
  initialAdminSubscriptionsState,
  on(loadAdminSubscriptions, (state, { search, userId, page, pageSize }) => {
    const window = billingPageWindow(page, pageSize ?? state.pageSize);

    return {
      ...state,
      loading: true,
      error: null,
      page: window.page,
      pageSize: window.pageSize,
      search: search?.trim() ? search.trim() : null,
      userId: userId ?? null,
    };
  }),
  on(loadAdminSubscriptionsSuccess, (state, { subscriptions, total }) => ({
    ...state,
    subscriptions,
    total,
    loading: false,
    error: null,
  })),
  on(loadAdminSubscriptionsFailure, (state, { error }) => ({
    ...state,
    subscriptions: [],
    total: 0,
    loading: false,
    error,
  })),
  on(adminCancelSubscription, (state) => ({
    ...state,
    canceling: true,
    error: null,
  })),
  on(adminCancelSubscriptionSuccess, (state, { subscription }) => ({
    ...state,
    canceling: false,
    subscriptions: upsertSubscription(state.subscriptions, subscription),
    error: null,
  })),
  on(adminCancelSubscriptionFailure, (state, { error }) => ({
    ...state,
    canceling: false,
    error,
  })),
  on(adminWithdrawSubscription, (state) => ({
    ...state,
    withdrawing: true,
    error: null,
  })),
  on(adminWithdrawSubscriptionSuccess, (state, { subscription }) => ({
    ...state,
    withdrawing: false,
    subscriptions: upsertSubscription(state.subscriptions, subscription),
    error: null,
  })),
  on(adminWithdrawSubscriptionFailure, (state, { error }) => ({
    ...state,
    withdrawing: false,
    error,
  })),
  on(adminInstantCancelSubscription, (state) => ({
    ...state,
    instantCanceling: true,
    error: null,
  })),
  on(adminInstantCancelSubscriptionSuccess, (state, { subscription }) => ({
    ...state,
    instantCanceling: false,
    subscriptions: upsertSubscription(state.subscriptions, subscription),
    error: null,
  })),
  on(adminInstantCancelSubscriptionFailure, (state, { error }) => ({
    ...state,
    instantCanceling: false,
    error,
  })),
  on(adminResumeSubscription, (state) => ({
    ...state,
    resuming: true,
    error: null,
  })),
  on(adminResumeSubscriptionSuccess, (state, { subscription }) => ({
    ...state,
    resuming: false,
    subscriptions: upsertSubscription(state.subscriptions, subscription),
    error: null,
  })),
  on(adminResumeSubscriptionFailure, (state, { error }) => ({
    ...state,
    resuming: false,
    error,
  })),
  on(updateDisplayNameSuccess, (state, { subscriptionId, itemId, displayName }) => ({
    ...state,
    subscriptions: state.subscriptions.map((subscription) =>
      subscription.id === subscriptionId
        ? patchSubscriptionItemDisplayName(subscription, itemId, displayName)
        : subscription,
    ),
  })),
);
