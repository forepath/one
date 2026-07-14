import type { Job } from 'bullmq';

import { WEBHOOK_DELIVER_MAX_ATTEMPTS } from '../constants/notification.constants';
import type { WebhookDeliverJobPayload } from '../interfaces/notification.interfaces';

export function resolveWebhookDeliverJobPayload(job: Job<WebhookDeliverJobPayload>): WebhookDeliverJobPayload {
  return {
    ...job.data,
    attempt: job.attemptsMade + 1,
    maxAttempts: job.opts.attempts ?? WEBHOOK_DELIVER_MAX_ATTEMPTS,
  };
}
