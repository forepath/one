# Container Manager

First-party Decabill addon module that surfaces Docker host insights (containers, resource usage, overlay networking) on the [service details](./service-details.md) page for integrated (Docker-host) stacks.

Container Manager is a **first-party contributor module**: Nest HTTP lives in `ContainerManagerContributorModule` (imported before listen), and the console tab/NgRx live in `containerManagerContributorUi`. REST paths, operationIds, and authz are unchanged. Plugin HTTP for other contributors is env-loaded; this UI is compile-time baked in.

## Overview

| Aspect       | Detail                                                                        |
| ------------ | ----------------------------------------------------------------------------- |
| Catalog key  | `container-manager`                                                           |
| Module key   | `container-manager`                                                           |
| Type         | `module` (first-party contributor; also loadable via `DYNAMIC_ADDON_MODULES`) |
| Service tab  | `id: container-manager`, label `Container Manager`, `order: 100`              |
| Provisioning | `provision` / `teardown` are no-ops (Docker already on integrated host)       |
| Pricing      | Catalog seed uses free monthly base price (`0`) by default                    |

Plans with integrated provisioning auto-attach Container Manager as **allowed and mandatory**. See [Addons — Plan linkage](./addons.md#plan-linkage).

## REST API

Requires an **active** subscription addon with `moduleKey: container-manager`, plus a reachable public IP and item SSH private key.

| Audience | Method | Path                                                                                                      | Scope                 |
| -------- | ------ | --------------------------------------------------------------------------------------------------------- | --------------------- |
| Customer | GET    | `/subscriptions/{subscriptionId}/items/{itemId}/container-manager/containers`                             | `subscriptions:read`  |
| Customer | GET    | `/subscriptions/{subscriptionId}/items/{itemId}/container-manager/containers/{containerId}/stats-history` | `subscriptions:read`  |
| Customer | GET    | `/subscriptions/{subscriptionId}/items/{itemId}/container-manager/containers/{containerId}/logs`          | `subscriptions:read`  |
| Customer | GET    | `/subscriptions/{subscriptionId}/items/{itemId}/container-manager/networks`                               | `subscriptions:read`  |
| Admin    | GET    | `/admin/billing/subscriptions/{subscriptionId}/items/{itemId}/container-manager/...` (same suffixes)      | `subscriptions:admin` |

Response shapes match OpenAPI `ContainerManagerContainersResponse`, `ContainerManagerStatsHistoryResponse`, `ContainerManagerLogsResponse`, and `ContainerManagerNetworksResponse`.

Item detail may embed a lightweight `containerManager` summary (`containerCount`, `healthyCount`, `lastCollectedAt`) from the last successful **worker** collection (`billing_container_stats_summaries`). Counts stay at `0` until the first collect-stats run.

## Periodic collection

Graph samples are **not** collected when the Container Manager tab or stats-history endpoint is opened. A builtin contributor job `collect-stats` on the `container-manager` addon module runs on the billing BullMQ worker:

| Piece                | Detail                                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------------------------- |
| Dispatcher           | Repeatable `contributor-collect.coordinator` fans out per-tenant `contributor-collect.unit`              |
| Coordinator interval | `BILLING_CONTRIBUTOR_COLLECT_INTERVAL` (default `30000`)                                                 |
| Disable              | `BILLING_CONTRIBUTOR_COLLECT_ENABLED=false`                                                              |
| Job interval         | `BILLING_CONTAINER_MANAGER_COLLECT_INTERVAL` (default `60000`, clamped 15s–24h)                          |
| SSH concurrency      | `BILLING_CONTAINER_MANAGER_COLLECT_CONCURRENCY` (default `3`)                                            |
| Persistence          | `billing_container_stats_samples` (60 points per item+container) and `billing_container_stats_summaries` |

Eligibility (fail closed): live subscription status, `provisioningStatus === active`, provider reference, literal public IPv4/IPv6, SSH key, and an **active** `container-manager` module addon. Custom CloudInit hosts are included only when that addon is on the subscription.

`GET .../stats-history` reads cached samples (authz + hex container id only). Empty `points` is valid before the first successful job (including the window after create, before the host is provisioned). Live table/topology/logs still use on-demand SSH (`listContainers` / `listNetworks` / `getLogs`) and do **not** append graph history.

The Container Manager tab polls stats-history about every 30s while open (same cancel pattern as log polling).

## SSH collection

On-demand REST collection (containers, logs, networks) runs as `root` on port 22 using the provisioning SSH key and the item’s cached public IP:

1. Wait until the host is reachable
2. Run read-only Docker CLI (`docker ps`, `docker stats --no-stream`, `docker logs --timestamps --tail`, `docker network ls` / `inspect`)
3. For the network map, also run read-only host networking (`ip -j addr`, `ip -j route`) when available; merge host interfaces, default gateway, and an `internet` egress node into the Docker topology (fail soft to Docker-only if `ip` is unavailable)
4. Parse NDJSON / JSON / log text into DTOs; cap log payload size for the UI
5. On failure, return a generic client error and publish `addon.collection_failed`

The worker collect-stats path reuses the same docker `ps` + `stats --no-stream` parsing, writes samples, and publishes the same webhook on SSH failure (it does not throw to HTTP clients).

No mutating Docker commands are issued. Script output and private keys are never included in webhook payloads, `last_error`, or customer-facing messages.

The Container Manager tab loads logs when a container is selected and refreshes them on a short REST poll interval (logstream-style without a dedicated websocket).

## Security

- Customer routes require subscription ownership; missing ownership returns 404 (no existence leak)
- Access requires the same live subscription statuses as service details (`active`, `pending_cancel`, `pending_withdrawal`, `pending_instant_cancel`, `pending_config_change`, `pending_backorder`) and an active provisioned item
- Admin routes require ADMIN + `subscriptions:admin`; ownership is not required
- Endpoints 404 when Container Manager is not active on the subscription
- Collection failures use a generic message (`Unable to collect container information`); details stay in server logs only
- SSH private keys remain server-side; Container Manager responses never include them
- SSH targets must be literal IPv4/IPv6 from the server-info snapshot; docker network names are single-quote escaped and reject null/newline bytes; stats-history container IDs must be hex docker IDs

## Realtime

Primary delivery is **REST polling** from the Container Manager tab. AsyncAPI documents an optional future push event `billing/containerManagerUpdate` for room `subscription:{id}:container-manager` aligned with the containers summary. Until the gateway emits it, clients should keep polling REST.

## Notifications

| Event                     | Channel            | When                                     |
| ------------------------- | ------------------ | ---------------------------------------- |
| `addon.collection_failed` | Webhook (no email) | SSH/Docker collection failed for an item |

Payload includes subscription/plan/addon identifiers, `itemId`, and a generic `errorMessage`. Config snapshots and secrets are never included. See [Webhooks](./webhooks.md).

## Related

- [Addons](./addons.md)
- [Service details](./service-details.md)
- [Server provisioning](./server-provisioning.md)
