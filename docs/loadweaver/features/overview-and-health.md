# Overview and health

The overview answers "is everything all right, and if not, what do I do next?". It is built on the **explained health tree**: every entity of the cluster has a state and the reasons for it, parents are rolled up from their children by rules, and every change of state is recorded, so you can later ask how long something was at risk.

## The health tree

Two trees, evaluated together:

- **Infrastructure**: cluster → site → node
- **Workloads**: project → deployment → service → replica, with the deployment's volumes next to its services

Every entity has a key (`cluster`, `site/fra`, `node/n3`, `project/shop`, `deployment/shop/web`, `service/shop/web/api`, `replica/<id>`, `volume/shop/web/data`), a state and a list of reasons.

| State      | Meaning                                                                          |
| ---------- | -------------------------------------------------------------------------------- |
| `healthy`  | Works as intended                                                                |
| `degraded` | Works, but with less than it should have (a replica down, a node in maintenance) |
| `at-risk`  | Works fully, but one more failure takes something down                           |
| `failed`   | Doesn't work                                                                     |
| `unknown`  | Nothing reported yet                                                             |

For headlines the order is `failed` > `at-risk` > `degraded` > `unknown` > `healthy`.

### Own rules of each entity

| Entity  | Rule                                                                                                                                                                                                                                                                                                                                                                                            |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node    | Never reported: `unknown`. Disconnected or no heartbeat within the timeout: `failed`. Draining or leaving: `degraded`. Memory or disk use ≥ 90 %: `at-risk`.                                                                                                                                                                                                                                    |
| Replica | On a failed node: `failed`. Running, or exited with code 0: `healthy`. Restarting or created: `degraded`. Anything else (dead, non-zero exit): `failed`. No status yet: `unknown`. Cron runs are left out.                                                                                                                                                                                      |
| Service | Rolled up from its replicas. A healthy service with at least 2 replicas that all run in one site, while the cluster has more sites: `at-risk` (`single-site`).                                                                                                                                                                                                                                  |
| Volume  | Primary on a failed node: `degraded` if a synchronous replica is up to take over, otherwise `failed`. A replica on a failed node: `degraded`. No copy outside its site while the cluster has more sites: `at-risk`.                                                                                                                                                                             |
| Project | Rolled up from its deployments; a failed rollback that touched the project makes it at least `at-risk`. Projects without deployments are `healthy`.                                                                                                                                                                                                                                             |
| Cluster | Control-plane quorum lost (members and witnesses that are up < majority): `failed`. One or more voters down but the quorum holds: `at-risk`. A site down: `degraded` (`failed` if every site is down). Nodes down outside a failed site: `degraded`. Not enough free memory to absorb the largest node (N+1): `at-risk`. Volumes at risk, failed rollbacks: `at-risk`. No sites yet: `unknown`. |

### Roll-up rules

Parents (site, service, deployment, project) are **not** "worst child wins":

| Children                    | Parent     |
| --------------------------- | ---------- |
| none                        | `healthy`  |
| all `unknown`               | `unknown`  |
| all known children `failed` | `failed`   |
| some `failed` or `degraded` | `degraded` |
| otherwise any `at-risk`     | `at-risk`  |
| otherwise                   | `healthy`  |

Children in `unknown` don't count. One of three replicas failing makes the service degraded, not failed; a site with one node down is degraded.

### Reasons

Every reason has a machine-readable `code`, a sentence and, where it applies, the keys of the entities behind it:

```json
{
  "key": "service/shop/web/api",
  "kind": "service",
  "name": "api",
  "parent": "deployment/shop/web",
  "project": "shop",
  "state": "degraded",
  "reasons": [{ "code": "replicas-failed", "message": "1 of 3 replicas failed", "entities": ["replica/9b1f…"] }],
  "since": "2026-10-18T08:13:30.000Z"
}
```

Codes include `node-down`, `never-reported`, `maintenance`, `memory-full`, `disk-full`, `replica-down`, `restarting`, `created`, `no-status`, `single-site`, `primary-down`, `rollback-failed`, `quorum-lost`, `quorum-reduced`, `site-down`, `nodes-down`, `no-n-plus-1`, `volumes-at-risk`, `no-data` and the roll-ups `<children>-failed`, `<children>-degraded`, `<children>-at-risk` (`nodes`, `replicas`, `parts`, `deployments`).

## Evaluation and history

- Every 30 seconds one control-plane replica (Postgres advisory lock) evaluates the tree from the nodes, placements, volume placements and plans and stores each entity's state with the time it entered it (`since`).
- Every change of state is an event of kind `health` on the timeline (`GET /api/metrics/events`), with the old and new state and the reasons. New entities that start out healthy are no news and aren't recorded.
- `GET /api/health/history?key=…` returns the changes of one entity in a range (default: the last 30 days) and the time spent in each state, in milliseconds — "how long were we at risk last month":

```json
{
  "key": "cluster",
  "changes": [{ "at": "2026-10-02T11:04:00.000Z", "from": "healthy", "to": "at-risk", "message": "cluster: healthy → at-risk (…)" }],
  "durations": { "healthy": 2550000000, "at-risk": 42000000 }
}
```

`GET /api/health` itself stays the liveness check of the API.

## The overview

`GET /api/overview` is one page with four parts:

- **Headline**: the worst root (the cluster for cluster roles, the readable projects for everyone else) with its first reason, e.g. `At risk: 1 control-plane member(s) down; one more failure loses the quorum`.
- **Needs attention**: an inbox, critical items first, then the oldest first, at most 100. Every item links to the console route where it is resolved:

| Item                    | Shown to                                                               | Severity                                 |
| ----------------------- | ---------------------------------------------------------------------- | ---------------------------------------- |
| Failed rollback         | whoever may see the plan                                               | critical                                 |
| Failed / at-risk entity | by health access (below); not when its parent is listed too            | critical for failed, warning for at risk |
| Approval                | operators and admins who may approve (not the plan's author)           | info                                     |
| Unacknowledged pins     | readers of the project                                                 | warning                                  |
| Drift                   | cluster roles                                                          | warning                                  |
| Firing alert            | by alert access; not acknowledged, not silenced                        | the alert's severity                     |
| Certificate             | cluster roles; expiring within 21 days (renewal starts at 30)          | warning                                  |
| Cross-project request   | operators and admins of the requested project (all for cluster admins) | info                                     |
| Git: branch ahead       | readers of the scope (cluster roles for the cluster scope)             | warning                                  |
| Git: push rejected      | readers of the scope                                                   | critical                                 |
| Git: connection error   | readers of the scope                                                   | warning                                  |

- **Summary**: sites, nodes up / total, deployments, CPU and memory in use against the capacity with the N+1 reserve (the largest node's memory), ingress requests per second (last minute), denied packets (last 5 minutes), firing alerts and [SLO](./slos-and-status-pages.md) counts (ok, burning, exhausted).
- **Activity**: the newest 20 events on the timeline.

Project members get the same layout for their projects: the headline of their projects, their part of the inbox, deployments, alerts and SLOs — but no infrastructure numbers (sites, nodes, capacity, traffic and denies are empty). `?project=shop` narrows the overview to one project.

## Who sees what

- Cluster, site and node health is for cluster roles (`cluster-admin`, `infra-operator`, `auditor`, …).
- Project entities (projects, deployments, services, replicas, volumes) are visible to everyone who may read the project.
- `GET /api/health/tree` returns what the caller may see, optionally for one `project` or one `root` entity and its descendants. Entities and projects the caller can't see answer `404`.
- Personal access tokens need `cluster:read` for the overview, the health tree and history.

## Built-in alerts

The health overview adds three [built-in alerts](./alerting.md#built-in-alerts):

| Rule                       | Condition                                                                            | Severity                                    | For                |
| -------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------- | ------------------ |
| `builtin:cluster-at-risk`  | The cluster's health is `at-risk` or `failed`; the message lists every reason        | warning; critical when failed               | 2 min              |
| `builtin:quota-near-limit` | A project uses ≥ 90 % of a quota (CPU, memory, storage, public IPs, published ports) | warning; critical at 100 %                  | —                  |
| `builtin:slo-burn`         | An SLO burns its error budget fast, or has used it up                                | critical when burning; warning when used up | 5 min when burning |

## API

| Request                   | Meaning                                                                                      |
| ------------------------- | -------------------------------------------------------------------------------------------- |
| `GET /api/overview`       | headline, inbox, summary, activity; `project` narrows it                                     |
| `GET /api/health/tree`    | stored health entities; `project`, `root` (an entity key: it and its descendants)            |
| `GET /api/health/history` | `key` (required), `from`, `to` (ISO 8601; default the 30 days before `to`, `to` default now) |

See also [SLOs and status pages](./slos-and-status-pages.md), [Search and wallboard](./search-and-wallboard.md) and [Reports](./periodic-reports.md).

## Not there yet

- Probes from other sites (3.28) and running operations (progress bars) aren't part of the health tree yet.
- Health thresholds (90 % memory / disk, the N+1 rule) can't be tuned.
