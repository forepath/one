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

| Variable                   | Description                                                                                                           |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `AUTHENTICATION_METHOD`    | Explicit: `api-key`, `keycloak`, or `users`. If unset, inferred (see DR-004)                                          |
| `STATIC_API_KEY`           | Static API key when using api-key mode                                                                                |
| `STATIC_API_KEY_TENANT_ID` | Optional tenant bind for API key auth (see DR-002)                                                                    |
| `DISABLE_SIGNUP`           | When `true`, disables self-registration for users mode                                                                |
| `DISABLE_FORCE_LOGIN_2FA`  | When `true`, login 2FA is opt-in only; when unset/`false`, every users-mode login requires email OTP or enrolled TOTP |
| `PRODUCT_NAME`             | TOTP issuer label in authenticator apps (otpauth); defaults to `Forepath`                                             |
| `JWT_SECRET`               | Required for users and keycloak modes (sessions / PAT exchange)                                                       |
| `KEYCLOAK_*`               | Keycloak URL, realm, client id/secret, token validation                                                               |

### Multi-tenancy

Billing data and users are partitioned by **`tenant_id`**. HTTP clients send **`X-Tenant`**; the billing console attaches it via `environment.billing.tenantId` (defaults to `default`).

| Variable                   | Description                                                                                                                                                                                                                                                                |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TENANTS`                  | Comma-separated tenant ids allowed for **`X-Tenant`**. Includes `default` unless disabled below. Unset means only `default` when default is allowed.                                                                                                                       |
| `TENANTS_ALLOW_DEFAULT`    | When `false`, excludes `default` from the allowlist and rejects missing, blank, or `default` **`X-Tenant`** values. Unset or any other value keeps current behavior.                                                                                                       |
| `TENANTS_SHARED_NUMBERS`   | When `false`, invoice / subscription / customer / supplier / DATEV debtor and creditor numbers are allocated per tenant (same literal may exist in different tenants). Unset or any other value uses one shared pool (default). See [Numbering](../features/numbering.md). |
| `STATIC_API_KEY_TENANT_ID` | When set with **`STATIC_API_KEY`**, API key requests are accepted only when **`X-Tenant`** matches.                                                                                                                                                                        |
| `BILLING_FRONTEND_URL`     | Billing console base URL for the `default` tenant (Stripe return redirects).                                                                                                                                                                                               |
| `TENANT_FRONTEND_URLS`     | Per-tenant console URLs: `tenantId=https://…` pairs, comma-separated.                                                                                                                                                                                                      |

**API key scope (accepted risk [DR-002](../security/accepted-risks.md#dr-002-billing-multi-tenant-api-key-scope-static_api_key_tenant_id-unset)):** With **`STATIC_API_KEY`** and **without** **`STATIC_API_KEY_TENANT_ID`**, one deployment key grants **admin access to every tenant** in **`TENANTS`**, selected per request via **`X-Tenant`**. Set **`STATIC_API_KEY_TENANT_ID`** to bind the key to one tenant, or use **keycloak** / **users** for interactive multi-tenant console access.

### CORS and Rate Limiting

| Variable             | Description                                                         |
| -------------------- | ------------------------------------------------------------------- |
| `CORS_ORIGIN`        | Allowed CORS origins (comma-separated). **Required in production.** |
| `RATE_LIMIT_ENABLED` | Enable rate limiting (default `true` in production)                 |
| `RATE_LIMIT_TTL`     | Window in seconds (default `60`)                                    |
| `RATE_LIMIT_LIMIT`   | Max requests per window (default `100`)                             |

### Encryption and Issuer Details

| Variable                                   | Description                                                                                                                      |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `ENCRYPTION_KEY`                           | Encrypts sensitive stored data (API tokens, snapshots, webhook auth/signing secrets)                                             |
| `BILLING_ISSUER_*`                         | Legal entity on invoices and public withdrawal addressee (name, VAT, address, bank); also fallback for email brand header/footer |
| `PUBLIC_WITHDRAWAL_CONFIRMATION_TTL_HOURS` | Hours until a public withdrawal confirmation code expires (default `48`)                                                         |
| `BILLING_TAX_RATE_STANDARD`                | Issuer-country override for standard rate when EU table entry missing (default `19`)                                             |
| `BILLING_TAX_RATE_REDUCED`                 | Issuer-country override for reduced rate when EU table entry missing (default `7`)                                               |
| `BILLING_OSS_REGISTERED`                   | When `true`, always use destination-country VAT for EU B2C (skip €10k threshold ledger)                                          |
| `BILLING_OSS_THRESHOLD_EUR`                | Cross-border EU B2C net threshold (default `10000`)                                                                              |
| `BILLING_NON_EU_ISSUER_EU_B2B_CHARGE_VAT`  | When `true`, non-EU issuer → EU B2B charges customer-country VAT instead of default no-VAT                                       |
| `BILLING_STATUTORY_WITHDRAWAL_PERIOD_DAYS` | Days after provisioning (or price-migration restart) during which statutory withdrawal is allowed (default `14`)                 |
| `FILE_STORAGE_PROVIDER`                    | Active file storage backend: `local` (default) or `s3` (S3-compatible: AWS, R2, B2, Ceph, MinIO, …)                              |
| `FILE_STORAGE_ROOT`                        | Canonical file root for `local`; scopes live under `{root}/invoices` and `{root}/datev-exports` (compose default `/data`)        |
| `FILE_STORAGE_LEGACY_MIGRATION_ENABLED`    | When not `false`, startup copies non-empty legacy dirs into the canonical layout (default enabled; `local` only)                 |
| `FILE_STORAGE_S3_BUCKET`                   | Required when `FILE_STORAGE_PROVIDER=s3`: bucket name                                                                            |
| `FILE_STORAGE_S3_ACCESS_KEY_ID`            | Required when using `s3`: access key                                                                                             |
| `FILE_STORAGE_S3_SECRET_ACCESS_KEY`        | Required when using `s3`: secret key                                                                                             |
| `FILE_STORAGE_S3_REGION`                   | S3 region (default `auto`; follow your provider’s docs)                                                                          |
| `FILE_STORAGE_S3_ENDPOINT`                 | Custom S3 API endpoint for non-AWS providers (R2, B2, Ceph, MinIO, …)                                                            |
| `FILE_STORAGE_S3_FORCE_PATH_STYLE`         | `true`/`false`; defaults to `true` when an endpoint is set, otherwise `false`                                                    |
| `FILE_STORAGE_S3_KEY_PREFIX`               | Optional object key prefix (e.g. `decabill/prod`)                                                                                |
| `BILLING_INVOICE_PDF_STORAGE_PATH`         | **Deprecated.** Legacy migration source for invoice PDFs (was `/data/invoices`)                                                  |
| `BILLING_SKIP_FILE_CACHE`                  | Skip PDF file cache when `true`                                                                                                  |

### Automatic daily price recalculation

Nightly refresh of opt-in service-plan catalog prices from the provider. See [Automatic daily price recalculation](../features/automatic-price-recalculation.md). Disabled entirely when `BILLING_PRICE_RECALC_ENABLED=false` (no coordinator registration).

| Variable                        | Description                                         | Default         |
| ------------------------------- | --------------------------------------------------- | --------------- |
| `BILLING_PRICE_RECALC_ENABLED`  | Master kill switch for the nightly price-recalc job | `true`          |
| `BILLING_PRICE_RECALC_CRON`     | BullMQ cron for the coordinator                     | `0 0 * * *`     |
| `BILLING_PRICE_RECALC_TIMEZONE` | Timezone for cron and run-date (`YYYY-MM-DD`)       | `Europe/Berlin` |

Per-plan opt-in remains `autoRecalculatePriceDaily` (default `false`) on the service plan API/UI.

### DATEV EXTF Export

Monthly DATEV Buchungsstapel exports (category 21) with optional PDF document bundle. Disabled entirely when `BILLING_DATEV_EXPORT_ENABLED=false` (no jobs, admin routes return 404, billing console hides the DATEV page via capabilities).

| Variable                                       | Description                                                                 | Default              |
| ---------------------------------------------- | --------------------------------------------------------------------------- | -------------------- |
| `BILLING_DATEV_EXPORT_ENABLED`                 | Master kill switch                                                          | `true`               |
| `BILLING_DATEV_EXPORT_STORAGE_PATH`            | **Deprecated.** Legacy migration source for DATEV ZIPs                      | _(unset)_            |
| `BILLING_DATEV_EXPORT_CRON`                    | BullMQ cron for monthly coordinator (1st of month)                          | `0 0 1 * *`          |
| `BILLING_DATEV_EXPORT_TIMEZONE`                | Timezone for cron and previous-month period calculation                     | `Europe/Berlin`      |
| `BILLING_DATEV_CONSULTANT_NUMBER`              | DATEV Beraternummer (required per tenant for export)                        | -                    |
| `BILLING_DATEV_CLIENT_NUMBER`                  | DATEV Mandantennummer (required per tenant for export)                      | -                    |
| `BILLING_DATEV_CHART_OF_ACCOUNTS`              | `SKR03` or `SKR04`                                                          | `SKR03`              |
| `BILLING_DATEV_ACCOUNT_LENGTH`                 | Sachkontenlänge in EXTF header                                              | `4`                  |
| `BILLING_DATEV_REVENUE_ACCOUNT_STANDARD`       | Revenue account for 19% (SKR03 default `8400`, SKR04 `4400`)                | env / chart default  |
| `BILLING_DATEV_REVENUE_ACCOUNT_REDUCED`        | Revenue account for 7% (SKR03 default `8300`, SKR04 `4300`)                 | env / chart default  |
| `BILLING_DATEV_DEBTOR_ACCOUNT_START`           | First debtor number in range                                                | `10000`              |
| `BILLING_DATEV_DEBTOR_ACCOUNT_END`             | Last debtor number in range                                                 | `69999`              |
| `BILLING_DATEV_CREDITOR_ACCOUNT_START`         | First creditor number in range                                              | `70000`              |
| `BILLING_DATEV_CREDITOR_ACCOUNT_END`           | Last creditor number in range                                               | `99999`              |
| `BILLING_DATEV_EXPENSE_ACCOUNT_STANDARD`       | Expense G/L for standard tax (SKR03 default `4900`)                         | env / chart default  |
| `BILLING_DATEV_EXPENSE_ACCOUNT_REDUCED`        | Expense G/L for reduced tax                                                 | env / chart default  |
| `BILLING_DATEV_EXPENSE_ACCOUNT_REVERSE_CHARGE` | Expense G/L for reverse charge                                              | env / chart default  |
| `BILLING_DATEV_EXPENSE_ACCOUNT_OSS`            | Expense G/L for OSS                                                         | env / chart default  |
| `BILLING_DATEV_EXPENSE_ACCOUNT_THIRD_COUNTRY`  | Expense G/L for third country                                               | env / chart default  |
| `BILLING_DATEV_EXPENSE_BU_KEY_STANDARD`        | Override BU-Schlüssel for expense standard                                  | empty                |
| `BILLING_DATEV_EXPENSE_BU_KEY_REDUCED`         | Override BU-Schlüssel for expense reduced                                   | empty                |
| `BILLING_DATEV_BU_KEY_STANDARD`                | Override BU-Schlüssel for standard tax (empty for Automatikkonten)          | empty                |
| `BILLING_DATEV_BU_KEY_REDUCED`                 | Override BU-Schlüssel for reduced tax                                       | empty                |
| `BILLING_DATEV_EXPORT_INCLUDE_DOCUMENTS`       | Include PDF bundle + Beleglink in Buchungsstapel                            | `true`               |
| `BILLING_DATEV_EXPORT_DICTATION_ABBR`          | Diktatkürzel in EXTF header                                                 | `DEC`                |
| `BILLING_DATEV_FISCAL_YEAR_START_MONTH`        | Wirtschaftsjahresbeginn (1-12)                                              | `1`                  |
| `BILLING_DATEV_TENANT_CONFIG`                  | JSON map of per-tenant (and optional `unified`) DATEV overrides             | -                    |
| `BILLING_DATEV_UNIFIED_EXPORT_ENABLED`         | Enable cross-tenant consolidated monthly export                             | `false`              |
| `BILLING_DATEV_UNIFIED_EXPORT_ALLOWED_TENANTS` | Comma-separated tenant ids allowed to list/trigger/download unified exports | `default` when unset |

Per-tenant exports are scoped to the request **`X-Tenant`**. Unified exports aggregate all configured tenants but are only accessible from allowlisted operator tenants. Validate sample exports with **DatevFormatPruefProgramm** before production handoff.

Debtor account numbers follow **`TENANTS_SHARED_NUMBERS`** (shared by default). Creditor (supplier AP) numbers follow the same scoping rules in `billing_datev_creditor_accounts`. With shared numbers, overlapping per-tenant debtor or creditor ranges do not create uniqueness collisions; with `TENANTS_SHARED_NUMBERS=false`, overlapping ranges can collide in unified exports (startup warning). See [Numbering](../features/numbering.md).

Per-tenant JSON overrides in `BILLING_DATEV_TENANT_CONFIG` also accept `creditorAccountStart`, `creditorAccountEnd`, `expenseAccountStandard`, `expenseAccountReduced`, `expenseBuKeyStandard`, and related expense fields. See [Supplier invoices](../features/supplier-invoices.md).

### Stripe and Payment Processors

| Variable                                       | Description                                                                                                                                                             |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BILLING_DEFAULT_PAYMENT_PROCESSOR`            | Default processor (default `stripe`)                                                                                                                                    |
| `BILLING_MIN_CHECKOUT_PAYMENT_AMOUNT`          | Minimum invoice balance for Checkout / PM charges (default `1`). Billing-day and bill-now also hold open positions below this payable total until the next billing day. |
| `STRIPE_SECRET_KEY`                            | Stripe secret API key                                                                                                                                                   |
| `STRIPE_WEBHOOK_SECRET`                        | Stripe webhook signing secret                                                                                                                                           |
| `STRIPE_CHECKOUT_SUCCESS_URL`                  | Redirect after successful checkout                                                                                                                                      |
| `STRIPE_CHECKOUT_CANCEL_URL`                   | Redirect after cancelled checkout                                                                                                                                       |
| `INVOICE_AUTO_PAYMENT_SCHEDULER_INTERVAL`      | Auto-pay coordinator interval ms (default 60000)                                                                                                                        |
| `BILLING_AUTO_PAYMENT_RETRY_DELAY_1_MS`        | Delay after 1st auto-pay failure (default 1 day)                                                                                                                        |
| `BILLING_AUTO_PAYMENT_RETRY_DELAY_2_MS`        | Delay after 2nd auto-pay failure (default 3 days)                                                                                                                       |
| `BILLING_AUTO_PAYMENT_PENDING_SAFETY_DELAY_MS` | Safety delay for pending/SCA off-session charges and incomplete-profile deferral (default 15 minutes)                                                                   |
| `DYNAMIC_PAYMENT_PROCESSORS`                   | Comma-separated extra payment processor packages                                                                                                                        |
| `DYNAMIC_BILLING_PROVIDER_METADATA`            | Extra billing provider metadata packages                                                                                                                                |
| `DYNAMIC_PROVIDERS_FAIL_FAST`                  | Abort startup if critical dynamic provider fails                                                                                                                        |
| `DYNAMIC_PROVIDER_PLUGIN_PATH`                 | Plugin root (e.g. `/var/lib/forepath/provider-plugins`)                                                                                                                 |
| `DYNAMIC_PROVIDER_PLUGIN_INSTALL`              | `npm install` targets at container startup                                                                                                                              |

### Email (SMTP)

Transactional email uses BullMQ (`email-deliver`). See [Email notifications](../features/email-notifications.md).

| Variable                      | Description                                                             | Local default       |
| ----------------------------- | ----------------------------------------------------------------------- | ------------------- |
| `SMTP_HOST`                   | SMTP server host (required to enable sending)                           | `mailhog`           |
| `SMTP_PORT`                   | SMTP port                                                               | `1025`              |
| `SMTP_USER`                   | SMTP username                                                           | empty               |
| `SMTP_PASSWORD`               | SMTP password                                                           | empty               |
| `EMAIL_FROM`                  | Envelope From address                                                   | `noreply@localhost` |
| `EMAIL_COMPANY_NAME`          | Brand name in email header/footer (falls back to `BILLING_ISSUER_NAME`) | empty               |
| `EMAIL_COMPANY_ADDRESS_LINE1` | Footer address line 1 (falls back to `BILLING_ISSUER_ADDRESS_LINE1`)    | empty               |
| `EMAIL_COMPANY_POSTAL_CODE`   | Footer postal code (falls back to `BILLING_ISSUER_POSTAL_CODE`)         | empty               |
| `EMAIL_COMPANY_CITY`          | Footer city (falls back to `BILLING_ISSUER_CITY`)                       | empty               |
| `EMAIL_COMPANY_COUNTRY`       | Footer country ISO-2 (falls back to `BILLING_ISSUER_COUNTRY`)           | empty               |
| `EMAIL_COMPANY_VAT_ID`        | Footer VAT id (falls back to `BILLING_ISSUER_VAT_ID`)                   | empty               |
| `EMAIL_COMPANY_EMAIL`         | Footer contact email (falls back to `BILLING_ISSUER_EMAIL`)             | empty               |

When `EMAIL_COMPANY_*` is unset, Decabill typically relies on `BILLING_ISSUER_*` so invoice and email branding stay aligned.

### Provisioning and DNS

| Variable                 | Description                                             |
| ------------------------ | ------------------------------------------------------- |
| `HETZNER_API_TOKEN`      | Hetzner Cloud API token (default for all service types) |
| `DIGITALOCEAN_API_TOKEN` | DigitalOcean API token (default for all service types)  |
| `CLOUDFLARE_API_TOKEN`   | Cloudflare API token                                    |
| `CLOUDFLARE_ZONE_ID`     | Cloudflare zone for DNS records                         |
| `DNS_BASE_DOMAIN`        | Base domain for provisioned hostnames                   |

Per-service-type overrides for `HETZNER_API_TOKEN` and `DIGITALOCEAN_API_TOKEN` can be configured in the billing console under **Administration → Service Providers → Provider defaults**. Overrides are stored encrypted in the database using `ENCRYPTION_KEY` (AES-256-GCM). When unset for a service type, the global environment variables above apply.

Provisioning SSH posture is documented under accepted risk **[DR-001](../security/accepted-risks.md#dr-001-provisioning-ssh-cloud-init-templates)**.

### Scheduler Intervals (BullMQ Coordinators)

These variables control repeatable **coordinator** intervals in milliseconds:

| Variable                                   | Default    | Purpose                                      |
| ------------------------------------------ | ---------- | -------------------------------------------- |
| `BILLING_SCHEDULER_INTERVAL`               | `60000`    | Subscription billing coordinator             |
| `BILLING_SCHEDULER_BATCH_SIZE`             | `100`      | Batch size for billing runs                  |
| `EXPIRATION_SCHEDULER_INTERVAL`            | `60000`    | Subscription expiration                      |
| `EXPIRATION_SCHEDULER_BATCH_SIZE`          | `100`      | Expiration batch size                        |
| `WITHDRAWAL_SCHEDULER_INTERVAL`            | `60000`    | Subscription withdrawal teardown             |
| `WITHDRAWAL_SCHEDULER_BATCH_SIZE`          | `100`      | Withdrawal batch size                        |
| `INSTANT_CANCEL_SCHEDULER_INTERVAL`        | `60000`    | Admin instant-cancel teardown                |
| `INSTANT_CANCEL_SCHEDULER_BATCH_SIZE`      | `100`      | Instant-cancel batch size                    |
| `PROVISIONING_SCHEDULER_INTERVAL`          | `30000`    | Subscription server provisioning             |
| `PROVISIONING_SCHEDULER_BATCH_SIZE`        | `100`      | Provisioning batch size                      |
| `CONFIG_CHANGE_SCHEDULER_INTERVAL`         | `30000`    | Mid-life subscription config change          |
| `CONFIG_CHANGE_SCHEDULER_BATCH_SIZE`       | `100`      | Config-change coordinator batch size         |
| `CONFIG_CHANGE_PROCESSING_TIMEOUT_MS`      | `900000`   | Stuck config-change reclaim (15m)            |
| `BILLING_ADDON_SSH_COMMAND_TIMEOUT_MS`     | `120000`   | Mid-life / teardown addon SSH script timeout |
| `REMINDER_SCHEDULER_INTERVAL`              | `3600000`  | Renewal reminders                            |
| `REMINDER_SCHEDULER_BATCH_SIZE`            | `100`      | Reminder batch size                          |
| `REMINDER_DAYS`                            | `3`        | Days before renewal to remind                |
| `BACKORDER_RETRY_INTERVAL_MS`              | `60000`    | Backorder retry coordinator                  |
| `BACKORDER_RETRY_BATCH_SIZE`               | `100`      | Backorder batch size                         |
| `INVOICE_OVERDUE_SCHEDULER_INTERVAL`       | `86400000` | Invoice overdue coordinator                  |
| `INVOICE_OVERDUE_SCHEDULER_BATCH_SIZE`     | `100`      | Overdue batch size                           |
| `OPEN_POSITION_INVOICE_SCHEDULER_INTERVAL` | `86400000` | Open position invoicing                      |
| `SUBSCRIPTION_UPDATE_SCHEDULER_INTERVAL`   | `86400000` | Subscription item updates                    |
| `STATUS_POLL_INTERVAL`                     | `15000`    | Dashboard status polling                     |

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

## OpenSearch (Search Indexes)

Used by **backend billing manager** for list/typeahead search. See **[Search indexes](../features/search-indexes.md)** and **[System requirements](./system-requirements.md)**.

| Variable                  | Description                                    | Default                                    |
| ------------------------- | ---------------------------------------------- | ------------------------------------------ |
| `OPENSEARCH_ENABLED`      | Set `false` to disable indexing/search         | `true`                                     |
| `OPENSEARCH_HOST`         | OpenSearch host                                | `localhost` (compose: `opensearch`)        |
| `OPENSEARCH_PORT`         | OpenSearch port                                | `9200` (compose host publish often `9201`) |
| `OPENSEARCH_NODE`         | Full node URL (overrides host/port when set)   | `http://opensearch:9200` in compose        |
| `OPENSEARCH_USERNAME`     | Optional basic auth user                       | empty                                      |
| `OPENSEARCH_PASSWORD`     | Optional basic auth password                   | empty                                      |
| `OPENSEARCH_INDEX_PREFIX` | Index name prefix                              | `decabill`                                 |
| `OPENSEARCH_HOST_PORT`    | Host port published by compose                 | `9201`                                     |
| `SEARCH_REINDEX_INTERVAL` | Periodic reindex coordinator interval (`15m`…) | `15m`                                      |

Production must not expose OpenSearch publicly; use private networking, TLS, and credentials from secrets. Provisioned `decabill-billing` stacks keep OpenSearch on the compose network only (no `OPENSEARCH_HOST_PORT` publish).

## OpenTelemetry

Applies to **Backend Billing Manager**. See [OpenTelemetry](../features/opentelemetry.md).

| Variable                          | Description                                                                         |
| --------------------------------- | ----------------------------------------------------------------------------------- |
| `OTEL_ENABLED`                    | Must be exactly `true` to enable (default: disabled)                                |
| `OTEL_USERNAME` / `OTEL_PASSWORD` | HTTP Basic credentials for the metrics scrape endpoint (both required when enabled) |
| `OTEL_METRICS_PATH`               | Prometheus path on the HTTP root, outside `/api` (default `/otel/metrics`)          |
| `OTEL_SERVICE_NAME`               | Service resource name (default `decabill-billing-manager`)                          |
| `OTEL_EXPORTER_OTLP_ENDPOINT`     | Optional OTLP HTTP endpoint for traces and logs                                     |

## Environment-Specific Defaults

### Development

- `NODE_ENV=development`
- `CORS_ORIGIN=*` (all origins allowed)
- `RATE_LIMIT_ENABLED=false`
- `QUEUE_ROLE=all` for single-process local runs

### Production

- `NODE_ENV=production`
- `CORS_ORIGIN` **required** `RATE_LIMIT_ENABLED=true`
- `ENCRYPTION_KEY` **required** for encrypted fields
- Strong `STATIC_API_KEY` or Keycloak/users auth
- `QUEUE_BULL_BOARD_PASSWORD` **required** when Bull Board is enabled
- `CONFIG_ALLOWED_HOSTS` when `CONFIG` is set on frontends

## Related documentation

- **[Local Development](./local-development.md)** Local setup
- **[Docker Deployment](./docker-deployment.md)** Containerized deployment
- **[Production Checklist](./production-checklist.md)** Production deployment
- **[Background Jobs](./background-jobs.md)** BullMQ roles and coordinators
- **[Accepted risks](../security/accepted-risks.md)** DR-001, DR-002, DR-003, DR-004

---

_For feature-specific details, see [Features](../features/README.md)._
