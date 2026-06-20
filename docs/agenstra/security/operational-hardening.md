# Operational hardening

This page describes **implemented** security controls that operators and security reviewers should know about. For **environment variable names and defaults**, see **[Environment configuration](../deployment/environment-configuration.md)**.

## Container images (Docker)

First-party images are hardened for production use. Full detail (bind mounts, entrypoints, per-image `sudo` allowlists): **[Container image security](./container-images.md)**.

| Practice                      | Detail                                                                                                                                                                                                                                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Non-root runtime**          | Debian-based backends and worker/VNC/SSH/agi images run as **`agenstra`** (UID/GID **10001** by default); Alpine frontend servers run as **`node`** (**1000**).                                                                                                                                 |
| **No baked-in secrets**       | Database, Keycloak, VNC/SSH passwords, and API keys are **not** defaulted in image `ENV`; operators supply them at deploy time.                                                                                                                                                                 |
| **Restricted `sudo`**         | `agenstra` is **not** in the `sudo` group. Only commands listed in `/etc/sudoers.d/agenstra` run passwordless (typically `chown` on workspace mounts; API images add `groupmod` / `groupadd` / `usermod` for Docker socket GID sync). No other `sudo` is permitted, with or without a password. |
| **Workspace mount ownership** | Worker, VNC, SSH, and agi entrypoints `chown` bind-mounted agent data to `agenstra` when the host directory is root-owned.                                                                                                                                                                      |
| **Least privilege on socket** | Manager and controller API images mount the host Docker socket only when required. The entrypoint syncs the in-container `docker` group GID to the socket’s GID (`DOCKER_GID` build arg, default **995**), then starts Node with **`sg docker`**.                                               |
| **Worker credential paths**   | When cloning private Git repos, the manager writes `.netrc` and SSH keys under the worker’s **`$HOME`** (`/home/agenstra`), not `/root`.                                                                                                                                                        |
| **SSH access image**          | Optional SSH sidecar: runtime **`SSH_PASSWORD`** required; login as **`agenstra`**; `sshd` started only via allowed `sudo` in the entrypoint.                                                                                                                                                   |
| **Image scanning**            | Repository `trivy.yaml` configures filesystem/config/image scans; CI fails on CRITICAL findings (HIGH+ visible in SARIF).                                                                                                                                                                       |

Deploy **manager API, worker, VNC, SSH, and agi images from the same release** when paths or users change. See **[Docker deployment](../deployment/docker-deployment.md)** and **[Backend Agent Manager](../applications/backend-agent-manager.md)**.

## Authentication mode (backends)

Resolution is implemented in **`getAuthenticationMethod`** (`libs/domains/identity/backend/util-auth/src/lib/hybrid-auth.guard.ts`):

- If **`AUTHENTICATION_METHOD`** is set to **`api-key`**, **`keycloak`**, or **`users`**, that value is used.
- If **`AUTHENTICATION_METHOD`** is **unset** or invalid:
  - If **`STATIC_API_KEY`** is set → effective mode **`api-key`** (backward compatibility).
  - Otherwise → effective mode **`keycloak`**.

**`api-key`** without **`STATIC_API_KEY`** fails at runtime with an error. **Keycloak** and **users** modes rely on their respective guards after **`HybridAuthGuard`**. Health endpoints **`/api/health`** and **`/health`** remain unauthenticated by design.

**Operator note:** Set **`AUTHENTICATION_METHOD`** explicitly if your security policy requires unambiguous configuration. Implicit **keycloak** when neither an explicit mode nor **`STATIC_API_KEY`** is set is an **accepted risk**; see **AR-004** in **[Accepted risks](./accepted-risks.md)**.

## Billing manager — multi-tenancy

| Control                        | Purpose                                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| **`X-Tenant` header**          | Selects tenant context on HTTP and billing WebSocket handshakes. Validated against **`TENANTS`**; unknown ids → **400**. |
| **`TenantUserGuard`**          | Ensures authenticated users’ **`tenant_id`** matches the request tenant.                                                 |
| **`STATIC_API_KEY_TENANT_ID`** | Optional bind of API key auth to one tenant.                                                                             |

**Accepted risk [AR-007](./accepted-risks.md#ar-007--billing-multi-tenant-api-key-scope-static_api_key_tenant_id-unset):** With **`STATIC_API_KEY`** and **without** **`STATIC_API_KEY_TENANT_ID`**, one deployment API key grants **admin access to every tenant** in **`TENANTS`** (tenant chosen per request via **`X-Tenant`**). This is **intentional** for a single shared automation key. Interactive **keycloak** / **users** sessions remain limited to the user’s tenant.

Code: `libs/domains/decabill/backend/feature-billing-manager/src/lib/guards/tenant-user.guard.ts`, `libs/domains/shared/backend/util-http-context/src/lib/tenant-id.middleware.ts`.

## Agent Controller — remote client endpoints (SSRF)

Customer-configured **`client.endpoint`** values drive HTTP and WebSocket traffic from the controller to remote agent-managers.

| Control                                       | Purpose                                                                                                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`CLIENT_ENDPOINT_ALLOWED_HOSTS`**           | Comma-separated hostname allowlist. The literal **`*`** explicitly allows **any host**. **Required in production** — the controller **exits** on startup if unset. |
| **`CLIENT_ENDPOINT_ALLOW_INSECURE_HTTP`**     | Set to `true` only if `http:` endpoints must be allowed (discouraged).                                                                                             |
| **`CLIENT_ENDPOINT_TLS_REJECT_UNAUTHORIZED`** | Defaults to TLS verification on. **`false` is forbidden in production.**                                                                                           |
| **`CLIENT_ENDPOINT_SKIP_DNS_CHECK`**          | Skips DNS resolution defense (private/loopback rebinding). Use only in controlled test scenarios.                                                                  |

Using **`*`** for **`CLIENT_ENDPOINT_ALLOWED_HOSTS`** intentionally **widens** the reachable host set. Prefer **narrow** hostnames when feasible; combine with egress controls and monitoring.

DNS validation resolves the endpoint hostname and rejects addresses in private/loopback space (unless skipped as above). Literal private IPs are rejected by URL validation.

Code: `libs/domains/agenstra/backend/feature-agent-controller/src/lib/utils/client-endpoint-security.ts`.

## HTTP proxy to remote agent-manager — headers

Outbound proxied HTTP requests **drop** caller-supplied credential-like headers (`Authorization`, cookies, `x-api-key`, and similar) and attach only the **service-computed** `Authorization` for the **client entity** (stored API key or token). This avoids forwarding the **portal user’s** JWT on HTTP proxy paths.

Code: `libs/domains/agenstra/backend/feature-agent-controller/src/lib/utils/client-proxy-request-headers.ts` (used by `ClientAgentProxyService` and related `client-*-proxy` services).

WebSocket connections to **`/agents`** use **`getAuthHeader(clientId)`** from the same client credentials, not the browser handshake token alone.

## Logging and correlation

- **Correlation ID middleware** runs **first** on the backends: accepts or generates `X-Correlation-Id` / `X-Request-Id`, binds AsyncLocalStorage, sets the response header, logs one **access line per request** with **path only** (no query string) and **`redactSecretsInString`** (Bearer, Basic, ApiKey-style fragments, email patterns).
- **`CorrelationAwareConsoleLogger`** adds `[corr=…]` (text) or `correlationId` (JSON) to Nest framework logs inside the request async context.

Code: `libs/domains/shared/backend/util-http-context/`.

Structured error payloads logged from agent-controller proxies may pass through **`redactSensitive`**: `libs/domains/agenstra/backend/feature-agent-controller/src/lib/utils/redact-sensitive.ts`.

## Frontend runtime configuration (`GET /config`)

When **`CONFIG`** points to a remote JSON URL, Express servers validate fetches using **`@forepath/shared/frontend/util-runtime-config-server`**:

- Production: **HTTPS** unless **`CONFIG_ALLOW_INSECURE_HTTP=true`**; **`CONFIG_ALLOWED_HOSTS`** required when `CONFIG` is set.
- Timeout, max bytes, JSON object shape, content-type, redirect blocking, optional key count/depth limits.
- DNS check against private/loopback resolution (skippable via **`CONFIG_SKIP_DNS_CHECK`** in exceptional cases).
- Response **`Cache-Control`**: for example `private, max-age=60, stale-while-revalidate=300` in production on success; `no-store` on proxy errors.

**`CONFIG_ALLOWED_HOSTS`** supports **`*`** to explicitly allow **any host**. That choice increases risk if **`CONFIG`** points to an attacker-controlled origin; prefer explicit host allowlists in production.

See **[Environment configuration — Frontend (all `frontend-*` apps)](../deployment/environment-configuration.md)** for variable names.

## Content Security Policy (frontend Express)

- CSP includes **`'unsafe-inline'`** and **`'unsafe-eval'`** for Monaco and tooling; default delivery is **`Content-Security-Policy-Report-Only`**.
- Set **`CSP_ENFORCE=true`** only after verifying the application still works.

Accepted risk: **AR-003** in **[Accepted risks](./accepted-risks.md)**.

## WebSocket CORS (Agent Controller)

- **`WEBSOCKET_CORS_ORIGIN`**: comma-separated allowed origins for the Socket.IO server.
- In **production**, if unset, the allowed origin list is **empty** (fail closed). Set explicitly to your frontend origins.

## Origin allowlist (unsafe HTTP methods)

Browser-originated **state-changing** requests can be restricted by origin allowlist middleware on backends (see `origin-allowlist.middleware.ts` in identity util-auth). Configure per deployment expectations.

## Electron shell — new windows

**`native-agent-console`** may open new windows for `window.open` / `target=_blank` with **allow** semantics. See **AR-005** in **[Accepted risks](./accepted-risks.md)**.

## Related documentation

- **[Accepted risks](./accepted-risks.md)** — AR-001 through AR-005
- **[Environment configuration](../deployment/environment-configuration.md)**
- **[Production checklist](../deployment/production-checklist.md)**
- **[Backend Agent Controller application](../applications/backend-agent-controller.md)** — WebSocket and ports
- **[Vulnerability reporting and artifacts](./vulnerability-reporting-and-artifacts.md)** — Disclosure and response commitments

---

_For provisioning SSH, desktop integrity, and CSP operator summaries, see **[Accepted risks](./accepted-risks.md)** and **[Vulnerability reporting and artifacts](./vulnerability-reporting-and-artifacts.md)**._
