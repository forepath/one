# Customer Trust Score

Admins can review a per-profile trust score for billing customers in Decabill. The score is shown as a traffic light in the admin billing-profile list and exposes a factor breakdown in a modal on the profile detail surface.

## Scope

- **Audience:** Admins only
- **Frontend route:** `/administration/customer-profiles`
- **REST API:** `/admin/billing/customer-profiles/{id}/trust-score`
- **Data source:** Internal Decabill billing and profile data only

Customer self-service routes do **not** expose trust score data.

## How scoring works

Each billing profile starts at a base score and then gains or loses points from trust factors derived from subscriptions, invoices, payment attempts, auto-billing readiness, withdrawals, and backorders.

| Threshold | Level  |
| --------- | ------ |
| `>= 120`  | Green  |
| `70-119`  | Yellow |
| `< 70`    | Red    |

| Constant     | Value    |
| ------------ | -------- |
| Base score   | `100`    |
| Score clamp  | `0-200`  |
| Snapshot TTL | `1 hour` |

The source of truth for weights and caps is `trust-score.constants.ts` in the billing-manager feature library.

## Implemented factors

| Factor id                     | Points              | Rule                                                                |
| ----------------------------- | ------------------- | ------------------------------------------------------------------- |
| `base_score`                  | `+100`              | Neutral baseline for every customer                                 |
| `profile_complete`            | `+10`               | Billing profile passes Decabill completeness checks                 |
| `active_or_past_subscription` | `+15`               | Customer has at least one active or past subscription               |
| `multi_period_tenure`         | `+20`               | Customer has at least two billed subscription invoices              |
| `on_time_payments`            | `+5` each, cap `5`  | Successful payment attempts completed on or before invoice due date |
| `auto_billing_ready`          | `+10`               | Auto-billing enabled and reusable payment method on file            |
| `no_withdrawal`               | `+10`               | Subscription history exists and no withdrawal is recorded           |
| `overdue_invoices`            | `-15` each, cap `5` | Customer currently has open or overdue invoices                     |
| `failed_payments`             | `-10` each, cap `5` | Failed payment attempts are recorded                                |
| `auto_payment_exhausted`      | `-20`               | At least one invoice reached `auto_payment_status = exhausted`      |
| `product_withdrawal`          | `-25`               | A subscription withdrawal was initiated or completed                |
| `backorder_failures`          | `-5` each, cap `3`  | Failed backorder attempts are recorded                              |

## Persistence model

Decabill stores a denormalized trust snapshot on `billing_customer_profiles`:

- `trust_score`
- `trust_level`
- `trust_score_updated_at`

The admin list uses that snapshot so profile pagination stays cheap. The score detail endpoint recomputes the full factor breakdown and refreshes the stored snapshot.

## Recompute triggers

The trust score is refreshed automatically after these billing mutations:

- invoice issue, manual paid/unpaid changes, and invoice voiding
- payment success and payment failure
- subscription create, cancel, resume, and withdrawal start
- auto-billing enable or disable
- payment method attachment

Admins can also force a recompute from the trust-score detail modal or the dedicated recompute endpoint.

## Admin API

| Method | Path                                                          | Purpose                                                                     |
| ------ | ------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `GET`  | `/admin/billing/customer-profiles`                            | Returns `trustScore`, `trustLevel`, and `trustScoreUpdatedAt` in list items |
| `GET`  | `/admin/billing/customer-profiles/{id}`                       | Returns stored trust snapshot on admin profile detail                       |
| `GET`  | `/admin/billing/customer-profiles/{id}/trust-score`           | Recomputes and returns score, level, and factor breakdown                   |
| `POST` | `/admin/billing/customer-profiles/{id}/trust-score/recompute` | Forces recompute and returns refreshed detail                               |

## Webhooks

Decabill publishes an admin-facing webhook event when the traffic-light level changes:

- `customer_trust.level_changed`

Payload fields:

- `userId`
- `profileId`
- `previousLevel`
- `level`
- `score`

No billing profile address data or other PII is included in the event.

## Extensibility

The scoring engine uses a provider registry. Today Decabill registers the built-in `internal_billing` provider, but additional providers can be added later for external credit systems, remote address validation, or other risk signals without replacing the admin API or snapshot model.
