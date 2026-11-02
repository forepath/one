# Decabill Billing

Decabill handles customers, subscriptions, invoices, payments and DATEV exports. This app installs the billing manager (API, queue worker, scheduler) and the billing console from the Decabill **4.1.0** release, the same images the Docker Compose setup and Decabill's bundled `decabill-billing` stack use. The other deployment variants stay available.

| Service      | Image                                                    | Notes                                                      |
| ------------ | -------------------------------------------------------- | ---------------------------------------------------------- |
| `api`        | `ghcr.io/forepath/decabill-billing-api:4.1.0`            | REST API and websockets on `/api`, `/socket`, `/socket.io` |
| `worker`     | same image, `QUEUE_ROLE=worker`                          | Queue worker                                               |
| `scheduler`  | same image, `QUEUE_ROLE=scheduler`                       | Exactly one replica                                        |
| `console`    | `ghcr.io/forepath/decabill-billing-console-server:4.1.0` | Billing console on `/`, runs in gVisor                     |
| `postgres`   | `postgres:16-alpine`                                     | Bundled unless `bundlePostgres: false`                     |
| `valkey`     | `valkey/valkey:9.0.6-alpine`                             | Bundled unless `bundleValkey: false`                       |
| `opensearch` | `opensearchproject/opensearch:3.9.0`                     | Bundled unless `bundleOpenSearch: false`                   |

All images are pinned by digest. API, worker and scheduler share the `billing-files` volume (invoice PDFs, exports), so Loadweaver places them together.

## Before you install

1. Point `domain` at the cluster's ingress.
2. Create the secrets in the target project:

   | Secret                | Value                                                                  |
   | --------------------- | ---------------------------------------------------------------------- |
   | `db-password`         | Database password                                                      |
   | `valkey-password`     | Valkey password                                                        |
   | `encryption-key`      | `openssl rand -base64 32` (keep it safe: encrypted data depends on it) |
   | `jwt-secret`          | `openssl rand -hex 32`                                                 |
   | `smtp-password`       | SMTP password (any value without SMTP authentication)                  |
   | `file-signing-secret` | `openssl rand -hex 32`                                                 |

   The optional integrations' secrets are needed only while the integration is switched on; the install form asks
   for them then. With the integration off, leave them out: the deployment doesn't reference them.

   | Secret                   | Value                                            | Needed while           |
   | ------------------------ | ------------------------------------------------ | ---------------------- |
   | `stripe-secret-key`      | Stripe secret key (`sk_live_…` / `sk_test_…`)    | `stripeEnabled: true`  |
   | `stripe-webhook-secret`  | Signing secret of the Stripe webhook (`whsec_…`) | `stripeEnabled: true`  |
   | `keycloak-client-secret` | Secret of the Keycloak client                    | `authMethod: keycloak` |
   | `s3-access-key-id`       | Access key ID of the bucket                      | `fileStorage: s3`      |
   | `s3-secret-access-key`   | Secret access key of the bucket                  | `fileStorage: s3`      |

3. Bundled OpenSearch needs `vm.max_map_count >= 262144` on the nodes it may run on.

## Parameters

| Parameter                                                      | Default                                             | Meaning                                                            |
| -------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------ |
| `domain`                                                       | (required)                                          | Public hostname of console and API                                 |
| `issuerName`, `issuerEmail`                                    | (required)                                          | Invoice issuer and billing contact                                 |
| `emailFrom`, `smtpHost`                                        | (required)                                          | Sender address and SMTP server                                     |
| `smtpPort`, `smtpUser`                                         | `587`, empty                                        | SMTP port and user                                                 |
| `issuerCountry`                                                | `DE`                                                | Issuer country (ISO code)                                          |
| `taxRateStandard`, `taxRateReduced`                            | `19`, `7`                                           | Tax rates in percent                                               |
| `datevExportEnabled`                                           | `false`                                             | Monthly DATEV export                                               |
| `disableSignup`                                                | `false`                                             | Close registration once the first account exists                   |
| `defaultLocale`                                                | `en`                                                | Console language (`en`, `de`)                                      |
| `consoleReplicas`                                              | `2`                                                 | Console replicas                                                   |
| `filesVolumeSize`                                              | `10g`                                               | Document storage                                                   |
| `bundlePostgres` / `dbHost`, `dbPort`, `dbUser`, `dbName`      | `true` / `postgres`, `5432`, `decabill`, `decabill` | Bundled database or an existing PostgreSQL 16                      |
| `bundleValkey` / `valkeyHost`, `valkeyPort`, `valkeyKeyPrefix` | `true` / `valkey`, `6379`, `decabill-billing`       | Bundled Valkey or an existing Valkey / Redis                       |
| `bundleOpenSearch` / `opensearchUrl`                           | `true` / `http://opensearch:9200`                   | Bundled OpenSearch or an existing cluster (without authentication) |
| `postgresVolumeSize`, `opensearchVolumeSize`, `opensearchHeap` | `20g`, `10g`, `512m`                                | Sizes                                                              |

## Optional integrations

All three are off by default, so the app runs on the free tiers of everything it uses.

| Integration             | Switch                 | Parameters                                                                                       | Secrets                                      |
| ----------------------- | ---------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| Stripe payments         | `stripeEnabled: true`  | none (Checkout returns to `https://<domain>/invoices`)                                           | `stripe-secret-key`, `stripe-webhook-secret` |
| Keycloak sign-in        | `authMethod: keycloak` | `keycloakUrl` (https), `keycloakRealm`, `keycloakClientId`, `keycloakTokenValidation`            | `keycloak-client-secret`                     |
| S3-compatible documents | `fileStorage: s3`      | `s3Bucket`, `s3Endpoint` (empty for AWS), `s3Region` (`auto`), `s3ForcePathStyle`, `s3KeyPrefix` | `s3-access-key-id`, `s3-secret-access-key`   |

- **Stripe**: add a webhook endpoint `https://<domain>/api/webhooks/payments/stripe` in the Stripe dashboard and use its signing secret. Without Stripe, invoices are paid by bank transfer and an admin marks them paid (Decabill's manual payment status); the console's online payment and auto-billing aren't usable then. Stripe is Decabill's only built-in payment processor (others are Decabill plugins this app doesn't install), so `BILLING_DEFAULT_PAYMENT_PROCESSOR` stays `stripe` either way: invoices issued while Stripe is off become payable online as soon as it is switched on.
- **Keycloak**: the built-in accounts (`authMethod: users`) are the default. With Keycloak, the console and the API use the same client of your realm (as Decabill's bundled stack does); the console's CSP admits the Keycloak origin.
- **S3**: invoice PDFs, supplier documents and exports go to the bucket instead of the `billing-files` volume (the volume stays, unused). Any S3-compatible provider works (AWS, R2, B2, Ceph, MinIO, Garage).

This package does not configure the server-provisioning provider tokens. If you need them, use the Docker Compose setup or Decabill's bundled stack.

## After the install

Open `https://<domain>` and register: the first account becomes the administrator. Then set `disableSignup: true` with an update plan.

## Backups and updates

- Postgres and the documents are backed up nightly (30 days; the database with an app-consistent `pg_dump` hook), OpenSearch weekly.
- Updates run as plans with a backup first; the billing manager migrates its database on start-up.

## Licence

AGPL-3.0-or-later.
