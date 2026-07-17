import type { Job } from 'bullmq';

import { EMAIL_DELIVER_MAX_ATTEMPTS } from '../constants/notification.constants';
import type { EmailDeliverJobPayload } from '../interfaces/notification.interfaces';
import { resolveEmailDeliverJobPayload } from './resolve-email-deliver-job-payload';

describe('resolveEmailDeliverJobPayload', () => {
  it('maps BullMQ attemptsMade to 1-based attempt', () => {
    const payload = resolveEmailDeliverJobPayload({
      data: {
        eventId: 'e1',
        eventType: 'invoice.issued',
        scopeKey: 'default',
        to: 'a@example.com',
        templateKey: 'invoice-issued',
        templateContext: {},
        attempt: 1,
      },
      attemptsMade: 1,
      opts: { attempts: 3 },
    } as Job<EmailDeliverJobPayload>);

    expect(payload.attempt).toBe(2);
    expect(payload.maxAttempts).toBe(3);
  });

  it('falls back to EMAIL_DELIVER_MAX_ATTEMPTS', () => {
    const payload = resolveEmailDeliverJobPayload({
      data: {
        eventId: 'e1',
        eventType: 'invoice.issued',
        scopeKey: 'default',
        to: 'a@example.com',
        templateKey: 'invoice-issued',
        templateContext: {},
        attempt: 1,
      },
      attemptsMade: 0,
      opts: {},
    } as Job<EmailDeliverJobPayload>);

    expect(payload.maxAttempts).toBe(EMAIL_DELIVER_MAX_ATTEMPTS);
  });
});
