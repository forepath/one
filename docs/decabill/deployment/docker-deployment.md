# Docker Deployment

Containerized deployment guide for Decabill using Docker and Docker Compose.

## Overview

Docker deployment provides:

- Isolated environments for billing API, workers, and frontends
- Consistent dependencies (Postgres, Redis, Mailhog)
- Repeatable production-like stacks on developer machines

## Prerequisites

- Docker 20.10 or higher
- Docker Compose 2.0 or higher

## Docker Compose Setup

### Backend Billing Manager

```bash
cd apps/decabill/backend-billing-manager
docker compose up -d
```

The `docker-compose.yaml` includes:

- **postgres** - PostgreSQL 16
- **redis** - Redis 7 with persistence; host port **6380** maps to container **6379**
- **backend-billing-manager** - API (`QUEUE_ROLE=api`, port **3200**, WebSocket **8082**)
- **backend-billing-manager-scheduler** - Coordinator registration (`QUEUE_ROLE=scheduler`)
- **backend-billing-manager-worker** - Job processing (`QUEUE_ROLE=worker`)
- **mailhog** - Local SMTP capture for invoice and reminder emails

Volumes:

- `postgres_data` - Database files
- `redis_data` - Redis AOF data
- `invoice_pdf_data` - Invoice PDF storage at `/data/invoices`
- `./provider-plugins` - Optional dynamic provider plugins mount

Image: `ghcr.io/forepath/decabill-billing-api:latest`

### Frontend Billing Console

```bash
cd apps/decabill/frontend-billing-console
docker compose up -d
```

Image: `ghcr.io/forepath/decabill-billing-console-server:latest`

Default port **4500**. Compose sets `CSP_CONNECT_SRC_EXTRA=http://host.docker.internal:3200` so the browser can reach the billing API from the containerized console.

### Frontend Docs

```bash
cd apps/decabill/frontend-docs
docker compose up -d
```

Image: `ghcr.io/forepath/decabill-docs-server:latest`

Default port **4200**.

## Container Configuration

### Environment Variables

Configure billing manager containers via `.env` or `docker-compose.yaml`. The shared anchor `x-backend-billing-manager-environment` lists all supported variables. See **[Environment Configuration](./environment-configuration.md)**.

Example API service snippet:

```yaml
services:
  backend-billing-manager:
    environment:
      - DB_HOST=postgres
      - REDIS_HOST=redis
      - STATIC_API_KEY=your-api-key
      - CORS_ORIGIN=https://billing.example.com
      - QUEUE_ROLE=api
      - QUEUE_BULL_BOARD_ENABLED=true
      - QUEUE_BULL_BOARD_PASSWORD=strong-password
```

### Frontend Container Configuration

Frontend server images support runtime configuration via the `CONFIG` environment variable:

```yaml
services:
  frontend-billing-console-server:
    environment:
      - CONFIG=https://config.example.com/decabill-billing-config.json
      - CONFIG_ALLOWED_HOSTS=config.example.com
      - CSP_ENFORCE=true
      - CSP_CONNECT_SRC_EXTRA=https://api.billing.example.com
      - PORT=4500
```

When `CONFIG` is set, the frontend server also supports hardening variables documented in **[Environment Configuration](./environment-configuration.md)** (`CONFIG_ALLOWED_HOSTS`, `CONFIG_FETCH_TIMEOUT_MS`, and related settings).

Billing console and docs Express servers support CSP variables:

- `CSP_ENFORCE` - Enforce CSP when `true`; otherwise report-only
- `CSP_CONNECT_SRC_EXTRA` - Extra `connect-src` origins (required in production for plain HTTP APIs)
- `CSP_SCRIPT_SRC_EXTRA`, `CSP_STYLE_SRC_EXTRA`, `CSP_IMG_SRC_EXTRA`, `CSP_FONT_SRC_EXTRA`, `CSP_WORKER_SRC_EXTRA`
- `CSP_FRAME_ANCESTORS` - Optional full override for `frame-ancestors`

## Building Containers

```bash
# Billing API image
nx docker:api decabill-backend-billing-manager

# Billing console server image
nx docker:server decabill-frontend-billing-console

# Docs server image
nx docker:server decabill-frontend-docs
```

## Container Security (Images)

First-party Decabill images follow a common hardening baseline:

- **Non-root**: Billing API runs as `agenstra` (UID/GID **10001** by default). Frontend server images run as `node` (**1000**).
- **Secrets at runtime**: Database, Stripe, encryption keys, and API keys are supplied at deploy time, not baked into images.
- **No Docker socket**: The billing manager does not mount `/var/run/docker.sock` (unlike agent orchestration stacks).

See **[Container image security](../security/container-images.md)**.

## Running Containers

### Using Docker Compose

```bash
docker compose up -d
docker compose logs -f
docker compose down
docker compose down -v   # removes volumes
```

### Startup Order (Billing Manager)

1. Postgres and Redis become healthy
2. API container (`QUEUE_ROLE=api`) starts and runs migrations
3. Worker and scheduler start after API health check passes

Workers and schedulers assume schema migrations have already been applied.

## Health Checks

The billing API image health check calls `http://localhost:3200/api/health`. Compose `depends_on` with `service_healthy` enforces ordering for worker and scheduler services.

## Bull Board

On the API container with `QUEUE_BULL_BOARD_ENABLED=true`:

- URL: `http://localhost:3200/admin/queues` (not under `/api`)
- HTTP Basic auth: `QUEUE_BULL_BOARD_USERNAME` / `QUEUE_BULL_BOARD_PASSWORD`

See **[Background Jobs](./background-jobs.md)**.

## Logging

```bash
docker compose logs -f backend-billing-manager
docker compose logs --tail=100 backend-billing-manager-worker
```

## Related Documentation

- **[Local Development](./local-development.md)** - Local setup
- **[Production Checklist](./production-checklist.md)** - Production deployment
- **[Environment Configuration](./environment-configuration.md)** - Environment variables
- **[Background Jobs](./background-jobs.md)** - Queue roles and Redis

---

_For production deployment, see the [Production Checklist](./production-checklist.md)._
