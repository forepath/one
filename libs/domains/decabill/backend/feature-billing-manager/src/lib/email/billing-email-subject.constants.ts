import type { EmailSubjectRegistry } from '@forepath/shared/backend/util-email';

function asString(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '');
}

export const BILLING_EMAIL_SUBJECTS: EmailSubjectRegistry = {
  'invoice-issued': (ctx) => `Your invoice ${asString(ctx.invoiceNumber)} is ready`,
  'offer-archived': (ctx) => `Your offer ${asString(ctx.offerNumber)} is ready`,
  'offer-accepted-confirmation': (ctx) => `Offer ${asString(ctx.offerNumber)} accepted`,
  'invoice-voided': (ctx) => `Credit note ${asString(ctx.creditNoteNumber)} for invoice ${asString(ctx.invoiceNumber)}`,
  'invoice-partial-credit': (ctx) =>
    `Credit note ${asString(ctx.creditNoteNumber)} for invoice ${asString(ctx.invoiceNumber)}`,
  'subscription-renewal-reminder': (ctx) =>
    ctx.billInAdvance === true
      ? `Upcoming subscription charge: ${asString(ctx.planName)}`
      : `Upcoming subscription renewal: ${asString(ctx.planName)}`,
  'withdrawal-confirmation': 'Confirm your statutory withdrawal',
  'payment-succeeded': (ctx) => `Payment received for invoice ${asString(ctx.invoiceNumber)}`,
  'payment-failed': (ctx) => `Payment failed for invoice ${asString(ctx.invoiceNumber)}`,
  'subscription-created': (ctx) => `Order confirmation: ${asString(ctx.planName)}`,
  'subscription-cancel-scheduled': (ctx) => `Cancellation scheduled: ${asString(ctx.planName)}`,
  'subscription-canceled': (ctx) => `Subscription ended: ${asString(ctx.planName)}`,
  'subscription-resumed': (ctx) => `Subscription resumed: ${asString(ctx.planName)}`,
  'subscription-withdrawn': (ctx) => `Withdrawal completed: ${asString(ctx.planName)}`,
  'subscription-config-change-requested': (ctx) => `Configuration change received: ${asString(ctx.planName)}`,
  'subscription-config-change-applied': (ctx) => `Configuration change applied: ${asString(ctx.planName)}`,
  'subscription-config-change-failed': (ctx) => `Configuration change failed: ${asString(ctx.planName)}`,
  'price-change': 'Your subscription prices have been updated',
  'addon-activated': (ctx) => `Addon activated: ${asString(ctx.addonName)}`,
  'addon-deactivated': (ctx) => `Addon deactivated: ${asString(ctx.addonName)}`,
  'addon-provision-failed': (ctx) => `Addon provisioning failed: ${asString(ctx.addonName)}`,
  'addon-teardown-failed': (ctx) => `Addon teardown failed: ${asString(ctx.addonName)}`,
  'ssh-access-granted': (ctx) => `SSH access key revealed: ${asString(ctx.planName)}`,
};

export const BILLING_EMAIL_EVENTS = [
  'invoice.issued',
  'offer.archived',
  'offer.accepted',
  'invoice.voided',
  'invoice.partial_credit_issued',
  'subscription.renewal_reminder',
  'withdrawal.confirmation_requested',
  'payment.succeeded',
  'payment.failed',
  'subscription.created',
  'subscription.cancel_scheduled',
  'subscription.canceled',
  'subscription.resumed',
  'subscription.withdrawn',
  'subscription.config_change_requested',
  'subscription.config_changed',
  'subscription.config_change_failed',
  'subscription.price_changed',
  'subscription.ssh_access_granted',
  'addon.activated',
  'addon.deactivated',
  'addon.provision_failed',
  'addon.teardown_failed',
] as const;

export type BillingEmailEventType = (typeof BILLING_EMAIL_EVENTS)[number];
