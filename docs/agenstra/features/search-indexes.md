# Search indexes (Agenstra)

Agenstra Controller uses **OpenSearch** for list and typeahead search across workspaces, tickets, knowledge, rules, audit statistics, deployment workflows and runs, Atlassian import configs, and related entities. Indexes are populated by live mutation sync and periodic BullMQ reindex jobs (`search-reindex.coordinator` / `.unit`).

**Workspace file corpora** (`agenstra-workspace-files`) are a separate index on the **same controller OpenSearch** instance. They are driven by agent-manager change notifications (not by the entity reindex jobs). See [Workspace code search](./workspace-code-search.md).

Search queries always scope by authenticated client/workspace access (fail closed). When OpenSearch is unavailable or returns zero hits (empty/unindexed data, numeric/substring gaps), list and statistics endpoints fall back to SQL `ILIKE` or in-memory filtering where applicable. Workspace code search does **not** fall back to ripgrep when OpenSearch is disabled.

**Instance-scoped catalogs:** `opencode-providers`, `opencode-mcp-servers` and `deployment-connections` (CI/CD connections, admin list only) are indexed without a workspace id (`instanceScoped: true`). List endpoints use OpenSearch when enabled, then hydrate Postgres rows in hit order; otherwise they use ILIKE on catalog columns. Catalog refresh jobs bulk-upsert search documents and delete removed ids/names.

**Workspace deployments:** `deployment-workflows` and `deployment-runs` are workspace-scoped (workflows: name, description, repository, provider workflow, default ref, connection; runs: run and workflow name, status, ref, commit, provider run id); `deployment-connections` covers label, provider and base URL. Connection secrets, workflow default inputs, run inputs and logs are never indexed. Live create / update / delete hooks keep the documents current, the reindex jobs rebuild them, and list endpoints fall back to `ILIKE`. See [Deployments](./deployment.md#search).

## Console list UX

Agent console lists (workspaces/clients, environments/agents, and related tables) use **infinite scroll** where applicable: first page on entry, then append on scroll with `fpcInfiniteScroll` and `fpc-list-append-footer` from `@forepath/shared/frontend/ui-components`. Append errors pause loading until retry. Ticket board lane cards use CDK virtual scroll.

### Search pattern

Search boxes debounce (~300ms) and call list/tree APIs with a `search` query parameter. Global ticket and knowledge search query the API without replacing the full board load; workspace/client and agent pickers reload limited results via `search`. Audit/statistics keep the existing server-side `search` path. Per-lane ticket filters and some relation/parent typeaheads may still filter already-loaded rows locally.

## Configuration

See [environment configuration](../deployment/environment-configuration.md) and [system requirements](../deployment/system-requirements.md).

Provisioned `agenstra-controller` stacks deploy a single-node OpenSearch container on the compose network only (no host port). Cloud-init sets `vm.max_map_count=262144` so mmapfs can start. Existing hosts need a stack update (or re-provision) to pick up the service.

## Webhook events

- `search.reindex.started`
- `search.reindex.completed`
- `search.reindex.failed`
- `search.document.sync_failed`

Instance dependency health includes an `opensearch` field on updates/status profiles.
