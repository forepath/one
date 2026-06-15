# Backend Agent Controller

NestJS backend application for managing clients and proxying agent operations to remote agent-manager services.

## Purpose

This application provides a centralized control plane for managing multiple distributed agent-manager instances. It enables the creation, management, and real-time interaction with agents across multiple remote agent-manager services through both synchronous HTTP requests and persistent WebSocket connections.

## Features

This application provides:

- **HTTP REST API** - Full CRUD operations for client management and proxied agent operations
- **WebSocket Gateway** - Real-time bidirectional event forwarding to remote agent-manager services
- **Server Provisioning** - Automated cloud server provisioning (Hetzner Cloud, DigitalOcean) with Docker and agent-manager deployment
- **Tickets and Automation** - Workspace tickets, migration, and automation APIs with optional ticket board WebSocket namespace
- **Usage Statistics** - Aggregated chat, filter, and entity metrics for operators and admins
- **Global Filter Rules** - Admin-managed regex policies synced to workspaces
- **Atlassian import** - Admin-managed Atlassian site connections and Jira/Confluence import configurations (scheduled and on-demand)
- **Per-Client Permissions** - Fine-grained access control with user roles per client (keycloak/users mode)
- **Secure Authentication** - API key, Keycloak OAuth2/OIDC, or built-in users (JWT) for HTTP and WebSocket
- **Database Support** - PostgreSQL with TypeORM for data persistence
- **Auto Migrations** - Automatic database schema migrations on startup
- **Rate Limiting** - Configurable rate limiting on all API endpoints
- **CORS Configuration** - Production-safe CORS defaults

## Architecture

This application is built using:

- **NestJS** - Progressive Node.js framework
- **TypeORM** - Object-Relational Mapping for database operations
- **Keycloak** - Identity and access management (optional, can use API key)
- **Socket.IO** - WebSocket communication
- **PostgreSQL** - Database for client and credential storage

The thin Nest application composes **`ClientsModule`** and **`IdentityStatisticsBridgeModule`** from `@forepath/agenstra/backend` and **`MonitoringModule`** from `@forepath/shared/backend`, which bundle client management, ticket and proxy behavior, usage statistics bridging, and health endpoints from the agent-controller implementation.

## API Endpoints

All HTTP endpoints are prefixed with `/api` and protected by Keycloak authentication (or API key authentication if `STATIC_API_KEY` is set).

### Client Management

- `GET /api/clients` - List all clients (filtered by user access in keycloak/users mode; supports `limit` and `offset`)
- `GET /api/clients/:id` - Get a single client by UUID
- `POST /api/clients` - Create a new client (returns API key if API_KEY authentication type)
- `POST /api/clients/:id` - Update an existing client
- `DELETE /api/clients/:id` - Delete a client

### Client User Management (keycloak/users authentication only)

- `GET /api/clients/:id/users` - List users associated with a client
- `POST /api/clients/:id/users` - Add a user to a client by email
- `DELETE /api/clients/:id/users/:relationshipId` - Remove a user from a client

In api-key mode, users do not play a role; these endpoints are not applicable.

### Proxied Agent Operations

- `GET /api/clients/:id/agents` - List all agents for a client
- `GET /api/clients/:id/agents/:agentId` - Get a single agent by UUID
- `POST /api/clients/:id/agents` - Create a new agent for a client (returns auto-generated password, saves credentials)
- `POST /api/clients/:id/agents/:agentId` - Update an existing agent
- `DELETE /api/clients/:id/agents/:agentId` - Delete an agent (also deletes stored credentials)
- `GET /api/clients/:id/agents/:agentId/models` - List models for an agent (proxied)

### Proxied agent lifecycle

- `POST /api/clients/:id/agents/:agentId/start` - Start the agent container (proxied)
- `POST /api/clients/:id/agents/:agentId/stop` - Stop the agent container (proxied)
- `POST /api/clients/:id/agents/:agentId/restart` - Restart the agent container (proxied)

### Proxied environment variables

- `GET /api/clients/:id/agents/:agentId/environment` - List environment variables (proxied; supports `limit` and `offset`)
- `GET /api/clients/:id/agents/:agentId/environment/count` - Count environment variables (proxied)
- `POST /api/clients/:id/agents/:agentId/environment` - Create environment variable (proxied)
- `PUT /api/clients/:id/agents/:agentId/environment/:envVarId` - Update environment variable (proxied)
- `DELETE /api/clients/:id/agents/:agentId/environment/:envVarId` - Delete environment variable (proxied)
- `DELETE /api/clients/:id/agents/:agentId/environment` - Delete all environment variables (proxied)

### Proxied deployments (CI/CD)

The console calls the controller; the controller proxies to each client’s agent-manager. Typical paths:

- `GET/PUT/DELETE .../deployments/configuration` - Deployment configuration
- `GET .../deployments/repositories` - List repositories
- `GET .../deployments/repositories/:repositoryId/branches` - List branches
- `GET .../deployments/repositories/:repositoryId/workflows` - List workflows
- `POST .../deployments/workflows/trigger` - Trigger a workflow
- `GET .../deployments/runs` - List runs
- `GET .../deployments/runs/:runId` - Run status
- `GET .../deployments/runs/:runId/logs` - Run logs
- `GET .../deployments/runs/:runId/jobs` - Run jobs
- `GET .../deployments/runs/:runId/jobs/:jobId/logs` - Job logs
- `POST .../deployments/runs/:runId/cancel` - Cancel a run

### Tickets and automation (controller-native)

Tickets live on the controller database (not on the remote manager). See [Tickets and Workspaces](../features/tickets-and-workspaces.md).

- `GET/POST /api/tickets` - List and create tickets
- `GET/PATCH/DELETE /api/tickets/:id` - Read, update, delete
- `GET/POST /api/tickets/:id/comments` - Comments
- `GET /api/tickets/:id/activity` - Activity feed
- `GET/POST /api/tickets/:id/prototype-prompt` - Prototype prompt helpers
- `GET/POST /api/tickets/:id/body-generation-sessions` and related apply endpoint - Assisted body generation flow
- `POST /api/tickets/:id/migrate` - Move ticket subtree to another workspace (`targetClientId`)
- `GET/PATCH /api/tickets/:ticketId/automation` - Automation configuration
- `POST .../automation/approve` and `POST .../automation/unapprove` - Approve or revoke approval
- `GET .../automation/runs`, `GET .../automation/runs/:runId`, `POST .../automation/runs/:runId/cancel` - Runs and cancel

### Usage statistics

See [Usage Statistics](../features/usage-statistics.md).

- `GET /api/clients/:id/statistics/summary` - Summary for one workspace
- `GET /api/clients/:id/statistics/chat-io` - Chat I/O metrics
- `GET /api/clients/:id/statistics/filter-drops` - Filter drop metrics
- `GET /api/clients/:id/statistics/filter-flags` - Filter flag metrics
- `GET /api/clients/:id/statistics/entity-events` - Entity event stream for statistics
- `GET /api/statistics/summary` - Aggregate summary (access rules per OpenAPI)
- `GET /api/statistics/chat-io`, `filter-drops`, `filter-flags`, `entity-events` - Global aggregates

### Global message filter rules (admin)

See [Message Filter Rules](../features/message-filter-rules.md).

- `GET/POST /api/filter-rules` - List (paginated) and create rules
- `GET/PUT/DELETE /api/filter-rules/:id` - Read, update, delete a rule

### Atlassian import (controller-native, admin)

See [Atlassian import](../features/atlassian-import.md). All paths are under **`/api/imports/atlassian`** with the same admin authorization model as filter rules (global admin session, or API key authentication).

- `GET/POST /api/imports/atlassian/connections` - List (paginated) and create site connections
- `GET/PUT/DELETE /api/imports/atlassian/connections/{id}` - Read, update, delete a connection
- `POST /api/imports/atlassian/connections/{id}/test` - Verify credentials against Atlassian REST
- `GET/POST /api/imports/atlassian/configs` - List (paginated) and create import configurations
- `GET/PUT/DELETE /api/imports/atlassian/configs/{id}` - Read, update, delete a configuration
- `POST /api/imports/atlassian/configs/{id}/run` - Run one import (accepted asynchronously)
- `DELETE /api/imports/atlassian/configs/{id}/markers` - Clear sync markers for a configuration

### Agent autonomy (workspace configuration)

- `GET/PUT /api/clients/:id/agent-autonomy/enabled-agent-ids` - Which agents may run with autonomy for this workspace
- `GET/PUT /api/clients/:id/agents/:agentId/autonomy` - Per-agent autonomy configuration (workspace managers; see OpenAPI for `403` cases)

### Users authentication HTTP (users mode only)

When `AUTHENTICATION_METHOD=users`, public and authenticated user endpoints include registration, login, password flows, and admin user management. See [Authentication](../features/authentication.md) and OpenAPI paths `/auth/*` and `/users/*`.

### Proxied File Operations

- `GET /api/clients/:id/agents/:agentId/files` - List directory contents
- `GET /api/clients/:id/agents/:agentId/files/:path` - Read file content
- `POST /api/clients/:id/agents/:agentId/files/:path` - Create file or directory
- `PUT /api/clients/:id/agents/:agentId/files/:path` - Write file content
- `DELETE /api/clients/:id/agents/:agentId/files/:path` - Delete file or directory
- `PATCH /api/clients/:id/agents/:agentId/files/:path` - Move file or directory

### Proxied VCS Operations

- `GET /api/clients/:id/agents/:agentId/vcs/status` - Get git status
- `GET /api/clients/:id/agents/:agentId/vcs/branches` - List all branches
- `GET /api/clients/:id/agents/:agentId/vcs/diff?path={filePath}` - Get file diff
- `POST /api/clients/:id/agents/:agentId/vcs/stage` - Stage files
- `POST /api/clients/:id/agents/:agentId/vcs/unstage` - Unstage files
- `POST /api/clients/:id/agents/:agentId/vcs/commit` - Commit staged changes
- `POST /api/clients/:id/agents/:agentId/vcs/push` - Push changes to remote
- `POST /api/clients/:id/agents/:agentId/vcs/pull` - Pull changes from remote
- `POST /api/clients/:id/agents/:agentId/vcs/fetch` - Fetch changes from remote
- `POST /api/clients/:id/agents/:agentId/vcs/rebase` - Rebase current branch
- `POST /api/clients/:id/agents/:agentId/vcs/branches/:branch/switch` - Switch to a branch
- `POST /api/clients/:id/agents/:agentId/vcs/branches` - Create a new branch
- `DELETE /api/clients/:id/agents/:agentId/vcs/branches/:branch` - Delete a branch
- `POST /api/clients/:id/agents/:agentId/vcs/conflicts/resolve` - Resolve merge conflicts
- `POST /api/clients/:id/agents/:agentId/vcs/workspace/prepare-clean` - Prepare a clean workspace (proxied)
- `POST /api/clients/:id/agents/:agentId/automation/verify-commands` - Verify automation command configuration (proxied)

### Server Provisioning

- `GET /api/clients/provisioning/providers` - List available provisioning providers
- `GET /api/clients/provisioning/providers/:providerType/server-types` - Get available server types for a provider
- `POST /api/clients/provisioning/provision` - Provision a new server and create a client
- `GET /api/clients/:id/provisioning/info` - Get server information for a provisioned client
- `DELETE /api/clients/:id/provisioning` - Delete a provisioned server and its associated client

For complete API endpoint documentation, request/response schemas, and authentication requirements, see the application and API reference docs linked below.

## WebSocket Gateway

Socket.IO listens on **`WEBSOCKET_PORT`** (default `8081`). Two namespaces share the same port and CORS settings (`WEBSOCKET_CORS_ORIGIN`):

- **`clients`** (default `WEBSOCKET_NAMESPACE` = `clients`) – proxy to the selected workspace’s agent-manager; chat, terminals, stats, and controller-originated ticket hints for the chat UI
- **`tickets`** (default `TICKETS_WEBSOCKET_NAMESPACE` = `tickets`) – ticket board and automation realtime (see [Tickets and Workspaces](../features/tickets-and-workspaces.md))

Connect to each namespace explicitly in the client library (e.g. `io(url + '/clients', options)` and `io(url + '/tickets', options)`).

### Authentication

WebSocket connections require authentication via the `Authorization` header (polling) or `handshake.auth.Authorization` (WebSocket transport). The same authentication methods as HTTP apply:

- **API key**: `Bearer <static-api-key>` or `ApiKey <static-api-key>`
- **Keycloak**: `Bearer <keycloak-jwt-token>`
- **Users**: `Bearer <jwt-token>`

Unauthenticated connections are rejected with `connect_error` "Unauthorized". The `setClient` operation enforces per-client authorization: only users with access to the requested client can set that client context. Unauthorized attempts emit an `error` event with message "You do not have access to this client".

### Namespace `clients` – events

#### Client → Server

- `setClient` - Set the client context for subsequent operations (requires access to the client)
- `forward` - Forward an event to the remote agent-manager WebSocket (same event names as on the manager, e.g. `chat`, `login`)

#### Server → Client

- `setClientSuccess` - Confirmation that client context was set (or already set)
- `forwardAck` - Acknowledgement that a `forward` was accepted
- **Proxied manager events** - Responses are re-emitted using their original event names (for example `chatMessage`, `containerStats`, `terminalOutput`) to the initiating socket only
- `remoteDisconnected`, `remoteReconnecting`, `remoteReconnected`, `remoteReconnectError`, `remoteReconnectFailed` - Remote agent-manager link state
- `ticketAutomationRunChatUpsert`, `ticketChatTicketUpsert` - Controller-originated ticket timeline and metadata for chat clients (see AsyncAPI)
- `error` - Error messages

### Namespace `tickets` – events

Same handshake auth as `clients`. After `setClient` with a workspace id, the socket joins room `client:{clientId}`.

#### Client → Server

- `setClient` - Select workspace for board realtime

#### Server → Client

- `setClientSuccess` - Workspace context set
- `ticketUpsert`, `ticketRemoved`, `ticketCommentCreated`, `ticketActivityCreated`
- `ticketAutomationUpsert`, `ticketAutomationRunUpsert`, `ticketAutomationRunStepAppended`
- `error` - Tickets namespace errors

For complete WebSocket event specifications and usage examples, see the application and API reference docs linked below.

## Authentication

Authentication is configured via `AUTHENTICATION_METHOD` (or inferred from `STATIC_API_KEY`). See [Authentication Feature](../features/authentication.md) for details.

### HTTP Endpoints

All HTTP endpoints require authentication. The method depends on configuration:

**API Key** (`AUTHENTICATION_METHOD=api-key`):

- Include the API key: `Authorization: Bearer <static-api-key>` or `ApiKey <static-api-key>`
- All permission checks are bypassed

**Keycloak** (`AUTHENTICATION_METHOD=keycloak`):

- Include a valid Keycloak JWT: `Authorization: Bearer <keycloak-jwt-token>`
- Per-client permissions apply (global admin, client creator, or client_users entry)

**Users** (`AUTHENTICATION_METHOD=users`):

- Include a valid JWT from login: `Authorization: Bearer <jwt-token>`
- Per-client permissions apply

### WebSocket Gateway

The WebSocket gateway uses the same authentication as HTTP. Clients must authenticate on connect and set their context using the `setClient` event before forwarding events. Per-client access is enforced on `setClient`.

For detailed authentication requirements, see the [Authentication Feature](../features/authentication.md).

## Rate Limiting

The application implements configurable rate limiting on all API endpoints to prevent abuse and protect against DoS attacks.

### Configuration

Rate limiting is configured via environment variables:

- **`RATE_LIMIT_ENABLED`** - Enable/disable rate limiting
  - Default: `true` in production, `false` in development
- **`RATE_LIMIT_TTL`** - Time window in seconds (default: `60`)
- **`RATE_LIMIT_LIMIT`** - Maximum number of requests per window (default: `100`)

### Behavior

- **Production**: Rate limiting is **enabled by default** (100 requests per 60 seconds)
- **Development**: Rate limiting is **disabled by default** (allows up to 10,000 requests per window)

### Error Response

When rate limit is exceeded, the API returns:

- **Status Code**: `429 Too Many Requests`
- **Message**: `"Too many requests, please try again later."`

## CORS Configuration

The application implements production-safe CORS defaults to prevent unauthorized cross-origin requests.

### Configuration

CORS is configured via the `CORS_ORIGIN` environment variable:

- **`CORS_ORIGIN`** - Comma-separated list of allowed origins
  - Example: `"https://agenstra.com,https://app.agenstra.com"`
  - If not set:
    - **Production**: CORS is **disabled** (no origins allowed) - most secure default
    - **Development**: CORS allows **all origins** (`*`) - convenient for local development

### Behavior

- **Production**: CORS is **disabled by default** (empty origins array)
  - **Warning**: If `CORS_ORIGIN` is not set in production, the application will log a warning and CORS will be disabled
  - **Required**: Set `CORS_ORIGIN` to allow specific origins in production

- **Development**: CORS allows **all origins** (`*`) by default

## Outbound client workspace URLs (SSRF)

Requests and WebSocket handshakes to each workspace’s **stored agent-manager base URL** are validated to reduce SSRF and DNS rebinding risk: URL shape, optional hostname allowlist, HTTPS in production, TLS verification (configurable in non-production), and DNS checks on resolved addresses (unless opted out). Variable names align with frontend **`CONFIG_*`** patterns where applicable. See **[Environment configuration](../deployment/environment-configuration.md)** for `CLIENT_ENDPOINT_*` settings (including production requirement for `CLIENT_ENDPOINT_ALLOWED_HOSTS`).

## Environment Variables

See the application docs and environment configuration for complete environment variable documentation.

**Application-specific:**

- `PORT` - HTTP API port (default: `3100`)
- `WEBSOCKET_PORT` - WebSocket gateway port (default: `8081`; shared by `clients` and `tickets` namespaces)
- `WEBSOCKET_NAMESPACE` - Socket.IO namespace for agent proxying (default: `clients`)
- `TICKETS_WEBSOCKET_NAMESPACE` - Socket.IO namespace for ticket board realtime (default: `tickets`)
- `WEBSOCKET_CORS_ORIGIN` - CORS origin(s) for WebSocket (see framework docs)
- `NODE_ENV` - Environment mode (`development` or `production`)

**CORS Configuration:**

- `CORS_ORIGIN` - Allowed CORS origins (comma-separated list)

**Rate Limiting:**

- `RATE_LIMIT_ENABLED` - Enable/disable rate limiting
- `RATE_LIMIT_TTL` - Time window in seconds (default: `60`)
- `RATE_LIMIT_LIMIT` - Maximum requests per window (default: `100`)

**Client workspace endpoints (SSRF):**

- `CLIENT_ENDPOINT_ALLOWED_HOSTS` - Allowed endpoint hostnames (comma-separated or `*`); **required in production**
- `CLIENT_ENDPOINT_ALLOW_INSECURE_HTTP` - Allow `http:` endpoints in production when `true`
- `CLIENT_ENDPOINT_ALLOW_INTERNAL_HOST` - Allow private/loopback targets and skip DNS rebinding check when `true` (same pattern as `CONFIG_*`: no separate skip-DNS flag)
- `CLIENT_ENDPOINT_TLS_REJECT_UNAUTHORIZED` - TLS verify outbound HTTPS (set `false` only outside production)

**Authentication:**

- `AUTHENTICATION_METHOD` - Authentication method: `api-key`, `keycloak`, or `users` (default: inferred from `STATIC_API_KEY`)
- `STATIC_API_KEY` - Static API key (required when `AUTHENTICATION_METHOD=api-key`)
- `KEYCLOAK_SERVER_URL` - Keycloak server URL (optional, used for server URL if different from auth server URL)
- `KEYCLOAK_AUTH_SERVER_URL` - Keycloak authentication server URL (required for Keycloak auth)
- `KEYCLOAK_REALM` - Keycloak realm name (required for Keycloak auth)
- `KEYCLOAK_CLIENT_ID` - Keycloak client ID (required for Keycloak auth)
- `KEYCLOAK_CLIENT_SECRET` - Keycloak client secret (required for Keycloak auth)
- `KEYCLOAK_TOKEN_VALIDATION` - Token validation method: `ONLINE` or `OFFLINE` (optional, default: `ONLINE`)

**Database:**

- `DB_HOST` - Database host (default: `localhost`)
- `DB_PORT` - Database port (default: `5432`)
- `DB_USERNAME` - Database username (default: `postgres`)
- `DB_PASSWORD` - Database password (default: `postgres`)
- `DB_DATABASE` - Database name (default: `postgres`)

**Server Provisioning:**

- `HETZNER_API_TOKEN` - Hetzner Cloud API token
- `DIGITALOCEAN_API_TOKEN` - DigitalOcean API token
- `ENCRYPTION_KEY` - Encryption key for sensitive data

## Database Setup

The application uses TypeORM and requires a database connection to be configured. See the application docs for database setup requirements and entity schema.

## Docker Deployment

The application includes Dockerfiles for containerized deployment:

```bash
# Build API container
nx docker:api backend-agent-controller
```

### Running the Container

```bash
# Run with docker-compose (recommended)
cd apps/backend-agent-controller
docker compose up -d

# Or run directly
docker run \
  -p 3100:3100 \
  -p 8081:8081 \
  -e CORS_ORIGIN="https://agenstra.com" \
  -e RATE_LIMIT_ENABLED=true \
  -e RATE_LIMIT_LIMIT=100 \
  backend-agent-controller:api
```

The API image uses the same **non-root `agenstra`** user, **restricted `sudo`**, and optional Docker socket hardening as the agent manager when the socket is mounted. See **[Container image security](../security/container-images.md)** and **[Docker deployment](../deployment/docker-deployment.md#container-security-images)**.

## Production Deployment Checklist

Before deploying to production, ensure:

- `NODE_ENV=production` is set
- `CORS_ORIGIN` is configured with your production domain(s)
- `RATE_LIMIT_ENABLED=true` (or leave unset, defaults to `true` in production)
- `RATE_LIMIT_LIMIT` is set to an appropriate value for your use case
- `STATIC_API_KEY` or Keycloak credentials are configured
- Database credentials are secure
- `ENCRYPTION_KEY` is set for sensitive data encryption

## Related Documentation

- **[Client Management Feature](../features/client-management.md)** - Client management guide
- **[Server Provisioning Feature](../features/server-provisioning.md)** - Server provisioning guide
- **[WebSocket Communication Feature](../features/websocket-communication.md)** - WebSocket communication guide
- **[Tickets and Workspaces](../features/tickets-and-workspaces.md)** - Tickets, migration, automation
- **[Usage Statistics](../features/usage-statistics.md)** - Controller usage metrics
- **[Message Filter Rules](../features/message-filter-rules.md)** - Global and per-agent filters
- **[Atlassian import](../features/atlassian-import.md)** - Atlassian site connections and Jira/Confluence import configurations
- **[Deployment Feature](../features/deployment.md)** - CI/CD configuration (invoked via controller proxy from the console)
- **[Deployment Guide](../deployment/production-checklist.md)** - Production deployment guide

## License

This application is licensed under the **Business Source License 1.1 (BUSL-1.1)**.

Copyright (c) 2025 IPvX UG (haftungsbeschränkt)

---

_For detailed technical specifications, see the application and API reference docs linked below._
