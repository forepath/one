# Customer offers

Decabill customer offers let admins compose draft quotations for a customer, archive them as numbered PDF offers, and let customers accept or decline. Accepted offers provision subscriptions, projects, and invoices according to line type.

## Terminology

- **Archive** (offer) — finalize a draft and send it to the customer (not the same as invoice issuance).
- **Pending** — `archived` status, not expired, awaiting customer action.
- **History** — accepted, declined, expired, or revoked offers.

Offer numbers use the `OFF-{year}-{nnnnn}` pattern (see [Numbering](./numbering.md)).

## Lifecycle

See also the [offer lifecycle sequence diagram](../offers-lifecycle.mmd).

| Status     | Meaning                                  |
| ---------- | ---------------------------------------- |
| `draft`    | Admin-editable; not visible to customer  |
| `archived` | Sent to customer; PDF stored; may expire |
| `accepted` | Customer accepted; fulfillment runs      |
| `declined` | Customer declined                        |
| `expired`  | Past `expires_at` while still archived   |
| `revoked`  | Admin revoked from `draft` or `archived` |

Revocation is allowed only in `draft` or `archived`. Terminal states cannot be revoked.

## Line types

| Type               | On acceptance                                              |
| ------------------ | ---------------------------------------------------------- |
| `standard`         | Invoice line or open position (per offer flag)             |
| `project_template` | Creates a customer project from stored template payload    |
| `plan_template`    | Creates a subscription using prepared plan/addon snapshots |

Plan template lines store encrypted GCM snapshots (`effectiveConfigSnapshot`, `addonConfigsSnapshot`) at draft save time via `SubscriptionOrderPreparationService`.

Optional `scheduledAt` defers fulfillment to a BullMQ job.

## Admin API

Base path: `/admin/billing/offers` — scopes `billing_admin:read` / `billing_admin:write`.

- List with pagination and `?search=` (OpenSearch + PostgreSQL ILIKE fallback)
- `GET /statistics` — pipeline KPIs (not invoice turnover)
- CRUD on drafts, `POST :id/archive`, `POST :id/revoke`
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

Offer PDFs mirror invoice layout (`offer-pdf.template.html`). Embedded ZUGFeRD uses EN 16931 document type **330 (Quotation)** without payment means.

## Notifications and email

Webhook events: `offer.created`, `offer.updated`, `offer.archived`, `offer.revoked`, `offer.accepted`, `offer.declined`, `offer.expired`, `offer.line.fulfilled`, `offer.line.fulfillment_failed`.

| Event            | Email template                | Attachment |
| ---------------- | ----------------------------- | ---------- |
| `offer.archived` | `offer-archived`              | Offer PDF  |
| `offer.accepted` | `offer-accepted-confirmation` | No         |

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
