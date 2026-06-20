# Atlassian import

The agent controller can **import work from Atlassian Cloud** into Agenstra using stored **site connections** (credentials) and **import configurations** that describe what to pull and where to attach it. Imports create or update **workspace tickets** and **knowledge pages** on the controller; they do not run inside agent containers.

## Overview

- **Site connections** – Per-controller records for an Atlassian site: base URL, account email, and API token used for REST calls. Tokens are stored for server-side use only; list and detail APIs do not return secrets (see OpenAPI).
- **Import configurations** – Each config binds a connection to a **workspace** (`clientId`), an import **kind** (`jira` or `confluence`), optional query scope (JQL, board id, CQL, space key, etc.), and optional **parent** targets in Agenstra (parent ticket for Jira swimlanes, parent folder for Confluence pages). Configs can be enabled or disabled; each run records `lastRunAt` and `lastError` when applicable.
- **Provider model** – Today the registered provider is **Atlassian** (`atlassian`). The controller uses a small factory so additional providers could be added later without changing the HTTP surface. Register extra import backends with `DYNAMIC_CONTEXT_IMPORT_PROVIDERS` (see [Dynamic provider plugins](./dynamic-provider-plugins.md)).
- **Execution** – A periodic **scheduler** loads enabled configs in batches and invokes the provider with an **item budget** per tick. Admins can also **run** a single config on demand from the console or `POST` the run endpoint.

## Why controller-native?

Tickets and knowledge trees already live on the controller ([Tickets and Workspaces](./tickets-and-workspaces.md)). Import reuses those services so imported issues and pages participate in the same APIs, permissions, and (for tickets) realtime board behavior as manually created content.

## Access control

- **HTTP** – All routes under `/api/imports/atlassian` require the same **admin check** as global [Message Filter Rules](./message-filter-rules.md): the user must be a **global admin** (`UserRole.ADMIN`) unless the request is authenticated as an **API key** (`isApiKeyAuth`), in which case the role check is bypassed for trusted automation (consistent with `/api/filter-rules`).
- **Console** – Route **`/imports/atlassian`** uses `authGuard` and `adminGuard` (same predicate as `/filters` and user management). The sidebar **Import** entry is shown only when that admin predicate is true.

Non-admin interactive users receive **403** from the API and cannot open the admin UI for import settings.

## Jira vs Confluence

- **Jira** – Imports issues matched by the configured scope (for example JQL and optional board hints) into the ticket model, including description conversion where supported (ADF and wiki-style markup are normalized toward markdown for storage).
- **Confluence** – Imports pages matched by CQL / structure rules into the knowledge tree under the chosen parent folder when configured. Confluence **storage HTML** and wiki markup are converted toward markdown for imported page bodies.

Exact field matrices and validation rules are defined in the OpenAPI DTOs (`CreateExternalImportConfigDto`, `UpdateExternalImportConfigDto`, etc.).

## Queue jobs and manual runs

**Context import** uses BullMQ: a repeatable coordinator enqueues one unit job per enabled config (see [Background jobs](../deployment/background-jobs.md)). Relevant environment variables (defaults shown where applicable):

| Variable                                | Role                                                                                                               |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `CONTEXT_IMPORT_SCHEDULER_INTERVAL_MS`  | Coordinator repeat interval in milliseconds (`120000` default). Set to `0` or less to **disable** the coordinator. |
| `CONTEXT_IMPORT_SCHEDULER_CONFIG_BATCH` | Maximum enabled configs enqueued per coordinator tick (`3` default).                                               |
| `CONTEXT_IMPORT_ITEM_BUDGET`            | Soft cap on work items processed per config per unit job (`25` default).                                           |

Admins may trigger **`POST /api/imports/atlassian/configs/{id}/run`** (HTTP 202) to run one config immediately without waiting for the next coordinator tick.

To disable import execution entirely (for example in a staging environment), set **`ATLASSIAN_IMPORT_DISABLED=true`**. The provider then returns a no-op result for import runs while connections and configs remain manageable via the API.

## Sync markers and cleanup

Imports use **sync markers** in the controller database to avoid duplicate creates and to relate Atlassian entities to Agenstra tickets and knowledge nodes. When you delete an imported ticket or page, you can optionally **release** the marker so a future import can recreate the item; the console and REST layers expose this as a query flag on delete (see OpenAPI for ticket and knowledge-tree `DELETE` operations and the `releaseExternalSyncMarker` query parameter).

Admins can **clear all markers** for a config via **`DELETE /api/imports/atlassian/configs/{id}/markers`** when a full re-import from scratch is desired (destructive to idempotency until the next successful runs).

## Console entry points

- Route **`/imports/atlassian`** – **Atlassian import** admin: connections, configs, test connection, run, clear markers, modals for create/edit/delete (see [Frontend Agent Console](../applications/frontend-agent-console.md)).

Boards do not embed full import administration; operators manage imports from this route.

## Related documentation

- **[Tickets and Workspaces](./tickets-and-workspaces.md)** – Target model for Jira imports
- **[Message Filter Rules](./message-filter-rules.md)** – Same admin / API-key authorization pattern on the controller
- **[Authentication](./authentication.md)** – Roles and authentication modes
- **[Dynamic provider plugins](./dynamic-provider-plugins.md)** – `DYNAMIC_CONTEXT_IMPORT_PROVIDERS` and shared loader behavior
- **[Backend Agent Controller](../applications/backend-agent-controller.md)** – Nest application and `/api` prefix
- **[Frontend Agent Console](../applications/frontend-agent-console.md)** – Routes and NgRx feature wiring
- **[API Reference](../api-reference/README.md)** – Where the bundled OpenAPI lives
- **[Environment configuration](./environment-configuration.md)** – Full controller and frontend environment variable reference (includes import scheduler variables)

## API references

- [Agent Controller OpenAPI](/spec/agent-controller/openapi.yaml) – `/imports/atlassian/connections`, `/imports/atlassian/configs`, run, markers, and connection test paths

---

_For pagination defaults (`limit` / `offset`), response shapes, and error codes, use the OpenAPI specification linked above._
