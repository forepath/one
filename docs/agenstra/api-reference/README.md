# API Reference

Complete API specifications for Agenstra's backend services. All specifications are available in OpenAPI 3.1.0 (for HTTP REST APIs) and AsyncAPI 3.0.0 (for WebSocket gateways) formats.

## Agent Controller API

The Agent Controller provides a centralized control plane for managing multiple distributed agent-manager instances.

### HTTP REST API

**OpenAPI Specification**: [openapi.yaml](/spec/agent-controller/openapi.yaml)

- **View in Swagger Editor**: [Open in Swagger Editor](https://editor.swagger.io/?url=https://docs.agenstra.com/spec/agent-controller/openapi.yaml)
- **Download**: [openapi.yaml](/spec/agent-controller/openapi.yaml)

Canonical source in the monorepo: `libs/domains/agenstra/backend/feature-agent-controller/spec/openapi.yaml`

The Agent Controller HTTP API provides:

- Client management (CRUD operations) and client user management (Keycloak/users modes)
- Users authentication endpoints (`/auth/*`, `/users/*`) when `AUTHENTICATION_METHOD=users`
- Tickets, comments, activity, migration, automation, and assisted body-generation flows (`/tickets/*`)
- Knowledge tree and relations (`/knowledge/*`) for workspace pages/folders
- Usage statistics (`/clients/:id/statistics/*`, `/statistics/*`)
- Global message filter rules for administrators (`/filter-rules`)
- Atlassian site connections and import configurations for administrators (`/imports/atlassian/*`)
- Agent autonomy configuration per workspace and per agent
- Proxied agent operations (CRUD, models, start/stop/restart, environment variables, deployments)
- Proxied file operations (read, write, create, delete, move)
- Proxied version control operations (including workspace prepare-clean and automation verify-commands)
- Server provisioning (Hetzner Cloud, DigitalOcean)

#### Knowledge REST

| Method           | Path                                  | `operationId`                                                      |
| ---------------- | ------------------------------------- | ------------------------------------------------------------------ |
| GET              | `/knowledge`                          | `listKnowledgeNodes`                                               |
| GET              | `/knowledge/tree`                     | `getKnowledgeTree`                                                 |
| GET              | `/knowledge/by-sha`                   | `getKnowledgeNodeBySha`                                            |
| POST             | `/knowledge`                          | `createKnowledgeNode`                                              |
| GET/PATCH/DELETE | `/knowledge/{id}`                     | `getKnowledgeNode` / `updateKnowledgeNode` / `deleteKnowledgeNode` |
| GET              | `/knowledge/{id}/activity`            | `listKnowledgePageActivity`                                        |
| POST             | `/knowledge/{id}/reorder`             | `reorderKnowledgeNode`                                             |
| POST             | `/knowledge/{id}/duplicate`           | `duplicateKnowledgeNode`                                           |
| GET/POST         | `/knowledge/relations`                | `listKnowledgeRelations` / `createKnowledgeRelation`               |
| DELETE           | `/knowledge/relations/{id}`           | `deleteKnowledgeRelation`                                          |
| GET              | `/knowledge/relations/prompt-context` | `getKnowledgePromptContext`                                        |

#### Contract hygiene (deferred gaps)

OpenAPI also documents composite surfaces without controllers in `feature-agent-controller` (auth/users from identity when bundled; admin webhooks; otel metrics). Those ops stay published. Cosmetic Nest `{clientId}` vs OpenAPI `{id}` param names are deferred.

### WebSocket Gateway

**AsyncAPI Specification**: [asyncapi.yaml](/spec/agent-controller/asyncapi.yaml)

- **View in AsyncAPI Studio**: [Open in AsyncAPI Studio](https://studio.asyncapi.com/?url=https://docs.agenstra.com/spec/agent-controller/asyncapi.yaml)
- **Download**: [asyncapi.yaml](/spec/agent-controller/asyncapi.yaml)

Canonical source in the monorepo: `libs/domains/agenstra/backend/feature-agent-controller/spec/asyncapi.yaml`

The Agent Controller WebSocket gateway provides:

- **`clients` namespace** Client context (`setClient`), `forward` to remote agent-managers, proxied events by name, reconnection notifications, controller-originated ticket hints for chat
- **`tickets` namespace** Ticket board and automation realtime (`setClient`, upserts, comments, activity, run events, `knowledgeRelationChanged`)
- **`pages` namespace** Knowledge board realtime (`setClient`, `knowledgeTreeChanged`, `knowledgeRelationChanged`, `knowledgePageActivityCreated`)
- **`status` namespace** Per-user notification snapshots/patches (`statusSnapshot`, `statusPatch`, `markEnvironmentRead`, `setActiveEnvironment`, `error`)

## Agent Manager API

The Agent Manager provides agent lifecycle management and container execution.

### HTTP REST API

**OpenAPI Specification**: [openapi.yaml](/spec/agent-manager/openapi.yaml)

- **View in Swagger Editor**: [Open in Swagger Editor](https://editor.swagger.io/?url=https://docs.agenstra.com/spec/agent-manager/openapi.yaml)
- **Download**: [openapi.yaml](/spec/agent-manager/openapi.yaml)

Canonical source in the monorepo: `libs/domains/agenstra/backend/feature-agent-manager/spec/openapi.yaml`

The Agent Manager HTTP API provides:

- Agent management (CRUD, models, start/stop/restart)
- Latest agent message metadata (`GET /agents/{id}/messages/latest-agent`) for unread tracking
- Per-agent regex filter rules (`/agents-filters`)
- Environment variable CRUD with container restart semantics
- Workspace configuration overrides (`/configuration-overrides`)
- File system operations (read, write, create, delete, move; optional `context` query)
- Version control operations (git status, branches, commit, push, pull, rebase, workspace prepare-clean, automation verify-commands)
- Deployment configuration and CI/CD run APIs (`/agents/:agentId/deployments/...`)
- Configuration endpoint (`/config`)

#### Contract hygiene (deferred gaps)

`GET /otel/metrics` is documented for shared monitoring (outside Nest controllers in this feature). Nested Docker stats object fields in AsyncAPI remain underspecified placeholders.

### WebSocket Gateway

**AsyncAPI Specification**: [asyncapi.yaml](/spec/agent-manager/asyncapi.yaml)

- **View in AsyncAPI Studio**: [Open in AsyncAPI Studio](https://studio.asyncapi.com/?url=https://docs.agenstra.com/spec/agent-manager/asyncapi.yaml)
- **Download**: [asyncapi.yaml](/spec/agent-manager/asyncapi.yaml)

Canonical source in the monorepo: `libs/domains/agenstra/backend/feature-agent-manager/spec/asyncapi.yaml`

The Agent Manager WebSocket gateway provides:

- Agent authentication (`login` event)
- Real-time chat (`chat`, `chatMessage`, `chatEvent`, `enhanceChat`, `generateTicketBody`, filter results)
- File update notifications (`fileUpdate`, `fileUpdateNotification`)
- Git workspace change signal (`gitStateChanged`)
- Terminal session management (`createTerminal`, `terminalInput`, `terminalOutput`, `terminalResize`, `closeTerminal`) via OpenCode PTY in the worker
- Container statistics broadcasting (`containerStats`; default every 15s on the manager, configurable via `CONTAINER_STATS_SCHEDULER_INTERVAL`)

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

Generate locally with:

```bash
nx run agenstra-backend-agent-manager:openapi-client-js
nx run agenstra-backend-agent-controller:openapi-client-js
```

Output lands under `dist/clients/` (gitignored) and is published on release as:

**Agent Manager Client**: `@forepath/agenstra-agent-manager-client`

**Agent Controller Client**: `@forepath/agenstra-agent-controller-client`

The TypeScript clients are built with Axios and include full type definitions and interfaces. All clients support configurable base URLs for flexible endpoint configuration.

### Installing Clients

To install the published clients, configure your package manager to use GitHub Packages:

- **npm/yarn**: Configure `@forepath` scope to use GitHub Packages registry in your `.npmrc`

All clients are automatically generated and published with each release, ensuring they stay in sync with the latest API specifications.

## Related documentation

- **[Architecture Overview](../architecture/system-overview.md)** System architecture and component relationships
- **[WebSocket Communication](../features/websocket-communication.md)** Real-time communication patterns
- **[Backend Agent Controller Application](../applications/backend-agent-controller.md)** Application details
- **[Backend Agent Manager Application](../applications/backend-agent-manager.md)** Application details
