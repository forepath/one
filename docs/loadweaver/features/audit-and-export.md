# Audit and Export

The [audit log](./audit-log.md) can be searched and exported, is mirrored to the log store and anchored outside the database, and can be forwarded to a SIEM together with the [logs](./logs.md). [Metrics](./metrics.md) are available as a Prometheus scrape target and through OpenTelemetry, and every list that can be exported as CSV is safe to open in a spreadsheet.

## Who sees the audit log

| Caller                                | Sees                          |
| ------------------------------------- | ----------------------------- |
| `cluster-admin`, `auditor`            | every entry                   |
| project `admin`                       | the entries of their projects |
| everyone else (also `infra-operator`) | nothing                       |

- Entries without a project (cluster-level changes) are for cluster admins and auditors only.
- A `project` filter for a project the caller isn't admin of answers `404`, as does any query by a caller who sees no entries at all.
- Personal access tokens need the scope `audit:read`.

## Searching

`GET /api/audit` returns one page of entries, newest first.

```bash
curl -G https://<control-plane>/api/audit \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode 'project=shop' \
  --data-urlencode 'action=plan.*' \
  --data-urlencode 'from=2026-10-01T00:00:00Z'
```

| Parameter    | Meaning                                                                   |
| ------------ | ------------------------------------------------------------------------- |
| `from`, `to` | ISO 8601 time range (`from` inclusive, `to` exclusive); default: no limit |
| `project`    | exact project                                                             |
| `action`     | exact action, or a prefix ending in `*` (`plan.*`)                        |
| `actor`      | exact actor id                                                            |
| `target`     | target prefix (`plan/`, `project/shop`)                                   |
| `text`       | full text over action, target and details (up to 256 characters)          |
| `limit`      | 1–500, default 100                                                        |
| `before`     | the `before` of the previous page: continues with older entries           |

The answer:

```json
{
  "entries": [
    {
      "seq": "4711",
      "at": "2026-10-18T09:12:03.123Z",
      "actorType": "user",
      "actorId": "alice",
      "action": "plan.applied",
      "target": "plan/0f8e2c1a-5b7d-4c3e-9a10-6d2f4b8e1c55",
      "project": "shop",
      "details": { "revision": 42 },
      "hash": "9c1d…"
    }
  ],
  "before": "4711"
}
```

`before` is `null` on the last page.

**Full text**: with the log store, `text` is an OpenSearch simple query string over the [mirror](#mirror-in-the-log-store) and selects the page there (every other filter applied, newest first), so paging and exports are complete; the newest entries show up there within about 15 seconds. Without a log store it is a case-insensitive substring match in Postgres.

## Exporting

`GET /api/audit/export` takes the same filters plus `format` and returns every matching entry, newest first, up to 50,000 entries, as an attachment (`text/plain`).

| `format`           | Content                                                                                                                           |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `ndjson` (default) | one entry (as above) per line                                                                                                     |
| `csv`              | header `seq,at,actorType,actorId,actorEmail,action,target,project,details,hash`, `details` as JSON, see [CSV safety](#csv-safety) |

```bash
curl -G https://<control-plane>/api/audit/export \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode 'from=2026-10-01T00:00:00Z' \
  --data-urlencode 'format=csv' -o audit.csv
```

Postgres stays the authoritative store: search and export read from it, the log store only answers full-text queries.

## Mirror in the log store

With the log store enabled, one control-plane replica at a time (Postgres advisory lock) copies new audit entries every 15 seconds into their own index, `<prefix>-audit`, separate from the operational log indices. The mirror remembers how far it got (`lw_audit_mirror`), so a restart continues where it left off, in batches of 1,000.

## Anchoring the chain head

A hash chain shows that entries were changed, unless someone with database access rewrites the whole chain from the changed entry on. To catch that, the chain head is anchored outside the database:

- Every hour (and only when the head moved), the same replica writes the head's `seq` and `hash` into the index `<prefix>-audit-anchors` and as a `control-plane` log line `audit chain head <seq> <hash>` (`fields.auditAnchor: true`).
- SIEM targets with the `control-plane` source receive these lines; targets with the `audit` source receive every entry with its `prevHash` and `hash`, so the SIEM holds a copy of the chain it can compare against.
- Anchoring needs the log store; without it nothing is anchored.

### Verify

`GET /api/cluster/audit/verify` (auditors and cluster admins, PAT scope `audit:read`) recomputes the chain and compares the newest 1,000 anchors with it:

```json
{
  "ok": false,
  "checked": 4711,
  "head": "9c1d…",
  "anchors": { "available": true, "checked": 37, "mismatched": ["4100"] }
}
```

| Field                | Meaning                                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------- |
| `ok`                 | the chain verifies **and** no anchor disagrees with it                                                   |
| `brokenAt`           | first entry whose hash doesn't match, or the newest anchored entry that no longer matches its anchor     |
| `anchors.available`  | `false` without a log store                                                                              |
| `anchors.checked`    | anchors compared                                                                                         |
| `anchors.mismatched` | anchored `seq`s whose entry is missing or has a different hash: the chain was rewritten after the anchor |

The built-in alert `builtin:audit-chain-broken` runs the same check every hour and fires on a broken chain as well as on mismatched anchors (see [Alerting](./alerting.md#built-in-alerts)).

The anchors live on the control-plane members next to the database. Someone who controls both can rewrite both; a SIEM that receives the audit log or the anchor lines keeps a copy out of their reach.

## SIEM forwarding

The audit log and selected log sources can be forwarded to up to 10 targets, set by cluster admins in the `Cluster` resource:

```yaml
apiVersion: loadweaver.com/v1
kind: Cluster
metadata: { name: cluster }
spec:
  observability:
    siem:
      # syslog (RFC 5424) over TLS, TCP or UDP
      - name: soc-syslog
        type: syslog
        url: tls://siem.example.com:6514 # or tcp://host:514, udp://host:514
        sources: [audit, firewall, control-plane]
        levels: [warn, error] # log levels to forward; audit entries always go; default: all
      # OTLP/HTTP logs to a collector
      - name: otel
        type: otlp
        url: https://otel-collector.example.com:4318/v1/logs
        sources: [audit, container, proxy, ingress]
        credentials: secret://infra/otel-collector # optional
      # JSON batches to a webhook
      - name: soar
        type: webhook
        url: https://soar.example.com/hooks/loadweaver
        sources: [audit]
        credentials: secret://infra/soar-token # optional
```

| Field         | Meaning                                                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`        | unique per cluster; the delivery state is kept per name                                                                                     |
| `type`        | `syslog`, `otlp` or `webhook`                                                                                                               |
| `url`         | syslog: `udp://`, `tcp://` or `tls://host:port`; OTLP and webhook: `https://` or `http://` URL                                              |
| `sources`     | `audit` and / or [log sources](./logs.md#sources)                                                                                           |
| `levels`      | `debug`, `info`, `warn`, `error`; filters log lines only                                                                                    |
| `credentials` | OTLP and webhook only: a secret holding a JSON object of headers (`{"X-Api-Key": "…"}`), or a token sent as `Authorization: Bearer <token>` |

### Formats

| Type      | What is sent                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `syslog`  | one RFC 5424 message per record: `<pri>1 <time> <host> loadweaver - <audit\|log> [loadweaver@32473 key="value" …] <message>`. Audit entries use facility `authpriv`, log lines `local0`; severity from the level. TCP and TLS frame by octet counting (RFC 6587), UDP sends one datagram per message (cut at 8,000 characters). TLS verifies the server certificate (Node.js' bundled public CAs) and its host name. |
| `otlp`    | an OTLP/HTTP JSON `ExportLogsServiceRequest` with resource attributes `service.name=loadweaver` and `loadweaver.cluster=<cluster id>`, one log record per record with `loadweaver.kind` and the attributes below                                                                                                                                                                                                     |
| `webhook` | `POST` of `{"source": "loadweaver", "records": [{ "kind", "at", "severity", "message", "attributes" }]}`                                                                                                                                                                                                                                                                                                             |

Attributes of an audit record: `seq`, `action`, `target`, `actorType`, `actorId`, `project`, `details` (JSON, up to 4,000 characters), `prevHash`, `hash`. Attributes of a log line: `source`, `node`, `site` and its labels (`project`, `deployment`, `service`, `replica`, …).

OTLP and webhook requests time out after 10 seconds, don't follow redirects and count any status but `2xx` as a failure.

### Delivery

- Every 10 seconds one control-plane replica (Postgres advisory lock) works through the targets one after the other. Per target it sends rounds of up to 500 audit entries and up to 500 log lines, oldest first, and keeps going (up to 20 rounds) while there is more, so busy sources catch up (up to about 1,000 log lines per second per target). Each request stays below about 1 MB; log messages are cut at 8 KB.
- **At least once, in order**: a target's position (last audit `seq`, position in the log store) only moves after the target accepted the batch. A failed batch is sent again, so the receiver may see a record twice.
- **Backoff**: after a failure the target waits 10 s, 20 s, 40 s, … up to 10 minutes before the next attempt; other targets carry on. Each consecutive failure also halves the batch (down to 8 records), so a record the receiver keeps rejecting can't block the target for good — it narrows down to the offending batch, visible in the status.
- **Where a new target starts**: with the whole audit log from the first entry, and with log lines from the last two minutes.
- **Log lines wait 30 seconds** before they are forwarded: their stored-at time comes from the ingesting control-plane replica, and lines can become searchable slightly out of order (bulk indexing, refresh, clock differences between members). Clocks of the members should be synchronised (NTP) to well within that.
- Removing a target from the `Cluster` drops its position; adding it again (or renaming it) starts over.
- Log sources need the log store; without it only the audit log is forwarded.
- Syslog over UDP has no acknowledgement, and over TCP / TLS a batch counts as delivered once it was written to the connection.

### Status

`GET /api/cluster/siem` (auditors and cluster admins, PAT scope `audit:read`) shows the delivery state per target:

```json
[
  {
    "name": "soc-syslog",
    "forwarded": 182734,
    "failures": 2,
    "lastError": "connect ECONNREFUSED 203.0.113.7:6514",
    "nextAttemptAt": "2026-10-18T09:14:20.000Z"
  }
]
```

`failures` counts consecutive failures and goes back to `0` with the next accepted batch.

**Testing a target**: _Test connection_ in Admin › Integrations (`POST /api/integrations/test` with `{ kind: SiemTarget, name }`, cluster admins, PAT scopes `cluster:read` + `cluster:admin`) sends one event marked as a test (`event: integration.test`, `test: true`, "not a security event") through the same sender; cursors and delivery state are not touched. Over UDP syslog the send can't be confirmed. Audited (`integration.test`).

## Prometheus

`GET /api/metrics/prometheus` is a scrape target with the newest sample of every series from the last 2 minutes, in the Prometheus text format (version 0.0.4):

```yaml
# prometheus.yml
scrape_configs:
  - job_name: loadweaver
    scheme: https
    metrics_path: /api/metrics/prometheus
    authorization:
      credentials_file: /etc/prometheus/loadweaver-token # a PAT with metrics:read
    static_configs:
      - targets: ['<control-plane>']
```

```text
# TYPE loadweaver_replica_memory_bytes gauge
loadweaver_replica_memory_bytes{node="n1",entity="shop/web/api/0",project="shop"} 314572800 1760778723000
```

- Every [metric](./metrics.md#what-is-collected) is a gauge named `loadweaver_<metric>` with `.` replaced by `_`, labelled with `node`, `entity` and (if it has one) `project`, and carries the sample's own timestamp.
- Scoped like `GET /api/metrics/query`: cluster roles get every series, project members the `replica.*` series of their projects. `?project=<name>` narrows to one project.
- At most 50,000 series per scrape.
- Scrape every 10 to 60 seconds; samples older than 2 minutes (a node that stopped reporting) are left out.

## OpenTelemetry

The control plane uses the shared OpenTelemetry module. With it enabled (`OTEL_ENABLED=true`, `OTEL_USERNAME`, `OTEL_PASSWORD` in the API's environment, see `libs/domains/shared/backend/util-otel/README.md`), every 30 seconds it sets cluster summary gauges (meter `loadweaver.cluster`):

| Gauge                      | Labels                                                                                    | Meaning                 |
| -------------------------- | ----------------------------------------------------------------------------------------- | ----------------------- |
| `loadweaver.nodes`         | `lifecycle` (`active`, `cordoned`, `draining`, `leaving`), `connected` (`true` / `false`) | nodes that haven't left |
| `loadweaver.plans`         | `status` (`pending`, `applying`, `rolling-back`, `rollback-failed`)                       | open plans              |
| `loadweaver.alerts.firing` | `severity` (`info`, `warning`, `critical`)                                                | firing alerts           |
| `loadweaver.capacity`      | `resource` (`cpuMillis`, `memoryBytes`, `diskBytes`)                                      | sum of node capacity    |
| `loadweaver.usage`         | `resource`                                                                                | sum of node usage       |

- They are exposed, together with the API's own process metrics, on the module's Basic-auth scrape path (`OTEL_METRICS_PATH`, default `/otel/metrics`, outside `/api`).
- `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` (e.g. `https://collector:4318/v1/metrics`) also pushes them to an OTLP collector every 60 seconds, with the same Basic auth.
- Only fixed label sets: per-series data comes from `GET /api/metrics/prometheus`, which is scoped by access.
- Every control-plane replica reports the same cluster-wide numbers; aggregate with `max`, not `sum`.

## CSV and JSON exports

| Request                   | Formats                   | Limit                          |
| ------------------------- | ------------------------- | ------------------------------ |
| `GET /api/logs/export`    | `ndjson` (default), `csv` | 50,000 lines                   |
| `GET /api/metrics/export` | `csv` (default), `json`   | 200 series                     |
| `GET /api/alerts/export`  | `csv` (default), `json`   | `limit` 1–1,000, default 1,000 |
| `GET /api/audit/export`   | `ndjson` (default), `csv` | 50,000 entries                 |

Each export takes the filters of its list and is scoped like it. The alert export defaults to `state=all`; its CSV header is `id,rule,key,project,severity,state,title,value,startedAt,firedAt,resolvedAt,acknowledgedBy`.

### CSV safety

- Every text cell is quoted (RFC 4180, `"` doubled); numbers stay unquoted.
- A cell starting with `=`, `+`, `-`, `@`, a tab or a carriage return gets a leading `'`, so a spreadsheet shows a log line, alert title or audit detail as text instead of evaluating it as a formula (CSV injection). Strip the `'` if you process the file as data.

## Not there yet

- Anchors are written to the log store and forwarded to SIEMs; `verify` compares with the log store only.
- Webhook SIEM targets carry no signature; authenticate them with `credentials`.
- Syslog over TLS can't take a custom CA or client certificate.
- The OpenTelemetry summary covers nodes, plans, alerts and capacity; per-project numbers come from the Prometheus endpoint.
