# Frontend Agent Console

Angular web application providing a web-based IDE and chat interface for interacting with AI agents.

## Purpose

This application provides a comprehensive user interface for managing clients, agents, tickets, deployments, and filter policies, and for interacting with AI agents in real time. It includes a Monaco Editor-based code editor, chat interface, file management, and Git operations. All workspace-scoped traffic goes to the **agent controller** API and WebSockets; the console does not talk directly to agent-manager instances.

## Features

This application provides:

- **Chat Interface** - Real-time bidirectional communication with AI agents via WebSocket
- **Monaco Editor** - Integrated code editor with syntax highlighting and code completion
- **File Management** - Browse, read, write, create, and delete files in agent containers
- **Version Control** - Full Git operations (status, branches, commit, push, pull, rebase)
- **Container Statistics** - Real-time container resource monitoring (CPU, memory, network)
- **Client Management** - Create, update, and delete clients (remote agent-manager instances)
- **Agent Management** - Create, update, delete, start, stop, and restart agents; environment variables; models list
- **Tickets** - Workspace ticket board with comments, activity, migration, and automation runs ([Tickets and Workspaces](../features/tickets-and-workspaces.md))
- **Deployments** - CI/CD configuration and runs per agent ([Deployment](../features/deployment.md))
- **Usage statistics** - Controller-backed analytics slices for operators ([Usage Statistics](../features/usage-statistics.md))
- **Message filter rules** - Global admin rule manager ([Message Filter Rules](../features/message-filter-rules.md))
- **Atlassian import** - Admin UI for Atlassian site connections and Jira/Confluence import configs ([Atlassian import](../features/atlassian-import.md))
- **Agent autonomy** - Configure which agents may run autonomously per workspace
- **Server Provisioning** - Provision cloud servers (Hetzner, DigitalOcean) with automated deployment
- **Audit** - Audit views for administrators (`/audit`)
- **State Management** - NgRx for predictable state management
- **Authentication** - Keycloak or built-in users (JWT) via `@forepath/identity/frontend`, depending on deployment configuration

## Architecture

This application is built using:

- **Angular** - Frontend framework
- **NgRx** - State management (Actions, Reducers, Effects, Selectors, Facades)
- **Monaco Editor** - Code editor (VS Code editor in the browser)
- **Socket.IO Client** - WebSocket communication
- **Bootstrap** - UI framework
- **RxJS** - Reactive programming

The application integrates:

- `@forepath/agenstra/frontend/feature-agent-console` - Feature components
- `@forepath/agenstra/frontend/data-access-agent-console` - State management and data access

## State Management (NgRx)

The application uses NgRx for state management with the following state slices:

### Clients State

- Client list and selected client
- Client loading states
- Client operations (create, update, delete)

### Agents State

- Agent list and selected agent
- Agent loading states
- Agent operations (create, update, delete)

### Sockets State

- WebSocket connection status
- Client context
- Forwarded events (chat messages, etc.)
- Reconnection handling

### Files State

- File system tree
- Current file content
- File operations (read, write, create, delete, move)

### VCS State

- Git status
- Branches list
- File diffs
- VCS operations (stage, commit, push, pull)

### Environment state (`env`)

- Environment variables for the selected agent
- Batch load and count helpers

### Deployments state (`deployments`)

- Deployment configuration, repositories, branches, workflows
- Runs, logs, job logs, cancel operations

### Tickets state (`tickets`, `ticketAutomation`)

- Ticket lists and detail, comments, automation configuration and runs

### Client agent autonomy state (`clientAgentAutonomy`)

- Enabled agent ids and per-agent autonomy payloads for the active workspace

### Usage statistics state (`statistics`)

- Summary, chat I/O, filter drops/flags, and entity events (controller API)

### Filter rules state (`filterRules`)

- Global filter rules for administrators

### Atlassian context import state (`atlassianContextImport`)

- Site connections and import configurations for administrators (loads when the agent-console feature routes are active)

### Tickets board socket state (`ticketsBoardSocket`)

- Connection lifecycle for the controller **`tickets`** Socket.IO namespace

### Authentication State

- Authentication status
- User information
- Token management (from identity frontend bundle)

### Stats State

- Container statistics (CPU, memory, network)
- Real-time updates

## Routing

Routes are defined in the framework library `libs/domains/agenstra/frontend/feature-agent-console/src/lib/agent-console.routes.ts`. Highlights:

- ``(empty) → redirect to`clients`
- **Identity** – `identityAuthRoutes` (login, register, password reset, email confirmation, user management) merged under the shell component
- `/audit` – Audit (authenticated)
- `/filters` – Global message filter rules (**admin** guard)
- `/imports/atlassian` – Atlassian site connections and import configurations (**admin** guard; sidebar with Users/Filters)
- `/tickets`, `/tickets/:clientId` – Ticket board (**authenticated**; requires active client context)
- `/clients` – Default **Manager** view: client and agent chat shell
  - `/clients` – Landing list
  - `/clients/:clientId` – Workspace selected
  - `/clients/:clientId/agents/:agentId` – Agent chat
  - `/clients/:clientId/agents/:agentId/editor` – Editor layout for the same shell
  - `/clients/:clientId/agents/:agentId/config` – Agent configuration editor (guarded)
  - `/clients/:clientId/agents/:agentId/deployments` – Deployments UI for the agent
- `**` → redirect to `clients`

## Components

### AgentConsoleContainerComponent

Main container component that provides the layout and routing structure.

### AgentConsoleChatComponent

Main workspace shell: chat, file tree, Git, environment variables, deployments entry, statistics, and modals for client and agent management.

### TicketsBoardComponent

Ticket board and detail experience for the active workspace (`/tickets`).

### RuleManagerComponent

Administrative UI for global regex filter rules (`/filters`).

### AtlassianImportAdminComponent

Administrative UI for Atlassian site connections and import configurations (`/imports/atlassian`).

### AuditComponent

Administrative audit views (`/audit`).

### FileEditorComponent

Monaco Editor integration for code editing with:

- Syntax highlighting
- Code completion
- File system browser
- Save functionality

### FileEditorComponent

Monaco Editor integration for code editing with:

- Syntax highlighting
- Code completion
- File system browser
- Save functionality

## WebSocket Communication

The application opens **two** Socket.IO connections to the controller **`WEBSOCKET_URL`** when needed:

1. **`clients` namespace** – Same port as today’s `WEBSOCKET_URL`; `setClient` selects the workspace, then `forward` sends agent-manager events (chat, login, terminals, etc.). Manager responses arrive as their native event names on this socket.
2. **`tickets` namespace** – Optional second connection for ticket board realtime (`setClient` per workspace, then ticket and automation events). Chat-centric UIs may rely on controller events on `clients` instead; see [WebSocket Communication](../features/websocket-communication.md).

Reconnection flows restore client context, agent login when applicable, and tickets board context.

### Reconnection Handling

On reconnection:

1. Automatically reconnects to the WebSocket(s)
2. Restores client context (`setClient`)
3. Restores agent login (if previously logged in)
4. Clears stale local buffers where required to avoid duplicates
5. Receives chat history and ticket automation cards from the backend as implemented in NgRx effects

## Authentication

Behavior depends on controller configuration:

- **Keycloak** – Authorization code flow, tokens attached to HTTP and WebSocket handshakes, refresh handled by the identity frontend layer.
- **Users (JWT)** – Email/password login and registration routes from `identityAuthRoutes`; tokens are stored and sent as `Bearer` on HTTP and on WebSocket handshakes.

See [Authentication](../features/authentication.md) for environment variables and operational notes.

## Environment Configuration

Configure the application via environment variables. The **Express** runtime (`/config` proxy, CSP, and related variables) is shared with **frontend-billing-console**, **frontend-portal**, and **frontend-docs**; see [Environment configuration](../deployment/environment-configuration.md) for the full list and billing-manager provisioning defaults.

### Runtime Configuration (Docker Containers)

- `CONFIG` - URL to a remote JSON configuration file that will be loaded at runtime and merged with build-time defaults (optional)
  - If set, the application will fetch this configuration during initialization via `/config` endpoint
  - The remote configuration takes precedence over build-time defaults
  - If not set or fetch fails, the application falls back to build-time defaults
  - Example: `CONFIG=https://config.example.com/agenstra-config.json`
  - For users auth with signup disabled, include `authentication: { type: "users", disableSignup: true }` to hide the "Create an account" link and redirect direct /register navigation to login

#### Runtime config proxy hardening (`/config`)

When `CONFIG` is set, the frontend server fetches and validates the remote JSON with additional controls (SSRF/DNS rebinding defense, size limits, caching policy).

- `CONFIG_ALLOWED_HOSTS` - Comma-separated hostname allowlist for `CONFIG`
  - Production: **Required** when `CONFIG` is set
  - If unset/empty outside production, **all hosts are allowed** (legacy behavior; not recommended)
  - Set to `*` to allow any host (not recommended)
- `CONFIG_ALLOW_INSECURE_HTTP` - When `true`, allows `http://` `CONFIG` URLs in production (default: `false`)
- `CONFIG_ALLOW_INTERNAL_HOST` - When `true`, allows `CONFIG` targets that use/resolve to private or loopback addresses (default: `false`, not recommended)
- `CONFIG_FETCH_TIMEOUT_MS` - Fetch timeout in milliseconds (default: `10000`, min: `1000`, max: `120000`)
- `CONFIG_FETCH_MAX_BYTES` - Maximum response size in bytes (default: `262144` = 256 KiB, min: `1024`, max: `2097152` = 2 MiB)
- `CONFIG_JSON_MAX_DEPTH` - Maximum JSON traversal depth for key counting (default: `12`, min: `1`, max: `32`)
- `CONFIG_JSON_MAX_KEYS` - Maximum total JSON keys across all objects/arrays up to `CONFIG_JSON_MAX_DEPTH` (default: `512`, min: `1`, max: `10000`)

#### Content Security Policy (Express)

- `CSP_ENFORCE` - When `true`, sends enforcing `Content-Security-Policy`. Otherwise sends `Content-Security-Policy-Report-Only` (default).
- `CSP_DEFAULT_SRC_EXTRA` - Optional extra origins for `default-src` (after `'self'`). Same comma- or space-separated URL list as `CSP_CONNECT_SRC_EXTRA`.
- `CSP_BASE_URI_EXTRA` - Optional extra origins for `base-uri` (after `'self'`). Same URL list format.
- **`connect-src`** - Includes `'self'`, `https:`, and `wss:`; non-production also includes `http:` and `ws:` scheme keywords. In **production**, plain HTTP backends need explicit origins via `CSP_CONNECT_SRC_EXTRA`.
- `CSP_CONNECT_SRC_EXTRA` - Comma- or space-separated URLs (normalized to origins). Example: `CSP_CONNECT_SRC_EXTRA=http://host.docker.internal:3100`
- **`script-src`** - Default `'self' 'unsafe-inline' 'unsafe-eval'`. For third-party scripts (for example Google Tag Manager’s `gtm.js`), set `CSP_SCRIPT_SRC_EXTRA` with the script host origin(s). `connect-src` already allows `https:`, so this variable is for **script** loads, not network beacons alone.
- `CSP_SCRIPT_SRC_EXTRA` - Extra `script-src` origins. Example: `CSP_SCRIPT_SRC_EXTRA=https://www.googletagmanager.com`
- `CSP_WORKER_SRC_EXTRA`, `CSP_STYLE_SRC_EXTRA`, `CSP_IMG_SRC_EXTRA`, `CSP_FONT_SRC_EXTRA` - Optional extra origins for `worker-src` (after `'self'` and `blob:`), `style-src` (after `'self'` and `'unsafe-inline'`), `img-src` (after `'self'` and `data:`), and `font-src` (after `'self'` and `data:`). Same comma- or space-separated URL list as `CSP_CONNECT_SRC_EXTRA`.
- `CSP_FRAME_ANCESTORS` - Optional **full override** of the CSP `frame-ancestors` directive (default `'none'` if unset). See [Environment configuration](../deployment/environment-configuration.md) (Content Security Policy section) for `X-Frame-Options` alignment.

### API Configuration

- `API_URL` - Backend API endpoint (default: `http://localhost:3100`)
- `WEBSOCKET_URL` - WebSocket endpoint (default: `http://localhost:8081`)

### Keycloak Configuration (Keycloak mode)

- `KEYCLOAK_AUTH_SERVER_URL` - Keycloak server URL
- `KEYCLOAK_REALM` - Keycloak realm
- `KEYCLOAK_CLIENT_ID` - Keycloak client ID

## Development

### Running Locally

```bash
# Serve the application
nx serve frontend-agent-console

# Build for production
nx build frontend-agent-console

# Run tests
nx test frontend-agent-console
```

### Docker Deployment

```bash
# Build container
nx docker:server frontend-agent-console

# Run with docker-compose
cd apps/frontend-agent-console
docker compose up -d
```

## Production Deployment

Before deploying to production:

1. Configure environment variables
2. Set `API_URL` to production **agent controller** HTTP endpoint
3. Set `WEBSOCKET_URL` to production controller WebSocket base (namespaces `clients` and `tickets` share this origin)
4. Configure Keycloak client (or users auth) for the production domain
5. (Optional) Set `CONFIG` environment variable to a remote JSON configuration URL for runtime configuration
6. Build the application: `nx build frontend-agent-console --configuration=production`
7. Serve the built files using a web server (nginx, Apache, etc.)

## Related Documentation

- **[Chat Interface Feature](../features/chat-interface.md)** - Chat functionality guide
- **[Web IDE Feature](../features/web-ide.md)** - Code editor guide
- **[File Management Feature](../features/file-management.md)** - File operations guide
- **[Version Control Feature](../features/version-control.md)** - Git operations guide
- **[Tickets and Workspaces](../features/tickets-and-workspaces.md)** - Ticket board and automation
- **[Deployment](../features/deployment.md)** - CI/CD from the console
- **[Usage Statistics](../features/usage-statistics.md)** - Controller analytics
- **[Message Filter Rules](../features/message-filter-rules.md)** - Global and per-agent filters
- **[Atlassian import](../features/atlassian-import.md)** - Atlassian site connections and import configurations (admin UI)
- **[WebSocket Communication](../features/websocket-communication.md)** - Dual-namespace behavior
- **[Backend Agent Controller](./backend-agent-controller.md)** - API and WebSocket surface

---

_For detailed component documentation, see the feature and deployment docs linked above._
