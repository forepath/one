import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { AdminWebhooksState } from './admin-webhooks.reducer';

export const selectAdminWebhooksState = createFeatureSelector<AdminWebhooksState>('adminWebhooks');

export const selectAdminWebhooks = createSelector(selectAdminWebhooksState, (state) => state.endpoints);

export const selectAdminWebhooksLoading = createSelector(selectAdminWebhooksState, (state) => state.loading);

export const selectAdminWebhooksError = createSelector(selectAdminWebhooksState, (state) => state.error);

export const selectAdminWebhooksSaving = createSelector(selectAdminWebhooksState, (state) => state.saving);

export const selectAdminWebhooksDeleting = createSelector(selectAdminWebhooksState, (state) => state.deleting);

export const selectAdminWebhooksTesting = createSelector(selectAdminWebhooksState, (state) => state.testing);

export const selectAdminWebhookEventTypes = createSelector(selectAdminWebhooksState, (state) => state.eventTypes);

export const selectAdminWebhookEventTypesLoading = createSelector(
  selectAdminWebhooksState,
  (state) => state.eventTypesLoading,
);

export const selectAdminWebhookEventTypesError = createSelector(
  selectAdminWebhooksState,
  (state) => state.eventTypesError,
);

export const selectAdminWebhookLastCreatedSigningSecret = createSelector(
  selectAdminWebhooksState,
  (state) => state.lastCreatedSigningSecret,
);

export const selectAdminWebhookLastTestDelivery = createSelector(
  selectAdminWebhooksState,
  (state) => state.lastTestDelivery,
);

export const selectAdminWebhookDeliveries = createSelector(selectAdminWebhooksState, (state) => state.deliveries);

export const selectAdminWebhookDeliveriesTotal = createSelector(
  selectAdminWebhooksState,
  (state) => state.deliveriesTotal,
);

export const selectAdminWebhookDeliveriesLoading = createSelector(
  selectAdminWebhooksState,
  (state) => state.deliveriesLoading,
);

export const selectAdminWebhookDeliveriesError = createSelector(
  selectAdminWebhooksState,
  (state) => state.deliveriesError,
);

export const selectAdminWebhookDeliveriesEndpointId = createSelector(
  selectAdminWebhooksState,
  (state) => state.deliveriesEndpointId,
);

export const selectAdminWebhookDeliveriesHasMore = createSelector(
  selectAdminWebhookDeliveries,
  selectAdminWebhookDeliveriesTotal,
  (deliveries, total) => deliveries.length < total,
);
