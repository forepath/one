# Usage Statistics

Usage statistics on the **agent controller** aggregate product-level metrics: how chat and filters are used, how entities change over time, and high-level summaries. They complement **container statistics** (CPU, memory, network), which come from the agent-manager via the chat WebSocket and are documented under [Agent Management](./agent-management.md).

## Overview

Statistics help operators and admins answer questions such as: how much assistant traffic a workspace generated, how often filters dropped or flagged messages, and what entity-level changes occurred in a period. Data is exposed over HTTP on the controller and is integrated with identity-aware aggregation (see the controller application module).

## Per-workspace statistics

Base path pattern: `/api/clients/{id}/statistics/...` (requires access to that client).

| Area              | Purpose                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| **Summary**       | Aggregate counts such as messages, words, characters, and filter-related drops for the workspace |
| **Chat I/O**      | Time-bounded or bucketed chat input and output metrics for usage reporting                       |
| **Filter drops**  | Metrics when messages are dropped by filtering rules                                             |
| **Filter flags**  | Metrics when messages are flagged rather than dropped                                            |
| **Entity events** | Auditable-style entity change events relevant to statistics dashboards                           |

Global equivalents exist under `/api/statistics/...` for cross-workspace views where your role allows aggregated access (see OpenAPI for query parameters such as optional `clientId` scoping).

## Who can access what

- **Client-scoped routes** – Same client access rules as other controller APIs (plus admin visibility where documented).
- **Global routes** – Intended for administrators or roles that may see aggregates across accessible clients; exact behavior is defined in the OpenAPI descriptions for each operation.

## Relationship to container stats

| Concern                  | Source                                                              | Typical use                                                                                                                |
| ------------------------ | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Usage statistics**     | Agent controller HTTP API                                           | Dashboards, billing-adjacent usage, compliance reporting                                                                   |
| **Container statistics** | Agent manager WebSocket (`containerStats` forwarded via controller) | Live health of a running agent container (default poll every 15s on the manager; see `CONTAINER_STATS_SCHEDULER_INTERVAL`) |

## Related documentation

- **[Backend Agent Controller](../applications/backend-agent-controller.md)** – Endpoint group listing
- **[Agent Management](./agent-management.md)** – Container stats and agent lifecycle
- **[Authentication](./authentication.md)** – Roles and access modes

## API reference

- [Agent Controller OpenAPI](/spec/agent-controller/openapi.yaml) – `/clients/{id}/statistics/*` and `/statistics/*`

---

_For response schemas and query parameters, refer to the OpenAPI specification._
