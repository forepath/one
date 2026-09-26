# Search indexes (Agenstra)

Agenstra Controller uses **OpenSearch** for list and typeahead search across workspaces, tickets, knowledge, rules, audit statistics, deployments, Atlassian import configs, and related entities. Indexes are populated by live mutation sync and periodic BullMQ reindex jobs (`search-reindex.coordinator` / `.unit`).

**Workspace file corpora** (`agenstra-workspace-files`) are a separate index on the **same controller OpenSearch** instance. They are driven by agent-manager change notifications (not by the entity reindex jobs). See [Workspace code search](./workspace-code-search.md).

Search queries always scope by authenticated client/workspace access (fail closed). When OpenSearch is unavailable or returns zero hits (empty/unindexed data, numeric/substring gaps), list and statistics endpoints fall back to SQL `ILIKE` or in-memory filtering where applicable. Workspace code search does **not** fall back to ripgrep when OpenSearch is disabled.

## Console list UX

Agent console lists (workspaces/clients, environments/agents, filter rules, and related tables) use **infinite scroll** where applicable: first page on entry, then append on scroll with `fpcInfiniteScroll` and `fpc-list-append-footer` from `@forepath/shared/frontend/ui-components`. Append errors pause loading until retry. Ticket board lane cards use CDK virtual scroll.

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
