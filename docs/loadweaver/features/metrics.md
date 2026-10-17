# Metrics

Every node measures itself and its workloads every 10 seconds and sends the numbers over its agent stream. The control plane keeps them in Postgres, next to traffic decisions per policy edge (flows) and event markers for graphs. The same data feeds [alert rules](./alerting.md).

## What is collected

| Metric                                                                       | Entity                                              | Meaning                                                                      |
| ---------------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------- |
| `node.cpu_cores`                                                             | `node`                                              | CPU in use, in cores (busy share of `/proc/stat` × cores)                    |
| `node.memory_bytes`, `node.disk_bytes`                                       | `node`                                              | Memory and disk in use                                                       |
| `node.containers`                                                            | container state (`running`, `exited`, …)            | Loadweaver-managed containers per state                                      |
| `net.rx_bytes_per_s`, `net.tx_bytes_per_s`                                   | interface (up to 64, without `lo`)                  | Traffic per network interface                                                |
| `wg.rx_bytes_per_s`, `wg.tx_bytes_per_s`                                     | `<interface>/<first 12 characters of the peer key>` | Traffic per WireGuard peer                                                   |
| `wg.handshake_age_s`                                                         | as above                                            | Seconds since the peer's last handshake                                      |
| `replica.cpu_cores`, `replica.memory_bytes`                                  | replica `<project>/<deployment>/<service>/<index>`  | CPU and memory per running replica (up to 500 per node)                      |
| `ingress.requests_per_s`, `ingress.errors_per_s`                             | hostname                                            | Requests and `5xx` answers per ingress hostname, from the proxy's access log |
| `ingress.latency_p50_ms`, `ingress.latency_p95_ms`, `ingress.latency_p99_ms` | hostname                                            | Request duration quantiles over the interval                                 |

- Rates are per second over the 10-second interval.
- **Flows**: per policy edge, the packets and bytes its firewall rule matched in the interval (nftables rule counters), with `decision` `allowed` or `observed` (monitor mode). Denied flows come from the firewall log, per source, destination, protocol and port; the default deny logs at most 10 packets per second and rule, so denied counts are a lower bound. Up to 10,000 flows per report.
- **Events**: markers for graphs, written by the control plane. Today: plan events (applied, rolling back, rolled back, …), once per touched project; `migration` events of [migrations](./migration.md); `autoscale` events of [autoscaling](./autoscaling.md) actions (entity = the service).
- While the control plane is unreachable, a node keeps its last 30 reports (5 minutes) and sends them once it is connected again.

Nodes can't speak for each other: the `node` of a sample is always the node of the authenticated stream. A `replica.*` sample is only stored if that replica runs on the sending node (or is moving there); its project is taken from the replica. Other samples are node-level and carry no project. A report timestamp more than an hour off is replaced with the time of arrival.

## Resolutions and retention

| Table           | Resolution | Kept      |
| --------------- | ---------- | --------- |
| `lw_metrics`    | 10 s       | 7 days    |
| `lw_metrics_1m` | 1 minute   | 30 days   |
| `lw_metrics_1h` | 1 hour     | 13 months |
| `lw_flows`      | 10 s       | 30 days   |
| `lw_flows_1h`   | 1 hour     | 13 months |
| `lw_events`     | —          | 13 months |

The roll-ups keep `avg`, `min`, `max` and the number of samples per bucket, metric, node and entity; flow roll-ups sum packets and bytes.

A query picks the table by the length of its range:

| Range         | Table           | Step       |
| ------------- | --------------- | ---------- |
| up to 6 hours | `lw_metrics`    | 10 seconds |
| up to 7 days  | `lw_metrics_1m` | 1 minute   |
| longer        | `lw_metrics_1h` | 1 hour     |

A range that starts before a table's retention reads the next coarser one (raw data older than 7 days from the 1-minute roll-up, anything older than 30 days from the hourly one), so a short range further back isn't empty. Averages over roll-ups are weighted by their sample counts.

Flows use `lw_flows` for ranges up to 7 days that start within the last 30 days, and `lw_flows_1h` otherwise.

## TimescaleDB or plain Postgres

The tables are created by a migration as plain tables. When the control plane starts, it checks whether the database offers the `timescaledb` extension (the Spilo image of the built-in Postgres does) and under which license, and logs once which mode is active:

- **TimescaleDB, community license** (`timescaledb.license = timescale`): one replica (advisory lock) enables the extension, turns `lw_metrics` and `lw_flows` into hypertables, replaces the roll-up tables with continuous aggregates (1-minute aggregates refreshed every minute, hourly ones every 30 minutes) and adds retention policies that drop old chunks. Events are deleted by the control plane.
- **TimescaleDB, Apache license** (`apache`, what the Spilo image ships): `lw_metrics` and `lw_flows` become hypertables; continuous aggregates and policies don't exist under this license, so the roll-ups and retention work as on plain Postgres (below). The control plane doesn't change the license.
- **Plain Postgres** (or when setting up TimescaleDB fails, e.g. the extension isn't preloaded): one replica at a time (advisory lock) fills the roll-up tables every minute (idempotent upserts: minutes from the last 15 minutes of raw data, so late reports of reconnecting nodes are included, hours from the minutes) and rows past their retention are deleted every hour.

Queries are the same either way. The newest bucket of a roll-up appears once it is complete, so a 7-day graph ends up to a minute, a longer one up to about an hour and a half before now.

## Who sees what

| Caller                                                       | Metrics                       | Flows      | Events                   |
| ------------------------------------------------------------ | ----------------------------- | ---------- | ------------------------ |
| cluster roles (`cluster-admin`, `infra-operator`, `auditor`) | everything                    | everything | everything               |
| project members (any role)                                   | `replica.*` of their projects | —          | events of their projects |

- Node, network, WireGuard and ingress metrics carry no project, so only cluster roles see them.
- A `project` filter for a project the caller can't see answers `404`, as does a metrics query by a caller who sees no project at all.
- Personal access tokens need the scope `metrics:read`.

## Querying

`GET /api/metrics/query` returns the series of one metric over a range.

```bash
curl -G https://<control-plane>/api/metrics/query \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode 'metric=replica.memory_bytes' \
  --data-urlencode 'entity=shop/web/*' \
  --data-urlencode 'groupBy=entity' \
  --data-urlencode 'aggregation=max' \
  --data-urlencode 'from=2026-10-17T00:00:00Z' \
  --data-urlencode 'to=2026-10-18T00:00:00Z'
```

| Parameter     | Meaning                                                                           |
| ------------- | --------------------------------------------------------------------------------- |
| `metric`      | metric name from the table above (required)                                       |
| `from`, `to`  | ISO 8601 time range; default: the hour before `to`, `to` defaults to now          |
| `entity`      | exact entity, or a prefix ending in `*` (`shop/web/*`)                            |
| `node`        | exact node name                                                                   |
| `project`     | exact project                                                                     |
| `groupBy`     | one series per `entity` (default), `node`, `project` or `none` (one series `all`) |
| `aggregation` | `avg` (default), `min`, `max` or `sum` within each step and group                 |

The answer has the step and up to 200 series:

```json
{
  "step": "1 minute",
  "series": [
    {
      "key": "shop/web/api/0",
      "points": [
        ["2026-10-17T00:00:00.000Z", 314572800],
        ["2026-10-17T00:01:00.000Z", 316669952]
      ]
    }
  ]
}
```

`GET /api/metrics/export` takes the same parameters plus `format`: `csv` (default, `series,time,value`) or `json` (the answer above). Both are sent as `text/plain`; CSV cells are protected against formula injection (see [CSV safety](./audit-and-export.md#csv-safety)).

### Prometheus, OpenTelemetry, dashboards

- `GET /api/metrics/prometheus` is a Prometheus scrape target with the newest sample of every series the caller may read, and the control plane publishes cluster summary gauges through OpenTelemetry (scrape path and OTLP push): see [Audit and export](./audit-and-export.md#prometheus).
- [Dashboards](./dashboards.md) combine metrics, flows and logs in widgets, and `/api/grafana` serves Grafana as a data source.

### Flows

`GET /api/metrics/flows` returns the top flows over a range, by packets (cluster roles only).

```bash
curl -G https://<control-plane>/api/metrics/flows \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode 'decision=denied' \
  --data-urlencode 'limit=20'
```

| Parameter    | Meaning                                            |
| ------------ | -------------------------------------------------- |
| `from`, `to` | ISO 8601 time range; default: the hour before `to` |
| `decision`   | `allowed`, `denied` or `observed`                  |
| `node`       | exact node name                                    |
| `policy`     | exact policy (empty for denied flows)              |
| `limit`      | 1–500, default 50                                  |

Each entry: `policy`, `src`, `dst`, `protocol`, `port`, `decision`, `packets`, `bytes` (summed over the range).

### Events

`GET /api/metrics/events` returns event markers, newest first.

| Parameter    | Meaning                                           |
| ------------ | ------------------------------------------------- |
| `from`, `to` | ISO 8601 time range; default: the day before `to` |
| `kind`       | e.g. `plan`                                       |
| `project`    | exact project                                     |
| `limit`      | 1–1,000, default 200                              |

Each entry: `id`, `time`, `kind`, `entity` (the plan id for plan events), `project`, `message`.

## Not there yet

- The Prometheus endpoint exposes the latest raw sample per series; roll-ups are only available through the query API.

- Events are written for plans only; failovers, migrations, node join / leave, certificate renewals and health changes follow.
- Flows are visible to cluster roles only, and are not split by project.
- Ingress metrics are per hostname, without the project behind it, so project members don't see them.
