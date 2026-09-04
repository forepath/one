# Search indexes (Decabill)

Decabill Manager uses **OpenSearch** for list and typeahead search across billing entities. Indexes are populated by:

1. **Live sync** on create/update/delete of searchable entities.
2. **Periodic BullMQ reindex** (`search-reindex.coordinator` / `.unit`) so upgrades from older versions fill indexes without manual steps.

Search queries always apply tenant/user authorization filters server-side. When OpenSearch is disabled, unreachable, or returns zero hits (empty/unindexed data, numeric/substring gaps), list endpoints fall back to SQL `ILIKE` on allowlisted fields. Queries combine `simple_query_string` with case-insensitive wildcards (including `.keyword` multi-fields) so partial numbers and codes match.

## Console list UX

Customer and admin console lists use **infinite scroll** where applicable: the first page loads immediately; further pages append on scroll via `sharedInfiniteScroll` and `shared-list-append-footer`. Append failures pause scrolling until the user retries. Lane boards use CDK virtual scroll for card rows.

### Search pattern

List and typeahead search boxes debounce (~300ms) and call list APIs with a `search` query parameter. NgRx keeps `search` in list params so infinite-scroll `loadMore` reuses it. Results come from OpenSearch (`searchIds` + entity hydrate) with `ILIKE` fallback. Typeaheads use `limit=20`. Board global ticket search queries the tickets list with `search` (and `projectId`); per-lane board filters may still filter already-loaded rows locally.

Summary KPI bars (subscriptions, overview, admin contracts) use dedicated summary/count endpoints (`GET /subscriptions/summary`, `GET /projects/summary`, `GET /admin/billing/summary`) so totals are not derived from the currently loaded list page.

Customer promotions active/history lists use `search` with SQL `ILIKE` on joined promotion fields (redemptions are not a separate OpenSearch entity).

Admin and customer offer lists index `offers` documents (`offerNumber`, `status`, `userEmail`, `userId`, `id`) with the same OpenSearch + `ILIKE` fallback pattern. See [Offers](./offers.md).

## Configuration

See [environment configuration](../deployment/environment-configuration.md) and [system requirements](../deployment/system-requirements.md) for `OPENSEARCH_*` and sizing.

Provisioned `decabill-billing` stacks deploy a single-node OpenSearch container on the compose network only (no host port). Cloud-init sets `vm.max_map_count=262144` so mmapfs can start. Existing hosts need a stack update (or re-provision) to pick up the service.

## Webhook events

- `search.reindex.started`
- `search.reindex.completed`
- `search.reindex.failed`
- `search.document.sync_failed`

Instance dependency health includes an `opensearch` field on updates/status profiles.
