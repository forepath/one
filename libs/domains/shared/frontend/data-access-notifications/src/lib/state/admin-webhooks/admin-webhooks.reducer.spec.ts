import {
  clearAdminWebhookCreatedSigningSecret,
  clearAdminWebhooksError,
  createAdminWebhook,
  createAdminWebhookSuccess,
  deleteAdminWebhook,
  deleteAdminWebhookFailure,
  deleteAdminWebhookSuccess,
  loadAdminWebhooks,
  loadAdminWebhooksBatch,
  loadAdminWebhooksFailure,
  loadAdminWebhooksSuccess,
  testAdminWebhook,
  testAdminWebhookSuccess,
  updateAdminWebhookFailure,
  updateAdminWebhookSuccess,
} from './admin-webhooks.actions';
import { adminWebhooksReducer, initialAdminWebhooksState } from './admin-webhooks.reducer';
import {
  WebhookAuthType,
  WebhookHttpMethod,
  type WebhookEndpointResponseDto,
} from '../../types/webhook-endpoint.types';

describe('adminWebhooksReducer', () => {
  const baseEndpoint = (over: Partial<WebhookEndpointResponseDto> = {}): WebhookEndpointResponseDto => ({
    id: '11111111-1111-1111-1111-111111111111',
    scopeKey: 'app',
    name: 'Alpha',
    url: 'https://example.com/hook',
    httpMethod: WebhookHttpMethod.POST,
    subscribedEvents: ['ticket.created'],
    enabled: true,
    authType: WebhookAuthType.NONE,
    hasAuthValue: false,
    consecutiveFailures: 0,
    createdAt: '2024-01-02T00:00:00Z',
    updatedAt: '2024-01-02T00:00:00Z',
    ...over,
  });

  it('returns initial state for unknown action', () => {
    expect(adminWebhooksReducer(undefined, { type: 'UNKNOWN' } as never)).toEqual(initialAdminWebhooksState);
  });

  it('handles load lifecycle', () => {
    const seeded = { ...initialAdminWebhooksState, endpoints: [baseEndpoint({ id: 'seed' })] };
    let state = adminWebhooksReducer(seeded, loadAdminWebhooks());

    expect(state.loading).toBe(true);
    expect(state.endpoints).toEqual([]);

    const endpoints = [baseEndpoint({ id: 'b', name: 'Beta' }), baseEndpoint({ id: 'a', name: 'Alpha' })];

    state = adminWebhooksReducer(state, loadAdminWebhooksSuccess({ endpoints }));
    expect(state.loading).toBe(false);
    expect(state.endpoints.map((item) => item.id)).toEqual(['a', 'b']);
    state = adminWebhooksReducer(state, loadAdminWebhooksFailure({ error: 'failed' }));
    expect(state.loading).toBe(false);
    expect(state.error).toBe('failed');
  });

  it('stores accumulated endpoints during batch load', () => {
    const accumulated = [baseEndpoint({ id: '1' }), baseEndpoint({ id: '2' })];
    const state = adminWebhooksReducer(
      initialAdminWebhooksState,
      loadAdminWebhooksBatch({ offset: 10, accumulatedEndpoints: accumulated }),
    );

    expect(state.endpoints).toEqual(accumulated);
    expect(state.loading).toBe(true);
  });

  it('stores signing secret on create success', () => {
    const endpoint = baseEndpoint({ signingSecret: 'secret-value' });
    let state = adminWebhooksReducer(initialAdminWebhooksState, createAdminWebhook({ dto: {} as never }));

    expect(state.saving).toBe(true);
    state = adminWebhooksReducer(state, createAdminWebhookSuccess({ endpoint }));
    expect(state.saving).toBe(false);
    expect(state.lastCreatedSigningSecret).toBe('secret-value');
    state = adminWebhooksReducer(state, clearAdminWebhookCreatedSigningSecret());
    expect(state.lastCreatedSigningSecret).toBeNull();
  });

  it('updates and deletes endpoints', () => {
    const endpoint = baseEndpoint();
    let state = adminWebhooksReducer(
      { ...initialAdminWebhooksState, endpoints: [endpoint] },
      deleteAdminWebhook({ id: endpoint.id }),
    );

    expect(state.deleting).toBe(true);
    state = adminWebhooksReducer(state, deleteAdminWebhookSuccess({ id: endpoint.id }));
    expect(state.deleting).toBe(false);
    expect(state.endpoints).toEqual([]);
    state = adminWebhooksReducer({ ...state, deleting: true }, deleteAdminWebhookFailure({ error: 'denied' }));
    expect(state.deleting).toBe(false);
    expect(state.error).toBe('denied');
  });

  it('tracks test delivery result', () => {
    const delivery = {
      id: '22222222-2222-2222-2222-222222222222',
      endpointId: '11111111-1111-1111-1111-111111111111',
      eventId: 'evt-1',
      eventType: 'ticket.created',
      payload: {},
      success: true,
      attempt: 1,
      createdAt: '2024-01-01T00:00:00Z',
    };
    let state = adminWebhooksReducer(initialAdminWebhooksState, testAdminWebhook({ id: delivery.endpointId }));

    expect(state.testing).toBe(true);
    state = adminWebhooksReducer(state, testAdminWebhookSuccess({ delivery }));
    expect(state.testing).toBe(false);
    expect(state.lastTestDelivery).toEqual(delivery);
  });

  it('replaces endpoint on update success', () => {
    const endpoint = baseEndpoint({ name: 'Old' });
    let state = adminWebhooksReducer(
      { ...initialAdminWebhooksState, endpoints: [endpoint], saving: true },
      updateAdminWebhookSuccess({ endpoint: { ...endpoint, name: 'New' } }),
    );

    expect(state.saving).toBe(false);
    expect(state.endpoints[0].name).toBe('New');
    state = adminWebhooksReducer(state, updateAdminWebhookFailure({ error: 'bad request' }));
    expect(state.saving).toBe(false);
    expect(state.error).toBe('bad request');
  });

  it('clears error', () => {
    const state = adminWebhooksReducer({ ...initialAdminWebhooksState, error: 'x' }, clearAdminWebhooksError());

    expect(state.error).toBeNull();
  });
});
