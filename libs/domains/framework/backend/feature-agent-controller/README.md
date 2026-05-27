# framework-backend-feature-agent-controller

Client management feature library for backend applications providing HTTP REST API for managing clients and proxying agent operations to remote agent-manager services, plus WebSocket gateway for event forwarding.

## Purpose

This library enables the management of clients that connect to remote agent-manager services. It provides:

- **HTTP REST API** for CRUD operations on clients (create, read, update, delete)
- **HTTP REST API** for proxied agent operations (create, read, update, delete agents via client endpoints)
- **WebSocket Gateway** for real-time bidirectional event forwarding to remote agent-manager WebSocket endpoints
- **Authentication Support** for both API key and Keycloak OAuth2 Client Credentials flow
- **Credential Management** for storing agent credentials to enable WebSocket auto-login

Clients are entities that represent remote agent-manager services. The controller proxies HTTP requests to these services and forwards WebSocket events, enabling centralized management of distributed agent-manager instances.

## Features

- ✅ Auto-generated UUID primary keys
- ✅ Auto-generated API keys for API_KEY authentication type
- ✅ Keycloak OAuth2 Client Credentials flow support with token caching
- ✅ HTTP REST API with Keycloak authentication
- ✅ WebSocket gateway for event forwarding to remote agent-manager services
- ✅ Automatic agent login using stored credentials
- ✅ Support for configurable agent WebSocket ports per client
- ✅ Credential storage for proxied agent operations
- ✅ **Server Provisioning** - Automated cloud server provisioning with Docker and agent-manager deployment
- ✅ **Per-Client Permissions** - Fine-grained access control with user roles per client (admin/user)
- ✅ **Statistics** - Persistent data collection for chat I/O, filter drops, and entity lifecycle events; structure ready for future REST API

## Architecture

The library follows Domain-Driven Design (DDD) principles with clear separation of concerns:

- **Entities**:
  - `ClientEntity` - Domain model representing a client (remote agent-manager service)
  - `ClientAgentCredentialEntity` - Stores credentials for agents created via proxied requests
  - `ClientUserEntity` - Many-to-many relationship between users and clients with per-client roles
- **Repositories**:
  - `ClientsRepository` - Data access layer for client operations
  - `ClientAgentCredentialsRepository` - Data access layer for agent credentials
  - `ClientUsersRepository` - Data access layer for client-user relationships
- **Services**:
  - `ClientsService` - Business logic orchestration for clients with permission checks
  - `ClientUsersService` - Manages client-user relationships and role-based access control
  - `ClientAgentProxyService` - Proxies HTTP requests to remote agent-manager services
  - `ClientAgentFileSystemProxyService` - Proxies file system operations to remote agent-manager services
  - `ClientAgentEnvironmentVariablesProxyService` - Proxies environment variable operations to remote agent-manager services
  - `ClientAgentCredentialsService` - Manages stored agent credentials
  - `KeycloakTokenService` - Handles Keycloak OAuth2 Client Credentials flow with token caching
- **DTOs**: Data transfer objects for API boundaries
  - `CreateClientDto` - Input validation for creating clients
  - `UpdateClientDto` - Input validation for updating clients
  - `ClientResponseDto` - Safe API responses (excludes sensitive data, includes proxied config with agent types from remote agent-manager)
  - `CreateClientResponseDto` - Response when creating client (includes API key if applicable)
- **Controllers**: `ClientsController` - HTTP endpoints for client and proxied agent management (protected by Keycloak)
- **Gateways**: `ClientsGateway` - WebSocket gateway for forwarding events to remote agent-manager WebSocket endpoints
- **Modules**: `ClientsModule` - NestJS module wiring all dependencies

## Documentation

### API Specifications

- **[OpenAPI 3.1 Specification](./spec/openapi.yaml)** - Complete HTTP REST API specification with request/response schemas, authentication requirements, and endpoint documentation
- **[AsyncAPI 3.0.0 Specification](./spec/asyncapi.yaml)** - WebSocket gateway specification with event definitions, message schemas, and channel documentation

### Visual Diagrams

All diagrams are available in the [`docs/`](./docs/) directory:

- **[Overview Diagram](./docs/overview.mmd)** - High-level flowchart showing HTTP REST API for clients, proxied agent operations, and WebSocket event forwarding
- **[Statistics Model](./docs/statistics-architecture.mmd)** - Flowchart of shadow tables and statistics/event tables; persistent statistics (chat I/O, filter drops, entity lifecycle), collection points, REST API
- **[HTTP Statistics Sequence Diagram](./docs/sequence-http-statistics.mmd)** - Sequence diagram for Statistics REST API (client-scoped and aggregate endpoints)
- **[HTTP Sequence Diagram](./docs/sequence-http.mmd)** - Detailed sequence diagram for all HTTP CRUD operations (client management and proxied agent operations)
- **[HTTP Environment Variables Sequence Diagram](./docs/sequence-http-environment.mmd)** - Detailed sequence diagram for proxied environment variable operations
- **[Ticket workspace migration](./docs/sequence-http-ticket-workspace-migrate.mmd)** - `POST /tickets/:id/migrate` (workspace management on source and target)
- **[HTTP VCS Sequence Diagram](./docs/sequence-http-vcs.mmd)** - Detailed sequence diagram for proxied VCS (Git) operations
- **[WebSocket Forwarding Diagram](./docs/sequence-ws-forward.mmd)** - Sequence diagram for WebSocket connection, client context setup, event forwarding, and auto-login
- **[Chat prompt enhancement](./docs/sequence-chat-enhancement.mmd)** - Sequence for `enhanceChat` / `chatEnhanceResult` (magic-wand flow; statistics only, no `agent_messages`)
- **[Lifecycle Diagram](./docs/lifecycle.mmd)** - End-to-end sequence diagram showing the complete lifecycle from client creation through proxied agent operations to WebSocket event forwarding

These diagrams provide comprehensive visual documentation of:

- Component interactions and data flow
- Error handling and edge cases
- Authentication and authorization flows (API key and Keycloak)
- Real-time communication patterns
- Proxying and forwarding mechanisms

## Usage

### Import the Module

```typescript
import { ClientsModule } from '@forepath/framework/backend';

@Module({
  imports: [ClientsModule],
})
export class AppModule {}
```

### Use the Service

```typescript
import { ClientsService } from '@forepath/framework/backend';

@Injectable()
export class MyService {
  constructor(private readonly clientsService: ClientsService) {}

  async createClient(name: string, endpoint: string) {
    const result = await this.clientsService.create({
      name,
      endpoint,
      authenticationType: 'api_key',
    });
    // result.apiKey contains the auto-generated API key (if API_KEY type)
    return result;
  }
}
```

## Per-Client Permissions

Agenstra supports fine-grained per-client permissions to enable multi-tenant scenarios. Each client has:

1. **Creator** (`user_id`): The user who created the client. This is automatically set when a client is created (or null in api-key mode).
2. **Associated Users** (`client_users` table): A many-to-many relationship allowing multiple users to access a client with different roles.

### Access Control Rules

Access to a client is granted if:

- The user is a **global admin** (role `admin` in the `users` table)
- The user is the **creator** of the client (`user_id` matches)
- The user is in the `client_users` relationship table for that client

In **api-key mode** (`AUTHENTICATION_METHOD=api-key`), all permission checks are bypassed and access is always granted.

### Client Roles

Each user-client relationship has a role:

- **`admin`**: Can manage users (add/remove) and has full access to the client
- **`user`**: Can access the client but cannot manage users

### Permission Matrix

| User Type      | Can Create Clients | Can View Own Clients | Can View Other Clients | Can Add Users       | Can Remove Users |
| -------------- | ------------------ | -------------------- | ---------------------- | ------------------- | ---------------- |
| Global Admin   | ✅                 | ✅                   | ✅ (all)               | ✅ (any role)       | ✅ (anyone)      |
| Client Creator | ✅                 | ✅                   | ❌                     | ✅ (any role)       | ✅ (anyone)      |
| Client Admin   | ❌                 | ✅ (assigned)        | ❌                     | ✅ (user role only) | ✅ (users only)  |
| Client User    | ❌                 | ✅ (assigned)        | ❌                     | ❌                  | ❌               |
| API Key Mode   | ✅                 | ✅                   | ✅ (all)               | N/A                 | N/A              |

**Note:** In api-key mode, users do not play a role; the client user management endpoints (`GET/POST/DELETE /api/clients/:id/users`) are intended for keycloak and users authentication only.

### Managing Client Users

Users are added to clients by their email address. This applies to keycloak and users authentication; in api-key mode, users do not play a role and these endpoints are not applicable.

```typescript
// Add a user to a client
POST /api/clients/{clientId}/users
{
  "email": "user@example.com",
  "role": "user"  // or "admin"
}
```

The user must exist in the system (in the `users` table) before they can be added to a client.

### Filtering

When listing clients (`GET /api/clients`), only clients the user has access to are returned:

- Global admins see all clients
- Regular users see only:
  - Clients they created
  - Clients where they are in the `client_users` relationship table

## API Endpoints

All HTTP endpoints require authentication (except `/api/health` and public auth endpoints). The authentication method depends on `AUTHENTICATION_METHOD`; see [Authentication](#authentication) above.

**Note**: All endpoints that access a specific client (`/api/clients/:id/*`) now check permissions. Users without access will receive a `403 Forbidden` response.

Base URL: `/api`

### Client Management

- `GET /api/clients` - List all clients (supports `limit` and `offset` query parameters)
- `GET /api/clients/:id` - Get a single client by UUID
- `POST /api/clients` - Create a new client (returns API key if API_KEY authentication type)
- `POST /api/clients/:id` - Update an existing client
- `DELETE /api/clients/:id` - Delete a client

### Proxied Agent Operations

- `GET /api/clients/:id/agents` - List all agents for a client (supports `limit` and `offset` query parameters)
- `GET /api/clients/:id/agents/:agentId` - Get a single agent by UUID
- `GET /api/clients/:id/agents/:agentId/models` - List models for an agent (proxied; same client access rules as get agent)
- `POST /api/clients/:id/agents` - Create a new agent for a client (returns auto-generated password, saves credentials)
- `POST /api/clients/:id/agents/:agentId` - Update an existing agent
- `DELETE /api/clients/:id/agents/:agentId` - Delete an agent (also deletes stored credentials)

**Note**: Agent creation requests are proxied to the remote agent-manager service. SSH repository configuration (including `GIT_PRIVATE_KEY`) must be configured on the agent-manager instance via environment variables, not through the API request. See the [agent-manager documentation](../feature-agent-manager/README.md) for details on SSH repository setup.

### Proxied Agent File Operations

- `GET /api/clients/:id/agents/:agentId/files` - List directory contents (proxied)
- `GET /api/clients/:id/agents/:agentId/files/:path` - Read file content (proxied)
- `POST /api/clients/:id/agents/:agentId/files/:path` - Create file or directory (proxied)
- `PUT /api/clients/:id/agents/:agentId/files/:path` - Write file content (proxied)
- `DELETE /api/clients/:id/agents/:agentId/files/:path` - Delete file or directory (proxied)
- `PATCH /api/clients/:id/agents/:agentId/files/:path` - Move file or directory (proxied)

### Proxied Agent Environment Variables Operations

- `GET /api/clients/:id/agents/:agentId/environment` - List environment variables (proxied, supports `limit` and `offset` query parameters)
- `GET /api/clients/:id/agents/:agentId/environment/count` - Get count of environment variables (proxied)
- `POST /api/clients/:id/agents/:agentId/environment` - Create environment variable (proxied)
- `PUT /api/clients/:id/agents/:agentId/environment/:envVarId` - Update environment variable (proxied)
- `DELETE /api/clients/:id/agents/:agentId/environment/:envVarId` - Delete environment variable (proxied)
- `DELETE /api/clients/:id/agents/:agentId/environment` - Delete all environment variables (proxied)

**Note**: Environment variable changes are automatically synchronized with the Docker container. When an environment variable is created, updated, or deleted, the agent's Docker container environment is automatically updated and the container is restarted to apply the changes.

### Proxied Agent VCS Operations

- `GET /api/clients/:id/agents/:agentId/vcs/status` - Get git status (proxied)
- `GET /api/clients/:id/agents/:agentId/vcs/branches` - List all branches (proxied)
- `GET /api/clients/:id/agents/:agentId/vcs/diff?path={filePath}` - Get file diff (proxied)
- `POST /api/clients/:id/agents/:agentId/vcs/stage` - Stage files (proxied)
- `POST /api/clients/:id/agents/:agentId/vcs/unstage` - Unstage files (proxied)
- `POST /api/clients/:id/agents/:agentId/vcs/commit` - Commit staged changes (proxied)
- `POST /api/clients/:id/agents/:agentId/vcs/push` - Push changes to remote (proxied)
- `POST /api/clients/:id/agents/:agentId/vcs/pull` - Pull changes from remote (proxied)
- `POST /api/clients/:id/agents/:agentId/vcs/fetch` - Fetch changes from remote (proxied)
- `POST /api/clients/:id/agents/:agentId/vcs/rebase` - Rebase current branch (proxied)
- `POST /api/clients/:id/agents/:agentId/vcs/branches/:branch/switch` - Switch to a branch (proxied)
- `POST /api/clients/:id/agents/:agentId/vcs/branches` - Create a new branch (proxied)
- `DELETE /api/clients/:id/agents/:agentId/vcs/branches/:branch` - Delete a branch (proxied)
- `POST /api/clients/:id/agents/:agentId/vcs/conflicts/resolve` - Resolve merge conflicts (proxied)

### Client User Management

- `GET /api/clients/:id/users` - List all users associated with a client
- `POST /api/clients/:id/users` - Add a user to a client by email address
- `DELETE /api/clients/:id/users/:relationshipId` - Remove a user from a client

### Statistics API

REST endpoints for querying chat I/O, filter drops, filter flags, and entity lifecycle events. Access is scoped by client; users see only statistics for clients they can access. See [OpenAPI spec](spec/openapi.yaml) and [statistics-architecture.mmd](docs/statistics-architecture.mmd) for details.

- `GET /api/clients/:id/statistics/summary` - Aggregate statistics for a client
- `GET /api/clients/:id/statistics/chat-io` - Chat I/O records (paginated)
- `GET /api/clients/:id/statistics/filter-drops` - Filter drop incidents (paginated)
- `GET /api/clients/:id/statistics/filter-flags` - Filter flag incidents (paginated, messages flagged but not dropped)
- `GET /api/clients/:id/statistics/entity-events` - Entity lifecycle events (paginated)
- `GET /api/statistics/summary` - Aggregate statistics (all accessible clients or filter by `clientId`)
- `GET /api/statistics/chat-io` - Chat I/O records
- `GET /api/statistics/filter-drops` - Filter drops
- `GET /api/statistics/filter-flags` - Filter flags (messages flagged but not dropped)
- `GET /api/statistics/entity-events` - Entity events

### Server Provisioning

- `GET /api/clients/provisioning/providers` - List available provisioning providers (e.g., Hetzner Cloud, DigitalOcean)
- `GET /api/clients/provisioning/providers/:providerType/server-types` - Get available server types for a provider
- `POST /api/clients/provisioning/provision` - Provision a new server and create a client
- `GET /api/clients/:id/provisioning/info` - Get server information for a provisioned client
- `DELETE /api/clients/:id/provisioning` - Delete a provisioned server and its associated client

#### Provisioning Request

The provisioning endpoint accepts a `ProvisionServerDto` with the following fields:

**Required Fields:**

- `providerType` - Provider identifier (e.g., `"hetzner"`, `"digital-ocean"`)
- `serverType` - Server type identifier (e.g., `"cx11"` for Hetzner, `"s-1vcpu-1gb"` for DigitalOcean)
- `name` - Server name (auto-generated if not provided)
- `authenticationType` - Authentication type (`"api_key"` or `"keycloak"`)

**Optional Fields:**

- `description` - Server description
- `location` - Datacenter location (e.g., `"fsn1"`, `"nbg1"` for Hetzner; `"fra1"`, `"nyc3"` for DigitalOcean)
- `apiKey` - API key for API_KEY authentication (auto-generated if not provided)
- `keycloakClientId` - Keycloak client ID (required for KEYCLOAK authentication)
- `keycloakClientSecret` - Keycloak client secret (required for KEYCLOAK authentication)
- `keycloakRealm` - Keycloak realm (optional, defaults to environment variable)
- `keycloakAuthServerUrl` - Keycloak auth server URL (optional, defaults to environment variable)
- `agentWsPort` - Agent WebSocket port (defaults to 8080)
- `gitRepositorySetupMode` - `clone` (default) or `empty` (git init without remote)
- `gitRepositoryUrl` - Git repository URL for agent workspace (clone mode)
- `gitUsername` - Git username for repository access
- `gitToken` - Git token/personal access token for repository access
- `gitPassword` - Git password for repository access (alternative to token)
- `cursorApiKey` - Cursor API key for agent configuration
- `agentDefaultImage` - Default Docker image for cursor agents (defaults to `ghcr.io/forepath/agenstra-manager-worker:latest`)

#### Provisioning Process

When provisioning a server:

1. **Server Creation**: The provider creates a cloud server instance (e.g., Hetzner Cloud, DigitalOcean)
2. **Docker Installation**: The server automatically installs Docker CE via cloud-init user data script
3. **Database Setup**: PostgreSQL container is started with health checks
4. **Agent-Manager Deployment**: Agent-manager container is deployed with:
   - Authentication configuration (API key or Keycloak)
   - Database connection to PostgreSQL
   - Git repository configuration (if provided)
   - Cursor agent configuration (if provided)
5. **Client Creation**: A client entity is created in the database with the server's endpoint
6. **Reference Storage**: A provisioning reference links the client to the cloud server

#### Supported Providers

- **Hetzner Cloud** (`providerType: "hetzner"`): Requires `HETZNER_API_TOKEN` environment variable
- **DigitalOcean** (`providerType: "digital-ocean"`): Requires `DIGITALOCEAN_API_TOKEN` environment variable

The provisioned server exposes:

- **HTTP API**: Port 3000 (agent-manager REST API)
- **WebSocket**: Port 8080 (agent-manager WebSocket gateway)

#### Environment Variables Interpolation

All configuration values are properly interpolated into the docker-compose.yml file on the provisioned server:

- **Authentication**: `STATIC_API_KEY` or Keycloak variables (`KEYCLOAK_AUTH_SERVER_URL`, `KEYCLOAK_REALM`, `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLIENT_SECRET`)
- **Git Configuration**: `GIT_REPOSITORY_URL`, `GIT_USERNAME`, `GIT_TOKEN`, `GIT_PASSWORD`
- **Cursor Agent**: `CURSOR_API_KEY`, `AGENT_DEFAULT_IMAGE`

Values are securely passed from the frontend through the backend to the user data script, which generates the docker-compose.yml with all environment variables properly set.

### Client Configuration

Client responses include a `config` field that is automatically fetched from the remote agent-manager service. This configuration includes:

- `gitRepositoryUrl` - The Git repository URL configured on the agent-manager instance (if set, clone mode)
- `gitRepositorySetupMode` - Default setup mode for new agents (`clone` or `empty`)
- `agentTypes` - Array of available agent provider types registered on the agent-manager instance (e.g., `['cursor']`, `['cursor', 'opencode']`)

The config field is optional and may be `undefined` if:

- The agent-manager service is unreachable
- The request to fetch config fails
- The agent-manager service doesn't respond within the timeout period

This allows clients to discover which agent types are available on each remote agent-manager instance.

See the [OpenAPI specification](./spec/openapi.yaml) for detailed request/response schemas.

## WebSocket Gateway

### Status notifications (`StatusGateway`)

- **Namespace**: `/status` (`STATUS_WEBSOCKET_NAMESPACE`, default `status`)
- **Port**: same as other controller namespaces (`WEBSOCKET_PORT`, default `8081`)
- **Auth**: handshake `Authorization` (no `setClient`)
- **On connect**: `statusSnapshot` (git dirty + unread per environment for all accessible workspaces)
- **Updates**: `statusPatch`; background poll via `STATUS_POLL_INTERVAL_MS` (default `30000`)
- **Client commands**: `markEnvironmentRead`, `setActiveEnvironment`
- **Diagram**: [agent-console-status-realtime.mmd](./docs/agent-console-status-realtime.mmd)

### Clients proxy (`ClientsGateway`)

The `ClientsGateway` provides WebSocket-based real-time event forwarding to remote agent-manager WebSocket endpoints:

- **Namespace**: `/clients`
- **Port**: `8081` (configurable via `WEBSOCKET_PORT` environment variable)
- **CORS**: Configured for development (adjust for production)

### Events

#### Client → Server

- `setClient` - Set the client context for subsequent operations

  ```typescript
  {
    clientId: string; // Client UUID
  }
  ```

- `forward` - Forward an event to the remote agent-manager WebSocket

  ```typescript
  {
    event: string; // Event name (e.g., "chat", "fileUpdate", "login", "logout")
    payload: unknown; // Event payload
    agentId?: string; // Optional agent UUID for auto-login
  }
  ```

  **Restoring Chat History**: To restore chat history for an agent, forward a "login" event with `agentId`. The `payload` field is optional and ignored - credentials are automatically loaded from the database. This triggers login which causes the agents gateway to restore and emit all chat history as `chatMessage` events:

  ```typescript
  socket.emit('forward', {
    event: 'login',
    agentId: 'agent-uuid',
    // payload is optional and ignored - credentials loaded from database
  });
  ```

  **File Updates**: To notify other clients about file changes, forward a "fileUpdate" event with `agentId`. The payload should contain the file path:

  ```typescript
  socket.emit('forward', {
    event: 'fileUpdate',
    agentId: 'agent-uuid',
    payload: {
      filePath: '/path/to/file.ts',
    },
  });
  ```

  The agent-manager gateway will broadcast a `fileUpdateNotification` event to all clients authenticated to that agent. The notification includes the sender's socket ID, allowing clients to determine if the update came from themselves or another client.

#### Server → Client

- `setClientSuccess` - Emitted when client context is successfully set

  ```typescript
  {
    message: string; // "Client context set"
    clientId: string; // Selected client UUID
  }
  ```

- `forwardAck` - Acknowledgement for forwarded events

  ```typescript
  {
    received: boolean;
    event: string; // Event name that was forwarded
  }
  ```

- `fileUpdateNotification` - File update notification forwarded from agent-manager gateway

  ```typescript
  {
    success: true;
    data: {
      socketId: string; // Socket ID of the client who made the update
      filePath: string; // Path to the file that was updated
      timestamp: string; // ISO timestamp of the update
    }
    timestamp: string; // ISO timestamp
  }
  ```

  This event is automatically forwarded from the remote agent-manager gateway when a file update occurs. Clients can compare `socketId` with their own socket ID to determine if the update came from themselves (no action needed) or another client (show modal if input is dirty).

- `containerStats` - Container statistics forwarded from agent-manager gateway

  ```typescript
  {
    success: true;
    data: {
      stats: {
        read: string; // Timestamp when stats were read
        preread: string; // Previous read timestamp
        pids_stats: object; // Process ID statistics
        blkio_stats: object; // Block I/O statistics
        num_procs: number; // Number of processes
        storage_stats: object; // Storage statistics
        cpu_stats: object; // CPU usage statistics
        precpu_stats: object; // Previous CPU statistics
        memory_stats: object; // Memory usage statistics
        networks: object; // Network statistics
      }
      timestamp: string; // ISO timestamp when stats were collected
    }
    timestamp: string; // ISO timestamp
  }
  ```

  This event is automatically forwarded from the remote agent-manager gateway periodically (default every 15 seconds; `CONTAINER_STATS_SCHEDULER_INTERVAL` on the agent-manager) after successful login. First stats are sent immediately after login, then on that interval while clients remain authenticated.

- `error` - Emitted on errors

  ```typescript
  {
    message: string; // Error message
  }
  ```

- All events from the remote agent-manager WebSocket are forwarded back to the client via `onAny()` handler

See the [AsyncAPI specification](./spec/asyncapi.yaml) for complete event documentation.

### Statistics

The agent-controller collects persistent statistics for analytics and future REST API exposure:

- **Chat I/O** - Word and character counts for user input and agent output (includes **prompt enhancement** via `forward` event `enhanceChat`; rows use `interaction_kind` to distinguish normal chat from enhancement, **ticket body generation**, and **autonomous ticket runs** via `autonomous_ticket_run` / `autonomous_ticket_run_turn`)
- **Filter drops** - Messages dropped by content filters (profanity, PII, etc.) with filter type and direction
- **Entity lifecycle** - Creation, update, and deletion of clients, agents, users, client-user relationships, and provisioning references

Data is stored in shadow tables (`statistics_*`) with no secrets. See [Statistics Model](./docs/statistics-architecture.mmd) for the full design, collection points, and REST API. The [HTTP Statistics Sequence Diagram](./docs/sequence-http-statistics.mmd) shows the request flow for statistics endpoints.

**Prompt enhancement (magic wand)** does not create rows in `agent_messages` or show up as normal chat bubbles; the controller records draft and enhanced text metrics in `statistics_chat_io` with `interaction_kind = prompt_enhancement`. Filter parity with normal chat applies on the agent-manager side.

**Autonomous ticket prototyping** records each background `RemoteAgentsSessionService` turn under `autonomous_ticket_run_turn` (orchestrator-level summaries may use `autonomous_ticket_run` when wired). See `autonomous-ticket-automation.md` and `docs/sequence-autonomous-ticket.mmd`.

### WebSocket Authentication

The gateway authenticates with remote agent-manager services using:

- **API Key**: If client authentication type is `API_KEY`, uses the client's stored API key
- **Keycloak JWT**: If client authentication type is `KEYCLOAK`, fetches and caches a JWT token using OAuth2 Client Credentials flow

When forwarding events with an `agentId`, the gateway automatically logs in the agent using stored credentials (saved when agents are created via proxied HTTP requests).

### Example WebSocket Client

```typescript
import { io } from 'socket.io-client';

const socket = io('http://localhost:8081/clients');

socket.on('connect', () => {
  // Set client context
  socket.emit('setClient', {
    clientId: 'client-uuid',
  });
});

socket.on('setClientSuccess', (data) => {
  console.log(data.message); // "Client context set"

  // Restore chat history for an agent
  socket.emit('forward', {
    event: 'login',
    agentId: 'agent-uuid',
    // payload is optional and ignored - credentials loaded from database
  });

  // After login, chat history will be restored via chatMessage events
  // Then forward a chat event
  socket.emit('forward', {
    event: 'chat',
    payload: { message: 'Hello, world!' },
    agentId: 'agent-uuid', // Optional: triggers auto-login if not already logged in
  });
});

socket.on('forwardAck', (data) => {
  console.log(`Event ${data.event} forwarded`);
});

// Receive forwarded events from remote agent-manager
socket.on('chatMessage', (data) => {
  console.log('Chat message:', data);
});

socket.on('error', (data) => {
  console.error('Error:', data.message);
});
```

## Authentication

Authentication is configured via the `AUTHENTICATION_METHOD` environment variable:

- **`api-key`** (default when `STATIC_API_KEY` is set): Static API key authentication. All requests require `Authorization: Bearer <key>` or `Authorization: ApiKey <key>`. API key auth always grants admin rights.
- **`keycloak`**: Keycloak OAuth2/OIDC. Users authenticate via Keycloak. Keycloak users are synced to the users table; first user gets admin role, subsequent users get user role.
- **`users`**: Built-in user registration with JWT. Users register, confirm email, and log in. First registered user gets admin role. Admins can manage users via CRUD endpoints.

When using `users` auth, set `DISABLE_SIGNUP=true` to disable self-registration. The register endpoint will return 503 Service Unavailable. Use admin user creation for onboarding when signup is disabled.

See [Authentication Diagram](./docs/authentication.mmd) for a visual overview.

### HTTP Endpoints

All HTTP endpoints (except public auth endpoints) require authentication. The method depends on `AUTHENTICATION_METHOD`:

- **api-key**: `Authorization: Bearer <STATIC_API_KEY>` or `Authorization: ApiKey <STATIC_API_KEY>`
- **keycloak**: `Authorization: Bearer <keycloak-jwt-token>`
- **users**: `Authorization: Bearer <jwt-access-token>` (from `POST /api/auth/login`)

### Users Auth Endpoints (when AUTHENTICATION_METHOD=users)

- `POST /api/auth/login` - Login with email/password
- `POST /api/auth/register` - Register new user (6-character alphanumeric confirmation code sent via email for non-first users; returns 503 when DISABLE_SIGNUP=true)
- `POST /api/auth/confirm-email` - Confirm email with 6-character code (requires email + code)
- `POST /api/auth/request-password-reset` - Request password reset (6-character code sent via email)
- `POST /api/auth/reset-password` - Reset password with 6-character code (requires email + code + newPassword)
- `POST /api/auth/change-password` - Change password (authenticated)
- `GET /api/users` - List users (admin only)
- `POST /api/users` - Create user (admin only; non-first users receive confirmation email)
- `GET /api/users/:id` - Get user (admin only)
- `POST /api/users/:id` - Update user (admin only; email change sets account unconfirmed and sends confirmation email)
- `DELETE /api/users/:id` - Delete user (admin only)

### Client Authentication Types

Clients can authenticate with remote agent-manager services using two methods:

#### API Key Authentication

- Set `authenticationType` to `API_KEY` when creating a client
- Provide an `apiKey` (or let the system auto-generate one)
- The API key is used in the `Authorization: Bearer <api-key>` header when proxying requests

#### Keycloak OAuth2 Client Credentials

- Set `authenticationType` to `KEYCLOAK` when creating a client
- Provide `keycloakClientId`, `keycloakClientSecret`, and `keycloakRealm`
- The system fetches a JWT token using OAuth2 Client Credentials flow
- Tokens are cached and automatically refreshed when expired
- The JWT token is used in the `Authorization: Bearer <jwt-token>` header when proxying requests

### WebSocket Gateway

The WebSocket gateway authenticates with remote agent-manager services using the client's configured authentication method (API key or Keycloak JWT). When forwarding events with an `agentId`, the gateway automatically logs in the agent using stored credentials.

## Dependencies

This library requires the following dependencies:

- `@nestjs/typeorm` - TypeORM integration for NestJS
- `typeorm` - TypeORM ORM library
- `class-validator` - Input validation decorators
- `class-transformer` - Object transformation utilities
- `@nestjs/websockets` - WebSocket support for NestJS
- `socket.io` - WebSocket library
- `socket.io-client` - Socket.IO client for connecting to remote agent-manager WebSocket endpoints
- `nest-keycloak-connect` - Keycloak integration for NestJS
- `axios` - HTTP client for proxying requests to remote agent-manager services

## Database Setup

The library uses TypeORM and requires a database connection to be configured in your application:

1. Configure TypeORM connection in your application module
2. Run database migrations to create the `clients` and `client_agent_credentials` tables
3. Ensure the database supports UUID primary keys

The `ClientEntity` includes:

- `id` (UUID, primary key)
- `name` (string, required, unique)
- `description` (string, optional)
- `endpoint` (string, required - URL of remote agent-manager service)
- `authenticationType` (enum: `API_KEY` or `KEYCLOAK`)
- `apiKey` (string, optional - for API_KEY authentication)
- `keycloakClientId` (string, optional - for KEYCLOAK authentication)
- `keycloakClientSecret` (string, optional - for KEYCLOAK authentication)
- `keycloakRealm` (string, optional - for KEYCLOAK authentication)
- `agentWsPort` (integer, optional - WebSocket port for remote agent-manager, defaults to `CLIENTS_REMOTE_WS_PORT` env var or 8080)
- `createdAt` (timestamp)
- `updatedAt` (timestamp)

The `ClientAgentCredentialEntity` includes:

- `id` (UUID, primary key)
- `clientId` (UUID, foreign key to `clients.id`, CASCADE delete)
- `agentId` (UUID - agent UUID from remote agent-manager)
- `password` (string - agent password for WebSocket auto-login)
- `createdAt` (timestamp)
- `updatedAt` (timestamp)
- Unique constraint on `(clientId, agentId)`

## Testing

Run unit tests:

```bash
nx test framework-backend-feature-agent-controller
```

Run tests with coverage:

```bash
nx test framework-backend-feature-agent-controller --coverage
```

## Security Considerations

- **API Key Security**: API keys are auto-generated using cryptographically secure random bytes
- **Sensitive Data**: API keys, Keycloak secrets, and agent passwords are never exposed in standard API responses
- **Input Validation**: All DTOs use class-validator for input validation
- **HTTP Authentication**: All HTTP endpoints are protected by Keycloak
- **WebSocket Authentication**: WebSocket authentication uses client's configured authentication method (API key or Keycloak JWT)
- **Token Caching**: Keycloak tokens are cached with expiration tracking to minimize token requests
- **Credential Storage**: Agent credentials are stored securely in the database for WebSocket auto-login
- **Error Messages**: Generic error messages are used to prevent information disclosure
- **Session Management**: WebSocket sessions are stored in memory and cleaned up on disconnect

## Environment Variables

### Backend API Environment Variables

- `AUTHENTICATION_METHOD` - Authentication method: `api-key`, `keycloak`, or `users` (default: inferred from `STATIC_API_KEY`)
- `STATIC_API_KEY` - Static API key (required when `AUTHENTICATION_METHOD=api-key`)
- `JWT_SECRET` - JWT signing secret (required when `AUTHENTICATION_METHOD=users`)
- `WEBSOCKET_PORT` - Port for WebSocket gateway (default: `8081`)
- `CLIENTS_REMOTE_WS_PORT` - Default WebSocket port for remote agent-manager services (default: `8080`, can be overridden per client via `agentWsPort`)
- `KEYCLOAK_AUTH_SERVER_URL` - Keycloak server URL (required when `AUTHENTICATION_METHOD=keycloak`)
- `KEYCLOAK_REALM` - Keycloak realm (required when `AUTHENTICATION_METHOD=keycloak`)
- `KEYCLOAK_CLIENT_ID` - Keycloak client ID (required when `AUTHENTICATION_METHOD=keycloak`)
- `KEYCLOAK_CLIENT_SECRET` - Keycloak client secret (required when `AUTHENTICATION_METHOD=keycloak`)

### Provisioning Provider Environment Variables

- `HETZNER_API_TOKEN` - Hetzner Cloud API token (required for Hetzner provider)
- `DIGITALOCEAN_API_TOKEN` - DigitalOcean API token (required for DigitalOcean provider)

## License

This library is licensed under the **Business Source License 1.1 (BUSL-1.1)**.

Copyright (c) 2025 IPvX UG (haftungsbeschränkt)

See the [LICENSE](./LICENSE) file for full license text.

**Note**: This component is sublicensed under BUSL-1.1, while the rest of the project remains under the MIT License.
