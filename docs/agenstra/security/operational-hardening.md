# Operational hardening

This page describes **implemented** security controls that operators and security reviewers should know about. For **environment variable names and defaults**, see **[Environment configuration](../deployment/environment-configuration.md)**.

## Container images (Docker)

First-party images are hardened for production use. Full detail (bind mounts, entrypoints, privilege drop): **[Container image security](./container-images.md)**.

| Practice                      | Detail                                                                                                                                                                                                                                                                        |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Non-root runtime**          | Debian-based backends and worker images run as **`agenstra`** (UID/GID **10001** by default); Alpine frontend servers run as **`node`** (**1000**). Entrypoints may start as root only for bootstrap, then drop via **`runuser`**.                                            |
| **No baked-in secrets**       | Database, Keycloak, and API keys are **not** defaulted in image `ENV`; operators supply them at deploy time.                                                                                                                                                                  |
| **No sudoers**                | Images do **not** install `sudo` or `/etc/sudoers.d` allowlists. Privileged bootstrap (workspace `chown`, Docker socket GID sync) runs in the root entrypoint; Nest uses Docker **`exec` as UID 0** for in-worker ownership fixes after start.                                |
| **Workspace mount ownership** | Worker entrypoints `chown` bind-mounted agent data to `APP_UID`/`APP_GID` when the host directory is root-owned, then drop to `agenstra`.                                                                                                                                     |
| **Least privilege on socket** | Manager and controller API images mount the host Docker socket only when required. The entrypoint (as root) syncs the in-container `docker` group GID to the socket’s GID (`DOCKER_GID` build arg, default **995**), then starts Node as **`agenstra`** with **`sg docker`**. |
| **Worker credential paths**   | When cloning private Git repos, the manager writes `.netrc` and SSH keys under the worker’s **`$HOME`** (`/home/agenstra`), not `/root`.                                                                                                                                      |
| **Image scanning**            | Repository `trivy.yaml` configures filesystem/config/image scans; CI fails on CRITICAL findings (HIGH+ visible in SARIF).                                                                                                                                                     |

Deploy **manager API and worker images from the same release** when paths or users change. See **[Docker deployment](../deployment/docker-deployment.md)** and **[Backend Agent Manager](../applications/backend-agent-manager.md)**.

## Authentication mode (backends)

Resolution is implemented in **`getAuthenticationMethod`** (`libs/domains/identity/backend/util-auth/src/lib/hybrid-auth.guard.ts`):

- If **`AUTHENTICATION_METHOD`** is set to **`api-key`**, **`keycloak`**, or **`users`**, that value is used.
- If **`AUTHENTICATION_METHOD`** is **unset** or invalid:
  - If **`STATIC_API_KEY`** is set → effective mode **`api-key`** (backward compatibility).
  - Otherwise → effective mode **`keycloak`**.

**`api-key`** without **`STATIC_API_KEY`** fails at runtime with an error. **Keycloak** and **users** modes rely on their respective guards after **`HybridAuthGuard`**. Health endpoints **`/api/health`** and **`/health`** remain unauthenticated by design.

**Operator note:** Set **`AUTHENTICATION_METHOD`** explicitly if your security policy requires unambiguous configuration. Implicit **keycloak** when neither an explicit mode nor **`STATIC_API_KEY`** is set is an **accepted risk**. See **AR-003** in **[Accepted risks](./accepted-risks.md)**.

## Agent Controller (remote client endpoints, SSRF)

Customer-configured **`client.endpoint`** values drive HTTP and WebSocket traffic from the controller to remote agent-managers.

| Control                                       | Purpose                                                                                                                                                           |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`CLIENT_ENDPOINT_ALLOWED_HOSTS`**           | Comma-separated hostname allowlist. The literal **`*`** explicitly allows **any host**. **Required in production**. The controller **exits** on startup if unset. |
| **`CLIENT_ENDPOINT_ALLOW_INSECURE_HTTP`**     | Set to `true` only if `http:` endpoints must be allowed (discouraged).                                                                                            |
| **`CLIENT_ENDPOINT_TLS_REJECT_UNAUTHORIZED`** | Defaults to TLS verification on. **`false` is forbidden in production.**                                                                                          |
| **`CLIENT_ENDPOINT_SKIP_DNS_CHECK`**          | Skips DNS resolution defense (private/loopback rebinding). Use only in controlled test scenarios.                                                                 |

Using **`*`** for **`CLIENT_ENDPOINT_ALLOWED_HOSTS`** intentionally **widens** the reachable host set. Prefer **narrow** hostnames when feasible; combine with egress controls and monitoring.

DNS validation resolves the endpoint hostname and rejects addresses in private/loopback space (unless skipped as above). Literal private IPs are rejected by URL validation.

Code: `libs/domains/agenstra/backend/feature-agent-controller/src/lib/utils/client-endpoint-security.ts`.

## HTTP proxy to remote agent-manager (headers)

Outbound proxied HTTP requests **drop** caller-supplied credential-like headers (`Authorization`, cookies, `x-api-key`, and similar) and attach only the **service-computed** `Authorization` for the **client entity** (stored API key or token). This avoids forwarding the **portal user’s** JWT on HTTP proxy paths.

Code: `libs/domains/agenstra/backend/feature-agent-controller/src/lib/utils/client-proxy-request-headers.ts` (used by `ClientAgentProxyService` and related `client-*-proxy` services).

WebSocket connections to **`/socket/agents`** use **`getAuthHeader(clientId)`** from the same client credentials, not the browser handshake token alone.

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
- Response **`Cache-Control`**: for example `public, max-age=60, stale-while-revalidate=300` in production on success (deployment-scoped, not per-user); `no-store` on proxy errors. Paths without a cacheable file extension (such as `/config`) may still need a CDN Cache Rule to become edge-eligible.
- Console SPA shells also **inline** warm CONFIG into `index.html` (`#runtime-config`) so bootstrap does not wait on `GET /config`. HTML ETag revalidation busts stale injects; purge HTML and/or `/config` after CONFIG changes if the CDN retains a stale shell.
- Landing and docs Express paths (prerender memory-static, delegating front, and CommonEngine SSR) use the same inline inject so all CONFIG consumers share the bootstrap path.

**`CONFIG_ALLOWED_HOSTS`** supports **`*`** to explicitly allow **any host**. That choice increases risk if **`CONFIG`** points to an attacker-controlled origin; prefer explicit host allowlists in production.

See **[Environment configuration (Frontend, all `frontend-*` apps)](../deployment/environment-configuration.md)** for variable names.

## Content Security Policy (frontend Express)

- CSP includes **`'unsafe-inline'`** and **`'unsafe-eval'`** for Monaco and tooling; default delivery is **`Content-Security-Policy-Report-Only`**.
- Set **`CSP_ENFORCE=true`** only after verifying the application still works.

Accepted risk: **AR-002** in **[Accepted risks](./accepted-risks.md)**.

## WebSocket CORS (Agent Controller / Agent Manager)

- Socket.IO CORS origin resolves as **`WEBSOCKET_CORS_ORIGIN` → `CORS_ORIGIN` → `*`** (empty/whitespace counts as unset).
- Prefer setting **`WEBSOCKET_CORS_ORIGIN`** (or at least **`CORS_ORIGIN`**) to your frontend origins in production instead of relying on `*`.

## Agent virtual desktop (VNC)

- Worker image runs TigerVNC (loopback only) + authenticated websockify edge on container port **6080** (not published on the host when `AGENT_DOCKER_NETWORK` is set; same policy as OpenCode :4096). The edge requires HTTP Basic auth using the worker OpenCode credentials (manager-only). Entrypoint **fails closed** if TigerVNC does not bind within timeout.
- Browser never talks to the worker. Flow: authenticated REST mint (`agents:vnc` + `ensureClientAccess`) → short-lived ticket → raw WebSocket on controller HTTP **`PORT`** path **`/socket/vnc`** (default **3100**) → manager HTTP **`PORT`** path **`/socket/vnc`** (default **3000**) → authenticated worker edge.
- Tickets are single-use and bound to client/agent/caller. They travel in **`Sec-WebSocket-Protocol`** (`agenstra.vnc.<ticket>`), not URL query strings. Manager/worker URLs are not returned to the browser.
- Controller `/socket/vnc` upgrades use the same **`WEBSOCKET_CORS_ORIGIN` → `CORS_ORIGIN`** allowlist as Socket.IO, but **without** defaulting to `*` — in production, when both are unset, browser `Origin`s are rejected (fail closed). Manager `/socket/vnc` applies the same check.
- Controller tickets are stored in **Valkey** (with in-process fallback) so REST mint and WebSocket consume work across controller replicas. Manager tickets are **process-local** — run a **single agent-manager replica** (or sticky sessions) per client endpoint.
- The agent console connects using `controller.vncWebsocketUrl`, or derives `ws(s)://…/socket/vnc` from `controller.websocketUrl` (same host/port as Socket.IO).
- Desktop session starts as non-privileged user **`agenstra`** (no greeter). Worker image is larger due to XFCE + Chromium.

## Agent egress (web traffic) guard

- Each agent environment can be placed behind a per-agent **egress guard** sidecar that owns the agent's network namespace (`NetworkMode: container:<guard>`). Only the guard holds `CAP_NET_ADMIN` and `CAP_NET_RAW` (the latter for ipset lookups of the Git-over-SSH allowance; agents in a guard namespace additionally lose `NET_ADMIN` / `NET_RAW`). Git over SSH is only accepted to addresses the guard itself resolved for curated Git hosts. Netfilter exempts only Squid's **marked** upstream connections (a mark cannot be set without `CAP_NET_ADMIN`) and dnsmasq's DNS queries to the configured resolvers — never a bare UID.
- Fail closed: lockdown rules are installed before any policy, invalid policy bundles never replace the last known good one, QUIC, DNS over TLS and undeclared protocols are denied, enforcing policies are not silently skipped when `AGENT_EGRESS_GUARD_ENABLED=false`, and agents whose required guard cannot be provisioned are stopped instead of running unfiltered.
- Lower configuration layers can narrow but never widen an inherited allowlist; URL patterns and message filters reject regexes at risk of catastrophic backtracking.
- HTTPS is filtered by SNI without decryption. `host_verify_strict` prevents connecting to an IP other than what DNS resolves for the name, but **domain fronting on shared CDNs is not prevented**. Details and limitations: [Egress Filtering](../features/egress-filtering.md).

## Container isolation levels (gVisor)

- Environments run either on Docker's default **`runc`** (standard, shares the host kernel) or, on prepared hosts, on **gVisor** (`runsc-systrap`, sandboxed), where system calls are served by gVisor's userspace application kernel (Sentry) and networking by its own stack instead of the host kernel. Hosts with `/dev/kvm` can also offer **gVisor on KVM** (`runsc-kvm`, sandboxed-kvm), where the Sentry runs in a hardware-virtualized address space and system calls trap into it via VM exits instead of seccomp. gVisor reduces the host kernel attack surface but is **not** a full VM boundary, also on KVM. Hosts with `/dev/kvm` can also offer **microVMs** (microvm): the workload runs with its own guest kernel in a KVM virtual machine; QEMU runs unprivileged inside a hardened `runc` launcher container (only `/dev/kvm`, a reduced capability set without `NET_ADMIN` / `NET_RAW` / `SYS_ADMIN`, `no-new-privileges`, default seccomp / AppArmor; virtiofsd confined to `/guest` by its chroot sandbox), the guest never sees the launcher's files (the worker filesystem lives below `/guest`), and the launcher refuses to start when any volume or bind is mounted outside `/guest`.
- Levels are offered only after **real runtime probes** pass on the host (worker image, filesystem, exec, logs, shared egress namespace); a `daemon.json` entry or binary alone is never trusted. The probe re-runs periodically and after repeated runtime failures of a gVisor or microVM level. The microvm probe boots a real microVM and checks the worker contract and the guard topology inside the guest; the microVM image must carry this manager's bridge protocol label. For sandboxed-kvm the registered runtime arguments are also checked (`E_RUNTIME_MISCONFIGURED`), so a runtime named `runsc-kvm` but registered with another platform is not trusted.
- **No silent downgrade**: an explicitly requested level is never replaced, stale capability revisions are rejected (`409`), a gVisor container that fails to start is never retried on a weaker level, and every recreate pins the persisted runtime. Choosing a weaker level than recommended requires confirmation, is recorded with the selecting user and publishes `agent.isolation_override`.
- The selection record is derived server-side (controller and manager); clients cannot forge the selection source. `AGENT_SANDBOX_RUNTIME` and `AGENT_SANDBOX_KVM_RUNTIME` are restricted to a conservative charset so they cannot inject Docker options.
- Host preparation installs a **pinned, checksum-verified** gVisor release, keeps `runc` as Docker's default runtime and rolls back on failure (a KVM failure only rolls back the KVM runtimes). No libvirt / QEMU or other hypervisor stack is installed on the host; the KVM platform only needs `/dev/kvm`, and the microvm level ships libvirt / QEMU inside its container image. The egress guard sidecar stays on `runc`. Details and limitations: [Container Isolation Levels](../features/container-isolation.md).

## Origin allowlist (unsafe HTTP methods)

Browser-originated **state-changing** requests can be restricted by origin allowlist middleware on backends (see `origin-allowlist.middleware.ts` in identity util-auth). Configure per deployment expectations.

## Electron shell (new windows)

**`native-agent-console`** may open new windows for `window.open` / `target=_blank` with **allow** semantics. See **AR-004** in **[Accepted risks](./accepted-risks.md)**.

## Related documentation

- **[Accepted risks](./accepted-risks.md)** AR-001 through AR-005
- **[Environment configuration](../deployment/environment-configuration.md)** Security-related environment variables
- **[Production checklist](../deployment/production-checklist.md)** Pre-flight production checks
- **[Backend Agent Controller application](../applications/backend-agent-controller.md)** WebSocket and ports
- **[Vulnerability reporting and artifacts](./vulnerability-reporting-and-artifacts.md)** Disclosure and response commitments

---

_For provisioning SSH, desktop integrity, and CSP operator summaries, see **[Accepted risks](./accepted-risks.md)** and **[Vulnerability reporting and artifacts](./vulnerability-reporting-and-artifacts.md)**._
