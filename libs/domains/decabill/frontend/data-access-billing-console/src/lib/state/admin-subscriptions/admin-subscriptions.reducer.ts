import { createReducer, on } from '@ngrx/store';

import type { AdminSubscriptionListItem } from '../../types/billing.types';

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
  loadAdminSubscriptions,
  loadAdminSubscriptionsBatch,
  loadAdminSubscriptionsFailure,
  loadAdminSubscriptionsSuccess,
} from './admin-subscriptions.actions';

export interface AdminSubscriptionsState {
  subscriptions: AdminSubscriptionListItem[];
  loading: boolean;
  canceling: boolean;
  withdrawing: boolean;
  resuming: boolean;
  error: string | null;
}

export const initialAdminSubscriptionsState: AdminSubscriptionsState = {
  subscriptions: [],
  loading: false,
  canceling: false,
  withdrawing: false,
  resuming: false,
  error: null,
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
  on(loadAdminSubscriptions, (state) => ({
    ...state,
    subscriptions: [],
    loading: true,
    error: null,
  })),
  on(loadAdminSubscriptionsBatch, (state, { accumulatedSubscriptions }) => ({
    ...state,
    subscriptions: accumulatedSubscriptions,
    loading: true,
  })),
  on(loadAdminSubscriptionsSuccess, (state, { subscriptions }) => ({
    ...state,
    subscriptions,
    loading: false,
    error: null,
  })),
  on(loadAdminSubscriptionsFailure, (state, { error }) => ({
    ...state,
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
);
