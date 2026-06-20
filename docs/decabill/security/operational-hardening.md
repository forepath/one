# Operational hardening

This page describes **implemented** security controls for Decabill that operators and security reviewers should know about. For **environment variable names and defaults**, see **[Environment configuration](../deployment/environment-configuration.md)**.

## Container images (Docker)

First-party Decabill images are hardened for production use. Full detail: **[Container image security](./container-images.md)**.

| Practice                | Detail                                                                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Non-root runtime**    | Billing API runs as **`agenstra`** (UID/GID **10001** by default); frontend servers run as **`node`** (**1000**).           |
| **No baked-in secrets** | Database, Stripe, encryption keys, and API keys are **not** defaulted in image `ENV`; operators supply them at deploy time. |
| **No Docker socket**    | Billing manager does not mount `/var/run/docker.sock`; provisioning uses cloud APIs and SSH from worker processes.          |
| **Image scanning**      | Repository `trivy.yaml` configures filesystem/config/image scans; CI fails on fixable CRITICAL findings.                    |

Deploy **billing API, worker, and scheduler** from the **same release tag** when migrations or job handlers change.

## Authentication mode (backends)

Resolution is implemented in **`getAuthenticationMethod`** (`libs/domains/identity/backend/util-auth/src/lib/hybrid-auth.guard.ts`):

- If **`AUTHENTICATION_METHOD`** is set to **`api-key`**, **`keycloak`**, or **`users`**, that value is used.
- If **`AUTHENTICATION_METHOD`** is **unset** or invalid:
  - If **`STATIC_API_KEY`** is set → effective mode **`api-key`**.
  - Otherwise → effective mode **`keycloak`**.

**`api-key`** without **`STATIC_API_KEY`** fails at runtime. Health endpoints **`/api/health`** and **`/health`** remain unauthenticated by design.

**Operator note:** Set **`AUTHENTICATION_METHOD`** explicitly if your security policy requires unambiguous configuration. See **DR-004** in **[Accepted risks](./accepted-risks.md)**.

## Billing manager multi-tenancy

| Control                        | Purpose                                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| **`X-Tenant` header**          | Selects tenant context on HTTP and billing WebSocket handshakes. Validated against **`TENANTS`**; unknown ids → **400**. |
| **`TenantUserGuard`**          | Ensures authenticated users' **`tenant_id`** matches the request tenant.                                                 |
| **`STATIC_API_KEY_TENANT_ID`** | Optional bind of API key auth to one tenant.                                                                             |

**Accepted risk [DR-002](./accepted-risks.md#dr-002--billing-multi-tenant-api-key-scope-static_api_key_tenant_id-unset):** With **`STATIC_API_KEY`** and **without** **`STATIC_API_KEY_TENANT_ID`**, one deployment API key grants **admin access to every tenant** in **`TENANTS`** (tenant chosen per request via **`X-Tenant`**). Interactive **keycloak** / **users** sessions remain limited to the user's tenant.

Code: `libs/domains/decabill/backend/feature-billing-manager/src/lib/guards/tenant-user.guard.ts`, `libs/domains/shared/backend/util-http-context/src/lib/tenant-id.middleware.ts`.

## Stripe webhooks

- Webhook signatures verified with **`STRIPE_WEBHOOK_SECRET`**
- Invalid signatures are rejected; do not disable verification in production
- Route webhook URL only to the billing API ingress; restrict by network policy where possible

## Logging and correlation

- **Correlation ID middleware** runs first on the billing API: accepts or generates `X-Correlation-Id` / `X-Request-Id`, binds AsyncLocalStorage, sets the response header, logs one **access line per request** with **path only** (no query string) and **`redactSecretsInString`** (Bearer, Basic, ApiKey-style fragments, email patterns).
- **`CorrelationAwareConsoleLogger`** adds `[corr=…]` (text) or `correlationId` (JSON) to Nest framework logs inside the request async context.

Code: `libs/domains/shared/backend/util-http-context/`.

Do not log Stripe secrets, full card data, or `STATIC_API_KEY` values.

## Frontend runtime configuration (`GET /config`)

When **`CONFIG`** points to a remote JSON URL, Express servers validate fetches using **`@forepath/shared/frontend/util-runtime-config-server`**:

- Production: **HTTPS** unless **`CONFIG_ALLOW_INSECURE_HTTP=true`**; **`CONFIG_ALLOWED_HOSTS`** required when `CONFIG` is set.
- Timeout, max bytes, JSON object shape, content-type, redirect blocking, optional key count/depth limits.
- DNS check against private/loopback resolution (skippable via **`CONFIG_SKIP_DNS_CHECK`** in exceptional cases).

**`CONFIG_ALLOWED_HOSTS`** supports **`*`** to explicitly allow **any host**. Prefer explicit host allowlists in production.

Applies to **decabill-frontend-billing-console** and **decabill-frontend-docs**.

See **[Environment configuration frontend applications](../deployment/environment-configuration.md#frontend-applications-express-ssr)**.

## Content Security Policy (frontend Express)

- CSP includes **`'unsafe-inline'`** and **`'unsafe-eval'`** for Monaco and tooling; default delivery is **`Content-Security-Policy-Report-Only`** unless **`CSP_ENFORCE=true`**.
- Billing console compose often sets **`CSP_ENFORCE=true`** after operators verify API connectivity via **`CSP_CONNECT_SRC_EXTRA`**.

Accepted risk: **DR-003** in **[Accepted risks](./accepted-risks.md)**.

## WebSocket CORS (billing manager)

- **`WEBSOCKET_CORS_ORIGIN`**: comma-separated allowed origins for the billing Socket.IO server.
- In **production**, if unset, behavior follows Nest/Socket.IO configuration; set explicitly to your billing console origins.

Dashboard status streaming is available to interactive authenticated users, not to API key clients.

## Origin allowlist (unsafe HTTP methods)

Browser-originated **state-changing** requests can be restricted by origin allowlist middleware on backends (`origin-allowlist.middleware.ts` in identity util-auth). Configure per deployment expectations.

## Bull Board

When enabled, `/admin/queues` uses HTTP Basic auth and bypasses API HybridAuthGuard so operators can manage jobs. Restrict network access to this path in production. See **[Background jobs](../deployment/background-jobs.md)**.

## Provisioning SSH

Cloud-init templates may configure root SSH for first-boot automation. See **DR-001** in **[Accepted risks](./accepted-risks.md)**.

## Related documentation

- **[Accepted risks](./accepted-risks.md)** - DR-001 through DR-005
- **[Environment configuration](../deployment/environment-configuration.md)**
- **[Production checklist](../deployment/production-checklist.md)**
- **[Vulnerability reporting and artifacts](./vulnerability-reporting-and-artifacts.md)** - Disclosure and response commitments

---

_For provisioning SSH, CSP, and API key scope operator summaries, see [Accepted risks](./accepted-risks.md)._
