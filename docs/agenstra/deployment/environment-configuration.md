# Environment Configuration

Complete reference for all environment variables used in Agenstra.

## Backend Agent Controller

### Application Configuration

- `PORT` - HTTP API port (default: `3100`)
- `WEBSOCKET_PORT` - WebSocket gateway port (default: `8081`)
- `NODE_ENV` - Environment mode (`development` or `production`)

### Database Configuration

- `DB_HOST` - Database host (default: `localhost`)
- `DB_PORT` - Database port (default: `5432`)
- `DB_USERNAME` - Database username (default: `postgres`)
- `DB_PASSWORD` - Database password (default: `postgres`)
- `DB_DATABASE` - Database name (default: `postgres`)

### Authentication

- `AUTHENTICATION_METHOD` - Explicit choice: `api-key`, `keycloak`, or `users`. If not set, inferred from `STATIC_API_KEY` (api-key if set, else keycloak).

**Option 1: API Key Authentication** (`AUTHENTICATION_METHOD=api-key`)

- `STATIC_API_KEY` - Static API key for authentication (required)

**Option 2: Keycloak Authentication** (`AUTHENTICATION_METHOD=keycloak`)

- `KEYCLOAK_SERVER_URL` - Keycloak server URL (optional, used for server URL if different from auth server URL)
- `KEYCLOAK_AUTH_SERVER_URL` - Keycloak authentication server URL (required)
- `KEYCLOAK_REALM` - Keycloak realm name (required)
- `KEYCLOAK_CLIENT_ID` - Keycloak client ID (required)
- `KEYCLOAK_CLIENT_SECRET` - Keycloak client secret (required)
- `KEYCLOAK_TOKEN_VALIDATION` - Token validation method: `ONLINE` or `OFFLINE` (optional, default: `ONLINE`)

**Option 3: Users Authentication** (`AUTHENTICATION_METHOD=users`)

- `JWT_SECRET` - Secret for signing JWT tokens (required)
- `DISABLE_SIGNUP` - When `true`, disables self-registration. The register endpoint returns 503 Service Unavailable. Use admin user creation for onboarding. (default: `false`)

**Note for Backend Agent Manager**: When using Keycloak authentication, the JWT token must include the `agent_management` role to access agent-manager endpoints.

### CORS Configuration

- `CORS_ORIGIN` - Allowed CORS origins (comma-separated list)
  - Production: **Required** - Set to allow specific origins (CORS disabled if not set)
  - Development: Optional - Defaults to `*` (all origins allowed)

### Rate Limiting

- `RATE_LIMIT_ENABLED` - Enable/disable rate limiting (default: `true` in production, `false` in development)
- `RATE_LIMIT_TTL` - Time window in seconds (default: `60`)
- `RATE_LIMIT_LIMIT` - Maximum requests per window (default: `100`)

### Client workspace endpoints (SSRF guardrails)

These variables apply to **stored client workspace URLs** (the agent-manager base URL the controller proxies to). They mirror the semantics of frontend **`CONFIG_*`** runtime-config settings where noted.

- `CLIENT_ENDPOINT_ALLOWED_HOSTS` - Comma-separated lowercase hostnames allowed in client endpoint URLs, or `*` for any host (default: unset in non-production; **required in production** — the process exits on startup if unset when `NODE_ENV=production`).
- `CLIENT_ENDPOINT_ALLOW_INSECURE_HTTP` - Set to `true` to allow `http:` client endpoints when `NODE_ENV=production` (default: HTTPS only in production).
- `CLIENT_ENDPOINT_ALLOW_INTERNAL_HOST` - Set to `true` to allow private/loopback hostnames and literal private IPs in client endpoints, and to **skip DNS rebinding checks** (mirrors `CONFIG_ALLOW_INTERNAL_HOST` for `/config`; neither side uses a dedicated skip-DNS env var). Use only in trusted lab or air-gapped deployments.
- `CLIENT_ENDPOINT_TLS_REJECT_UNAUTHORIZED` - Defaults to TLS certificate verification **on** for outbound HTTPS to client endpoints. Set to `false` **only in non-production** to allow self-signed certificates (disallowed when `NODE_ENV=production`).

### Server Provisioning

- `HETZNER_API_TOKEN` - Hetzner Cloud API token (for server provisioning)
- `DIGITALOCEAN_API_TOKEN` - DigitalOcean API token (for server provisioning)
- `ENCRYPTION_KEY` - Encryption key for sensitive data

### Atlassian import (external)

These variables tune the **Atlassian Cloud** import scheduler and provider on the agent controller. Site connection API tokens are stored encrypted; **`ENCRYPTION_KEY`** (above) must be set in environments that persist connections. See [Atlassian import](../features/atlassian-import.md) for behavior, admin-only HTTP routes, and OpenAPI paths.

- `CONTEXT_IMPORT_SCHEDULER_INTERVAL_MS` - Milliseconds between scheduler ticks that run enabled import configs (default: `120000`). Set to `0` or less to **disable** the periodic scheduler (manual `POST …/configs/{id}/run` still works unless imports are disabled below).
- `CONTEXT_IMPORT_SCHEDULER_CONFIG_BATCH` - Maximum number of enabled configs processed per scheduler tick (default: `3`).
- `CONTEXT_IMPORT_ITEM_BUDGET` - Soft cap on import items processed **per config per run** for scheduler and on-demand runs (default: `25`).
- `ATLASSIAN_IMPORT_DISABLED` - When set to `true`, the Atlassian import provider skips work for import runs (connections and configs remain manageable via the admin API).

## Backend Agent Manager

### Application Configuration

- `PORT` - HTTP API port (default: `3000`)
- `WEBSOCKET_PORT` - WebSocket gateway port (default: `8080`)
- `NODE_ENV` - Environment mode (`development` or `production`)

### Database Configuration

- `DB_HOST` - Database host (default: `localhost`)
- `DB_PORT` - Database port (default: `5432`)
- `DB_USERNAME` - Database username (default: `postgres`)
- `DB_PASSWORD` - Database password (default: `postgres`)
- `DB_DATABASE` - Database name (default: `postgres`)

### Authentication

**Option 1: API Key Authentication**

- `STATIC_API_KEY` - Static API key for authentication

**Option 2: Keycloak Authentication**

- `KEYCLOAK_SERVER_URL` - Keycloak server URL (optional, used for server URL if different from auth server URL)
- `KEYCLOAK_AUTH_SERVER_URL` - Keycloak authentication server URL (required)
- `KEYCLOAK_REALM` - Keycloak realm name (required)
- `KEYCLOAK_CLIENT_ID` - Keycloak client ID (required)
- `KEYCLOAK_CLIENT_SECRET` - Keycloak client secret (required)
- `KEYCLOAK_TOKEN_VALIDATION` - Token validation method: `ONLINE` or `OFFLINE` (optional, default: `ONLINE`)

**Note for Backend Agent Manager**: When using Keycloak authentication, the JWT token must include the `agent_management` role to access agent-manager endpoints.

### CORS Configuration

- `CORS_ORIGIN` - Allowed CORS origins (comma-separated list)
  - Production: **Required** - Set to allow specific origins (CORS disabled if not set)
  - Development: Optional - Defaults to `*` (all origins allowed)

### Rate Limiting

- `RATE_LIMIT_ENABLED` - Enable/disable rate limiting (default: `true` in production, `false` in development)
- `RATE_LIMIT_TTL` - Time window in seconds (default: `60`)
- `RATE_LIMIT_LIMIT` - Maximum requests per window (default: `100`)

### Container stats broadcasting (WebSocket)

- `CONTAINER_STATS_SCHEDULER_INTERVAL` - Milliseconds between periodic `containerStats` broadcasts per authenticated agent on the `/agents` gateway (default: `15000`). The first snapshot is sent immediately after successful `login`; subsequent updates use this interval while at least one client remains authenticated for that agent.

### Git Repository Configuration

**For HTTPS Repositories:**

- `GIT_REPOSITORY_URL` - Git repository URL (HTTPS)
- `GIT_USERNAME` - Git username
- `GIT_TOKEN` - Git personal access token (preferred)
- `GIT_PASSWORD` - Git password (alternative to token)

**For SSH Repositories:**

- `GIT_REPOSITORY_URL` - Git repository URL (SSH)
- `GIT_PRIVATE_KEY` - SSH private key (PEM or OpenSSH format, no passphrase)

### Cursor Agent Configuration

- `CURSOR_API_KEY` - Cursor API key for agent communication
- `CURSOR_AGENT_DOCKER_IMAGE` - Primary worker image (default: `ghcr.io/forepath/agenstra-manager-worker:latest`)
- `CURSOR_AGENT_VIRTUAL_WORKSPACE_DOCKER_IMAGE` - VNC image (default: `ghcr.io/forepath/agenstra-manager-vnc:latest`)
- `CURSOR_AGENT_SSH_CONNECTION_DOCKER_IMAGE` - SSH sidecar image (default: `ghcr.io/forepath/agenstra-manager-ssh:latest`)

### OpenCode Agent Configuration

- `OPENCODE_AGENT_DOCKER_IMAGE` - Primary worker image (default: `ghcr.io/forepath/agenstra-manager-worker:latest`)
- `OPENCODE_AGENT_VIRTUAL_WORKSPACE_DOCKER_IMAGE` - VNC image (default: `ghcr.io/forepath/agenstra-manager-vnc:latest`)
- `OPENCODE_AGENT_SSH_CONNECTION_DOCKER_IMAGE` - SSH sidecar image (default: `ghcr.io/forepath/agenstra-manager-ssh:latest`)

### OpenClaw Agent Configuration

- `OPENCLAW_AGENT_DOCKER_IMAGE` - Primary gateway image (default: `ghcr.io/forepath/agenstra-manager-agi:latest`)
- `OPENCLAW_AGENT_VIRTUAL_WORKSPACE_DOCKER_IMAGE` - VNC image (default: `ghcr.io/forepath/agenstra-manager-vnc:latest`)
- `OPENCLAW_AGENT_SSH_CONNECTION_DOCKER_IMAGE` - SSH sidecar image (default: `ghcr.io/forepath/agenstra-manager-ssh:latest`)

Sidecar containers require runtime passwords where applicable: **`VNC_PASSWORD`** and **`SSH_PASSWORD`** (set by the manager when creating agents; not image defaults). See **[Container image security](../security/container-images.md)**.

### API image build arguments (manager / controller)

When building `Dockerfile.api` images that mount `/var/run/docker.sock`:

- `APP_UID` / `APP_GID` - Runtime user `agenstra` (default **10001**)
- `DOCKER_GID` - GID of the in-container `docker` group; should match `stat -c '%g' /var/run/docker.sock` on the host (default **995**)

### Git Author Configuration

- `GIT_AUTHOR_NAME` - Git commit author name (default: `Agenstra`)
- `GIT_AUTHOR_EMAIL` - Git commit author email (default: `noreply@agenstra.com`)

## Frontend applications (Express SSR)

The Angular apps **frontend-agent-console**, **frontend-billing-console**, **frontend-portal**, and **frontend-docs** use the same Express layer for `GET /config` (runtime JSON proxy) and security headers. The variables below are written with the agent console in mind; they apply to all four apps unless an app-specific doc says otherwise.

### Billing manager (provisioned agent controller)

When the billing manager generates cloud-init for a product that includes the agent-controller frontend container, it sets **`CONFIG_ALLOWED_HOSTS`** to the instance **FQDN** (so production `CONFIG` fetches stay allowlisted) and **`CSP_ENFORCE`** to **`true`** by default. Override the CSP default only if your provisioning pipeline sets `frontend.cspEnforce` in the cloud-init config.

It also sets client workspace SSRF env vars on **`backend-agent-controller`**: **`CLIENT_ENDPOINT_TLS_REJECT_UNAUTHORIZED`** (default **`true`**), **`CLIENT_ENDPOINT_ALLOW_INSECURE_HTTP`** (default **`false`**), and **`CLIENT_ENDPOINT_ALLOWED_HOSTS`** (default **`*`** so tenants may register arbitrary agent-manager hostnames while other SSRF layers still apply). DNS rebinding checks follow runtime rules (on by default); use **`CLIENT_ENDPOINT_ALLOW_INTERNAL_HOST`** in non-provisioned setups when you need the same bypass as **`CONFIG_ALLOW_INTERNAL_HOST`** (billing does not set it by default). Optional **`clientEndpointAllowedHosts`** / **`security.clientEndpointAllowedHosts`** in **`requestedConfig`** **merge** the instance FQDN with listed hosts (FQDN first); a single **`*`** entry keeps allow-all. Optional **`security.clientEndpointAllowInsecureHttp`** and **`security.clientEndpointTlsRejectUnauthorized`** map to the same `CLIENT_ENDPOINT_*` variables.

### Runtime Configuration

- `CONFIG` - URL to a remote JSON configuration file that will be loaded at runtime and merged with build-time defaults (optional)
  - If set, the application will fetch this configuration during initialization via `/config` endpoint
  - The remote configuration takes precedence over build-time defaults
  - If not set or fetch fails, the application falls back to build-time defaults
  - Example: `CONFIG=https://config.example.com/agenstra-config.json`
  - For users auth, include `authentication: { type: "users", disableSignup: true }` to hide the signup link and disable registration when backend has DISABLE_SIGNUP=true

#### Runtime config proxy hardening (`/config`)

When `CONFIG` is set, the frontend server fetches and validates the remote JSON with additional controls (SSRF/DNS rebinding defense, size limits, caching policy). Hostname allowlist parsing and private/loopback detection (including **IPv6** and **IPv4-mapped IPv6** addresses) are implemented in **`@forepath/shared/shared/util-network-address`**, shared with backend **client workspace endpoint** validation (`CLIENT_ENDPOINT_*`).

- `CONFIG_ALLOWED_HOSTS` - Comma-separated hostname allowlist for `CONFIG`
  - Production: **Required** when `CONFIG` is set
  - If unset/empty outside production, **all hosts are allowed** (legacy behavior; not recommended)
  - Set to `*` to allow any host (not recommended)
  - Example: `CONFIG_ALLOWED_HOSTS=config.example.com,config2.example.com`
- `CONFIG_ALLOW_INSECURE_HTTP` - When `true`, allows `http://` `CONFIG` URLs in production (default: `false`)
- `CONFIG_ALLOW_INTERNAL_HOST` - When `true`, allows `CONFIG` targets that use/resolve to private or loopback addresses (default: `false`, not recommended)
- `CONFIG_FETCH_TIMEOUT_MS` - Fetch timeout in milliseconds (default: `10000`, min: `1000`, max: `120000`)
- `CONFIG_FETCH_MAX_BYTES` - Maximum response size in bytes (default: `262144` = 256 KiB, min: `1024`, max: `2097152` = 2 MiB)
- `CONFIG_JSON_MAX_DEPTH` - Maximum JSON traversal depth for key counting (default: `12`, min: `1`, max: `32`)
- `CONFIG_JSON_MAX_KEYS` - Maximum total JSON keys across all objects/arrays up to `CONFIG_JSON_MAX_DEPTH` (default: `512`, min: `1`, max: `10000`)

### Content Security Policy (Express)

- `CSP_ENFORCE` - When `true`, sends enforcing `Content-Security-Policy`. Otherwise sends `Content-Security-Policy-Report-Only` (default).
- `CSP_DEFAULT_SRC_EXTRA` - Extra origins appended to `default-src` after `'self'` (same URL list rules as `CSP_CONNECT_SRC_EXTRA`). Use when a resource type has no more specific directive and must load from another origin.
- `CSP_BASE_URI_EXTRA` - Extra origins appended to `base-uri` after `'self'` (same URL list rules). Restricts which URLs may appear in a document’s `<base href>`.
- **`connect-src` behavior** - The policy always allows `'self'`, `https:`, and `wss:`. Outside production it also allows the `http:` and `ws:` **scheme keywords** (any host on those schemes). In **production**, unencrypted `http` / `ws` endpoints are **not** allowed unless you add their **origins** via `CSP_CONNECT_SRC_EXTRA`.
- `CSP_CONNECT_SRC_EXTRA` - Extra `connect-src` entries: comma- or space-separated full URLs; each is normalized to an **origin** (`http`, `https`, `ws`, and `wss` accepted). **Required in production** for APIs on plain HTTP (for example `http://host.docker.internal:3100`). Example: `CSP_CONNECT_SRC_EXTRA=http://host.docker.internal:3100`
- **`script-src` behavior** - Default is `'self' 'unsafe-inline' 'unsafe-eval'` (Monaco and similar tooling). Third-party scripts are **not** allowed unless you add origins with `CSP_SCRIPT_SRC_EXTRA`. **Note:** `connect-src` already includes the `https:` scheme keyword, so HTTPS `fetch` / XHR to analytics hosts does not require `CSP_CONNECT_SRC_EXTRA`; loading tag-manager **JavaScript** (for example `gtm.js`) does require `CSP_SCRIPT_SRC_EXTRA` when CSP is enforced.
- `CSP_SCRIPT_SRC_EXTRA` - Same URL list format as `CSP_CONNECT_SRC_EXTRA`; each URL is normalized to an origin and appended to `script-src`. Example (Google Tag Manager): `CSP_SCRIPT_SRC_EXTRA=https://www.googletagmanager.com`
- **`worker-src` / `style-src` / `img-src` / `font-src`** - Defaults are `worker-src 'self' blob:`, `style-src 'self' 'unsafe-inline'`, `img-src 'self' data:`, `font-src 'self' data:`. Append third-party origins with the matching `CSP_*_SRC_EXTRA` variable (same URL list rules as above).
- `CSP_WORKER_SRC_EXTRA`, `CSP_STYLE_SRC_EXTRA`, `CSP_IMG_SRC_EXTRA`, `CSP_FONT_SRC_EXTRA` - Extra origins for those directives. Example (Google Fonts CSS + files): `CSP_STYLE_SRC_EXTRA=https://fonts.googleapis.com` and `CSP_FONT_SRC_EXTRA=https://fonts.gstatic.com`
- **`frame-ancestors`** - Default is `'none'` (not set). **`CSP_FRAME_ANCESTORS` overrides the entire source list** (space-separated CSP sources, for example `'self'` or `https://parent.example`); it is **not** merged with `'none'`. Values containing `;` or newlines are rejected and treated as `'none'`. When the resolved list is exactly `'self'`, the middleware sends `X-Frame-Options: SAMEORIGIN`; when it is `'none'`, it sends `X-Frame-Options: DENY`; for other lists it omits `X-Frame-Options` so `frame-ancestors` alone controls embedding.

### API Configuration

- `API_URL` - Backend API endpoint (default: `http://localhost:3100`)
- `WEBSOCKET_URL` - WebSocket endpoint (default: `http://localhost:8081`)

### Keycloak Configuration

- `KEYCLOAK_AUTH_SERVER_URL` - Keycloak server URL
- `KEYCLOAK_REALM` - Keycloak realm
- `KEYCLOAK_CLIENT_ID` - Keycloak client ID

## Redis and BullMQ (background jobs)

Used by **backend agent controller** and **backend billing manager**. See [Background jobs](./background-jobs.md).

| Variable                    | Description                            | Default                                    |
| --------------------------- | -------------------------------------- | ------------------------------------------ |
| `REDIS_HOST`                | Redis host                             | `localhost` (compose: `redis`)             |
| `REDIS_PORT`                | Redis port                             | `6379`                                     |
| `REDIS_PASSWORD`            | Optional password                      | empty                                      |
| `REDIS_DB`                  | Redis DB index                         | `0`                                        |
| `REDIS_KEY_PREFIX`          | Key prefix                             | `agenstra-controller` / `agenstra-billing` |
| `QUEUE_ROLE`                | `api`, `scheduler`, `worker`, or `all` | `all` locally; `api` for API container     |
| `QUEUE_WORKER_CONCURRENCY`  | Worker concurrency                     | `5`                                        |
| `QUEUE_BULL_BOARD_ENABLED`  | Enable Bull Board                      | `true` in dev for `all`/`scheduler`        |
| `QUEUE_BULL_BOARD_PATH`     | Bull Board path                        | `/admin/queues`                            |
| `QUEUE_BULL_BOARD_USERNAME` | Bull Board HTTP Basic user             | `admin`                                    |
| `QUEUE_BULL_BOARD_PASSWORD` | Bull Board HTTP Basic password         | required; `bullmq` in local compose        |

Scheduler interval variables (e.g. `BILLING_SCHEDULER_INTERVAL`, `AUTONOMOUS_TICKET_SCHEDULER_INTERVAL_MS`) configure **coordinator** repeat intervals in BullMQ.

## Environment-Specific Defaults

### Development

- `NODE_ENV=development`
- `CORS_ORIGIN=*` (all origins allowed)
- `RATE_LIMIT_ENABLED=false` (effectively unlimited)
- `RATE_LIMIT_LIMIT=10000`

### Production

- `NODE_ENV=production`
- `CORS_ORIGIN` - **Required** (must be set, otherwise CORS disabled)
- `RATE_LIMIT_ENABLED=true` (default)
- `RATE_LIMIT_LIMIT=100` (default)

## Related Documentation

- **[Local Development](./local-development.md)** - Local setup
- **[Docker Deployment](./docker-deployment.md)** - Containerized deployment
- **[Production Checklist](./production-checklist.md)** - Production deployment
- **[Background jobs](./background-jobs.md)** - BullMQ roles, Redis, and coordinators
- **[Atlassian import](../features/atlassian-import.md)** - Import feature, markers, and console entry points

---

_For application-specific environment variables, see the [application documentation](../applications/README.md)._
