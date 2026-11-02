# Agenstra Controller

The Agenstra controller manages AI agent workspaces, tickets, knowledge and environments across your agent managers. This app installs the controller (API, queue worker, scheduler) and the agent console from the Agenstra **4.1.0** release, the same images the Docker Compose setup and Decabill's bundled `agenstra-controller` stack use.

| Service      | Image                                            | Notes                                                               |
| ------------ | ------------------------------------------------ | ------------------------------------------------------------------- |
| `api`        | `ghcr.io/forepath/agenstra-controller-api:4.1.0` | REST API and websockets, exposed on `/api`, `/socket`, `/socket.io` |
| `worker`     | same image, `QUEUE_ROLE=worker`                  | Queue worker, scalable (`workerReplicas`)                           |
| `scheduler`  | same image, `QUEUE_ROLE=scheduler`               | Exactly one replica                                                 |
| `console`    | `ghcr.io/forepath/agenstra-console-server:4.1.0` | Web console on `/`, runs in gVisor                                  |
| `postgres`   | `pgvector/pgvector:pg16`                         | Bundled unless `bundlePostgres: false`                              |
| `valkey`     | `valkey/valkey:9.0.6-alpine`                     | Bundled unless `bundleValkey: false`                                |
| `opensearch` | `opensearchproject/opensearch:3.9.0`             | Bundled unless `bundleOpenSearch: false`                            |

All images are pinned by digest.

## Before you install

1. Point the DNS name you choose as `domain` at the cluster's ingress.
2. Create the secrets in the target project (values never go into the plan):

   | Secret                      | Value                                                                  |
   | --------------------------- | ---------------------------------------------------------------------- |
   | `db-password`               | Database password                                                      |
   | `valkey-password`           | Valkey password                                                        |
   | `encryption-key`            | `openssl rand -base64 32` (keep it safe: encrypted data depends on it) |
   | `jwt-secret`                | `openssl rand -hex 32`                                                 |
   | `smtp-password`             | SMTP password (any value without SMTP authentication)                  |
   | `mcp-oauth-callback-secret` | `openssl rand -hex 32`                                                 |

3. Bundled OpenSearch needs `vm.max_map_count >= 262144` on the nodes it may run on.

## Parameters

| Parameter                                                      | Default                                             | Meaning                                                                                            |
| -------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `domain`                                                       | (required)                                          | Public hostname of console and API                                                                 |
| `emailFrom`, `smtpHost`                                        | (required)                                          | Sender address and SMTP server for account emails                                                  |
| `smtpPort`, `smtpUser`                                         | `587`, empty                                        | SMTP port and user                                                                                 |
| `disableSignup`                                                | `false`                                             | Close registration once the first account exists                                                   |
| `defaultLocale`                                                | `en`                                                | Console language (`en`, `de`)                                                                      |
| `clientEndpointAllowedHosts`                                   | `*`                                                 | Hosts the controller may reach as agent managers                                                   |
| `workerReplicas`, `consoleReplicas`                            | `1`, `2`                                            | Replicas of the queue worker and console                                                           |
| `bundlePostgres` / `dbHost`, `dbPort`, `dbUser`, `dbName`      | `true` / `postgres`, `5432`, `agenstra`, `agenstra` | Bundled database, or the connection to an existing one (PostgreSQL 16 with the `vector` extension) |
| `bundleValkey` / `valkeyHost`, `valkeyPort`                    | `true` / `valkey`, `6379`                           | Bundled Valkey, or an existing Valkey / Redis                                                      |
| `bundleOpenSearch` / `opensearchUrl`                           | `true` / `http://opensearch:9200`                   | Bundled OpenSearch, or an existing cluster (without authentication)                                |
| `postgresVolumeSize`, `opensearchVolumeSize`, `opensearchHeap` | `20g`, `20g`, `512m`                                | Sizes                                                                                              |

## After the install

- Open `https://<domain>` and register: the first account becomes the administrator. Then set `disableSignup: true` with an update plan.
- Connect agent managers (for example the **Agenstra Manager** app) in the console.

## Backups and updates

- Postgres is backed up nightly with an app-consistent `pg_dump` hook (14 days), OpenSearch weekly.
- Updates run as plans with a backup first; the controller migrates its database on start-up.

## Licence

The console is AGPL-3.0. The controller API is licensed under the BUSL-1.1 with a free production grant (Agenstra's free tier); see [agenstra.com](https://agenstra.com) for the terms and commercial licences, which are handled outside the app store.
