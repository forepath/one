# Atlassian connections

The agent controller can **import work from Atlassian Cloud** into Agenstra using stored **Atlassian connections** (site + credentials) and **import configurations** that describe what to pull and where to attach it. Imports create or update **workspace tickets** and **knowledge pages** on the controller; they do not run inside agent containers.

Atlassian connections are managed under **Connections → Atlassian** in the console (`/connections/atlassian`), next to the CI/CD deployment connections (`/connections/deployments`).

## Overview

- **Atlassian connections** Per-controller records for an Atlassian site: base URL plus credentials of one of two [auth variants](#authentication-variants). Secrets (API tokens, OAuth client secrets) are stored AES-256-GCM encrypted for server-side use only; list and detail APIs never return them, and they are not indexed for search. Each connection also stores the result of its last **connection test** (`lastTestStatus` `untested` / `ok` / `failed`, `lastTestMessage`, `lastTestedAt`), shown as a status badge in the console.
- **Import configurations** Each config binds a connection to a **workspace** (`clientId`), an import **kind** (`jira` or `confluence`), optional query scope (JQL, board id, CQL, space key, etc.), and optional **parent** targets in Agenstra (parent ticket for Jira swimlanes, parent folder for Confluence pages). Configs can be enabled or disabled; each run records `lastRunAt` and `lastError` when applicable.
- **Provider model** Today the registered provider is **Atlassian** (`atlassian`). The controller uses a small factory so additional providers could be added later without changing the HTTP surface. Register extra import backends with `DYNAMIC_CONTEXT_IMPORT_PROVIDERS` (see [Dynamic provider plugins](./dynamic-provider-plugins.md)).
- **Execution** A periodic **scheduler** loads enabled configs in batches and invokes the provider with an **item budget** per tick. Admins can also **run** a single config on demand from the console or `POST` the run endpoint.

## Authentication variants

| `authType`      | Credentials                                                      | How the controller calls Atlassian                                                                                                                                                                                                                                             |
| --------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `app` (default) | OAuth 2.0 **client id** + **client secret** of a service account | `POST https://auth.atlassian.com/oauth/token` (`grant_type=client_credentials`), cloud id from `GET {site}/_edge/tenant_info`, REST via `https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/...` and `https://api.atlassian.com/ex/confluence/{cloudId}/wiki/rest/api/...` |
| `token`         | Account **email** + **API token**                                | HTTP Basic against the site URL (`{site}/rest/api/3/...`, `{site}/wiki/rest/api/...`)                                                                                                                                                                                          |

- **`app`** is the recommended variant: the import runs as a dedicated **Atlassian service account** that only sees what you grant it, and its credential is not tied to a person. Access tokens are cached in memory until one minute before they expire (per connection; editing the connection invalidates the cache). The resolved cloud id is cached on the connection (`cloudId`) and re-resolved when the site URL changes. `app` requires an Atlassian **Cloud** site.
- **`token`** uses a personal (or service account) API token with HTTP Basic auth. It also works against Jira / Confluence Server and Data Center base URLs. Connections created before auth variants existed are `token` connections.
- **Switching** the auth type of an existing connection requires the credentials of the new type. When editing without switching, leaving a secret empty keeps the stored one. Changing the site URL or credentials resets the test status to `untested`.
- **Testing** (`POST /api/connections/atlassian/connections/{id}/test`) obtains credentials as above and calls Jira `/rest/api/3/myself`; if Jira rejects the call (for example a Confluence-only service account), it tries Confluence `/rest/api/space`. The outcome is persisted on the connection. Error messages contain HTTP status codes and OAuth error codes only, never credentials or upstream response bodies.

### Setting up an Atlassian service account OAuth credential (`app`)

1. In **Atlassian Administration** (`admin.atlassian.com`) of your organization, open **Directory → Service accounts** and **create a service account** (for example `agenstra-import`).
2. Give the service account **product access** to Jira and/or Confluence of the site you want to import from, and grant it access to the projects and spaces it should read (project roles / space permissions, like any other user).
3. On the service account, **create a credential** of type **OAuth 2.0** (client credentials). Select the **scopes** the import needs, at least:
   - Jira: `read:jira-work` and `read:jira-user` (issue search, board issues, connection test), plus `read:board-scope:jira-software` / `read:issue-details:jira` when you import through board ids.
   - Confluence: `read:confluence-content.all` and `read:confluence-space.summary` (CQL search, page bodies, connection test), or the granular equivalents (`read:content:confluence`, `read:page:confluence`, `read:space:confluence`, `search:confluence`).
4. Copy the **client id** and **client secret** (the secret is shown once).
5. In the console, open **Connections → Atlassian**, **create a connection**, keep **OAuth (service account)** selected, enter the site URL (`https://your-site.atlassian.net`), client id and client secret, save, and run **Test**.

Credential expiry and rotation are managed in Atlassian Administration; after rotating, edit the connection and enter the new client secret.

### Using an API token (`token`)

1. Sign in as the account the import should use and create an API token at `https://id.atlassian.com/manage-profile/security/api-tokens`.
2. In the console, create a connection, select **API token**, and enter the site URL, the account email and the token.

## Why controller-native?

Tickets and knowledge trees already live on the controller ([Tickets and Workspaces](./tickets-and-workspaces.md)). Import reuses those services so imported issues and pages participate in the same APIs, permissions, and (for tickets) realtime board behavior as manually created content.

## Access control

- **HTTP** All routes under `/api/connections/atlassian` require the same **admin check** as the global [agent configuration](./agent-configuration.md): the user must be a **global admin** (`UserRole.ADMIN`) unless the request is authenticated as an **API key** (`isApiKeyAuth`), in which case the role check is bypassed for trusted automation. Personal access tokens additionally need the **`connections:admin`** scope ([Authentication](./authentication.md)).
- **Console** Route **`/connections/atlassian`** uses `authGuard` and `adminGuard` (same predicate as `/filters` and user management). The sidebar **Connections** entry is shown only when that admin predicate is true.

Non-admin interactive users receive **403** from the API and cannot open the admin UI for import settings.

## Jira vs Confluence

- **Jira** Imports issues matched by the configured scope (for example JQL and optional board hints) into the ticket model, including description conversion where supported (ADF and wiki-style markup are normalized toward markdown for storage).
- **Confluence** Imports pages matched by CQL / structure rules into the knowledge tree under the chosen parent folder when configured. Confluence **storage HTML** and wiki markup are converted toward markdown for imported page bodies.

Exact field matrices and validation rules are defined in the OpenAPI DTOs (`CreateExternalImportConfigDto`, `UpdateExternalImportConfigDto`, etc.).

## Queue jobs and manual runs

**Context import** uses BullMQ: a repeatable coordinator enqueues one unit job per enabled config (see [Background jobs](../deployment/background-jobs.md)). Relevant environment variables (defaults shown where applicable):

| Variable                                | Role                                                                                                               |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `CONTEXT_IMPORT_SCHEDULER_INTERVAL_MS`  | Coordinator repeat interval in milliseconds (`120000` default). Set to `0` or less to **disable** the coordinator. |
| `CONTEXT_IMPORT_SCHEDULER_CONFIG_BATCH` | Maximum enabled configs enqueued per coordinator tick (`3` default).                                               |
| `CONTEXT_IMPORT_ITEM_BUDGET`            | Soft cap on work items processed per config per unit job (`25` default).                                           |

Admins may trigger **`POST /api/connections/atlassian/configs/{id}/run`** (HTTP 202) to run one config immediately without waiting for the next coordinator tick.

To disable import execution entirely (for example in a staging environment), set **`ATLASSIAN_IMPORT_DISABLED=true`**. The provider then returns a no-op result for import runs while connections and configs remain manageable via the API.

## Sync markers and cleanup

Imports use **sync markers** in the controller database to avoid duplicate creates and to relate Atlassian entities to Agenstra tickets and knowledge nodes. When you delete an imported ticket or page, you can optionally **release** the marker so a future import can recreate the item; the console and REST layers expose this as a query flag on delete (see OpenAPI for ticket and knowledge-tree `DELETE` operations and the `releaseExternalSyncMarker` query parameter).

Admins can **clear all markers** for a config via **`DELETE /api/connections/atlassian/configs/{id}/markers`** when a full re-import from scratch is desired (destructive to idempotency until the next successful runs).

## Console entry points

- Route **`/connections/atlassian`** (**Connections → Atlassian**) admin: connections with auth variant and connection status, import configs, test connection, run, clear markers, modals for create/edit/delete (see [Frontend Agent Console](../applications/frontend-agent-console.md)).

Boards do not embed full import administration; operators manage imports from this route.

## Related documentation

- **[Tickets and Workspaces](./tickets-and-workspaces.md)** Target model for Jira imports
- **[Agent Configuration](./agent-configuration.md)** Same admin / API-key authorization pattern on the controller
- **[Authentication](./authentication.md)** Roles and authentication modes
- **[Dynamic provider plugins](./dynamic-provider-plugins.md)** `DYNAMIC_CONTEXT_IMPORT_PROVIDERS` and shared loader behavior
- **[Backend Agent Controller](../applications/backend-agent-controller.md)** Nest application and `/api` prefix
- **[Frontend Agent Console](../applications/frontend-agent-console.md)** Routes and NgRx feature wiring
- **[API Reference](../api-reference/README.md)** Where the bundled OpenAPI lives
- **[Environment configuration](../deployment/environment-configuration.md)** Full controller and frontend environment variable reference (includes import scheduler variables)

## API references

- [Agent Controller OpenAPI](/spec/agent-controller/openapi.yaml) `/connections/atlassian/connections`, `/connections/atlassian/configs`, run, markers, and connection test paths

---

_For pagination defaults (`limit` / `offset`), response shapes, and error codes, use the OpenAPI specification linked above._
