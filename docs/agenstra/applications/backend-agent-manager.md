# Backend Agent Manager

NestJS backend application for managing and interacting with AI agents through HTTP REST API and WebSocket gateway.

## Purpose

This application provides a complete agent management system by importing **`AgentsModule`** from `@forepath/agenstra/backend` and **`MonitoringModule`** from `@forepath/shared/backend`, which bundle the agent-manager HTTP API, WebSocket gateway, Docker integration, and health endpoints.

## Features

This application provides:

- **HTTP REST API** Full CRUD operations for agent management
- **WebSocket Gateway** Real-time bidirectional communication with agents
- **Container Integration** Docker container management for agent execution. Containers of an environment are named `agenstra-<role>-<agentId>`: `agenstra-worker-<agentId>` (worker) and `agenstra-egress-<agentId>` (egress guard), both labelled `io.agenstra.agent-id=<agentId>` (workers also `io.agenstra.worker=1`). The agent id is assigned before any container is created, recreated containers keep the name, and containers of existing environments are renamed to the pattern on startup
- **Container isolation levels** Per-environment Docker runtime (`runc`, gVisor `runsc-systrap` or gVisor on KVM `runsc-kvm`), offered only after runtime probes pass; see [Container Isolation Levels](../features/container-isolation.md)
- **Egress guard** Per-agent sidecar that filters outbound web traffic (Squid/dnsmasq/iptables) and reports decision events; see [Egress Filtering](../features/egress-filtering.md)
- **Secure Authentication** Keycloak integration for HTTP endpoints and database-backed authentication for WebSocket
- **Database Support** PostgreSQL with TypeORM for data persistence
- **Auto Migrations** Automatic database schema migrations on startup
- **Rate Limiting** Configurable rate limiting on all API endpoints
- **CORS Configuration** Production-safe CORS defaults
- **Plugin-based Agent Providers** Support for agent implementations (OpenCode over its HTTP server API; additional types via plugins)

## Architecture

This application is built using:

- **NestJS** Progressive Node.js framework
- **TypeORM** Object-Relational Mapping for database operations
- **Keycloak** Identity and access management (optional, can use API key)
- **Socket.IO** WebSocket communication
- **Docker** Container management for agent execution
- **PostgreSQL** Database for agent storage

The Nest `AppModule` wires TypeORM, hybrid HTTP auth (Keycloak connect plus optional static API key), throttling, and the framework **`AgentsModule`** implementation.

## API Endpoints

All HTTP endpoints are prefixed with `/api` and protected by Keycloak authentication (or API key authentication if `STATIC_API_KEY` is set).

### Agent Management

- `GET /api/agents` - List all agents (supports `limit` and `offset` query parameters)
- `GET /api/agents/progress` - Running environment create / update operations (step, percentage)
- `GET /api/agents/:id` - Get a single agent by UUID
- `POST /api/agents` - Create a new agent (returns auto-generated password; optional `isolationLevel` (`standard`, `sandboxed`, `sandboxed-kvm`), `capabilityRevision`, `isolationSelection`; `400` with `code: E_ISOLATION_RUNTIME_FAILED` when a gVisor container cannot be started, `409` stale or unavailable isolation level, `503` host cannot run environments)
- `POST /api/agents/:id` - Update an existing agent
- `DELETE /api/agents/:id` - Delete an agent
- `GET /api/agents/:id/models` - List models available for the agent (provider-specific)

### Agent lifecycle

- `POST /api/agents/:id/start` - Start the agent container
- `POST /api/agents/:id/stop` - Stop the agent container
- `POST /api/agents/:id/restart` - Restart the agent container

### Environment variables

Changes are persisted and synchronized to the agent’s Docker container. Containers using the mounted environment volume are restarted in place (never deleted) so new variables take effect; legacy containers are recreated once and migrated. See [Agent Management – Environment variables](../features/agent-management.md#environment-variables).

- `GET /api/agents/:agentId/environment` - List variables (`limit`, `offset`)
- `GET /api/agents/:agentId/environment/count` - Count variables
- `POST /api/agents/:agentId/environment` - Create variable (`201 Created`)
- `PUT /api/agents/:agentId/environment/:id` - Update variable
- `DELETE /api/agents/:agentId/environment/:id` - Delete one variable
- `DELETE /api/agents/:agentId/environment` - Delete all variables

### Egress guard (web traffic filtering)

Message filters and the egress policy arrive with the effective agent configuration pushed by the controller (the former `/api/agents-filters` routes were removed). See [Message Filters](../features/message-filters.md) and [Egress Filtering](../features/egress-filtering.md).

- `GET /api/agents/:id/egress` - Guard status, policy in force, message filters and recent decision events
- `GET /api/egress/events` - Aggregated decision events (`afterSeq`, `limit`, `agentId`) consumed by the controller's `egress-events-ingest` job

Environment variables: `AGENT_EGRESS_GUARD_ENABLED`, `AGENT_EGRESS_GUARD_IMAGE`, `AGENT_EGRESS_GUARD_MEMORY_MB`, `AGENT_EGRESS_EVENTS_COLLECTOR_ENABLED`, `AGENT_EGRESS_EVENTS_POLL_INTERVAL_MS`, `AGENT_EGRESS_EVENTS_RETENTION_HOURS`.

### Container isolation

Isolation capabilities are probed on startup, periodically, on demand and after repeated runtime failures of a gVisor level (counted per level). Agent responses include `isolation` (`level`, `runtime`, `selection`). See [Container Isolation Levels](../features/container-isolation.md).

- `GET /api/isolation` - Current capability record (`levels.standard` / `levels.sandboxed` / `levels.sandboxed-kvm` state and reason code, `recommendedLevel`, `availableLevels`, `revision`, `probedAt`, `probing`)
- `POST /api/isolation/probe` - Re-probe every level now (joins a running probe; results younger than 30 s are reused)

Environment variables: `AGENT_SANDBOX_RUNTIME`, `AGENT_SANDBOX_SHARED_NETNS_RUNTIME`, `AGENT_ISOLATION_SANDBOX_ENABLED`, `AGENT_SANDBOX_KVM_RUNTIME`, `AGENT_SANDBOX_KVM_SHARED_NETNS_RUNTIME`, `AGENT_ISOLATION_SANDBOX_KVM_ENABLED`, `AGENT_ISOLATION_PROBE_ENABLED`, `AGENT_ISOLATION_PROBE_INTERVAL_MS`, `AGENT_ISOLATION_PROBE_TIMEOUT_MS`, `AGENT_ISOLATION_PROBE_IMAGE`, `AGENT_ISOLATION_FAILURE_THRESHOLD`. The gVisor runtimes (and, with `/dev/kvm`, the KVM runtimes) are prepared on the host (cloud-init or `apps/agenstra/backend-agent-manager/host/agenstra-gvisor.sh`), not by the manager container.

### Deployments (CI/CD)

- `GET/POST /api/agents/:agentId/deployments/configuration` and `DELETE` - Provider token and defaults (encrypted at rest; upsert via POST)
- `GET /api/agents/:agentId/deployments/repositories` - Repositories
- `GET .../repositories/:repositoryId/branches` - Branches
- `GET .../repositories/:repositoryId/workflows` - Workflows
- `POST /api/agents/:agentId/deployments/workflows/trigger` - Trigger a run
- `GET /api/agents/:agentId/deployments/runs` - List runs
- `GET .../deployments/runs/:runId` - Run detail
- `GET .../deployments/runs/:runId/logs` - Run logs
- `GET .../deployments/runs/:runId/jobs` - Jobs
- `GET .../deployments/runs/:runId/jobs/:jobId/logs` - Job logs
- `POST .../deployments/runs/:runId/cancel` - Cancel run

### Chat sessions

User-visible chat sessions per agent environment (primary plus operator-created threads). Hidden session suffixes are not exposed here. See [Chat Interface](../features/chat-interface.md).

- `GET /api/agents/:agentId/chats` - List sessions (`limit`, `offset`)
- `GET /api/agents/:agentId/chats/count` - Count sessions
- `POST /api/agents/:agentId/chats` - Create a user session (`201 Created`)
- `GET /api/agents/:agentId/chats/:chatId` - Get a session
- `PUT /api/agents/:agentId/chats/:chatId` - Update session title
- `DELETE /api/agents/:agentId/chats/:chatId` - Delete a session
- `GET /api/agents/:agentId/chats/:chatId/messages` - List messages for a session (`limit`, `offset`)

Agent profile responses include `chats` and `primaryChatId`.

### Messages metadata

- `GET /api/agents/:id/messages/latest-agent` - Latest agent chat message metadata for unread tracking

### Workspace configuration overrides

- `GET/PUT/DELETE /api/configuration-overrides...` - Workspace configuration overrides (see OpenAPI)

### Configuration

- `GET /api/config` - Get configuration parameters including Git repository URL, available agent types (with capabilities / transport) and container `isolation` capabilities

### File Operations

- `GET /api/agents/:agentId/files` - List directory contents
- `GET /api/agents/:agentId/files/:path` - Read file content
- `POST /api/agents/:agentId/files/:path` - Create file or directory
- `PUT /api/agents/:agentId/files/:path` - Write file content
- `DELETE /api/agents/:agentId/files/:path` - Delete file or directory
- `PATCH /api/agents/:agentId/files/:path` - Move file or directory

File operations are confined to the agent workspace (`/app`): absolute paths outside it, `..` segments, and paths whose canonical (symlink-resolved) target leaves the workspace are rejected with `400`. All commands run as the unprivileged runtime user `agenstra` with paths passed as argv (never interpolated into shell strings); custom worker images must therefore provide an `agenstra` user. Reads only stream regular files (no FIFOs/devices). Files created in `/app` as root by earlier versions stay root-owned until the next container start (the worker entrypoint re-owns `/app` to `agenstra`); until then, modifying them through the API returns `400` (permission denied). Paths containing control characters are rejected. See [File management](../features/file-management.md#workspace-confinement).

### System File Operations (agent-controller only)

Trusted channel for configuration the agent-controller injects into worker containers (OpenCode layer files, context attachments under `/opt/agenstra/context`). The agent-controller never forwards end-user requests here.

- `GET /api/agents/:agentId/system-files?path=` - List a system or workspace directory
- `PUT /api/agents/:agentId/system-files/:path` - Write file content (max 10MB)
- `POST /api/agents/:agentId/system-files/:path` - Create file or directory
- `DELETE /api/agents/:agentId/system-files/:path` - Delete file or directory

Relative and in-workspace paths behave like the file API above. Absolute paths outside the workspace are installed as root by a single in-container script that walks the parent chain with `cd -P`, refuses symlinked components (`400`), prepares files in a private root-owned `0700` staging directory and installs them with `mv -fT` (never writing or `chmod`-ing through an agent-planted symlink, even in agent-owned parent directories) and leaves entries root-owned with mode `u=rwX,go=rX` (readable, not writable by the agent). Deletes remove a final symlink itself. Protected system trees (`/etc`, `/usr`, `/bin`, `/sbin`, `/lib*`, `/boot`, `/dev`, `/proc`, `/sys`, `/root`, `/run`, `/var`, `/opt/workspace`) and `/` are rejected (`400`). Root execs run via `/usr/bin/env -i` with a fixed system `PATH`, and loader/libc hooks (`LD_PRELOAD`, `LD_DEBUG_OUTPUT`, `GLIBC_TUNABLES`, …) are cleared for the `env` process itself. Agent-controller and agent-manager must be upgraded together: an agent-controller of this version cannot sync layer files or attachments to an older manager (missing `system-files` route), and an older controller cannot sync absolute layer paths to this manager (they are rejected on `/files`).

### Version Control Operations

- `GET /api/agents/:agentId/vcs/status` - Get git status
- `GET /api/agents/:agentId/vcs/branches` - List all branches
- `GET /api/agents/:agentId/vcs/diff?path={filePath}` - Get file diff
- `POST /api/agents/:agentId/vcs/stage` - Stage files
- `POST /api/agents/:agentId/vcs/unstage` - Unstage files
- `POST /api/agents/:agentId/vcs/commit` - Commit staged changes
- `POST /api/agents/:agentId/vcs/push` - Push changes to remote
- `POST /api/agents/:agentId/vcs/pull` - Pull changes from remote
- `POST /api/agents/:agentId/vcs/fetch` - Fetch changes from remote
- `POST /api/agents/:agentId/vcs/rebase` - Rebase current branch
- `POST /api/agents/:agentId/vcs/branches/:branch/switch` - Switch to a branch
- `POST /api/agents/:agentId/vcs/branches` - Create a new branch
- `DELETE /api/agents/:agentId/vcs/branches/:branch` - Delete a branch
- `POST /api/agents/:agentId/vcs/conflicts/resolve` - Resolve merge conflicts
- `POST /api/agents/:agentId/vcs/workspace/prepare-clean` - Prepare a clean Git workspace (automation / operator aid)
- `POST /api/agents/:agentId/automation/verify-commands` - Validate automation-related command configuration

For complete API endpoint documentation, request/response schemas, and authentication requirements, see the application and API reference docs linked below.

## WebSocket Gateway

The Socket.IO gateway shares HTTP `PORT` (default 3000) at `http://localhost:3000/socket/agents` (override namespace via `WEBSOCKET_NAMESPACE`). VNC path `/socket/vnc`; Engine.IO `/socket.io/`.

### Events

#### Client → Server

- `login` - Authenticate with agent ID (UUID or name) and password; optional `chatId` restores that session (primary when omitted)
- `chat` - Send chat message (requires authentication); optional `chatId` scopes the turn to a user-visible session
- `restoreChat` - Re-emit history for `{ chatId }` after the client clears its local thread
- `enhanceChat` / `generateTicketBody` - Isolated prompt helpers (unicast results)
- Additional events for files, terminals (OpenCode PTY), and tooling as described in the agent-manager AsyncAPI (for example `fileUpdate`, `createTerminal`, `terminalInput`, `terminalResize`, `closeTerminal`)

#### Server → Client

- `loginSuccess` - Emitted on successful authentication
- `loginError` - Emitted on authentication failure
- `chatMessage` - Chat traffic (broadcast or unicast depending on message options); includes `chatId` when tied to a persisted session
- `restoreChatSuccess` - Acknowledgement after history restore for a `chatId`
- `chatEvent` / `messageFilterResult`
- `chatEnhanceResult` / `ticketBodyResult`
- `gitStateChanged` - Workspace git may have changed; refresh dirty indicators
- `environmentProgress` - Environment create / update progress (step + percentage, real image pull progress); broadcast to all sockets, terminal `completed` / `failed` states are emitted once
- `containerStats`, container status and resource usage; first event after login, then every 15 seconds by default (`CONTAINER_STATS_SCHEDULER_INTERVAL` in ms)
- `fileUpdateNotification` / terminal events, and other provider-specific events per AsyncAPI
- `error` - Emitted on authorization or processing errors

For complete WebSocket event specifications, authentication flow, and usage examples, see the application and API reference docs linked below.

## Authentication

Built-in **users** registration and JWT login live on the **agent controller** only. The agent manager application always uses **Keycloak** (JWT with `agent_management` role) or **static API key** as configured, there are no `/auth/*` endpoints on this service. Operators typically never call the manager HTTP API directly from a browser; the console uses the controller, which proxies requests with stored client credentials.

### HTTP Endpoints

All HTTP endpoints are protected by Keycloak authentication by default. If `STATIC_API_KEY` is set, API key authentication is used instead.

**Keycloak Authentication**:

- Include a valid Keycloak JWT bearer token in the `Authorization` header: `Bearer <keycloak-jwt-token>`
- **Note**: The token must include the `agent_management` role to access agent-manager endpoints

**API Key Authentication**:

- Include the API key in the `Authorization` header: `Bearer <static-api-key>` or `ApiKey <static-api-key>`

### WebSocket Gateway

The WebSocket gateway uses database-backed authentication. Agents authenticate using their UUID or name along with their password.

For detailed authentication requirements, see the application and API reference docs linked below.

## Rate Limiting

The application implements configurable rate limiting on all API endpoints to prevent abuse and protect against DoS attacks.

### Configuration

Rate limiting is configured via environment variables:

- **`RATE_LIMIT_ENABLED`** Enable/disable rate limiting
  - Default: `true` in production, `false` in development
- **`RATE_LIMIT_TTL`** Time window in seconds (default: `60`)
- **`RATE_LIMIT_LIMIT`** Maximum number of requests per window (default: `100`)

### Behavior

- **Production**: Rate limiting is **enabled by default** (100 requests per 60 seconds)
- **Development**: Rate limiting is **disabled by default** (allows up to 10,000 requests per window)

## CORS Configuration

The application implements production-safe CORS defaults to prevent unauthorized cross-origin requests.

### Configuration

CORS is configured via the `CORS_ORIGIN` environment variable:

- **`CORS_ORIGIN`** Comma-separated list of allowed origins
  - If not set:
    - **Production**: CORS is **disabled** (no origins allowed)
    - **Development**: CORS allows **all origins** (`*`)

## Environment Variables

See the application docs and environment configuration for complete environment variable documentation.

**Application-specific:** `PORT` - HTTP API port (default: `3000`)

- `WEBSOCKET_NAMESPACE` - Socket.IO namespace (default: `socket/agents`)
- `NODE_ENV` - Environment mode (`development` or `production`)

**Git Repository:** `GIT_REPOSITORY_URL` - Git repository URL for agent workspace

- `GIT_USERNAME` - Git username for authentication
- `GIT_TOKEN` - Git personal access token
- `GIT_PASSWORD` - Git password (alternative to token)
- `GIT_PRIVATE_KEY` - SSH private key for SSH repositories

**OpenCode Agent:** `OPENCODE_AGENT_DOCKER_IMAGE` - Docker image for opencode agent containers (default: `ghcr.io/forepath/agenstra-manager-worker:latest`)

**Container isolation:** `AGENT_SANDBOX_RUNTIME` - Docker runtime of the sandboxed level (default: `runsc-systrap`)

- `AGENT_SANDBOX_SHARED_NETNS_RUNTIME` - Sandboxed runtime for workers behind an egress guard or on the agent network (default: `runsc-systrap-hostnet`)
- `AGENT_ISOLATION_SANDBOX_ENABLED` - `false` disables the sandboxed level (default: `true`)
- `AGENT_SANDBOX_KVM_RUNTIME` - Docker runtime of the sandboxed-kvm level (default: `runsc-kvm`)
- `AGENT_SANDBOX_KVM_SHARED_NETNS_RUNTIME` - Sandboxed-kvm runtime for workers behind an egress guard or on the agent network (default: `runsc-kvm-hostnet`)
- `AGENT_ISOLATION_SANDBOX_KVM_ENABLED` - `false` disables the sandboxed-kvm level (default: `true`)
- `AGENT_ISOLATION_PROBE_ENABLED` - Periodic re-probe (default: `true`)
- `AGENT_ISOLATION_PROBE_INTERVAL_MS` - Re-probe interval (default: `21600000`)
- `AGENT_ISOLATION_PROBE_TIMEOUT_MS` - Timeout per level probe (default: `90000`)
- `AGENT_ISOLATION_PROBE_IMAGE` - Probe image (default: the worker image)
- `AGENT_ISOLATION_FAILURE_THRESHOLD` - Consecutive runtime failures of a gVisor level that trigger a re-probe (default: `3`)

**Dynamic provider plugins (optional):** `DYNAMIC_AGENT_PROVIDERS` - Extra agent backend packages

- `DYNAMIC_PIPELINE_PROVIDERS` - Extra CI/CD provider packages
- `DYNAMIC_CHAT_FILTERS` - Extra chat filter packages
- `DYNAMIC_PROVIDER_PLUGIN_PATH` / `DYNAMIC_PROVIDER_PLUGIN_INSTALL` - Post-build plugin mount and startup install

See [Dynamic provider plugins](../features/dynamic-provider-plugins.md).

## Database Setup

The application uses TypeORM and requires a database connection to be configured. See the application docs for database setup requirements and entity schema.

## Docker Deployment

The application includes Dockerfiles for containerized deployment:

```bash
# Build API container
nx docker:api agenstra-backend-agent-manager

# Build worker container
nx docker:worker agenstra-backend-agent-manager

```

### Running the Container

**Important**: When running the API container, you must mount the Docker socket to enable Docker-in-Docker functionality for agent container management:

```bash
# Run with docker-compose (recommended)
cd apps/agenstra/backend-agent-manager
docker compose up -d

# Or run directly with Docker socket mount
docker run -v /var/run/docker.sock:/var/run/docker.sock \
  -p 3000:3000 \
  -e CORS_ORIGIN="https://agenstra.com" \
  -e RATE_LIMIT_ENABLED=true \
  -e RATE_LIMIT_LIMIT=100 \
  agenstra-backend-agent-manager:api
```

The `/var/run/docker.sock` mount is required for the application to manage agent containers. Without this mount, the Docker CLI installed in the container will not be able to communicate with the host Docker daemon.

Treat socket access as **high privilege** on the host. The API image runs as **`agenstra`** (not root); at startup the entrypoint aligns the container `docker` group with the socket GID, then starts Node. Rebuild with `DOCKER_GID` matching your host if the default does not match `stat -c '%g' /var/run/docker.sock`.

### Container images and security

| Image                            | User               | Registry (default)                         | Notes                                                                           |
| -------------------------------- | ------------------ | ------------------------------------------ | ------------------------------------------------------------------------------- |
| **API** (`Dockerfile.api`)       | `agenstra` (10001) | `ghcr.io/forepath/agenstra-manager-api`    | HTTP + WebSocket; Docker CLI + socket mount; root entrypoint GID sync then drop |
| **Worker** (`Dockerfile.worker`) | `agenstra`         | `ghcr.io/forepath/agenstra-manager-worker` | OpenCode workloads; workspace at `/app`; credentials in `/home/agenstra`        |

Per-agent bind mounts (host `/opt/agents/{uuid}`) and read-only `/opt/agents` → `/opt/workspace` are documented in **[Container image security](../security/container-images.md)**.

Configuration secrets belong in the environment at deploy time, not in image defaults. Override images via `OPENCODE_AGENT_*` variables (see [Environment configuration](../deployment/environment-configuration.md)). When upgrading, deploy API and worker tags from the **same release**.

## Production Deployment Checklist

Before deploying to production, ensure:

- `NODE_ENV=production` is set
- `CORS_ORIGIN` is configured with your production domain(s)
- `RATE_LIMIT_ENABLED=true` (or leave unset, defaults to `true` in production)
- `RATE_LIMIT_LIMIT` is set to an appropriate value for your use case
- `STATIC_API_KEY` or Keycloak credentials are configured
- Database credentials are secure
- Docker socket is properly mounted for container management
- Manager API and worker images are on matching release tags
- Host `/opt/agents` permissions are suitable for UID **10001** (see [Container image security](../security/container-images.md))
- Host `docker` group GID matches image `DOCKER_GID` (or image rebuilt with correct `--build-arg`)

## Related documentation

- **[Agent Management Feature](../features/agent-management.md)** Agent management guide
- **[WebSocket Communication Feature](../features/websocket-communication.md)** WebSocket communication guide
- **[Deployment Feature](../features/deployment.md)** CI/CD configuration and operations
- **[Message Filters](../features/message-filters.md)** Layered chat message filters
- **[Egress Filtering](../features/egress-filtering.md)** Per-environment web traffic filtering
- **[Container Isolation Levels](../features/container-isolation.md)** Standard (`runc`), gVisor-sandboxed and gVisor-on-KVM environments
- **[Dynamic provider plugins](../features/dynamic-provider-plugins.md)** Custom agent, pipeline, and filter providers
- **[Backend Agent Controller](./backend-agent-controller.md)** Control plane and proxy paths used by the console
- **[Deployment Guide](../deployment/production-checklist.md)** Production deployment guide

## License

This application is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**.

Copyright (c) 2025 IPvX UG (haftungsbeschränkt)

---

_For detailed technical specifications, see the application and API reference docs linked below._
