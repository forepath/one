import { buildCoordinatorJobId } from '@forepath/shared/backend';

/** Central registry for billing-manager BullMQ queues, job names, and coordinator schedules. */

export const BILLING_QUEUE_NAME = 'billing';

export const BillingJobName = {
  SUBSCRIPTION_BILLING_COORDINATOR: 'subscription-billing.coordinator',
  SUBSCRIPTION_BILLING_UNIT: 'subscription-billing.unit',
  SUBSCRIPTION_EXPIRATION_COORDINATOR: 'subscription-expiration.coordinator',
  SUBSCRIPTION_EXPIRATION_UNIT: 'subscription-expiration.unit',
  INVOICE_SYNC_COORDINATOR: 'invoice-sync.coordinator',
  INVOICE_SYNC_UNIT: 'invoice-sync.unit',
  OPEN_POSITION_INVOICE_COORDINATOR: 'open-position-invoice.coordinator',
  OPEN_POSITION_INVOICE_UNIT: 'open-position-invoice.unit',
  RENEWAL_REMINDER_COORDINATOR: 'renewal-reminder.coordinator',
  RENEWAL_REMINDER_UNIT: 'renewal-reminder.unit',
  SUBSCRIPTION_ITEM_UPDATE_COORDINATOR: 'subscription-item-update.coordinator',
  SUBSCRIPTION_ITEM_UPDATE_UNIT: 'subscription-item-update.unit',
  BACKORDER_RETRY_COORDINATOR: 'backorder-retry.coordinator',
  BACKORDER_RETRY_UNIT: 'backorder-retry.unit',
} as const;

export type BillingJobName = (typeof BillingJobName)[keyof typeof BillingJobName];

export interface BillingRepeatableJobDefinition {
  name: BillingJobName;
  coordinatorJobId: string;
  everyMs: number;
}

function parseIntervalMs(envKey: string, fallback: number): number {
  const parsed = parseInt(process.env[envKey] ?? String(fallback), 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Repeatable coordinator jobs registered on scheduler role startup. */
export function getBillingRepeatableJobs(): BillingRepeatableJobDefinition[] {
  return [
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
      name: BillingJobName.INVOICE_SYNC_COORDINATOR,
      coordinatorJobId: buildCoordinatorJobId('invoice-sync'),
      everyMs: parseIntervalMs('INVOICE_SYNC_SCHEDULER_INTERVAL', 60_000),
    },
    {
      name: BillingJobName.OPEN_POSITION_INVOICE_COORDINATOR,
      coordinatorJobId: buildCoordinatorJobId('open-position-invoice'),
      everyMs: parseIntervalMs('OPEN_POSITION_INVOICE_SCHEDULER_INTERVAL', 86_400_000),
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
  ];
}
