# Background Jobs (BullMQ)

Background work for **backend billing manager** runs through **Redis + BullMQ** instead of in-process `setInterval` loops in the API container.

## Architecture

| Role                                 | `QUEUE_ROLE` | HTTP API | Registers repeatable coordinators | Processes unit jobs |
| ------------------------------------ | ------------ | -------- | --------------------------------- | ------------------- |
| API (default in compose API service) | `api`        | Yes      | No                                | No                  |
| Scheduler                            | `scheduler`  | No       | Yes                               | No                  |
| Worker                               | `worker`     | No       | No                                | Yes                 |
| Local all-in-one                     | `all`        | Yes      | Yes                               | Yes                 |

The billing stack has its own **Redis** service in Docker Compose. Workers and schedulers use the **same environment variables** as the API (database, Stripe, scheduler intervals, provisioning tokens, etc.). **Database migrations** run only on containers with `QUEUE_ROLE=api` or `QUEUE_ROLE=all`.

### Startup order

1. Start **Redis** and **Postgres** (and Mailhog or production SMTP).
2. Start the **API** container (`QUEUE_ROLE=api`) and wait until it is healthy so migrations have run.
3. Start **scheduler** and **worker** containers (`depends_on` with `service_healthy` on the API service in the provided compose file).

Workers and schedulers assume the API has already applied schema migrations. Running workers before the API in a fresh environment can cause query errors until migrations complete.

## Job Registry

Job registration (queue names, repeatable intervals, job names) lives in:

`apps/decabill/backend-billing-manager/src/queue/job-registry.ts`

### Queue

- **Queue name:** `billing` (`BILLING_QUEUE_NAME`)

### Coordinator jobs (repeatable)

Registered by the scheduler from `getBillingRepeatableJobs()`:

| Coordinator job name                   | Env interval variable                      | Default interval |
| -------------------------------------- | ------------------------------------------ | ---------------- |
| `subscription-billing.coordinator`     | `BILLING_SCHEDULER_INTERVAL`               | 60s              |
| `subscription-expiration.coordinator`  | `EXPIRATION_SCHEDULER_INTERVAL`            | 60s              |
| `subscription-withdrawal.coordinator`  | `WITHDRAWAL_SCHEDULER_INTERVAL`            | 60s              |
| `invoice-overdue.coordinator`          | `INVOICE_OVERDUE_SCHEDULER_INTERVAL`       | 24h              |
| `open-position-invoice.coordinator`    | `OPEN_POSITION_INVOICE_SCHEDULER_INTERVAL` | 24h              |
| `renewal-reminder.coordinator`         | `REMINDER_SCHEDULER_INTERVAL`              | 1h               |
| `subscription-item-update.coordinator` | `SUBSCRIPTION_UPDATE_SCHEDULER_INTERVAL`   | 24h              |
| `backorder-retry.coordinator`          | `BACKORDER_RETRY_INTERVAL_MS`              | 60s              |
| `datev-export.coordinator`             | `BILLING_DATEV_EXPORT_CRON` (cron)         | 1st of month     |

The DATEV coordinator is registered only when `BILLING_DATEV_EXPORT_ENABLED=true`. It enqueues per-tenant unit jobs and optionally one unified unit job when `BILLING_DATEV_UNIFIED_EXPORT_ENABLED=true`.

Coordinator job IDs use dot separators (for example `coordinator.subscription-billing`) via `buildCoordinatorJobId`.

### Unit jobs (worker-processed)

Coordinators fan out unit jobs such as:

- `subscription-billing.unit`
- `subscription-expiration.unit`
- `subscription-withdrawal.unit`
- `invoice-overdue.unit`
- `open-position-invoice.unit`
- `renewal-reminder.unit`
- `subscription-item-update.unit`
- `backorder-retry.unit`
- Admin bill-now coordinator and unit jobs (`AdminBillNowJobName`)
- `datev-export.coordinator` and `datev-export.unit` (when `BILLING_DATEV_EXPORT_ENABLED=true`)

BullMQ `jobId` values prevent duplicate active work for the same entity. Custom job IDs use `.` separators and only allowed characters (alphanumeric, `.`, `-`, `_`, `~`).

DATEV unit job IDs:

- Per-tenant: `datev-export.tenant.{tenantId}.{year}-{month}`
- Unified: `datev-export.unified.{year}-{month}`

## Redis and Queue Environment Variables

| Variable                    | Purpose                                 | Default (local compose)   |
| --------------------------- | --------------------------------------- | ------------------------- |
| `REDIS_HOST`                | Redis hostname                          | `redis` in compose        |
| `REDIS_PORT`                | Redis port inside network               | `6379`                    |
| `REDIS_HOST_PORT`           | Host port mapping in compose            | `6380`                    |
| `REDIS_PASSWORD`            | Optional password                       | empty                     |
| `REDIS_DB`                  | Redis database index                    | `0`                       |
| `REDIS_KEY_PREFIX`          | Key namespace                           | `decabill-billing`        |
| `QUEUE_ROLE`                | `api`, `scheduler`, `worker`, or `all`  | `api` in API container    |
| `QUEUE_WORKER_CONCURRENCY`  | Default worker concurrency              | `5`                       |
| `QUEUE_BULL_BOARD_ENABLED`  | Mount Bull Board UI on API / `all` only | `true` on API in compose  |
| `QUEUE_BULL_BOARD_PATH`     | Bull Board route                        | `/admin/queues`           |
| `QUEUE_BULL_BOARD_USERNAME` | HTTP Basic username                     | `admin`                   |
| `QUEUE_BULL_BOARD_PASSWORD` | HTTP Basic password (required)          | `bullmq` in local compose |

Scheduler interval variables (`BILLING_SCHEDULER_INTERVAL`, `EXPIRATION_SCHEDULER_INTERVAL`, etc.) control **coordinator repeat** intervals in BullMQ.

## Docker Compose

`apps/decabill/backend-billing-manager/docker-compose.yaml` defines:

- `redis` (host port **6380** by default)
- `backend-billing-manager` (API, `QUEUE_ROLE=api`, ports **3200** and **8082**)
- `backend-billing-manager-scheduler` (`QUEUE_ROLE=scheduler`)
- `backend-billing-manager-worker` (`QUEUE_ROLE=worker`)

Billing Redis is published on host port **6380** so it can run alongside other Redis instances on **6379**.

## Bull Board

When enabled on the API container (`QUEUE_BULL_BOARD_ENABLED=true`, default in local compose):

- URL: **`http://localhost:3200/admin/queues`** (billing API port **3200**)
- Path is **not** under the Nest global `/api` prefix
- HTTP Basic authentication: `QUEUE_BULL_BOARD_USERNAME` / `QUEUE_BULL_BOARD_PASSWORD`
- Local compose defaults: `admin` / `bullmq`; override in production

Startup fails in production if the board is enabled without a password.

Completed and failed jobs are **not auto-removed** (`removeOnComplete: false`, `removeOnFail: false`) so run history remains visible. Treat the **last three runs** and **48 hours** as minimum retention before manual cleanup.

Bull Board routes bypass the API origin allowlist and HybridAuthGuard so dashboard actions (retry, delete, clean) work with browser Basic auth.

Worker and scheduler containers set `QUEUE_BULL_BOARD_ENABLED=false` so they do not start an HTTP server solely for Bull Board.

## Tenant Context in Jobs

Unit jobs resolve `tenant_id` from job payload data so multi-tenant billing runs stay scoped. See `resolve-billing-job-tenant-id.ts` in the billing manager queue module.

## Related Documentation

- **[Environment Configuration](./environment-configuration.md)** - Redis and scheduler variables
- **[Local Development](./local-development.md)** - `QUEUE_ROLE=all` locally
- **[Docker Deployment](./docker-deployment.md)** - Compose services
- **[Multi-tenancy](../features/multi-tenancy.md)** - `X-Tenant` and `TENANTS`

---

_For production queue hardening, see [Production Checklist](./production-checklist.md)._
