# Background jobs (BullMQ)

Background work for **backend agent controller** runs through **Redis + BullMQ** instead of in-process `setInterval` loops in the API container.

## Architecture

| Role                                 | `QUEUE_ROLE` | HTTP API | Registers repeatable coordinators | Processes unit jobs |
| ------------------------------------ | ------------ | -------- | --------------------------------- | ------------------- |
| API (default in compose API service) | `api`        | Yes      | No                                | No                  |
| Scheduler                            | `scheduler`  | No       | Yes                               | No                  |
| Worker                               | `worker`     | No       | No                                | Yes                 |
| Local all-in-one                     | `all`        | Yes      | Yes                               | Yes                 |

Each backend stack has its own **Redis** service in Docker Compose. Workers and schedulers use the **same environment variables** as the API (database, tokens, scheduler intervals, etc.). **Database migrations** run only on containers with `QUEUE_ROLE=api` or `QUEUE_ROLE=all` (faster worker/scheduler startup, no concurrent migration runners).

### Startup order

1. Start **Redis** and **Postgres** (and other dependencies).
2. Start the **API** container (`QUEUE_ROLE=api`) and wait until it is healthy so migrations have run.
3. Start **scheduler** and **worker** containers (Docker Compose `depends_on` with `service_healthy` on the API service enforces this when using the provided compose files).

Workers and schedulers assume the API has already applied schema migrations. Running workers before the API in a fresh environment can cause query errors until migrations complete.

Job registration (queue names, repeatable intervals, job names) lives in:

- `apps/agenstra/backend-agent-controller/src/queue/job-registry.ts`

Coordinators fan out **unit jobs** (one ticket, one import config, etc.). BullMQ `jobId` values prevent duplicate active work for the same entity. Custom job IDs use `.` separators and only allowed characters (alphanumeric, `.`, `-`, `_`, `~`), for example `coordinator.filter-rules-sync`. Colons and slashes are not valid.

Notification delivery jobs on the same queue:

- `webhook-deliver`: outbound webhook HTTPS delivery
- `email-deliver`: transactional identity email (Handlebars + nodemailer)

See [Email notifications](../features/email-notifications.md).

Application update check (same queue):

- `update-check`: daily GitHub Releases fetch + Redis state refresh (`UPDATE_CHECK_CRON`, timezone `UPDATE_CHECK_TIMEZONE`)
- `search-reindex.coordinator` / `search-reindex.unit` / `search-index-sync.unit`: OpenSearch index backfill and live sync retries (`SEARCH_REINDEX_INTERVAL`, default 15m). See [Search indexes](../features/search-indexes.md).
- `opencode-providers.refresh`: fetch [models.dev](https://models.dev/) `api.json` (providers + models) and upsert into `opencode_providers` (`OPENCODE_PROVIDERS_REFRESH_INTERVAL_MS`, default 24h). On first startup with an empty table, or when all rows have empty `models`, a one-shot bootstrap job is enqueued. See [Agent configuration](../features/agent-configuration.md).
- `opencode-mcp-servers.refresh`: walk all cursor pages of the [official MCP Registry](https://registry.modelcontextprotocol.io/docs) `GET /v0.1/servers?version=latest` and upsert into `opencode_mcp_servers` (`OPENCODE_MCP_SERVERS_REFRESH_INTERVAL_MS`, default 24h). On first startup with an empty table, a one-shot bootstrap job is enqueued. See [Agent configuration](../features/agent-configuration.md).
- `opencode-config-sync.coordinator` / `.unit`: retry durable per-agent OpenCode effective-config sync targets (`pending`/`failed`). Interval `OPENCODE_CONFIG_SYNC_INTERVAL_MS` (default 30s), batch `OPENCODE_CONFIG_SYNC_BATCH_SIZE`.
- `opencode-layer-files-sync.coordinator` / `.unit`: retry layer-file emit targets (`pending`/`failed`). Interval `OPENCODE_LAYER_FILES_SYNC_INTERVAL_MS` (default 30s), batch `OPENCODE_LAYER_FILES_SYNC_BATCH_SIZE`.
- `filter-rules-sync.coordinator` / `.unit` / `filter-rules-sync.reconcile`: push regex filter rules to agent managers.

See [Application updates](../features/application-updates.md).

## Redis and queue environment variables

| Variable                    | Purpose                                 | Default (local)                                       |
| --------------------------- | --------------------------------------- | ----------------------------------------------------- |
| `REDIS_HOST`                | Redis hostname                          | `localhost` / compose service `redis`                 |
| `REDIS_PORT`                | Redis port                              | `6379`                                                |
| `REDIS_PASSWORD`            | Optional password                       | empty                                                 |
| `REDIS_DB`                  | Redis database index                    | `0`                                                   |
| `REDIS_KEY_PREFIX`          | Key namespace                           | `agenstra-controller`                                 |
| `QUEUE_ROLE`                | `api`, `scheduler`, `worker`, or `all`  | `all` (local), `api` in API container                 |
| `QUEUE_WORKER_CONCURRENCY`  | Default worker concurrency              | `5`                                                   |
| `QUEUE_BULL_BOARD_ENABLED`  | Mount Bull Board UI on API / `all` only | `true` on API in compose; `false` on worker/scheduler |
| `QUEUE_BULL_BOARD_PATH`     | Bull Board route                        | `/admin/queues`                                       |
| `QUEUE_BULL_BOARD_USERNAME` | HTTP Basic username                     | `admin`                                               |
| `QUEUE_BULL_BOARD_PASSWORD` | HTTP Basic password (required)          | `bullmq` in local compose                             |

Existing `*_SCHEDULER_INTERVAL*` variables now control **coordinator repeat** intervals (milliseconds).

## Docker Compose

Each backend `docker-compose.yaml` defines:

- `redis`
- `backend-agent-controller` (API, `QUEUE_ROLE=api`)
- `backend-agent-controller-scheduler` (`QUEUE_ROLE=scheduler`)
- `backend-agent-controller-worker` (`QUEUE_ROLE=worker`)

## Bull Board

When enabled on the API container (`QUEUE_BULL_BOARD_ENABLED=true`, default in compose), Bull Board is served at **`QUEUE_BULL_BOARD_PATH`** (default **`/admin/queues`**) on the API port (controller **3100**). That path is excluded from the Nest global `/api` prefix, so use `http://localhost:3100/admin/queues`, not `/api/admin/queues`.

Bull Board uses **HTTP Basic authentication** (`QUEUE_BULL_BOARD_USERNAME` / `QUEUE_BULL_BOARD_PASSWORD`). Local compose defaults to `admin` / `bullmq`; override in production. Startup fails in production if the board is enabled without a password.

Completed and failed jobs are **not auto-removed** (`removeOnComplete: false`, `removeOnFail: false`) so run history stays in Bull Board. Treat the **last three runs** and **48 hours** as the minimum retention before any manual cleanup via Bull Board or ops.

Unit jobs use a **stable jobId** as an in-flight lock: enqueue is skipped while a job with that id is waiting or active. Before add, `enqueueUnitJob` removes a completed or failed record with the same id and enqueues the next run. BullMQ 5 treats a second add with that id as a successful no-op, so coordinators would otherwise stay stuck behind Bull Board retention.

Bull Board routes bypass the API **origin allowlist**, **HybridAuthGuard**, and **Keycloak guards** (when `AUTHENTICATION_METHOD=keycloak`) so dashboard actions (retry, delete, clean) are not blocked with `403 Forbidden` when the UI sends browser `Origin` headers or `Authorization: Basic` instead of the API key or OIDC token.

Worker and scheduler containers set `QUEUE_BULL_BOARD_ENABLED=false` so they do not start an HTTP server solely for Bull Board.

## Related documentation

- [Environment configuration](./environment-configuration.md) Queue and Redis variables
- [Local development](./local-development.md) Local API, worker, and scheduler setup
- [Docker deployment](./docker-deployment.md) Compose services for queue roles
