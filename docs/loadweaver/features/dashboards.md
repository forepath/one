# Dashboards

Next to the curated graphs, custom dashboards put [metrics](./metrics.md), flows and [logs](./logs.md) side by side. A dashboard is a `Dashboard` resource: written in YAML, kept in Git and changed by [plan and apply](./plan-and-apply.md) like any other. Every widget runs a query-builder query within the global filter, through the same access checks as the curated views, so a dashboard never shows more than its viewer may read. For more, the control plane is also a Grafana data source.

## A dashboard

```yaml
apiVersion: loadweaver.com/v1
kind: Dashboard
metadata: { name: shop-overview, project: shop } # without project: cluster-wide
spec:
  title: Shop overview
  description: API health at a glance
  range: 24h # default time range when the URL doesn't set one; default 6h
  widgets:
    - title: API memory per replica
      type: line
      x: 0
      y: 0
      w: 6
      h: 4
      unit: bytes
      query:
        metrics:
          metric: replica.memory_bytes
          entity: shop/web/api/* # exact entity or a prefix ending in *
          aggregation: max # avg (default), min, max, sum
          groupBy: entity # entity (default), node, project, none
    - title: Requests per second
      type: area
      x: 6
      y: 0
      w: 6
      h: 4
      query:
        metrics: { metric: ingress.requests_per_s, entity: shop.example.com, groupBy: none }
    - title: Top denied flows
      type: table
      x: 0
      y: 4
      w: 6
      h: 6
      query:
        flows: { decision: denied, limit: 20 }
    - title: API errors
      type: logs
      x: 6
      y: 4
      w: 6
      h: 6
      query:
        logs: { sources: [container], levels: [error], service: api, limit: 100 }
```

### Widgets

| Field   | Meaning                                                             |
| ------- | ------------------------------------------------------------------- |
| `title` | required, up to 255 characters                                      |
| `type`  | `line`, `area`, `bar`, `stat`, `table` or `logs`                    |
| `query` | exactly one of `metrics`, `flows`, `logs` (see [Queries](#queries)) |
| `x`     | column 0–11, default 0                                              |
| `y`     | row from the top, 0–1,000, default 0                                |
| `w`     | width in columns 1–12, default 6                                    |
| `h`     | height in rows 1–24, default 4                                      |
| `unit`  | shown with the values, up to 16 characters                          |

- The grid has 12 columns; a widget has to fit (`x + w ≤ 12`).
- `logs` widgets show log queries, and log queries only fit `logs` widgets.
- At most 50 widgets per dashboard.

### Scope

- A cluster-wide dashboard (no `metadata.project`) or a project dashboard, like other resources that can be both.
- What a widget shows depends on who looks at it, not on where the dashboard lives: a project member sees the `replica.*` metrics and log lines of their projects, cluster roles see more (see [who sees what](./metrics.md#who-sees-what) for metrics and [logs](./logs.md#who-sees-what)). Flow queries need a cluster role (`404` otherwise).
- The dashboard's project doesn't narrow its queries; the `project` of the global filter does.

## Queries

`POST /api/dashboards/query` runs one widget query within the global filter (PAT scope `metrics:read`).

```bash
curl https://<control-plane>/api/dashboards/query \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{
    "query": { "metrics": { "metric": "replica.cpu_cores", "entity": "shop/web/*", "aggregation": "max" } },
    "from": "2026-10-18T00:00:00Z",
    "to": "2026-10-18T06:00:00Z",
    "project": "shop"
  }'
```

| Field        | Meaning                                                                    |
| ------------ | -------------------------------------------------------------------------- |
| `query`      | the widget's query                                                         |
| `from`, `to` | ISO 8601 time range with offset; defaults as in the underlying API         |
| `project`    | narrows metrics and logs to one project (`404` if the caller can't see it) |

| Query     | Fields                                                                                             | Same as                  |
| --------- | -------------------------------------------------------------------------------------------------- | ------------------------ |
| `metrics` | `metric` (required), `entity`, `node`, `aggregation` (default `avg`), `groupBy` (default `entity`) | `GET /api/metrics/query` |
| `flows`   | `decision`, `node`, `policy`, `limit` 1–500 (default 20)                                           | `GET /api/metrics/flows` |
| `logs`    | `sources`, `levels`, `text`, `service`, `deployment`, `limit` 1–1,000 (default 100)                | `GET /api/logs`          |

The answer says what it is:

```json
{ "kind": "series", "step": "10 seconds", "series": [{ "key": "shop/web/api/0", "points": [["2026-10-18T00:00:00.000Z", 0.21]] }] }
```

```json
{ "kind": "flows", "rows": [{ "policy": "", "src": "10.0.0.5", "dst": "10.0.1.7", "protocol": "tcp", "port": 22, "decision": "denied", "packets": 120, "bytes": 0 }] }
```

```json
{ "kind": "logs", "lines": [{ "at": "2026-10-18T05:59:58.000Z", "source": "container", "level": "error", "message": "upstream timeout", "…": "…" }] }
```

Metric series pick their resolution from the range (10 s up to 6 hours, 1 minute up to 7 days, 1 hour beyond) and are capped at 200 series; flows are a cluster-role view (`404` otherwise).

## Grafana

The control plane speaks the SimpleJSON data-source protocol under `/api/grafana`.

1. Create a personal access token with the scope `metrics:read`. Grafana sees what the token's owner may read.
2. In Grafana, add a data source that speaks the SimpleJSON protocol: **SimpleJSON** (`grafana-simple-json-datasource`) or its successor **JSON** (`simpod-json-datasource`). Plugins that query arbitrary JSON (e.g. "JSON API", Infinity) need their own configuration and are not covered here.
3. URL: `https://<control-plane>/api/grafana`. Add a custom header `Authorization` with the value `Bearer <token>`.
4. **Save & test** calls `GET /api/grafana`, which answers `{"status": "ok"}`.

| Request                         | Answers                                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/grafana`              | `{"status": "ok"}`: connection test                                                                                            |
| `POST /api/grafana/search`      | the metric names with samples in the last hour that the caller can read (up to 1,000)                                          |
| `POST /api/grafana/query`       | one time series per group, datapoints as `[value, epoch ms]`                                                                   |
| `POST /api/grafana/annotations` | event markers (plans, …) in the range as annotations: `time`, `title` (the kind), `text`, `tags` (kind and project); up to 500 |

A query target is a metric name. Its optional `payload` takes the filters of the metric query:

```json
{
  "range": { "from": "2026-10-18T00:00:00Z", "to": "2026-10-18T06:00:00Z" },
  "targets": [
    {
      "refId": "A",
      "target": "replica.memory_bytes",
      "payload": { "entity": "shop/web/*", "project": "shop", "aggregation": "max", "groupBy": "entity" }
    }
  ]
}
```

- At most 20 targets per query.
- Only `/search` lists metric names; newer plugin versions that ask `/metrics` for them get no list, type the metric name instead.
- A series is named after the metric, followed by its group key (`replica.memory_bytes shop/web/api/0`); a single ungrouped series (`groupBy: none`) is named after the metric alone.

## Not there yet

- Widgets don't follow the label selectors of the global filter beyond time range and project.
- Grafana gets metrics and annotations; flows and logs are only available to Loadweaver dashboards.
