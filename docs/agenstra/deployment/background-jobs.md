# Background jobs (BullMQ)

Background work for **backend agent controller** and **backend billing manager** runs through **Redis + BullMQ** instead of in-process `setInterval` loops in the API container.

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

Job registration (queue names, repeatable intervals, job names) lives in one file per app:

- `apps/backend-agent-controller/src/queue/job-registry.ts`
- `apps/backend-billing-manager/src/queue/job-registry.ts`

Coordinators fan out **unit jobs** (one subscription, one ticket, one import config, etc.). BullMQ `jobId` values prevent duplicate active work for the same entity. Custom job IDs use `.` separators and only allowed characters (alphanumeric, `.`, `-`, `_`, `~`) — e.g. `coordinator.filter-rules-sync`, `billing.subscription.<uuid>`. Colons and slashes are not valid.

## Redis and queue environment variables

| Variable                    | Purpose                                 | Default (local)                                       |
| --------------------------- | --------------------------------------- | ----------------------------------------------------- |
| `REDIS_HOST`                | Redis hostname                          | `localhost` / compose service `redis`                 |
| `REDIS_PORT`                | Redis port                              | `6379`                                                |
| `REDIS_PASSWORD`            | Optional password                       | empty                                                 |
| `REDIS_DB`                  | Redis database index                    | `0`                                                   |
| `REDIS_KEY_PREFIX`          | Key namespace                           | `agenstra-controller` or `agenstra-billing`           |
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
- `backend-*` (API, `QUEUE_ROLE=api`)
- `backend-*-scheduler` (`QUEUE_ROLE=scheduler`)
- `backend-*-worker` (`QUEUE_ROLE=worker`)

Billing Redis is published on host port **6380** by default so it can run alongside controller Redis (**6379**).

## Bull Board

When enabled on the API container (`QUEUE_BULL_BOARD_ENABLED=true`, default in compose), Bull Board is served at **`QUEUE_BULL_BOARD_PATH`** (default **`/admin/queues`**) on the API port (controller **3100**, billing **3200**). That path is excluded from the Nest global `/api` prefix, so use `http://localhost:3100/admin/queues`, not `/api/admin/queues`.

Bull Board uses **HTTP Basic authentication** (`QUEUE_BULL_BOARD_USERNAME` / `QUEUE_BULL_BOARD_PASSWORD`). Local compose defaults to `admin` / `bullmq`; override in production. Startup fails in production if the board is enabled without a password.

Completed and failed jobs are **not auto-removed** (`removeOnComplete: false`, `removeOnFail: false`) so run history stays in Bull Board. Treat the **last three runs** and **48 hours** as the minimum retention before any manual cleanup via Bull Board or ops.

Bull Board routes bypass the API **origin allowlist**, **HybridAuthGuard**, and **Keycloak guards** (when `AUTHENTICATION_METHOD=keycloak`) so dashboard actions (retry, delete, clean) are not blocked with `403 Forbidden` when the UI sends browser `Origin` headers or `Authorization: Basic` instead of the API key or OIDC token.

Worker and scheduler containers set `QUEUE_BULL_BOARD_ENABLED=false` so they do not start an HTTP server solely for Bull Board.

## Related documentation

- [Environment configuration](./environment-configuration.md)
- [Local development](./local-development.md)
- [Docker deployment](./docker-deployment.md)
