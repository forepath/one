# Container Isolation Levels

Agenstra can run agent environments with **stronger container isolation** than Docker's default. Every agent manager host offers the **standard** level (Docker's `runc`) and, when the host has been prepared for it, the **sandboxed** level, which runs the environment's worker container on **gVisor** (`runsc`) instead of directly on the host kernel. The level is chosen per environment at creation time, is validated against what the host can **actually** run (real runtime probes, never configuration alone), and is never silently downgraded.

## Levels

| Level       | Rank | Docker runtime                      | Kernel boundary                                                        | Availability                                                                    |
| ----------- | ---- | ----------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `standard`  | 1    | `runc` (Docker default)             | Shares the host kernel (namespaces, cgroups, seccomp, capabilities)    | Mandatory floor of every host; the setup every manager supported before         |
| `sandboxed` | 2    | `runsc-systrap` (gVisor, `systrap`) | gVisor **Sentry** application kernel in userspace between app and host | Only when the gVisor runtime is registered with Docker **and** passes the probe |

- **Higher rank means stronger isolation.** The recommended (preselected) level of a host is its strongest **ready** level.
- **gVisor is not a VM.** The Sentry implements the Linux system call interface in userspace and only uses a small, filtered set of host system calls itself. Networking is handled by gVisor's own user-space network stack (**Netstack**), file access goes through gVisor's file proxy. A kernel exploit inside the workload therefore has to break the Sentry first instead of hitting the host kernel directly.
- **`systrap` platform** The sandboxed runtime is registered with `--platform=systrap`, which intercepts system calls with seccomp and needs **no KVM / nested virtualization**. It works on ordinary cloud VMs.
- **Standard is the floor.** If the standard probe fails, the host cannot run environments at all: no level is recommended and creation fails with `503`, even if gVisor itself would work.
- Environments created before isolation levels existed are `standard` and keep running exactly as before.

## Selection

### Automatic selection

When an environment is created without an explicit level, the strongest ready level of the host is used (`selectionSource: automatic`). On a prepared host this is `sandboxed`; on any other host it is `standard`.

### Explicit choice and override

The **Create environment** dialog shows the levels as a radio group with the recommendation preselected. Unavailable levels are disabled and show the reason reported by the host.

- Choosing the recommended level (or a stronger one) is recorded as `user-confirmed`.
- Choosing a **weaker** level than the recommendation (for example `standard` on a host where `sandboxed` is ready) is an **override**. The console asks for confirmation before submitting, the selection is recorded as `user-override` together with the selecting user, and the controller publishes an `agent.isolation_override` notification.
- An explicit level is **never replaced** by another one. If it is not ready (anymore), creation is rejected with `409 Conflict`.

### Capability revision (stale forms)

Every capability record carries a **revision** (`sha256:` content hash over Docker and kernel version, registered runtimes, probe image id and the per-level state). The console submits the revision it displayed as `capabilityRevision`. If the host's capabilities changed while the form was open (for example gVisor became unavailable), the request is rejected with `409 Conflict` and the user has to review the selection again. Requests without a revision are validated against the current state only.

### Validation chain

1. The **controller** validates the request against the host's current capabilities (`invalid-level` -> `400`, `host-not-runnable` -> `503`, `level-unavailable` / `stale-revision` -> `409`) and forwards only `isolationLevel`, the current `capabilityRevision` and the selecting user id. Client-supplied `isolationSelection` is ignored.
2. The **agent manager** re-validates with the same rules immediately before provisioning (before the egress guard or any container is created) and derives the persisted selection record itself; only `selectedBy` is taken from the controller.
3. The level is persisted on the environment (`isolation_level`, `isolation_selection`). Every later recreate (environment variable migration, configuration sync, restart paths) pins the same runtime, so a sandboxed environment never comes back on `runc`.

### Selection record

```json
{
  "level": "standard",
  "runtime": "runc",
  "selection": {
    "automaticSelection": "sandboxed",
    "effectiveSelection": "standard",
    "selectionSource": "user-override",
    "selectedBy": "user-uuid",
    "selectedAt": "2026-10-15T09:12:00.000Z",
    "capabilityRevision": "sha256:4f1c..."
  }
}
```

Returned as `isolation` on agent responses. `selection` is `null` for environments created before isolation levels existed.

## Failure behavior

- **No silent downgrade.** If the sandboxed worker container cannot be created or started, or never becomes healthy on gVisor, the environment is **not created** and the request fails with `400` (`The sandboxed (gVisor) container could not be started: ... retry or explicitly choose the standard isolation level.`). The workload is never retried on a weaker runtime; the user decides.
- The controller publishes `agent.sandbox_creation_failed` for such runtime failures (not for validation errors such as a duplicate name) and refreshes the workspace's capability snapshot.
- **Re-probe after repeated failures.** The manager counts consecutive sandboxed runtime failures. After `AGENT_ISOLATION_FAILURE_THRESHOLD` (default `3`) failures it re-probes; a broken runtime then turns `probe-failed` and stops being offered. A successful sandboxed start resets the counter.
- An unreachable registry or other transient failure of the **standard** probe does not keep a host unusable until the next scheduled probe: creation re-probes when the floor is not ready.

## Capability probing

The agent manager probes which levels it can run:

- on **startup** (stale probe containers and volumes of an interrupted process are removed first; environment creation waits for the first probe),
- **periodically** every `AGENT_ISOLATION_PROBE_INTERVAL_MS` (default 6 h, ±10 % jitter, minimum 1 min; disable with `AGENT_ISOLATION_PROBE_ENABLED=false`),
- **on demand** (`POST /api/isolation/probe`; joins a running probe and reuses results younger than 30 s),
- after **repeated sandboxed runtime failures** (see above).

Concurrent requests share one in-flight probe. The current record is served from memory; `probing: true` indicates that a probe is running and the states still reflect the previous one.

### What a probe checks

Each level is probed with short-lived containers (label `io.agenstra.isolation-probe=1`, name prefix `agenstra-isolation-probe-`) on the level's runtime, using the **real worker image** (`AGENT_ISOLATION_PROBE_IMAGE`, otherwise the configured worker image). Pulling the image does not count against the probe timeout.

1. Docker daemon reachable (`docker info`), runtime registered with Docker (`sandboxed` only)
2. Container starts and actually runs on the requested runtime (`HostConfig.Runtime`)
3. Volume file operations (write, `sync`, rename, read back, delete)
4. `docker exec` exit codes are propagated, and exec as a non-root user works
5. stdout and stderr are captured in the container logs
6. **Shared network namespace** (`sandboxed` only, when the egress guard is enabled): a `runc` container owns the namespace and a sandboxed container joins it with `NetworkMode: container:<owner>`, exactly like a sandboxed worker joins its egress guard
7. Everything finishes within `AGENT_ISOLATION_PROBE_TIMEOUT_MS` (default 90 s)

The sandboxed level is only probed on top of a healthy standard floor. Presence of the `runsc` binary or a `daemon.json` entry alone never makes a level ready.

### States

| State                 | Meaning                                                                                |
| --------------------- | -------------------------------------------------------------------------------------- |
| `ready`               | The probe passed; the level can be selected                                            |
| `unsupported`         | The runtime is not registered with Docker on this host (host not prepared)             |
| `installation-failed` | Reserved for host preparation that failed to install the runtime                       |
| `probe-failed`        | The runtime is registered but a probe step failed (or the probe has not completed yet) |
| `disabled-by-admin`   | `AGENT_ISOLATION_SANDBOX_ENABLED=false` on this agent manager                          |

### Reason codes

| Code                                    | Meaning                                                                                                                                                                                                          |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `E_RUNTIME_NOT_REGISTERED`              | `AGENT_SANDBOX_RUNTIME` is not a registered Docker runtime                                                                                                                                                       |
| `E_DOCKER_BASELINE_UNAVAILABLE`         | Docker daemon not reachable                                                                                                                                                                                      |
| `E_RUNC_PROBE_FAILED`                   | Standard probe failed (also reported for `sandboxed` when it was skipped for that reason)                                                                                                                        |
| `E_PROBE_PENDING`                       | No probe has completed since the manager started                                                                                                                                                                 |
| `E_PROBE_IMAGE_UNAVAILABLE`             | The probe (worker) image could not be pulled. The standard level stays `ready` (reported with this code, the Docker baseline itself is reachable); the sandboxed level is withheld because it cannot be verified |
| `E_PROBE_START_FAILED`                  | The probe container could not be created or started                                                                                                                                                              |
| `E_PROBE_EXEC_FAILED`                   | Exec exit codes or non-root exec failed                                                                                                                                                                          |
| `E_PROBE_FILESYSTEM_FAILED`             | Volume file operations failed                                                                                                                                                                                    |
| `E_PROBE_LOGS_FAILED`                   | Container logs were not captured                                                                                                                                                                                 |
| `E_PROBE_RUNTIME_MISMATCH`              | The container did not run on the requested runtime                                                                                                                                                               |
| `E_PROBE_TIMEOUT`                       | The probe exceeded `AGENT_ISOLATION_PROBE_TIMEOUT_MS`                                                                                                                                                            |
| `E_SHARED_NETNS_FAILED`                 | The guard topology check failed (loopback proxy unreachable or owner lost its interfaces)                                                                                                                        |
| `E_SHARED_NETNS_RUNTIME_NOT_REGISTERED` | `AGENT_SANDBOX_SHARED_NETNS_RUNTIME` is not registered (egress guard enabled)                                                                                                                                    |
| `E_REPEATED_RUNTIME_FAILURES`           | Reserved for runtime failures that exceeded the failure threshold                                                                                                                                                |
| `E_DISABLED_BY_ADMIN`                   | Sandboxed level disabled by configuration                                                                                                                                                                        |
| `E_MANAGER_UNSUPPORTED`                 | Controller only: the workspace's agent manager predates isolation levels                                                                                                                                         |

Reasons are short operator-facing texts and never contain secrets or workspace content.

## Egress guard interaction

The [egress guard](./egress-filtering.md) sidecar always runs on Docker's default runtime (**`runc`**; it needs netfilter and `CAP_NET_ADMIN` in its network namespace). Sandboxed workers behind a guard join the guard's network namespace like standard workers.

gVisor's own network stack (Netstack) cannot be used in that topology: it takes over the namespace's interfaces (the guard loses its address) and bypasses the guard's netfilter rules and its loopback proxy. Sandboxed workers that share a guard's namespace therefore run on a second gVisor runtime, **`runsc-systrap-hostnet`** (`--platform=systrap --network=host`, `AGENT_SANDBOX_SHARED_NETNS_RUNTIME`): the sandbox still mediates every system call in the Sentry, but socket operations use the kernel network stack of the guard's namespace (not the host's), so the guard's rules and proxy apply unchanged. Sandboxed workers without a guard keep Netstack (`runsc-systrap`). The agent manager picks the variant automatically on every create and recreate (for example when an environment later joins a guard).

On hosts with the guard enabled, the sandboxed level is only `ready` when both runtimes are registered and the probe verified the guard topology: a default-runtime container serves on `127.0.0.1` in its namespace, the sandboxed member must reach it there, and the owner must keep its interfaces.

## Legacy agent managers

Agent managers that predate isolation levels have no `/api/isolation` endpoint and run every environment on `runc`. The controller treats them as **standard-only**: the workspace summary reports `supported: false`, `sandboxed` as `unsupported` (`E_MANAGER_UNSUPPORTED`), an explicit `sandboxed` request is rejected with `409`, and environments are created on `runc` as before. Upgrade the manager (and prepare the host) to offer the sandboxed level.

## API

### Agent manager

- `GET /api/isolation` - Current capability record (`HostIsolationCapabilitiesDto`)
- `POST /api/isolation/probe` - Re-probe now (joins a running probe; results younger than 30 s are reused)
- `GET /api/config` - Includes `isolation` (same record)
- `POST /api/agents` - Accepts `isolationLevel`, `capabilityRevision`, `isolationSelection` (only `selectedBy` is used); `400` invalid level or sandboxed start failure, `409` unavailable level or stale revision, `503` host cannot run environments
- `GET /api/agents`, `GET /api/agents/:id` - Include `isolation` (`level`, `runtime`, `selection`)

`HostIsolationCapabilitiesDto`:

```json
{
  "revision": "sha256:4f1c...",
  "probedAt": "2026-10-15T09:00:00.000Z",
  "probing": false,
  "levels": {
    "standard": { "rank": 1, "runtime": "runc", "state": "ready" },
    "sandboxed": { "rank": 2, "runtime": "runsc-systrap", "state": "ready" }
  },
  "recommendedLevel": "sandboxed",
  "availableLevels": ["sandboxed", "standard"]
}
```

### Agent controller

- `GET /api/clients/:id/isolation` - Workspace isolation summary (`clients:read` and workspace access); falls back to the last stored snapshot (`stale: true`) when the manager is unreachable
- `POST /api/clients/:id/isolation/probe` - Re-probe the workspace host (`clients:write` and workspace management access)
- `GET /api/clients`, `GET /api/clients/:id` - Include `isolation` (summary) next to `config`
- `POST /api/clients/:id/agents` - Accepts `isolationLevel` and `capabilityRevision`; same status codes as the manager

`ClientIsolationSummaryDto` carries the manager record (`levels`, `recommendedLevel`, `availableLevels`, `revision`, `probedAt`, `probing`) plus `supported` (`false` for legacy managers, `revision` is then `null`) and `stale`. See the OpenAPI specifications for the full schemas.

## Notifications

The controller keeps the last observed capability record per workspace (`client_isolation_snapshots`) and publishes **transitions** as [webhook](./webhooks.md) events. Snapshots are updated whenever capabilities are fetched (workspace responses, `GET`/`POST` isolation endpoints, failed sandboxed creations) and by the background job **`isolation-capabilities`** (coordinator + per-workspace unit job, oldest snapshots first). Only completed probes are recorded; a conditional update ensures each transition is published once even with several controller instances.

| Event                           | When                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------ |
| `isolation.sandbox_available`   | The sandboxed level of a workspace host became `ready`                               |
| `isolation.sandbox_unavailable` | The sandboxed level was `ready` and is not anymore                                   |
| `isolation.baseline_failed`     | The standard floor is not `ready` (host cannot run environments); once per new state |
| `agent.isolation_override`      | An environment was created with a weaker level than recommended                      |
| `agent.sandbox_creation_failed` | A sandboxed environment could not be started (not retried on `runc`)                 |

## Host preparation

The sandboxed level needs the gVisor runtime registered with Docker on the agent manager host. Docker's **default runtime stays `runc`**; gVisor is added as an additional runtime that only the agent manager selects explicitly per container.

### Provisioned servers

Servers provisioned by Agenstra (Hetzner Cloud, DigitalOcean) and Decabill-provisioned hosts prepare gVisor in their cloud-init script after Docker is installed:

1. Download a **pinned** gVisor release (`GVISOR_RELEASE`) and verify its **checksums**
2. Register the runtime `runsc-systrap` with `runsc install --runtime=runsc-systrap -- --platform=systrap` (merges into `/etc/docker/daemon.json`; the default runtime is not changed) and reload Docker
3. Verify the runtime with a test container
4. On any failure, **roll back** the gVisor installation and runtime registration

Host preparation never fails provisioning: the `runc` floor is always preserved, and the manager simply reports `sandboxed` as `unsupported` or `probe-failed`.

### Existing hosts

Use the standalone script `apps/agenstra/backend-agent-manager/host/agenstra-gvisor.sh` (run as root on the Docker host):

```bash
sudo ./agenstra-gvisor.sh check            # report kernel, architecture, Docker and runtime status
sudo ./agenstra-gvisor.sh install          # install pinned gVisor and register runsc-systrap (rolls back on failure)
sudo ./agenstra-gvisor.sh uninstall        # remove the runtime registration and binaries
sudo ./agenstra-gvisor.sh check --json     # machine-readable output
```

For the standalone script, `GVISOR_RELEASE` overrides the pinned release and then requires `GVISOR_SHA512` (the archive checksum for the host architecture); cloud-init always installs the pinned release. After installing, trigger **Re-check isolation** (Update Workspace modal) (or `POST /api/isolation/probe`) instead of waiting for the next scheduled probe. The script registers both runtimes (`runsc-systrap` and `runsc-systrap-hostnet`); if you register them under other names, set `AGENT_SANDBOX_RUNTIME` / `AGENT_SANDBOX_SHARED_NETNS_RUNTIME` accordingly. The standalone script only reloads Docker (runtimes are reloadable); it never restarts a running host.

Host requirements for the sandboxed level: Linux kernel **5.6 or newer**, **x86_64** or **arm64**, cgroup v2 recommended. See [System Requirements](../deployment/system-requirements.md).

## Configuration

### Agent manager

| Variable                             | Default                 | Description                                                                                                             |
| ------------------------------------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `AGENT_SANDBOX_RUNTIME`              | `runsc-systrap`         | Docker runtime name of the sandboxed level (`[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}`; invalid values fall back to the default) |
| `AGENT_SANDBOX_SHARED_NETNS_RUNTIME` | `runsc-systrap-hostnet` | gVisor runtime (`--network=host`) for sandboxed workers sharing their egress guard's network namespace                  |
| `AGENT_ISOLATION_SANDBOX_ENABLED`    | `true`                  | `false` disables the sandboxed level (`disabled-by-admin`)                                                              |
| `AGENT_ISOLATION_PROBE_ENABLED`      | `true`                  | `false` disables the periodic re-probe (startup, on-demand and failure-triggered probes still run)                      |
| `AGENT_ISOLATION_PROBE_INTERVAL_MS`  | `21600000` (6 h)        | Periodic re-probe interval (minimum `60000`)                                                                            |
| `AGENT_ISOLATION_PROBE_TIMEOUT_MS`   | `90000`                 | Upper bound of a single level probe (minimum `5000`)                                                                    |
| `AGENT_ISOLATION_PROBE_IMAGE`        | worker image            | Probe image; empty uses `OPENCODE_AGENT_DOCKER_IMAGE` / `AGENT_DEFAULT_IMAGE`                                           |
| `AGENT_ISOLATION_FAILURE_THRESHOLD`  | `3`                     | Consecutive sandboxed runtime failures that trigger a re-probe                                                          |

The manager needs the Docker socket (as for agent containers). It does not need access to `daemon.json` or the `runsc` binary; host preparation is done outside the manager container.

### Agent controller

| Variable                             | Default  | Description                                 |
| ------------------------------------ | -------- | ------------------------------------------- |
| `ISOLATION_CAPABILITIES_INTERVAL_MS` | `900000` | Coordinator interval (`0` disables the job) |
| `ISOLATION_CAPABILITIES_BATCH_SIZE`  | `25`     | Workspaces refreshed per coordinator run    |

See [Background Jobs](../deployment/background-jobs.md).

## Limitations and performance

- **Compatibility** gVisor implements most, but not all, of the Linux system call surface. Known gaps relevant to agent workloads: no `io_uring`, no `iptables` / netfilter configuration inside the sandbox, no KVM (no nested VMs or emulators that need `/dev/kvm`), limited FUSE support, and **Docker-in-Docker** or other container runtimes inside the environment are not supported. Tools that need raw kernel features (eBPF, kernel modules, `perf`) do not work. Use the `standard` level (an explicit, confirmed override) for such environments.
- **Performance** CPU-bound work runs at near-native speed. System-call-heavy work is slower: filesystem **metadata** operations (`npm install`, `git status` on large trees, builds touching many small files) and **network** throughput through Netstack show noticeable overhead. Expect slower dependency installs and builds than on `runc`.
- **Memory** The Sentry and gofer processes add some memory overhead per environment.
- **Not a VM boundary** gVisor substantially reduces the host kernel attack surface but is not a hardware virtualization boundary; it complements, and does not replace, non-root workloads, the egress guard and host hardening.
- The egress guard sidecar always runs on `runc`; only the agent worker container is sandboxed. Guarded sandboxed workers use the namespace's kernel network stack (`runsc-systrap-hostnet`) instead of Netstack, so the network part of the sandbox is weaker than for unguarded workers (the guard's namespace, not the host network, is exposed).
- The level is fixed at creation. To change it, create a new environment with the desired level.
- `installation-failed` and `E_REPEATED_RUNTIME_FAILURES` are reserved values; the current manager reports host preparation problems as `unsupported` / `probe-failed`.

## Troubleshooting

| Symptom                                             | Check                                                                                                                                                                         |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sandboxed level shows `unsupported`                 | Host not prepared or runtime registered under another name: run `agenstra-gvisor.sh check`, `docker info --format '{{json .Runtimes}}'`, compare with `AGENT_SANDBOX_RUNTIME` |
| `E_PROBE_IMAGE_UNAVAILABLE` (sandboxed withheld)    | Registry unreachable or wrong `AGENT_ISOLATION_PROBE_IMAGE`; fix and **Re-check isolation**                                                                                   |
| `probe-failed` with `E_SHARED_NETNS_FAILED`         | gVisor release too old or misconfigured for shared namespaces; reinstall with the pinned release                                                                              |
| `probe-failed` with `E_PROBE_TIMEOUT`               | Host overloaded or slow storage; raise `AGENT_ISOLATION_PROBE_TIMEOUT_MS`                                                                                                     |
| Creation fails with `409`                           | Capabilities changed while the dialog was open (stale revision) or the chosen level is no longer ready; reopen the dialog and review                                          |
| Creation fails with `503`                           | Standard (`runc`) baseline failed: check Docker on the host (`E_DOCKER_BASELINE_UNAVAILABLE`, `E_RUNC_PROBE_FAILED`)                                                          |
| "sandboxed (gVisor) container could not be started" | Workload incompatible with gVisor or runtime broken; check `docker logs` of the manager, retry, or create the environment as `standard`                                       |
| Summary shows `stale: true`                         | The agent manager is unreachable; the last stored snapshot is shown                                                                                                           |
| Leftover `agenstra-isolation-probe-*` containers    | Removed automatically on the next manager start                                                                                                                               |

## Related documentation

- **[Agent Management](./agent-management.md)** Creating environments
- **[Client Management](./client-management.md)** Workspace isolation summary
- **[Server Provisioning](./server-provisioning.md)** gVisor host preparation
- **[Egress Filtering](./egress-filtering.md)** Egress guard sidecar
- **[Webhooks](./webhooks.md)** Isolation notifications
- **[Backend Agent Manager](../applications/backend-agent-manager.md)** `/isolation`, `/isolation/probe`

---

_Diagram: `libs/domains/agenstra/backend/feature-agent-controller/docs/isolation-capabilities.mmd`._
