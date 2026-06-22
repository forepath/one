# Frontend Billing Console

Angular web application with localized builds and an Express SSR server for customer self-service and billing administration.

## Purpose

The billing console is the primary user interface for Decabill. It connects to the billing manager REST API and dashboard WebSocket gateway. It does not embed business rules for invoicing or provisioning; those remain server-side.

Customers use it to manage subscriptions, pay invoices, and view provisioned server status. Administrators manage service types, service plans, manual invoices, customer billing profiles, and users.

## Features

This application provides:

- **Overview dashboard** - Subscription cards, server status, start/stop/restart actions
- **Plans** - Browse and order service plans, manage subscription lifecycle
- **Invoices** - List, detail, download, and Stripe checkout redirect
- **Customer profile** - Billing metadata required before ordering
- **Administration** - Service types, service plans, billing KPIs, manual invoices, billing profiles (admin only)
- **Identity UI** - Login, registration, password reset, email confirmation, user management
- **Real-time status** - Socket.IO subscription on the overview page
- **Localization** - English and German builds with locale-prefixed SSR paths
- **Runtime configuration** - Express `/config` endpoint for deployed environments

## Architecture

Built with:

- **Angular** - Components, routing, and i18n
- **NgRx** - State, effects, and facades from `@forepath/decabill/frontend/data-access-billing-console`
- **Express** - SSR static file server (`src/server.ts`)
- **Bootstrap 5** - Layout and components
- **Socket.IO client** - Dashboard status namespace
- **Identity bundle** - `@forepath/identity/frontend` for auth routes and guards

Feature components live in `@forepath/decabill/frontend/feature-billing-console` and are wired through `billingConsoleRoutes`.

## Routes Overview

All routes render inside `BillingConsoleContainerComponent` unless noted. Paths below omit the optional locale prefix (`/en`, `/de`) that the Express server injects in SSR mode.

### Default and customer routes

| Path             | Guard       | Component     | Description                              |
| ---------------- | ----------- | ------------- | ---------------------------------------- |
| `/`              | none        | redirect      | Redirects to `dashboard`                 |
| `/dashboard`     | `authGuard` | Overview      | Subscription overview and server control |
| `/subscriptions` | `authGuard` | Subscriptions | Plans list and ordering                  |
| `/invoices`      | `authGuard` | Invoices      | Invoice list, payment, and detail        |

Stripe return URLs typically land on `/invoices?payment=success` or `?payment=cancel`.

### Identity routes (from `identityAuthRoutes`)

| Path                                   | Guard                               | Description                        |
| -------------------------------------- | ----------------------------------- | ---------------------------------- |
| `/login`                               | `loginGuard`                        | Email/password or Keycloak entry   |
| `/register`                            | `signupDisabledGuard`, `loginGuard` | Self-service registration          |
| `/request-password-reset`              | `loginGuard`                        | Request reset code                 |
| `/request-password-reset-confirmation` | `loginGuard`                        | Confirmation message               |
| `/reset-password`                      | `loginGuard`                        | Submit reset code and new password |
| `/confirm-email`                       | `loginGuard`                        | Email confirmation code            |
| `/users`                               | `authGuard`, `adminGuard`           | Admin user management              |

### Administration routes (`billingAdminGuard` plus `authGuard`)

| Path                                | Component                 | Description                          |
| ----------------------------------- | ------------------------- | ------------------------------------ |
| `/administration/service-types`     | ServiceTypesPage          | Provider and service type catalog    |
| `/administration/service-plans`     | ServicePlansPage          | Priced plans and ordering highlights |
| `/administration/billing`           | AdminBillingPage          | KPIs, bill-now, open/overdue lists   |
| `/administration/customer-profiles` | AdminCustomerProfilesPage | Customer billing profile CRUD        |

Unknown paths redirect to the shell root (`**` to ``).

## Express SSR Server

Production and Docker deployments run the compiled Express server from `src/server.ts`.

### Responsibilities

- Security headers via `createSecurityHeadersMiddleware()`
- Runtime config registration via `registerRuntimeConfigEndpoint(app)` (`/config`)
- Locale detection from URL prefix, `Accept-Language`, or `DEFAULT_LOCALE`
- Static serving of per-locale Angular browser bundles
- SPA fallback: non-file routes receive `index.html` for client routing
- Monaco-related middleware for assets when bundled

### Environment variables (server)

| Variable                | Default                                              | Purpose                                    |
| ----------------------- | ---------------------------------------------------- | ------------------------------------------ |
| `HOST`                  | `0.0.0.0`                                            | Bind address                               |
| `PORT`                  | `4200` in generic server; **4500** in Docker compose | Listen port                                |
| `DEFAULT_LOCALE`        | `en`                                                 | Fallback locale                            |
| `CSP_ENFORCE`           | `true` in compose                                    | Content-Security-Policy enforcement        |
| `CSP_CONNECT_SRC_EXTRA` | API origin                                           | Allow API and WebSocket in CSP connect-src |

Local `nx serve` uses the Angular dev server on port **4500** without Express unless you build and run `serve-server`.

## Configuration

### Build-time environment

Development builds replace `environment.ts` with `environment.decabill.ts`:

```typescript
billing: {
  restApiUrl: 'http://localhost:3200/api',
  frontendUrl: 'http://localhost:4500',
  websocketUrl: 'http://localhost:8082/billing',
  tenantId: 'decabill',
},
authentication: {
  type: 'users',
  disableSignup: false,
},
```

Production uses `environment.decabill.production.ts`. Align `authentication.type` with backend `AUTHENTICATION_METHOD`.

### Docker image

**Image**: `ghcr.io/forepath/decabill-billing-console-server:latest`

Build locally:

```bash
nx run decabill-frontend-billing-console:container-image
```

Compose file: `apps/decabill/frontend-billing-console/docker-compose.yaml`

## NgRx State Slices

The route providers register facades and reducers for:

- `subscriptions`, `subscriptionServerInfo`, `servicePlans`, `serviceTypes`
- `invoices`, `customerProfile`, `backorders`, `availability`
- `adminBilling`, `adminInvoiceManager`, `adminCustomerProfiles`
- `billingDashboardSocket` (WebSocket lifecycle and status payloads)

Effects call the billing manager HTTP client and socket service; see `billing-console.routes.ts` for the full effect list.

## Development Commands

```bash
# Dev server (port 4500)
nx serve decabill-frontend-billing-console

# Production build (localized)
nx build decabill-frontend-billing-console

# SSR server after build
nx run decabill-frontend-billing-console:serve-server

# Unit tests
nx test decabill-frontend-billing-console
```

## Docker Compose

```bash
cd apps/decabill/frontend-billing-console
docker compose up -d
```

Ensure `CSP_CONNECT_SRC_EXTRA` includes the browser-reachable billing manager origin (for example `http://host.docker.internal:3200` on Docker Desktop).

## Related Documentation

- **[Backend Billing Manager](./backend-billing-manager.md)** - API and WebSocket endpoints
- **[Authentication](../features/authentication.md)** - Login methods
- **[Dashboard and Server Control](../features/dashboard-and-server-control.md)** - Overview behavior
- **[Real-time Status](../features/real-time-status.md)** - WebSocket events
- **[Getting Started](../getting-started.md)** - Local setup
- **[Docker Deployment](../deployment/docker-deployment.md)** - Container deployment

---

_For HTTP request schemas, see **[API Reference](../api-reference/README.md)**._

## License

This application is licensed under the **Business Source License 1.1 (BUSL-1.1)** with an Additional Use Grant.

Copyright (c) 2025 IPvX UG (haftungsbeschränkt)

BUSL permits non-production use and limited production use subject to the Additional Use Grant (typically for organizations below the Total Finances threshold on the [Decabill pricing page](https://decabill.com/pricing)). The license converts to **AGPL-3.0** after the Change Date (three years from release date).

See [LICENSE](../../../apps/decabill/frontend-billing-console/LICENSE) for the full text and alternative commercial licensing at [decabill.com](https://decabill.com).
