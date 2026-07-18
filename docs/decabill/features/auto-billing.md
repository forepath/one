# Auto-Billing

Per-customer-profile automatic invoice payment with multi-processor support.

## Overview

Customers can enable auto-billing on their profile after attaching a default payment method. When auto-billing is enabled, newly issued invoices are charged off-session. Manual Checkout payment is blocked while an auto-payment is **in progress** or **retrying** (not while merely scheduled). Disabling auto-billing cancels scheduled/retrying auto-pay; in-flight (`in_progress`) charges are left alone so a second Checkout cannot race the Stripe PaymentIntent.

## Payment processor capability

Processors implement:

- `supportsAutoPayment()` — marker; Stripe returns `true`
- `createSetupSession(...)` — hosted setup for collecting a default payment method
- `chargeOffSession(...)` — off-session charge against the stored method
- Webhook mapping for setup completion and PaymentIntent outcomes

Dynamic processors that do not support auto-pay must return `supportsAutoPayment(): false`. Enable APIs reject with a clear error when the default processor lacks the capability.

## Customer profile fields

| Field                            | Purpose                       |
| -------------------------------- | ----------------------------- |
| `autoBillingEnabled`             | Toggle                        |
| `defaultPaymentMethodExternalId` | Processor payment method id   |
| `stripeCustomerId`               | Existing Stripe customer link |

## Setup and enable flow

1. Customer profile must be **complete** (same required fields as ordering/invoicing)
2. `POST /customer-profile/auto-billing/setup` → hosted setup URL
3. Customer completes setup and returns to `/subscriptions?profile=true&autoBilling=setup_success`; the UI shows a waiting message until the inbound webhook stores the default payment method and emits `payment_method.attached` (local Stripe CLI forwarding required for that step)
4. `POST /customer-profile/auto-billing/enable` (requires complete profile + PM on file)
5. Open invoices are scheduled for auto-pay; new issues are scheduled on issuance

Admin mirrors: `/admin/billing/customer-profiles/{id}/auto-billing/*`

If auto-billing stays enabled but the profile later becomes incomplete, scheduled jobs defer charging by setting a future `autoPaymentNextRetryAt` (default 15 minutes via `BILLING_AUTO_PAYMENT_PENDING_SAFETY_DELAY_MS`) until the profile is complete again.

Checkout payments also set `setup_future_usage=off_session` so successful Checkout can update the default payment method even when auto-billing is off.

## Invoice auto-payment lifecycle

| Status                                                        | Manual `canPay`                |
| ------------------------------------------------------------- | ------------------------------ |
| `in_progress` / `retrying`                                    | Blocked                        |
| `scheduled` / `exhausted` / `canceled` / `idle` / `succeeded` | Allowed when otherwise payable |

**Retries:** max 3 attempts — immediate, then +1 day, then +3 days (`BILLING_AUTO_PAYMENT_RETRY_DELAY_1_MS`, `BILLING_AUTO_PAYMENT_RETRY_DELAY_2_MS`). Pending / SCA off-session results stay `in_progress` with a safety `autoPaymentNextRetryAt` (`BILLING_AUTO_PAYMENT_PENDING_SAFETY_DELAY_MS`, default 15 minutes); after that window the coordinator releases them to `retrying`. After exhaustion, `payment.auto.exhausted` is published and manual pay unlocks.

**Jobs:** `invoice-auto-payment.coordinator` / `.unit` (interval `INVOICE_AUTO_PAYMENT_SCHEDULER_INTERVAL`, default 60s). Claims use an optimistic `UPDATE … WHERE status IN (scheduled, retrying)`.

Admin mark-paid / mark-unpaid remain available as operational overrides.

## Notifications

| Event                                            | When                               |
| ------------------------------------------------ | ---------------------------------- |
| `auto_billing.enabled` / `auto_billing.disabled` | Toggle                             |
| `payment_method.attached`                        | Setup or Checkout captures PM      |
| `payment.auto.initiated`                         | Off-session charge started         |
| `payment.succeeded` / `payment.failed`           | With `mode: auto\|checkout`        |
| `payment.auto.retry_scheduled`                   | Retry queued                       |
| `payment.auto.exhausted`                         | Final failure; manual pay unlocked |

Duplicate Checkout / sync success paths short-circuit when the invoice is already paid (no second email). Checkout `payment_intent.*` webhooks are ignored; only `mode: auto` PaymentIntents use that path.

## Related

- [Payment Processing](./payment-processing.md)
- [Customer Profiles](./customer-profiles.md)
- [Invoices](./invoices.md)
- [Webhooks](./webhooks.md)
- [Background Jobs](../deployment/background-jobs.md)
