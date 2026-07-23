# Advance billing and yearly interval

Prepaid (advance) billing and the `year` billing interval for Decabill service plans.

## Overview

Service plans support:

| Field                 | Meaning                                                                                                                     |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `billingIntervalType` | `hour`, `day`, `month`, or **`year`**                                                                                       |
| `billInAdvance`       | `false` (default): arrear — debt at period **end**. `true`: advance — debt at period **start** covering the upcoming period |

Existing plans migrate to `billInAdvance = false` and keep prior behaviour.

Liability still flows **subscription → open position → billing-day accumulated invoice**. Only the **timing** of open-position creation changes.

## Yearly interval

`BillingScheduleService` advances by `billingIntervalValue` calendar years. Optional `billingDayOfMonth` clamps the anniversary day (same clamp as monthly). Do not model yearly as `month` + `12` — the month branch ignores `billingIntervalValue`.

## Advance vs arrear

|                        | Arrear (`billInAdvance: false`)         | Advance (`billInAdvance: true`)                                                                                                 |
| ---------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| First charge           | When first `nextBillingAt` is due       | Immediately on subscribe / backorder fulfillment                                                                                |
| Recurring              | Open position when period ends          | Open position at period boundary for the **next** period                                                                        |
| Cancel                 | Per `cancelAtPeriodEnd` + notice window | Always deferred to `currentPeriodEnd` (already paid); may be requested any time after commitment (notice window does not apply) |
| Teardown open position | Final proration OP as today             | Skipped (period already charged)                                                                                                |

## Usage-based billing

**Not available** when `billInAdvance` is true. `POST /admin/usage/record` returns 400 for advance-billed subscriptions; invoice creation ignores usage costs for those plans.

## Withdrawal (advance)

Same eligibility as arrear. Accounting:

1. **Billable invoice for the current prepaid period** (no unbilled open position) — existing partial credit note + eInvoice for unused `withdrawnAt → currentPeriodEnd`; no extra open position.
2. **Unbilled open position for the current prepaid period** (including unprovisioned withdraw after an immediate advance charge) — set `billUntil = withdrawnAt` on unbilled rows; no credit note (even if older invoices exist); no extra open position.
3. **Neither** — fall back to arrear teardown OP with `billUntil = withdrawnAt`.

## Notifications

| Event                           | When                                                                                         |
| ------------------------------- | -------------------------------------------------------------------------------------------- |
| `subscription.created`          | Order confirmation on subscribe — webhook + email                                            |
| `subscription.cancel_scheduled` | Cancel request (`pending_cancel`) — webhook + email                                          |
| `subscription.canceled`         | Final cancel teardown — webhook + email (not used for withdrawal emails)                     |
| `subscription.resumed`          | Resume from pending cancel — webhook + email                                                 |
| `subscription.withdrawn`        | Statutory withdrawal teardown complete — email (webhook still emits `subscription.canceled`) |
| `subscription.period_charged`   | Open position created (initial advance or due tick) — webhook only                           |

All subscription webhook payloads include `billInAdvance` and `billingIntervalType`. For advance plans, `nextBillingAt` is the next charge / period boundary.

**Breaking note:** cancel requests no longer emit `subscription.canceled`; they emit `subscription.cancel_scheduled`. Integrators should subscribe to both or migrate.

## Related

- [Service Types and Plans](./service-types-and-plans.md)
- [Subscriptions](./subscriptions.md)
- [Invoices](./invoices.md)
- [Webhooks](./webhooks.md)
- [Email notifications](./email-notifications.md)
- [Public Statutory Withdrawal](./public-withdrawal.md)
