# Customer offers

Decabill customer offers let admins compose draft quotations for a customer, archive them as numbered PDF offers, and let customers accept or decline. Accepted offers provision subscriptions, projects, and invoices according to line type.

## Terminology

- **Archive** (offer) — finalize a draft: number, frozen prices and terms, PDF (not the same as invoice issuance). By default the offer is sent to the customer in the same step; it can also be archived without sending it.
- **Send** — email the offer PDF to the customer. Done on archive, or later for an offer archived without sending (`sentAt` records when). Like invoices, archived offers are visible in the customer's account either way.
- **Pending** — `archived` status, sent, not expired, awaiting customer action.
- **History** — accepted, declined, expired, or revoked offers.

Offer numbers use the `OFF-{year}-{nnnnn}` pattern (see [Numbering](./numbering.md)).

## Lifecycle

See also the [offer lifecycle sequence diagram](../offers-lifecycle.mmd).

| Status     | Meaning                                                    |
| ---------- | ---------------------------------------------------------- |
| `draft`    | Admin-editable; not visible to customer                    |
| `archived` | Finalized; PDF stored; visible to the customer; may expire |
| `accepted` | Customer accepted; fulfillment runs                        |
| `declined` | Customer declined                                          |
| `expired`  | Past `expires_at` while still archived                     |
| `revoked`  | Admin revoked from `draft` or `archived`                   |

Revocation is allowed only in `draft` or `archived`. Terminal states cannot be revoked.

### Finalize and send

The console asks before archiving (row action or bulk **Archive**) whether to send the offer right away (default on) and whether to email the customer when it expires (default on). An offer archived without sending is shown as **Pending response (not sent)**; like a silently issued invoice it is still visible in the customer's account and can be accepted there, only the email is held back. **Send to customer** (row menu or the preview) emails it later; this is refused for offers that were already sent, are no longer archived or are past their expiry date, and when the customer has no billing email address (nothing changes then). The send is claimed atomically, so concurrent clicks email the customer once.

Revoking asks whether to notify the customer, like voiding an invoice: the checkbox defaults to on when the offer was sent, off otherwise (bulk revoke: on). The expiry email follows the choice made when archiving. Offers archived before this option existed keep their previous behaviour (sent, no expiry email).

## Line types

| Type               | On acceptance                                                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `standard`         | Invoice line or open position (per offer flag)                                                                          |
| `article`          | Like `standard`, plus an inventory withdrawal request for the line's article and quantity ([Inventory](./inventory.md)) |
| `project_template` | Creates a customer project from stored template payload                                                                 |
| `plan_template`    | Creates a subscription using prepared plan/addon snapshots                                                              |

### Project template pricing

A `project_template` payload carries the project's `hourlyRateNet`, optional `targetHours`, and a `pricingModel`:

| `pricingModel`     | Offer line amount                           | Created project                                    |
| ------------------ | ------------------------------------------- | -------------------------------------------------- |
| `hourly` (default) | `targetHours` (else 1) × `hourlyRateNet`    | Billed hourly, unlimited                           |
| `capped`           | `priceLimitNet` (maximum price), quantity 1 | Billed hourly, total never exceeds `priceLimitNet` |
| `fixed`            | `priceLimitNet` (fixed price), quantity 1   | Billed at the fixed price (at once or instalments) |

`priceLimitNet` is required for `capped` and `fixed`. Both values are stored in the template payload and applied to the project created on acceptance (see [Projects](./projects.md#pricing-models)).

Plan template lines store encrypted GCM snapshots (`effectiveConfigSnapshot`, `addonConfigsSnapshot`) at draft save time via `SubscriptionOrderPreparationService`.

Optional `scheduledAt` defers fulfillment to a BullMQ job.

## Admin API

Base path: `/admin/billing/offers` — scope `offers:admin`.

- List with pagination and `?search=` (OpenSearch + PostgreSQL ILIKE fallback)
- `GET /statistics` — pipeline KPIs (not invoice turnover)
- CRUD on drafts, `POST :id/archive` (`{ notifyCustomer?, notifyOnExpiry? }`, both default `true`), `POST :id/send`, `POST :id/revoke` (`{ notifyCustomer? }`, default `true`)
- List items and details carry `sentAt`, `canSend` and `notifyOnExpiry`
- `GET :id/pdf`, `GET :id/audit-logs`

## Customer API

Base path: `/offers` — scopes `offers:read`; accept/decline also require `offers:write`.

- `GET /summary` — pending and history counts
- `GET /pending`, `GET /history` — full lists with optional `?search=`
- `GET /:id`, `GET /:id/pdf`
- `POST /:id/accept`, `POST /:id/decline`

## Fulfillment

`OfferFulfillmentService` runs synchronously on accept for immediate lines and via `offer-fulfillment` BullMQ jobs for scheduled lines. It may call:

- `SubscriptionService.createSubscriptionFromPrepared()`
- `ProjectsAdminService.create()`
- `InvoiceIssuanceService` or open-position recording when `billToOpenPositions` is true

Created invoices may reference `offer_id`.

## PDF and e-invoice

Offer PDFs mirror invoice layout (`offer-pdf.template.html`). Embedded ZUGFeRD uses document type **325 (proforma invoice)** without payment means: EN 16931 has no quotation code (BR-CL-01), and 330 means "request for quote".

Offers carry optional payment and delivery terms (offer editor; empty = global default). They are frozen on archive, printed on the PDF, embedded in the XML, and carried over to the invoice created on acceptance. See [Payment and delivery terms](./document-terms.md).

Offers can also carry an optional free-text note (offer editor), printed on the PDF and embedded as document note (BT-22). Unlike the terms, the note is not carried over to the invoice. See [Document notes](./document-notes.md).

## Notifications and email

Webhook events: `offer.created`, `offer.updated`, `offer.archived`, `offer.revoked`, `offer.accepted`, `offer.declined`, `offer.expired`, `offer.line.fulfilled`, `offer.line.fulfillment_failed`.

| Event            | Email template                | Attachment | Sent when                                      |
| ---------------- | ----------------------------- | ---------- | ---------------------------------------------- |
| `offer.archived` | `offer-archived`              | Offer PDF  | Archived with notification, or sent later      |
| `offer.accepted` | `offer-accepted-confirmation` | No         | Customer accepted                              |
| `offer.revoked`  | `offer-revoked`               | No         | Revoked with notification                      |
| `offer.expired`  | `offer-expired`               | No         | Expired, archived with the expiry notification |

The `offer.archived` webhook fires on archive whether or not the offer was sent to the customer.

## Search

Offers are indexed in the billing OpenSearch index (`entityType: offers`) with fields `offerNumber`, `status`, `userEmail`, `userId`, `id`. Reindex runs via the standard billing search reindex coordinator.

## Audit

Offer-scoped audit entries use `offer_id` on `billing_audit_logs`. Line-level preparation and fulfillment produce separate audit rows.

## UI

- Customer: `/offers` — two-lane pending/history layout (mirrors invoices)
- Admin: `/administration/offers` — batch-prefetch list, statistics lane, CRUD modals with line editor

## Related documentation

- [Invoices](./invoices.md)
- [Subscriptions](./subscriptions.md)
- [Projects](./projects.md)
- [Numbering](./numbering.md)
- [Webhooks](./webhooks.md)
- [Email notifications](./email-notifications.md)
- [Search indexes](./search-indexes.md)
- [Customer profiles](./customer-profiles.md)
