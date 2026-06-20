# Architecture Documentation

This section covers the architectural principles, patterns, and structural decisions that guide the Decabill billing product. Understanding these concepts helps you deploy, integrate, and operate subscriptions, invoicing, and optional infrastructure provisioning.

## Overview

Decabill follows a **two-tier architecture** that separates customer and admin UI from billing backend services:

- **Frontend Billing Console** for self-service and administration
- **Backend Billing Manager** for HTTP API, background jobs, payments, and provisioning

The stack is built on:

- **Domain-driven modules** in `@forepath/decabill/backend` and `@forepath/decabill/frontend`
- **RESTful HTTP APIs** for synchronous billing operations
- **Socket.IO** for dashboard server status streaming
- **PostgreSQL** for persistent billing and identity data
- **Redis and BullMQ** for schedulers, workers, and repeatable jobs
- **Stripe** (and optional dynamic payment plugins) for checkout and webhooks

## Documentation Structure

### [System Overview](./system-overview.md)

High-level architecture and component relationships:

- Two-tier console and manager layout
- Communication patterns between browser, API, and data stores
- Visual architecture diagrams

### [Components](./components.md)

Detailed breakdown of runtime components:

- Frontend billing console (Angular SSR and Express)
- Backend billing manager (NestJS, queue roles, gateways)
- PostgreSQL, Redis, Stripe, and external cloud providers

### [Data Flow](./data-flow.md)

Communication patterns and end-to-end flows:

- HTTP REST for CRUD, checkout initiation, and admin operations
- WebSocket dashboard status polling
- Stripe redirect and webhook reconciliation
- Subscription provisioning and backorder retry

## Key Architectural Concepts

### Two-Tier Architecture

1. **Presentation tier** - Angular billing console with NgRx state, localized SSR, and Express static hosting
2. **Application tier** - NestJS billing manager with TypeORM, BullMQ workers, and provider integrations

There is no separate billing controller. The console talks directly to the billing manager API and WebSocket gateway.

### Queue Process Roles

The billing manager binary runs in one of four **QUEUE_ROLE** modes:

| Role        | HTTP API | Migrations | Repeatable schedulers | BullMQ workers | Bull Board       |
| ----------- | -------- | ---------- | --------------------- | -------------- | ---------------- |
| `api`       | Yes      | Yes        | No                    | No             | Optional         |
| `worker`    | No       | No         | No                    | Yes            | No               |
| `scheduler` | No       | No         | Yes                   | No             | No               |
| `all`       | Yes      | Yes        | Yes                   | Yes            | Optional (local) |

Production Docker Compose splits `api`, `worker`, and `scheduler` into separate containers sharing one image (`decabill-billing-api`).

### Authentication and Multi-Tenancy

- HTTP and WebSocket accept JWT (users), Keycloak tokens, or static API key depending on `AUTHENTICATION_METHOD`
- Optional `X-Tenant` header scopes data per tenant (`TENANTS` allowlist)
- Dashboard WebSocket requires an end-user billing identity (API key alone is insufficient)

See **[Authentication](../features/authentication.md)** and **[Multi-tenancy](../features/multi-tenancy.md)**.

### State Management

- **Frontend** - NgRx facades and effects for subscriptions, invoices, admin billing, and dashboard socket state
- **Backend** - PostgreSQL as source of truth; Redis for job queues; in-memory socket subscription timers for dashboard polling

## Related Documentation

### Getting Started

- **[Getting Started](../getting-started.md)** - Local setup and first login

### Features

- **[Subscriptions](../features/subscriptions.md)** - Order and lifecycle
- **[Invoices](../features/invoices.md)** - Open positions, PDFs, and payment
- **[Payment Processing](../features/payment-processing.md)** - Stripe checkout and webhooks
- **[Server Provisioning](../features/server-provisioning.md)** - Cloud-init stacks for eligible plans
- **[Real-time Status](../features/real-time-status.md)** - Dashboard WebSocket behavior

### Deployment

- **[Local Development](../deployment/local-development.md)** - Nx and compose setup
- **[Docker Deployment](../deployment/docker-deployment.md)** - Container images and services
- **[Background Jobs](../deployment/background-jobs.md)** - BullMQ coordinators and units
- **[Environment Configuration](../deployment/environment-configuration.md)** - Full env reference

### Applications

- **[Frontend Billing Console](../applications/frontend-billing-console.md)**
- **[Backend Billing Manager](../applications/backend-billing-manager.md)**

## Architecture Principles

### Scalability

- Horizontally scale **worker** containers for job throughput
- Run a single **scheduler** per Redis namespace to register repeatable coordinators
- Scale **api** containers behind a load balancer; WebSocket port may require sticky sessions or a dedicated gateway

### Maintainability

- Feature logic lives in `libs/domains/decabill/backend/feature-billing-manager` and frontend libraries consumed by the apps
- OpenAPI and AsyncAPI specs are the contract for HTTP and dashboard socket events

### Security

- Server-side validation on all billing inputs
- Encryption at rest for sensitive subscription and backorder snapshots (`ENCRYPTION_KEY`)
- Rate limiting and CORS on HTTP; CSP on the SSR console

See **[Security](../security/README.md)** for compliance-oriented documentation.

### Reliability

- Coordinator and unit job pattern prevents duplicate heavy work across tenants
- Backorder retry and subscription billing schedulers recover from transient provider failures
- Stripe webhooks are handled idempotently with tenant metadata

---

_For API contracts, see **[API Reference](../api-reference/README.md)**._
