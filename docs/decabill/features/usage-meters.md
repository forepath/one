# Usage meters

Tenant-scoped usage meters drive arrear usage billing for service plans and addons.

## Catalog

`billing_meters` stores reusable meters per tenant:

- `key` (unique per tenant), `name`, optional `description` / `unit_label`
- `aggregator`: `max` | `min` | `avg` | `first` | `last` | `sum` | `sum_positive_deltas`
  - **Gauge-style:** `max` / `min` / `avg` / `first` / `last` over in-window samples
  - **`sum`:** total of sample values (volume / batch totals)
  - **`sum_positive_deltas`:** sum of increases between consecutive samples (time-ordered);
    on counter reset (value decreases), treat the new value as a fresh series and add it
    (Prometheus-style). Useful for cumulative provider counters.
- `default_unit_price_net`
- `default_included_usage` (default `0`) — free allowance per charge period before metered billing applies
- `is_active`

Admin API: `GET/POST /meters`, `GET/POST/DELETE /meters/{id}` (`catalog:read` / `catalog:write`).

Hard-delete is blocked while plan, addon, service-type, or usage rows reference the meter. Prefer `isActive=false`.

## Attachments

Meters attach to plans, addons, and service types via join tables with optional overrides for unit price and included usage:

- `billing_service_plan_meters` — unique `(service_plan_id, meter_id)`
- `billing_addon_meters` — unique `(addon_id, meter_id)`
- `billing_service_type_meters` — unique `(service_type_id, meter_id)`

Each link stores `source` (`manual` | `module` | `provider`) and `required` (boolean). Required links cannot be detached; price and included-usage overrides remain allowed.

**Effective price:** `coalesce(link.unit_price_net, meter.default_unit_price_net)`.

**Effective included usage:** `coalesce(link.included_usage, meter.default_included_usage)` — same inheritance as unit price; null link override falls back to the catalog default.

The same catalog meter may be attached to a plan and to one or more addons. Each attachment keeps its own effective price and included allowance. Usage and invoice lines are **attachment-scoped**, not merged by `meterId`.

### Declared / required meters

- **Addon modules** (`implementationType=module`) may declare `meters` on the registered module. On addon create/update, Decabill ensures a catalog row by `key` (create if missing; never clobber existing catalog defaults) and sideloads links as `source=module`, `required=true`.
- **Providers / products** declare meters on provider metadata (`GET /service-types/providers`). On service-type create/update (and on meter list), Decabill sideloads them onto `billing_service_type_meters` as `source=provider`, `required=true`. Admins may attach additional manual meters on the service type.
- **Effective plan meters** = explicit plan attachments ∪ meters on the plan’s `serviceTypeId`. Inherited service-type meters appear on plan list/embed with `inherited=true` (no detach in plan UI). Recording `attachmentType=plan` accepts either explicit or inherited meters.
- **Collection interval:** optional `collectionIntervalMs` on each declared meter. When set (> 0), the meter-collect job pulls samples on that interval. Omitted meters stay push-only (admin / API key).

Nested APIs:

- `GET/POST /service-plans/{id}/meters`, `POST/DELETE /service-plans/{id}/meters/{meterId}`
- `GET/POST /addons/{id}/meters`, `POST/DELETE /addons/{id}/meters/{meterId}`
- `GET/POST /service-types/{id}/meters`, `POST/DELETE /service-types/{id}/meters/{meterId}`
- `GET /addons/modules` — registered modules including declared meters (admin preview)

`ServicePlanResponse` and `AddonResponse` embed attached meters (plans include inherited service-type meters).

## Recording usage

`POST /admin/usage/record` (admin or API key, `usage:write`):

```json
{
  "subscriptionId": "...",
  "periodStart": "...",
  "periodEnd": "...",
  "meterId": "...",
  "value": 12.5,
  "attachmentType": "plan",
  "addonId": null,
  "usagePayload": {}
}
```

Rules:

- Prepaid plans (`billInAdvance`) reject metered recording.
- If the subscription has **no** plan-meter (including inherited service-type meters) and **no** billable addon-meter attachments, legacy payload-only bodies remain allowed (`totalCost` / `usageCost` / `units×unitPrice` on invoice).
- Otherwise `meterId` and `value` are required; `attachmentType` defaults to `plan`.
- `attachmentType=plan`: meter must be on the subscription’s plan or its service type.
- `attachmentType=addon`: `addonId` required; subscription must have that addon billable; meter must be on that addon.

Admin entry CRUD: `/admin/billing/subscriptions/{id}/meter-entries` (`billing_admin:read` / `billing_admin:write` for list/update/delete; `usage:write` for create).

## Collector job (pull)

BullMQ `meter-collect.coordinator` runs every minute (`BILLING_METER_COLLECT_INTERVAL`, default `60000`; disable with `BILLING_METER_COLLECT_ENABLED=false`). It fans out per-tenant `meter-collect.unit` jobs.

For each active arrear subscription (skip prepaid):

1. **Plan / provider path:** provisioned subscription item → resolve declared meters with `collectionIntervalMs` from the provider runtime module (override) or metadata → due when no prior `usageSource=collector` row or `now - last.periodEnd >= interval` → call `BillingProviderModule.collectMeters` **once per due meter** with that meter’s `periodStart`/`periodEnd` → write via `UsageService.createUsage` with `usageSource: collector` and `attachmentType: plan`.
2. **Addon / module path:** billable module addons → same due logic from `BillingAddonModule.meters` → optional `collectMeters` (also per due meter) → `attachmentType: addon`.

The tenant unit job pages through eligible subscriptions (`BILLING_METER_COLLECT_BATCH_SIZE`, default 500) until exhausted.

Idempotency is soft: due-check against the latest collector `periodEnd` for `(subscriptionId, meterId, attachmentType, addonId)`. Collectors may additionally return an `idempotencyKey` per sample (e.g. per source, meter and hour): a sample whose key is already recorded for the subscription and meter is skipped, the key is stored as `usagePayload.idempotencyKey`, and a partial unique index on `(subscription_id, meter_id, usage_payload->>'idempotencyKey')` catches concurrent runs (a unique violation counts as already recorded). One collect call may return several samples for the same meter; each becomes its own usage entry for the due window. Fail-closed: meters with an interval but no `collectMeters` implementation are skipped (warn log; no zero invent). Per-subscription and per-addon errors are isolated so one failure does not abort the tenant job.

Push (`POST /admin/usage/record`) and pull coexist; modules own their collection windows.

Built-in Hetzner / DigitalOcean register stub collectors (empty samples) until real metrics APIs are wired.

## Loadweaver usage

Hosters who resell capacity of their **own** Loadweaver clusters bill it through the built-in addon module `loadweaver-usage` (Loadweaver side: [usage metering](../../loadweaver/features/usage-metering.md)).

- **Catalog:** one addon per Loadweaver cluster with `implementationType=module`, `moduleKey=loadweaver-usage`. Admin defaults `LOADWEAVER_API_URL` (control plane API URL including `/api`; HTTPS, plain HTTP only with `BILLING_LOADWEAVER_USAGE_ALLOW_HTTP=true`; no credentials / query) and `LOADWEAVER_API_TOKEN` (personal access token of a Loadweaver auditor with scope `usage:read`). The collector reads both **only from the catalog addon's encrypted admin defaults**, never from a subscription's config snapshot (customers can submit addon config values at order time and must not redirect the collector or see the token).
- **Meters** (declared, `required`, aggregator `sum`, default price `0`, `collectionIntervalMs` 1 h): `loadweaver.cpu_core_hours` (core-hours), `loadweaver.memory_gib_hours` (GiB-hours), `loadweaver.storage_gib_hours` (GiB-hours, each volume once), `loadweaver.storage_replica_gib_hours` (GiB-hours incl. replica copies), `loadweaver.traffic_in_gb` / `loadweaver.traffic_out_gb` (GB, 10⁹ bytes), `loadweaver.public_ip_hours` (IP-hours). Attach prices and included usage as for any meter.
- **Mapping:** explicit, in Loadweaver: a cluster admin sets `spec.billing.decabillSubscriptionId` on each Loadweaver project billed on a subscription (several projects per subscription add up). Loadweaver snapshots the mapping into each hourly bucket, so remapping never moves billed hours.
- **Collection:** for a due window `[periodStart, periodEnd]` the module calls `GET {LOADWEAVER_API_URL}/usage?billingSubscription=<subscriptionId>&granularity=hour&finalOnly=true` (one HTTP call per subscription and window, cached for a minute across meters; 15 s timeout, no redirects). Hours are assigned by their end: hours ending in `(periodStart − 20 min, periodEnd − 20 min]` belong to the window (Loadweaver marks an hour final 15 minutes after it ends), so consecutive windows split the hours without gaps. The query also covers a 3 h lookback; every hour is recorded as its own entry with the idempotency key `loadweaver:<cluster>:<project>:<meter>:<hour>` and payload `{ source, cluster, project, meter, bucket }`, so hours seen again are skipped. Rows of other subscriptions, non-final rows and zero values are ignored. A window without usage records one zero entry (key `loadweaver:<cluster>:window:<subscription>:<meter>:<periodEnd>`) so it isn't due again every minute. A truncated or malformed answer fails the collect (retried next run, nothing recorded).
- **Hours around the billing boundary:** an hour is billed in the charge period that contains the `periodEnd` of its entry, which is the period that was open when it was **collected**, not necessarily the one the hour belongs to. Hours that end in the last ~20 minutes before `nextBillingAt` (settle delay), and hours picked up only by the 3 h lookback after the invoice was cut (Loadweaver or the collector briefly unavailable, an hour finalised late), are recorded after the boundary and appear on the **next** invoice. They are billed once (idempotency key), just a period later; nothing is lost or doubled. Hours older than the lookback that were never collected (an outage longer than ~3 h) are not fetched again automatically — an admin can add them as manual meter entries from Loadweaver's `GET /usage` for that range.

## Subscription views

- `GET /subscriptions/{id}/meters` and admin twin under `/admin/billing/subscriptions/{id}/meters` (`billing_admin:read`)
- `SubscriptionResponse.meters` embeds the same summaries (effective price, effective included usage, aggregated value, billable value, estimated charge)
- `GET /subscriptions/{id}/meters/history?from&to&groupBy=day|month` (admin twin under `/admin/billing/subscriptions/{id}/meters/history`, `billing_admin:read`) — per-meter time series for the service details UI
- WebSocket `meterSummaryUpdate` on room `subscription:{id}` after usage mutations; ADMIN may subscribe without ownership (see [Service details](./service-details.md))

## Invoice charge path (arrear)

For each charge period:

1. Effective plan meters (plan links ∪ service-type links) → aggregate entries with `attachmentType=plan` for that `meterId` → separate plan-scoped line
2. Each billable subscription addon → each of that addon’s meter attachments → aggregate with `attachmentType=addon` and that `addonId` → separate addon-scoped line
3. Same catalog meter on plan + addon A + addon B can produce up to three lines
4. If there are no plan/addon meter attachments at all → legacy `extractUsageCost` on the subscription base line

Per attachment line:

- `aggregatedValue` — in-window aggregate from the meter’s catalog aggregator
- `effectiveIncludedUsage` — `coalesce(link.included_usage, meter.default_included_usage)`
- `billableValue` — `max(0, aggregatedValue - effectiveIncludedUsage)`
- Line net amount — `billableValue × effectiveUnitPriceNet` (same coalesce pricing as attachments)

Period inclusion: a record settles into the charge period that contains its `periodEnd`
(left-open start, inclusive end). Spanning intervals are billed once, in the period where
the sample ends — not in both adjacent periods. Collector samples clamp `periodEnd` to the
subscription’s current `nextBillingAt` when collection runs after that boundary (before the
billing tick), and arrear schedule advances anchor the next `currentPeriodStart` at the prior
`nextBillingAt` so late ticks do not open a gap that drops samples. Invoice meter lines use
schedule-aligned `meterPeriodStart` (not lagged `invoice.createdAt`) so open-position
invoicing cannot skip post-boundary collector rows.

Empty aggregates and usage fully covered by included allowance (`billableValue = 0`) omit the line when below the minimum billable amount. Prepaid plans skip meter costs.

## Notifications

| Event                                                              | When                            |
| ------------------------------------------------------------------ | ------------------------------- |
| `meter.created` / `updated` / `deleted`                            | Catalog                         |
| `service_plan.meter_attached` / `meter_updated` / `meter_detached` | Plan link                       |
| `addon.meter_attached` / `meter_updated` / `meter_detached`        | Addon link                      |
| `service_type.meter_attached` / `meter_updated` / `meter_detached` | Service-type link               |
| `usage.recorded` / `updated` / `deleted`                           | Entries (no email; high volume) |

No new webhook event types. Existing meter and attachment events gain `defaultIncludedUsage` (catalog) and nullable `includedUsage` (link attach/update). `subscription.period_charged` `meterCharges[]` entries include `attachmentType`, optional `addonId`, `aggregatedValue`, `effectiveIncludedUsage`, `billableValue`, and charge amounts.

## Related docs

- [Addons](./addons.md)
- [Service types and plans](./service-types-and-plans.md)
- [Dynamic provider plugins](./dynamic-provider-plugins.md)
- [Subscriptions](./subscriptions.md)
- [Service details](./service-details.md)
- [Invoices](./invoices.md)
- [Advance billing](./advance-billing-and-yearly-interval.md)
- [Webhooks](./webhooks.md)
- [Loadweaver usage metering](../../loadweaver/features/usage-metering.md)
