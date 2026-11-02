# Usage metering

Loadweaver meters what every project uses, per hour: CPU, memory, storage, traffic and public addresses. The numbers can be viewed in the console, exported as CSV and are billed by **Decabill**, so hosters can resell the capacity of their own Loadweaver clusters. Decabill stays responsible for prices, invoices and subscriptions; Loadweaver only delivers the usage.

## Meters

| Meter                       | Unit       | Measured                                                                                                                        |
| --------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `cpu_core_hours`            | core-hours | CPU used by the project's replicas: CPU-seconds from the containers' CPU counters (`replica.cpu_seconds`)                       |
| `memory_gib_hours`          | GiB-hours  | Memory used by the replicas (without page cache) × the measured time each reading covers (`replica.memory_byte_seconds`)        |
| `storage_gib_hours`         | GiB-hours  | Provisioned volume size, **each volume once** (as the storage quota counts it), sampled every 5 minutes                         |
| `storage_replica_gib_hours` | GiB-hours  | Provisioned volume size **times its copies** (primary + synchronous replicas + remote replicas, as placed), sampled every 5 min |
| `traffic_in_gb`             | GB (10⁹ B) | Bytes received by the replicas (`replica.net_rx_bytes`: increase of the containers' network counters)                           |
| `traffic_out_gb`            | GB (10⁹ B) | Bytes sent by the replicas (`replica.net_tx_bytes`)                                                                             |
| `public_ip_hours`           | IP-hours   | Public addresses assigned to the project: the egress addresses of its policies ([public addresses](./public-addresses.md))      |

Which storage meter to bill is the hoster's choice (attach one or both in Decabill). Notes:

- Traffic counts everything a replica sends and receives, **including traffic inside the cluster** (east-west, mesh). Shared cluster addresses (ingress, hosted DNS, the VPN gateway) belong to the cluster, not to a project, and are not metered.
- Usage while a replica isn't reporting (node disconnected for more than 5 minutes, control plane down) is not metered: gaps count in the customer's favour.
- Object storage (registry, backups) is not metered yet.

## How it is computed

- Replica meters come from the 1-minute roll-up of the [metrics](./metrics.md) (a continuous aggregate with the TimescaleDB community license, otherwise maintained by the control plane). The node agent reads **every** running replica (no per-node cap) and reports **integrated** samples: each one covers the measured time since that replica's previous reading (CPU-seconds and byte deltas straight from the cumulative counters; memory × the measured interval). A slow or skipped collection (a long pass makes the 10 s timer skip the next one) therefore bills the full time, not a fixed 10 s per sample; a failed reading keeps the previous one, so the next covers the gap; a counter that went down (container restart) counts everything since the restart; a replica created since the previous collection counts from its creation. Collections with more than 10,000 samples go out as several reports.
- **N-1 node agents** (one release behind, before the integrated samples) only report the instantaneous `replica.cpu_cores`, `replica.memory_bytes` and `replica.net_*_bytes_per_s`. For a replica minute without integrated samples the roll-up falls back to those, each sample standing for the nominal 10 s (as before: skipped ticks of such agents are under-metered, and they read at most 500 replicas per node). Once the node agent is updated the integrated samples win; nothing is billed twice. No protocol change is involved (new metric names only).
- Allocation meters (volumes, addresses) come from the control plane's own samples every 5 minutes (`lw_usage_samples`, kept 7 days).
- Every 5 minutes the control plane recomputes the hourly buckets of the last 3 hours (`lw_usage_1h`, one row per project, meter and hour). A bucket becomes **final** 15 minutes after its hour ended and never changes again, so exports, reports and Decabill always see the same numbers. Hourly buckets are kept **25 months**, independent of the metric retention.
- Each bucket stores the Decabill subscription its project was mapped to when it was computed. Changing or removing the mapping (or deleting the project) only affects buckets that aren't final yet; already billed hours never move.
- Times are UTC. Days and months are sums of their hours; a day / month is final once it has ended and all its hours are final.

## API

Scope `usage:read` for personal access tokens (bounded by the owner's roles as always).

| Endpoint                               | Who                                                                     |
| -------------------------------------- | ----------------------------------------------------------------------- |
| `GET /projects/{project}/usage`        | Everyone who may read the project (members, auditors, infra operators)  |
| `GET /projects/{project}/usage/export` | Same, as CSV                                                            |
| `GET /usage`                           | Cluster roles (cluster admins, infra operators, auditors): all projects |
| `GET /usage/export`                    | Same, as CSV                                                            |

Parameters: `from` (floored to the granularity; default: start of the current month), `to` (exclusive; default: now), `granularity` (`hour`, `day` (default), `month`; at most 93 / 400 / 800 days), `meter`, `finalOnly=true`; on `/usage` also `project` and `billingSubscription` (Decabill subscription id). The answer has the meter catalog (key, unit, description), one row per project, bucket and meter (`value` with 6 decimals, `final`), totals per project and meter, and `truncated` when more than 50 000 rows matched. Hourly rows also carry `idempotencyKey` = `loadweaver:<cluster>:<project>:<meter>:<hour>` and `billingSubscription`.

CSV columns: `project,bucket,granularity,meter,unit,value,final,idempotency_key`. See the [OpenAPI spec](../../../libs/domains/loadweaver/backend/feature-control-plane/spec/openapi.yaml).

## Billing with Decabill

1. **In Decabill** (admin): create an addon with implementation type _module_ and module key `loadweaver-usage`, one per Loadweaver cluster. Set its admin defaults `LOADWEAVER_API_URL` (the control plane's API URL including `/api`, HTTPS) and `LOADWEAVER_API_TOKEN` (a personal access token of a Loadweaver **auditor** with the `usage:read` scope). Decabill attaches the seven `loadweaver.*` meters (aggregator `sum`, price 0 until you set one); set prices and included usage on the meters or the addon attachment.
2. Customers get a subscription with that addon (arrear billing).
3. **In Loadweaver** (cluster admin, plan and apply): map the project to the subscription in the project's spec:

   ```yaml
   kind: Project
   metadata:
     name: shop
   spec:
     billing:
       decabillSubscriptionId: 6f1c1d5e-6a43-4c38-9a59-7f6d4f0e2a10
   ```

   Several projects may map to the same subscription; their usage adds up. The mapping applies to buckets computed from then on (at most the current and the previous hour retroactively).

Decabill's meter-collect job then pulls `GET /usage?billingSubscription=<id>&granularity=hour&finalOnly=true` once an hour per subscription and records one usage entry per final hour, project and meter, keyed by the idempotency key, so every hour is billed exactly once even when collect windows overlap or a run is retried. Details on the Decabill side: [usage meters](../../decabill/features/usage-meters.md#loadweaver-usage).

## Console and reports

The console's **Observe › Usage** page (`/observe/usage`, also a project's **Usage** tab) shows totals per meter, a table per period and project (open periods are marked) and the CSV export, filtered by project, resolution and time range. Project members see their projects; cluster roles can also see all projects at once. The monthly [periodic reports](./periodic-reports.md) contain the metered usage of the month.
