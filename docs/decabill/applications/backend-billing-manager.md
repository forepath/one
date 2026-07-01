# Backend Billing Manager

NestJS backend application for subscription billing, invoicing, payments, provisioning, and background processing.

## Purpose

The billing manager is the authoritative service for Decabill. It exposes HTTP and WebSocket interfaces, persists data in PostgreSQL, enqueues work on Redis-backed BullMQ queues, integrates with Stripe, and optionally provisions cloud infrastructure when service plans require it.

The app module in `apps/decabill/backend-billing-manager` bootstraps shared queue role logic, runs migrations when acting as API, and imports the domain **`BillingManagerModule`** from `@forepath/decabill/backend`.

## Features

This application provides:

- **HTTP REST API** - Subscriptions, invoices, catalog, customer profile, admin billing, public offerings
- **WebSocket gateway** - Dashboard server status on namespace **`billing`**; project board on namespace **`projects`**
- **Background jobs** - Billing cycles, expiration, reminders, overdue handling, backorder retry, SSH stack updates
- **Stripe integration** - Checkout sessions and signed webhooks
- **Invoice PDFs** - ZUGFeRD-style generation and filesystem storage
- **Multi-tenancy** - Tenant allowlist and row-level isolation
- **Authentication** - API key, Keycloak, or built-in users (JWT)
- **Dynamic plugins** - Optional payment processors and billing UI metadata
- **Email** - Invoice and reminder delivery via SMTP
- **Rate limiting and CORS** - Production-safe HTTP defaults

## Architecture

Built with:

- **NestJS** - Modules, controllers, guards, and gateways
- **TypeORM** - Entities and migrations (app migrations plus identity migrations)
- **BullMQ** - Queue name **`billing`** with coordinator and unit jobs
- **Socket.IO** - Separate WebSocket listener on `WEBSOCKET_PORT`
- **PostgreSQL** - Primary datastore
- **Redis** - BullMQ connection

Domain logic, OpenAPI source, and AsyncAPI source live in `libs/domains/decabill/backend/feature-billing-manager`.

## Ports and Network Surfaces

| Variable                       | Default    | Description                     |
| ------------------------------ | ---------- | ------------------------------- |
| `PORT`                         | **3200**   | HTTP API (global prefix `/api`) |
| `WEBSOCKET_PORT`               | **8082**   | Socket.IO server                |
| `WEBSOCKET_NAMESPACE`          | `billing`  | Dashboard status namespace      |
| `PROJECTS_WEBSOCKET_NAMESPACE` | `projects` | Project board namespace         |
| `HOST`                         | `0.0.0.0`  | Bind address                    |

Health and monitoring endpoints are provided through shared backend utilities where enabled.

## Queue Roles

The same container image runs different responsibilities based on `QUEUE_ROLE`:

### `api`

- Serves HTTP REST and WebSocket
- Runs TypeORM migrations on startup
- May expose Bull Board at `QUEUE_BULL_BOARD_PATH` (default `/admin/queues`)
- Does not process BullMQ unit jobs or register repeatable coordinators

### `worker`

- Consumes BullMQ jobs from the **`billing`** queue
- Processes unit jobs enqueued by coordinators (billing, expiration, invoices, reminders, backorder retry, subscription item update, admin bill-now)
- Respects `QUEUE_WORKER_CONCURRENCY` (default **5**)

### `scheduler`

- On startup, registers repeatable **coordinator** jobs (subscription billing, expiration, invoice overdue, open-position invoice, renewal reminder, subscription item update, backorder retry)
- Does not serve HTTP or execute unit work directly

### `all`

- Combines API, scheduler, and worker for local development
- Enables Bull Board by default when not explicitly disabled

Docker Compose runs three containers (`backend-billing-manager`, `backend-billing-manager-worker`, `backend-billing-manager-scheduler`) sharing **`decabill-billing-api`**.

See **[Background Jobs](../deployment/background-jobs.md)** for job names and intervals.

## Docker Image

**Image**: `ghcr.io/forepath/decabill-billing-api:latest`

**Dockerfile**: `apps/decabill/backend-billing-manager/Dockerfile.api`

Build locally:

```bash
nx run decabill-backend-billing-manager:api-container-image
```

Start the full stack:

```bash
cd apps/decabill/backend-billing-manager
docker compose up -d
```

Compose services: `postgres`, `redis`, `backend-billing-manager`, `backend-billing-manager-worker`, `backend-billing-manager-scheduler`, `mailhog`.

Volumes include `invoice_pdf_data` mounted at `/data/invoices` and optional `./provider-plugins` for dynamic providers.

## Authentication

Configure one method via `AUTHENTICATION_METHOD`:

| Method     | Key variables                  | Console pairing                                |
| ---------- | ------------------------------ | ---------------------------------------------- |
| `api-key`  | `STATIC_API_KEY`               | Automation; no dashboard WebSocket user stream |
| `keycloak` | `KEYCLOAK_*`                   | OAuth login in console                         |
| `users`    | `JWT_SECRET`, `DISABLE_SIGNUP` | Built-in register and login                    |

Optional `STATIC_API_KEY_TENANT_ID` binds API key auth to one tenant.

See **[Authentication](../features/authentication.md)**.

## Major API Areas

Full paths and schemas are in **[API Reference](../api-reference/README.md)** and `/spec/billing-manager/openapi.yaml`.

| Area             | Example paths                          | Notes                                           |
| ---------------- | -------------------------------------- | ----------------------------------------------- |
| Public offerings | `GET /public/service-plan-offerings`   | Unauthenticated marketing data                  |
| Catalog          | `/service-types`, `/service-plans`     | Admin CRUD                                      |
| Subscriptions    | `/subscriptions`, `/backorders`        | Order, cancel, resume                           |
| Invoices         | `/invoices`, open positions            | PDF download, void, pay                         |
| Customer         | `/customer-profile`                    | Required before ordering                        |
| Admin billing    | `/admin/billing/*`                     | Manual invoices, profiles, statistics, bill-now |
| Projects         | `/projects`, `/admin/billing/projects` | Customer read; admin CRUD and bill-time         |
| Payments         | `/invoices/{id}/pay`, Stripe webhook   | Checkout redirect                               |
| Availability     | `/availability/check`                  | Provider capacity                               |

Send `X-Tenant` on every request when using multi-tenancy.

## WebSocket Gateways

Both gateways listen on **`WEBSOCKET_PORT`** (default **8082**) as separate Socket.IO namespaces.

### Dashboard status (`billing`)

AsyncAPI documents the **`billing`** namespace:

- Client: `subscribeDashboardStatus`, `unsubscribeDashboardStatus`
- Server: `dashboardStatusUpdate`, `error`

Requires the same user JWT or Keycloak session as interactive REST calls. Connect to `http://<host>:8082/billing` with authorization in the handshake.

See **[Real-time Status](../features/real-time-status.md)**.

### Project board (`projects`)

AsyncAPI documents the **`projects`** namespace (env: `PROJECTS_WEBSOCKET_NAMESPACE`):

- Client: `setProject` with `{ projectId }`
- Server: `setProjectSuccess`, board mutation events (`ticketUpsert`, `milestoneUpsert`, `timeEntryUpsert`, `projectSummaryChanged`, …), `error`

Clients join room `project:{projectId}` after access validation. API key auth is rejected.

See **[Project Board](../features/project-board.md)**.

Spec: `/spec/billing-manager/asyncapi.yaml`

## Stripe and Provisioning

- **Stripe** - `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, checkout return URLs, `BILLING_DEFAULT_PAYMENT_PROCESSOR`
- **Hetzner / DigitalOcean** - `HETZNER_API_TOKEN`, `DIGITALOCEAN_API_TOKEN`
- **DNS** - Optional Cloudflare integration (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`, `DNS_BASE_DOMAIN`)

See **[Payment Processing](../features/payment-processing.md)** and **[Server Provisioning](../features/server-provisioning.md)**.

## Development Commands

```bash
# Run locally (set QUEUE_ROLE=all in .env)
nx serve decabill-backend-billing-manager

# Build
nx build decabill-backend-billing-manager

# Tests
nx test decabill-backend-billing-manager

# Generate TypeScript client from OpenAPI
nx run decabill-backend-billing-manager:generate-client
```

Published client package: `@forepath/decabill-billing-manager-client` (generated from the same OpenAPI spec).

## Bull Board (Local)

When enabled on an API or `all` process:

- URL: `http://localhost:3200/admin/queues`
- Default credentials: `admin` / `bullmq` (override with `QUEUE_BULL_BOARD_USERNAME` and `QUEUE_BULL_BOARD_PASSWORD`)

Disable in production unless tightly access-controlled.

## Related Documentation

- **[Frontend Billing Console](./frontend-billing-console.md)** - UI routes and SSR
- **[Architecture Components](../architecture/components.md)** - Infrastructure dependencies
- **[Data Flow](../architecture/data-flow.md)** - Sequence diagrams
- **[Environment Configuration](../deployment/environment-configuration.md)** - Complete env list
- **[Billing Administration](../features/billing-administration.md)** - Admin features
- **[API Reference](../api-reference/README.md)** - OpenAPI and AsyncAPI

## License

This application is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**.

Copyright (c) 2025 IPvX UG (haftungsbeschränkt)

This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the [GNU Affero General Public License](https://www.gnu.org/licenses/agpl-3.0.html) for more details.

**Note**: This component is sublicensed under AGPL-3.0, while other Decabill components (such as the billing console) may use different licenses. Modifications and derivative works of this backend must remain under AGPL-3.0 and must be made available to users, including when accessed over a network.

---

_Canonical OpenAPI source: `libs/domains/decabill/backend/feature-billing-manager/spec/openapi.yaml`_
