import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { SubscriptionsState } from './subscriptions.reducer';

export const selectSubscriptionsState = createFeatureSelector<SubscriptionsState>('subscriptions');

// Base selectors
export const selectSubscriptionsEntities = createSelector(selectSubscriptionsState, (state) => state.entities);

export const selectSelectedSubscription = createSelector(
  selectSubscriptionsState,
  (state) => state.selectedSubscription,
);

export const selectSubscriptionsLoading = createSelector(selectSubscriptionsState, (state) => state.loading);

export const selectSubscriptionLoading = createSelector(selectSubscriptionsState, (state) => state.loadingSubscription);

export const selectSubscriptionsCreating = createSelector(selectSubscriptionsState, (state) => state.creating);

export const selectSubscriptionsCanceling = createSelector(selectSubscriptionsState, (state) => state.canceling);

export const selectSubscriptionsResuming = createSelector(selectSubscriptionsState, (state) => state.resuming);

export const selectSubscriptionsError = createSelector(selectSubscriptionsState, (state) => state.error);

// Combined loading selector
export const selectSubscriptionsLoadingAny = createSelector(
  selectSubscriptionsLoading,
  selectSubscriptionLoading,
  selectSubscriptionsCreating,
  selectSubscriptionsCanceling,
  selectSubscriptionsResuming,
  (loading, loadingSubscription, creating, canceling, resuming) =>
    loading || loadingSubscription || creating || canceling || resuming,
);

// Derived selectors
export const selectSubscriptionsCount = createSelector(selectSubscriptionsEntities, (entities) => entities.length);

export const selectSubscriptionById = (id: string) =>
  createSelector(selectSubscriptionsEntities, (entities) => entities.find((s) => s.id === id));

export const selectSubscriptionsByPlanId = (planId: string) =>
  createSelector(selectSubscriptionsEntities, (entities) => entities.filter((s) => s.planId === planId));

export const selectSubscriptionsByStatus = (status: string) =>
  createSelector(selectSubscriptionsEntities, (entities) => entities.filter((s) => s.status === status));

export const selectActiveSubscriptions = createSelector(selectSubscriptionsEntities, (entities) =>
  entities.filter((s) => s.status === 'active'),
);

export const selectHasSubscriptions = createSelector(selectSubscriptionsEntities, (entities) => entities.length > 0);

export const selectPendingCancelSubscriptions = createSelector(selectSubscriptionsEntities, (entities) =>
  entities.filter((s) => s.status === 'pending_cancel'),
);
