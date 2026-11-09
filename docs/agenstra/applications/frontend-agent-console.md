# Frontend Agent Console

Angular web application providing a web-based IDE and chat interface for interacting with AI agents.

## Purpose

This application provides a comprehensive user interface for managing clients, agents, tickets, deployments, and filter policies, and for interacting with AI agents in real time. It includes a Monaco Editor-based code editor, chat interface, file management, and Git operations. All workspace-scoped traffic goes to the **agent controller** API and WebSockets; the console does not talk directly to agent-manager instances.

## Features

This application provides:

- **Chat Interface** Real-time bidirectional communication with AI agents via WebSocket; permission-style prompts of the platform `agenstra` MCP server (context access, content changes `ctx_chg_…`, deployment actions `ctx_dep_…` with subtype `context_deployment`) are answered with **Allow once** / **Allow for this chat** / **Deny**
- **Initiatives** `/initiatives/:clientId?initiativeId=&tab=` (sidebar above Tickets): workspace planning that follows the BMad Method — a sidebar with intent, "What's next", progress and the work items next to every tab, guided steps, versioned documents, work items in build order (transfer to tickets, release, story plans), guided steps with agents (live conversation, accept result), Learn & adjust (findings, change proposals, decisions, retrospectives) and activity; live over `socket/initiatives` ([Initiatives](../features/initiatives.md))
- **Chat plan mode** Composer-driven explore/refine/execute planning flow with chat-scoped timeline cards and modal refinement UI ([Chat plan mode](../features/chat-plan-mode.md))
- **Plans** `/plans/:clientId` (sidebar between Knowledge and Tasks): searchable plans of an environment, markdown editing until a plan is executed, refine with the agent, activity log, context reference (`plan:<sha>`); chat plan cards link here and **Select context** links plans of the environment as chat context ([Chat plan mode](../features/chat-plan-mode.md#plans-page))
- **Monaco Editor** Integrated code editor with syntax highlighting and code completion
- **File Management** Browse, read, write, create, and delete files in agent containers
- **Version Control** Full Git operations (status, branches, commit, push, pull, rebase)
- **Container Statistics** Real-time container resource monitoring (CPU, memory, network)
- **Client Management** Create, update, and delete clients (remote agent-manager instances)
- **Agent Management** Create, update, delete, start, stop, and restart agents; environment variables; models list
- **Tickets** Workspace ticket board with comments, activity, migration, and automation runs ([Tickets and Workspaces](../features/tickets-and-workspaces.md)); the ticket automation settings include the opt-ins **Ticket changes** and **Allowed CI actions** (start / cancel pipeline runs without asking; `allowedDeploymentOperations`)
- **Tasks** Recurring agent tasks with approval of agent-created / agent-changed tasks; the task editor and detail show **Allowed ticket / knowledge changes** and **Allowed CI actions** (**Start pipeline runs**, **Cancel pipeline runs**). Both opt-ins are approved content: a complete save of the form by a workspace user approves the task, and the pending-approval banner lists them. CI actions only work on pipelines that allow environment runs, with the default branch and defined inputs only
- **Pipelines** (sidebar **Pipelines**) Workspace pipelines (deployment workflows in the API) on instance-wide CI/CD connections (GitHub Actions, GitLab CI/CD, Jenkins): run, follow, cancel and audit runs, jobs and logs ([Deployment](../features/deployment.md))
- **Connections** Admin area for CI/CD connections (rail tab **CI/CD**) and Atlassian connections
- **Usage statistics** Controller-backed analytics slices for operators ([Usage Statistics](../features/usage-statistics.md))
- **Message filters and web traffic** Security tabs in the agent configuration editor ([Message Filters](../features/message-filters.md), [Egress Filtering](../features/egress-filtering.md))
- **Container isolation** Isolation level selection when creating environments, isolation badges and a host re-check action ([Container Isolation Levels](../features/container-isolation.md))
- **Atlassian import** Admin UI for Atlassian site connections and Jira/Confluence import configs ([Atlassian import](../features/atlassian-import.md))
- **Agent autonomy** Configure which agents may run autonomously per workspace
- **Server Provisioning** Provision cloud servers (Hetzner, DigitalOcean) with automated deployment
- **Audit** Audit views for administrators (`/audit`)
- **State Management** NgRx for predictable state management
- **Authentication** OIDC, SAML, built-in users (JWT) or API key via `@forepath/identity/frontend`, depending on deployment configuration

## Architecture

This application is built using:

- **Angular** Frontend framework
- **NgRx** State management (Actions, Reducers, Effects, Selectors, Facades)
- **Monaco Editor** Code editor (VS Code editor in the browser)
- **Socket.IO Client** WebSocket communication
- **Bootstrap** UI framework
- **RxJS** Reactive programming

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

### Environment progress state (`environmentProgress`)

- Running environment create / update operations per workspace (`EnvironmentProgressFacade`)
- Selected workspace: REST snapshot (`GET /clients/:id/agents/progress`) on `setClientSuccess` / remote reconnect plus forwarded `environmentProgress` socket events
- Other workspaces: `environmentProgress` from the `socket/status` snapshot / patches
- Create / update environment modals: `getCreateEnvironmentProgress$` (running create matched by name) and `getEnvironmentProgressForAgent$` drive the progress shown next to the loading submit button
- Aggregates (average + stacked segments) for the workspace list
- The agents slice tracks list load errors separately (`listErrors`) to flag unreachable workspaces

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

### Workspace deployments state (`workspaceDeployments`)

- `WorkspaceDeploymentsFacade` / `WorkspaceDeploymentsService` (`/clients/:clientId/deployments/...`)
- Workflows page (server search / environment filter / paging) and the opened workflow, runs page (`{ items, total }`, status filter, search) and the opened run with its jobs, run / job logs, trigger / sync / cancel requests, connection options for the workflow editor
- Live updates: `deploymentWorkflowUpsert`, `deploymentWorkflowRemoved` and `deploymentRunUpsert` on the clients socket (`client-deployments.constants.ts`, routed by `routeForwardedEvents$`); newer snapshots (`updatedAt`) win, new runs are prepended to an unfiltered first page
- Approval of workflows an environment proposed or changed: `approveWorkflow(clientId, workflowId, updatedAt)` → `POST /clients/:clientId/deployments/workflows/:workflowId/approval` `{ updatedAt }` (the reviewed version); the approved workflow is upserted, a `409` (changed since it was reviewed) keeps the backend message and reloads the listed page and the opened workflow (`reloadDeploymentWorkflowAfterApprovalConflict$`)

### Deployment connections state (`deploymentConnections`)

- `DeploymentConnectionsFacade` / `DeploymentConnectionsService` (`/connections/deployments`, instance admins): connections page (server search / provider filter / paging), create / update / delete (409 message of connections still used by workflows), connection tests (result mirrored on the row)

### Tickets state (`tickets`, `ticketAutomation`)

- Ticket lists and detail, comments, automation configuration (incl. `allowedContentWrites` and `allowedDeploymentOperations`) and runs

### Client agent autonomy state (`clientAgentAutonomy`)

- Enabled agent ids and per-agent autonomy payloads for the active workspace

### Usage statistics state (`statistics`)

- Summary, chat I/O, filter drops/flags, and entity events (controller API)

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
- **Identity** `identityAuthRoutes` (login, register, password reset, email confirmation, user management) merged under the shell component
- `/audit`. Audit (authenticated)
- `/agent-config`. Admin **Agent configuration** editor (structured + raw; **admin** guard); see [Agent configuration](../features/agent-configuration.md)
- `/connections` → redirect to `/connections/deployments` (**admin** popover item **Connections**)
- `/connections/deployments`. **CI/CD connections** (GitHub Actions, GitLab CI/CD, Jenkins) (**admin** guard; page title "CI/CD connections")
- `/connections/atlassian`. Atlassian connections and import configurations (**admin** guard; sidebar **Connections**)
- `/pipelines`, `/pipelines/:clientId`. **Pipelines** page: the pipelines (deployment workflows) of a workspace (**authenticated**; requires active client context; sidebar **Pipelines** (play icon `bi-play-circle`, tooltip "CI/CD pipelines") after **Tasks**); query `agentId` (environment filter), `workflowId`, `runId` (deep links, e.g. from the audit log; a `runId` without `workflowId` resolves the workflow from the run)
- `/tickets`, `/tickets/:clientId`. Ticket board (**authenticated**; requires active client context)
- `/clients`. Default **Manager** view: client and agent chat shell
  - `/clients`. Landing list
  - `/clients/:clientId`. Workspace selected
  - `/clients/:clientId/agents/:agentId`. Agent chat
  - `/clients/:clientId/agents/:agentId/editor`. Editor layout for the same shell
- `**` → redirect to `clients`

## Components

### AgentConsoleContainerComponent

Main container component that provides the layout and routing structure.

### AgentConsoleChatComponent

Main workspace shell: chat (including a **session switcher** for multiple user-visible chat sessions per environment, with per-session unread badges), file tree, Git, environment variables, deployments entry, statistics, and modals for client and agent management. Sessions are managed via controller `/clients/{id}/agents/{agentId}/chats` and restored over WebSocket with `login` / `restoreChat` `chatId` (see [Chat Interface](../features/chat-interface.md)). Unread status for each visible session comes from the `status` WebSocket snapshot/patch (`environments[].chats[]`). The **create environment** modal shows the workspace host's container isolation levels as a radio group (**MicroVM (KVM)** and **Sandboxed (gVisor on KVM)** when the host reports the level, **Sandboxed (gVisor)**, **Standard Docker**; recommended level preselected, unavailable levels disabled with their reason) and submits the displayed capability revision; choosing a weaker level than recommended opens a confirmation dialog first ("Use the gVisor sandbox instead of a microVM?" for sandboxed-kvm instead of microvm, "Use the gVisor sandbox without KVM?" for sandboxed, "Use Standard Docker?" for standard), and a `409` (stale revision or level no longer available) reloads the levels for review. Environments show an isolation badge (standard / sandboxed / sandboxed-kvm with `bi-shield-fill-check` / microvm with `bi-cpu`), the workspace list shows **MicroVM available** or **KVM sandbox available** when such a level is ready, and the **Update Workspace** modal shows the state of all levels with a **Re-check isolation** action (`POST /clients/{id}/isolation/probe`, workspace managers only) to re-probe the host ([Container Isolation Levels](../features/container-isolation.md)). Environment and workspace entries show `fpc-progress` bars while environments are created or updated; when the selected workspace cannot be reached, the environments list shows an unavailable-content empty state below the search with the connection error, search/add controls are disabled, and the workspace entry shows a warning icon.

### TicketsBoardComponent

Ticket board and detail experience for the active workspace (`/tickets`).

### DeploymentsBoardComponent

The **Pipelines** page (`/pipelines/:clientId`, `feature-agent-console/src/lib/deployments/`; sidebar **Pipelines**). The UI calls deployment workflows **pipelines**; **GitHub workflow** only means the GitHub Actions workflow file a pipeline dispatches. Same workspace chip / switch and phone layout as Tasks and Plans: the pipelines table (state = last run or disabled, search, **Environment** and **Approval** (all / waiting for approval / approved; `?approval=`) filters in the Filters drawer, row menu open / run / edit / copy ID / delete, bulk sync / enable / disable / delete) and a detail column with the pipeline overview (connection, repository, GitHub workflow, default branch, default inputs, availability: all environments or the assigned ones, whether environments may trigger runs) and its run history (server-paged, search, status filter, live). A selected run opens in its own column to the right (like the chat at `/clients`; the pipeline and its run history stay visible, every column just narrows; on phones it replaces the pipeline) with its jobs table, a logs modal for the run or a job (copy, download; truncated tail note), **Open in provider** and **Cancel run** (confirmation). **Run pipeline** opens the trigger modal (ref with branch suggestions for workspace admins, free text otherwise; inputs prefilled from the pipeline defaults; optional environment). Workspace admins (`canManageWorkspaceConfiguration`) additionally create (**New pipeline**) / edit / delete pipelines (`DeploymentWorkflowEditorComponent`: connection, repository typeahead, GitHub workflow and default branch pickers, default inputs, scope, agent trigger, enabled); management actions are hidden for other members. The run history and the jobs table list the newest runs / jobs first by start time (runs that did not start yet fall back to their creation time, jobs without a start go last; live upserts keep that order); the jobs table starts sorted by **Started**, descending.

Workflows an environment proposed or changed through the `agenstra` MCP server (`approvalStatus: pending`) show **Waiting for approval** (warning state with an hourglass icon) in the table and as a badge in the header, plus a banner with **Proposed by environment …** / **Changed by environment …** (the overview also lists **Proposed by**). Nobody can start runs meanwhile: **Run workflow** is disabled with a tooltip, also in the row menu. Workspace admins get **Approve** (header, banner and row menu) with a confirmation dialog that shows what is approved (connection, repository, workflow, default branch, inputs, availability and whether environments may trigger runs); the approval is bound to the reviewed `updatedAt`, and a `409` shows the backend message and reloads the workflow. Saving the complete workflow in the editor approves it as well (the editor always sends every content field and shows a hint for pending workflows).

### DeploymentConnectionsAdminComponent

Instance-admin CI/CD connections (`/connections/deployments`). Table with provider, authentication badge, workspace access, connection status (ok / failed / untested with last test time and message), single and bulk **Test**, delete with confirmation (the controller refuses connections still used by pipelines and the message is shown). The create / edit modal offers only the auth types the provider supports (`DEPLOYMENT_PROVIDER_AUTH_TYPES`, default first: GitHub App or token for GitHub; token for GitLab; username + API token for Jenkins), the base URL (required for Jenkins, optional for GitHub Enterprise / GitLab self-managed) and workspace access (all or selected workspaces). Secrets are write-only (empty on edit keeps the stored ones unless the auth type changes). Both connection pages are child routes of `ConnectionsShellComponent` (`/connections`), whose left rail (vertical tab group, like `/agent-config`) switches between **CI/CD** and **Atlassian**.

### AtlassianImportAdminComponent

Administrative UI for Atlassian connections and import configurations (`/connections/atlassian`, **Connections → Atlassian**). Connections are created with an auth variant switch (**OAuth (service account)**, default: client id + client secret; **API token**: email + token), list their connection status (ok / failed / untested badge with last test time and message), and update it when **Test** runs. Secrets are write-only: leaving them empty on edit keeps the stored ones.

### AuditComponent

Administrative audit views (`/audit`).

Entity events of type `deployment_workflow` / `deployment_run` (approvals and environment changes are `updated` events of the workflow) are labelled **Pipeline** / **Pipeline run** and link to `/pipelines/:clientId?workflowId=…` / `?runId=…` (deleted workflows are not linked).

### FileEditorComponent

Monaco Editor integration for code editing with:

- Syntax highlighting
- Code completion
- File system browser with multi-select, copy/cut/paste, and queued moves (see feature library `docs/file-tree.md`)
- Save functionality

## WebSocket Communication

The application opens **two** Socket.IO connections to the controller **`WEBSOCKET_URL`** when needed:

1. **`clients` namespace** Same port as today’s `WEBSOCKET_URL`; `setClient` selects the workspace, then `forward` sends agent-manager events (chat, login, terminals, etc.). Manager responses arrive as their native event names on this socket.
2. **`tickets` namespace** Optional second connection for ticket board realtime (`setClient` per workspace, then ticket and automation events). Chat-centric UIs may rely on controller events on `clients` instead; see [WebSocket Communication](../features/websocket-communication.md).

Reconnection flows restore client context, agent login when applicable, and tickets board context.

### Reconnection Handling

On reconnection:

1. Automatically reconnects to the WebSocket(s)
2. Restores client context (`setClient`)
3. Restores agent login (if previously logged in)
4. Clears stale local buffers where required to avoid duplicates
5. Receives chat history for the active session (`chatId` / primary) and ticket automation cards on the **primary** session only (as implemented in NgRx selectors/effects); **chat plan cards** hydrate for the matching `plan.chatId` (primary or user session). Session switches use `restoreChat`

## Authentication

Behavior depends on controller configuration:

- **OIDC** Authorization Code + PKCE (`oidc-client-ts`), tokens attached to HTTP and WebSocket handshakes, renewal handled by the identity frontend layer.
- **SAML** Sign-in through the backend (`/api/auth/saml/login`), callback route `/login/saml/callback` exchanges a one-time code for a session JWT; afterwards it behaves like users mode.
- **Users (JWT)** Email/password login and registration routes from `identityAuthRoutes`; tokens are stored and sent as `Bearer` on HTTP and on WebSocket handshakes.
- **mTLS (client certificate)** The login page asks for a PEM certificate file (and optionally a separate PKCS#8 private key file). The key is imported non-extractable into IndexedDB; short-lived certificate assertions (`Authorization: Certificate …`) are attached to HTTP and WebSocket handshakes. Full access like the API key (no PAT / user management UI).

See [Authentication](../features/authentication.md) for environment variables and operational notes.

## Environment Configuration

Configure the application via environment variables. The **Express** runtime (`/config` proxy, CSP, and related variables) is shared with **agenstra-frontend-landingpage** and **agenstra-frontend-docs** (patch apps over the shared docs base). See [Environment configuration](../deployment/environment-configuration.md) for the full list.

### Runtime Configuration (Docker Containers)

- `CONFIG` - URL to a remote JSON configuration file that will be loaded at runtime and merged with build-time defaults (optional)
  - If set, the application will fetch this configuration during initialization via `/config` endpoint
  - The remote configuration takes precedence over build-time defaults
  - If not set or fetch fails, the application falls back to build-time defaults
  - Per-deployment only (no shared repo example under `configs/`); JSON uses a nested `console` section (`console.urls.restApi`, `console.urls.websocket`, …)
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
- **`connect-src`** Includes `'self'`, `https:`, and `wss:`; non-production also includes `http:` and `ws:` scheme keywords. In **production**, plain HTTP backends need explicit origins via `CSP_CONNECT_SRC_EXTRA`.
- `CSP_CONNECT_SRC_EXTRA` - Comma- or space-separated URLs (normalized to origins). Example: `CSP_CONNECT_SRC_EXTRA=http://host.docker.internal:3100`
- **`script-src`** Default `'self' 'unsafe-inline' 'unsafe-eval'`. For third-party scripts (for example Google Tag Manager’s `gtm.js`), set `CSP_SCRIPT_SRC_EXTRA` with the script host origin(s). `connect-src` already allows `https:`, so this variable is for **script** loads, not network beacons alone.
- `CSP_SCRIPT_SRC_EXTRA` - Extra `script-src` origins. Example: `CSP_SCRIPT_SRC_EXTRA=https://www.googletagmanager.com`
- `CSP_WORKER_SRC_EXTRA`, `CSP_STYLE_SRC_EXTRA`, `CSP_IMG_SRC_EXTRA`, `CSP_FONT_SRC_EXTRA` - Optional extra origins for `worker-src` (after `'self'` and `blob:`), `style-src` (after `'self'` and `'unsafe-inline'`), `img-src` (after `'self'` and `data:`), and `font-src` (after `'self'` and `data:`). Same comma- or space-separated URL list as `CSP_CONNECT_SRC_EXTRA`.
- `CSP_FRAME_ANCESTORS` - Optional **full override** of the CSP `frame-ancestors` directive (default `'none'` if unset). See [Environment configuration](../deployment/environment-configuration.md) (Content Security Policy section) for `X-Frame-Options` alignment.

### API Configuration

- `API_URL` - Backend API endpoint (default: `http://localhost:3100`)
- `WEBSOCKET_URL` - Socket.IO clients URL (default: `http://localhost:3100/socket/clients`)

### Authentication (runtime config)

- OIDC: `authentication.config = { "type": "oidc", "issuer": "…", "clientId": "…", "scope"?: "openid profile email", "postLogoutRedirectUri"?: "…" }` (public client)
- SAML: `authentication.config = { "type": "saml" }`
- mTLS: `authentication.config = { "type": "mtls", "assertionLifetimeSeconds"?: 120, "audience"?: "…" }` (`audience` must equal the API's `MTLS_ASSERTION_AUDIENCE` when that is set; the lifetime must not exceed `MTLS_ASSERTION_MAX_LIFETIME`)

## Development

### Running Locally

```bash
# Serve the application
nx serve agenstra-frontend-agent-console

# Build for production
nx build agenstra-frontend-agent-console

# Run tests
nx test frontend-agent-console
```

### Docker Deployment

```bash
# Build container
nx docker:server agenstra-frontend-agent-console

# Run with docker-compose
cd apps/agenstra/frontend-agent-console
docker compose up -d
```

## Production Deployment

Before deploying to production:

1. Configure environment variables
2. Set `API_URL` to production **agent controller** HTTP endpoint
3. Set `WEBSOCKET_URL` to production controller WebSocket base (namespaces `clients` and `tickets` share this origin)
4. Configure the OIDC / SAML client (or users auth) for the production domain
5. (Optional) Set `CONFIG` environment variable to a remote JSON configuration URL for runtime configuration
6. Build the application: `nx build agenstra-frontend-agent-console --configuration=production`
7. Serve the built files using a web server (nginx, Apache, etc.)

## Related documentation

- **[Chat Interface Feature](../features/chat-interface.md)** Chat functionality guide
- **[Initiatives](../features/initiatives.md)** Planning that follows the BMad Method, live for the workspace
- **[Chat plan mode](../features/chat-plan-mode.md)** Explore-only plan cards, refine, and execute
- **[Web IDE Feature](../features/web-ide.md)** Code editor guide
- **[File Management Feature](../features/file-management.md)** File operations guide
- **[Version Control Feature](../features/version-control.md)** Git operations guide
- **[Tickets and Workspaces](../features/tickets-and-workspaces.md)** Ticket board and automation
- **[Deployment](../features/deployment.md)** Workspace deployment workflows and CI/CD connections
- **[Usage Statistics](../features/usage-statistics.md)** Controller analytics
- **[Message Filters](../features/message-filters.md)** Layered chat message filters
- **[Egress Filtering](../features/egress-filtering.md)** Per-environment web traffic filtering
- **[Container Isolation Levels](../features/container-isolation.md)** Standard (`runc`), gVisor-sandboxed, gVisor-on-KVM and microVM environments
- **[Atlassian import](../features/atlassian-import.md)** Atlassian site connections and import configurations (admin UI)
- **[WebSocket Communication](../features/websocket-communication.md)** Dual-namespace behavior
- **[Backend Agent Controller](./backend-agent-controller.md)** API and WebSocket surface

---

_For detailed component documentation, see the feature and deployment docs linked above._
