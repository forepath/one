import { createAction, props } from '@ngrx/store';

import type {
  CreateWebhookEndpointDto,
  UpdateWebhookEndpointDto,
  WebhookDeliveryResponseDto,
  WebhookEndpointResponseDto,
  WebhookEventTypeResponseDto,
} from '../../types/webhook-endpoint.types';

export const loadAdminWebhooks = createAction('[Admin Webhooks] Load');

export const loadAdminWebhooksBatch = createAction(
  '[Admin Webhooks] Load Batch',
  props<{ offset: number; accumulatedEndpoints: WebhookEndpointResponseDto[] }>(),
);

export const loadAdminWebhooksSuccess = createAction(
  '[Admin Webhooks] Load Success',
  props<{ endpoints: WebhookEndpointResponseDto[] }>(),
);

export const loadAdminWebhooksFailure = createAction('[Admin Webhooks] Load Failure', props<{ error: string }>());

export const loadAdminWebhookEventTypes = createAction('[Admin Webhooks] Load Event Types');

export const loadAdminWebhookEventTypesSuccess = createAction(
  '[Admin Webhooks] Load Event Types Success',
  props<{ eventTypes: WebhookEventTypeResponseDto[] }>(),
);

export const loadAdminWebhookEventTypesFailure = createAction(
  '[Admin Webhooks] Load Event Types Failure',
  props<{ error: string }>(),
);

export const createAdminWebhook = createAction('[Admin Webhooks] Create', props<{ dto: CreateWebhookEndpointDto }>());

export const createAdminWebhookSuccess = createAction(
  '[Admin Webhooks] Create Success',
  props<{ endpoint: WebhookEndpointResponseDto }>(),
);

export const createAdminWebhookFailure = createAction('[Admin Webhooks] Create Failure', props<{ error: string }>());

export const updateAdminWebhook = createAction(
  '[Admin Webhooks] Update',
  props<{ id: string; dto: UpdateWebhookEndpointDto }>(),
);

export const updateAdminWebhookSuccess = createAction(
  '[Admin Webhooks] Update Success',
  props<{ endpoint: WebhookEndpointResponseDto }>(),
);

export const updateAdminWebhookFailure = createAction('[Admin Webhooks] Update Failure', props<{ error: string }>());

export const deleteAdminWebhook = createAction('[Admin Webhooks] Delete', props<{ id: string }>());

export const deleteAdminWebhookSuccess = createAction('[Admin Webhooks] Delete Success', props<{ id: string }>());

export const deleteAdminWebhookFailure = createAction('[Admin Webhooks] Delete Failure', props<{ error: string }>());

export const testAdminWebhook = createAction('[Admin Webhooks] Test', props<{ id: string }>());

export const testAdminWebhookSuccess = createAction(
  '[Admin Webhooks] Test Success',
  props<{ delivery: WebhookDeliveryResponseDto }>(),
);

export const testAdminWebhookFailure = createAction('[Admin Webhooks] Test Failure', props<{ error: string }>());

export const clearAdminWebhookTestResult = createAction('[Admin Webhooks] Clear Test Result');

export const loadAdminWebhookDeliveries = createAction('[Admin Webhooks] Load Deliveries', props<{ id: string }>());

export const loadAdminWebhookDeliveriesBatch = createAction(
  '[Admin Webhooks] Load Deliveries Batch',
  props<{ id: string; offset: number; accumulatedDeliveries: WebhookDeliveryResponseDto[]; total: number }>(),
);

export const loadAdminWebhookDeliveriesSuccess = createAction(
  '[Admin Webhooks] Load Deliveries Success',
  props<{ endpointId: string; deliveries: WebhookDeliveryResponseDto[]; total: number }>(),
);

export const loadAdminWebhookDeliveriesFailure = createAction(
  '[Admin Webhooks] Load Deliveries Failure',
  props<{ error: string }>(),
);

export const clearAdminWebhookDeliveries = createAction('[Admin Webhooks] Clear Deliveries');

export const clearAdminWebhookCreatedSigningSecret = createAction('[Admin Webhooks] Clear Created Signing Secret');

export const clearAdminWebhooksError = createAction('[Admin Webhooks] Clear Error');
