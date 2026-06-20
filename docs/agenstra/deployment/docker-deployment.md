# Docker Deployment

Containerized deployment guide for Agenstra using Docker and Docker Compose.

## Overview

Docker deployment provides:

- Isolated environments
- Easy scaling
- Consistent deployments
- Simplified dependency management

## Prerequisites

- Docker 20.10 or higher
- Docker Compose 2.0 or higher

## Docker Compose Setup

### Backend Agent Controller

```bash
cd apps/agenstra/backend-agent-controller
docker compose up -d
```

The `docker-compose.yaml` includes:

- PostgreSQL database container
- Agent controller API container
- Environment variable configuration
- Volume mounts for data persistence
- Optional `./provider-plugins` mount for [dynamic provider plugins](../features/dynamic-provider-plugins.md) (`DYNAMIC_PROVIDER_PLUGIN_PATH`)

### Backend Agent Manager

```bash
cd apps/agenstra/backend-agent-manager
docker compose up -d
```

The `docker-compose.yaml` includes:

- PostgreSQL database container
- Agent manager API container
- Docker socket mount (for agent containers)
- Environment variable configuration
- Optional `./provider-plugins` mount for [dynamic provider plugins](../features/dynamic-provider-plugins.md)

### Frontend Agent Console

```bash
cd apps/agenstra/frontend-agent-console
docker compose up -d
```

The `docker-compose.yaml` includes:

- Nginx server container
- Built frontend application
- Environment variable configuration

## Container Configuration

### Environment Variables

Configure containers via environment variables in `docker-compose.yaml`:

```yaml
services:
  api:
    environment:
      - DB_HOST=postgres
      - DB_PORT=5432
      - DB_USERNAME=postgres
      - DB_PASSWORD=postgres
      - DB_DATABASE=agent_controller
      - STATIC_API_KEY=your-api-key
      - CORS_ORIGIN=https://agenstra.com
      - RATE_LIMIT_ENABLED=true
```

### Volume Management

Persistent data storage:

```yaml
volumes:
  postgres_data:
    driver: local
```

### Network Configuration

Container networking:

```yaml
networks:
  default:
    driver: bridge
```

## Building Containers

### Build API Container

```bash
# Agent Controller
nx docker:api agenstra-backend-agent-controller

# Agent Manager
nx docker:api agenstra-backend-agent-manager
```

### Build Frontend Container

```bash
nx docker:server agenstra-frontend-agent-console
```

### Frontend Container Configuration

Frontend containers support runtime configuration via the `CONFIG` environment variable:

```yaml
services:
  frontend:
    environment:
      - CONFIG=https://config.example.com/agenstra-config.json
      # Production hardening (recommended):
      # - CONFIG_ALLOWED_HOSTS=config.example.com
      # - CONFIG_FETCH_TIMEOUT_MS=10000
      # - CONFIG_FETCH_MAX_BYTES=262144
      - PORT=4200
```

The `CONFIG` variable specifies a URL to a JSON configuration file that will be fetched at runtime and merged with build-time defaults. This allows you to configure frontend applications without rebuilding containers.

When `CONFIG` is set, the frontend server also supports the following optional hardening variables:

- `CONFIG_ALLOWED_HOSTS` - Comma-separated hostname allowlist for `CONFIG` (production: required when `CONFIG` is set; outside production, if unset/empty: allow all = legacy behavior; `*` allows all; not recommended)
- `CONFIG_ALLOW_INSECURE_HTTP` - Allow `http://` `CONFIG` URLs in production when `true` (default: `false`)
- `CONFIG_ALLOW_INTERNAL_HOST` - Allow `CONFIG` targets that use/resolve to private or loopback addresses when `true` (default: `false`, not recommended)
- `CONFIG_FETCH_TIMEOUT_MS` - Fetch timeout in milliseconds (default: `10000`)
- `CONFIG_FETCH_MAX_BYTES` - Max response size in bytes (default: `262144` = 256 KiB)
- `CONFIG_JSON_MAX_DEPTH` - Max JSON traversal depth for key counting (default: `12`)
- `CONFIG_JSON_MAX_KEYS` - Max total JSON keys (default: `512`)

Frontend Express servers (agent console, billing console, portal, docs) also support:

- `CSP_ENFORCE` - Set to `true` to enforce Content Security Policy (sends `Content-Security-Policy`), otherwise report-only (`Content-Security-Policy-Report-Only`).
- `CSP_DEFAULT_SRC_EXTRA` - Extra origins appended to `default-src` (same URL list rules as `CSP_CONNECT_SRC_EXTRA`).
- `CSP_BASE_URI_EXTRA` - Extra origins appended to `base-uri` (same URL list rules).
- **`connect-src`** - Allows `'self'`, `https:`, and `wss:`. Non-production adds `http:` and `ws:` scheme keywords. **Production** does not; use `CSP_CONNECT_SRC_EXTRA` for specific HTTP/WebSocket origins (for example `http://host.docker.internal:3100`).
- `CSP_CONNECT_SRC_EXTRA` - Comma- or space-separated URLs; each becomes an origin. Example: `CSP_CONNECT_SRC_EXTRA=http://host.docker.internal:3100`
- **`script-src`** - Default `'self' 'unsafe-inline' 'unsafe-eval'`. Use `CSP_SCRIPT_SRC_EXTRA` for third-party script hosts (for example `https://www.googletagmanager.com` for GTM). `CSP_CONNECT_SRC_EXTRA` does not affect `script-src`; `connect-src` already permits HTTPS connections via the `https:` keyword.
- `CSP_SCRIPT_SRC_EXTRA` - Extra origins appended to `script-src` (same URL list rules as `CSP_CONNECT_SRC_EXTRA`).
- `CSP_WORKER_SRC_EXTRA`, `CSP_STYLE_SRC_EXTRA`, `CSP_IMG_SRC_EXTRA`, `CSP_FONT_SRC_EXTRA` - Same pattern for `worker-src`, `style-src`, `img-src`, and `font-src` respectively.
- `CSP_FRAME_ANCESTORS` - Optional full override of CSP `frame-ancestors` (default `'none'`). See [Environment configuration](./environment-configuration.md).

Billing manager–generated agent-controller cloud-init sets `CONFIG_ALLOWED_HOSTS` to the instance FQDN and `CSP_ENFORCE` to `true` by default for the frontend container. See [Environment configuration](./environment-configuration.md).

## Running Containers

### Using Docker Compose (Recommended)

```bash
# Start all services
docker compose up -d

# View logs
docker compose logs -f

# Stop services
docker compose down

# Stop and remove volumes
docker compose down -v
```

### Using Docker Directly

```bash
# Run agent controller
docker run -d \
  --name agent-controller \
  -p 3100:3100 \
  -p 8081:8081 \
  -e DB_HOST=postgres \
  -e STATIC_API_KEY=your-api-key \
  backend-agent-controller:api

# Run agent manager (with Docker socket)
docker run -d \
  --name agent-manager \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -p 3000:3000 \
  -p 8080:8080 \
  -e DB_HOST=postgres \
  -e STATIC_API_KEY=your-api-key \
  backend-agent-manager:api

# Run frontend agent console
docker run -d \
  --name frontend-agent-console \
  -p 4200:4200 \
  -e CONFIG=https://config.example.com/agenstra-config.json \
  frontend-agent-console:server
```

## Docker Socket Mount

**Important**: The agent-manager (and agent-controller when it spawns workloads) requires Docker socket access to manage agent containers:

```yaml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock
```

This allows the container to communicate with the host Docker daemon. Restrict who can access the host daemon; mounting the socket grants significant privilege on the host.

### Container security (images)

First-party images follow a common hardening baseline:

- **Non-root**: API, worker, VNC, SSH, and OpenClaw (**agi**) images run as `agenstra` (UID/GID **10001** by default), not root. Frontend server images run as `node` (**1000**). Billing API uses the same `agenstra` pattern.
- **Secrets at runtime**: Do not rely on default `ENV` values in images for databases, Keycloak, or VNC/SSH passwords; set variables in Compose or your orchestrator.
- **Restricted `sudo`**: `agenstra` is not in the Debian `sudo` group. Only explicit binaries in `/etc/sudoers.d/agenstra` may run via passwordless `sudo` (workspace `chown`, SSH `sshd`/`chpasswd`, API socket GID sync). See **[Container image security](../security/container-images.md#restricted-sudo)**.
- **Agent volumes**: Per-agent data under host `/opt/agents/{uuid}`; shared read-only context at `/opt/agents` → `/opt/workspace`. Provision `/opt/agents` with ownership compatible with UID **10001** where possible.
- **Docker socket GID**: Manager/controller API images declare `ARG DOCKER_GID=995` and align the in-container `docker` group at startup with the mounted socket’s GID. If your host `docker` group differs, rebuild with `--build-arg DOCKER_GID=$(stat -c '%g' /var/run/docker.sock)` or ensure the default matches your host.
- **Coordinated upgrades**: Upgrade manager API, worker, VNC, SSH, and **agi** images together on the same release tag when user or mount paths change.

See **[Container image security](../security/container-images.md)** and **[Operational hardening — Container images](../security/operational-hardening.md#container-images-docker)**.

## Health Checks

Containers include health checks:

```yaml
healthcheck:
  test: ['CMD', 'curl', '-f', 'http://localhost:3100/health']
  interval: 30s
  timeout: 10s
  retries: 3
```

## Logging

View container logs:

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f api

# Last 100 lines
docker compose logs --tail=100 api
```

## Related Documentation

- **[Local Development](./local-development.md)** - Local setup
- **[Production Checklist](./production-checklist.md)** - Production deployment
- **[Environment Configuration](./environment-configuration.md)** - Environment variables

---

_For production deployment, see the [Production Checklist](./production-checklist.md)._
