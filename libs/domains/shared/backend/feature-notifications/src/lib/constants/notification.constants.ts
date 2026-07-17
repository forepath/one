export const WEBHOOK_DELIVER_JOB_NAME = 'webhook-deliver';

export const WEBHOOK_DELIVERY_RETENTION_COORDINATOR = 'webhook-delivery-retention.coordinator';

export const WEBHOOK_DELIVER_MAX_ATTEMPTS = 3;

export const EMAIL_DELIVER_JOB_NAME = 'email-deliver';

export const EMAIL_DELIVER_MAX_ATTEMPTS = 3;

export const NOTIFICATIONS_API_VERSION = '2026-07';

export const INSTANCE_SCOPE_KEY = 'instance';

export const WEBHOOK_CONSECUTIVE_FAILURE_DISABLE_THRESHOLD = 10;

export const EMAIL_ATTACHMENT_RESOLVER = Symbol('EMAIL_ATTACHMENT_RESOLVER');

export const WEBHOOK_THROTTLED_EVENT_TYPES = ['chat_message.created'] as const;

export function getWebhookChatThrottleMs(): number {
  const parsed = Number.parseInt(process.env.WEBHOOK_CHAT_THROTTLE_MS ?? '60000', 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60_000;
}

export function getWebhookDeliveryRetentionCoordinatorIntervalMs(): number {
  const parsed = Number.parseInt(process.env.WEBHOOK_DELIVERY_RETENTION_INTERVAL_MS ?? '3600000', 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3_600_000;
}

export const NOTIFICATIONS_MODULE_OPTIONS = Symbol('NOTIFICATIONS_MODULE_OPTIONS');
