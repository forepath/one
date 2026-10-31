# Deployments and Jobs

A deployment is a Docker Compose project. Loadweaver runs it across the cluster, keeps it running when nodes fail and moves it without downtime where the workload allows.

```yaml
apiVersion: loadweaver.com/v1
kind: Deployment
metadata: { name: shop, project: acme }
spec:
  compose: |
    services:
      api:
        image: ghcr.io/acme/api:1.4
        x-loadweaver: { replicas: 3, placement: { spread: site } }
      migrate:
        image: ghcr.io/acme/api:1.4
        command: ["migrate"]
        x-loadweaver: { job: { phase: before } }
      report:
        image: registry.lw/acme/report:2
        x-loadweaver: { cron: { schedule: '0 3 * * *', timezone: Europe/Berlin, retries: 2, timeout: 30m } }
```

## What the plan shows

- **Placements**: which replica runs where, and which ones start, stop or move.
- **Failure analysis**: single points of failure (one replica, a volume without a copy in another site) and whether the cluster keeps an N+1 reserve.
- **Pinned images**: every image is resolved to a digest at plan time; the apply deploys exactly what was reviewed, even if a tag moves. A plan with `refresh` resolves the digests and secret versions of a deployment again.
- **Pins**: things that tie a workload to one place (for example a single replica with a public port). Unacknowledged pins need `confirm: true` at apply.
- **Isolation**: for every service above `runc`, the level it runs at and the nodes offering it.

## Isolation level

`x-loadweaver.runtime` sets the service's isolation level; it always runs at exactly that level ([Isolation levels and microVMs](./isolation-levels.md)):

| Field                | Meaning                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `runtime`            | `runc` (default), `sandboxed` (gVisor), `sandboxed-kvm` (gVisor on KVM) or `microvm` (the image boots as a QEMU / KVM microVM)                   |
| `microvm.rootfsSize` | Only with `runtime: microvm`: size of each replica's writable layer (`10Gi` default; bytes or `k` / `m` / `g` / `t` / `Ki` / `Mi` / `Gi` / `Ti`) |

```yaml
services:
  sandbox:
    image: ghcr.io/acme/sandbox:2
    deploy: { resources: { limits: { cpus: '2', memory: 2g } } } # 2 vCPUs, 2 GiB guest memory
    x-loadweaver: { runtime: microvm, microvm: { rootfsSize: 20Gi } }
```

- Compose's own `runtime:` is mapped (`runsc` / `runsc-systrap` → `sandboxed`, `runsc-kvm` → `sandboxed-kvm`); unknown values are errors.
- `devices` accepts only `/dev/kvm` (`rw` / `rwm`, same path, `runtime: runc`, project allowance `workloads.allowedDevices` required; a pin). See [Devices](./isolation-levels.md#devices-devkvm).
- MicroVMs: `network_mode: host` and `privileged` are errors, `cap_add` applies inside the guest; the launcher's overhead (384 MiB, 0.25 CPU) counts into requests and quotas.

## Moving workloads

- Eligible services move **live** (CRIU checkpoint with pre-copy, or gVisor stop-and-copy for sandboxed services): memory, connections and addresses come along. See [Migration](./migration.md) for eligibility, phases and the automatic fallback.
- **Stateless** replicas move **blue / green** otherwise: the new copy starts, becomes ready, and only then the old one stops.
- **Stateful** replicas (with volumes) move with a **short stop** otherwise: the old container stops, the volume's primary moves, the new one starts.
- `sandboxed-kvm` and `microvm` services always move blue / green or with a short stop for now (no live migration of KVM-level workloads yet).
- Services of a deployment move in `depends_on` order. A move that doesn't finish within 10 minutes is rolled back.

**Removed replicas drain before they stop.** A replica a plan removes (lower `replicas`, a removed service or deployment) or the autoscaler scales away first leaves routing — ingress upstreams, service IPs, mesh endpoints and health-gated BGP announcements — while it keeps running its last spec, so requests in flight and open connections finish. After the service's `stop_grace_period` (compose; default 10 s, at least 2 s, at most 2 minutes) the control plane stops it with its stop signal and grace period. The drain deadline is stored with the placement, so a control-plane restart doesn't cut it short or let a replica run forever. A replica that is planned again while draining stays where it runs (the drain ends); planned on another node, its drain is cut short and it starts there. Replicas on a node that left are removed at once. While a replica drains, the deployment status (`GET /api/projects/{project}/deployments/{deployment}/status`) reports it with `state: draining` and the stop deadline `drainUntil` instead of its node-reported state, and the map shows it with a `draining` badge. Draining replicas are left out of the health tree (their stop is expected); project quotas count the replicas the deployments declare, so a draining replica doesn't count against them either.

**Drain** (`POST /api/nodes/{name}/drain`) moves everything off a node, including volume copies. A node can only **leave** once nothing is left on it.

**Failover**: a node that is unreachable for 60 seconds counts as lost. Stateless replicas move right away. Stateful replicas move only while the control plane has quorum, or after an operator confirms the node is gone (`POST /api/nodes/{name}/confirm-lost`), so a node cut off by a network split and its replacement never write the same volume.

## One-off jobs

`x-loadweaver.job` marks a service that runs **once per apply**:

- `phase: before` (default): the deployment's services keep running their previous version until the job succeeded; a failed job holds the update back.
- `phase: after`: runs once all services of the deployment are running.

## Autoscaling

`x-loadweaver.autoscale` scales a long-running service between `min` and `max` replicas on CPU, memory, requests per replica or a custom metric:

```yaml
x-loadweaver:
  autoscale: { min: 2, max: 10, metric: cpu, target: 70 } # 70 % of the CPU request
```

| Field          | Meaning                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------- |
| `min`, `max`   | Replica range; the compose `replicas` is only the starting count                                                    |
| `metric`       | `cpu` / `memory` (percent of the request), `requests` (per second per replica; needs `exposure.http`), `custom`     |
| `target`       | The value to keep the metric at                                                                                     |
| `customMetric` | For `custom`: a metric Loadweaver stores for the service, its replicas or hostnames (e.g. `ingress.latency_p95_ms`) |

The range and metric go through plans; the scaling is automatic within the project quota, the cluster capacity and the N+1 reserve. See [Autoscaling](./autoscaling.md).

## Backup hooks

`x-loadweaver.backup` on a service that mounts a volume makes its backups app-consistent and its restore tests meaningful: `hooks.pre` / `hooks.post` run in a replica of the service around the volume snapshot (e.g. a `pg_dump` into the volume before, cleanup after; `hooks.timeout`, default 5 min), `check.command` runs during restore tests in a container of the service's image against the restored copy (exit 0 = passed). See [Backups](./backups.md#hooks-and-check-compose).

## Cron jobs

`x-loadweaver.cron` runs a service on a schedule:

| Field         | Meaning                                                                                            |
| ------------- | -------------------------------------------------------------------------------------------------- |
| `schedule`    | Five-field cron (`minute hour day-of-month month day-of-week`), names, steps, `@daily` and friends |
| `timezone`    | IANA timezone, default `UTC`                                                                       |
| `concurrency` | `forbid` (default) skips a run while the previous one runs, `replace` stops it, `allow` runs both  |
| `retries`     | Retries after a failure, a timeout or a lost node                                                  |
| `timeout`     | Maximum run time (default 1 h); the container is stopped after it                                  |

Every due time runs **exactly once** across the cluster, also while control-plane replicas fail over. Runs that were missed while the control plane was down are not replayed one by one; the latest due time runs.

`GET /api/projects/{project}/cron-runs` lists every run with its node, state and exit code. The last finished run of a job stays on its node for its logs until the next run starts. Failed runs are recorded in the audit log.
