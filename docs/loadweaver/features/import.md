# Importing Docker hosts and former nodes

Any Docker host can join the cluster, including hosts that already run containers or compose projects and hosts that were Loadweaver nodes before (of this cluster or another one). The join starts with a **read-only discovery**; an **import wizard** in the console decides per item what happens; the result is **one plan** that installs the node components, imports or migrates what runs there with a short stop, and hands the host's ports over to the Loadweaver ingress. Nothing changes on the host before that plan is approved.

## 1. Join with `--discover`

Create a join token (console: Nodes, or `POST /api/join-tokens`) and run the installer with `--discover` on the host:

```bash
curl -fsSL https://cp.example.com/api/install/install.sh | sudo LOADWEAVER_JOIN_TOKEN=<token> bash -s -- --name shop1 --discover
```

With `--discover` the installer only installs the node agent (checksum-verified) and its systemd unit — no packages, no Docker settings, no sysctls. The agent then:

1. **discovers read-only** (`loadweaver-agent discover` prints the same report as JSON): compose projects (from the `com.docker.compose.*` labels, their compose files and `.env`), containers with port bindings and mounts, volumes with their sizes, networks, listening sockets (`ss`), interfaces, routes, WireGuard / Tailscale / OpenVPN / IPsec / ZeroTier interfaces, nftables tables, and what a former Loadweaver installation left (state directory, `lw-*` DRBD resources and their backing volumes, `lw*` interfaces, `inet loadweaver` tables, managed containers). It only reads: Docker's API (list / inspect / disk usage), `ss`, `ip -j`, `wg show`, `nft -j list tables`, `lvs`, `drbdsetup status` and files;
2. **joins as `pending`**: the node gets its identity and opens its stream to the control plane, but receives **no desired state** — no tunnel, no firewall, no containers, and it is nobody's WireGuard peer. The agent doesn't even offer its volume plugin socket or clean up anything until the node is activated.

The report travels with the join request. **Secrets stay on the host**: values of `.env` variables whose names look sensitive (`PASS`, `SECRET`, `TOKEN`, `KEY`, `URL`, `URI`, `CONN`, …) or that contain URL credentials (`postgres://app:pw@db`) are left out; in compose files, such `environment` values become `${NAME}` placeholders and URL credentials anywhere else become `${LW_REDACTED_<n>}`; container labels other than compose's are not reported. The control plane redacts again before it stores the report (defense in depth). The wizard asks for the redacted values that the compose file needs.

A former node's identity, keys and last applied state are moved to `/var/lib/loadweaver/former-<cluster id>/` by the join (the old desired state is never re-applied); the join plan decides what happens to them.

## 2. The import wizard

Console: **Import hosts** (or the node's "Import wizard" link in Nodes & sites), API: `GET /api/imports`, `GET /api/imports/{node}`.

Per discovered item — a compose project or a standalone container — choose:

| Choice  | What happens                                                                                                                                                                                                                                 |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Import  | Becomes a `Deployment` of the target project, pinned to this node (`loadweaver.com/node`). Its data is copied into replicated volumes.                                                                                                       |
| Migrate | Becomes a `Deployment` that runs on other nodes (`loadweaver.com/node NotIn [this]`); the source stops once the new replicas run (make-before-break). Only for items without data: import stateful items, then move them with a normal plan. |
| Ignore  | Left as it is; it stays visible as drift.                                                                                                                                                                                                    |

For imported items:

- **Ports**: a host port served over HTTP gets a hostname and becomes an ingress route (`x-loadweaver.exposure.http`); ports 80 / 443 always need one (the HTTP ingress routes by host name). Other ports stay in `ports:` and become ingress forwards on the same port.
- **Data**: each Docker volume and bind mount is copied into a new replicated volume (default), starts empty, or — bind mounts only — keeps the host path (pins the service to the node). Volume sizes are 1.5 × the used size, at least 1 GiB.
- **Compose file**: the project's own file when discovery could read exactly one (its options, environment and dependencies stay), otherwise one generated from the running containers. `.env` values become deployment `variables`.

Saving the selection (`PUT /api/imports/{node}/selection`) returns the **join plan**: conflicts, the former installation, the deployments and the ordered steps. Nothing is applied yet.

### Conflicts

Resolved by the plan:

- **WireGuard ports**: the node's generated WireGuard listen ports skip every UDP port the host uses (stored on the node as reserved ports).
- **Ports of imported containers** (e.g. nginx on 80): freed when the source stops, then taken over by the ingress.
- **Pre-existing tunnels** (WireGuard, Tailscale, OpenVPN, IPsec): usable as the bootstrap path to the control plane; once the node's own WireGuard tunnel is up, the agent's stream switches over make-before-break and the old tunnel is ignored entirely afterwards. Loadweaver only uses its own `lw-*` interfaces and its own nftables tables, so foreign rules and tunnels stay intact.

Refused, with a reason (the plan can't be created):

- **Overlapping subnets**: a host route or address overlapping the cluster's pod, service or overlay pool, or the node's own subnet — pick another range or remove the overlap.
- **Ports every node binds** (BIRD 179/tcp, transfers 7460/tcp, mesh / egress proxies 15001 / 15443 / 15080 / 15444) held by a host service on all addresses.
- **Interfaces named like Loadweaver's** (`lw0`, `lwbr0`, `lw-vpn`, `lw-<id>`, `lwk*`) on a host that never ran Loadweaver.
- Hostnames or ingress forwards already used by another deployment, existing deployment names, missing projects, unset variables, compose errors.

Warnings: host services on 80 / 443 that aren't imported (the node can't hold ingress addresses while they run) and on control-plane member ports (etcd 2379 / 2380, Postgres / Patroni 5432 / 5433 / 8008, Garage, Valkey, the API, Kopia 7500–7755, …). A node with such a port in use is **never promoted to a control-plane member**: the membership skips it and, when that costs the cluster a member, says why (`GET /api/cluster` → `controlPlane.warnings`: `node n3 is not promoted to a control-plane member: host services use member port(s) tcp/5432; …`). The ports are the ones the discovery found; after moving the service off the node, join it again to clear them.

## 3. One plan

`POST /api/imports/{node}/plan` creates a normal plan (see [Plan and apply](./plan-and-apply.md)): the imported `Deployment`s plus the node's `NodeImport` resource carrying the join plan's steps. It is reviewed, approved and applied like any plan; only the steps the wizard built are executed (a hand-written `NodeImport` that differs is refused at apply).

Applying it makes the node `importing`: the planner places the imported deployments on it (their replicated volumes are created there), but they are **held** — they don't run and get no ingress routes until their release step. The import controller then runs the steps:

1. **Components** — the installer's component setup as an idempotent script, run by the agent outside its sandbox: only missing packages are installed (base tools, WireGuard, nftables, BIRD, keepalived, rsync, the pinned storage packages), Docker gets live-restore and is **reloaded, never restarted** (the host's containers keep running), gVisor, sysctls.
2. **Wipe identity** (only for a former node of another cluster, explicit in the plan) / **reuse replicas** (former node of this cluster).
3. **Activate** — the node becomes `active` and gets its desired state: its own WireGuard tunnel, routes, filtering, the replicated volumes. The agent's stream moves from the bootstrap path to the overlay make-before-break.
4. Per imported deployment: **rsync pre-copy** into the replicated volume while the source still runs, **stop** of the source containers (dependents first; restart policy set to `no` so a Docker restart doesn't bring them back), **final rsync pass** with deletes, **release** (the deployment runs under Loadweaver and gets its ingress routes), **verify** (every replica runs). Migrated deployments start elsewhere first and stop the source afterwards.
5. **Handover** — checks that the source no longer holds its ports; the ingress serves them now.

Progress: `GET /api/imports/{node}` (`selection.steps`) and the wizard. A failed step after a stop **rolls back**: the imported deployment is held again (it frees the ports) and the source containers start again with their previous restart policies (the import ends `rolled-back`; the node stays an active member). Deployments of a failed or rolled-back import stay held (placed, not running) until they are removed with a plan. The stopped source containers stay on the host after a successful import for a manual rollback; remove them when you no longer need them.

`DELETE /api/imports/{node}` discards an open import; a node that is still `pending` leaves the cluster (nothing on it was changed).

## Former nodes

- **Same cluster** (the cluster id in the archived identity matches): replicas that this cluster still assigns to the node — same DRBD minor, the node still a holder of the volume, backing volume present and large enough, its host name in the resource — are **reused**: the volume manager finds the existing LUKS volume and DRBD metadata and only the difference is resynced. Replicas nothing assigns any more are removed when the node is activated. The node must rejoin under its former name to reuse them.
- **Different (or unknown) cluster**: nothing is reused. The plan must explicitly confirm discarding the old identity and keys (`wipeFormerIdentity`); the archived identity is deleted by the `wipe-identity` step, and the old Loadweaver volumes, interfaces and tables are removed or replaced on activation. Plain Docker workloads on the host go through the wizard like on any host; workloads of the old cluster with Loadweaver volumes can't be imported (back them up and restore them).

## Limits

- Volumes with Docker drivers other than `local` become replicated volumes; the data is copied from their mount point.
- A bind mount of a single file can't become a volume: keep it as a host path or move it into a config / secret.
- Images built on the host exist only there: imports work, migrations need the image in a registry.
- Stateful items can't be migrated directly; import them, then move them with a normal plan (the replicated volume syncs to the target).
- Imported HTTP ports are served by the cluster's ingress addresses: a host that should keep answering on its own IP needs an IP pool containing that address for the ingress (not set up automatically).
- The component step installs missing packages (e.g. `rsync`) from the host's own apt sources: a host without working apt sources (or internet / mirror access) fails the step until they are fixed.
- A pending node's agent (joined with `--discover`, waiting for its join plan) still sends heartbeats and node metrics; it changes nothing on the host (read-only).
