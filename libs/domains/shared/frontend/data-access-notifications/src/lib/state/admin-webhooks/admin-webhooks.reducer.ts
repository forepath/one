import { createReducer, on } from '@ngrx/store';

import {
  clearAdminWebhookCreatedSigningSecret,
  clearAdminWebhookDeliveries,
  clearAdminWebhookTestResult,
  clearAdminWebhooksError,
  createAdminWebhook,
  createAdminWebhookFailure,
  createAdminWebhookSuccess,
  deleteAdminWebhook,
  deleteAdminWebhookFailure,
  deleteAdminWebhookSuccess,
  loadAdminWebhookDeliveries,
  loadAdminWebhookDeliveriesBatch,
  loadAdminWebhookDeliveriesFailure,
  loadAdminWebhookDeliveriesSuccess,
  loadAdminWebhookEventTypes,
  loadAdminWebhookEventTypesFailure,
  loadAdminWebhookEventTypesSuccess,
  loadAdminWebhooks,
  loadAdminWebhooksBatch,
  loadAdminWebhooksFailure,
  loadAdminWebhooksSuccess,
  testAdminWebhook,
  testAdminWebhookFailure,
  testAdminWebhookSuccess,
  updateAdminWebhook,
  updateAdminWebhookFailure,
  updateAdminWebhookSuccess,
} from './admin-webhooks.actions';
import type {
  WebhookDeliveryResponseDto,
  WebhookEndpointResponseDto,
  WebhookEventTypeResponseDto,
} from '../../types/webhook-endpoint.types';

function sortEndpoints(endpoints: WebhookEndpointResponseDto[]): WebhookEndpointResponseDto[] {
  return [...endpoints].sort((a, b) => a.name.localeCompare(b.name) || a.createdAt.localeCompare(b.createdAt));
}

export interface AdminWebhooksState {
  endpoints: WebhookEndpointResponseDto[];
  loading: boolean;
  saving: boolean;
  deleting: boolean;
  testing: boolean;
  error: string | null;
  eventTypes: WebhookEventTypeResponseDto[];
  eventTypesLoading: boolean;
  eventTypesError: string | null;
  lastCreatedSigningSecret: string | null;
  lastTestDelivery: WebhookDeliveryResponseDto | null;
  deliveriesEndpointId: string | null;
  deliveries: WebhookDeliveryResponseDto[];
  deliveriesTotal: number;
  deliveriesLoading: boolean;
  deliveriesError: string | null;
}

export const initialAdminWebhooksState: AdminWebhooksState = {
  endpoints: [],
  loading: false,
  saving: false,
  deleting: false,
  testing: false,
  error: null,
  eventTypes: [],
  eventTypesLoading: false,
  eventTypesError: null,
  lastCreatedSigningSecret: null,
  lastTestDelivery: null,
  deliveriesEndpointId: null,
  deliveries: [],
  deliveriesTotal: 0,
  deliveriesLoading: false,
  deliveriesError: null,
};

export const adminWebhooksReducer = createReducer(
  initialAdminWebhooksState,
  on(loadAdminWebhooks, (state) => ({
    ...state,
    endpoints: [],
    loading: true,
    error: null,
  })),
  on(loadAdminWebhooksBatch, (state, { accumulatedEndpoints }) => ({
    ...state,
    endpoints: accumulatedEndpoints,
    loading: true,
    error: null,
  })),
  on(loadAdminWebhooksSuccess, (state, { endpoints }) => ({
    ...state,
    loading: false,
    endpoints: sortEndpoints(endpoints),
    error: null,
  })),
  on(loadAdminWebhooksFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(loadAdminWebhookEventTypes, (state) => ({
    ...state,
    eventTypesLoading: true,
    eventTypesError: null,
  })),
  on(loadAdminWebhookEventTypesSuccess, (state, { eventTypes }) => ({
    ...state,
    eventTypesLoading: false,
    eventTypes,
    eventTypesError: null,
  })),
  on(loadAdminWebhookEventTypesFailure, (state, { error }) => ({
    ...state,
    eventTypesLoading: false,
    eventTypesError: error,
  })),
  on(createAdminWebhook, (state) => ({ ...state, saving: true, error: null })),
  on(createAdminWebhookSuccess, (state, { endpoint }) => ({
    ...state,
    saving: false,
    endpoints: sortEndpoints([...state.endpoints, endpoint]),
    lastCreatedSigningSecret: endpoint.signingSecret ?? null,
    error: null,
  })),
  on(createAdminWebhookFailure, (state, { error }) => ({ ...state, saving: false, error })),
  on(updateAdminWebhook, (state) => ({ ...state, saving: true, error: null })),
  on(updateAdminWebhookSuccess, (state, { endpoint }) => ({
    ...state,
    saving: false,
    endpoints: sortEndpoints(state.endpoints.map((item) => (item.id === endpoint.id ? endpoint : item))),
    error: null,
  })),
  on(updateAdminWebhookFailure, (state, { error }) => ({ ...state, saving: false, error })),
  on(deleteAdminWebhook, (state) => ({ ...state, deleting: true, error: null })),
  on(deleteAdminWebhookSuccess, (state, { id }) => ({
    ...state,
    deleting: false,
    endpoints: state.endpoints.filter((item) => item.id !== id),
    error: null,
  })),
  on(deleteAdminWebhookFailure, (state, { error }) => ({ ...state, deleting: false, error })),
  on(testAdminWebhook, (state) => ({ ...state, testing: true, error: null, lastTestDelivery: null })),
  on(testAdminWebhookSuccess, (state, { delivery }) => ({
    ...state,
    testing: false,
    lastTestDelivery: delivery,
    error: null,
  })),
  on(testAdminWebhookFailure, (state, { error }) => ({ ...state, testing: false, error })),
  on(clearAdminWebhookTestResult, (state) => ({ ...state, lastTestDelivery: null })),
  on(loadAdminWebhookDeliveries, (state, { id }) => ({
    ...state,
    deliveriesEndpointId: id,
    deliveries: [],
    deliveriesTotal: 0,
    deliveriesLoading: true,
    deliveriesError: null,
  })),
  on(loadAdminWebhookDeliveriesBatch, (state, { accumulatedDeliveries, total }) => ({
    ...state,
    deliveries: accumulatedDeliveries,
    deliveriesTotal: total,
    deliveriesLoading: true,
    deliveriesError: null,
  })),
  on(loadAdminWebhookDeliveriesSuccess, (state, { endpointId, deliveries, total }) => ({
    ...state,
    deliveriesEndpointId: endpointId,
    deliveries,
    deliveriesTotal: total,
    deliveriesLoading: false,
    deliveriesError: null,
  })),
  on(loadAdminWebhookDeliveriesFailure, (state, { error }) => ({
    ...state,
    deliveriesLoading: false,
    deliveriesError: error,
  })),
  on(clearAdminWebhookDeliveries, (state) => ({
    ...state,
    deliveriesEndpointId: null,
    deliveries: [],
    deliveriesTotal: 0,
    deliveriesLoading: false,
    deliveriesError: null,
  })),
  on(clearAdminWebhookCreatedSigningSecret, (state) => ({ ...state, lastCreatedSigningSecret: null })),
  on(clearAdminWebhooksError, (state) => ({ ...state, error: null })),
);
