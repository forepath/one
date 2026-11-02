# Logs

Every node collects the logs of its workloads and of the platform, labels them with the identifiers of the policy model and ships them off the node right away. The lines are stored on the control-plane members, so the logs of a node that just died are still readable.

## Sources

| Source          | What                                                                                                                   | Collected from                                    |
| --------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `container`     | stdout / stderr of workload containers                                                                                 | Docker                                            |
| `ingress`       | output of the ingress proxy                                                                                            | Docker                                            |
| `proxy`         | output of the service mesh proxy                                                                                       | Docker                                            |
| `control-plane` | output of etcd, Postgres and the API; plan events (applied, rolling back, rolled back, …) written by the control plane | Docker; the control plane itself                  |
| `storage`       | output of the object store                                                                                             | Docker                                            |
| `runtime`       | output of other platform containers (registry, rate limit, hosted DNS); container start, exit, kill, restart, OOM kill | Docker output and events                          |
| `firewall`      | denied packets and packets matched by monitor-mode rules, with the policy that matched                                 | the kernel log (`dmesg --follow-new`), every node |
| `tunnel`        | a WireGuard peer going up or down (no handshake for 3 minutes)                                                         | `wg show all dump` every 30 seconds               |
| `routing`       | BGP session state changes                                                                                              | `birdc show protocols` every 30 seconds           |
| `failover`      | reserved; nothing writes it yet                                                                                        |                                                   |

- Every Loadweaver-managed container is followed, except the log store itself (its own output would feed back into it).
- Container lines keep Docker's timestamp. The level comes from a `level` field of JSON lines (`debug` / `trace`, `info`, `warn` / `warning`, `error` / `fatal` / `panic` / `critical`); otherwise stderr counts as `warn` and stdout as `info`.
- The default deny logs denied packets rate-limited to 10 per second (per deny rule of the input, forward and output chains); monitor-mode rules log every new connection they observe.
- Lines longer than 16,384 characters are cut.
- `LOADWEAVER_LOG_COLLECTION=off` in the agent's environment turns collection off on a node.

## Labels and correlation

Each line carries the identifiers of the policy model, so a firewall decision, a proxy line and a container line of the same workload can be found together.

| Field                     | Set by        | Meaning                                                                                                                                                          |
| ------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `labels.project`          | node          | Project of the workload                                                                                                                                          |
| `labels.deployment`       | node          | Deployment                                                                                                                                                       |
| `labels.service`          | node          | Compose service                                                                                                                                                  |
| `labels.replica`          | node          | `<project>/<deployment>/<service>/<index>`                                                                                                                       |
| `labels.policy`           | node          | Policy of the firewall rule that matched (monitor mode)                                                                                                          |
| `labels.peer`             | node          | WireGuard peer key (`tunnel`)                                                                                                                                    |
| `labels.component`        | node          | Platform component (`ingress`, `mesh`, `etcd`, `plans`, the WireGuard interface, the BGP session, …)                                                             |
| `labels.stream`           | node          | `stdout` or `stderr`                                                                                                                                             |
| `fields`                  | node          | Source-specific details: `decision`, `src`, `dst`, `proto`, `spt`, `dpt`, `in`, `out`, `len` for the firewall; `event` for Docker events; `plan` for plan events |
| `node`, `site`, `cluster` | control plane | Where the line came from: the node of the authenticated agent stream (never a value in the line), its site and the cluster id                                    |

Nodes can't speak for each other:

- A line with workload labels is only accepted if its replica runs on the sending node (or is moving there), and the replica matches project, deployment and service. Other lines are dropped and counted in the control plane's own log.
- Lines without workload labels are platform lines of that node.

## Where logs are stored

- Every control-plane member runs OpenSearch (`lw-opensearch`) next to the API, with its data in `/var/lib/loadweaver/opensearch` (`LOADWEAVER_STATE_DIR`). The API on a member writes to and reads from its local OpenSearch, so every replica serves every query.
- One member runs OpenSearch on its own; several members form one OpenSearch cluster over the overlay.
- There is one index per source and day, `loadweaver-logs-<source>-<yyyy-mm-dd>`. Each index has one shard and one replica on another member as soon as there are two members.
- Nodes send their lines in batches every second over the agent stream. While the control plane is unreachable, a node keeps up to 20,000 lines in memory; beyond that the oldest go first. Once it is connected again it sends what it kept, and a `runtime` line (`warn`) says how many were dropped.

## Redaction

Secret values that a node delivered to a workload are replaced with `[redacted]` in the workload's output on the node, before the line leaves it. This covers values of 6 to 4,096 characters, up to 64 secrets per workload, as they were when the node started following the container. A secret that reaches the output in another form (encoded, split across lines) is not caught.

## Who sees what

| Caller                     | Sees                                                                     |
| -------------------------- | ------------------------------------------------------------------------ |
| `cluster-admin`            | everything                                                               |
| `auditor`                  | everything                                                               |
| `infra-operator`           | platform lines (lines without a project) and the projects they belong to |
| project members (any role) | the lines of their projects                                              |

- Platform lines include firewall decisions, tunnels, routing, platform containers and plan events of cluster-level plans. Plan events of a plan touching projects are written once per project, labelled with it.
- A `project` filter for a project the caller can't see answers `404`, as does any query by a caller who sees no logs at all.
- Personal access tokens need the scope `logs:read`.

See [Projects and access](./projects-and-access.md).

## Querying

`GET /api/logs` returns one page of lines, newest first.

```bash
curl -G https://<control-plane>/api/logs \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode 'project=shop' \
  --data-urlencode 'deployment=web' \
  --data-urlencode 'levels=warn,error' \
  --data-urlencode 'from=2026-10-18T08:00:00Z' \
  --data-urlencode 'to=2026-10-18T09:00:00Z' \
  --data-urlencode 'text=timeout'
```

| Parameter                                     | Meaning                                                                           |
| --------------------------------------------- | --------------------------------------------------------------------------------- |
| `from`, `to`                                  | ISO 8601 time range; default: the hour before `to`, `to` defaults to now          |
| `sources`                                     | comma-separated (or repeated) sources from the table above                        |
| `levels`                                      | comma-separated (or repeated): `debug`, `info`, `warn`, `error`                   |
| `project`, `deployment`, `service`, `replica` | exact labels                                                                      |
| `node`, `policy`                              | exact node name, exact policy label                                               |
| `text`                                        | full text over the message (OpenSearch simple query syntax, first 256 characters) |
| `limit`                                       | lines per page, 1–1,000, default 200                                              |
| `order`                                       | `desc` (default, newest first) or `asc`                                           |
| `cursor`                                      | continue from a previous page                                                     |

The answer is `{ "lines": [...], "cursor": ..., "after": ... }`:

- `cursor` is set when the page is full, so there may be more. Pass it as `cursor` with the same filter for the next page. Give an explicit `from` and `to` while paging: the default range moves with the clock.
- `after` is the position after the last line, even on a short page. With `order=asc`, passing it as `cursor` later returns only lines that came in since.

A line:

```json
{
  "id": "4b0c3f9e-6c3e-4d8e-9a43-2b1f5d7e8c10",
  "at": "2026-10-18T08:41:07.512Z",
  "source": "container",
  "level": "warn",
  "message": "upstream timeout after 5000ms",
  "node": "n2",
  "site": "fra",
  "labels": { "project": "shop", "deployment": "web", "service": "api", "replica": "shop/web/api/1", "stream": "stderr" },
  "fields": {},
  "cluster": "lw-7f3a2c"
}
```

## Live tail

The Socket.IO namespace `socket/logs` (env `LOADWEAVER_LOGS_WEBSOCKET_NAMESPACE`) sends new lines as they arrive. Authenticate with the same `Authorization` header as the REST API.

```js
import { io } from 'socket.io-client';

const socket = io('https://<control-plane>/socket/logs', {
  extraHeaders: { Authorization: `Bearer ${token}` },
});

socket.emit('subscribe', { project: 'shop', deployment: 'web', levels: ['warn', 'error'] });
socket.on('logLines', ({ lines }) => lines.forEach((l) => console.log(l.at, l.node, l.message)));
socket.on('error', ({ message }) => console.error(message));
```

- `subscribe` takes the filter of `GET /api/logs`; `from`, `to`, `cursor`, `order` and `limit` are ignored. Access is checked right away: an invalid filter or a project you can't see comes back as `error` and no tail is started.
- `logLines` brings every new matching line, oldest first, checked about every 2 seconds (up to 500 lines per check).
- A new `subscribe` replaces the socket's tail; `unsubscribe` or disconnecting ends it.
- A tail starts when you subscribe and continues after the last line it sent, in timestamp order. Lines that arrive late with an older timestamp (for example from a node that was disconnected) don't appear in a running tail; query them.
- Lines are read from the log store, so every control-plane replica serves every tail. A replica holds up to 5,000 tails.

## Export

`GET /api/logs/export` returns everything matching a filter, oldest first, up to 50,000 lines. It takes the same filter as `GET /api/logs` plus `format`:

```bash
curl -G https://<control-plane>/api/logs/export \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode 'project=shop' \
  --data-urlencode 'from=2026-10-17T00:00:00Z' \
  --data-urlencode 'to=2026-10-18T00:00:00Z' \
  --data-urlencode 'format=csv' -o shop.csv
```

- `ndjson` (default): one line object per line, as in `GET /api/logs`.
- `csv`: `at,source,level,node,project,deployment,service,replica,policy,message`, every value quoted; values that start like a spreadsheet formula get a leading `'` (see [CSV safety](./audit-and-export.md#csv-safety)).
- `limit`, `cursor` and `order` don't apply. Split longer ranges into several exports.

## Retention

Whole daily indices are deleted once their day is older than the source's retention, checked every hour. A day is kept until its retention has passed after the day ended.

| Source                                                                              | Days |
| ----------------------------------------------------------------------------------- | ---: |
| `firewall`                                                                          |    7 |
| `proxy`, `ingress`                                                                  |   14 |
| `container`, `routing`, `tunnel`, `failover`, `storage`, `runtime`, `control-plane` |   30 |

Change it per source in the `Cluster` resource (1–3650 days); sources not listed keep their default:

```yaml
apiVersion: loadweaver.com/v1
kind: Cluster
metadata: { name: cluster }
spec:
  observability:
    logRetentionDays:
      firewall: 3
      container: 90
```

## Operational notes

- **Memory:** OpenSearch gets a 512 MB heap with one or two members and 1 GB from three members on. Its container may use twice the heap (1 GiB / 2 GiB).
- **Ports:** HTTP 9200 and transport 9300 on the members, bound to the overlay address and loopback only. Only control-plane nodes reach them, through the built-in `control-plane-quorum` policy.
- **No OpenSearch security plugin:** the store is never reachable from outside the control plane, and the API on the same member is its only client.
- **Kernel setting:** with several members, OpenSearch enforces its bootstrap checks and needs `vm.max_map_count` of at least 262144. The agent raises it with `sysctl -w` when it is lower; that doesn't survive a reboot, so persist it in `/etc/sysctl.d/` (see [Host requirements](../deployment/host-requirements.md)).
- **Data directory:** owned by uid 1000, the user OpenSearch runs as in the image.
- **Image:** `opensearchproject/opensearch:3.9.0`, pinned by digest; `LOADWEAVER_OPENSEARCH_IMAGE` on the agent overrides it.
- If the log store is not ready when a batch arrives, the batch is not stored.

Log sources can be forwarded to a SIEM (syslog, OTLP, webhook): see [Audit and export](./audit-and-export.md#siem-forwarding).

## Not there yet

- Lines carry project, deployment, service and replica, but not the workload groups a replica belongs to; filter by policy for firewall lines.
- Retention is per source for the whole cluster, not per project.
- The log store always runs on the control-plane members; it can't be placed on a node group of its own.
- The node buffer lives in memory only. Lines queued while the control plane is unreachable are lost if the agent restarts, and nothing spills to disk.
