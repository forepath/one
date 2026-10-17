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

## Moving workloads

- **Stateless** replicas move **blue / green**: the new copy starts, becomes ready, and only then the old one stops.
- **Stateful** replicas (with volumes) move with a **short stop**: the old container stops, the volume's primary moves, the new one starts.
- A move that doesn't finish within 10 minutes is rolled back.

**Drain** (`POST /api/nodes/{name}/drain`) moves everything off a node, including volume copies. A node can only **leave** once nothing is left on it.

**Failover**: a node that is unreachable for 60 seconds counts as lost. Stateless replicas move right away. Stateful replicas move only while the control plane has quorum, or after an operator confirms the node is gone (`POST /api/nodes/{name}/confirm-lost`), so a node cut off by a network split and its replacement never write the same volume.

## One-off jobs

`x-loadweaver.job` marks a service that runs **once per apply**:

- `phase: before` (default): the deployment's services keep running their previous version until the job succeeded; a failed job holds the update back.
- `phase: after`: runs once all services of the deployment are running.

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
