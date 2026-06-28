# Features Documentation

This section provides comprehensive documentation for all features in the Decabill billing product.

## Overview

Decabill provides a complete set of capabilities for subscription billing, invoicing, payments, and optional infrastructure provisioning:

- **Authentication** - Keycloak OAuth2/OIDC, built-in users with JWT, or static API key
- **Multi-tenancy** - Tenant-scoped data with `X-Tenant` header and configurable tenant frontends
- **Subscriptions** - Order, cancel, and resume service plans with optional cloud provisioning
- **Invoices** - ZUGFeRD PDFs, open positions, billing-day accumulation, and Stripe checkout
- **Service Types and Plans** - Admin-managed catalog with provider schemas and pricing
- **Billing Administration** - Manual invoices, customer profiles, KPIs, and bill-now
- **Customer Profiles** - Self-service and admin billing metadata required for ordering
- **Dashboard and Server Control** - Overview of subscriptions with start, stop, and restart actions
- **Real-time Status** - WebSocket dashboard stream for provisioned server status
- **Backorders** - Queue and retry when provider capacity is unavailable
- **Payment Processing** - Stripe checkout and webhook-driven payment state
- **Dynamic Provider Plugins** - Extend payment processors and billing UI metadata at runtime
- **Server Provisioning** - Cloud-init deployment of bundled product stacks for eligible plans
- **CloudInit Configs** - Admin-managed Docker templates for the custom service kind
- **Projects** - Customer-assigned work tracking with admin CRUD and billable time
- **Project Board** - Live ticket board with swimlanes and WebSocket updates

## Features

### [Authentication](./authentication.md)

Multiple authentication methods with configurable user registration. Supports API key, Keycloak OAuth2/OIDC, and built-in users with JWT.

**Key Capabilities**:

- Static API key for automation and single-operator deployments
- Keycloak OAuth2/OIDC for enterprise SSO
- Built-in user registration with email confirmation
- Password reset with 6-character alphanumeric codes
- Admin user management and optional signup disable

### [Multi-tenancy](./multi-tenancy.md)

Isolate billing data per tenant while sharing one billing manager deployment. Same email can register separately in each tenant.

**Key Capabilities**:

- `X-Tenant` header on HTTP and WebSocket requests
- `TENANTS` environment allowlist
- `TENANTS_ALLOW_DEFAULT=false` to exclude the implicit `default` tenant
- Per-tenant Stripe return URLs via `TENANT_FRONTEND_URLS`
- Optional `STATIC_API_KEY_TENANT_ID` to bind API key auth to one tenant

### [Subscriptions](./subscriptions.md)

Order service plans, manage lifecycle (cancel, resume), and provision cloud instances when the plan includes infrastructure.

**Key Capabilities**:

- Subscription creation with availability checks and provider config validation
- Cancel and resume with effective dates
- Subscription items with provisioning status and hostname reservation
- Usage records for usage-based pricing

### [Invoices](./invoices.md)

Issue, preview, download, void, and pay invoices. Open positions accumulate until each user's billing day.

**Key Capabilities**:

- ZUGFeRD-style PDFs with EN 16931 XML embedded
- Open positions and billing-day scheduler
- Stripe checkout initiation and webhook reconciliation
- Admin manual invoice draft, edit, and issue workflow

### [Service Types and Plans](./service-types-and-plans.md)

Admin-managed catalog of service types, provisioning providers, and priced service plans.

**Key Capabilities**:

- Provider registry with config schemas and server type pricing
- Public unauthenticated plan offerings for marketing pages
- Customer geography selection when the provider schema supports it
- Pricing preview before order

### [Billing Administration](./billing-administration.md)

Admin-only features for manual invoices, customer billing profiles, operational dashboards, and bill-now.

**Key Capabilities**:

- Draft, edit, issue, and void manual invoices
- Customer billing profile CRUD
- Billing summary, statistics, and open or overdue invoice lists
- Bill-now to force invoice generation outside the scheduler

### [Customer Profiles](./customer-profiles.md)

Billing metadata required before subscription orders and for compliant invoice issuance.

**Key Capabilities**:

- Self-service `GET/POST /customer-profile`
- Admin CRUD under `/admin/billing/customer-profiles`
- Stripe customer ID stored on profile when payments are initiated
- Completeness validation before `POST /subscriptions`

### [Dashboard and Server Control](./dashboard-and-server-control.md)

Customer overview of active subscriptions with live server status and power actions.

**Key Capabilities**:

- Overview page with subscription cards and server info
- Start, stop, and restart provisioned servers
- REST fallback when WebSocket is not configured
- Links to invoices and subscription detail

### [Real-time Status](./real-time-status.md)

Socket.IO dashboard status stream for provisioned subscription items.

**Key Capabilities**:

- `subscribeDashboardStatus` with configurable poll interval
- User-scoped subscription selection on every tick
- JWT or Keycloak handshake auth (API key rejected)
- `dashboardStatusUpdate` events mirroring REST server-info shape

### [Backorders](./backorders.md)

Queue subscription requests when provider capacity is unavailable and retry automatically or on demand.

**Key Capabilities**:

- Automatic backorder creation when ordering with `autoBackorder`
- Scheduled retry processor for pending and retrying backorders
- Manual retry and cancel via API
- Encrypted requested config snapshot at rest

### [Payment Processing](./payment-processing.md)

Stripe checkout sessions and webhook-driven payment reconciliation.

**Key Capabilities**:

- `POST .../pay` initiates Stripe Checkout
- Tenant-aware success and cancel redirect URLs
- Idempotent Stripe webhook handling
- Default processor configurable via `BILLING_DEFAULT_PAYMENT_PROCESSOR`

### [Dynamic Provider Plugins](./dynamic-provider-plugins.md)

Extend billing backends with extra payment processors and billing UI provider metadata without forking the image.

**Key Capabilities**:

- `DYNAMIC_PAYMENT_PROCESSORS` for payment backends
- `DYNAMIC_BILLING_PROVIDER_METADATA` for admin UI registry entries
- Baked-in or post-build plugin loading via shared dynamic provider registry
- Critical registry fail-fast in production

### [Server Provisioning](./server-provisioning.md)

Automated cloud server provisioning via cloud-init when service plans include infrastructure.

**Key Capabilities**:

- Hetzner Cloud and DigitalOcean built-in providers
- Docker stack with PostgreSQL, backend API, and frontend console behind Nginx
- Let's Encrypt TLS with DNS A record creation
- SSH-based subscription item update scheduler

### [CloudInit Configs](./cloud-init-configs.md)

Admin-managed Docker deployment templates for the `custom` service kind on provisioning plans.

**Key Capabilities**:

- Reusable CloudInit templates with Docker image, ports, and work directory
- Per-variable metadata and encrypted admin defaults
- Customer order form fields driven by `showInOrderForm`
- Single-service compose provisioning without Nginx or Let's Encrypt in v1

### [Projects](./projects.md)

Customer-assigned project tracking with admin CRUD, time entries, KPI summaries, and bill-time invoicing.

**Key Capabilities**:

- One project per assigned customer user (`userId`)
- Admin CRUD under `/admin/billing/projects`
- Customer read-only list and detail under `/projects`
- `POST .../bill-time` issues invoice from unbilled time entries
- KPI summary with tracked, unbilled, and billed amounts

### [Project Board](./project-board.md)

Live Kanban board for project tickets with Socket.IO on namespace **`projects`**.

**Key Capabilities**:

- Swimlanes for draft, todo, in progress, and prototype statuses
- Admin ticket and milestone CRUD; customer comments
- Room-based broadcasts after REST mutations
- `setProject` handshake to join `project:{projectId}`

## Feature Relationships

```mermaid
graph TB
    AUTH[Authentication]
    MT[Multi-tenancy]
    ST[Service Types and Plans]
    SUB[Subscriptions]
    CP[Customer Profiles]
    INV[Invoices]
    PP[Payment Processing]
    BA[Billing Administration]
    BO[Backorders]
    SP[Server Provisioning]
    CIC[CloudInit Configs]
    DASH[Dashboard and Server Control]
    RT[Real-time Status]
    DP[Dynamic Provider Plugins]
    PRJ[Projects]
    PB[Project Board]

    AUTH --> MT
    MT --> SUB
    MT --> INV
    MT --> BA
    ST --> SUB
    ST --> CIC
    CIC --> SUB
    CP --> SUB
    CP --> INV
    SUB --> SP
    SUB --> BO
    SUB --> DASH
    SP --> DASH
    DASH --> RT
    INV --> PP
    BA --> INV
    BA --> CP
    DP --> PP
    DP --> ST
    SUB --> INV
    BA --> PRJ
    CP --> PRJ
    PRJ --> PB
    PRJ --> INV
```

## Related Documentation

- **[Getting Started](../getting-started.md)** - Quick start guide
- **[Architecture](../architecture/README.md)** - System architecture
- **[Applications](../applications/README.md)** - Application documentation
- **[Deployment](../deployment/README.md)** - Deployment guides
- **[API Reference](../api-reference/README.md)** - OpenAPI and AsyncAPI specifications

---

_For detailed information about each feature, see the individual feature documentation pages._
