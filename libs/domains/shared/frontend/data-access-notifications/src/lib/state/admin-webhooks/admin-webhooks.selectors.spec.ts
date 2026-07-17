import { initialAdminWebhooksState, type AdminWebhooksState } from './admin-webhooks.reducer';
import {
  selectAdminWebhookDeliveries,
  selectAdminWebhookDeliveriesHasMore,
  selectAdminWebhookDeliveriesLoading,
  selectAdminWebhookLastCreatedSigningSecret,
  selectAdminWebhooks,
  selectAdminWebhooksError,
  selectAdminWebhooksLoading,
  selectAdminWebhooksSaving,
  selectAdminWebhooksTesting,
} from './admin-webhooks.selectors';
import { WebhookAuthType, WebhookHttpMethod } from '../../types/webhook-endpoint.types';

describe('adminWebhooksSelectors', () => {
  const state: AdminWebhooksState = {
    ...initialAdminWebhooksState,
    endpoints: [
      {
        id: '11111111-1111-1111-1111-111111111111',
        scopeKey: 'app',
        name: 'Primary',
        url: 'https://example.com/hook',
        httpMethod: WebhookHttpMethod.POST,
        subscribedEvents: ['ticket.created'],
        enabled: true,
        authType: WebhookAuthType.NONE,
        hasAuthValue: false,
        consecutiveFailures: 0,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
    ],
    loading: true,
    saving: true,
    testing: true,
    error: 'failed',
    lastCreatedSigningSecret: 'secret',
    deliveries: [
      {
        id: '22222222-2222-2222-2222-222222222222',
        endpointId: '11111111-1111-1111-1111-111111111111',
        eventId: 'evt-1',
        eventType: 'ticket.created',
        payload: {},
        success: true,
        attempt: 1,
        createdAt: '2024-01-01T00:00:00Z',
      },
    ],
    deliveriesTotal: 2,
    deliveriesLoading: true,
  };

  it('selectAdminWebhooks returns endpoints', () => {
    expect(selectAdminWebhooks.projector(state)).toEqual(state.endpoints);
  });

  it('selectAdminWebhooksLoading returns loading flag', () => {
    expect(selectAdminWebhooksLoading.projector(state)).toBe(true);
  });

  it('selectAdminWebhooksSaving returns saving flag', () => {
    expect(selectAdminWebhooksSaving.projector(state)).toBe(true);
  });

  it('selectAdminWebhooksTesting returns testing flag', () => {
    expect(selectAdminWebhooksTesting.projector(state)).toBe(true);
  });

  it('selectAdminWebhooksError returns error', () => {
    expect(selectAdminWebhooksError.projector(state)).toBe('failed');
  });

  it('selectAdminWebhookLastCreatedSigningSecret returns secret', () => {
    expect(selectAdminWebhookLastCreatedSigningSecret.projector(state)).toBe('secret');
  });

  it('selectAdminWebhookDeliveries returns deliveries', () => {
    expect(selectAdminWebhookDeliveries.projector(state)).toEqual(state.deliveries);
  });

  it('selectAdminWebhookDeliveriesHasMore compares deliveries length to total', () => {
    expect(selectAdminWebhookDeliveriesHasMore.projector(state.deliveries, state.deliveriesTotal)).toBe(true);
    expect(selectAdminWebhookDeliveriesHasMore.projector(state.deliveries, 1)).toBe(false);
  });

  it('selectAdminWebhookDeliveriesLoading returns deliveries loading flag', () => {
    expect(selectAdminWebhookDeliveriesLoading.projector(state)).toBe(true);
  });

  it('matches initial state defaults', () => {
    expect(selectAdminWebhooksLoading.projector(initialAdminWebhooksState)).toBe(false);
    expect(selectAdminWebhooksSaving.projector(initialAdminWebhooksState)).toBe(false);
    expect(selectAdminWebhooksTesting.projector(initialAdminWebhooksState)).toBe(false);
    expect(selectAdminWebhooksError.projector(initialAdminWebhooksState)).toBeNull();
    expect(selectAdminWebhookLastCreatedSigningSecret.projector(initialAdminWebhooksState)).toBeNull();
  });
});
