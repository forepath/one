import type { Job } from 'bullmq';

import { WEBHOOK_DELIVER_MAX_ATTEMPTS } from '../constants/notification.constants';
import type { WebhookDeliverJobPayload } from '../interfaces/notification.interfaces';

import { resolveWebhookDeliverJobPayload } from './resolve-webhook-deliver-job-payload';

describe('resolveWebhookDeliverJobPayload', () => {
  it('maps BullMQ attempt counters onto the delivery payload', () => {
    const payload: WebhookDeliverJobPayload = {
      endpointId: 'endpoint-1',
      eventId: 'event-1',
      eventType: 'invoice.issued',
      scopeKey: 'tenant-a',
      envelope: {
        id: 'event-1',
        object: 'event',
        type: 'invoice.issued',
        created: '2026-07-14T12:00:00.000Z',
        api_version: '2026-07',
        application: 'decabill',
        tenant_id: 'tenant-a',
        client_id: null,
        data: { object: {} },
      },
      attempt: 1,
    };

    const resolved = resolveWebhookDeliverJobPayload({
      data: payload,
      attemptsMade: 1,
      opts: { attempts: WEBHOOK_DELIVER_MAX_ATTEMPTS },
    } as Job<WebhookDeliverJobPayload>);

    expect(resolved.attempt).toBe(2);
    expect(resolved.maxAttempts).toBe(WEBHOOK_DELIVER_MAX_ATTEMPTS);
  });
});
