import { of, throwError } from 'rxjs';

import { WebhookEndpointsService } from '../../services/webhook-endpoints.service';
import {
  WebhookAuthType,
  WebhookHttpMethod,
  type WebhookEndpointResponseDto,
} from '../../types/webhook-endpoint.types';

import {
  loadAdminWebhookDeliveries,
  loadAdminWebhookDeliveriesBatch,
  loadAdminWebhookDeliveriesFailure,
  loadAdminWebhookDeliveriesSuccess,
  loadAdminWebhooks,
  loadAdminWebhooksBatch,
  loadAdminWebhooksFailure,
  loadAdminWebhooksSuccess,
} from './admin-webhooks.actions';
import {
  loadAdminWebhookDeliveries$,
  loadAdminWebhookDeliveriesBatch$,
  loadAdminWebhooks$,
  loadAdminWebhooksBatch$,
} from './admin-webhooks.effects';

describe('AdminWebhooksEffects', () => {
  const mockEndpoint = (id: string): WebhookEndpointResponseDto => ({
    id,
    scopeKey: 'app',
    name: `Webhook ${id}`,
    url: 'https://example.com/hook',
    httpMethod: WebhookHttpMethod.POST,
    subscribedEvents: ['ticket.created'],
    enabled: true,
    authType: WebhookAuthType.NONE,
    hasAuthValue: false,
    consecutiveFailures: 0,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  });

  describe('loadAdminWebhooks$', () => {
    it('dispatches success with empty list when API returns no rows', (done) => {
      const svc = { list: jest.fn().mockReturnValue(of([])) } as unknown as WebhookEndpointsService;

      loadAdminWebhooks$(of(loadAdminWebhooks()), svc).subscribe((result) => {
        expect(result).toEqual(loadAdminWebhooksSuccess({ endpoints: [] }));
        expect(svc.list).toHaveBeenCalledWith({ limit: 10, offset: 0 });
        done();
      });
    });

    it('dispatches batch when first page is full', (done) => {
      const endpoints = Array.from({ length: 10 }, (_, index) => mockEndpoint(`id-${index}`));
      const svc = { list: jest.fn().mockReturnValue(of(endpoints)) } as unknown as WebhookEndpointsService;

      loadAdminWebhooks$(of(loadAdminWebhooks()), svc).subscribe((result) => {
        expect(result).toEqual(loadAdminWebhooksBatch({ offset: 10, accumulatedEndpoints: endpoints }));
        done();
      });
    });

    it('dispatches failure on error', (done) => {
      const svc = {
        list: jest.fn().mockReturnValue(throwError(() => new Error('network'))),
      } as unknown as WebhookEndpointsService;

      loadAdminWebhooks$(of(loadAdminWebhooks()), svc).subscribe((result) => {
        expect(result).toEqual(loadAdminWebhooksFailure({ error: 'network' }));
        done();
      });
    });
  });

  describe('loadAdminWebhooksBatch$', () => {
    it('dispatches success when next page is partial', (done) => {
      const accumulated = Array.from({ length: 10 }, (_, index) => mockEndpoint(`a-${index}`));
      const page = [mockEndpoint('b')];
      const svc = { list: jest.fn().mockReturnValue(of(page)) } as unknown as WebhookEndpointsService;

      loadAdminWebhooksBatch$(
        of(loadAdminWebhooksBatch({ offset: 10, accumulatedEndpoints: accumulated })),
        svc,
      ).subscribe((result) => {
        expect(result).toEqual(loadAdminWebhooksSuccess({ endpoints: [...accumulated, ...page] }));
        done();
      });
    });
  });

  describe('loadAdminWebhookDeliveries$', () => {
    it('dispatches success for empty deliveries', (done) => {
      const svc = {
        listDeliveries: jest.fn().mockReturnValue(of({ items: [], total: 0 })),
      } as unknown as WebhookEndpointsService;

      loadAdminWebhookDeliveries$(of(loadAdminWebhookDeliveries({ id: 'endpoint-1' })), svc).subscribe((result) => {
        expect(result).toEqual(
          loadAdminWebhookDeliveriesSuccess({ endpointId: 'endpoint-1', deliveries: [], total: 0 }),
        );
        done();
      });
    });

    it('dispatches failure on error', (done) => {
      const svc = {
        listDeliveries: jest.fn().mockReturnValue(throwError(() => new Error('failed'))),
      } as unknown as WebhookEndpointsService;

      loadAdminWebhookDeliveries$(of(loadAdminWebhookDeliveries({ id: 'endpoint-1' })), svc).subscribe((result) => {
        expect(result).toEqual(loadAdminWebhookDeliveriesFailure({ error: 'failed' }));
        done();
      });
    });
  });

  describe('loadAdminWebhookDeliveriesBatch$', () => {
    it('dispatches success when accumulated deliveries reach total', (done) => {
      const accumulated = [
        {
          id: 'd1',
          endpointId: 'endpoint-1',
          eventId: 'e1',
          eventType: 'x',
          payload: {},
          success: true,
          attempt: 1,
          createdAt: '2024-01-01T00:00:00Z',
        },
      ];
      const svc = {
        listDeliveries: jest.fn().mockReturnValue(of({ items: [], total: 1 })),
      } as unknown as WebhookEndpointsService;

      loadAdminWebhookDeliveriesBatch$(
        of(
          loadAdminWebhookDeliveriesBatch({
            id: 'endpoint-1',
            offset: 10,
            accumulatedDeliveries: accumulated,
            total: 1,
          }),
        ),
        svc,
      ).subscribe((result) => {
        expect(result).toEqual(
          loadAdminWebhookDeliveriesSuccess({ endpointId: 'endpoint-1', deliveries: accumulated, total: 1 }),
        );
        done();
      });
    });
  });
});
