# Environment Configuration

Complete reference for environment variables used in Decabill.

## Backend Billing Manager

### Application Configuration

| Variable                       | Description                              | Default        |
| ------------------------------ | ---------------------------------------- | -------------- |
| `HOST`                         | HTTP bind address                        | `0.0.0.0`      |
| `PORT`                         | HTTP API port                            | `3200`         |
| `WEBSOCKET_PORT`               | WebSocket gateway port                   | `8082`         |
| `WEBSOCKET_NAMESPACE`          | Dashboard status Socket.IO namespace     | `billing`      |
| `PROJECTS_WEBSOCKET_NAMESPACE` | Project board Socket.IO namespace        | `projects`     |
| `WEBSOCKET_CORS_ORIGIN`        | WebSocket CORS origins (comma-separated) | `*` in compose |
| `NODE_ENV`                     | `development` or `production`            | `development`  |

### Database Configuration

| Variable      | Description       | Default     |
| ------------- | ----------------- | ----------- |
| `DB_HOST`     | Database host     | `localhost` |
| `DB_PORT`     | Database port     | `5432`      |
| `DB_USERNAME` | Database username | `postgres`  |
| `DB_PASSWORD` | Database password | `postgres`  |
| `DB_DATABASE` | Database name     | `postgres`  |

### Authentication

| Variable                   | Description                                                                  |
| -------------------------- | ---------------------------------------------------------------------------- |
| `AUTHENTICATION_METHOD`    | Explicit: `api-key`, `keycloak`, or `users`. If unset, inferred (see DR-004) |
| `STATIC_API_KEY`           | Static API key when using api-key mode                                       |
| `STATIC_API_KEY_TENANT_ID` | Optional tenant bind for API key auth (see DR-002)                           |
| `DISABLE_SIGNUP`           | When `true`, disables self-registration for users mode                       |
| `JWT_SECRET`               | Required for users mode                                                      |
| `KEYCLOAK_*`               | Keycloak URL, realm, client id/secret, token validation                      |

### Multi-tenancy

Billing data and users are partitioned by **`tenant_id`**. HTTP clients send **`X-Tenant`**; the billing console attaches it via `environment.billing.tenantId` (defaults to `default`).

| Variable                   | Description                                                                                                                                                          |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TENANTS`                  | Comma-separated tenant ids allowed for **`X-Tenant`**. Includes `default` unless disabled below. Unset means only `default` when default is allowed.                 |
| `TENANTS_ALLOW_DEFAULT`    | When `false`, excludes `default` from the allowlist and rejects missing, blank, or `default` **`X-Tenant`** values. Unset or any other value keeps current behavior. |
| `STATIC_API_KEY_TENANT_ID` | When set with **`STATIC_API_KEY`**, API key requests are accepted only when **`X-Tenant`** matches.                                                                  |
| `BILLING_FRONTEND_URL`     | Billing console base URL for the `default` tenant (Stripe return redirects).                                                                                         |
| `TENANT_FRONTEND_URLS`     | Per-tenant console URLs: `tenantId=https://…` pairs, comma-separated.                                                                                                |

**API key scope (accepted risk [DR-002](../security/accepted-risks.md#dr-002--billing-multi-tenant-api-key-scope-static_api_key_tenant_id-unset)):** With **`STATIC_API_KEY`** and **without** **`STATIC_API_KEY_TENANT_ID`**, one deployment key grants **admin access to every tenant** in **`TENANTS`**, selected per request via **`X-Tenant`**. Set **`STATIC_API_KEY_TENANT_ID`** to bind the key to one tenant, or use **keycloak** / **users** for interactive multi-tenant console access.

### CORS and Rate Limiting

| Variable             | Description                                                         |
| -------------------- | ------------------------------------------------------------------- |
| `CORS_ORIGIN`        | Allowed CORS origins (comma-separated). **Required in production.** |
| `RATE_LIMIT_ENABLED` | Enable rate limiting (default `true` in production)                 |
| `RATE_LIMIT_TTL`     | Window in seconds (default `60`)                                    |
| `RATE_LIMIT_LIMIT`   | Max requests per window (default `100`)                             |

### Encryption and Issuer Details

| Variable                                   | Description                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------ |
| `ENCRYPTION_KEY`                           | Encrypts sensitive stored data (API tokens, snapshots, webhook auth/signing secrets) |
| `BILLING_ISSUER_*`                         | Legal entity on invoices and public withdrawal addressee (name, VAT, address, bank)  |
| `PUBLIC_WITHDRAWAL_CONFIRMATION_TTL_HOURS` | Hours until a public withdrawal confirmation code expires (default `48`)             |
| `BILLING_TAX_RATE_STANDARD`                | Default standard tax rate (default `19`)                                             |
| `BILLING_TAX_RATE_REDUCED`                 | Reduced tax rate (default `7`)                                                       |
| `BILLING_STATUTORY_WITHDRAWAL_PERIOD_DAYS` | Days after provisioning during which statutory withdrawal is allowed (default `14`)  |
| `BILLING_INVOICE_PDF_STORAGE_PATH`         | PDF output path (default `/data/invoices`)                                           |
| `BILLING_SKIP_FILE_CACHE`                  | Skip PDF file cache when `true`                                                      |

### DATEV EXTF Export

Monthly DATEV Buchungsstapel exports (category 21) with optional PDF document bundle. Disabled entirely when `BILLING_DATEV_EXPORT_ENABLED=false` (no jobs, admin routes return 404, billing console hides the DATEV page via capabilities).

| Variable                                       | Description                                                                 | Default               |
| ---------------------------------------------- | --------------------------------------------------------------------------- | --------------------- |
| `BILLING_DATEV_EXPORT_ENABLED`                 | Master kill switch                                                          | `true`                |
| `BILLING_DATEV_EXPORT_STORAGE_PATH`            | Export ZIP root (shared volume on api/worker/scheduler)                     | `/data/datev-exports` |
| `BILLING_DATEV_EXPORT_CRON`                    | BullMQ cron for monthly coordinator (1st of month)                          | `0 0 1 * *`           |
| `BILLING_DATEV_EXPORT_TIMEZONE`                | Timezone for cron and previous-month period calculation                     | `Europe/Berlin`       |
| `BILLING_DATEV_CONSULTANT_NUMBER`              | DATEV Beraternummer (required per tenant for export)                        | —                     |
| `BILLING_DATEV_CLIENT_NUMBER`                  | DATEV Mandantennummer (required per tenant for export)                      | —                     |
| `BILLING_DATEV_CHART_OF_ACCOUNTS`              | `SKR03` or `SKR04`                                                          | `SKR03`               |
| `BILLING_DATEV_ACCOUNT_LENGTH`                 | Sachkontenlänge in EXTF header                                              | `4`                   |
| `BILLING_DATEV_REVENUE_ACCOUNT_STANDARD`       | Revenue account for 19% (SKR03 default `8400`, SKR04 `4400`)                | env / chart default   |
| `BILLING_DATEV_REVENUE_ACCOUNT_REDUCED`        | Revenue account for 7% (SKR03 default `8300`, SKR04 `4300`)                 | env / chart default   |
| `BILLING_DATEV_DEBTOR_ACCOUNT_START`           | First debtor number in range                                                | `10000`               |
| `BILLING_DATEV_DEBTOR_ACCOUNT_END`             | Last debtor number in range                                                 | `69999`               |
| `BILLING_DATEV_BU_KEY_STANDARD`                | Override BU-Schlüssel for standard tax (empty for Automatikkonten)          | empty                 |
| `BILLING_DATEV_BU_KEY_REDUCED`                 | Override BU-Schlüssel for reduced tax                                       | empty                 |
| `BILLING_DATEV_EXPORT_INCLUDE_DOCUMENTS`       | Include PDF bundle + Beleglink in Buchungsstapel                            | `true`                |
| `BILLING_DATEV_EXPORT_DICTATION_ABBR`          | Diktatkürzel in EXTF header                                                 | `DEC`                 |
| `BILLING_DATEV_FISCAL_YEAR_START_MONTH`        | Wirtschaftsjahresbeginn (1–12)                                              | `1`                   |
| `BILLING_DATEV_TENANT_CONFIG`                  | JSON map of per-tenant (and optional `unified`) DATEV overrides             | —                     |
| `BILLING_DATEV_UNIFIED_EXPORT_ENABLED`         | Enable cross-tenant consolidated monthly export                             | `false`               |
| `BILLING_DATEV_UNIFIED_EXPORT_ALLOWED_TENANTS` | Comma-separated tenant ids allowed to list/trigger/download unified exports | `default` when unset  |

Per-tenant exports are scoped to the request **`X-Tenant`**. Unified exports aggregate all configured tenants but are only accessible from allowlisted operator tenants. Validate sample exports with **DatevFormatPruefProgramm** before production handoff.

### Stripe and Payment Processors

| Variable                            | Description                                             |
| ----------------------------------- | ------------------------------------------------------- |
| `BILLING_DEFAULT_PAYMENT_PROCESSOR` | Default processor (default `stripe`)                    |
| `STRIPE_SECRET_KEY`                 | Stripe secret API key                                   |
| `STRIPE_WEBHOOK_SECRET`             | Stripe webhook signing secret                           |
| `STRIPE_CHECKOUT_SUCCESS_URL`       | Redirect after successful checkout                      |
| `STRIPE_CHECKOUT_CANCEL_URL`        | Redirect after cancelled checkout                       |
| `DYNAMIC_PAYMENT_PROCESSORS`        | Comma-separated extra payment processor packages        |
| `DYNAMIC_BILLING_PROVIDER_METADATA` | Extra billing provider metadata packages                |
| `DYNAMIC_PROVIDERS_FAIL_FAST`       | Abort startup if critical dynamic provider fails        |
| `DYNAMIC_PROVIDER_PLUGIN_PATH`      | Plugin root (e.g. `/var/lib/forepath/provider-plugins`) |
| `DYNAMIC_PROVIDER_PLUGIN_INSTALL`   | `npm install` targets at container startup              |

### Email (SMTP)

| Variable        | Description      | Local default       |
| --------------- | ---------------- | ------------------- |
| `SMTP_HOST`     | SMTP server host | `mailhog`           |
| `SMTP_PORT`     | SMTP port        | `1025`              |
| `SMTP_USER`     | SMTP username    | empty               |
| `SMTP_PASSWORD` | SMTP password    | empty               |
| `EMAIL_FROM`    | From address     | `noreply@localhost` |

### Provisioning and DNS

| Variable                 | Description                                             |
| ------------------------ | ------------------------------------------------------- |
| `HETZNER_API_TOKEN`      | Hetzner Cloud API token (default for all service types) |
| `DIGITALOCEAN_API_TOKEN` | DigitalOcean API token (default for all service types)  |
| `CLOUDFLARE_API_TOKEN`   | Cloudflare API token                                    |
| `CLOUDFLARE_ZONE_ID`     | Cloudflare zone for DNS records                         |
| `DNS_BASE_DOMAIN`        | Base domain for provisioned hostnames                   |

Per-service-type overrides for `HETZNER_API_TOKEN` and `DIGITALOCEAN_API_TOKEN` can be configured in the billing console under **Administration → Service Providers → Provider defaults**. Overrides are stored encrypted in the database using `ENCRYPTION_KEY` (AES-256-GCM). When unset for a service type, the global environment variables above apply.

Provisioning SSH posture is documented under accepted risk **[DR-001](../security/accepted-risks.md#dr-001--provisioning-ssh-cloud-init-templates)**.

### Scheduler Intervals (BullMQ Coordinators)

These variables control repeatable **coordinator** intervals in milliseconds:

| Variable                                   | Default    | Purpose                          |
| ------------------------------------------ | ---------- | -------------------------------- |
| `BILLING_SCHEDULER_INTERVAL`               | `60000`    | Subscription billing coordinator |
| `BILLING_SCHEDULER_BATCH_SIZE`             | `100`      | Batch size for billing runs      |
| `EXPIRATION_SCHEDULER_INTERVAL`            | `60000`    | Subscription expiration          |
| `EXPIRATION_SCHEDULER_BATCH_SIZE`          | `100`      | Expiration batch size            |
| `WITHDRAWAL_SCHEDULER_INTERVAL`            | `60000`    | Subscription withdrawal teardown |
| `WITHDRAWAL_SCHEDULER_BATCH_SIZE`          | `100`      | Withdrawal batch size            |
| `PROVISIONING_SCHEDULER_INTERVAL`          | `30000`    | Subscription server provisioning |
| `PROVISIONING_SCHEDULER_BATCH_SIZE`        | `100`      | Provisioning batch size          |
| `REMINDER_SCHEDULER_INTERVAL`              | `3600000`  | Renewal reminders                |
| `REMINDER_SCHEDULER_BATCH_SIZE`            | `100`      | Reminder batch size              |
| `REMINDER_DAYS`                            | `3`        | Days before renewal to remind    |
| `BACKORDER_RETRY_INTERVAL_MS`              | `60000`    | Backorder retry coordinator      |
| `BACKORDER_RETRY_BATCH_SIZE`               | `100`      | Backorder batch size             |
| `INVOICE_OVERDUE_SCHEDULER_INTERVAL`       | `86400000` | Invoice overdue coordinator      |
| `INVOICE_OVERDUE_SCHEDULER_BATCH_SIZE`     | `100`      | Overdue batch size               |
| `OPEN_POSITION_INVOICE_SCHEDULER_INTERVAL` | `86400000` | Open position invoicing          |
| `SUBSCRIPTION_UPDATE_SCHEDULER_INTERVAL`   | `86400000` | Subscription item updates        |
| `STATUS_POLL_INTERVAL`                     | `15000`    | Dashboard status polling         |

DATEV export uses a **cron** coordinator (not `everyMs`):

| Coordinator job name       | Env variables                                                | Default schedule      |
| -------------------------- | ------------------------------------------------------------ | --------------------- |
| `datev-export.coordinator` | `BILLING_DATEV_EXPORT_CRON`, `BILLING_DATEV_EXPORT_TIMEZONE` | `0 0 1 * *` (monthly) |

Registered only when `BILLING_DATEV_EXPORT_ENABLED=true`. Stale repeatables are removed on scheduler startup when the feature is disabled.

See **[Background Jobs](./background-jobs.md)** for queue roles and job names.

## Frontend Applications (Express SSR)

**decabill-frontend-billing-console** and **decabill-frontend-docs** use the shared Express layer for `GET /config` and security headers.

### Runtime Configuration (`CONFIG`)

| Variable                     | Description                                                                      |
| ---------------------------- | -------------------------------------------------------------------------------- |
| `CONFIG`                     | URL to remote JSON merged at runtime via `/config`                               |
| `CONFIG_ALLOWED_HOSTS`       | Hostname allowlist for `CONFIG`. **Required in production** when `CONFIG` is set |
| `CONFIG_ALLOW_INSECURE_HTTP` | Allow `http://` CONFIG URLs in production when `true` (default `false`)          |
| `CONFIG_ALLOW_INTERNAL_HOST` | Allow private/loopback CONFIG targets when `true` (default `false`)              |
| `CONFIG_FETCH_TIMEOUT_MS`    | Fetch timeout (default `10000`)                                                  |
| `CONFIG_FETCH_MAX_BYTES`     | Max response size (default `262144`)                                             |
| `CONFIG_JSON_MAX_DEPTH`      | Max JSON depth (default `12`)                                                    |
| `CONFIG_JSON_MAX_KEYS`       | Max JSON keys (default `512`)                                                    |

### Content Security Policy (Express)

| Variable                | Description                                                               |
| ----------------------- | ------------------------------------------------------------------------- |
| `CSP_ENFORCE`           | Enforcing CSP when `true`; report-only otherwise (see DR-003)             |
| `CSP_CONNECT_SRC_EXTRA` | Extra `connect-src` origins (billing console often needs billing API URL) |
| `CSP_SCRIPT_SRC_EXTRA`  | Extra `script-src` origins                                                |
| `CSP_STYLE_SRC_EXTRA`   | Extra `style-src` origins                                                 |
| `CSP_IMG_SRC_EXTRA`     | Extra `img-src` origins                                                   |
| `CSP_FONT_SRC_EXTRA`    | Extra `font-src` origins                                                  |
| `CSP_WORKER_SRC_EXTRA`  | Extra `worker-src` origins                                                |
| `CSP_DEFAULT_SRC_EXTRA` | Extra `default-src` origins                                               |
| `CSP_BASE_URI_EXTRA`    | Extra `base-uri` origins                                                  |
| `CSP_FRAME_ANCESTORS`   | Full override for `frame-ancestors`                                       |

Default `connect-src` allows `'self'`, `https:`, and `wss:`. In production, plain `http:` / `ws:` require explicit origins via `CSP_CONNECT_SRC_EXTRA`.

Billing console compose default: `CSP_CONNECT_SRC_EXTRA=http://host.docker.internal:3200`.

### Billing Console Server

| Variable         | Description              | Default                |
| ---------------- | ------------------------ | ---------------------- |
| `PORT`           | HTTP port                | `4500` (console image) |
| `HOST`           | Bind address             | `0.0.0.0`              |
| `DEFAULT_LOCALE` | Default locale           | `en`                   |
| `API_URL`        | Build-time API URL       | See app config         |
| `WEBSOCKET_URL`  | Build-time WebSocket URL | See app config         |

Runtime `/config` JSON may include `billing.projectsWebsocketUrl` (for example `ws://localhost:8082/projects`). When omitted, the billing console derives the projects URL from `billing.websocketUrl`.

### Docs Server

| Variable         | Description    | Default           |
| ---------------- | -------------- | ----------------- |
| `PORT`           | HTTP port      | `4200`            |
| `HOST`           | Bind address   | `0.0.0.0`         |
| `DEFAULT_LOCALE` | Default locale | `en`              |
| `CSP_ENFORCE`    | Enforce CSP    | `true` in compose |

## Redis and BullMQ (Background Jobs)

Used by **backend billing manager only**. See **[Background Jobs](./background-jobs.md)**.

| Variable                    | Description                            | Default                               |
| --------------------------- | -------------------------------------- | ------------------------------------- |
| `REDIS_HOST`                | Redis host                             | `localhost` (compose: `redis`)        |
| `REDIS_PORT`                | Redis port inside container/network    | `6379`                                |
| `REDIS_HOST_PORT`           | Host port published by compose         | `6380`                                |
| `REDIS_PASSWORD`            | Optional password                      | empty                                 |
| `REDIS_DB`                  | Redis DB index                         | `0`                                   |
| `REDIS_KEY_PREFIX`          | Key prefix                             | `decabill-billing`                    |
| `QUEUE_ROLE`                | `api`, `scheduler`, `worker`, or `all` | `all` locally; `api` in API container |
| `QUEUE_WORKER_CONCURRENCY`  | Worker concurrency                     | `5`                                   |
| `QUEUE_BULL_BOARD_ENABLED`  | Enable Bull Board on API / `all`       | `true` in dev API compose             |
| `QUEUE_BULL_BOARD_PATH`     | Bull Board path                        | `/admin/queues`                       |
| `QUEUE_BULL_BOARD_USERNAME` | Bull Board HTTP Basic user             | `admin`                               |
| `QUEUE_BULL_BOARD_PASSWORD` | Bull Board HTTP Basic password         | required in production                |

## Environment-Specific Defaults

### Development

- `NODE_ENV=development`
- `CORS_ORIGIN=*` (all origins allowed)
- `RATE_LIMIT_ENABLED=false`
- `QUEUE_ROLE=all` for single-process local runs

### Production

- `NODE_ENV=production`
- `CORS_ORIGIN` **required**
- `RATE_LIMIT_ENABLED=true`
- `ENCRYPTION_KEY` **required** for encrypted fields
- Strong `STATIC_API_KEY` or Keycloak/users auth
- `QUEUE_BULL_BOARD_PASSWORD` **required** when Bull Board is enabled
- `CONFIG_ALLOWED_HOSTS` when `CONFIG` is set on frontends

## Related Documentation

- **[Local Development](./local-development.md)** - Local setup
- **[Docker Deployment](./docker-deployment.md)** - Containerized deployment
- **[Production Checklist](./production-checklist.md)** - Production deployment
- **[Background Jobs](./background-jobs.md)** - BullMQ roles and coordinators
- **[Accepted risks](../security/accepted-risks.md)** - DR-001, DR-002, DR-003, DR-004

---

_For feature-specific details, see [Features](../features/README.md)._
