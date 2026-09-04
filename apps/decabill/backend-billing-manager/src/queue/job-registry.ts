import { AdminBillNowJobName, DatevExportJobName, VatIdValidationJobName } from '@forepath/decabill/backend';
import {
  buildCoordinatorJobId,
  envCronOrDefault,
  getWebhookDeliveryRetentionCoordinatorIntervalMs,
  UPDATE_CHECK_JOB_NAME,
  WEBHOOK_DELIVERY_RETENTION_COORDINATOR,
} from '@forepath/shared/backend';

/** Central registry for billing-manager BullMQ queues, job names, and coordinator schedules. */

export const BILLING_QUEUE_NAME = 'billing';

export const BillingJobName = {
  SUBSCRIPTION_BILLING_COORDINATOR: 'subscription-billing.coordinator',
  SUBSCRIPTION_BILLING_UNIT: 'subscription-billing.unit',
  SUBSCRIPTION_EXPIRATION_COORDINATOR: 'subscription-expiration.coordinator',
  SUBSCRIPTION_EXPIRATION_UNIT: 'subscription-expiration.unit',
  SUBSCRIPTION_WITHDRAWAL_COORDINATOR: 'subscription-withdrawal.coordinator',
  SUBSCRIPTION_WITHDRAWAL_UNIT: 'subscription-withdrawal.unit',
  SUBSCRIPTION_INSTANT_CANCEL_COORDINATOR: 'subscription-instant-cancel.coordinator',
  SUBSCRIPTION_INSTANT_CANCEL_UNIT: 'subscription-instant-cancel.unit',
  SUBSCRIPTION_PROVISIONING_COORDINATOR: 'subscription-provisioning.coordinator',
  SUBSCRIPTION_PROVISIONING_UNIT: 'subscription-provisioning.unit',
  SUBSCRIPTION_CONFIG_CHANGE_COORDINATOR: 'subscription-config-change.coordinator',
  SUBSCRIPTION_CONFIG_CHANGE_UNIT: 'subscription-config-change.unit',
  INVOICE_OVERDUE_COORDINATOR: 'invoice-overdue.coordinator',
  INVOICE_OVERDUE_UNIT: 'invoice-overdue.unit',
  OPEN_POSITION_INVOICE_COORDINATOR: 'open-position-invoice.coordinator',
  OPEN_POSITION_INVOICE_UNIT: 'open-position-invoice.unit',
  INVOICE_AUTO_PAYMENT_COORDINATOR: 'invoice-auto-payment.coordinator',
  INVOICE_AUTO_PAYMENT_UNIT: 'invoice-auto-payment.unit',
  RENEWAL_REMINDER_COORDINATOR: 'renewal-reminder.coordinator',
  RENEWAL_REMINDER_UNIT: 'renewal-reminder.unit',
  SUBSCRIPTION_ITEM_UPDATE_COORDINATOR: 'subscription-item-update.coordinator',
  SUBSCRIPTION_ITEM_UPDATE_UNIT: 'subscription-item-update.unit',
  BACKORDER_RETRY_COORDINATOR: 'backorder-retry.coordinator',
  BACKORDER_RETRY_UNIT: 'backorder-retry.unit',
  ADMIN_BILL_NOW_COORDINATOR: AdminBillNowJobName.COORDINATOR,
  ADMIN_BILL_NOW_UNIT: AdminBillNowJobName.UNIT,
  DATEV_EXPORT_COORDINATOR: DatevExportJobName.COORDINATOR,
  DATEV_EXPORT_UNIT: DatevExportJobName.UNIT,
  PRICE_RECALC_COORDINATOR: 'price-recalc.coordinator',
  PRICE_RECALC_UNIT: 'price-recalc.unit',
  PLAN_PRICE_MIGRATE_UNIT: 'plan-price-migrate.unit',
  METER_COLLECT_COORDINATOR: 'meter-collect.coordinator',
  METER_COLLECT_UNIT: 'meter-collect.unit',
  CONTRIBUTOR_COLLECT_COORDINATOR: 'contributor-collect.coordinator',
  CONTRIBUTOR_COLLECT_UNIT: 'contributor-collect.unit',
  VAT_ID_VALIDATION_UNIT: VatIdValidationJobName.UNIT,
  WEBHOOK_DELIVERY_RETENTION_COORDINATOR,
  UPDATE_CHECK: UPDATE_CHECK_JOB_NAME,
  SEARCH_REINDEX_COORDINATOR: 'search-reindex.coordinator',
  SEARCH_REINDEX_UNIT: 'search-reindex.unit',
  SEARCH_INDEX_SYNC_UNIT: 'search-index-sync.unit',
  OFFER_EXPIRATION_COORDINATOR: 'offer-expiration.coordinator',
  OFFER_EXPIRATION_UNIT: 'offer-expiration.unit',
  OFFER_FULFILLMENT_COORDINATOR: 'offer-fulfillment.coordinator',
  OFFER_FULFILLMENT_UNIT: 'offer-fulfillment.unit',
} as const;

export type BillingJobName = (typeof BillingJobName)[keyof typeof BillingJobName];

export interface BillingRepeatableJobDefinition {
  name: BillingJobName;
  coordinatorJobId: string;
  everyMs?: number;
  pattern?: string;
  tz?: string;
}

function parseIntervalMs(envKey: string, fallback: number): number {
  const raw = process.env[envKey]?.trim();

  if (!raw) {
    return fallback;
  }

  const normalized = raw.toLowerCase();
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/.exec(normalized);

  if (!match) {
    const parsed = parseInt(raw, 10);

    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  const value = parseFloat(match[1]);
  const unit = match[2] ?? 'ms';

  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  switch (unit) {
    case 'ms':
      return Math.trunc(value);
    case 's':
      return Math.trunc(value * 1000);
    case 'm':
      return Math.trunc(value * 60_000);
    case 'h':
      return Math.trunc(value * 3_600_000);
    case 'd':
      return Math.trunc(value * 86_400_000);
    default:
      return fallback;
  }
}

function parseBooleanEnv(envKey: string, fallback: boolean): boolean {
  const raw = process.env[envKey];

  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();

  if (normalized === 'true' || normalized === '1') {
    return true;
  }

  if (normalized === 'false' || normalized === '0') {
    return false;
  }

  return fallback;
}

/** Repeatable coordinator jobs registered on scheduler role startup. */
export function getBillingRepeatableJobs(): BillingRepeatableJobDefinition[] {
  const jobs: BillingRepeatableJobDefinition[] = [
    {
      name: BillingJobName.SUBSCRIPTION_BILLING_COORDINATOR,
      coordinatorJobId: buildCoordinatorJobId('subscription-billing'),
      everyMs: parseIntervalMs('BILLING_SCHEDULER_INTERVAL', 60_000),
    },
    {
      name: BillingJobName.SUBSCRIPTION_EXPIRATION_COORDINATOR,
      coordinatorJobId: buildCoordinatorJobId('subscription-expiration'),
      everyMs: parseIntervalMs('EXPIRATION_SCHEDULER_INTERVAL', 60_000),
    },
    {
      name: BillingJobName.SUBSCRIPTION_WITHDRAWAL_COORDINATOR,
      coordinatorJobId: buildCoordinatorJobId('subscription-withdrawal'),
      everyMs: parseIntervalMs('WITHDRAWAL_SCHEDULER_INTERVAL', 60_000),
    },
    {
      name: BillingJobName.SUBSCRIPTION_INSTANT_CANCEL_COORDINATOR,
      coordinatorJobId: buildCoordinatorJobId('subscription-instant-cancel'),
      everyMs: parseIntervalMs('INSTANT_CANCEL_SCHEDULER_INTERVAL', 60_000),
    },
    {
      name: BillingJobName.SUBSCRIPTION_PROVISIONING_COORDINATOR,
      coordinatorJobId: buildCoordinatorJobId('subscription-provisioning'),
      everyMs: parseIntervalMs('PROVISIONING_SCHEDULER_INTERVAL', 30_000),
    },
    {
      name: BillingJobName.SUBSCRIPTION_CONFIG_CHANGE_COORDINATOR,
      coordinatorJobId: buildCoordinatorJobId('subscription-config-change'),
      everyMs: parseIntervalMs('CONFIG_CHANGE_SCHEDULER_INTERVAL', 30_000),
    },
    {
      name: BillingJobName.INVOICE_OVERDUE_COORDINATOR,
      coordinatorJobId: buildCoordinatorJobId('invoice-overdue'),
      everyMs: parseIntervalMs('INVOICE_OVERDUE_SCHEDULER_INTERVAL', 86_400_000),
    },
    {
      name: BillingJobName.OPEN_POSITION_INVOICE_COORDINATOR,
      coordinatorJobId: buildCoordinatorJobId('open-position-invoice'),
      everyMs: parseIntervalMs('OPEN_POSITION_INVOICE_SCHEDULER_INTERVAL', 86_400_000),
    },
    {
      name: BillingJobName.INVOICE_AUTO_PAYMENT_COORDINATOR,
      coordinatorJobId: buildCoordinatorJobId('invoice-auto-payment'),
      everyMs: parseIntervalMs('INVOICE_AUTO_PAYMENT_SCHEDULER_INTERVAL', 60_000),
    },
    {
      name: BillingJobName.RENEWAL_REMINDER_COORDINATOR,
      coordinatorJobId: buildCoordinatorJobId('renewal-reminder'),
      everyMs: parseIntervalMs('REMINDER_SCHEDULER_INTERVAL', 3_600_000),
    },
    {
      name: BillingJobName.SUBSCRIPTION_ITEM_UPDATE_COORDINATOR,
      coordinatorJobId: buildCoordinatorJobId('subscription-item-update'),
      everyMs: parseIntervalMs('SUBSCRIPTION_UPDATE_SCHEDULER_INTERVAL', 86_400_000),
    },
    {
      name: BillingJobName.BACKORDER_RETRY_COORDINATOR,
      coordinatorJobId: buildCoordinatorJobId('backorder-retry'),
      everyMs: parseIntervalMs('BACKORDER_RETRY_INTERVAL_MS', 60_000),
    },
    {
      name: BillingJobName.WEBHOOK_DELIVERY_RETENTION_COORDINATOR,
      coordinatorJobId: buildCoordinatorJobId('webhook-delivery-retention'),
      everyMs: getWebhookDeliveryRetentionCoordinatorIntervalMs(),
    },
  ];

  if (parseBooleanEnv('BILLING_DATEV_EXPORT_ENABLED', true)) {
    jobs.push({
      name: BillingJobName.DATEV_EXPORT_COORDINATOR,
      coordinatorJobId: buildCoordinatorJobId('datev-export'),
      pattern: envCronOrDefault('BILLING_DATEV_EXPORT_CRON', '0 0 1 * *'),
      tz: process.env.BILLING_DATEV_EXPORT_TIMEZONE ?? 'Europe/Berlin',
    });
  }

  if (parseBooleanEnv('BILLING_PRICE_RECALC_ENABLED', true)) {
    jobs.push({
      name: BillingJobName.PRICE_RECALC_COORDINATOR,
      coordinatorJobId: buildCoordinatorJobId('price-recalc'),
      pattern: envCronOrDefault('BILLING_PRICE_RECALC_CRON', '0 0 * * *'),
      tz: process.env.BILLING_PRICE_RECALC_TIMEZONE ?? 'Europe/Berlin',
    });
  }

  if (parseBooleanEnv('BILLING_METER_COLLECT_ENABLED', true)) {
    jobs.push({
      name: BillingJobName.METER_COLLECT_COORDINATOR,
      coordinatorJobId: buildCoordinatorJobId('meter-collect'),
      everyMs: parseIntervalMs('BILLING_METER_COLLECT_INTERVAL', 60_000),
    });
  }

  if (parseBooleanEnv('BILLING_CONTRIBUTOR_COLLECT_ENABLED', true)) {
    jobs.push({
      name: BillingJobName.CONTRIBUTOR_COLLECT_COORDINATOR,
      coordinatorJobId: buildCoordinatorJobId('contributor-collect'),
      everyMs: parseIntervalMs('BILLING_CONTRIBUTOR_COLLECT_INTERVAL', 30_000),
    });
  }

  jobs.push({
    name: BillingJobName.UPDATE_CHECK,
    coordinatorJobId: buildCoordinatorJobId('update-check'),
    pattern: envCronOrDefault('UPDATE_CHECK_CRON', '0 0 * * *'),
    tz: process.env.UPDATE_CHECK_TIMEZONE ?? 'Europe/Berlin',
  });

  jobs.push({
    name: BillingJobName.SEARCH_REINDEX_COORDINATOR,
    coordinatorJobId: buildCoordinatorJobId('search-reindex'),
    everyMs: parseIntervalMs('SEARCH_REINDEX_INTERVAL', 900_000),
  });

  jobs.push({
    name: BillingJobName.OFFER_EXPIRATION_COORDINATOR,
    coordinatorJobId: buildCoordinatorJobId('offer-expiration'),
    everyMs: parseIntervalMs('OFFER_EXPIRATION_SCHEDULER_INTERVAL', 3_600_000),
  });

  jobs.push({
    name: BillingJobName.OFFER_FULFILLMENT_COORDINATOR,
    coordinatorJobId: buildCoordinatorJobId('offer-fulfillment'),
    everyMs: parseIntervalMs('OFFER_FULFILLMENT_SCHEDULER_INTERVAL', 60_000),
  });

  return jobs;
}
