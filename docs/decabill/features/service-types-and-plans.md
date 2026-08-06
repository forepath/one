# Service Types and Plans

Admin-managed catalog of provisioning providers, service types, and priced service plans exposed to customers and public marketing endpoints.

## Overview

Service types define which provisioning provider (if any) backs a product. Service plans attach pricing, billing intervals, margins, and provider default configuration. The billing console admin UI and public catalog consume the same backend registry.

## Service Types

A service type links a product name to a provider id (for example `hetzner`, `digital-ocean`) or no provider for non-infrastructure plans.

### Admin Endpoints

| Method | Path                  | Purpose                     |
| ------ | --------------------- | --------------------------- |
| GET    | `/service-types`      | List service types          |
| POST   | `/service-types`      | Create service type (admin) |
| GET    | `/service-types/{id}` | Get service type            |
| POST   | `/service-types/{id}` | Update service type (admin) |
| DELETE | `/service-types/{id}` | Delete service type (admin) |

### Provider Registry

`GET /service-types/providers` returns registered provisioning providers with:

- Provider id and display name
- Optional `configSchema` for admin UI and subscription validation
- Dynamic metadata from `DYNAMIC_BILLING_PROVIDER_METADATA` plugins

Built-in providers include Hetzner Cloud and DigitalOcean when API tokens are configured. Additional providers can be registered via [Dynamic Provider Plugins](./dynamic-provider-plugins.md).

### Config Schema

The optional `configSchema` is a JSON-schema-like object:

- **`properties`** Field definitions with `type`, `description`, and optional `enum`
- **`basePriceFromField`** When set (for example `serverType`), the console loads options from `GET /service-types/providers/{providerId}/server-types` and uses selected `priceMonthly` as plan base price

Enum fields render as select inputs in the billing console.

### Statutory withdrawal opt-out

Service types may set **`disallowStatutoryWithdrawal`** (admin checkbox in the billing console). When true:

- Post-provisioning statutory withdrawal is blocked for subscriptions of that type.
- Unprovisioned orders remain withdrawable.
- Public and admin plan responses include `withdrawalPolicy.allowedAfterProvisioning: false` for checkout copy.

### Provider defaults (platform credentials)

Each service type can override **platform** environment variables used by the billing manager when calling Hetzner or DigitalOcean APIs (create/delete/start/stop servers, availability checks, admin server-type listing). This is separate from **Product defaults** on service plans (`providerConfigDefaults`), which configure values baked into customer VM cloud-init templates (including nested `hetznerApiToken` / `digitaloceanApiToken` for agent nested provisioning).

| Layer             | Where configured                        | Examples                                      | Purpose                                                |
| ----------------- | --------------------------------------- | --------------------------------------------- | ------------------------------------------------------ |
| Provider defaults | Service type (`POST /service-types`)    | `HETZNER_API_TOKEN`, `DIGITALOCEAN_API_TOKEN` | Decabill's own API calls to provision/manage servers   |
| Product defaults  | Service plan (`providerConfigDefaults`) | `region`, `serverType`, nested VM tokens      | Config injected into customer instances via cloud-init |

Admin UI: collapsed **Provider defaults** section on `/administration/service-types` (mirrors **Product defaults** on service plans). Leave fields blank to use global environment variables.

API behavior:

- `GET /service-types/providers` includes `envDefaultFields` per provider (field metadata for the admin UI).
- Write-only `providerDefaults` on create/update; responses expose `providerDefaultsConfigured` flags only (never raw secrets).
- Overrides are stored encrypted at rest (AES-256-GCM via `ENCRYPTION_KEY`, same as other billing secrets).
- Resolution: non-empty stored value wins; otherwise `process.env` fallback (backwards compatible).

`GET /service-types/providers/{providerId}/server-types?serviceTypeId={uuid}` uses that service type's credentials when validating server types against a custom token.

### Server Types

`GET /service-types/providers/{providerId}/server-types` returns server types with id, name, specs (cores, memory, disk), `priceMonthly`, and `priceHourly`. Requires the provider API token in the billing manager environment.

### Geography Labels

`GET /service-types/providers/{providerId}/locations` returns geography options with technical `id` (slug) and human-readable `name`. The billing console uses this for `location`/`region` enum dropdowns. Labels come from the provider API with static fallbacks; schema enums and stored config values remain technical slugs.

## Service Plans

Service plans define customer-facing pricing and billing rules. They usually belong to a service type (provider-backed or manual). They may also use **`serviceTypeId: null`** for billing-only plans that deploy nothing.

### Plans without a service type (`null`)

- API and admin UI use **`null`** (or omit the field on create) for no deployment — not a sentinel string.
- Persistence stores `NULL` in `billing_service_plans.service_type_id` (and on subscription items when ordered); responses expose `null`.
- Admin create form defaults the service type select to **None (no deployment)**; there is no “Choose a service type” placeholder.
- Ordering creates an immediately active subscription item with no cloud provisioning, availability check, addons, or backorders.
- Location/server-type customer selection and `autoRecalculatePriceDaily` are rejected for null-`serviceTypeId` plans.
- Plans carry their own `tenant_id` so tenant isolation works when the service-type join is absent.

No dedicated webhook events are emitted for plan CRUD or for “non-provision fulfilled” items (same as other non-cloud providers). Customer orders still emit `subscription.created` and related billing events.

### Admin Endpoints

| Method | Path                                             | Purpose                                                      |
| ------ | ------------------------------------------------ | ------------------------------------------------------------ |
| GET    | `/service-plans`                                 | List service plans                                           |
| POST   | `/service-plans`                                 | Create plan (admin)                                          |
| GET    | `/service-plans/{id}`                            | Get plan                                                     |
| GET    | `/service-plans/{id}/order-provisioning-options` | List customer-selectable provisioning options                |
| POST   | `/service-plans/{id}`                            | Update plan (admin)                                          |
| DELETE | `/service-plans/{id}`                            | Delete plan (admin); 400 if subscriptions still reference it |

### Plan Fields (Conceptual)

- **`serviceTypeId`** UUID of a catalog service type, or **`null`** for no deployment
- Title, description, and active flag
- Billing interval (hourly, daily, monthly, **yearly**)
- **`billInAdvance`** when true, charge at period start (prepaid); default false (arrear). Incompatible with usage-based metering. See [Advance billing and yearly interval](./advance-billing-and-yearly-interval.md) and [Usage meters](./usage-meters.md).
- **Plan meters** attach via `GET/POST /service-plans/{id}/meters` (optional unit-price override). Embedded on `ServicePlanResponse.meters` as the effective set: explicit plan attachments plus meters inherited from the plan’s service type (`inherited=true`). Inherited meters are fixed in the plan UI.
- **Service-type meters** attach via `GET/POST /service-types/{id}/meters`. Provider-declared meters sync as required (`source=provider`); admins may attach extra manual meters. See [Usage meters](./usage-meters.md).
- **`autoRecalculatePriceDaily`** when true, nightly job refreshes catalog base price from the provider and migrates eligible subscriptions (default false, opt-in; not allowed for null-`serviceTypeId` plans). See [Automatic daily price recalculation](./automatic-price-recalculation.md).
- **Admin commercial migrate** on plan update, optional request field `migrateExistingSubscriptions` (not stored). When true **and** `basePrice`, `marginPercent`, `marginFixed`, or `taxCategory` actually change, a `plan-price-migrate.unit` job migrates eligible subscriptions with the same settlement, withdrawal restart, and consolidated price-change email as nightly recalc. Unchecked updates affect new orders only.
- Base price, margin, and computed customer total
- `providerConfigDefaults` merged with customer `requestedConfig` on order (empty for null-`serviceTypeId` plans)
- For provisioning plans, customers choose from `provisioningOptions` (integrated `agenstra-controller`/`agenstra-manager`/`decabill-billing` and/or custom CloudInit configs). Admins configure these exclusively via **Customer-selectable options** checkboxes in the plan editor; **Product defaults** fields are scoped to the checked options only. New plans default to every integrated stack present in the provider `service` enum (Agenstra Controller, Agenstra Manager, and Decabill Billing when enabled). Existing legacy plans are reconciled by migration `1772000000000_CloudInitAndPlanProvisioningConsolidated`. Integrated service ids were renamed from `controller`/`manager` to `agenstra-controller`/`agenstra-manager` by migration `1775500000000_RenameIntegratedProvisioningServiceIds` (runtime parsers still accept the legacy aliases).
- `billing_day_of_month` for subscription period alignment
- `allowCustomerLocationSelection` when geography override is supported (not for null `serviceTypeId`)
- `allowCustomerServerTypeSelection` and `allowedServerTypes` when server-type override is supported (provider schema `basePriceFromField: 'serverType'`; not for null `serviceTypeId`)
- Provider `configSchema.properties` may set `scope: "server"` or `scope: "product"` with optional `productServices` (`agenstra-controller`, `agenstra-manager`, `decabill-billing`) to control the plan editor. Server fields stay under **Provider default config**; product fields appear under **Product defaults** when required by selected customer options.

### Customer Geography Selection

When `allowCustomerLocationSelection` is true **and** the merged provider schema defines `region` or `location` as a string with a non-empty enum, customers may pass geography in `POST /subscriptions` `requestedConfig`. Setting the flag without a supported schema returns 400.

For Hetzner and DigitalOcean, `region` and `location` are treated as aliases during merge and provisioning.

### Customer Server Type Selection

When `allowCustomerServerTypeSelection` is true **and** the effective provider schema has `basePriceFromField: 'serverType'`, admins configure `allowedServerTypes` and customers may pass `serverType` in `POST /subscriptions` `requestedConfig`. The value must be in `allowedServerTypes`; otherwise the request is rejected. When the flag is false, `serverType` is stripped from `requestedConfig` before merge.

When customer server type selection is enabled, the resolved server type’s `priceMonthly` is snapshotted as `billingBasePrice` on subscription items for recurring billing and withdrawal refunds. Pricing preview follows the same rule: live catalog prices override `basePrice` only when selection is enabled. When selection is disabled, commercial pricing uses the plan’s stored `basePrice` even if `providerConfigDefaults` still contains a provisioning `serverType`.

### CloudInit Configs Admin Route

Operators manage templates at `/administration/cloud-init-configs` in the billing console (sidebar label **Configs**, below **Providers**). See **[CloudInit Configs](./cloud-init-configs.md)**.

## Public Catalog

Unauthenticated endpoints for external pricing pages:

| Method | Path                                      | Purpose                                        |
| ------ | ----------------------------------------- | ---------------------------------------------- |
| GET    | `/public/service-plan-offerings`          | Paginated active plans (marketing fields only) |
| GET    | `/public/service-plan-offerings/cheapest` | Lowest-priced active plan                      |

Tenant is selected via `X-Tenant` (defaults to `default`). No provider secrets or internal margins are exposed.

When a plan has `allowCustomerServerTypeSelection` and multiple `allowedServerTypes`, each offering includes optional **`totalPriceFrom`** (lowest customer total across allowed types). **`totalPrice`** remains the total for the plan’s default server type. Cheapest-plan comparison uses `totalPriceFrom ?? totalPrice`.

## Availability and Pricing

Before order:

- `POST /availability/check` - Validate config against provider capacity
- `POST /availability/alternatives` - Suggest alternatives when unavailable
- `POST /pricing/preview` - Estimated customer total for plan and config

## Admin UI

The billing console provides administration routes for service types and service plans. Provider dropdown and dynamic config fields are driven by `GET /service-types/providers` and server type endpoints.

## Architecture

```mermaid
flowchart LR
    Admin[Admin Console] --> API[Billing Manager]
    Public[Public Site] --> API
    API --> Registry[ProviderRegistryService]
    Registry --> Hetzner[Hetzner API]
    Registry --> DO[DigitalOcean API]
    Registry --> Plugins[Dynamic Metadata Plugins]
    API --> DB[(PostgreSQL)]
    DB --> ST[Service Types]
    DB --> SP[Service Plans]
```

## Related documentation

- **[Subscriptions](./subscriptions.md)** Ordering against plans
- **[Server Provisioning](./server-provisioning.md)** Provider provisioning behavior
- **[Dynamic Provider Plugins](./dynamic-provider-plugins.md)** Extra providers and UI metadata
- **[CloudInit Configs](./cloud-init-configs.md)** Custom service templates
- **[Multi-tenancy](./multi-tenancy.md)** Tenant-scoped catalog

---

_See [Billing Manager OpenAPI](/spec/billing-manager/openapi.yaml) for DTO schemas._
