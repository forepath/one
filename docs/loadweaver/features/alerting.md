# Alerting

Loadweaver watches the cluster with built-in alerts and with alert rules you declare like any other policy. Alerts go from pending to firing to resolved, can be acknowledged and silenced, and are delivered to webhooks and by email.

## How it runs

- Every 30 seconds one control-plane replica (Postgres advisory lock) evaluates every built-in alert and every `AlertRule`.
- Each rule produces one alert per **key**: the node, replica, certificate, zone, series, … it is about. A rule and key have at most one open alert at a time.
- A source that fails to evaluate (database query, log store down) leaves its open alerts as they are instead of resolving them. Alerts of a deleted `AlertRule` resolve.

## States

| State      | Meaning                                                                                        |
| ---------- | ---------------------------------------------------------------------------------------------- |
| `pending`  | The condition holds, but not yet for the rule's `for`. Nothing is sent.                        |
| `firing`   | The condition held for `for`. The alert is sent, unless silenced.                              |
| `resolved` | The condition is gone. Alerts that were sent announce their resolution to the same recipients. |

A rule with `for: 0s` fires on the first evaluation. A pending alert whose condition goes away resolves quietly.

## Alert rules

An `AlertRule` is a resource like any other: written in YAML, changed by [plan and apply](./plan-and-apply.md), cluster-wide (no `metadata.project`) or per project. A project rule only sees its project's data: metrics with that project (`replica.*`) and the project's log lines.

```yaml
apiVersion: loadweaver.com/v1
kind: AlertRule
metadata: { name: api-memory, project: shop } # without project: cluster-wide
spec:
  description: API replicas close to their memory limit
  severity: warning # info, warning (default), critical
  condition:
    metric:
      name: replica.memory_bytes
      entity: shop/web/api/* # exact entity or a prefix ending in *
      aggregation: max # avg (default), min, max, sum over the window
      over: 5m # window, default 5m, at most 24h
      groupBy: entity # one alert per entity (default), node or none
      op: '>'
      threshold: 900000000
  for: 10m # condition holds this long before firing; default 0s
  repeatEvery: 2h # unacknowledged firing alerts are sent again; default 4h, at least 1m
  notify:
    emails: [oncall@example.com] # up to 20
    webhooks: true # default: publish to webhook endpoints subscribed to alert events
  escalate:
    after: 30m # still unacknowledged this long after firing
    emails: [lead@example.com]
```

The rule's name in alerts is `rule:<project>/<name>`, or `rule:_/<name>` for a cluster-wide rule.

### Conditions

Exactly one of:

**Metric value** — the aggregation of a [metric](./metrics.md) over the window, per group, compared with the threshold:

```yaml
condition:
  metric: { name: node.disk_bytes, groupBy: node, over: 15m, op: '>', threshold: 400000000000 }
```

**Metric change** — `mode: change` compares the change over the window instead: the last per-minute average minus the first. Use it for growth (disk filling up) or drops:

```yaml
condition:
  metric:
    name: ingress.requests_per_s
    entity: shop.example.com
    mode: change
    over: 10m
    op: '<'
    threshold: -50
```

**Absence** — no sample of a metric (for an exact entity, if given) within `for`:

```yaml
condition:
  absence: { metric: replica.cpu_cores, entity: shop/web/api/0, for: 5m }
```

An absence alert fires right away when the window is empty; the rule's top-level `for` doesn't apply.

**Logs** — the number of matching [log lines](./logs.md) over the window:

```yaml
condition:
  logs:
    sources: [container]
    levels: [error]
    service: api
    text: timeout # full text, as in GET /api/logs
    over: 5m
    op: '>='
    threshold: 20
```

A logs rule needs the log store; while it isn't available the rule keeps its alerts.

| Field           | Applies to      | Values                                                     |
| --------------- | --------------- | ---------------------------------------------------------- |
| `name`/`metric` | metric, absence | metric name                                                |
| `entity`        | metric, absence | metric: exact or prefix with `*`; absence: exact           |
| `node`          | metric          | exact node name                                            |
| `aggregation`   | metric          | `avg` (default), `min`, `max`, `sum`; ignored for `change` |
| `mode`          | metric          | `value` (default) or `change`                              |
| `groupBy`       | metric          | `entity` (default), `node`, `none`                         |
| `over` / `for`  | all             | `30s`, `5m`, `1h`, `7d`, …; windows are capped at 24 hours |
| `op`            | metric, logs    | `>`, `>=`, `<`, `<=`                                       |
| `threshold`     | metric, logs    | a number; for logs a whole number ≥ 0                      |

- A metric rule produces at most 200 alerts (series) per evaluation.
- Metric rules read the raw 10-second table.
- Grouping by `node` ties the alert to that node, so it is quiet while the node is in maintenance.

## Built-in alerts

| Rule                                  | Condition                                                                                                                                                                                                                                                                                                       | Severity                                    | For                |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------ |
| `builtin:node-down`                   | A node (not left) is disconnected or hasn't reported for 60 seconds                                                                                                                                                                                                                                             | critical                                    | 1 min              |
| `builtin:node-protocol-refused`       | The control plane refused to send a node a message its agent can't take (a field such as an [isolation level](./isolation-levels.md#protocol-safety) the agent doesn't support) in the last 15 minutes; the node keeps its previous desired state until its agent is updated or the workload moves (key = node) | critical                                    | —                  |
| `builtin:replica-lost`                | A replica is dead or exited with a non-zero code (cron runs and migrations excluded)                                                                                                                                                                                                                            | warning                                     | 2 min              |
| `builtin:failover`                    | A DNS failover switched in the last 15 minutes; resolves by itself after that                                                                                                                                                                                                                                   | info                                        | —                  |
| `builtin:capacity`                    | A node uses ≥ 95 % of its CPU, ≥ 90 % of its memory or disk (key `<node>/<resource>`)                                                                                                                                                                                                                           | warning; critical from 98 %                 | 5 min              |
| `builtin:certificate-expiring`        | An ingress certificate expires within 14 days (renewal normally happens at 30), a node certificate within 7                                                                                                                                                                                                     | warning; critical within 3 days             | —                  |
| `builtin:dns-drift`                   | A DNS provider or secondary is out of sync with its zone, or failing                                                                                                                                                                                                                                            | warning                                     | 10 min             |
| `builtin:rollback-failed`             | A plan failed and its rollback failed too; resolves once a fix-forward plan applies                                                                                                                                                                                                                             | critical                                    | —                  |
| `builtin:audit-chain-broken`          | The [audit log](./audit-log.md) hash chain doesn't verify, or an [anchor](./audit-and-export.md#anchoring-the-chain-head) disagrees with it (checked hourly)                                                                                                                                                    | critical                                    | —                  |
| `builtin:denies-spiking`              | Denied packets in the last 5 minutes are at least 10× the usual 5 minutes of the last day, and at least 1,000                                                                                                                                                                                                   | warning                                     | —                  |
| `builtin:cluster-at-risk`             | The cluster's [health](./overview-and-health.md) is at risk or failed; the message lists every reason                                                                                                                                                                                                           | warning; critical when failed               | 2 min              |
| `builtin:quota-near-limit`            | A project uses ≥ 90 % of a quota (CPU, memory, storage, public IPs, published ports; key `<project>/<resource>`)                                                                                                                                                                                                | warning; critical from 100 %                | —                  |
| `builtin:slo-burn`                    | A service's [SLO](./slos-and-status-pages.md) burns its error budget at 14.4× or more over the last hour, or the budget of its window is used up (key `<project>/<deployment>/<service>`)                                                                                                                       | critical when burning; warning when used up | 5 min when burning |
| `builtin:autoscale-blocked`           | An [autoscaled](./autoscaling.md) service wants more replicas than it may run: at `max`, or limited by the project quota, the cluster capacity or the N+1 reserve (key `<project>/<deployment>/<service>`)                                                                                                      | warning                                     | 5 min              |
| `builtin:device-restricted`           | A remote access device fails [posture](./device-posture.md) checks and is in its restricted group; the message lists the reasons (key `vpn/<device id>`)                                                                                                                                                        | info                                        | —                  |
| `builtin:posture-integration-failing` | A [posture integration](./device-posture.md#integrations) failed three syncs in a row; its results count as unknown after `maxAgeMinutes` (key `posture/<name>`)                                                                                                                                                | warning                                     | —                  |

- Firing alerts are also counted per severity in the OpenTelemetry gauge `loadweaver.alerts.firing` ([Audit and export](./audit-and-export.md#opentelemetry)).
- Built-in alerts are sent to every webhook subscribed to alert events and to `Cluster.spec.observability.alertEmails`. They repeat every 4 hours while unacknowledged.
- Replica, quota and SLO alerts belong to their project; a failed rollback belongs to its project when it touched exactly one. All others are cluster alerts.

```yaml
apiVersion: loadweaver.com/v1
kind: Cluster
metadata: { name: cluster }
spec:
  observability:
    alertEmails: [ops@example.com] # up to 20
```

## Acknowledging, repeating, escalating

- **Acknowledge**: `POST /api/alerts/{id}/acknowledge` on a firing alert records who did it (audited) and stops repeats and escalation until the alert resolves. It publishes `alert.acknowledged` to webhooks. A new alert for the same rule and key starts unacknowledged.
- **Repeat**: a firing, unacknowledged, unsilenced alert is sent again every `repeatEvery` (built-in: 4 hours).
- **Escalate**: once per alert, `escalate.emails` also get the alert when it is still unacknowledged and unsilenced `escalate.after` after it fired.

## Silences and maintenance

A silence keeps matching alerts quiet: they still move between states and show up in `GET /api/alerts` (with `silenced: true`), but nothing is sent, repeated or escalated.

```bash
curl https://<control-plane>/api/alerts/silences \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"rule": "builtin:node-down", "key": "n3", "reason": "RAM replacement", "endsAt": "2026-10-18T14:00:00Z"}'
```

| Field      | Meaning                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------- |
| `rule`     | rule name (`builtin:node-down`, `rule:shop/api-memory`) or a prefix ending in `*` (`rule:shop/*`) |
| `project`  | only alerts of this project                                                                       |
| `key`      | only alerts with this key (node name, replica id, …)                                              |
| `reason`   | required                                                                                          |
| `startsAt` | default now                                                                                       |
| `endsAt`   | required; at most 30 days ahead                                                                   |

- A silence needs at least one of `rule`, `project`, `key`; every field it sets has to match.
- `DELETE /api/alerts/silences/{id}` ends a silence now; it stays as history. Creating and ending silences are audited.
- **Maintenance**: alerts about a node that is draining or leaving (node down, capacity, node certificate, replica lost on it, custom rules grouped by node) are quiet as well.
- An alert that fired while quiet is sent once the silence or maintenance ends, if it is still firing. Only alerts that were sent announce their resolution.

## Delivery

Alerts go through the shared notifications feature, queued and retried per member:

- **Webhooks**: endpoints are managed under `/api/admin/webhooks` (cluster admins: the API key, interactive global admins and members with the `cluster-admin` role; personal access tokens of cluster-admin members also need the `webhooks:admin` scope). Subscribe to `alert.firing`, `alert.resolved`, `alert.acknowledged` (and `plan.applied`, `plan.rolled-back`, `plan.rollback-failed`). Each request is signed (`Forepath-Signature`) and carries `Forepath-Event-Id`; deliveries are listed per endpoint. The event's `data.object` carries `id`, `rule`, `key`, `project`, `severity`, `title`, `message`, `value`, `startedAt` (plus `resolvedAt` / `acknowledgedBy`).
- **Email**: templates `alert-firing` (subject `[SEVERITY] title`) and `alert-resolved` (subject `[RESOLVED] title`), one email per recipient, through the configured SMTP server.
- **Queue**: every control-plane member runs a Valkey (`lw-queue`) on loopback port 6391, persisted in `/var/lib/loadweaver/queue` and protected by a password the agent generates once per member (kept with mode 0600 in its state directory, handed to the API as `REDIS_PASSWORD`); its API processes the deliveries. An alert counts as sent once its deliveries are queued.

## Who may do what

| Caller                            | Read                                  | Acknowledge / silence                                    |
| --------------------------------- | ------------------------------------- | -------------------------------------------------------- |
| `cluster-admin`, `infra-operator` | every alert and silence               | every alert                                              |
| `auditor`                         | every alert and silence               | —                                                        |
| project `operator`, `admin`       | alerts and silences of their projects | alerts of their projects; silences must name the project |
| other project members             | alerts and silences of their projects | —                                                        |

- Cluster alerts (without a project) and silences without a project are for cluster roles only.
- An alert or silence the caller can't see answers `404`; seeing but not managing answers `403`.
- Personal access tokens need `alerts:read` to list and export, `alerts:write` to acknowledge and silence.

## API

| Request                             | Meaning                                                                                                                                                                    |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/alerts`                   | `state=open` (default, pending and firing), `resolved` or `all`; `project`; `limit` 1–1,000, default 200; newest first                                                     |
| `GET /api/alerts/export`            | the same filters (`state` defaults to `all`, `limit` to 1,000) plus `format`: `csv` (default) or `json`, as an attachment ([CSV safety](./audit-and-export.md#csv-safety)) |
| `POST /api/alerts/{id}/acknowledge` | acknowledge a firing alert                                                                                                                                                 |
| `GET /api/alerts/silences`          | active and upcoming silences; `expired=true` includes ended ones                                                                                                           |
| `POST /api/alerts/silences`         | create a silence                                                                                                                                                           |
| `DELETE /api/alerts/silences/{id}`  | end a silence                                                                                                                                                              |

An alert:

```json
{
  "id": "0f8e2c1a-5b7d-4c3e-9a10-6d2f4b8e1c55",
  "rule": "builtin:node-down",
  "key": "n3",
  "project": null,
  "severity": "critical",
  "state": "firing",
  "title": "Node n3 is down",
  "message": "Node n3 (site fra) has not reported since 2026-10-18T08:12:40.000Z.",
  "value": null,
  "startedAt": "2026-10-18T08:13:30.000Z",
  "firedAt": "2026-10-18T08:14:30.000Z",
  "resolvedAt": null,
  "silenced": false,
  "acknowledgedBy": null,
  "acknowledgedAt": null
}
```

## History

Resolved alerts are kept for 13 months, ended silences for 90 days (pruned hourly).

## Not there yet

- Escalation goes to the addresses of the rule; there is no escalation policy per project.
- Built-in alerts can't be tuned (thresholds, `for`, recipients per alert); silence them instead.
