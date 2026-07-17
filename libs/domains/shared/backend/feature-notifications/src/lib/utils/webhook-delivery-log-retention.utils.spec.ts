import {
  getDefaultWebhookDeliveryLogMaxEntries,
  getDefaultWebhookDeliveryLogRetentionDays,
  resolveRetentionCutoff,
  resolveWebhookDeliveryLogRetentionPolicy,
} from './webhook-delivery-log-retention.utils';

describe('webhook-delivery-log-retention.utils', () => {
  const originalRetentionDays = process.env.WEBHOOK_DELIVERY_LOG_RETENTION_DAYS;
  const originalMaxEntries = process.env.WEBHOOK_DELIVERY_LOG_MAX_ENTRIES;

  afterEach(() => {
    if (originalRetentionDays === undefined) {
      delete process.env.WEBHOOK_DELIVERY_LOG_RETENTION_DAYS;
    } else {
      process.env.WEBHOOK_DELIVERY_LOG_RETENTION_DAYS = originalRetentionDays;
    }

    if (originalMaxEntries === undefined) {
      delete process.env.WEBHOOK_DELIVERY_LOG_MAX_ENTRIES;
    } else {
      process.env.WEBHOOK_DELIVERY_LOG_MAX_ENTRIES = originalMaxEntries;
    }
  });

  it('uses platform defaults when endpoint overrides are null', () => {
    delete process.env.WEBHOOK_DELIVERY_LOG_RETENTION_DAYS;
    delete process.env.WEBHOOK_DELIVERY_LOG_MAX_ENTRIES;

    expect(getDefaultWebhookDeliveryLogRetentionDays()).toBe(30);
    expect(getDefaultWebhookDeliveryLogMaxEntries()).toBe(500);
    expect(
      resolveWebhookDeliveryLogRetentionPolicy({
        deliveryLogRetentionDays: null,
        deliveryLogMaxEntries: null,
      }),
    ).toEqual({ retentionDays: 30, maxEntries: 500 });
  });

  it('respects endpoint-specific retention settings', () => {
    expect(
      resolveWebhookDeliveryLogRetentionPolicy({
        deliveryLogRetentionDays: 7,
        deliveryLogMaxEntries: 100,
      }),
    ).toEqual({ retentionDays: 7, maxEntries: 100 });
  });

  it('falls back when env values are invalid', () => {
    process.env.WEBHOOK_DELIVERY_LOG_RETENTION_DAYS = '0';
    process.env.WEBHOOK_DELIVERY_LOG_MAX_ENTRIES = 'invalid';

    expect(getDefaultWebhookDeliveryLogRetentionDays()).toBe(30);
    expect(getDefaultWebhookDeliveryLogMaxEntries()).toBe(500);
  });

  it('computes retention cutoff from days', () => {
    const now = Date.UTC(2026, 6, 15, 12, 0, 0);
    const cutoff = resolveRetentionCutoff(30, now);

    expect(cutoff.toISOString()).toBe('2026-06-15T12:00:00.000Z');
  });
});
