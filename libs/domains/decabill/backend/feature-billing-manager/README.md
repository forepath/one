# Billing Feature

Backend billing module providing subscription management, backorders, availability checks, and custom invoicing with ZUGFeRD PDFs and Stripe payments.

## Contents

- WebSocket dashboard status stream: see [`spec/asyncapi.yaml`](spec/asyncapi.yaml) (namespace `billing`, permission-locked; mirrors REST subscription ownership).
- WebSocket project board stream: see [`spec/asyncapi.yaml`](spec/asyncapi.yaml) (namespace `projects`, room `project:{projectId}`; see [`docs/project-board-realtime.mmd`](docs/project-board-realtime.mmd)).
- **Projects:** Customer-assigned work tracking with admin CRUD, milestones, tickets, time entries, KPI summaries, and `POST /admin/billing/projects/{projectId}/bill-time` (see [`docs/project-bill-time.mmd`](docs/project-bill-time.mmd)).
- Service types and plans (admin endpoints), including optional per-plan customer geography selection when the provider schema supports it.
- CloudInit config templates (admin CRUD) and order-fields for custom service plans.
- Subscription ordering, cancel, resume, and statutory withdrawal for authenticated users.
- Backorder management for provider capacity failures.
- Availability snapshots and pricing previews.
- Invoice issuance in Postgres with ZUGFeRD-style PDFs (EN 16931 XML embedded), preview, download, void, partial credit notes on statutory withdrawal, and Stripe checkout.
- **Open positions and user billing day:** Recurring and final subscription charges are recorded as open positions.
  On each user's billing day (default: day of month of registration, capped at 28), one accumulated invoice per user
  is created with all of that user's unbilled positions as line items. This reduces the number of invoices (one per
  user per billing day). The user billing day is independent of the service plan's `billing_day_of_month`.
- Customer profile management for invoicing metadata.
- **Admin manual invoices:** Draft → edit → issue workflow via `/admin/billing/invoices/manual` (see `docs/agenstra/features/billing-administration.md`).
- **Admin customer profiles:** CRUD via `/admin/billing/customer-profiles` (admin only).
- Usage-based pricing supported via usage records.

## Auth

All endpoints require authentication. Admin-only routes use the same role guards as the agent controller:

- @KeycloakRoles(UserRole.ADMIN)
- @UsersRoles(UserRole.ADMIN)

API key auth is supported through the shared HybridAuthGuard at the app level.

## Multi-tenancy

- Clients send `X-Tenant` on HTTP requests (frontend: `billing.tenantId` in runtime config; defaults to `default`).
- Server validates against `TENANTS` env (comma-separated; includes `default` unless `TENANTS_ALLOW_DEFAULT=false`).
- Per-tenant billing console URLs for Stripe return redirects: `BILLING_FRONTEND_URL` (default tenant) and `TENANT_FRONTEND_URLS` on the backend.
- Users, service types, invoices, and subscriptions are scoped per tenant; same email can register separately per tenant.
- Background jobs iterate all configured tenants. Stripe webhooks resolve tenant from checkout session metadata.

### API key auth and tenant scope

When **`AUTHENTICATION_METHOD=api-key`** (or api-key is inferred from **`STATIC_API_KEY`**):

- **`STATIC_API_KEY_TENANT_ID`** (optional) — when set, API key requests are only accepted when **`X-Tenant`** matches this value.
- When **`STATIC_API_KEY_TENANT_ID`** is **unset**, a valid **`STATIC_API_KEY`** grants **admin access to every tenant** listed in **`TENANTS`**, selected per request via **`X-Tenant`**. This is **intentional and accepted** (single shared automation key); see **[AR-007](../../../docs/agenstra/security/accepted-risks.md#ar-007--billing-multi-tenant-api-key-scope-static_api_key_tenant_id-unset)**.
- Interactive auth (**keycloak** / **users**) always enforces the user’s **`tenant_id`** regardless of the above.

## Environment

- `TENANTS` (optional; comma-separated tenant ids, e.g. `one,two`) – allowed tenant ids for `X-Tenant` requests. Includes `default` unless `TENANTS_ALLOW_DEFAULT=false`. When unset or empty and default is allowed, only `default` is allowed.
- `TENANTS_ALLOW_DEFAULT` (optional; default allow) – set to `false` to exclude `default` from the allowlist. Missing, blank, or `default` **`X-Tenant`** values are then rejected.
- `STATIC_API_KEY_TENANT_ID` (optional) – when set, API key auth is only accepted for this tenant id (must match `X-Tenant`). When unset, one **`STATIC_API_KEY`** may access **all** configured tenants via **`X-Tenant`** (accepted risk **AR-007**).
- Public catalog (`/public/service-plan-offerings`) is unauthenticated; tenant is selected via `X-Tenant` (defaults to `default`). Restrict allowed tenants with `TENANTS`.
- `BILLING_FRONTEND_URL` (optional; default derived from `STRIPE_CHECKOUT_SUCCESS_URL` origin or `http://localhost:4500`) – billing console base URL for the `default` tenant; used for Stripe success/cancel redirects.
- `TENANT_FRONTEND_URLS` (optional; `tenantId=https://billing.example.com` pairs, comma-separated) – per-tenant billing console base URLs for Stripe return redirects.
- BILLING*ISSUER*\* (name, VAT ID, address, email, IBAN) and BILLING_TAX_RATE_STANDARD / BILLING_TAX_RATE_REDUCED
- BILLING_STATUTORY_WITHDRAWAL_PERIOD_DAYS (default 14) — statutory withdrawal window after provisioning
- BILLING_INVOICE_PDF_STORAGE_PATH, BILLING_DEFAULT_PAYMENT_PROCESSOR
- STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_CHECKOUT_SUCCESS_URL, STRIPE_CHECKOUT_CANCEL_URL (path portion used with tenant frontend base; legacy full URL still sets default-tenant origin)
- DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD, DB_DATABASE
- HETZNER_API_TOKEN
- DIGITALOCEAN_API_TOKEN
- OPEN_POSITION_INVOICE_SCHEDULER_INTERVAL (optional; default 86400000 ms = daily)
- SUBSCRIPTION_UPDATE_SCHEDULER_INTERVAL (optional; default 86400000 ms = 24 hours; SSH update scheduler)
- CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID (for DNS A record creation on provisioned servers)
- DNS_BASE_DOMAIN (optional; default `spirde.com`) – base domain for FQDN in SSL certificates and CORS
- `WEBSOCKET_PORT` (optional; default `8082`) – Socket.IO port for the billing status gateway (HTTP REST stays on `PORT`, default 3200)
- `WEBSOCKET_NAMESPACE` (optional; default `billing`) – Socket.IO namespace path segment
- `PROJECTS_WEBSOCKET_NAMESPACE` (optional; default `projects`) – Project board Socket.IO namespace path segment
- `STATUS_POLL_INTERVAL` (optional; default `15000`) – default dashboard status poll interval in **milliseconds**; optional `subscribeDashboardStatus` body field `pollIntervalMs` is clamped between 10s and 120s
- `WEBSOCKET_CORS_ORIGIN` (optional; default `*`) – Socket.IO CORS `origin` (same pattern as agent controller / agent manager)

## Users Authentication

When AUTHENTICATION_METHOD=users, this service uses a local users table identical to the agent-controller schema.
The users table migration is compiled from `libs/domains/identity/backend/util-auth/src/lib/migrations/1765000000000_CreateUsersTable.ts` into the billing manager deploy artifact.

## Customer Profile

Use `GET /customer-profile` to retrieve the profile and `POST /customer-profile` to update it. Stripe customer IDs are stored on the profile when payments are initiated.

**Required for ordering (step 0):** Subscription creation (`POST /subscriptions`) requires a complete customer billing
profile. The backend returns 400 if the profile is missing or incomplete. Required fields: first name, last name, email,
address line, city, country. See `docs/billing-profile-required-for-order-spec.md` and `docs/sequence-subscription-order.mmd`.

Usage records can be posted to `POST /usage/record` and will be included in invoice creation if a `usagePayload` with
`totalCost` or `usageCost` is present, or when `units` and `unitPrice` are provided.

## Provider details

`GET /service-types/providers` returns all registered provisioning providers with id, display name, and optional config schema. This is used by the billing console to show a provider dropdown when creating service types and to render provider default config fields when creating/editing service plans. Providers are registered at startup (e.g. Hetzner, DigitalOcean) via `ProviderRegistryService`; additional metadata can be loaded from `DYNAMIC_BILLING_PROVIDER_METADATA`.

**Dynamic provider plugins:**

- `DYNAMIC_PAYMENT_PROCESSORS` - Comma-separated extra payment processor packages (critical; use with `DYNAMIC_PROVIDERS_FAIL_FAST=true` in production)
- `DYNAMIC_BILLING_PROVIDER_METADATA` - Comma-separated packages exporting `providerMetadata` for the billing UI registry
- `DYNAMIC_PROVIDERS_FAIL_FAST` - When `true`, abort startup if critical dynamic providers fail to load
- `DYNAMIC_PROVIDER_PLUGIN_PATH` - Plugin root for post-build loading (compose default: `/var/lib/forepath/provider-plugins`)
- `DYNAMIC_PROVIDER_PLUGIN_INSTALL` - Startup `npm install` targets into the plugin path

Plugins can be baked into the billing backend deploy graph or mounted after image build. See `@forepath/shared/backend/util-dynamic-provider-registry` README and `apps/decabill/backend-billing-manager/docker-compose.yaml` (`./provider-plugins` volume).

**Config schema shape:** The optional `configSchema` is a JSON-schema-like object with a `properties` map. Each property may include:

- `type`: `'string'` or `'number'`
- `description`: optional label/help text
- `enum`: optional array of allowed values (e.g. `['fsn1', 'nbg1']`). When present, the billing console renders a select instead of a text/number input.
- `scope`: optional `server` or `product`. Server fields (`serverType`, geography, `firewallId`) appear under **Provider default config**; product fields appear under **Product defaults** when required by selected customer options.
- `productServices`: optional list of `controller` and/or `manager` for product-scoped fields.

**Base price from field:** The schema may include a top-level `basePriceFromField` (e.g. `'serverType'`). When set, the billing console fetches options from `GET /service-types/providers/:providerId/server-types` for that field and uses the selected option’s `priceMonthly` as the plan base price when the user selects a server type.

**Server types endpoint:** `GET /service-types/providers/:providerId/server-types` returns server types with specs and pricing for the given provider (e.g. `hetzner`, `digital-ocean`). Used by the billing console to show a server type dropdown (name, cores, memory, disk, price) and to auto-set the plan base price when `configSchema.basePriceFromField` is `'serverType'`.

**Customer location selection:** On each service plan, `allowCustomerLocationSelection` (default `false`) controls whether `POST /subscriptions` accepts `region` or `location` in `requestedConfig` to override `providerConfigDefaults`. The admin UI only shows this option when the service type’s merged schema defines `region` or `location` as a string with a non-empty `enum` (same rule as `providerConfigSchemaSupportsLocationSelection` in code). Setting the flag to `true` for other schemas returns 400. When the flag is `false`, geography keys are removed from `requestedConfig` before merging so clients cannot override the plan default. For Hetzner vs DigitalOcean, `region` and `location` are treated as aliases for provisioning geography; after merge, both keys are mirrored to the resolved value for availability and provisioning.

## Provisioning Config

Subscription creation (`POST /subscriptions`) first checks that the customer billing profile is complete (see Customer
Profile above); otherwise the request is rejected with 400. It then accepts provider-specific configuration that is
validated against the service type schema.
For provisioning, the following provider-specific config keys are used:

- `hetzner`:
  - `location` or `region` (string; registered default schema uses `location` with enum; values are aliases server-side)
  - `serverType` (string, required; options and price from GET .../server-types; selection can auto-set plan base price)
  - `firewallId` (number, optional)
- `digital-ocean`:
  - `region` (string, required by default schema; enum pre-populated in UI)
  - `serverType` (string, required; options and price from GET .../server-types; selection can auto-set plan base price)

Optional instance configuration (requestedConfig) can include authentication (users, api-key, keycloak), SMTP, and optional provisioning tokens so the instance can provision additional servers itself:

- hetznerApiToken (string, optional) – Hetzner API token for nested provisioning from the instance
- digitaloceanApiToken (string, optional) – DigitalOcean API token for nested provisioning from the instance

The cloud-init user data installs Docker and deploys a docker-compose stack containing:

- postgres
- backend-agent-controller
- frontend-agent-console

Nginx proxies traffic to the backend/frontend containers and serves ACME HTTP-01 challenges from
`/.well-known/acme-challenge/`.

TLS is provisioned with Let's Encrypt using Certbot (pip/venv installation under `/opt/certbot`) from cloud-init:

- initial bootstrap certificate is generated with OpenSSL so NGINX can start immediately
- certs are requested via `certbot certonly --webroot` for the instance FQDN (`hostname.DNS_BASE_DOMAIN`)
- on success, the NGINX config is switched to `/etc/letsencrypt/live/<fqdn>/fullchain.pem` and `privkey.pem`
- automatic renewal is configured in `/etc/crontab` and reloads the NGINX container via deploy-hook

To register a real ACME account email, set `LETS_ENCRYPT_EMAIL` in the billing-manager environment.
Cloud-init also waits for the DNS A record (`proxied: false`) to resolve to the provisioned host before requesting
the certificate.

## Server info

`GET /subscriptions/{subscriptionId}/items/{itemId}/server-info` returns live server info for a provisioned subscription
item (status, public/private IP, hostname, FQDN).

## Subscription item update scheduler

A scheduler runs at a configurable interval (`SUBSCRIPTION_UPDATE_SCHEDULER_INTERVAL`, default 24 hours), connects to each
provisioned subscription host via SSH (using the key stored on the subscription item), and runs
`docker compose up -d --pull=always` in the app directory (`/opt/agent-controller` or `/opt/agent-manager`). This pulls
the latest images and recreates containers so updates are applied. Failures are logged on the host to
`/var/log/agent-controller-update.log` or `/var/log/agent-manager-update.log`. See
`docs/sequence-subscription-item-update.mmd` for the flow.

## Diagrams

- docs/overview.mmd
- docs/sequence-subscription-order.mmd (order flow: step 0 = profile completeness, then availability and provisioning)
- docs/billing-profile-required-for-order-spec.md (spec for profile-required-for-order behavior)
- docs/sequence-invoicing.mmd
- docs/sequence-open-positions-billing-day.mmd (open positions, user billing day, billing-day invoice scheduler)
- docs/sequence-backorder-retry.mmd
- docs/sequence-subscription-item-update.mmd (update scheduler: SSH + docker compose pull)
- docs/provisioning-architecture.mmd
- docs/subscription-lifecycle.mmd
- docs/auth-flow.mmd
- docs/sequence-invoice-payment.mmd (Stripe checkout + webhook)
- docs/manual-invoice-administration.mmd (admin manual invoice draft → issue flow)
- docs/project-board-realtime.mmd (project board WebSocket setProject and room broadcasts)
- docs/project-bill-time.mmd (admin bill-time → issued invoice)
- docs/config-validation-flow.mmd
- docs/customer-location-selection.md (plan flag, customer override rules, backorder retry)

## License

This library is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**. See [LICENSE](./LICENSE) for the full text.
