export interface WebhookDeliveryLogRetentionPolicy {
  retentionDays: number;
  maxEntries: number;
}

export interface WebhookDeliveryLogRetentionSource {
  deliveryLogRetentionDays?: number | null;
  deliveryLogMaxEntries?: number | null;
}

export function getDefaultWebhookDeliveryLogRetentionDays(): number {
  const parsed = Number.parseInt(process.env.WEBHOOK_DELIVERY_LOG_RETENTION_DAYS ?? '30', 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
}

export function getDefaultWebhookDeliveryLogMaxEntries(): number {
  const parsed = Number.parseInt(process.env.WEBHOOK_DELIVERY_LOG_MAX_ENTRIES ?? '500', 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 500;
}

export function resolveWebhookDeliveryLogRetentionPolicy(
  endpoint: WebhookDeliveryLogRetentionSource,
): WebhookDeliveryLogRetentionPolicy {
  return {
    retentionDays: endpoint.deliveryLogRetentionDays ?? getDefaultWebhookDeliveryLogRetentionDays(),
    maxEntries: endpoint.deliveryLogMaxEntries ?? getDefaultWebhookDeliveryLogMaxEntries(),
  };
}

export function resolveRetentionCutoff(retentionDays: number, now = Date.now()): Date {
  return new Date(now - retentionDays * 24 * 60 * 60 * 1000);
}
