import { createReducer, on } from '@ngrx/store';

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

export interface SubscriptionsState {
  entities: SubscriptionResponse[];
  selectedSubscription: SubscriptionResponse | null;
  loading: boolean;
  loadingSubscription: boolean;
  creating: boolean;
  canceling: boolean;
  resuming: boolean;
  error: string | null;
}

export const initialSubscriptionsState: SubscriptionsState = {
  entities: [],
  selectedSubscription: null,
  loading: false,
  loadingSubscription: false,
  creating: false,
  canceling: false,
  resuming: false,
  error: null,
};

export const subscriptionsReducer = createReducer(
  initialSubscriptionsState,
  // Load Subscriptions
  on(loadSubscriptions, (state) => ({
    ...state,
    entities: [],
    loading: true,
    error: null,
  })),
  on(loadSubscriptionsBatch, (state, { accumulatedSubscriptions }) => ({
    ...state,
    entities: accumulatedSubscriptions,
    loading: true,
    error: null,
  })),
  on(loadSubscriptionsSuccess, (state, { subscriptions }) => ({
    ...state,
    entities: subscriptions,
    loading: false,
    error: null,
  })),
  on(loadSubscriptionsFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),
  // Load Subscription by ID
  on(loadSubscription, (state) => ({
    ...state,
    loadingSubscription: true,
    error: null,
  })),
  on(loadSubscriptionSuccess, (state, { subscription }) => {
    const existingIndex = state.entities.findIndex((s) => s.id === subscription.id);
    const entities =
      existingIndex >= 0
        ? state.entities.map((s) => (s.id === subscription.id ? subscription : s))
        : [...state.entities, subscription];

    return {
      ...state,
      entities,
      selectedSubscription: subscription,
      loadingSubscription: false,
      error: null,
    };
  }),
  on(loadSubscriptionFailure, (state, { error }) => ({
    ...state,
    loadingSubscription: false,
    error,
  })),
  // Create Subscription
  on(createSubscription, (state) => ({
    ...state,
    creating: true,
    error: null,
  })),
  on(createSubscriptionSuccess, (state, { subscription }) => ({
    ...state,
    entities: [subscription, ...state.entities],
    selectedSubscription: subscription,
    creating: false,
    error: null,
  })),
  on(createSubscriptionFailure, (state, { error }) => ({
    ...state,
    creating: false,
    error,
  })),
  // Cancel Subscription
  on(cancelSubscription, (state) => ({
    ...state,
    canceling: true,
    error: null,
  })),
  on(cancelSubscriptionSuccess, (state, { subscription }) => ({
    ...state,
    entities: state.entities.map((s) => (s.id === subscription.id ? subscription : s)),
    selectedSubscription:
      state.selectedSubscription?.id === subscription.id ? subscription : state.selectedSubscription,
    canceling: false,
    error: null,
  })),
  on(cancelSubscriptionFailure, (state, { error }) => ({
    ...state,
    canceling: false,
    error,
  })),
  // Resume Subscription
  on(resumeSubscription, (state) => ({
    ...state,
    resuming: true,
    error: null,
  })),
  on(resumeSubscriptionSuccess, (state, { subscription }) => ({
    ...state,
    entities: state.entities.map((s) => (s.id === subscription.id ? subscription : s)),
    selectedSubscription:
      state.selectedSubscription?.id === subscription.id ? subscription : state.selectedSubscription,
    resuming: false,
    error: null,
  })),
  on(resumeSubscriptionFailure, (state, { error }) => ({
    ...state,
    resuming: false,
    error,
  })),
  // Clear Selected Subscription
  on(clearSelectedSubscription, (state) => ({
    ...state,
    selectedSubscription: null,
  })),
);
