import { randomUUID } from 'crypto';

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Queue } from 'bullmq';
import { enqueueUnitJob } from '@forepath/shared/backend/util-queue';
import { EmailService } from '@forepath/shared/backend/util-email';

import {
  EMAIL_DELIVER_JOB_NAME,
  EMAIL_DELIVER_MAX_ATTEMPTS,
  NOTIFICATIONS_MODULE_OPTIONS,
} from '../constants/notification.constants';
import type { EmailDeliverJobPayload, EmailPublishContext } from '../interfaces/notification.interfaces';
import type { NotificationsModuleOptions } from '../interfaces/notifications-module.options';

@Injectable()
export class EmailNotificationDispatcherService {
  private readonly logger = new Logger(EmailNotificationDispatcherService.name);

  constructor(
    @Inject(NOTIFICATIONS_MODULE_OPTIONS) private readonly options: NotificationsModuleOptions,
    private readonly queue: Queue,
    @Optional() private readonly emailService?: EmailService,
  ) {}

  async publish(context: EmailPublishContext): Promise<void> {
    if (!this.options.email) {
      this.logger.debug(`Email channel not configured; skipping ${context.eventType}`);

      return;
    }

    if (this.emailService && !this.emailService.isEnabled()) {
      this.logger.debug(`SMTP disabled; skipping email ${context.eventType} to ${context.to}`);

      return;
    }

    const eventId = context.correlationId ?? randomUUID();
    const payload: EmailDeliverJobPayload = {
      eventId,
      eventType: context.eventType,
      scopeKey: context.scopeKey,
      to: context.to,
      templateKey: context.templateKey,
      templateContext: context.templateContext,
      attachments: context.attachments,
      attempt: 1,
    };

    await enqueueUnitJob({
      queue: this.queue,
      jobName: EMAIL_DELIVER_JOB_NAME,
      payload,
      jobIdNamespace: 'email',
      jobIdParts: [payload.eventId, payload.templateKey, payload.to],
      opts: { attempts: EMAIL_DELIVER_MAX_ATTEMPTS },
    });
  }

  publishFireAndForget(context: EmailPublishContext): void {
    void this.publish(context).catch((error: Error) => {
      this.logger.warn(`Failed to enqueue email ${context.eventType}: ${error.message}`);
    });
  }
}
