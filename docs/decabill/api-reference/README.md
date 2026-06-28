# API Reference

Complete API specifications for the Decabill billing manager. Specifications are published as OpenAPI 3.1.0 (HTTP REST) and AsyncAPI 3.0.0 (WebSocket gateways).

## Billing Manager HTTP API

The billing manager exposes all billing, subscription, invoice, catalog, and admin operations over HTTP on port **3200** with global prefix **`/api`**.

### OpenAPI Specification

**Specification file**: [openapi.yaml](/spec/billing-manager/openapi.yaml)

- **View in Swagger Editor**: [Open in Swagger Editor](https://editor.swagger.io/?url=https://docs.decabill.com/spec/billing-manager/openapi.yaml)
- **Download**: [openapi.yaml](/spec/billing-manager/openapi.yaml)

Canonical source in the monorepo: `libs/domains/decabill/backend/feature-billing-manager/spec/openapi.yaml`

The HTTP API includes:

- **Public offerings** - Unauthenticated plan listings for marketing pages
- **Service catalog** - Service types, service plans, and CloudInit configs (admin)
- **Subscriptions and backorders** - Order, cancel, resume, retry, and availability
- **Customer profile** - Self-service billing metadata
- **Invoices and open positions** - Issue, preview, download, void, pay, and billing-day accumulation
- **Admin billing** - Manual invoices, customer profiles, statistics, audit logs, bill-now
- **Projects** - Customer project reads, admin CRUD, board tickets/milestones/time entries, bill-time
- **Authentication and users** - Login, register, and user management when `AUTHENTICATION_METHOD=users`
- **Stripe webhook** - Signed payment event handling
- **Configuration** - `GET /config` for operator-visible settings

### Authentication

Unless documented as public, operations require authentication:

- **Bearer JWT** when using built-in users
- **Bearer Keycloak access token** when using Keycloak
- **Bearer or ApiKey static key** when using `AUTHENTICATION_METHOD=api-key`

Send **`X-Tenant`** on every request for multi-tenant deployments. Invalid tenant ids return **400**.

See **[Authentication](../features/authentication.md)**.

### Admin manual invoices and customer profiles

Admin CRUD for manual invoices and customer billing profiles is documented in the OpenAPI **`/admin/billing/*`** paths.

Product-oriented guide: **[Billing Administration](../features/billing-administration.md)**

### Projects REST API

Project endpoints are tagged **`Projects`**, **`Project Board`**, and **`Admin Billing`** in OpenAPI:

| Audience | Example paths                                                            | Notes                             |
| -------- | ------------------------------------------------------------------------ | --------------------------------- |
| Customer | `GET /projects`, `GET /projects/{projectId}/summary`                     | Assigned projects only; read-only |
| Board    | `GET/POST /projects/{projectId}/tickets`, `/milestones`, `/time-entries` | Admin write; customer comments    |
| Admin    | `GET/POST/DELETE /admin/billing/projects`, `POST .../bill-time`          | CRUD and time billing             |

Product guides: **[Projects](../features/projects.md)** and **[Project Board](../features/project-board.md)**

## Billing Manager WebSocket Gateways

The billing manager runs a Socket.IO server on port **8082** (default) with two namespaces, separate from the HTTP listener.

Static API key authentication is **not** sufficient for dashboard or project board streams. Connections require an end-user JWT or Keycloak identity, matching REST billing rules.

### AsyncAPI Specification

**Specification file**: [asyncapi.yaml](/spec/billing-manager/asyncapi.yaml)

- **View in AsyncAPI Studio**: [Open in AsyncAPI Studio](https://studio.asyncapi.com/?url=https://docs.decabill.com/spec/billing-manager/asyncapi.yaml)
- **Download**: [asyncapi.yaml](/spec/billing-manager/asyncapi.yaml)

Canonical source in the monorepo: `libs/domains/decabill/backend/feature-billing-manager/spec/asyncapi.yaml`

### Dashboard status (`billing`)

| Direction        | Event                        | Description                                                        |
| ---------------- | ---------------------------- | ------------------------------------------------------------------ |
| Client to server | `subscribeDashboardStatus`   | Start polling provisioned server status for the authenticated user |
| Client to server | `unsubscribeDashboardStatus` | Stop polling for this socket                                       |
| Server to client | `dashboardStatusUpdate`      | Periodic status payload (same shape as REST server-info)           |
| Server to client | `error`                      | Application errors scoped to the initiating socket                 |

Namespace: **`billing`** (env: `WEBSOCKET_NAMESPACE`).

Pass **`X-Tenant`** in handshake metadata (`auth.tenantId` in browser clients, `extraHeaders` in Node clients).

See **[Real-time Status](../features/real-time-status.md)**.

### Project board namespace (`projects`)

| Direction        | Event                                                                                             | Description                                        |
| ---------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Client to server | `setProject`                                                                                      | Join `project:{projectId}` room after access check |
| Server to client | `setProjectSuccess`                                                                               | Confirmation for initiating socket                 |
| Server to client | `ticketUpsert`, `ticketRemoved`, `milestoneUpsert`, `timeEntryUpsert`, `projectSummaryChanged`, … | Room broadcasts after REST mutations               |
| Server to client | `error`                                                                                           | Application errors scoped to the initiating socket |

Namespace: **`projects`** (env: `PROJECTS_WEBSOCKET_NAMESPACE`).

See **[Project Board](../features/project-board.md)**.

## Using the Specifications

### Swagger Editor

[Swagger Editor](https://editor.swagger.io/) helps you:

- Browse endpoints and schemas interactively
- Validate request and response models
- Export client stubs or documentation

Load the spec via the docs.decabill.com URL above or the local `/spec/billing-manager/openapi.yaml` path served by the docs site build.

### AsyncAPI Studio

[AsyncAPI Studio](https://studio.asyncapi.com/) helps you:

- Visualize dashboard socket message flows
- Inspect payload schemas for `dashboardStatusUpdate`
- Validate the AsyncAPI document

## Generated Client Package

The repository generates a TypeScript Axios client from the OpenAPI spec:

```bash
nx run decabill-backend-billing-manager:generate-client
```

Published npm package (GitHub Packages): **`@forepath/decabill-billing-manager-client`**

Configure `@forepath` scope in `.npmrc` to install from GitHub Packages. Clients are regenerated on release to stay aligned with the spec.

## Related Documentation

- **[Backend Billing Manager](../applications/backend-billing-manager.md)** - Ports, queue roles, and deployment
- **[Frontend Billing Console](../applications/frontend-billing-console.md)** - How the UI calls the API
- **[Architecture Data Flow](../architecture/data-flow.md)** - HTTP, WebSocket, Stripe, and provisioning sequences
- **[Features Overview](../features/README.md)** - Product capability index

---

_For operational deployment variables, see **[Environment Configuration](../deployment/environment-configuration.md)**._
