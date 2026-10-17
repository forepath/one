# Migration

Replicas move between nodes when a plan changes their placement, when a node is drained, and on failover. Loadweaver picks the method **per service**, shows it in the plan and falls back automatically when a live attempt fails.

## Methods

| Method                     | Used for                                                        | Downtime                                     | State                                     |
| -------------------------- | --------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------- |
| **live**                   | `runc` services that are eligible (below)                       | a short freeze (typically well below 1 s)    | memory, open connections and address kept |
| **stop-and-copy (gVisor)** | eligible sandboxed services (`x-loadweaver.runtime: sandboxed`) | the whole checkpoint / restore (seconds)     | memory, open connections and address kept |
| **blue-green**             | stateless services that aren't eligible                         | none: the new copy runs before the old stops | the new copy starts fresh                 |
| **short-stop**             | stateful services that aren't eligible                          | seconds: stop, move the volume, start        | volume data kept                          |

The plan lists every move with its method and, if it isn't live, the reason:

```
move shop/live/api/0 n1 → n2 (live)
move shop/live/db/0 n1 → n3 (short-stop (volume shop/live/data has no synchronous replica on n3))
move shop/live/old/0 n1 → n4 (blue-green (agent on n4 does not support live migration))
```

The method is checked again at apply; if it changed in the meantime (for example a node lost checkpoint support), the apply refuses and asks for a new plan.

## Eligibility

A replica is migrated with a checkpoint only if all of these hold; the first one that doesn't is the reason shown in the plan:

- it is a long-running service (one-off jobs restart);
- live migration isn't disabled for the service: `x-loadweaver: { liveMigration: false }` (use it for software that misbehaves after a restore);
- the source node is reachable (failover is never live);
- no privileged container, no host network, no devices (GPUs), no bind mounts of host paths;
- stateful services move only to a node that holds a **synchronous** replica of every volume;
- both nodes run an agent that supports live migration and report checkpoint support for the runtime: CRIU through `runc` for live, gVisor's `runsc` for stop-and-copy;
- the **estimated freeze** fits the budget: what is frozen (tmpfs contents, which are never pre-copied, plus the memory the last pre-copy round dirtied; for gVisor the whole memory) divided by the link speed between the nodes, plus a fixed checkpoint / restore cost. Memory comes from the replica's `replica.memory_bytes` metric, else its limit or request.

| Variable                                     | Default      | Meaning                                    |
| -------------------------------------------- | ------------ | ------------------------------------------ |
| `LOADWEAVER_LIVE_MIGRATION_FREEZE_BUDGET_MS` | `3000`       | Longest acceptable freeze                  |
| `LOADWEAVER_LIVE_MIGRATION_LINK_BPS`         | `1000000000` | Link speed when the nodes don't report one |
| `LOADWEAVER_LIVE_MIGRATION_DIRTY_FRACTION`   | `0.05`       | Share of the memory dirtied per second     |

## Phases of a live migration

1. **prepare**: the target opens a transfer endpoint for this attempt (mutual TLS over WireGuard plus a single-use token), pulls the image and prepares the replica without starting it.
2. **precopy**: the source copies the memory in rounds while the replica keeps running (CRIU pre-dumps), until the changed memory is small. gVisor skips this step.
3. **freeze**: the source dumps the rest. A stateless replica is paused, cut off the network and dumped with its processes left alive (never killed before the cut-over); a replica with volumes is dumped and stopped, so its volumes can be flushed and demoted (the target promotes them). A gVisor replica is cut off the network and checkpointed whole by `runsc checkpoint` (memory, root filesystem writes and its network stack with the open connections); the sandbox stops.
4. **transfer**: the final dump and the container's writable layer (gVisor: the checkpoint image and the container's process definition) go to the target.
5. **restore**: the target takes over the volumes and restores the replica with the **same addresses**; established TCP connections continue.
6. **cutover**: the placement switches to the target, its node announces the replica's addresses, the source deletes the stopped container.
7. **done**.

Any failure or timeout **aborts** the attempt: the target discards what it restored first and demotes the volumes, then the source resumes the replica (a paused replica is reconnected and thawed; a stopped one — replicas with volumes, gVisor replicas — is restored from its own final dump / checkpoint image, so its connections survive here too, or — if that fails — started again). After that the move continues as **short-stop** (stateful) or **blue-green** (stateless), recorded as the next attempt with the reason. Nothing is lost on the way: the source runs until the target does.

Per-phase limits: prepare 2 min, pre-copy 10 min, freeze 1 min, transfer 5 min, restore 2 min, cut-over 2 min, abort 1 min.

### Addresses

A live-migrated replica keeps its addresses, even though they belong to the source node's pod subnet: its new node routes them to the container and announces them as host routes (`/32`, `/128`), which are more specific than the subnet of the node they came from. The source node never hands these addresses out again while they are in use. After a blue-green or short-stop move a replica gets new addresses on its node, as before; its service IP never changes.

Connections through the ingress and direct connections keep working across a live migration; connections through the service mesh reconnect (Envoy retries them).

### Restored replicas

A replica restored from a checkpoint runs as a container the node agent manages directly (logs, metrics, terminals and health checks work as usual) until its next restart; then it is created through Docker again.

How: Docker can't restore checkpoints itself (`docker start --checkpoint` is broken on Docker 28 / 29), so the target creates the replica's container through Docker as usual — image, writable layer (the source's changes applied before it starts), volumes, the kept address — but starts a tiny placeholder process in it instead of the image's entrypoint. The checkpoint is then restored with runc into the placeholder's network namespace, root filesystem and a child of its cgroup. Docker therefore still provides the replica's logs (the restored process writes into the container's own output), resource limits and statistics, and health checks (they run next to the process, with the same filesystem and network); terminals use `runc exec` with the container's own capabilities and profiles. When the restored process ends, the agent removes the container and creates the replica through Docker again (with its kept address).

**gVisor** replicas work the same way with `runsc restore` (Docker's sandbox runtime flags, the agent's own runsc state): the restored sandbox joins the placeholder's network namespace and copies its interface, kept address and routes into its own network stack, and its established TCP connections continue (gVisor restores them). Until the sandbox runs, the node drops traffic to the replica's addresses (the placeholder's kernel would reset the connections otherwise). Root filesystem writes live inside the sandbox and travel with the checkpoint. Docker's health check would probe the placeholder rather than the sandbox, so the agent runs the replica's health check itself with `runsc exec` (Docker's semantics: interval, timeout, retries, start period; the image's check if the service has none); logs and statistics stay Docker's, terminals use `runsc exec`, and the file browser is not available (as for every sandboxed replica). Restores pass `--allow-connected-on-save`: gVisor enables connection migration only for sandboxes it starts, so without it the next checkpoint of a restored sandbox (a further move, or a resume after an aborted one) would reset its connections.

## Node side

| Step              | What the node agent does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| prepare (target)  | Opens the transfer endpoint on its overlay address (port 7460, TLS 1.3 with its node certificate; only the source node's certificate plus the attempt's token are accepted; received files land only in the attempt's directory: the only symlink accepted is CRIU's `<image dir>/parent -> ../<image dir>`, nothing is written, created or removed through a link, files are opened with `O_NOFOLLOW`, batches of one attempt are received one after another), allows the source in nftables, pulls the image, creates the container |
| precopy (source)  | `runc checkpoint --pre-dump` rounds on Docker's runc state (each on top of the previous one), streamed with a SHA-256 per file; stops when a round is below the control plane's threshold, reports bytes and the dirty rate per round                                                                                                                                                                                                                                                                                                 |
| freeze (source)   | Restart policy off, pause (stateless), host-side veth down (packets aren't acknowledged by the frozen sockets), final dump, tar of the writable layer, volumes demoted (stateful); gVisor: veth down, `runsc checkpoint` (the sandbox stops); over the freeze budget it resumes at once                                                                                                                                                                                                                                               |
| transfer (source) | Sends the final dump, the writable layer and the freeze start time                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| restore (target)  | Waits for the volumes to be handed over, applies the writable layer, starts the placeholder (traffic to its addresses dropped meanwhile), `runc restore --tcp-established` / `runsc restore` (the gVisor binaries are read at prepare)                                                                                                                                                                                                                                                                                                |
| commit            | Source: removes the frozen container (still disconnected, so no connection resets leak). Target: closes the endpoint. Both delete the checkpoint data                                                                                                                                                                                                                                                                                                                                                                                 |
| abort             | Target: removes what it restored, demotes the volumes. Source: resumes (see above)                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

Commands are idempotent: the control plane repeats a command until the node reports the phase, and a repeated command only repeats the report. Sessions survive an agent restart on disk (commit and abort still work; the transfer endpoint doesn't).

**Kept addresses on the node:** replicas whose address belongs to another node's pod subnet attach to the agent's `loadweaver-kept` Docker network (network + IPAM plugin): exactly the kept address (`/32`, `/128`), a routed veth `lwk…` with a link-local gateway, a host route to it, anti-spoofing per veth. The node's firewall and resolver treat these veths like the pod bridge. The plugin keeps its endpoints in `kept-endpoints.json` under the agent's state directory (writes serialized, each through its own temporary file); an unreadable file is rebuilt from Docker's `loadweaver-kept` networks (their endpoints and addresses) instead of keeping the plugin from starting.

**Replicated volumes and aborts (never two primaries):** DRBD refuses a second primary while the peers are connected, so the source can only promote again once the target demoted. If the target is unreachable, the source resumes only when the volume has a quorum (three or more copies: a cut-off target without quorum suspends its I/O); a volume with two copies stays down on the source, and the fallback / failover decides.

### Measured (VM lab, Debian 13, kernel 6.12, Docker 29.9.1, runc 1.5.2, CRIU 4.1.1, KVM guests on one WSL2 host)

| Replica                                                                                                     | Pre-copy                                | Final dump                    | Freeze + transfer (source) | Restore (target)              | Freeze          |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------- | ----------------------------- | -------------------------- | ----------------------------- | --------------- |
| 64 MB anonymous memory, 100 ms counter, one TCP client                                                      | 2 rounds: 129 MB, then 0.3 MB (84 KB/s) | 0.4 MB                        | 0.6–0.7 s                  | 0.4–1.2 s                     | **≈ 1.9 s**     |
| 32 MB + appending to a DRBD volume (protocol C) every 100 ms                                                | 2 rounds: 33 MB, then 0.25 MB           | 0.3 MB                        | 0.9–1.1 s (incl. demote)   | 0.8–1.1 s                     | **≈ 1.9 s**     |
| gVisor (`runsc` 20261012.0, systrap): 16 MB, 100 ms counter, one fully established TCP client, kept address | none (stop-and-copy)                    | 17 MB checkpoint in 0.2–0.4 s | 1.0–1.6 s                  | 0.8–1.4 s (outliers to 3.3 s) | **≈ 2.0–2.6 s** |

Restore includes starting the replica's container (placeholder, network) on the target. gVisor: the connection survived the move and a further checkpoint (aborted move, resumed from the source's own image in ≈ 0.6 s); the stream resumes with the client's next retransmission. The established TCP connection continued without an error, the counter went on from where it stopped, and the volume's sequence had no gap and no duplicate. The default freeze budget is 3 s; in the lab the gap the application saw was ≈ 3 s because the test driver adds about a second of round trips between transfer and restore (the control plane reacts to the report directly).

### Limits

- **gVisor:** no pre-copy, the whole memory is frozen (stop-and-copy), so the estimate grows with the replica's memory; the control plane counts 2 s of fixed cost on top of the transfer. While a gVisor replica is stopped its host route is gone (the sandbox and its veth are), so the node re-announces the address when it runs again. Source and target need the same gVisor release.
- Shared memory (`/dev/shm`) and `tmpfs` mounts are copied in the final dump only (never pre-copied); they count fully towards the freeze.
- Containers with a shareable IPC namespace, host networking, devices or bind mounts of host paths aren't eligible.
- A replica keeps its addresses until it is moved again by short stop or blue-green; IPv6 kept addresses use a `fe80::1` gateway on their veth.

## Dependency order

When several services of a deployment move in one plan or drain, a replica waits for the moving replicas of the services it depends on (`depends_on`, also transitively) to have moved and to run (healthy, if they have a health check). Independent services move in parallel.

## History

`GET /api/migrations?replica=&project=&deployment=` lists every attempt with method, phase, fallback reason, freeze time, checkpoint size and pre-copy rounds (scope `projects:read`; cluster roles see every project, everyone else the projects they can read). Migrations also appear on the timeline (`migration` events: started, cut over, done, aborted) and in the audit log (`workload.migrated`, `workload.migration-aborted`, `workload.migration-fallback`, `workload.migration-failed`).
