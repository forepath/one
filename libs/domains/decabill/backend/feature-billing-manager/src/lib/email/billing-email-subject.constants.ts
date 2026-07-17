import type { EmailSubjectRegistry } from '@forepath/shared/backend/util-email';

function asString(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '');
}

export const BILLING_EMAIL_SUBJECTS: EmailSubjectRegistry = {
  'invoice-issued': (ctx) => `Your invoice ${asString(ctx.invoiceNumber)} is ready`,
  'invoice-voided': (ctx) => `Credit note ${asString(ctx.creditNoteNumber)} for invoice ${asString(ctx.invoiceNumber)}`,
  'invoice-partial-credit': (ctx) =>
    `Credit note ${asString(ctx.creditNoteNumber)} for invoice ${asString(ctx.invoiceNumber)}`,
  'subscription-renewal-reminder': (ctx) => `Upcoming subscription renewal: ${asString(ctx.planName)}`,
  'withdrawal-confirmation': 'Confirm your statutory withdrawal',
  'payment-succeeded': (ctx) => `Payment received for invoice ${asString(ctx.invoiceNumber)}`,
  'payment-failed': (ctx) => `Payment failed for invoice ${asString(ctx.invoiceNumber)}`,
  'subscription-canceled': (ctx) => `Subscription canceled: ${asString(ctx.planName)}`,
};

export const BILLING_EMAIL_EVENTS = [
  'invoice.issued',
  'invoice.voided',
  'invoice.partial_credit_issued',
  'subscription.renewal_reminder',
  'withdrawal.confirmation_requested',
  'payment.succeeded',
  'payment.failed',
  'subscription.canceled',
] as const;

export type BillingEmailEventType = (typeof BILLING_EMAIL_EVENTS)[number];
