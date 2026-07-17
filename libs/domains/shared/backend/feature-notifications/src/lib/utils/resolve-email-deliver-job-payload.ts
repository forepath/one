import type { Job } from 'bullmq';

import { EMAIL_DELIVER_MAX_ATTEMPTS } from '../constants/notification.constants';
import type { EmailDeliverJobPayload } from '../interfaces/notification.interfaces';

export function resolveEmailDeliverJobPayload(job: Job<EmailDeliverJobPayload>): EmailDeliverJobPayload {
  return {
    ...job.data,
    attempt: job.attemptsMade + 1,
    maxAttempts: job.opts.attempts ?? EMAIL_DELIVER_MAX_ATTEMPTS,
  };
}
