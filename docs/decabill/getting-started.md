# Getting Started with Decabill

This guide helps you run Decabill locally, connect the billing console to the billing manager, and sign in for the first time.

## Prerequisites

Before you begin, ensure you have:

- **Node.js** 24.14.1 or higher
- **Docker** and **Docker Compose** (recommended for Postgres, Redis, and Mailhog)
- **Git** (to clone the monorepo)
- **Keycloak** (optional, for OAuth2/OIDC login in the billing console)
- **Stripe test keys** (optional, for checkout and payment flows)

## Installation

### Option 1: Docker Compose (Recommended)

The fastest way to run the full backend stack and the SSR billing console is Docker Compose in each application directory.

#### Backend billing manager

```bash
git clone https://github.com/forepath/one.git
cd one/apps/decabill/backend-billing-manager

cp .start-containers.env.example .env
# Edit .env: set STATIC_API_KEY, ENCRYPTION_KEY, issuer fields, and TENANTS as needed

docker compose up -d
```

This starts:

- PostgreSQL 16
- Redis 7 (host port **6380** by default)
- Billing API (`QUEUE_ROLE=api`, HTTP **3200**, WebSocket **8082**)
- Billing worker (`QUEUE_ROLE=worker`)
- Billing scheduler (`QUEUE_ROLE=scheduler`)
- Mailhog for local email capture

Build the API image locally before the first compose run if you changed backend code:

```bash
cd one
nx run decabill-backend-billing-manager:api-container-image
```

#### Frontend billing console

In another terminal:

```bash
cd one/apps/decabill/frontend-billing-console
docker compose up -d
```

The console server listens on **4500** by default. Set `CSP_CONNECT_SRC_EXTRA` in compose if the API is not reachable from the browser at the default billing manager URL.

See **[Docker Deployment](./deployment/docker-deployment.md)** for production-oriented compose notes.

### Option 2: Local Development with Nx

Use Nx when you want hot reload while editing TypeScript or Angular code.

```bash
git clone https://github.com/forepath/one.git
cd one
npm install
```

Start Postgres and Redis (Docker one-liners or the billing manager compose stack without the API containers). Then run:

```bash
# Terminal 1: billing manager (QUEUE_ROLE=all runs API, worker, and scheduler in one process)
cd apps/decabill/backend-billing-manager
cp .start-containers.env.example .env
# Set QUEUE_ROLE=all, REDIS_PORT=6380 if Redis is published on the host, and auth variables

nx serve decabill-backend-billing-manager

# Terminal 2: billing console (Angular dev server on port 4500)
cd apps/decabill/frontend-billing-console
nx serve decabill-frontend-billing-console
```

For SSR parity with production, build the console and run the Express server:

```bash
nx build decabill-frontend-billing-console
nx run decabill-frontend-billing-console:serve-server
```

See **[Local Development](./deployment/local-development.md)** for Bull Board, tests, and troubleshooting.

## Configuration

### Backend billing manager

Create or edit `.env` in `apps/decabill/backend-billing-manager`. Minimum local settings:

```bash
# Database
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=postgres
DB_DATABASE=postgres

# Redis (6380 when using compose host mapping)
REDIS_HOST=localhost
REDIS_PORT=6380
REDIS_KEY_PREFIX=decabill-billing

# Process role (local all-in-one)
QUEUE_ROLE=all

# Authentication (choose one method)
AUTHENTICATION_METHOD=api-key
STATIC_API_KEY=dev-api-key-123

# Or Keycloak:
# AUTHENTICATION_METHOD=keycloak
# KEYCLOAK_AUTH_SERVER_URL=http://localhost:8380
# KEYCLOAK_REALM=decabill
# KEYCLOAK_CLIENT_ID=billing-manager
# KEYCLOAK_CLIENT_SECRET=your-client-secret

# Or built-in users (default in local Angular environment):
# AUTHENTICATION_METHOD=users
# JWT_SECRET=your-jwt-secret
# DISABLE_SIGNUP=false

# Ports
PORT=3200
WEBSOCKET_PORT=8082

# Multi-tenancy and console URL
TENANTS=decabill
BILLING_FRONTEND_URL=http://localhost:4500
CORS_ORIGIN=*

# Encryption (set before storing sensitive provider or SSH fields)
ENCRYPTION_KEY=

# Stripe (optional)
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_CHECKOUT_SUCCESS_URL=http://localhost:4500/invoices?payment=success
STRIPE_CHECKOUT_CANCEL_URL=http://localhost:4500/invoices?payment=cancel
```

The full variable list is in **[Environment Configuration](./deployment/environment-configuration.md)**.

### Frontend billing console

Local Angular builds use `environment.decabill.ts`, which points the console at:

- REST API: `http://localhost:3200/api`
- WebSocket: `http://localhost:8082/billing`
- Frontend URL: `http://localhost:4500`
- Default tenant id: `decabill`

Match `authentication.type` in the environment file to the backend `AUTHENTICATION_METHOD`. The Docker SSR image exposes runtime config via the Express `/config` endpoint. See **[Frontend Billing Console](./applications/frontend-billing-console.md)**.

## First Login

Choose an authentication method that matches your `.env` and console environment.

### Option A: Static API key (`STATIC_API_KEY`)

Set `AUTHENTICATION_METHOD=api-key` and a non-empty `STATIC_API_KEY`. The billing manager accepts the key on every HTTP request:

```bash
curl -s -H "Authorization: Bearer dev-api-key-123" \
  -H "X-Tenant: decabill" \
  http://localhost:3200/api/config
```

API key auth grants admin access to billing administration REST routes. It does not provide an end-user identity in the billing console UI or on the dashboard WebSocket stream. Use this path to verify the API, run automation, or integrate scripts before configuring interactive login.

Optional: set `STATIC_API_KEY_TENANT_ID` to bind the key to one tenant. See **[Multi-tenancy](./features/multi-tenancy.md)**.

### Option B: Keycloak

1. Run or connect to a Keycloak realm and client for Decabill.
2. Set `AUTHENTICATION_METHOD=keycloak` and the Keycloak environment variables on the billing manager.
3. Configure the billing console for Keycloak (runtime config or build-time environment).
4. Open `http://localhost:4500/login` and complete the OAuth2/OIDC flow.

The first user synced into a tenant receives the admin role. Subsequent synced users receive the standard user role.

### Option C: Built-in users (common local default)

When `AUTHENTICATION_METHOD=users` and the console `authentication.type` is `users`:

1. Open `http://localhost:4500/register` and create an account (unless `DISABLE_SIGNUP=true`).
2. Confirm email when prompted (Mailhog UI is on port **8026** when using the billing manager compose stack).
3. Log in at `http://localhost:4500/login`.

The first registered user in each tenant is auto-confirmed and assigned admin. Later users may need email confirmation.

See **[Authentication](./features/authentication.md)** for flows, roles, and security notes.

## Verify the Stack

After login (users or Keycloak) or API key verification:

1. Open **Overview** at `/dashboard` to see subscriptions and server status.
2. Open **Plans** at `/subscriptions` to browse service plans (admin users can manage catalog entries under **Administration**).
3. Open **Invoices** at `/invoices` for billing history and Stripe checkout when configured.
4. Admins can open **Administration** routes for service types, plans, manual billing, and customer profiles.

Confirm WebSocket dashboard updates on the overview page when logged in as an end user (not when using API key auth alone).

## Next Steps

1. **[System Overview](./architecture/system-overview.md)** for the two-tier architecture
2. **[Multi-tenancy](./features/multi-tenancy.md)** if you run more than one tenant
3. **[Subscriptions](./features/subscriptions.md)** to order a service plan
4. **[Billing Administration](./features/billing-administration.md)** for manual invoices and operator dashboards
5. **[API Reference](./api-reference/README.md)** for OpenAPI and AsyncAPI specifications

## Troubleshooting

- Database or Redis errors: see **[Local Development](./deployment/local-development.md)**.
- Port conflicts: billing API **3200**, WebSocket **8082**, console **4500**, Redis host **6380**.
- Migrations run only when `QUEUE_ROLE` is `api` or `all`. Ensure at least one API role process has started.

---

_For deployment beyond local development, see **[Production Checklist](./deployment/production-checklist.md)**._
