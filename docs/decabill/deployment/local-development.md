# Local Development

Setting up Decabill for local development and testing.

## Prerequisites

Before you begin, ensure you have:

- **Node.js** 24.14.1 or higher
- **PostgreSQL** (running locally or in Docker)
- **Redis** (running locally or in Docker; billing compose uses host port **6380** by default)
- **Git** (optional, for repository checkout)
- **Keycloak** (optional; API key or users authentication work for local dev)

For CPU, memory, and disk baselines by component, see **[System Requirements](./system-requirements.md)**. For install capacity and verification checklists, see **[Operator Runbook](./operator-runbook.md)**.

## Installation

### Clone Repository

```bash
git clone https://github.com/forepath/one.git
cd one
```

### Install Dependencies

```bash
npm install
```

## Database and Redis Setup

### Using Docker (Recommended)

```bash
# PostgreSQL for billing manager
docker run -d \
  --name decabill-postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=postgres \
  -p 5432:5432 \
  postgres:16-alpine

# Redis for BullMQ (host port 6380 to avoid clashing with other stacks)
docker run -d \
  --name decabill-redis \
  -p 6380:6379 \
  redis:7-alpine
```

### Using the Billing Manager Compose Stack

The billing manager `docker-compose.yaml` starts Postgres, Redis (published on **6380**), Mailhog, API, worker, and scheduler together. Copy the example env file and adjust:

```bash
cd apps/decabill/backend-billing-manager
cp .start-containers.env.example .env
docker compose up -d
```

## Configuration

### Backend Billing Manager

Create a `.env` file in `apps/decabill/backend-billing-manager` (or use `.start-containers.env.example` as a template):

```bash
# Database
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=postgres
DB_DATABASE=postgres

# Redis (when not using compose network)
REDIS_HOST=localhost
REDIS_PORT=6380
REDIS_KEY_PREFIX=decabill-billing

# Queue (local all-in-one)
QUEUE_ROLE=all
QUEUE_BULL_BOARD_ENABLED=true
QUEUE_BULL_BOARD_PASSWORD=bullmq

# Authentication (choose one)
AUTHENTICATION_METHOD=api-key
STATIC_API_KEY=dev-api-key-123
# Optional: bind API key to one tenant (see accepted risk DR-002)
# STATIC_API_KEY_TENANT_ID=default

# Ports
PORT=3200
WEBSOCKET_PORT=8082

# Multi-tenancy
TENANTS=default
BILLING_FRONTEND_URL=http://localhost:4500

# CORS (for development)
CORS_ORIGIN=*

# Rate limiting (disabled for development)
RATE_LIMIT_ENABLED=false

# Encryption (required for production; set for local if testing encrypted fields)
ENCRYPTION_KEY=

# Stripe (optional for local payment flows)
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_CHECKOUT_SUCCESS_URL=http://localhost:4500/invoices?payment=success
STRIPE_CHECKOUT_CANCEL_URL=http://localhost:4500/invoices?payment=cancel

# Provisioning (optional)
HETZNER_API_TOKEN=
DIGITALOCEAN_API_TOKEN=
```

See **[Environment Configuration](./environment-configuration.md)** for the full variable list.

### Frontend Billing Console

The billing console reads API URLs from build-time environment and optional runtime `CONFIG`. For local `nx serve`, configure in `apps/decabill/frontend-billing-console` or see **[Getting Started](../getting-started.md)**.

Typical local values:

```bash
API_URL=http://localhost:3200
WEBSOCKET_URL=http://localhost:8082
```

Express server variables (when running the SSR server locally):

```bash
PORT=4500
CSP_ENFORCE=false
CSP_CONNECT_SRC_EXTRA=http://localhost:3200
```

### Frontend Docs

```bash
PORT=4200
CSP_ENFORCE=false
```

## Running Applications

### Start Backend

```bash
# Terminal 1: Billing manager (QUEUE_ROLE=all for local jobs)
cd apps/decabill/backend-billing-manager
nx serve decabill-backend-billing-manager
```

### Start Frontends

```bash
# Terminal 2: Billing console
cd apps/decabill/frontend-billing-console
nx serve decabill-frontend-billing-console

# Terminal 3: Docs (optional)
cd apps/decabill/frontend-docs
nx serve decabill-frontend-docs
```

## Development Workflow

### Making Changes

1. Make code changes
2. Applications auto-reload (hot reload where configured)
3. Test in the browser
4. Run tests: `nx test <project-name>`

### Running Tests

```bash
# Billing manager
nx test decabill-backend-billing-manager

# Billing console
nx test decabill-frontend-billing-console

# Run with coverage
nx test decabill-backend-billing-manager --coverage
```

### Building

```bash
nx build decabill-backend-billing-manager
nx build decabill-frontend-billing-console
nx build decabill-frontend-docs
```

## Bull Board (Local)

When `QUEUE_ROLE=all` or `api` with `QUEUE_BULL_BOARD_ENABLED=true`:

- URL: `http://localhost:3200/admin/queues`
- Default credentials: `admin` / `bullmq` (override via env)

See **[Background Jobs](./background-jobs.md)**.

## Troubleshooting

### Database Connection Issues

- Verify PostgreSQL is running: `docker ps` or `pg_isready`
- Check credentials in `.env`
- Ensure migrations ran (API container with `QUEUE_ROLE=api` or `all`)

### Redis Connection Issues

- Confirm Redis is reachable on the configured host and port (**6380** on host when using compose defaults)
- Check `REDIS_HOST` and `REDIS_PORT`

### Port Conflicts

- Billing API: **3200**, WebSocket: **8082**, console: **4500**, docs: **4200**, Redis host port: **6380**
- Change ports in `.env` if needed: `lsof -i :3200`

## Related Documentation

- **[Docker Deployment](./docker-deployment.md)** - Containerized deployment
- **[Production Checklist](./production-checklist.md)** - Production deployment
- **[Environment Configuration](./environment-configuration.md)** - Environment variables
- **[Common Issues](../troubleshooting/common-issues.md)** - Problem solving

---

_For production deployment, see the [Production Checklist](./production-checklist.md)._
