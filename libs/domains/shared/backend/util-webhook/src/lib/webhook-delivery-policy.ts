import { BadRequestException } from '@nestjs/common';

import type { WebhookAuthConfig, WebhookHttpMethod } from './webhook.types';

/** Event types that must not be delivered via GET (payload would appear in query strings). */
export const WEBHOOK_SENSITIVE_EVENT_TYPES = new Set([
  'chat_message.created',
  'filter_rule.triggered',
  'user.created',
  'user.updated',
  'user.deleted',
  'client_user.created',
  'client_user.deleted',
  'ticket.created',
  'ticket.updated',
  'ticket.deleted',
  'ticket.comment.created',
  'payment.initiated',
  'payment.succeeded',
  'payment.failed',
  'invoice.created',
  'invoice.issued',
  'invoice.voided',
  'subscription.created',
  'subscription.updated',
  'subscription.canceled',
]);

export function isWebhookSensitiveEventType(eventType: string): boolean {
  return WEBHOOK_SENSITIVE_EVENT_TYPES.has(eventType);
}

export function assertWebhookEndpointDeliveryPolicy(params: {
  httpMethod: WebhookHttpMethod;
  auth: WebhookAuthConfig;
  subscribedEvents: string[];
}): void {
  if (params.auth.authType === 'query_param' && process.env.NODE_ENV === 'production') {
    throw new BadRequestException('Query parameter authentication is not allowed for webhooks in production');
  }

  if (params.httpMethod === 'GET') {
    const sensitiveEvents = params.subscribedEvents.filter((event) => isWebhookSensitiveEventType(event));

    if (sensitiveEvents.length > 0) {
      throw new BadRequestException(
        `GET webhooks cannot subscribe to sensitive event types: ${sensitiveEvents.join(', ')}`,
      );
    }
  }
}
