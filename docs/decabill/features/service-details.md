# Service details

Customer and admin views for a provisioned subscription item (cloud service instance), including live status, displayable server metadata, optional rename, usage-meter history charts, and contributor-registered tabs from addons, integrated stacks, and CloudInit configs (for example Container Manager).

## Routes

| Audience | Path                                                                     |
| -------- | ------------------------------------------------------------------------ |
| Customer | `/subscriptions/{subscriptionId}/services/{itemId}`                      |
| Customer | `/subscriptions/{subscriptionId}/services/{itemId}/{tab}`                |
| Admin    | `/administration/subscriptions/{subscriptionId}/services/{itemId}`       |
| Admin    | `/administration/subscriptions/{subscriptionId}/services/{itemId}/{tab}` |

Empty tab path redirects to `details`. Valid `:tab` values come from the item detail `tabs[].id` (built-in `details` plus addon-registered ids such as `container-manager`). Unknown tabs fall back to `details`.

Customer deep links also come from the dashboard cloud-instances lane. Admin entry is from the Contracts list (`/administration/subscriptions`) nested services subsection (there is no admin dashboard). Live provisioned items remain open while removal is only planned (`pending_cancel`, `pending_withdrawal`, `pending_instant_cancel`, and other non-terminal live statuses). Items on **canceled** subscriptions, failed items, and active items without a live provider show as **Removed** (or **Removing** while teardown is queued but the provider reference still exists) and **cannot** open this page once the instance is gone (UI hides the action; API returns 404). The customer dashboard keeps listing the same live instances until deprovisioned.

## Display name

Each subscription item may store an optional `displayName` override (`billing_subscription_items.display_name`).

- Default label: catalog `serviceTypeName` (or integrated service kind).
- Override is shown anywhere that label appears (dashboard, subscriptions / contracts subsections, detail header, websocket status payloads).
- Does **not** change the subscription reference (`SUB-*`).

### API

Customer: `POST /subscriptions/{subscriptionId}/items/{itemId}/display-name`

Admin: `POST /admin/billing/subscriptions/{subscriptionId}/items/{itemId}/display-name` (`subscriptions:admin`)

```json
{ "displayName": "Prod API" }
```

Send `null` or an empty/whitespace string to clear the override.

### UI

Inline rename follows the project-ticket pattern: click the title → input → blur commits. A trashcan clears the draft; blur with an empty draft resets to the default name.

## Detail API

Customer: `GET /subscriptions/{subscriptionId}/items/{itemId}` returns the item plus:

- displayable `serverInfo` (IPs, hostname/FQDN, status, metadata)
- `tabs` — always includes the built-in Details tab (`id: details`, `order: 0`, `moduleKey: null`, `source: details`); additional tabs come from active module addons, the item's integrated stack, and/or the active CloudInit config
- `activeAddons` — active/pending subscription addon summaries for the UI
- optional `containerManager` summary (`containerCount`, `healthyCount`, `lastCollectedAt`) when Container Manager is active

Detail-eligible only when the parent subscription is still live (`active`, `pending_cancel`, `pending_config_change`, or `pending_backorder`), `provisioningStatus === active`, and a live provider reference exists (`hasProviderReference` on list payloads; the reference value is never returned).

Admin twins live under `/admin/billing/subscriptions/{subscriptionId}/items/...` (`subscriptions:admin`) and do not require subscription ownership.

## Tabs and extension registry

Three contributor kinds can register service-detail tabs:

| Source               | Registration                                                                                                                          | When applied                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Addon**            | `BillingAddonModule.serviceTabs` (builtins / `DYNAMIC_ADDON_MODULES`)                                                                 | Subscription addon is `active` and `implementationType === module` |
| **Integrated stack** | `IntegratedStackModule.serviceTabs` (first-party contributor Nest modules / `DYNAMIC_INTEGRATED_STACK_MODULES`)                       | Item `configSnapshot.service` is an integrated stack id            |
| **CloudInit**        | Config entity `serviceTabs` jsonb **and/or** `CloudInitConfigModule.serviceTabs` (`DYNAMIC_CLOUD_INIT_MODULES` keyed by config `key`) | Item service is `custom` and `cloudInitConfigId` resolves          |

Each tab carries `id`, `label`, `order`, `moduleKey` (contributor key), and `source` (`details` \| `addon` \| `integrated` \| `cloud-init`). Duplicate tab ids are skipped (first wins). Optional `isVisible` hooks apply for code modules only.

Frontend mapping:

- Route param `:tab` selects the active tab
- Built-in Details content is always available
- Extension tabs resolve through `SERVICE_DETAIL_TAB_REGISTRY`, merged from compile-time `FIRST_PARTY_CONTRIBUTOR_UI_MODULES` (`tabComponents`); unknown registered tabs without a UI component show an unavailable message
- Contributor tab labels use the API `tab.label` (only the built-in `details` tab is i18n in the host)
- Extra Angular `routes.customer` / `routes.admin` and `navItems` from those modules are spread into the console shell (Container Manager and first-party stacks ship none; service detail `/:tab` already exists)
- There is no runtime `DYNAMIC_FRONTEND_*` (this repo has no Module Federation)

### Container Manager tab

When the `container-manager` module addon is active, the detail page exposes tab `container-manager` (order `100`, `source: addon`). That tab loads Docker containers and networks via on-demand SSH REST, and stats history from persisted worker samples (see [Container Manager](./container-manager.md)).

## Contributor jobs

The same code modules that register `serviceTabs` may also register `jobs` (`ContributorJobDefinition`: slug `key`, `intervalMs` clamped 15s–24h, optional `isEnabled`, `run(ctx)`). Declarative CloudInit `serviceTabs` jsonb cannot carry functions — jobs attach only to `BillingAddonModule`, `IntegratedStackModule`, and `CloudInitConfigModule`.

`contributor-collect.coordinator` (default every 30s) fans out per-tenant `contributor-collect.unit` jobs. Each unit runs due contributor jobs for that tenant, isolating failures. Run timestamps live in `billing_contributor_job_runs`. See [Dynamic provider plugins](./dynamic-provider-plugins.md).

First-party integrated stacks currently declare no extra tabs; product-specific stack UIs ship as compile-time `ContributorUiModule` entries (empty today) or via `DYNAMIC_INTEGRATED_STACK_MODULES`. CloudInit declarative tabs are stored on the template and editable via the CloudInit admin API (see [CloudInit Configs](./cloud-init-configs.md)).

## Meter history

| Audience | Path                                                                            | PAT scope                   |
| -------- | ------------------------------------------------------------------------------- | --------------------------- |
| Customer | `GET /subscriptions/{subscriptionId}/meters/history?from&to&groupBy=day\|month` | ownership + existing scopes |
| Admin    | `GET /admin/billing/subscriptions/{subscriptionId}/meters/history?...`          | `usage:admin`               |

Returns per-meter series using each meter’s catalog aggregator within day/month buckets of `periodEnd`. The service detail page filters with a collapsible `from` / `to` / `groupBy` panel (customer-facing adaptation of admin billing filters; no `userId`).

## Realtime

Billing namespace (`/billing`):

- `dashboardStatusUpdate` — live status (includes `displayName`); customer-owned subscriptions only
- `subscribeSubscriptionMeters` / `unsubscribeSubscriptionMeters` — room `subscription:{id}`
- `meterSummaryUpdate` — current meter summaries after usage mutations (includes aggregated, billable, and estimated charge values)

Customers must own the subscription to join the meter room. **ADMIN** sockets may join any tenant subscription after an existence check (no ownership required).

Container Manager uses REST polling today; an optional future push on room `subscription:{id}:container-manager` is described in AsyncAPI.

## Notifications

| Event                                                    | When                               |
| -------------------------------------------------------- | ---------------------------------- |
| `subscription.service.renamed`                           | Display name set or cleared        |
| `subscription.service.started` / `stopped` / `restarted` | Power actions                      |
| `subscription.service.removed`                           | Item deprovisioned during teardown |

## Related

- [Subscriptions](./subscriptions.md)
- [Addons](./addons.md)
- [Container Manager](./container-manager.md)
- [Usage meters](./usage-meters.md)
- [Billing administration](./billing-administration.md)
