import { randomUUID } from 'crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { enqueueUnitJob } from '@forepath/shared/backend';

import {
  NOTIFICATIONS_API_VERSION,
  NOTIFICATIONS_MODULE_OPTIONS,
  WEBHOOK_DELIVER_JOB_NAME,
  WEBHOOK_DELIVER_MAX_ATTEMPTS,
  WEBHOOK_THROTTLED_EVENT_TYPES,
  getWebhookChatThrottleMs,
} from '../constants/notification.constants';
import type {
  NotificationEventEnvelope,
  NotificationPublishContext,
  WebhookDeliverJobPayload,
} from '../interfaces/notification.interfaces';
import type { NotificationsModuleOptions } from '../interfaces/notifications-module.options';
import { WebhookEndpointsRepository } from '../repositories/webhook-endpoints.repository';

@Injectable()
export class NotificationDispatcherService {
  private readonly logger = new Logger(NotificationDispatcherService.name);

  constructor(
    private readonly endpointsRepository: WebhookEndpointsRepository,
    @Inject(NOTIFICATIONS_MODULE_OPTIONS) private readonly options: NotificationsModuleOptions,
    private readonly queue: Queue,
  ) {}

  async publish(context: NotificationPublishContext): Promise<void> {
    const endpoints = await this.endpointsRepository.findMatchingForDispatch(context.scopeKey, context.type);
    const matching = endpoints.filter((endpoint) => this.matchesClientFilter(endpoint.clientId, context.clientId));

    if (matching.length === 0) {
      return;
    }

    const envelope = this.buildEnvelope(context);

    await Promise.all(
      matching.map(async (endpoint) => {
        const payload: WebhookDeliverJobPayload = {
          endpointId: endpoint.id,
          eventId: envelope.id,
          eventType: context.type,
          scopeKey: context.scopeKey,
          clientId: context.clientId,
          envelope,
          attempt: 1,
        };

        await enqueueUnitJob({
          queue: this.queue,
          jobName: WEBHOOK_DELIVER_JOB_NAME,
          payload,
          jobIdNamespace: 'webhook',
          jobIdParts: this.buildJobIdParts(context, envelope.id, endpoint.id),
          opts: { attempts: WEBHOOK_DELIVER_MAX_ATTEMPTS },
        });
      }),
    );
  }

  buildEnvelope(context: NotificationPublishContext): NotificationEventEnvelope {
    const tenantId = this.options.scopeMode === 'tenant_id' ? context.scopeKey : null;

    return {
      id: randomUUID(),
      object: 'event',
      type: context.type,
      created: new Date().toISOString(),
      api_version: NOTIFICATIONS_API_VERSION,
      application: this.options.applicationId,
      tenant_id: tenantId,
      client_id: context.clientId ?? null,
      data: {
        object: context.data,
      },
    };
  }

  publishFireAndForget(context: NotificationPublishContext): void {
    void this.publish(context).catch((error: Error) => {
      this.logger.warn(`Failed to publish notification ${context.type}: ${error.message}`);
    });
  }

  private matchesClientFilter(endpointClientId: string | null | undefined, eventClientId: string | undefined): boolean {
    if (!endpointClientId) {
      return true;
    }

    return !!eventClientId && endpointClientId === eventClientId;
  }

  private buildJobIdParts(
    context: NotificationPublishContext,
    eventId: string,
    endpointId: string,
  ): Array<string | number | undefined> {
    if ((WEBHOOK_THROTTLED_EVENT_TYPES as readonly string[]).includes(context.type)) {
      const bucket = Math.floor(Date.now() / getWebhookChatThrottleMs());

      return [context.type, endpointId, context.clientId ?? 'global', bucket];
    }

    return [eventId, endpointId];
  }
}
