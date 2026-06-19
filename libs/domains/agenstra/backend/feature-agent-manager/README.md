# agenstra-backend-feature-agent-manager

Agent management feature library for backend applications providing HTTP REST API and WebSocket gateway for managing and interacting with agents.

## Purpose

This library enables the creation, management, and real-time interaction with agents in the system. It provides:

- **HTTP REST API** for CRUD operations on agents (create, read, update, delete)
- **WebSocket Gateway** for real-time bidirectional communication with agents
- **Container Integration** for streaming logs and sending commands to agent containers
- **Secure Authentication** using database-backed credentials with bcrypt password hashing

Agents are entities that can be created, authenticated, and interacted with through both synchronous HTTP requests and persistent WebSocket connections for real-time communication and log streaming.

## Features

- ✅ Auto-generated UUID primary keys
- ✅ Secure password generation and hashing (bcrypt)
- ✅ HTTP REST API with Keycloak authentication
- ✅ WebSocket gateway with database-backed authentication
- ✅ Real-time container log streaming
- ✅ Chat message broadcasting
- ✅ Container command forwarding
- ✅ Support for UUID or name-based agent identification
- ✅ **Plugin-based agent provider system** - Support for multiple agent implementations (cursor-agent, OpenAI, Anthropic, etc.) through a unified interface
- ✅ **Plugin-based chat filter system** - Support for multiple message filtering implementations (profanity, PII, content policy, etc.) through a unified interface
- ✅ **Extensible architecture** - Easy to add new agent providers and chat filters by implementing the respective interfaces

## Architecture

The library follows Domain-Driven Design (DDD) principles with clear separation of concerns:

- **Entities**:
  - `AgentEntity` - Domain model representing an agent
  - `AgentEnvironmentVariableEntity` - Domain model representing an agent environment variable
- **Repositories**:
  - `AgentsRepository` - Data access layer abstracting database operations
  - `AgentEnvironmentVariablesRepository` - Data access layer for agent environment variables
- **Services**:
  - `AgentsService` - Business logic orchestration
  - `PasswordService` - Password hashing and verification
  - `DockerService` - Container log streaming, command execution, and environment variable updates
  - `AgentEnvironmentVariablesService` - Business logic for environment variable management with automatic Docker container synchronization
- **Providers**: Config-driven extension plugins via `AgenstraPluginHostModule` (`@forepath/agenstra/backend/util-plugin-host`)
  - **Agent providers** — `AGENT_PROVIDER_REGISTRY`; default libs `provider-cursor`, `provider-opencode`, `provider-openclaw`
  - **Pipeline providers** — `PIPELINE_PROVIDER_REGISTRY`; default libs `provider-github-pipeline`, `provider-gitlab-pipeline`
  - **Chat filters** — `CHAT_FILTER_REGISTRY`; six default `provider-chat-filter-*` libs
- **DTOs**: Data transfer objects for API boundaries
  - `CreateAgentDto` - Input validation for creating agents (includes optional `agentType`)
  - `UpdateAgentDto` - Input validation for updating agents (includes optional `agentType`)
  - `AgentResponseDto` - Safe API responses (excludes password hash, includes `agentType`)
  - `CreateAgentResponseDto` - Response when creating agent (includes auto-generated password)
  - `CreateEnvironmentVariableDto` - Input validation for creating environment variables
  - `UpdateEnvironmentVariableDto` - Input validation for updating environment variables
  - `EnvironmentVariableResponseDto` - Safe API responses for environment variables
- **Controllers**:
  - `AgentsController` - HTTP endpoints for agent management (protected by Keycloak)
  - `AgentsEnvironmentVariablesController` - HTTP endpoints for environment variable management (protected by Keycloak)
- **Gateways**: `AgentsGateway` - WebSocket gateway for agent chat with database-backed authentication
- **Modules**: `AgentsModule` - NestJS module wiring all dependencies

## Documentation

### API Specifications

- **[OpenAPI 3.1 Specification](./spec/openapi.yaml)** - Complete HTTP REST API specification with request/response schemas, authentication requirements, and endpoint documentation
- **[AsyncAPI 3.0.0 Specification](./spec/asyncapi.yaml)** - WebSocket gateway specification with event definitions, message schemas, and channel documentation

### Visual Diagrams

All diagrams are available in the [`docs/`](./docs/) directory:

- **[Overview Diagram](./docs/overview.mmd)** - High-level flowchart showing when to use HTTP vs WebSocket protocols and their respective use cases
- **[HTTP Sequence Diagram](./docs/sequence-http.mmd)** - Detailed sequence diagram for all HTTP CRUD operations (create, list, get, update, delete)
- **[HTTP Environment Variables Sequence Diagram](./docs/sequence-http-environment.mmd)** - Detailed sequence diagram for environment variable operations (create, list, get, update, delete)
- **[HTTP VCS Sequence Diagram](./docs/sequence-http-vcs.mmd)** - Detailed sequence diagram for all VCS (Git) operations (status, branches, diff, stage, commit, push, pull, workspace prepare-clean, etc.)
- **[HTTP Automation Verification Sequence Diagram](./docs/sequence-http-automation-verify.mmd)** - Sequence diagram for `POST .../automation/verify-commands` (bounded shell in the agent container)
- **[WebSocket Auth & Logs Diagram](./docs/sequence-ws-auth-logs.mmd)** - Sequence diagram for WebSocket connection, authentication flow, and container log streaming
- **[WebSocket Chat Diagram](./docs/sequence-ws-chat.mmd)** - Sequence diagram for WebSocket chat message flow and disconnection handling
- **[WebSocket Container Stats Diagram](./docs/sequence-ws-container-stats.mmd)** - Periodic `containerStats` broadcasting after login (default interval 15s via `CONTAINER_STATS_SCHEDULER_INTERVAL`)
- **[Lifecycle Diagram](./docs/lifecycle.mmd)** - End-to-end sequence diagram showing the complete agent lifecycle from creation through deletion

These diagrams provide comprehensive visual documentation of:

- Component interactions and data flow
- Error handling and edge cases
- Authentication and authorization flows
- Real-time communication patterns

## Usage

### Import the Module

```typescript
import { AgentsModule } from '@forepath/agenstra/backend';

@Module({
  imports: [AgentsModule],
})
export class AppModule {}
```

### Use the Service

```typescript
import { AgentsService } from '@forepath/agenstra/backend';

@Injectable()
export class MyService {
  constructor(private readonly agentsService: AgentsService) {}

  async createAgent(name: string) {
    const result = await this.agentsService.create({
      name,
      description: 'My agent',
    });
    // result.password contains the auto-generated password
    return result;
  }
}
```

## API Endpoints

All HTTP endpoints require authentication. The authentication method depends on the `STATIC_API_KEY` environment variable:

- If `STATIC_API_KEY` is set: API key authentication (use `Bearer <static-api-key>` or `ApiKey <static-api-key>` in the `Authorization` header)
- If `STATIC_API_KEY` is not set: Keycloak authentication (use `Bearer <keycloak-jwt-token>` in the `Authorization` header)
  - ⚠️ **Note**: The JWT token must include the `agent_management` role to access agent-manager endpoints

Base URL: `/api/agents`

- `GET /api/agents` - List all agents (supports `limit` and `offset` query parameters)
- `GET /api/agents/:id` - Get a single agent by UUID
- `GET /api/agents/:id/models` - List models available for the agent (provider-specific; same HTTP auth as other agent APIs)
- `POST /api/agents` - Create a new agent (returns auto-generated password)
- `POST /api/agents/:id` - Update an existing agent
- `DELETE /api/agents/:id` - Delete an agent

Base URL: `/api/config`

- `GET /api/config` - Get configuration parameters including Git repository URL and available agent types with display names

Base URL: `/api/agents/:agentId/environment`

- `GET /api/agents/:agentId/environment` - List environment variables (supports `limit` and `offset` query parameters, default: limit=50, offset=0)
- `GET /api/agents/:agentId/environment/count` - Get count of environment variables
- `POST /api/agents/:agentId/environment` - Create environment variable (returns 201 Created)
- `PUT /api/agents/:agentId/environment/:id` - Update environment variable
- `DELETE /api/agents/:agentId/environment/:id` - Delete environment variable
- `DELETE /api/agents/:agentId/environment` - Delete all environment variables

**Note**: Environment variable changes are automatically synchronized with the Docker container. When an environment variable is created, updated, or deleted, the agent's Docker container environment is automatically updated and the container is restarted to apply the changes. This ensures that the container always has the latest environment variables configured.

Base URL: `/api/agents/:agentId/vcs`

- `GET /api/agents/:agentId/vcs/status` - Get git status (current branch, file changes, unpushed commits)
- `GET /api/agents/:agentId/vcs/branches` - List all branches (local and remote)
- `GET /api/agents/:agentId/vcs/diff?path={filePath}` - Get file diff
- `POST /api/agents/:agentId/vcs/stage` - Stage files (empty array stages all)
- `POST /api/agents/:agentId/vcs/unstage` - Unstage files (empty array unstages all)
- `POST /api/agents/:agentId/vcs/commit` - Commit staged changes
- `POST /api/agents/:agentId/vcs/push` - Push changes to remote (optional body `{ force: boolean }` enables `--force-with-lease`)
- `POST /api/agents/:agentId/vcs/pull` - Pull changes from remote
- `POST /api/agents/:agentId/vcs/fetch` - Fetch changes from remote
- `POST /api/agents/:agentId/vcs/rebase` - Rebase current branch onto another branch
- `POST /api/agents/:agentId/vcs/branches/:branch/switch` - Switch to a different branch
- `POST /api/agents/:agentId/vcs/branches` - Create a new branch (with conventional commit prefix support)
- `DELETE /api/agents/:agentId/vcs/branches/:branch` - Delete a branch
- `POST /api/agents/:agentId/vcs/conflicts/resolve` - Resolve merge conflicts (yours/mine/both strategies)

See the [OpenAPI specification](./spec/openapi.yaml) for detailed request/response schemas.

## WebSocket Gateway

The `AgentsGateway` provides WebSocket-based real-time communication with database-backed authentication:

- **Namespace**: `/agents`
- **Port**: `8080` (configurable via `WEBSOCKET_PORT` environment variable)
- **Container stats interval**: `CONTAINER_STATS_SCHEDULER_INTERVAL` in milliseconds (default `15000`); first `containerStats` after login is immediate, then periodic while clients stay authenticated
- **CORS**: Configured for development (adjust for production)

### Events

#### Client → Server

- `login` - Authenticate with agent ID (UUID or name) and password

  ```typescript
  {
    agentId: string; // UUID or agent name
    password: string;
  }
  ```

- `chat` - Send chat message (requires authentication)
  ```typescript
  {
    message: string;
  }
  ```

#### Server → Client

- `loginSuccess` - Emitted on successful authentication

  ```typescript
  {
    message: string; // "Welcome, {agentName}!"
  }
  ```

- `loginError` - Emitted on authentication failure

  ```typescript
  {
    message: string; // "Invalid credentials"
  }
  ```

- `chatMessage` - Broadcasted to all connected clients when a chat message is sent

  ```typescript
  // User message
  {
    from: 'user';
    text: string; // Message text
    timestamp: string; // ISO timestamp
  }

  // Agent message
  {
    from: 'agent';
    response: AgentResponseObject | string; // Parsed JSON response object or raw string if parsing fails
    timestamp: string; // ISO timestamp
  }

  // AgentResponseObject structure:
  {
    type: string;
    subtype?: string;
    is_error?: boolean;
    duration_ms?: number;
    duration_api_ms?: number;
    result?: string;
    session_id?: string;
    request_id?: string;
  }

  // Dropped message response (when message is dropped by filter)
  {
    from: 'agent';
    response: {
      type: 'error';
      is_error: true;
      result: 'MESSAGE_DROPPED';
      message: string; // Filter reason
    };
    timestamp: string; // ISO timestamp
  }
  ```

- `messageFilterResult` - Broadcasted to all connected clients after applying filters to a message

  ```typescript
  {
    success: true;
    data: {
      direction: 'incoming' | 'outgoing';
      status: 'allowed' | 'filtered' | 'dropped';
      message: string; // Original message
      modifiedMessage?: string; // Modified message (if filter modified it)
      appliedFilters: Array<{
        type: string;
        displayName: string;
        matched: boolean;
        reason?: string;
      }>;
      matchedFilter?: {
        type: string;
        displayName: string;
        matched: boolean;
        reason?: string;
      };
      action?: 'drop' | 'flag'; // Only present if filtered
      timestamp: string; // ISO timestamp
    };
    timestamp: string; // ISO timestamp
  }
  ```

- `error` - Emitted on authorization or processing errors
  ```typescript
  {
    message: string;
  }
  ```

See the [AsyncAPI specification](./spec/asyncapi.yaml) for complete event documentation.

### WebSocket Authentication

Agents authenticate using their UUID or name along with their password. The gateway:

- Supports both UUID and agent name for login (tries UUID first, falls back to name)
- Stores authenticated sessions using agent UUIDs mapped to socket IDs
- Validates credentials against the database using bcrypt password verification
- Broadcasts chat messages with actor type (agent/user) to all connected clients
- Forwards chat messages to container stdin for command execution and captures responses

### Example WebSocket Client

```typescript
import { io } from 'socket.io-client';

const socket = io('http://localhost:8080/agents');

socket.on('connect', () => {
  // Login with agent ID (UUID or name) and password
  socket.emit('login', {
    agentId: 'agent-uuid-or-name',
    password: 'agent-password',
  });
});

socket.on('loginSuccess', (data) => {
  console.log(data.message); // "Welcome, Agent Name!"
});

socket.on('loginError', (data) => {
  console.error(data.message); // "Invalid credentials"
});

// Send chat message after authentication
socket.emit('chat', {
  message: 'Hello, world!',
});

socket.on('chatMessage', (data) => {
  console.log(`${data.from}: ${data.text}`); // "user: Hello, world!" or "agent: <response>"
});

socket.on('error', (data) => {
  console.error('Error:', data.message);
});
```

## Authentication

### HTTP Endpoints

HTTP endpoints support two authentication methods, determined by the `STATIC_API_KEY` environment variable:

#### Static API Key Authentication (when `STATIC_API_KEY` is set)

When `STATIC_API_KEY` is configured, all HTTP endpoints use API key authentication only (no Keycloak fallback, no anonymous access). Clients must include the static API key in the `Authorization` header using either format:

```
Authorization: Bearer <static-api-key>
```

or

```
Authorization: ApiKey <static-api-key>
```

#### Keycloak Authentication (when `STATIC_API_KEY` is not set)

When `STATIC_API_KEY` is not set, all HTTP endpoints are protected by Keycloak authentication. The `AgentsController` uses:

- Global Keycloak guards (`AuthGuard`, `ResourceGuard`, `RoleGuard`)

Clients must include a valid Keycloak JWT bearer token in the `Authorization` header:

```
Authorization: Bearer <keycloak-jwt-token>
```

⚠️ **Note**: The JWT token must include the `agent_management` role to access agent-manager endpoints.

### WebSocket Gateway

The WebSocket gateway uses database-backed authentication:

- Agents authenticate using their UUID or name with password
- Credentials are validated against the database
- Sessions are stored in memory (socket.id → agent UUID mapping)
- Authentication is required before sending chat messages or receiving logs

## Dependencies

This library requires the following dependencies:

- `@nestjs/typeorm` - TypeORM integration for NestJS
- `typeorm` - TypeORM ORM library
- `bcrypt` - Password hashing library
- `@types/bcrypt` - TypeScript types for bcrypt
- `class-validator` - Input validation decorators
- `class-transformer` - Object transformation utilities
- `@nestjs/websockets` - WebSocket support for NestJS
- `socket.io` - WebSocket library
- `nest-keycloak-connect` - Keycloak integration for NestJS

## Database Setup

The library uses TypeORM and requires a database connection to be configured in your application:

1. Configure TypeORM connection in your application module
2. Run database migrations to create the `agents` and `agent_environment_variables` tables
3. Ensure the database supports UUID primary keys

The `AgentEntity` includes:

- `id` (UUID, primary key)
- `name` (string, required)
- `description` (string, optional)
- `hashedPassword` (string, bcrypt hash)
- `containerId` (string, optional - Docker container ID for agent container)
- `volumePath` (string, optional - Host path to agent volume where git repository is cloned)
- `agentType` (string, default: 'cursor' - Type identifier for the agent provider plugin)
- `createdAt` (timestamp)
- `updatedAt` (timestamp)

The `AgentEnvironmentVariableEntity` includes:

- `id` (UUID, primary key)
- `agentId` (UUID, foreign key to `agents.id`, CASCADE delete)
- `variable` (string, required - Environment variable name)
- `content` (string, optional - Environment variable content/value)
- `createdAt` (timestamp)
- `updatedAt` (timestamp)

### Agent Provider Plugin System

The library uses a plugin-based architecture to support multiple agent implementations. Each agent has an `agentType` field that determines which provider implementation is used for communication.

#### Available Providers

- **cursor** (default) - Cursor-agent binary running in Docker containers

#### Adding New Providers

To add a new agent provider:

1. Implement the `AgentProvider` interface:

   ```typescript
   import { AgentProvider, AgentProviderOptions } from './providers/agent-provider.interface';

   @Injectable()
   export class MyAgentProvider implements AgentProvider {
     getType(): string {
       return 'my-agent';
     }

     getDisplayName(): string {
       return 'My Agent Provider';
     }

     getDockerImage(): string {
       // Return the Docker image (including tag) for this provider
       return process.env.MY_AGENT_DOCKER_IMAGE || 'my-registry/my-agent:latest';
     }

     getBasePath(): string {
       // Return the base path for file system operations (defaults to '/app' if not implemented)
       // This path is used by AgentFileSystemService for all file operations
       return '/custom/path'; // or '/app' for default behavior
     }

     async sendMessage(agentId: string, containerId: string, message: string, options?: AgentProviderOptions): Promise<string> {
       // Implementation
     }

     async sendInitialization(agentId: string, containerId: string, options?: AgentProviderOptions): Promise<void> {
       // Implementation
     }
   }
   ```

2. Scaffold and register the provider:

   ```bash
   nx generate @forepath/code:provider agenstra my-agent agent-provider --description="My agent provider"
   ```

   Move your implementation into the generated `provider-my-agent` lib. Add the import path to `AGENSTRA_AGENT_PROVIDER_EXTENSIONS` (or rely on defaults in `AgentsModule`):

   ```bash
   AGENSTRA_AGENT_PROVIDER_EXTENSIONS=@forepath/agenstra/backend/provider-cursor,...,@forepath/agenstra/backend/provider-my-agent
   ```

   For external npm packages, add the dependency to the app `package.json` and use an `npm:` specifier. Webpack externals are applied automatically via `util-extension-core`.

3. Update the DTO validation to include the new type:

   ```typescript
   @IsIn(['cursor', 'my-agent'], { message: 'Agent type must be one of: cursor, my-agent' })
   agentType?: string;
   ```

4. Create a database migration if needed (the `agentType` field already exists in the schema)

### Chat Filter Plugin System

The library uses a plugin-based architecture to support multiple message filtering implementations. Filters can be applied to incoming messages (from user to agent), outgoing messages (from agent to user), or both (bidirectional).

#### Filter Directions

- **INCOMING** - Filters apply only to incoming messages (from user to agent)
- **OUTGOING** - Filters apply only to outgoing messages (from agent to user)
- **BIDIRECTIONAL** - Filters apply to both incoming and outgoing messages

#### Filter Actions

When a filter matches a message, it can take one of two actions:

- **drop** - Do not process the message further. A fake agent response with `MESSAGE_DROPPED` error code is created, persisted, and broadcast instead. Message modification is not allowed when action is `drop`.
- **flag** - Process the message normally but mark it as filtered in the database. Filters can optionally modify the message content by returning a `modifiedMessage` in the filter result. If provided, the modified message will be used instead of the original for all subsequent processing (persistence, broadcasting, and forwarding to the agent).

#### Available Filters

- **noop** - No-op filter that never filters messages (useful for testing)
- **incoming-example** - Example incoming-only filter (filters messages containing "test-filter")
- **outgoing-example** - Example outgoing-only filter (filters messages containing "test-filter")
- **bidirectional-example** - Example bidirectional filter (filters messages containing "test-filter")

#### Filter Result Messages

After applying filters, the system automatically sends filter result messages through the `chatMessage` event. These messages contain:

- `type: "filter-result"` - Identifies the message as a filter result
- `direction: "incoming" | "outgoing"` - Filter direction
- `status: "allowed" | "filtered" | "dropped"` - Final filter status
- `message` - Original message that was filtered
- `appliedFilters` - List of all filters that were applied with their results
- `matchedFilter` - The filter that matched (if any)
- `action` - Action to take (only present if filtered)
- `timestamp` - When filters were applied

#### Adding New Filters

To add a new chat filter:

1. Implement the `ChatFilter` interface:

   ```typescript
   import { ChatFilter, FilterContext, FilterDirection, FilterResult } from './providers/chat-filter.interface';

   @Injectable()
   export class MyChatFilter implements ChatFilter {
     getType(): string {
       return 'my-filter';
     }

     getDisplayName(): string {
       return 'My Filter';
     }

     getDirection(): FilterDirection {
       return FilterDirection.BIDIRECTIONAL; // or INCOMING, OUTGOING
     }

     async filter(message: string, context?: FilterContext): Promise<FilterResult> {
       // Your filtering logic here
       if (/* message should be filtered */) {
         return {
           filtered: true,
           action: 'flag', // or 'drop' to prevent processing
           reason: 'Reason for filtering',
           // Optional: modify the message content
           // modifiedMessage: message.replace(/badword/gi, '***'),
         };
       }

       return {
         filtered: false,
       };
     }
   }
   ```

2. Scaffold and register the filter:

   ```bash
   nx generate @forepath/code:provider agenstra my-filter chat-filter --description="My chat filter"
   ```

   Implement `ChatFilter` in the generated lib and add `@forepath/agenstra/backend/provider-my-filter` to `AGENSTRA_CHAT_FILTER_EXTENSIONS` (or extend `defaultExtensions` in `AgentsModule`).

3. The filter will automatically be applied to messages based on its direction:
   - Incoming filters are applied before broadcasting and persisting user messages
   - Outgoing filters are applied before broadcasting and persisting agent responses
   - Bidirectional filters are applied to both directions

#### Filter Application Flow

1. **Incoming Messages** (user → agent):
   - Filters are applied before broadcasting the user message
   - Filter result is broadcast via `messageFilterResult` event (not persisted)
   - If filter action is `drop`:
     - A fake agent response is created with `type: "error"`, `is_error: true`, `result: "MESSAGE_DROPPED"`
     - The fake response is persisted and broadcast as a normal agent response
     - Processing stops (no actual agent call is made)
   - If filter action is `flag`:
     - Message is processed but marked as filtered
     - If filter provided `modifiedMessage`, the modified message is used instead of the original
     - Modified message (or original if not modified) is persisted with `filtered` flag
     - Modified message (or original if not modified) is forwarded to the agent
   - User message is persisted with `filtered` flag if applicable

2. **Outgoing Messages** (agent → user):
   - Filters are applied after receiving agent response
   - Filter result is broadcast via `messageFilterResult` event (not persisted)
   - If filter action is `drop`:
     - A fake agent response is created with `type: "error"`, `is_error: true`, `result: "MESSAGE_DROPPED"`
     - The fake response replaces the original agent response
     - The fake response is persisted and broadcast as a normal agent response
   - If filter action is `flag`:
     - Message is processed but marked as filtered
     - If filter provided `modifiedMessage`, the modified message is used instead of the original
     - Modified message (or original if not modified) is persisted with `filtered` flag
     - Modified message (or original if not modified) is broadcast to clients
   - Agent message is persisted with `filtered` flag if applicable

## Testing

Run unit tests:

```bash
nx test agenstra-backend-feature-agent-manager
```

Run tests with coverage:

```bash
nx test agenstra-backend-feature-agent-manager --coverage
```

## Security Considerations

- **Password Security**: Passwords are hashed using bcrypt with 10 salt rounds
- **API Security**: Password hashes are never exposed in API responses
- **Input Validation**: All DTOs use class-validator for input validation
- **HTTP Authentication**: All HTTP endpoints are protected by Keycloak
- **WebSocket Authentication**: WebSocket authentication validates credentials against the database
- **Error Messages**: Generic error messages are used to prevent information disclosure
- **Session Management**: WebSocket sessions are stored in memory and cleaned up on disconnect
- **Container credentials**: Git HTTPS (`.netrc`) and SSH keys are written under the worker container’s **`$HOME`** (resolved via `DockerService.getContainerHomeDirectory`), not as root. On current worker images that is typically **`/home/agenstra`**. Shell paths are quoted and permissions are set with `chmod` before use.
- **VNC context volume**: Browser workspace context is mounted at **`/home/agenstra/environment`** in the VNC image; deploy manager API and VNC images together when upgrading paths.

## Environment Variables

### Backend API Environment Variables

- `WEBSOCKET_PORT` - Port for WebSocket gateway (default: `8080`)
- `KEYCLOAK_AUTH_SERVER_URL` - Keycloak server URL (required for HTTP authentication when `STATIC_API_KEY` is not set)
- `KEYCLOAK_REALM` - Keycloak realm (required for HTTP authentication when `STATIC_API_KEY` is not set)
- `KEYCLOAK_CLIENT_ID` - Keycloak client ID (required for HTTP authentication when `STATIC_API_KEY` is not set)
- `KEYCLOAK_CLIENT_SECRET` - Keycloak client secret (required for HTTP authentication when `STATIC_API_KEY` is not set)
- `STATIC_API_KEY` - Static API key for HTTP authentication (optional). If set, the API uses API key authentication only (no Keycloak fallback, no anonymous access). If not set, Keycloak authentication is used. The API key can be provided in the `Authorization` header using either `Bearer <key>` or `ApiKey <key>` format.
- `CURSOR_API_KEY` - Cursor API key for agent communication (required for agent containers)
- `CURSOR_AGENT_DOCKER_IMAGE` - Docker image (including tag) for cursor-agent containers (optional, defaults to `ghcr.io/forepath/agenstra-manager-worker:latest`)
- `GIT_AUTHOR_NAME` - Git commit author name (optional, defaults to 'Agenstra')
- `GIT_AUTHOR_EMAIL` - Git commit author email (optional, defaults to 'noreply@agenstra.com')

### Git Repository Environment Variables

When creating agents, the workspace Git repository is initialized in one of two modes (see `gitRepositorySetupMode` on `CreateAgentDto` or `GIT_REPOSITORY_SETUP_MODE`):

- **`clone` (default)** — clone a remote repository (requires URL and credentials below).
- **`empty`** — run `git init` in the provider workspace path with no remote attached.

Per-agent `gitRepositorySetupMode` on `CreateAgentDto` overrides the instance default (`GIT_REPOSITORY_SETUP_MODE`). If the field is omitted, the instance default applies (for example, a workspace provisioned or configured with `empty`).

- `GIT_REPOSITORY_SETUP_MODE` - Optional instance default: `clone` or `empty` (defaults to `clone` when unset)
- `GIT_REPOSITORY_URL` - HTTPS or SSH URL of the git repository to clone (required for clone mode unless provided per agent)
- `GIT_USERNAME` - Git username for authentication (**required for HTTPS URLs**)
- `GIT_TOKEN` - Git personal access token for authentication (preferred for HTTPS, or use `GIT_PASSWORD`)
- `GIT_PASSWORD` - Git password or token (alternative to `GIT_TOKEN` for HTTPS)
- `GIT_PRIVATE_KEY` - SSH private key for authentication (**required for SSH URLs**). Must be in PEM or OpenSSH format without a passphrase.

**HTTPS repositories**

1. Create a Docker container with `GIT_REPOSITORY_URL`, `GIT_USERNAME`, and `GIT_TOKEN` (or `GIT_PASSWORD`) environment variables
2. Create a `.netrc` file under the worker’s `$HOME` (typically `/home/agenstra/.netrc`) for git authentication
3. Clone the repository directly into the container's base path directory (defaults to `/app`, configurable via provider's `getBasePath()` method)

**SSH repositories**

1. Set the `GIT_PRIVATE_KEY` environment variable with a valid SSH private key (PEM or OpenSSH format, no passphrase)
2. The service detects the key type (RSA, Ed25519, ECDSA, etc.) and writes the key under **`$HOME/.ssh/`** in the worker container (e.g., `id_rsa`, `id_ed25519`, `id_ecdsa` — typically `/home/agenstra/.ssh/` on current images) and bootstraps `known_hosts` using `ssh-keyscan`
3. If `GIT_PRIVATE_KEY` is not set or invalid, agent creation will fail with a `BadRequestException`
4. The SSH private key must be registered with your git provider (GitHub, GitLab, etc.) as a deploy key or user SSH key

## License

This library is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**.

Copyright (c) 2025 IPvX UG (haftungsbeschränkt)

This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the [GNU Affero General Public License](https://www.gnu.org/licenses/agpl-3.0.html) for more details.

You should have received a copy of the GNU Affero General Public License along with this program. If not, see <https://www.gnu.org/licenses/>.

**Note**: This component is sublicensed under AGPL-3.0, while the rest of the project remains under the MIT License. This means that any modifications or derivative works of this library must also be licensed under AGPL-3.0 and made available to users, including when accessed over a network.
