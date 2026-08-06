# Webhooks (Decabill)

Outbound webhook notifications let tenant administrators register HTTPS endpoints that receive structured billing events.

## Access

- **Admin UI:** `/webhooks` in the billing console (alongside user management)
- **REST API:** `/admin/billing/webhooks` (admin role or API key with `X-Tenant`)
- **Scope:** Endpoints and deliveries are stored per deployment database and scoped by `tenant_id`

## Authentication modes

Each endpoint supports:

| Mode            | Description                                       |
| --------------- | ------------------------------------------------- |
| `none`          | No outbound auth header                           |
| `authorization` | Sets the `Authorization` header                   |
| `custom_header` | Sets a custom header name and value               |
| `query_param`   | Appends a query parameter (**GET** requests only) |

Forepath also signs each delivery with HMAC-SHA256 in the `Forepath-Signature` header.

## Event envelope

```json
{
  "id": "uuid",
  "object": "event",
  "type": "invoice.issued",
  "created": "2026-07-14T14:00:00.000Z",
  "api_version": "2026-07",
  "application": "decabill",
  "tenant_id": "default",
  "client_id": "customer-user-uuid",
  "data": { "object": {} }
}
```

`client_id` is the customer user id when the event relates to a subscription, invoice, or project.

## Event catalog

Events are published from the **billing** service after successful mutations.

### Billing and subscriptions

- `invoice.created`, `invoice.issued`, `invoice.voided`
- `invoice.tax_mode_applied` (non-domestic tax modes at issue time)
- `payment.initiated`, `payment.succeeded`, `payment.failed`
- `payment.auto.initiated`, `payment.auto.retry_scheduled`, `payment.auto.exhausted`
- `auto_billing.enabled`, `auto_billing.disabled`
- `payment_method.attached`
- `customer_trust.level_changed`
- `customer_profile.custom_data_added`, `customer_profile.custom_data_updated`, `customer_profile.custom_data_deleted`
- `subscription.created`, `subscription.updated`, `subscription.cancel_scheduled`, `subscription.canceled`, `subscription.resumed`, `subscription.period_charged`
- `subscription.config_change_requested`, `subscription.config_changed`, `subscription.config_change_failed`
- `subscription.provisioned`, `subscription.provision_failed` (itemId plus hostname/service/providerReference or errorMessage; never secrets)
- `subscription.ssh_access_granted` (metadata only: subscription/item ids, hostname, grantedAt — never the private key)
- `addon.activated`, `addon.deactivated`, `addon.provision_failed`, `addon.teardown_failed`
- `meter.created`, `meter.updated`, `meter.deleted`
- `service_plan.meter_attached`, `service_plan.meter_updated`, `service_plan.meter_detached`
- `addon.meter_attached`, `addon.meter_updated`, `addon.meter_detached`
- `usage.recorded`, `usage.updated`, `usage.deleted` (high volume; no email)

`subscription.period_charged` may include `meterCharges[]` (`meterId`, `attachmentType`, optional `addonId`, amounts). See [Usage meters](./usage-meters.md).

Plans with `serviceTypeId: null` (billing-only, no deployment) do not emit `subscription.provisioned` / `provision_failed`; fulfillment is immediate and silent, same as other non-cloud providers. Plan catalog CRUD does not emit webhooks. Orders still emit `subscription.created`. See [Service Types and Plans](./service-types-and-plans.md#plans-without-a-service-type-null).

Addon payloads include subscription id/number, plan id/name, addon id/key/name, and status timestamps. Config snapshots and secrets are never included. See [Addons](./addons.md).

Config-change payloads carry the subscription payload plus `configChangeId`, `appliedSteps` (step keys such as `serverType` or `addonAdd:<addonId>`), `billingOutcome` (`none` | `charged` | `credited` | `deferred`), and `errorCode`. The requested payload is never included because addon configuration can hold credentials.

Subscription payloads include `billInAdvance` and `billingIntervalType`. **Breaking:** cancel requests emit `subscription.cancel_scheduled`; `subscription.canceled` is reserved for final teardown. See [Advance billing and yearly interval](./advance-billing-and-yearly-interval.md).

Admin instant cancel (like statutory withdrawal accept) emits `subscription.updated` when queued, then `subscription.canceled` on teardown. Prepaid unused-period refunds reuse withdrawal refund accounting; the final event stays canceled (not a separate withdrawn type). See [Subscriptions — Admin instant cancel](./subscriptions.md#admin-instant-cancel).

Payment success/failure payloads may include `mode` (`checkout` | `auto`). Auto-billing events are documented in [Auto-Billing](./auto-billing.md).
`customer_trust.level_changed` only includes identifiers plus level and score metadata; it never includes billing-profile address fields or other PII.
`customer_profile.custom_data_*` events include `profileId`, `userId`, and `key` only — custom data values are never included in webhook payloads.

### Projects

- `project.created`, `project.updated`, `project.deleted`

### Project milestones

- `milestone.created`, `milestone.updated`, `milestone.deleted`

### Project time entries

- `time_entry.created`, `time_entry.updated`, `time_entry.deleted`

### Project tickets

- `ticket.created`, `ticket.updated`, `ticket.deleted`
- `ticket.comment.created`

Ticket payloads include metadata only; full ticket body content is not included in webhook events.

**Subtasks:** Subtasks are tickets with a `parentId`. Adding a subtask publishes `ticket.created` (with `parentId`). Removing a subtask publishes `ticket.deleted`. Reparenting publishes `ticket.updated`. The parent ticket does not receive a separate event when children change.

**Comments:** Adding a comment publishes `ticket.comment.created`. There is no comment update/delete API, so no corresponding webhook events.

### DATEV exports

- `datev_export.started`, `datev_export.completed`, `datev_export.failed`
- `vat_id.validation_succeeded`, `vat_id.validation_failed`, `vat_id.validation_pending`, `vat_id.validation_unavailable`
- `oss.threshold_exceeded`

DATEV export events are tenant-scoped admin operations; `client_id` is omitted. Export file contents and storage paths are never included in webhook payloads.

### Application updates

Webhook-only (no email). Emitted by the billing-manager update-check job and instance heartbeats:

- `application.update_available` — a newer GitHub release was detected versus the previously stored latest
- `application.update_check_failed` — GitHub Releases API unreachable or returned an error
- `application.instance_outdated` — after a successful check, an instance transitioned to `update_available`
- `application.dependency_health_changed` — Redis, queue, or database health flipped for a tracked instance

See [Application updates](./application-updates.md).

## Payload examples

### `project.created`

```json
{
  "id": "project-uuid",
  "userId": "customer-user-uuid",
  "name": "Website redesign",
  "description": "Q3 delivery",
  "status": "active",
  "hourlyRateNet": 120,
  "targetHours": 40,
  "currency": "EUR",
  "createdAt": "2026-07-01T10:00:00.000Z",
  "updatedAt": "2026-07-02T10:00:00.000Z"
}
```

### `milestone.updated`

```json
{
  "id": "milestone-uuid",
  "projectId": "project-uuid",
  "name": "Phase 1",
  "description": null,
  "targetDate": "2026-08-01T00:00:00.000Z",
  "sortOrder": 0,
  "lockedAt": null,
  "createdAt": "2026-07-01T10:00:00.000Z",
  "updatedAt": "2026-07-02T10:00:00.000Z"
}
```

### `time_entry.created`

```json
{
  "id": "time-entry-uuid",
  "projectId": "project-uuid",
  "ticketId": "ticket-uuid",
  "recordedByUserId": "admin-user-uuid",
  "durationMinutes": 60,
  "description": "Implementation",
  "startedAt": "2026-07-03T08:00:00.000Z",
  "endedAt": "2026-07-03T09:00:00.000Z",
  "invoiceId": null,
  "billedAt": null,
  "createdAt": "2026-07-03T09:00:00.000Z"
}
```

### `ticket.created`

```json
{
  "id": "ticket-uuid",
  "projectId": "project-uuid",
  "parentId": null,
  "milestoneId": "milestone-uuid",
  "title": "Homepage",
  "status": "todo",
  "priority": "medium",
  "locked": false,
  "createdByUserId": "admin-user-uuid",
  "createdAt": "2026-07-01T10:00:00.000Z",
  "updatedAt": "2026-07-02T10:00:00.000Z"
}
```

Delete events may omit optional fields when only identifiers are available.

### `ticket.comment.created`

```json
{
  "id": "comment-uuid",
  "ticketId": "ticket-uuid",
  "projectId": "project-uuid",
  "userId": "admin-user-uuid",
  "body": "Looks good",
  "createdAt": "2026-07-01T11:00:00.000Z"
}
```

User email is never included.

### `datev_export.completed`

```json
{
  "id": "export-uuid",
  "scope": "tenant",
  "tenantId": "default",
  "periodYear": 2026,
  "periodMonth": 6,
  "status": "completed",
  "fileName": "datev-export-2026-06.zip",
  "bookingCount": 12,
  "invoiceCount": 4,
  "debtorCount": 3,
  "includedTenantIds": ["default"],
  "triggeredBy": "scheduler",
  "errorMessage": null,
  "startedAt": "2026-07-01T08:00:00.000Z",
  "completedAt": "2026-07-01T08:05:00.000Z",
  "createdAt": "2026-07-01T08:00:00.000Z",
  "updatedAt": "2026-07-01T08:05:00.000Z"
}
```

`datev_export.failed` uses the same shape with `status: "failed"` and a populated `errorMessage`.

## Delivery and retries

Deliveries are queued on the `billing` BullMQ queue. Each delivery is retried up to **3 times** with exponential backoff (starting at 5 seconds). Every attempt is logged in the delivery history with its attempt number. The endpoint `consecutive_failures` counter increments only after all retries for an event are exhausted. Endpoints auto-disable after **10** consecutive failed events.

## Delivery log retention

Each webhook endpoint maintains its own delivery log. Retention is enforced **per endpoint** in two phases:

1. **Age-based:** Delete delivery rows older than the configured retention window.
2. **Count-based:** If the endpoint still has more rows than the configured maximum, delete the oldest excess entries (newest entries are kept).

| Setting          | Endpoint field             | Platform default                                |
| ---------------- | -------------------------- | ----------------------------------------------- |
| Retention window | `deliveryLogRetentionDays` | `WEBHOOK_DELIVERY_LOG_RETENTION_DAYS` (30 days) |
| Max entries      | `deliveryLogMaxEntries`    | `WEBHOOK_DELIVERY_LOG_MAX_ENTRIES` (500)        |

Set either field to `null` on update to revert to platform defaults. Omit both on create to use defaults immediately.

Pruning runs:

- After each delivery log insert (fire-and-forget, scoped to that endpoint)
- On a scheduled coordinator job (`webhook-delivery-retention.coordinator`, default every hour via `WEBHOOK_DELIVERY_RETENTION_INTERVAL_MS`)
- Immediately when retention settings are changed on an endpoint

## Endpoint deletion

Deleting a webhook endpoint removes all associated delivery logs immediately (application-level cleanup plus database `ON DELETE CASCADE`). In-flight delivery jobs that finish after deletion skip persisting a delivery log rather than creating orphaned rows.

See [Billing Administration](./billing-administration.md) for other admin features.
