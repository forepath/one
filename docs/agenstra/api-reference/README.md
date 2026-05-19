# API Reference

Complete API specifications for Agenstra's backend services. All specifications are available in OpenAPI 3.1.0 (for HTTP REST APIs) and AsyncAPI 3.0.0 (for WebSocket gateways) formats.

## Agent Controller API

The Agent Controller provides a centralized control plane for managing multiple distributed agent-manager instances.

### HTTP REST API

**OpenAPI Specification**: [openapi.yaml](/spec/agent-controller/openapi.yaml)

- **View in Swagger Editor**: [Open in Swagger Editor](https://editor.swagger.io/?url=https://docs.agenstra.com/spec/agent-controller/openapi.yaml)
- **Download**: [openapi.yaml](/spec/agent-controller/openapi.yaml)

The Agent Controller HTTP API provides:

- Client management (CRUD operations) and client user management (Keycloak/users modes)
- Users authentication endpoints (`/auth/*`, `/users/*`) when `AUTHENTICATION_METHOD=users`
- Tickets, comments, activity, migration, automation, and assisted body-generation flows (`/tickets/*`)
- Usage statistics (`/clients/:id/statistics/*`, `/statistics/*`)
- Global message filter rules for administrators (`/filter-rules`)
- Atlassian site connections and import configurations for administrators (`/imports/atlassian/*`)
- Agent autonomy configuration per workspace and per agent
- Proxied agent operations (CRUD, models, start/stop/restart, environment variables, deployments)
- Proxied file operations (read, write, create, delete, move)
- Proxied version control operations (including workspace prepare-clean and automation verify-commands)
- Server provisioning (Hetzner Cloud, DigitalOcean)

### WebSocket Gateway

**AsyncAPI Specification**: [asyncapi.yaml](/spec/agent-controller/asyncapi.yaml)

- **View in AsyncAPI Studio**: [Open in AsyncAPI Studio](https://studio.asyncapi.com/?url=https://docs.agenstra.com/spec/agent-controller/asyncapi.yaml)
- **Download**: [asyncapi.yaml](/spec/agent-controller/asyncapi.yaml)

The Agent Controller WebSocket gateway provides:

- **`clients` namespace** – Client context (`setClient`), `forward` to remote agent-managers, proxied events by name, reconnection notifications, controller-originated ticket hints for chat
- **`tickets` namespace** – Ticket board and automation realtime (`setClient`, upserts, comments, activity, run events)

## Agent Manager API

The Agent Manager provides agent lifecycle management and container execution.

### HTTP REST API

**OpenAPI Specification**: [openapi.yaml](/spec/agent-manager/openapi.yaml)

- **View in Swagger Editor**: [Open in Swagger Editor](https://editor.swagger.io/?url=https://docs.agenstra.com/spec/agent-manager/openapi.yaml)
- **Download**: [openapi.yaml](/spec/agent-manager/openapi.yaml)

The Agent Manager HTTP API provides:

- Agent management (CRUD, models, start/stop/restart)
- Per-agent regex filter rules (`/agents-filters`)
- Environment variable CRUD with container restart semantics
- File system operations (read, write, create, delete, move; optional `context` query)
- Version control operations (git status, branches, commit, push, pull, rebase, workspace prepare-clean, automation verify-commands)
- Deployment configuration and CI/CD run APIs (`/agents/:agentId/deployments/...`)
- Configuration endpoint (`/config`)

### WebSocket Gateway

**AsyncAPI Specification**: [asyncapi.yaml](/spec/agent-manager/asyncapi.yaml)

- **View in AsyncAPI Studio**: [Open in AsyncAPI Studio](https://studio.asyncapi.com/?url=https://docs.agenstra.com/spec/agent-manager/asyncapi.yaml)
- **Download**: [asyncapi.yaml](/spec/agent-manager/asyncapi.yaml)

The Agent Manager WebSocket gateway provides:

- Agent authentication (`login` event)
- Real-time chat communication (`chat` event, `chatMessage` broadcast)
- File update notifications (`fileUpdate`, `fileUpdateNotification`)
- Terminal session management (`createTerminal`, `terminalInput`, `terminalOutput`, `closeTerminal`)
- Container statistics broadcasting (`containerStats`; default every 15s on the manager, configurable via `CONTAINER_STATS_SCHEDULER_INTERVAL`)

## Billing Manager WebSocket

The billing manager exposes a Socket.IO gateway for **dashboard server status** (provisioned subscription items), separate from the HTTP port. Connections use the same JWT / Keycloak handshake auth as HTTP; static API key clients are not given an end-user billing stream (aligned with REST).

**AsyncAPI Specification**: [asyncapi.yaml](/spec/billing-manager/asyncapi.yaml)

- **View in AsyncAPI Studio**: [Open in AsyncAPI Studio](https://studio.asyncapi.com/?url=https://docs.agenstra.com/spec/billing-manager/asyncapi.yaml)
- **Download**: [asyncapi.yaml](/spec/billing-manager/asyncapi.yaml) (canonical source in-repo: `libs/domains/framework/backend/feature-billing-manager/spec/asyncapi.yaml`)

The billing status gateway provides:

- `subscribeDashboardStatus` / `unsubscribeDashboardStatus` client commands
- `dashboardStatusUpdate` unicast emissions with the same server-info fields as `GET .../server-info`
- `error` events scoped to the initiating socket only

## Using the Specifications

### Swagger Editor

[Swagger Editor](https://editor.swagger.io/) is an online tool for viewing and editing OpenAPI specifications. Use it to:

- Explore API endpoints interactively
- Generate client SDKs
- Validate API contracts
- Test API operations

### AsyncAPI Studio

[AsyncAPI Studio](https://studio.asyncapi.com/) is an online tool for viewing and editing AsyncAPI specifications. Use it to:

- Visualize WebSocket event flows
- Understand message schemas
- Generate documentation
- Validate AsyncAPI contracts

## Generated Client Packages

Pre-built client SDKs are automatically generated from the OpenAPI specifications and published to GitHub Packages. These clients provide type-safe, language-specific interfaces for interacting with the Agenstra APIs.

### JavaScript/TypeScript Clients

JavaScript and TypeScript client packages are published to GitHub Packages npm registry and can be installed using npm or yarn.

**Agent Manager Client**: `@forepath/agenstra-agent-manager-client`

**Agent Controller Client**: `@forepath/agenstra-agent-controller-client`

The TypeScript clients are built with Axios and include full type definitions and interfaces. All clients support configurable base URLs for flexible endpoint configuration.

### Installing Clients

To install the published clients, configure your package manager to use GitHub Packages:

- **npm/yarn**: Configure `@forepath` scope to use GitHub Packages registry in your `.npmrc`

All clients are automatically generated and published with each release, ensuring they stay in sync with the latest API specifications.

## Related Documentation

- **[Architecture Overview](../architecture/system-overview.md)** - System architecture and component relationships
- **[WebSocket Communication](../features/websocket-communication.md)** - Real-time communication patterns
- **[Backend Agent Controller Application](../applications/backend-agent-controller.md)** - Application details
- **[Backend Agent Manager Application](../applications/backend-agent-manager.md)** - Application details
