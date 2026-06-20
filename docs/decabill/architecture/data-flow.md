# Data Flow

This document describes communication patterns and end-to-end data flows across the Decabill billing console and billing manager.

## HTTP REST API Flow

### Authenticated read (example: list subscriptions)

```mermaid
sequenceDiagram
    participant B as Browser
    participant C as Billing Console
    participant A as Billing Manager API
    participant DB as PostgreSQL

    B->>C: Navigate to /subscriptions
    C->>A: GET /api/subscriptions (Bearer JWT, X-Tenant)
    A->>A: Validate auth and tenant
    A->>DB: Query subscriptions for user
    DB-->>A: Rows
    A-->>C: JSON array
    C->>C: NgRx loadSubscriptionsSuccess
    C-->>B: Render plans list
```

Admin routes under `/api/admin/billing/*` follow the same pattern with role checks. API key auth bypasses user identity but grants admin REST access when configured.

### Subscription order with availability check

```mermaid
sequenceDiagram
    participant U as User
    participant C as Billing Console
    participant A as Billing Manager API
    participant P as Cloud Provider API
    participant DB as PostgreSQL

    U->>C: Select plan and submit order
    C->>A: POST /api/availability/check
    A->>P: Provider capacity query
    P-->>A: Available / unavailable
    A-->>C: Availability result
    alt Available
        C->>A: POST /api/subscriptions
        A->>DB: Create subscription and items
        A->>P: Provision server (if plan requires)
        P-->>A: Server reference
        A->>DB: Update item status and snapshot
        A-->>C: Subscription created
    else Unavailable with autoBackorder
        C->>A: POST /api/subscriptions (autoBackorder)
        A->>DB: Create backorder row
        A-->>C: Backorder queued
    end
    C-->>U: Confirmation or backorder message
```

See **[Subscriptions](../features/subscriptions.md)** and **[Backorders](../features/backorders.md)**.

## WebSocket Dashboard Flow

The overview page connects to the billing namespace and subscribes to periodic server status for provisioned subscription items owned by the logged-in user.

```mermaid
sequenceDiagram
    participant C as Billing Console
    participant W as Status Gateway :8082/billing
    participant S as Domain Services
    participant DB as PostgreSQL
    participant H as Provisioned Host

    C->>W: Connect (auth handshake, X-Tenant)
    W->>W: Validate JWT / Keycloak user
    C->>W: subscribeDashboardStatus
    loop Each poll interval
        W->>S: Resolve user subscriptions
        S->>DB: Load active items
        S->>H: SSH or provider status (as configured)
        H-->>S: Running / stopped / metrics
        S-->>W: Server info DTOs
        W-->>C: dashboardStatusUpdate (unicast)
    end
    C->>W: unsubscribeDashboardStatus (on leave)
```

Poll interval is clamped between 10s and 120s. Default server interval comes from `STATUS_POLL_INTERVAL` (15000 ms).

REST fallback: `GET /api/subscriptions/.../server-info` when WebSocket is disabled or unavailable. See **[Dashboard and Server Control](../features/dashboard-and-server-control.md)**.

## Stripe Redirect and Webhook Flow

Checkout is initiated over HTTP. Payment state is finalized asynchronously via Stripe webhooks.

```mermaid
sequenceDiagram
    participant U as User
    participant C as Billing Console
    participant A as Billing Manager API
    participant ST as Stripe
    participant DB as PostgreSQL

    U->>C: Pay invoice
    C->>A: POST /api/invoices/{id}/pay
    A->>DB: Load invoice and profile
    A->>ST: Create Checkout Session
    ST-->>A: session.url
    A-->>C: Redirect URL
    C->>ST: Browser redirect to Checkout
    U->>ST: Complete or cancel payment
    ST->>U: Redirect to success or cancel URL
    Note over ST,A: Async webhook
    ST->>A: POST /api/stripe/webhook (signed)
    A->>A: Verify signature and tenant metadata
    A->>DB: Mark invoice paid / record failure
    U->>C: Land on /invoices?payment=success
    C->>A: GET /api/invoices (refresh)
    A-->>C: Updated payment state
```

Tenant-specific return URLs resolve from `TENANT_FRONTEND_URLS` or `BILLING_FRONTEND_URL`. See **[Payment Processing](../features/payment-processing.md)** and **[Invoices](../features/invoices.md)**.

## Open Position and Billing Day Flow

Recurring charges accumulate as open positions until the user's billing day scheduler creates a consolidated invoice.

```mermaid
sequenceDiagram
    participant SCH as Scheduler role
    participant Q as BullMQ billing queue
    participant W as Worker role
    participant DB as PostgreSQL

    SCH->>Q: Enqueue subscription-billing.coordinator (repeatable)
    Q->>W: coordinator job
    W->>DB: Find due subscription billing work
    W->>Q: Enqueue subscription-billing.unit per item
    Q->>W: unit jobs
    W->>DB: Create open position rows

    SCH->>Q: Enqueue open-position-invoice.coordinator
    Q->>W: coordinator
    W->>DB: Users whose billing day is today
    W->>Q: open-position-invoice.unit per user
    Q->>W: unit
    W->>DB: Create invoice from open positions
    W->>DB: Generate PDF metadata
```

Admin **bill-now** follows a similar coordinator and unit pattern outside the normal schedule. See **[Billing Administration](../features/billing-administration.md)**.

## Server Provisioning Flow

When a service plan includes infrastructure, the manager provisions a cloud server and records connection details on the subscription item.

```mermaid
sequenceDiagram
    participant A as Billing Manager
    participant P as Cloud Provider
    participant S as New Server
    participant DNS as Cloudflare (optional)
    participant DB as PostgreSQL

    A->>P: Create server with cloud-init
    P->>S: Boot instance
    S->>S: cloud-init installs Docker stack
    S->>S: Start postgres, API, console behind nginx
    P-->>A: Server id and IP
    A->>DNS: Create A record (when configured)
    A->>DB: Store server info snapshot on item
    A->>DB: Reserve hostname if applicable
```

Later, the **subscription-item-update** scheduler SSHes to the host and runs `docker compose up -d --pull=always` to refresh bundled stacks. See **[Server Provisioning](../features/server-provisioning.md)**.

## Backorder Retry Flow

```mermaid
sequenceDiagram
    participant SCH as Scheduler
    participant W as Worker
    participant A as Billing Manager
    participant P as Provider
    participant DB as PostgreSQL

    SCH->>W: backorder-retry.coordinator
    W->>DB: Load pending or retrying backorders
    loop Each backorder
        W->>A: Retry availability and order logic
        A->>P: Capacity check
        alt Capacity available
            A->>DB: Promote to subscription
        else Still unavailable
            A->>DB: Increment retry, keep queued
        end
    end
```

Users may also trigger manual retry or cancel from the console when exposed in UI effects.

## Admin Manual Invoice Flow

```mermaid
sequenceDiagram
    participant Admin as Admin User
    participant C as Billing Console
    participant A as Billing Manager API
    participant DB as PostgreSQL

    Admin->>C: Create draft manual invoice
    C->>A: POST /api/admin/billing/invoices
    A->>DB: Insert draft
    Admin->>C: Edit lines and issue
    C->>A: POST .../issue
    A->>DB: Finalize invoice, PDF path
    A-->>C: Issued invoice
```

Void, mark paid, and mark unpaid operations update invoice state without Stripe when paid offline. See **[Billing Administration](../features/billing-administration.md)**.

## Multi-Tenant Request Flow

Every HTTP and WebSocket call carries tenant context:

1. Client sends `X-Tenant` (HTTP header or socket auth metadata)
2. API validates against `TENANTS` allowlist
3. Services scope queries with `tenant_id`
4. Stripe webhooks recover tenant id from Checkout Session metadata

See **[Multi-tenancy](../features/multi-tenancy.md)**.

## State Management Flow (NgRx)

```mermaid
graph TB
    A[Component action] --> B[Facade]
    B --> C[Effect]
    C --> D[Billing HTTP or Socket service]
    D --> E[Success or failure action]
    E --> F[Reducer]
    F --> G[Store]
    G --> H[Selector]
    H --> I[Component template]
```

Dashboard socket effects (`connectBillingDashboardSocket$`, `billingDashboardSocketApplicationErrorFallback$`) bridge Socket.IO events into the `billingDashboardSocket` slice used by the overview page.

## Related Documentation

- **[System Overview](./system-overview.md)** - Tier architecture
- **[Components](./components.md)** - Runtime components
- **[Real-time Status](../features/real-time-status.md)** - WebSocket contract details
- **[API Reference](../api-reference/README.md)** - OpenAPI and AsyncAPI specs

---

_For queue job names and intervals, see **[Background Jobs](../deployment/background-jobs.md)**._
