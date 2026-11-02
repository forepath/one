# Autoscaling

A service can scale horizontally between a minimum and a maximum number of replicas, driven by CPU, memory, HTTP requests or another metric Loadweaver already collects for it. The range and the metric are part of the deployment and change through [plans](./plan-and-apply.md); the scaling itself is automatic, audited and shown on graphs and the map.

```yaml
services:
  api:
    image: ghcr.io/acme/api:1.4
    deploy:
      resources:
        reservations: { cpus: '0.5', memory: 512m }
    x-loadweaver:
      exposure: { http: [{ host: api.acme.example, port: 8080 }] }
      autoscale: { min: 2, max: 10, metric: cpu, target: 70 }
```

## Configuration

`x-loadweaver.autoscale` on a service:

| Field          | Meaning                                                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `min`, `max`   | Replica range (`1 ≤ min ≤ max ≤ 1000`)                                                                                           |
| `metric`       | `cpu`, `memory`, `requests` or `custom`                                                                                          |
| `target`       | The value the autoscaler keeps the metric at (see below)                                                                         |
| `customMetric` | For `custom`: the name of a metric in the [metrics store](./metrics.md), e.g. `ingress.latency_p95_ms` (letters, digits, `_.:-`) |

| Metric     | Value                                                                                                                                                                                                                                                              | `target` unit                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| `cpu`      | Average CPU of the replicas (`replica.cpu_cores`) in percent of the service's CPU **request**                                                                                                                                                                      | percent of the request          |
| `memory`   | Average memory of the replicas (`replica.memory_bytes`) in percent of the memory request                                                                                                                                                                           | percent of the request          |
| `requests` | Requests per second at the ingress for the service's hostnames (`ingress.requests_per_s`, all ingress nodes added up), divided by the replicas. The service needs an HTTP exposure; a plan without one is rejected                                                 | requests per second per replica |
| `custom`   | The named metric for the service: the average over its replicas if the metric is reported per replica, else over its hostnames (rates `*_per_s` added up across ingress nodes, everything else the worst, e.g. the highest p95), else the series of the service id | the metric's own unit           |

Scraping a workload's own Prometheus endpoint for custom metrics is not part of this release; `custom` uses what Loadweaver already stores (ingress latency and errors, replica CPU / memory, and anything else recorded for the service).

Rules a plan enforces:

- Only long-running services scale: jobs and cron jobs with `autoscale` are rejected.
- Services with a read-write volume run one replica (one writer per volume) and can't be autoscaled; read-only mounts are fine.
- `container_name` prevents more than one replica, so it can't be combined with `max > 1`.
- The compose `replicas` (or `x-loadweaver.replicas`) is the **starting** count, clamped to `min..max`. From then on the autoscaler's count is used.

## How it decides

Every 15 seconds the control-plane leader evaluates every autoscaled service (leader election through the database, like the other controllers):

1. **Value**: the average of the metric over the last minute (metrics arrive every 10 seconds).
2. **Recommendation**: `desired = ceil(replicas × value / target)`, clamped to `min..max`. Within **10 %** of the target nothing changes.
3. **Scale-up** happens right away, at most `max(replicas × 2, replicas + 4)` replicas per step, and not within 30 seconds of the previous scaling (new replicas start and report first).
4. **Scale-down** waits for a **5-minute stabilisation window**: it goes to the highest recommendation of the last 5 minutes, and only once those 5 minutes were observed. A single spike therefore keeps the replicas for 5 minutes; load that hovers around the target never flaps. Successive scale-down steps are at least a minute apart.
5. **Missing metrics hold**: without a value (no samples of the replicas in the last minute, no metric for a custom name) nothing changes and the status says why. For `requests`, a minute without ingress samples counts as zero requests as long as nodes report metrics at all (ingress nodes only report hostnames that had traffic).
6. **Migrations hold**: while a replica of the service moves (live migration, blue / green, short stop), the service isn't scaled.

## Limits

A scale-up never goes beyond:

- **`max`**;
- the **project quota** (CPU and memory requests of everything the project runs, with autoscaled services at their current count);
- the **cluster capacity**: the scheduler places the new replicas next to what runs (same selectors, runtimes and spreading as a plan), nothing else moves;
- the **N+1 reserve**: on clusters with two or more workload nodes, a scale-up may not leave a single node loss un-absorbable where it was absorbable before (and may not make an already tight cluster worse). A single-node cluster has no reserve to keep; there, capacity is the limit.

When the wanted count doesn't fit, the autoscaler scales as far as allowed and records the reason (for example `project shop quota: CPU 1.75 would exceed 1.5`). A service that wants more than it may run — blocked by a limit or at `max` — raises the built-in alert `builtin:autoscale-blocked` after 5 minutes, which also lands in the overview's needs-attention inbox.

**Scale-down** removes the **newest replicas first** (the highest replica numbers). They leave like any replica a plan removes, in two steps: the next desired state takes them out of the ingress upstreams, service IPs and mesh endpoints while they keep running (open connections finish), and only after the service's `stop_grace_period` (default 10 s, at least 2 s, at most 2 minutes) are they stopped with their stop signal and grace period. The remaining replicas keep serving throughout. If the load rises again during that drain, the autoscaler keeps a draining replica on its node instead of starting a new one. Draining replicas show as `draining` in the deployment status and on the map.

## Plans

- A plan shows each autoscaled service of the deployments it changes as `autoscaled 3 (2..10), cpu target 70 % of the request` (an info line). Its placements use the autoscaler's current count, so a plan that only changes the image doesn't start or stop replicas.
- The quota is checked against **`min`**: the plan is rejected only if `min` replicas don't fit. If `max` replicas would exceed the quota, the plan warns that the autoscaler will stop at the quota.
- Changing `min` / `max` brings the count into the new range on apply (e.g. raising `min` from 2 to 3 starts one replica). Removing `autoscale` returns to the compose `replicas` and drops the autoscaler's state.
- If the autoscaler changes a service's replicas between creating and applying a plan that also changes that service's replica count, the apply is refused like any other placement change ("the cluster changed since the plan was created"); create the plan again.

## Audit, events, graphs and the map

- Every scaling action is in the [audit log](./audit-log.md) as `workload.autoscaled` (actor `system`, target `service/<project>/<deployment>/<service>`) with `from`, `to`, `metric`, `value`, `target`, `reason`, the limit that applied (`blocked`) and the replicas added (with their nodes).
- Every action is also an `autoscale` [event](./metrics.md) (`entity` = the service, message `shop/web/api scaled 2 → 4: cpu 100 % / target 50 %`), so it appears as a marker on the metric graphs.
- On the [topology map](./topology-map.md), the replicas of an autoscaled service carry `autoscaled` (`4 (2..10)`), `lastScaled` (time and reason) and, while blocked, `autoscaleBlocked`.

## API and console

`GET /api/autoscaling?project=` lists the autoscaled services the caller may read (scope `projects:read`; project members their projects, cluster roles everything):

| Field                                            | Meaning                                                                                                                                      |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`, `project`, `deployment`, `service`         | The service                                                                                                                                  |
| `min`, `max`, `metric`, `customMetric`, `target` | The configuration                                                                                                                            |
| `replicas`                                       | Replicas placed now                                                                                                                          |
| `desiredReplicas`                                | The count plans use                                                                                                                          |
| `status`                                         | The last evaluation: `value`, `desired` (the recommendation), `action` (`up` / `down` / `hold`), `reason`, `blocked`, `atMax`, `evaluatedAt` |
| `lastScaleAt`, `lastReason`, `lastValue`         | The last scaling action                                                                                                                      |

The console shows the same on a deployment's **Autoscaling** tab and on the health page of a deployment or service: replicas within the range, the metric against its target, the last evaluation and scaling, and why a scale-up is blocked.

## Operations

- `LOADWEAVER_AUTOSCALER=off` switches the autoscaler off on a control-plane replica (it follows `LOADWEAVER_WORKLOAD_CONTROLLER` when unset). With every replica off, services keep their current count.
- The state lives in `lw_autoscale_state` (one row per autoscaled service), so a control-plane failover keeps the stabilisation window and the last scaling.
