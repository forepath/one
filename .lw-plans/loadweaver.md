# Loadweaver

Working document for the Loadweaver product idea. Living notes: what is decided, what is a candidate, what is open.
Architecture sketch: [loadweaver.mmd](./loadweaver.mmd).

Status legend: **decided** (agreed), **candidate** (proposed, not yet agreed), **open** (needs discussion).

---

## 1. What already exists publicly

Loadweaver is announced as "Coming soon" on the ForePath landing page. That copy is the current public promise, so the product must keep it.

- Nav entry: [container.component.html](../libs/domains/forepath/frontend/feature-landingpage/src/lib/container/container.component.html) (product dropdown + footer), domain `loadweaver.com` (link disabled)
  - Tagline: _"Resilient clusters from a handful of servers"_
  - Points: _"Encrypted network between your sites"_, _"Shared storage on every node"_, _"Ingress that fails over on its own"_
- About page milestone: [about.component.ts](../libs/domains/forepath/frontend/feature-landingpage/src/lib/about/about.component.ts)
  - _"Our next product turns a handful of servers into a resilient multi-site cluster. It gives applications built with AI, and the agents behind them, a protected home on infrastructure you control, with encrypted traffic between sites and services that keep running when a location goes down."_
- Icon: `assets/images/products/loadweaver.svg`

Takeaways for positioning:

- Entry story is **"a handful of servers"**, possibly spread across **multiple sites/locations**: small fleets that need HA without the Kubernetes overhead. That is where Loadweaver **starts**, not where it ends: clusters **grow to ~1,000 nodes** and fleets of clusters (3.34).
- Audience is **AI-built applications and the agents behind them**, which ties it to Agenstra.
- **Self-hosted / infrastructure you control** is a core promise.

---

## 2. Core principles

| #   | Principle                                                                                                                                                                                                                                                                           | Status  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| P1  | **Docker is the base.** Workloads are containers on the Docker Engine of every node.                                                                                                                                                                                                | decided |
| P2  | **Start small, grow without limits**: a single node is a full setup, a handful of nodes is the sweet spot of the story, and a cluster grows to ~1,000 nodes across many sites; beyond that, fleets of clusters (3.34). No k8s-level complexity at any size.                         | decided |
| P3  | Everything is declarative and goes through **plan → apply** with locking (Terraform-like).                                                                                                                                                                                          | decided |
| P4  | Policies (traffic, placement, ...) apply cluster wide by default and are narrowed by **selectors**.                                                                                                                                                                                 | decided |
| P5  | Agenstra hosts must be able to integrate into a Loadweaver cluster later on.                                                                                                                                                                                                        | decided |
| P6  | **Everything is a policy.** Routing, tunneling, filtering, exposure: any connectivity exists only because a policy allows it, expressed between **groups** (AWS security group style).                                                                                              | decided |
| P7  | **Deployments are Docker Compose projects** (with Loadweaver extensions), and every one of them is seamlessly migratable between nodes.                                                                                                                                             | decided |
| P8  | **No single host failure takes an app down**, unless a policy explicitly pins its data, deployment or traffic to that host. Pinning is allowed, but the plan warns about it up front.                                                                                               | decided |
| P9  | **Everything is observable.** Every log the platform produces (containers, proxy, routing, tunnels, ingress, storage, control plane) can be viewed in the UI and queried through the backend API, scoped to a deployment, service, node, group or policy.                           | decided |
| P10 | **Reuse before building, and verify until clean.** Existing patterns, shared libs and generators are reused or extended; every change passes the full quality gate (tests, regressions, self-rated security review) in a loop until nothing medium-to-critical is left (section 6). | decided |

---

## 3. Capabilities

### 3.1 Runtime management

- **decided** Loadweaver manages the container runtimes on each node, not just Docker itself.
- **decided** Support gVisor as an isolation layer next to `runc`. That way Agenstra hosts (which already support gVisor) can join a Loadweaver cluster without losing their isolation level.
- Reference in Agenstra: the gVisor runtime is registered as an additional Docker runtime (`runsc-systrap`, `--platform=systrap`), default stays `runc`, and a capability probe decides what is ready per host. See [system-requirements.md](../docs/agenstra/deployment/system-requirements.md) and [container-isolation.md](../docs/agenstra/features/container-isolation.md).
- **decided** Reuse that model: Loadweaver installs/registers runtimes per node, probes them, reports node capabilities, and the scheduler only places a workload that needs `sandboxed` on nodes that passed the probe.

### 3.2 Cluster & nodes

- **decided** Multi-node cluster; nodes can sit at different sites.
- **decided** **A single node is a fully functional setup.** HA is of course not available then, but small setups must work and grow over time.
- **decided** **Nodes can join and leave over and over again.** Growing from 1 to n and shrinking back is a normal operation, not a migration project.
- **decided** No data loss when a node leaves. The only exception is missing capacity on the remaining nodes. Then the user is warned and **chooses which workloads to keep** and which to drop.
- **decided** Capacity is calculated continuously. When the potential load approaches the cluster limits, further selections that would exceed them are **locked** (e.g. you can't deploy, scale up or pick more workloads to keep than fit).
- **decided** Control plane on **3 or 5 designated nodes** (a node group like everything else). All other nodes are workers, **without a limit on their number** (target scale ~1,000 nodes per cluster, 3.34). Control-plane nodes may run workloads too.
- **decided** Below 3 nodes the control plane runs on whatever is there (1 or 2 nodes), without HA. As nodes join, it grows to 3 (and optionally 5) members automatically; when they leave, it shrinks.
- **decided** Cluster state lives in **Postgres, Patroni-style**: streaming replication across the control-plane nodes, automatic leader failover, coordinated by a small consensus store (etcd), which also serves leader election for Loadweaver's own controllers.
- **decided** 2-node setups: an **optional lightweight witness** (tie-breaker / etcd member only, no workloads, e.g. a 1 vCPU VPS or a Raspberry Pi) provides the third vote and enables automatic failover. Without a witness, data is still replicated to both nodes, but failover requires a manual confirm, and the plan warns about it.

### 3.3 Groups & the policy model

The foundation everything else in this document builds on (P6).

**Groups**

- **decided** Nodes can be joined into **groups**. Nodes in the same group share networking.
- **decided** **Group-to-group communication** is granted explicitly, like AWS security groups: a rule references other groups as source/destination, not IP addresses.
- **decided** Two kinds of groups, using the same rule model:
  - **Node groups**: infrastructure level. Decide which nodes share a network, which nodes get tunnels to each other, and which routes are exchanged.
  - **Workload groups**: service level. Containers/services join groups by selector (labels), independent of the node they run on. This is what keeps rules valid when a workload migrates (3.10): the rule follows the group membership, not the IP or the node.
- **decided** A node or workload can be in several groups; the effective permissions are the union of all its groups' allow rules (SG semantics).
- **decided** Membership by **selector**, not only by static lists, e.g. `site = fra1`, `role = ingress`, `runtime = sandboxed`. Static membership is just a selector on the name.

**Default behavior**

- **decided** Default deny between groups. Within a group: allowed by default (that is "shared networking"), but can be tightened by a policy on the group itself.
- **decided** Rules are **stateful** (return traffic of an allowed connection is allowed automatically), like SGs.
- **decided** **Allow-only** rules between groups (pure SG semantics). Deny ("deny wins") exists only inside the proxy / L7 layer (3.7), where Agenstra already uses it to punch holes into broad allows.

**One policy model across all layers**

- **decided** A policy always has the same shape: _from_ (group/selector) → _to_ (group/selector, or external CIDR/hostname) → _what_ (protocol, ports, hosts, ...) → _action_, plus a `mode` (`monitor` / `enforce`, borrowed from Agenstra).
- **decided** The control plane **compiles** each allow rule into every enforcement layer it affects, so the operator never configures them individually:

  | Layer      | What a group-to-group allow produces                                                            |
  | ---------- | ----------------------------------------------------------------------------------------------- |
  | Tunneling  | WireGuard peers only exist between nodes that need to talk; `AllowedIPs` limited accordingly    |
  | Routing    | BIRD import/export filters only exchange the prefixes of groups that are allowed to talk        |
  | Filtering  | nftables rules on each node (L3/L4, stateful)                                                   |
  | Proxy (L7) | Hostname / URL / SNI rules in the traffic proxy (3.7)                                           |
  | Exposure   | Ingress and port forwarding: "Internet" is a group; exposing a service = an allow from it (3.6) |

  Consequence: the mesh topology question (full mesh vs. hub) mostly disappears. The tunnels are whatever the policies need. A missing policy means no tunnel and no route, not only a dropped packet (defense in depth).

- **decided** Built-in pseudo groups: `internet`, `cluster` (all nodes), `control-plane`, plus per-site groups. Control-plane traffic (node agents ↔ API, storage replication, BIRD sessions) is also expressed as built-in policies, so it shows up on the topology map and can't be broken by accident.
- **decided** Policies go through plan → apply (3.8) like everything else. The plan shows the compiled effect per layer ("adds WireGuard peer n1↔n3, exports 10.20.3.0/24 to fra1").
- **decided** Rules are **standalone policies** (own resource: from group(s) → to group(s) → what), not attached to a group. One policy = one edge on the map; policies can be planned, locked and owned separately.
- **decided** **Never transitive.** If A↔B and B↔C are allowed, B does not forward between A and C. Routing exports and forwarding rules are generated per policy, so the compiled result equals the policies, nothing more.

### 3.4 Networking

- **decided** Networking on every node; nodes are connected **across sites with WireGuard** (encrypted overlay). This is the landing page's "Encrypted network between your sites".
- **decided** Which nodes are connected, and what is routed between them, is driven by group policies (3.3).
- **decided** Use **BIRD** for routing: announce container/service subnets between nodes (BGP over the WireGuard links; direct peering in small clusters, **route reflectors** in larger ones, 3.34), and optionally peer with upstream routers / provider BGP for announcing public IPs. Export filters are generated from policies.
- **decided** Addressing: **one subnet per node** for its containers, announced via BIRD. Every service additionally gets a **stable service IP** (and DNS name) that follows it on migration. Group rules compile to the current member IPs (nftables sets), so prefixes don't have to match groups.
- **decided** Service discovery: **policy-aware cluster DNS**. A node-local resolver answers `<service>.<project>.lw`-style names with the stable service IP, and only for services the caller's groups may reach. Compose service names keep working inside a project.

### 3.5 Shared storage

- **decided** Shared storage that is available on multiple nodes so stateful workloads are highly available. This is the landing page's "Shared storage on every node".
- **decided** Technology: **own replicated volumes, DRBD-like** (block-level replication per volume, e.g. DRBD 9, possibly managed via Linstor), exposed to Docker as a **volume plugin**. Works from a single node, scales per volume, and migration means promoting the replica on the target.
- **decided** Consistency: **synchronous within a site, asynchronous across sites** by default. Node loss = no data loss; site loss = small bounded loss, shown as RPO in the plan. Configurable per volume by policy (e.g. sync cross-site on low-latency links).
- **decided** Replica count and placement are policies (e.g. "2 sync replicas in `fra1`, 1 async in `ams1`").
- Ceph was considered (ForePath offers it) but needs too many nodes and resources for 1-3 node setups and high-latency site links. Distributed filesystems were dropped because databases on network filesystems are a known pain point.

### 3.6 Ingress & IP failover

- **decided** Ingress fails over on its own. That requires **IP failover**: a public/ingress IP moves to a healthy node when its current holder goes down.
- **decided** Ingress handles more than web (HTTP/HTTPS) traffic. It also needs **L4 port forwarding** (TCP/UDP), which makes IP failover even more important because L4 clients can't be redirected the way HTTP clients can.
- **decided** Failover mechanisms, depending on the environment:
  - Same L2 segment: VRRP-style floating IP (keepalived-like).
  - Routed / multi-site: announce the IP via BGP from BIRD from the healthy node(s) (anycast or primary/backup via route preference).
  - Where no IP can float at all: **DNS failover** (3.28).
  - Hosting providers without BGP: drive the provider's floating/failover IP API (could reuse the provider plugins used for server provisioning in Agenstra/Decabill).
- **decided** Which nodes may hold a failover IP is a node group (e.g. `role = ingress`).
- **decided** **Rate limiting** per IP, per route and per API-key header, enforced cluster-wide through Envoy's rate-limit service (limits hold across all ingress nodes), plus **connection limits** for L4 port forwards.
- **decided** **Optional WAF** per hostname: Coraza with the OWASP Core Rule Set as an Envoy filter (proxy-wasm), with `monitor` / `enforce` modes like all policies. Blocks show up as traffic decisions (3.18). Volumetric DDoS protection stays with the provider / Cloudflare.
- **decided** Certificates: **built-in ACME** (HTTP-01 through the ingress, DNS-01 via provider plugins for wildcards). Certs are stored encrypted in the control plane (Postgres) and distributed to every ingress-capable node, so a failover never waits on issuance. Custom certificates can be uploaded.

### 3.7 Traffic policy (proxy)

- **decided** A proxy setup like Agenstra's by default, so traffic can be filtered cluster wide.
- **decided** As with everything, **selectors** on services etc. control which rules apply to which workloads.
- Reference in Agenstra: per-agent egress guard sidecar (iptables + Squid 7 + dnsmasq), modes `off` / `monitor` / `enforce` / `offline`, allow/deny host lists, `network_allow` L3/L4 exceptions, SNI-based TLS decisions without decryption, layered heredity `global → workspace → environment` with locks. See [egress-filtering.md](../docs/agenstra/features/egress-filtering.md).
- **decided** Bring that model over 1:1 where possible: same modes, same policy fields, and replace the fixed layer chain with **cluster default + selector-scoped policies** (e.g. by labels on services/namespaces). The `monitor` mode is especially valuable for rolling out policies safely.
- **decided** The proxy is the L7 layer of the general policy model (3.3), not a separate system: the `to` side of a policy can be a hostname instead of a group.
- **decided** Scope: egress **and east-west L7 from the start**. Service-to-service traffic can be filtered by HTTP host / path / method in addition to the L3/L4 group rules. Ingress is filtered at the ingress (3.6).
- **decided** Enforcement: **node-level proxy**, one per node for all workloads on it; source IP → workload identifies the caller. Agenstra's per-agent sidecar stays possible for sandboxed / untrusted workloads.
- **decided** East-west encryption: **transparent mTLS between the node proxies**. Services talk plain HTTP to their local node proxy; proxies talk mTLS to each other using platform-issued **workload identities** (cluster CA). L7 rules see the full request, apps need no TLS setup, and the caller identity is cryptographic instead of source-IP based. Runs on top of WireGuard between nodes.
- **decided** Proxy engine: **Envoy for all L7** (ingress, east-west incl. mTLS, egress), configured dynamically by the control plane via xDS. From Agenstra we reuse the **policy semantics** (modes, allow/deny lists, `network_allow`, Evaluate call), not the Squid engine. Agenstra's own guard stays as it is.
- **decided** L7 conflicts: **deny wins**, like Agenstra. No priorities to manage.

### 3.8 Declarative changes: plan, apply, lock

- **decided** Terraform-like workflow: every change produces a **plan** (diff of desired vs. actual state) that is reviewed and then **applied**.
- **decided** **Locking** so concurrent changes can't collide.
- **decided** Format: **YAML**, the same language as Docker Compose (P7). JSON Schema for editor validation; the UI generates the same YAML.
- **decided** Source of truth: **the API / control plane**. UI, CLI and API all create plans against it. A **Git repo can optionally be connected**: pushes create plans, applies can be gated by review. UI-only users never need Git. Full concept, in the MVP: **3.29**.
- **decided** Locks are **per resource scope**: a plan locks only what its diff touches (deployments, groups, policies, nodes). Unrelated plans run in parallel; overlapping ones wait or are rejected. Cluster-wide changes (e.g. node join / leave) take a cluster lock.
- **decided** Failed or cancelled applies roll back automatically; if the rollback fails, the real state is shown and a fix-forward plan is proposed (3.19).
- **decided** Drift: things the platform owns (crashed containers, lost replicas, missing routes / rules) are **healed automatically**. Changes made outside Loadweaver (e.g. `docker run` on a node) are **reported as drift** and turned into a proposed plan, never silently overwritten.

### 3.9 Topology map (frontend)

- **decided** The frontend shows a **map of all active components** in the cluster (sites, nodes, workloads, ingress, storage, links) and the **traffic flow** between them.
- **decided** Traffic flow is shown **live**, not only as aggregated history.
- **decided** Three views on the same map:
  - **Live**: flows streamed to the browser over WebSocket (same pattern as the Agenstra gateways), animated edges with current rate / connections / blocked count.
  - **Timeline**: scrub back in time from the time-series store (TimescaleDB, 3.13), e.g. replay what happened during a failover or migration.
  - **Plan**: overlay of a pending plan (see below).
- **decided** Every element on the map links to its logs (3.14): click a node, service, tunnel or policy edge to open the matching log view; click a blocked flow to see the proxy / firewall decision and the policy that caused it.
- **decided** Flow aggregation levels: node ↔ node (tunnel), group ↔ group (policy edge), service ↔ service, service ↔ external host. Zoom in = finer level.
- **decided** Data sources: WireGuard peer stats, proxy/audit logs, conntrack/flow data per node, ingress metrics. Agenstra already has OpenTelemetry support that could feed this.
- **decided** Overlay pending plans on the map (what would change) and highlight blocked traffic from policies.
- **decided** Groups are a natural map layer: groups as boxes, allowed group-to-group policies as edges, actual traffic drawn on top. Traffic without a matching edge = blocked (or `monitor` would-be block).

**Layers: everything network-related, switchable**

- **decided** The canvas shows all network details as **layers that can be toggled and combined**:

  | Layer              | Shows                                                                                                                |
  | ------------------ | -------------------------------------------------------------------------------------------------------------------- |
  | DNS                | hostnames on ingress / services, records, providers and bind9 instances, sync state, DNS failover state (3.15, 3.28) |
  | Addressing         | IPv4 / IPv6, service IPs, failover IPs and their **current holder**, SNAT IPs, IPAM pools (3.27)                     |
  | Routing            | BGP sessions, announced / received prefixes, internal routes, edge paths, RPKI state (3.4, 3.27)                     |
  | Tunnels            | WireGuard peers, last handshake, latency, throughput                                                                 |
  | Certificates       | per hostname / identity, expiry                                                                                      |
  | Storage            | volume replicas, sync / async, replication lag (3.5)                                                                 |
  | Policies & traffic | groups, policy edges, live / historical flows, blocks (as above)                                                     |

- **decided** **Presets per role**: "network", "app", "storage", "security", saved per user like other views (3.18).

**Readability**

- **decided** **Semantic zoom**: far out shows sites, health and aggregate traffic; zooming in reveals nodes and services, then labels like hostnames, IPs and prefixes.
- **decided** **Hover** shows a compact tooltip; **click** opens a **side panel** with full details (records, routes, sessions, certificates, logs, graphs) and actions (drain, open terminal, create plan).
- **decided** Search (3.25) can **focus and highlight** any element, e.g. "where does `app.example.com` go".

**External side**

- **decided** External systems are drawn **at the border of the canvas**: upstreams / IXPs (ASN, session state), DNS providers (Cloudflare, bind9, sync state), client entry points and top external egress destinations. That makes a **full path** visible: client → DNS answer → failover IP / anycast prefix → ingress node → service → replica → volume.

**Path trace**

- **decided** A **trace tool**: pick a hostname / IP / port, or a source and a destination workload, and the canvas highlights the path as Loadweaver would route it **right now**: DNS answer, failover IP holder or BGP route, ingress, every policy evaluated (allow / deny with the policy name), tunnel, target replica.
- **decided** Works in all three views: **live**, **plan** (how a pending plan changes the path) and **timeline** (how a request was routed during a past incident).

### 3.10 Workload migration

- **decided** Workloads can be migrated between nodes, ideally **without downtime and without data loss**.
- **decided** The unit users deploy, and therefore migrate, is a **Docker Compose project** (3.11). Migration must be seamless for compose deployments, not just for single containers.
- **decided** Tiers of migration, from simplest to hardest:
  1. Stateless: start new instance on the target, switch traffic, stop old (blue/green).
  2. Stateful with shared/replicated storage: stop briefly, re-attach volume on target, start (short downtime).
  3. Live migration: checkpoint/restore of the running container (CRIU via Docker checkpoint) + memory/state transfer, with traffic and IP following. Note: gVisor has its own checkpoint/restore, so this would differ per runtime.
- **decided** Before a migration, the plan checks that the target node's groups allow everything the workload needs (otherwise the workload would land on a node that can't reach its dependencies).
- **decided** Compose-level migration moves service by service in dependency order (`depends_on`, healthchecks gate the cutover), so the project as a whole stays up even if an individual service only supports tier 2.
- **decided** The same mechanism is used for **evacuation** (planned maintenance: drain a node) and **failover** (unplanned: node is gone, 3.12). Failover is migration without the source being available, so it only works for data that was already replicated.
- **decided** MVP target: **live migration where eligible, zero downtime where replicas allow, short stop otherwise.**
  - **Live migration (in the MVP)**: CRIU checkpoint / restore for `runc` containers, gVisor's own checkpoint / restore for sandboxed ones; memory is pre-copied iteratively over WireGuard, then a short final freeze; the stable service IP and established connections follow the workload.
  - The plan checks **eligibility per service** (runtime, devices such as GPUs, kernel features, checkpoint size vs. link speed) and shows the chosen method: live, blue / green (stateless or ≥2 replicas), or short stop (final DRBD sync, stop, promote the replica on the target, start, while service IP and ingress hold connections; seconds of downtime, no data loss).
  - A **failed live attempt falls back automatically** to the short-stop method, without data loss.
  - Live migration is **opt-out per service** for workloads that misbehave after a restore.

### 3.11 Deployments (Docker Compose)

- **decided** Deployments are mainly **Docker Compose** projects. Users bring the compose files they already have.
- **decided** Every compose deployment is seamlessly migratable (3.10).
- **decided** Loadweaver-specific settings go into compose extension fields (`x-loadweaver`), so a file stays valid for plain `docker compose` too. Examples: groups the services join, replicas, placement selectors, required runtime (`sandboxed`), volume replication, exposure (ingress hostnames, port forwards).
- **decided** Mapping of compose concepts:

  | Compose                     | Loadweaver                                                                                         |
  | --------------------------- | -------------------------------------------------------------------------------------------------- |
  | project                     | deployment (unit of plan / apply / migration)                                                      |
  | service                     | workload; scheduled onto nodes; can have replicas on different nodes                               |
  | `volumes`                   | shared storage volumes (3.5), replicated by default                                                |
  | `networks`                  | workload groups (3.3); a compose network = members can talk to each other                          |
  | `ports`                     | not bound on a host directly; turned into ingress / port-forward exposure (3.6) on the failover IP |
  | `depends_on`, `healthcheck` | ordering and readiness for start, migration and failover                                           |
  | `secrets`, `configs`        | stored in the control plane, distributed to whichever node runs the service                        |

- **decided** **Every service has CPU / memory requests and limits.** Requests drive scheduling, capacity and the N+1 reserve. If compose doesn't set them (`deploy.resources`), the **project defaults** apply (set by project admins, bounded by the quota, 3.17). The plan lists which services run on defaults.
- **decided** Things compose allows that break migration / HA (`network_mode: host`, bind mounts to host paths, `devices`, fixed `container_name` collisions) are not forbidden, but count as **pinning** (3.12) and the plan warns about them.
- **decided** The node agent **translates compose into Docker API calls** (compose-spec parser) and creates containers, networks and volumes itself. That's needed anyway, because services of one project are spread across nodes and ports, volumes and networks are rewritten. Compatibility is ensured by tests against the compose spec.

### 3.12 Resilience & pinning

- **decided** Losing one host must not take any app down (P8). Data, deployment and traffic all have to survive the loss of a single node.
- **decided** Users may deliberately **pin** something to a host. Three kinds of pins:

  | Pin            | Examples                                                                                         |
  | -------------- | ------------------------------------------------------------------------------------------------ |
  | **Data**       | volume without replicas, or replicas only on one node; host bind mounts                          |
  | **Deployment** | placement selector that matches only one node; `replicas: 1` without failover; device access     |
  | **Traffic**    | ingress / failover IP only allowed on one node; a policy whose only allowed path is via one node |

- **decided** When the configuration asks for a pin, the user is **warned up front**, i.e. in the plan, before apply.
- **decided** The plan runs a **failure analysis**: for every deployment, simulate the loss of each single node (and each site) and check whether data, deployment and traffic survive. Every single point of failure is listed with its cause ("volume `db-data` has no replica outside `n2`").
- **decided** Pins are acknowledged **in the config with a reason** (`x-loadweaver: { pinned: { reason: "..." } }` on the service / volume). Unacknowledged pins show as plan warnings and need an explicit confirm at apply. Acknowledged pins stay visible on the map and in the failure analysis.
- **decided** Capacity is part of it: the plan also warns if the remaining nodes would not have enough CPU / memory / storage to take over after a node loss (N+1).
- **decided** At runtime the same analysis runs continuously: if a replica is lost or a node degrades, the cluster is "at risk" until redundancy is restored, and that shows on the map and in notifications.
- **decided** Failure domain: **node by default**, **site opt-in** by policy (per deployment or cluster), available from 3 sites (quorum) and validated by the plan's failure analysis. The landing page promise "services that keep running when a location goes down" is covered by the opt-in.
- **decided** The platform itself follows P8 once there are enough nodes: control plane, Postgres / TimescaleDB and OpenSearch (3.13, 3.14) survive a node loss from 3 nodes on.
- **decided** On a node **leaving** (planned) the cluster drains it first: migrate everything, re-replicate data, then remove. If the remaining capacity is not enough, the user gets the list of affected workloads and picks what to keep (3.2). Nothing is dropped without that choice.

### 3.13 Platform data stores

- **decided** **Postgres** for the platform's relational data, like in the other products: desired state, groups and policies, plans and their history, locks, inventory, audit log.
- **decided** **TimescaleDB** on the same Postgres cluster for time-based data (replaces the earlier InfluxDB idea). Loadweaver will process a lot of it: traffic flows, live and historical topology data, node and workload metrics, health checks, failover / migration events. Reason: it rides on the Postgres HA we need anyway, so there is one store to operate, back up and fail over. Hypertables + continuous aggregates cover downsampling.
- Note: some Timescale features are under the Timescale License (free to use, not to offer the database itself as a service). Fine for Loadweaver, to double-check with the final licensing model.
- **decided** Plan/apply locks via Postgres (row locks or advisory locks), since Postgres is the consistent store anyway.
- **decided** Retention and downsampling: see 3.18.
- **decided** HA: covered by the Postgres HA in 3.2.

### 3.14 Logs

- **decided** In the UI and through the backend API I can see the logs of a deployment and of everything around it. Not only container logs: proxy, routing, tunnel, ingress, everything.
- **decided** Log sources, all collected by the node agent:

  | Source        | Content                                                                                                         |
  | ------------- | --------------------------------------------------------------------------------------------------------------- |
  | Containers    | stdout / stderr of every service (Docker log driver)                                                            |
  | Proxy         | allow / deny decisions, `monitor` would-be blocks (Agenstra egress guard already records these as audit events) |
  | Firewall      | nftables drops / accepts with the policy that matched                                                           |
  | Routing       | BIRD session state changes, route imports / exports / withdrawals                                               |
  | Tunnels       | WireGuard handshakes, peer up / down                                                                            |
  | Ingress       | access logs (L7), connection logs (L4), certificate issuance / renewal                                          |
  | Failover IP   | who holds which IP, takeovers and their reason                                                                  |
  | Storage       | replication state, resyncs, degraded volumes                                                                    |
  | Runtime       | container lifecycle, OOM kills, restarts, gVisor runtime errors                                                 |
  | Control plane | plan / apply runs, scheduler decisions, migrations, failovers, audit log                                        |

- **decided** **Correlation by labels, not by source.** Every log line is enriched at the node with the same identifiers the policy model uses: cluster, site, node, deployment (compose project), service, replica, groups, and, where relevant, the policy id and plan / apply id. That makes "everything about deployment X" one query across all sources, e.g. its containers plus the proxy decisions for its egress plus the ingress access logs for its hostnames plus the routing events on the nodes it runs on.
- **decided** Views in the UI:
  - per deployment / service: merged timeline of all related sources, filterable by source and level;
  - per node, per group, per policy (e.g. "everything this policy blocked in the last hour");
  - **live tail** over WebSocket, same channel as the live flow (3.9);
  - jump from a log line to the map at that point in time (timeline view), and from an event (failover, migration, apply) to all logs around it.
- **decided** Backend API: query (time range, label selectors, full-text), live tail (WebSocket / SSE), export. Same filters as the UI, so a CLI can use it too.
- **decided** Logs must survive the node they came from (P8): ship them off the node immediately, so the logs of a node that just died are still readable, and that is exactly when they are needed.
- **decided** Access control per project (3.17), and redaction of secrets known to the control plane (compose `secrets`, env values marked secret) before storage.
- **decided** Retention per source, configurable as a policy: see 3.18.
- **decided** Log store: **OpenSearch**. Best full-text search and mature replication; HA through its own replica shards across nodes.
- **decided** Placement: **on the control-plane nodes, sized by cluster.** 1 OpenSearch node on single-node setups (small heap, e.g. 512 MB-1 GB), 3 on HA clusters. Can be moved to a dedicated node group by policy. Below 3 nodes logs have as many replicas as there are nodes, matching data availability.

### 3.15 DNS management

- **decided** Loadweaver manages DNS through **providers behind one unified interface**, the same pattern as server provisioning.
- **decided** **Cloudflare** is supported.
- **decided** The cluster can host its **own bind9** as a DNS provider: one instance on a single node, a bind9 cluster as soon as there is more than one node.
- **decided** The interface lives in the **shared provider lib** (section 4) next to the server providers. Decabill's existing Cloudflare integration (`cloudflare-dns.service.ts` in `feature-billing-manager`, A records for provisioned servers) moves into it, so Decabill, Agenstra and Loadweaver share one implementation.
- **decided** Interface shape: zones (list / create), records (list / upsert / delete for A, AAAA, CNAME, TXT, MX, SRV, CAA, NS), plus **capability flags** per provider (e.g. minimum TTL, wildcard support, proxied records, DNSSEC). More providers (Hetzner DNS, DigitalOcean, Route 53, ...) come as dynamic provider plugins, like the server providers.
- **decided** Records are **desired state** like everything else:
  - ingress hostnames in compose (`x-loadweaver`) create their records automatically, pointing at the failover IP (3.6);
  - additional records can be declared in YAML;
  - the plan shows the DNS diff ("creates `A app.example.com → 203.0.113.10` at Cloudflare").
- **decided** **Ownership tracking**: Loadweaver marks the records it manages (e.g. a TXT ownership record, like external-dns does) and never changes or deletes records it doesn't own. Existing zones can be adopted without risk.
- **decided** ACME DNS-01 (wildcard certificates, 3.6) uses the same interface, so every DNS provider is automatically an ACME challenge provider.
- **decided** DNS and failover: with VRRP / BGP / provider failover the IP stays the same, so DNS doesn't change during a failover. Where an IP cannot float (or across sites / providers), **DNS failover** takes over; full concept in **3.28**.
- **decided** Hosted **bind9**:
  - Placement: bind9 runs on a node group (e.g. `role = dns`, defaulting to the control-plane nodes), so it follows the usual placement and P8 rules.
  - No primary as a single point of failure: the control plane renders the zones and pushes them to **every** bind9 instance directly (each instance is authoritative, serials are managed centrally), instead of a primary / secondary chain over AXFR.
  - Exposure is a policy like everything else: `internet → dns` on UDP / TCP 53.
  - Public delegation needs at least two NS records on different IPs, ideally on different sites. The plan warns if a zone's NS set sits on a single node or site (pinning, 3.12). **Anycast name servers (in the MVP)**: the `dns` node group announces the name-server IPs from several sites through the anycast policies of 3.27.
  - Query logs and zone updates go into the log store (3.14).
- **decided** Internal service discovery (3.4) stays separate: the node-local resolver answers cluster names, bind9 serves real (public or private) zones.
- **decided** **DNSSEC** for bind9-hosted zones, **opt-in per zone, in the MVP**:
  - bind9 automatic signing (`dnssec-policy`), keys held as Loadweaver secrets (3.22) and pushed to all bind9 instances;
  - **automatic key rollovers**; the parent's DS record is published via a **registrar plugin** (provider-lib pattern) or added by hand, and every rollover waits until the DS is verified at the parent;
  - with secondaries (e.g. Cloudflare), the **already-signed zone** is transferred;
  - opt-in because a broken rollover takes the whole zone offline; the plan shows DS state and rollover steps.
- **decided** **Multi-provider zones in the MVP**: a zone has **one primary provider** (source of the records) and optional **secondaries** that receive the same records, via the provider API (e.g. Cloudflare) or via AXFR / IXFR with TSIG (e.g. bind9 as secondary of an external primary, or the other way round). Typical case: hosted bind9 as primary and Cloudflare as secondary, so a small cluster's DNS doesn't depend on its own few nodes. The plan shows the records per provider and warns when a secondary has drifted from the primary.

### 3.16 Console UI & branding

- **decided** The Loadweaver console builds on the **concepts of the existing consoles** (Agenstra agent console, Decabill billing console) instead of inventing its own.
- **decided** It uses the **Loadweaver yellow gold** and the **Loadweaver logo**.
- Logo: `apps/forepath/frontend-landingpage/public/assets/images/products/loadweaver.svg`, two nested open rings on the ForePath ring canvas that read as woven together, filled **`#FFC21A`** (`rgb(255, 194, 26)`).
- **decided** Reuse, concretely:
  - Shared component library `libs/domains/shared/frontend/ui-components` (`fpc-*`: sidebar, top bar, page header, panels, summary cards, status badges, tabs, modals, confirm dialog, toasts, charts via `chart-theme`, theme and language switcher).
  - Brand system: a new `styles/brands/loadweaver/_palette.scss` + `_extras.scss` next to `agenstra`, `decabill` and `forepath`, imported in the same stack as the other consoles (functions → palette → chrome → badge-tint → Bootstrap → FPC styles → extras), plus a Storybook brand.
  - Light / dark theme, i18n (en / de), platform authentication, notifications and updates features, Monaco editor (here for the YAML definitions and compose files, with JSON Schema validation).
- **decided** Palette notes, because a yellow primary behaves differently from Agenstra's violet or Decabill's green:
  - `#FFC21A` on white has a contrast of only **1.6:1**. It works for fills, accents, the logo and the map, with **dark text** on top (11.8:1 against `#0f0f11`). Bootstrap's `color-contrast` picks dark button text automatically.
  - Text-like uses (links, `primary-text-emphasis`) need a **darkened gold**, e.g. `#805b00` (6.2:1 on white). In dark mode the plain `#FFC21A` works as text (11.8:1).
  - **decided** `$warning` moves from the shared amber (`#d97706`) **towards orange** (around `#ea580c`) in the Loadweaver palette only, so warnings stay clearly distinct from the gold primary and from danger red. Loadweaver shows a lot of warnings (pins, at-risk clusters, capacity).
- **decided** Loadweaver-specific screens on top of the console patterns: topology map (live / timeline / plan, 3.9), plan review with failure analysis and DNS / policy diffs (3.8, 3.12), log explorer (3.14), groups & policies, nodes & sites, deployments, DNS zones (3.15).
- **decided** **Native desktop app** (code-signed, with its own VPN tunnel and posture reporting, 3.31) with the same Electron wrapper as Agenstra's `native-agent-console` (electron-forge makers for deb, rpm, zip and Windows), including the fleet view, OS notifications for alerts, and terminals / tunnels one click away.
- **decided** Topology map rendered with **Cytoscape.js**, wrapped in an Angular component: compound nodes for sites ⊃ nodes ⊃ workloads and groups as boxes, automatic layouts, stylesheet-based styling mapped to the brand tokens, live updates for hundreds of elements.

### 3.17 Users, projects & access

Reference in Agenstra: auth methods `api-key` / `users` / `keycloak` (shared platform authentication), global roles `admin` / `user`, per-workspace access (creator + `client_users` with `admin` / `user`), scoped personal access tokens with immediate revoke and role demotion. See [authentication.md](../docs/agenstra/features/authentication.md) and [client-management.md](../docs/agenstra/features/client-management.md#per-client-permissions).

**Authentication**

- **decided** **Same as Agenstra**: `api-key`, `users` and `keycloak` (via the shared platform authentication), global `admin` / `user`, scoped personal access tokens (PATs) where revocation, expiry, scope changes and role demotion take effect immediately. Code is shared wherever possible, so all ForePath products behave the same.

**Projects (the "workspace" of Loadweaver)**

- **decided** Access is granted per **project inside a cluster**. A project owns its deployments, their workload groups, policies, volumes and DNS records.
- **decided** Cluster-level resources sit above projects: nodes, node groups, sites, providers (server + DNS), DNS zones, cluster-wide policies.

**Roles**

- **decided** Project roles:

  | Role          | Can                                                                |
  | ------------- | ------------------------------------------------------------------ |
  | **Admin**     | everything in the project, including members and approval settings |
  | **Operator**  | create plans and apply them, approve developer plans               |
  | **Developer** | create plans; apply only after an approval                         |
  | **Viewer**    | read everything in the project: map, logs, plans, metrics          |

  Agenstra's workspace `admin` / `user` roughly correspond to admin / operator.

- **decided** Cluster roles, on top of the global `admin` / `user`:

  | Role               | Can                                                                                                                                           |
  | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
  | **Cluster admin**  | everything, including projects, quotas and access                                                                                             |
  | **Infra operator** | nodes, node groups, sites, providers, DNS zones, cluster-wide policies; **no** access to project secrets or logs unless also a project member |
  | **Auditor**        | read-only across everything, including the audit log                                                                                          |

- **decided** Who may grant what follows Agenstra: cluster admins and project creators may assign any project role; project admins may add operators, developers and viewers, but not other admins.
- **decided** PAT scopes cover the same split (e.g. `projects:read`, `plans:create`, `plans:apply`, `logs:read`, `cluster:nodes`), and a token can never exceed the roles of its owner.

**Approvals**

- **decided** Developer plans need **one approval from an operator or admin** of the project before apply. The approver sees the full plan, including failure analysis and DNS / policy diffs.
- **decided** Configurable per project: require approvals for **everyone** (four-eyes), or only for plans that contain pins (3.12) or exposure to the `internet` group.
- **decided** An approval is bound to the exact plan; if the plan is re-generated (because the state changed), it needs a new approval.

**Cross-project policies**

- **decided** A policy between groups of **different projects** needs **both sides to accept**, like VPC peering: project A proposes, an operator / admin of project B accepts (or someone with rights on both applies it). Nobody can open a path into a project they don't control.
- **decided** Projects can mark groups as **exposed** so other projects can find them and request access. The topology map shows pending requests.
- **decided** Cluster-wide policies (by infra operators / cluster admins) apply to all projects, and projects can't loosen them, the same idea as Agenstra's "higher layers bound lower layers".

**Quotas**

- **decided** **Quotas per project**: CPU, memory, storage, public IPs and ports, set by cluster admins. Default: unlimited.
- **decided** Quotas tie into the capacity checks (3.2): the plan rejects a deployment over quota, and when a node leaves without enough capacity, the "which workloads to keep" choice is made per project within its quota.

**Access is not plan / apply**

- **decided** Memberships and roles change **immediately** through the API / UI (like Agenstra), not through plan / apply, so nobody is locked out by a stuck plan and revoking access is instant. Every change is recorded in the **audit log**.
- **decided** Access settings can be exported / imported as YAML for documentation and setup, and optionally managed from Git (3.29).

**Scoping everywhere**

- **decided** All views and APIs are filtered by project access: map, logs (3.14), metrics, plans, DNS records. Users without access to a project see its elements on the map only as anonymous "other project" boxes (or not at all), never names or logs.

### 3.18 Metrics, graphs, audit & alerting

Reference in the monorepo: the consoles chart with **ApexCharts** through the shared `chart-theme` (`ui-components/src/lib/chart-theme`), which follows the brand palette and light / dark mode. Agenstra has an **Audit page** (`/audit`) charting egress decisions and message filter drops / flags, backed by workspace and global statistics endpoints. See [usage-statistics.md](../docs/agenstra/features/usage-statistics.md).

**Data volume**

- **decided** Flows are **aggregated on the node** before shipping: per (source workload, destination workload / host, port, decision) every **10 s**. Volume grows with the number of distinct connections, not with traffic.
- **decided** **Raw per-connection records** only for **denied / observed** flows and **on demand** (e.g. "record this service for 15 minutes" for debugging).
- **decided** Metric resolution: **10 s raw**, rolled up to **1 min** and **1 h** with TimescaleDB continuous aggregates. Graphs pick the resolution from the time range automatically. Live views use the WebSocket stream (1-2 s) instead of the database.

**Graphs & dashboards**

- **decided** **Curated overviews per entity**: cluster, site, node, project, deployment, service, group, policy, volume, ingress, DNS zone, BGP peer / announced prefix, IP pool, certificate. Each shows the graphs that matter for it, built with the shared ApexCharts theme in `fpc-panel`s.
- **decided** **Custom dashboards in the MVP**: a widget board built on the global filter model and the shared ApexCharts theme; a **query builder** over metrics, flows and logs; dashboards are **YAML resources** (so they live in Git and go through the plan bot, 3.29, 3.30), shared per project and scoped by access. Plus a Grafana-compatible data source / export for users who want more.
- **decided** Curated graphs, for example:

  | Entity               | Graphs                                                                                                           |
  | -------------------- | ---------------------------------------------------------------------------------------------------------------- |
  | Cluster / site       | health and "at risk" state over time, capacity used vs. free (N+1 line), failovers / migrations as event markers |
  | Node                 | CPU, memory, disk, network per interface and per WireGuard peer, containers by state                             |
  | Deployment / service | requests, latency (p50 / p95 / p99), error rate, CPU / memory per replica, restarts                              |
  | Group / policy       | allowed vs. denied (vs. observed in `monitor` mode) per edge, top talkers, top denied destinations               |
  | Volume               | IOPS, throughput, replication lag (sync / async), RPO for cross-site replicas                                    |
  | Ingress              | requests / connections per hostname or port forward, status codes, TLS handshakes, failover IP holder over time  |
  | DNS zone             | queries per record / provider, secondary sync state                                                              |

- **decided** **Events as markers on every graph**: applies, migrations, failovers, node join / leave, certificate renewals. Clicking a marker opens the plan or the logs around it.
- **decided** Two pages instead of Agenstra's single Audit page: **Traffic decisions** (what was allowed / denied, like Agenstra's audit charts) and **Audit log** (who did what).

**Filters**

- **decided** **One global filter bar**, the same model in graphs, logs, map and audit:
  - time range (relative / absolute), shared across tabs;
  - label selectors: project, site, node, deployment, service, group, policy, decision, level, ...;
  - full-text search where the source supports it (logs, audit).
- **decided** The filter lives in the **URL**, so views can be shared and bookmarked. Users can **save named views** per project.
- **decided** Clicking a graph point, a map element or a log line **narrows the filter** (drill-down), and filters carry over when switching between map, graphs and logs.
- Results are always limited to the projects the user can access (3.17).

**Audit log**

- **decided** Audit events live in **Postgres**, written **in the same transaction** as the change, so no change can happen without its entry. Covered: plans, applies, approvals, access and role changes, logins, PAT creation / use / revocation, cross-project accepts, quota changes, pin acknowledgements, provider and DNS changes.
- **decided** **Append-only and hash-chained**: each entry stores the hash of the previous one, which makes tampering visible.
- **decided** Mirrored to OpenSearch for search and for the merged log views (3.14). Separate from operational logs.
- **decided** The chain head is anchored periodically (e.g. written to the log store and the SIEM export), so a rewritten chain can be detected even by someone with database access. A **verify** action checks the chain.
- **decided** Visible to auditors (cluster-wide) and project admins (their project).

**Retention**

- **decided** Tiered defaults, configurable per project / source as a policy:

  | Data                           | Default                                                         |
  | ------------------------------ | --------------------------------------------------------------- |
  | Metrics 10 s / 1 min / 1 h     | 7 days / 30 days / 13 months                                    |
  | Aggregated flows               | 30 days, hourly roll-up 13 months                               |
  | Raw flow records, denied flows | 7 days                                                          |
  | Access logs (ingress, proxy)   | 14 days                                                         |
  | Platform logs                  | 30 days                                                         |
  | Audit log                      | never deleted automatically (configurable minimum, e.g. 1 year) |

- **decided** The cluster warns when the data stores run short of storage, before data has to be dropped.
- 13 months for hourly data allows year-over-year comparison.

**Alerting**

- **decided** **Built-in alerts** for what Loadweaver knows best: cluster at risk, node down, replica lost, failover happened, capacity near the limit, quota near the limit, certificate expiring, policy denies spiking, DNS secondary drift, audit chain broken.
- **decided** **Custom rules** on any metric or log query (threshold, rate of change, absence of data).
- **decided** Alert rules are **policies**, so they go through plan / apply and can be scoped by selectors.
- **decided** Delivery via the existing **notifications** feature, **email** and **webhooks** (like Agenstra's webhooks).
- **decided** Silences and maintenance windows (e.g. automatically during a planned node drain), acknowledgement and escalation per project.

**Export**

- **decided** **Prometheus** endpoint and **OTLP** export for metrics, reusing the shared OpenTelemetry module (like Agenstra).
- **decided** **SIEM forwarding** for logs and audit (syslog, OTLP, webhook).
- **decided** **CSV / JSON export** from every table and graph.
- **decided** Exports always respect project access.

### 3.19 Live interaction: plans, terminals, files, tunnels

Reference in Agenstra: Socket.IO namespaces on the controller (`socket/clients`, `socket/status`, ...), terminal via xterm.js with `createTerminal` / `terminalInput` / `terminalOutput` / `terminalResize` / `closeTerminal`, file API with raw bytes, `Range` reads, chunked uploads up to 100 MB, Monaco / media previews and a tree with cut / copy / paste and conflict prompts, live container logs over WebSocket. See [websocket-communication.md](../docs/agenstra/features/websocket-communication.md), [agent-management.md](../docs/agenstra/features/agent-management.md#terminal) and [file-management.md](../docs/agenstra/features/file-management.md).

**Transport**

- **decided** **Browser ↔ API: Socket.IO namespaces** like Agenstra (e.g. status, plans, live flows / logs, terminals), same auth handshake, same project scoping (3.17).
- **decided** **Node agent ↔ control plane: one persistent outbound gRPC stream per node over mTLS.** Terminals, file transfers, live flows and log tails are multiplexed over it. Nodes need **no inbound management port**, so terminals and files also work for nodes behind NAT.
- The control plane bridges both sides; the browser never talks to a node directly.

**Live plans & applies**

- **decided** Plan generation and apply are streamed **step by step, per resource and per layer** (tunnels, routes, rules, containers, volumes, DNS, certificates), in the plan view and as an **overlay on the topology map** (3.9).
- **decided** Everyone looking at a project sees the same progress. Approvals, applies and lock changes appear instantly, and a toast shows when someone else's plan touches what you are looking at.
- **decided** **Failed or cancelled applies roll back automatically** to the previous state.
  - Cancel / failure stops at the next **safe point** (never in the middle of a migration cutover or a DRBD promotion), then the rollback runs, streamed live like the apply itself.
  - **If the rollback fails too, the real state is shown, never hidden**: the affected resources are marked as **failed / inconsistent** on the map and in the plan, an alert fires (3.18), and the exact steps that succeeded and failed stay visible in the plan history and the audit log.
  - Loadweaver then proposes a **fix-forward plan** from the actual state. Locks of the affected resources stay held until it is resolved, so nothing else builds on an inconsistent state; only plans that resolve it may take them.
  - Data written by workloads in the meantime is not rolled back (rollback restores configuration and placement, not volume contents).

**Operation progress (Agenstra pattern, 1:1)**

Reference: Agenstra's provisioning progress in [agent-management.md](../docs/agenstra/features/agent-management.md#provisioning-progress) and [websocket-communication.md](../docs/agenstra/features/websocket-communication.md).

- **decided** **Every long-running operation** reports a current **step** and an overall **percentage**, with the same mechanics as Agenstra:
  - a **snapshot endpoint** per scope plus **live events**; events received while the snapshot loads take precedence (incl. completed / failed operations), and reselecting or reconnecting drops stale operations;
  - entities **not in view** get their running operations through the **status channel** (`statusSnapshot` / `statusPatch` style), with faster polling while operations run.
- **decided** Covered operations: applies and rollbacks (per resource, as above), migrations (incl. live-migration pre-copy rounds), node join / drain / upgrade / reboot, **image pulls with real layer progress**, volume resync / restore, backups and restore tests, certificate issuance, DNS propagation (until all authoritative servers are verified, 3.28), plan-bot runs.
- **decided** UI: an **`fpc-progress` bar with the current step** on each entity (and placeholder rows for entities still being created), **stacked bars on parents** (one segment per running operation: deployment → project → cluster, node → site), the same bar **in front of the triggering button** while it is loading, and running operations in the **needs-attention inbox** and on **fleet cards** (3.25). Bars disappear when the operation completes or fails.
- **decided** Also on the other surfaces:
  - **canvas**: progress rings on the affected elements in the live view (3.9);
  - **mobile app**: the same bars, plus a **push notification** when a long operation finishes or fails (3.33);
  - **CLI**: live progress lines (step + %) with `--watch`;
  - **plan bot**: the sticky PR comment updates its apply progress (3.30);
  - **MCP**: agents can read the same snapshot.

**Terminal**

- **decided** **Exec into any service replica** (picker for service, replica, shell), xterm.js with Agenstra's terminal events. Works for `runc` and gVisor containers.
- **decided** **Node host shell is disabled by default.** It can be enabled per cluster, for **cluster admins only** (it is root on the host).
- **decided** Who may exec: project operators and admins; developers only if the project allows it; viewers never.
- **decided** **Metadata of every session is always audited** (who, which container / node, start, end, exit code). **Full input / output recording** (asciinema-style, stored like logs with retention, 3.18) is switchable per project / cluster as a policy, and **on by default for node shells**. A banner shows when a session is recorded.

**File browser**

- **decided** Opens **volumes** (the DRBD replicated data, browsed on the node that holds the primary replica) and the **filesystem of running containers**. Secrets and configs are viewable read-only for admins.
- **decided** Reuses Agenstra's file API and UI: raw bytes, `Range` reads, chunked uploads up to 100 MB, Monaco / image / video / audio / PDF preview, tree with cut / copy / paste and Replace / Keep both prompts.
- **decided** **Writes are allowed with clear warnings**:
  - volume writes for operators / admins, with a warning if a running service uses the volume;
  - container filesystem writes marked as **"lost on restart / migration"** (the container layer is not persistent) and recorded as drift-like events (3.8);
  - every write is in the audit log.

**Debug tunnels**

- **decided** `loadweaver port-forward <service> <port>` in the CLI opens a local port that tunnels through the control plane and the node stream to a service, e.g. a database without public exposure.
- **decided** For operators / admins only, **time-limited**, **audited**, and shown on the map as a temporary "operator" edge.
- **decided** No policy change is needed: the tunnel is a built-in, temporary operator policy (P6 still holds, it just doesn't go through plan / apply), and it ends with the session.

### 3.20 Backups & disaster recovery

Replication is not a backup: a deleted volume or a `DROP TABLE` is replicated to every replica instantly. Backups cover that and the loss of the whole cluster.

**Targets**

- **decided** **Built-in object storage on the cluster** as the default backup target, **external targets optional**.
- **decided** Engine: **Garage**. S3-compatible, built for small geo-distributed clusters (a few nodes, high-latency links between sites), very light, with zone-aware replication that maps directly to our sites. AGPL-3.0, matching the Loadweaver open source license.
- **decided** Garage is also used beyond backups: OpenSearch snapshot repository, Postgres WAL archive, and an S3 service apps can use (buckets as project resources, access via policies).
- **decided** External targets are providers in the shared provider lib (any S3-compatible storage, SFTP), configured as **secondary copies**.
- **decided** **No external target = a pin** (3.12): the plan and cluster health warn that backups don't survive losing the whole cluster (or all sites), until an off-cluster copy exists. Can be acknowledged with a reason.

**Scope: everything, including logs and metrics**

- **decided** Per data type:

  | Data                                 | How                                                                                                                                                                                   |
  | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Volumes                              | DRBD / LVM snapshots (crash-consistent), deduplicated, encrypted, incremental upload. Optional pre / post hooks in compose (`x-loadweaver`) for app-consistent dumps (e.g. `pg_dump`) |
  | Postgres + TimescaleDB (incl. audit) | continuous **WAL archiving** → **point-in-time recovery**                                                                                                                             |
  | OpenSearch (logs, audit mirror)      | snapshot repository on the object store                                                                                                                                               |
  | etcd, CA keys, workload identity CA  | part of the control plane backup                                                                                                                                                      |
  | Garage itself                        | replicated across sites; external copy as secondary target                                                                                                                            |

- **decided** Backups are **encrypted client-side** before they leave the node, so external targets never see plaintext.
- **decided** **Schedules and retention are policies** with selectors (e.g. hourly 24 / daily 14 / monthly 12 for `tier = critical`), going through plan / apply.
- **decided** Restore options: whole volume, **single files via the file browser** (3.19), into a **new volume** (side-by-side), and **point-in-time** for the control plane. Restores are plans too.
- **decided** Optional **automated restore tests** (restore into a scratch volume, run a check hook, report), shown on the volume and in alerts.
- **decided** **Whole-cluster disaster recovery**: a fresh node bootstraps from a backup target (external copy) and restores control plane first, then volumes, then redeploys. Documented and tested as part of the multi-site lab.

**Backup keys & recovery kit**

- **decided** Backups use a **dedicated backup key hierarchy**, separate from the cluster's day-to-day secrets (3.22), so losing the cluster doesn't lose the ability to decrypt backups.
- **decided** At cluster setup (and on every key rotation) admins must download / print a **recovery kit**: the recovery key **split Shamir-style** (e.g. 2 of 3 shares for different people) and **confirm** it. Without a confirmed kit, the cluster shows **"backups not recoverable"** as a pin (3.12).
- **decided** Optionally the backup key is **also escrowed in an external KMS / Vault**.
- **decided** Disaster recovery from a fresh node (above) **asks for the recovery kit or the KMS first**.
- **decided** Restore tests also prove that the kit still decrypts current backups.

**Immutability (ransomware / compromised admin)**

- **decided** Backups are written with **S3 Object Lock** / retention for their retention period: on Garage where supported, on external S3 targets in **compliance mode**.
- **decided** **Deleting backups or shortening retention** needs a **second admin approval** and only takes effect **after a delay** (e.g. 72 h), with alerts (3.18).
- **decided** The control plane's credentials for external targets are **write / append-only** where the provider allows it.

**Backup catalog & self-service**

- **decided** A **catalog page** per cluster and per project: all backups by resource, with time, size, target, encryption, restore-test result and immutability state; a **timeline view**; and a **diff between backups** (changed files, size).
- **decided** **Self-service restores** for project operators / admins on their own resources, as plans with live progress (3.19). Cluster-level restores (control plane) only for cluster admins.
- **decided** **Backup storage counts against project quotas** (3.17).

**Cross-cluster restore & cloning**

- **decided** Through the **fleet console** (3.24), a backup can be restored **into another cluster** the user has access to: disaster recovery to a standby cluster, or **cloning** a deployment with its data for staging / testing.
- **decided** The target cluster needs the **backup key** (recovery kit / KMS); the import follows the normal plan, with groups and policies **remapped** to the target cluster.

### 3.21 Node bootstrap, joining & upgrades

**Supported hosts & bootstrap**

- **decided** Supported: **Debian 12 / 13** and **Ubuntu 22.04 / 24.04 LTS**, on **amd64 and arm64**.
- **decided** Join with a **one-line install + short-lived join token**, or automatically when Loadweaver orders the server through the provider lib (section 4).
- **decided** **No SSH involved**: Loadweaver never logs into hosts. Joining always works with the **join token** (one-liner run by the user through whatever access they have, or cloud-init for provider-ordered servers); no SSH-based bootstrap from the UI / CLI.
- **decided** Host requirements: supported OS (above), **root / sudo** for the installer, **outbound** connectivity to the control plane (the agent opens its gRPC stream outwards, 3.19; no inbound management port), and **UDP reachability for WireGuard** between nodes where policies need a tunnel (at least one side of each pair reachable, relevant for nodes behind NAT).
- **decided** The installer sets up Docker, gVisor, WireGuard, DRBD (DKMS), BIRD, Envoy and the node agent. Node identities are mTLS certificates, **rotated automatically**.
- **decided** OS package and kernel updates also run as **rolling plans** (drain → update → reboot → rejoin), since DRBD / WireGuard / gVisor depend on the kernel.

**Joining hosts that already run things**

- **decided** **Any Docker host** can join, including hosts that already run containers or compose projects, and also **former Loadweaver nodes**.
- **decided** Join starts with a **discovery** that changes nothing: compose projects, containers, volumes, networks, port bindings, and conflicts (e.g. an nginx on 80 / 443, a WireGuard interface already in use).
- **decided** An **import wizard** asks per item: target project, import as a deployment, migrate to other nodes, or leave unmanaged; and where data goes (copied into a new replicated volume).
- **decided** The result is **one plan**: install the node components, import / migrate the resources in dependency order with minimal downtime, then hand the ports over to the Loadweaver ingress. Unmanaged leftovers stay visible as drift (3.8).
- **decided** **Pre-existing tunnels as bootstrap path**: the join token works over any path that reaches the control plane, including an existing tunnel (WireGuard, Tailscale, OpenVPN, IPsec, ...). As soon as the node's own Loadweaver WireGuard tunnel is up and healthy, the agent's gRPC stream **switches over make-before-break**, without interruption.
- **decided** The pre-existing tunnel itself is **ignored entirely** afterwards: not shown, not managed, not reported as drift, never touched.
- **decided** **Conflicts are detected in discovery and resolved in the join plan**: discovery reads interface names, listen ports, address ranges and routes of existing tunnels / VPNs; the join plan picks non-conflicting ports and interface names automatically and refuses node subnets / service IPs that overlap with routes the host already uses (the user picks another range or removes the overlap). nftables rules live in Loadweaver's own tables / chains, so foreign rules stay intact. Nothing changes before the plan is approved.
- Note: "ignored" applies to the host's own use of that tunnel. Workload traffic is only ever routed through Loadweaver-managed interfaces, so a foreign tunnel can't become a path around the policies (P6).
- **decided** **Former Loadweaver nodes** are detected (agent, DRBD resources, WireGuard config, labels):
  - re-joining the **same cluster** reuses still-valid replicas, so only the difference is resynced;
  - joining a **different cluster** treats their deployments like any Docker host's (import wizard) and discards the old cluster identity and keys.

**Upgrading Loadweaver**

- **decided** See **3.26** for how updates of Loadweaver, its components and the OS are rolled out.

### 3.22 Images, secrets & encryption

**Images & registry**

- **decided** Registry credentials (Docker Hub, GHCR, private registries) are **project secrets**.
- **decided** **Built-in registry**: OCI distribution, backed by Garage (3.20), acting as **pull-through cache** for upstream registries and as a **private registry** projects can push to. Images are pulled once per cluster; nodes keep working when the upstream registry is down or rate-limited, and migrations / failovers never wait for a slow pull.
- **decided** Images are **pinned to digests at plan time**, so an apply deploys exactly what was reviewed, even if a tag moves in between.

**Image policies**

- **decided** Images are **scanned** for known vulnerabilities (Trivy, which the repo already uses in CI, see [ci-security-scanning.md](../docs/agenstra/security/ci-security-scanning.md)) on pull and periodically. Results show on the deployment and in the plan.
- **decided** Policies can **require signatures** (cosign / Sigstore) or **block critical CVEs**, with the familiar `monitor` / `enforce` modes, so a rule can be observed before it blocks anything.

**Secrets**

- **decided** **Envelope encryption**: secrets (compose secrets, registry credentials, provider / DNS API tokens, backup keys, volume keys) are stored encrypted in Postgres with data keys; data keys are encrypted by a **cluster master key**.
- **decided** The master key is **split across the control-plane nodes** (Shamir-style, unseals automatically when a quorum is up) **or held by an external KMS / Vault**, optionally.
- **decided** Secrets reach containers as **tmpfs files**, never written to node disks.
- **decided** **Rotation is a plan.**
- **decided** Secret values never appear in plans, logs or the audit log, only versions / hashes (redaction in 3.14).
- Single-node setups: there is no quorum to split the key across, so the key is sealed locally (optionally with an external KMS), and the plan states that this is weaker than the multi-node setup.

**Volume encryption**

- **decided** **All volumes are encrypted at rest, always**: LUKS under DRBD per volume, keys from the secrets system. A stolen disk or a decommissioned node leaks nothing.
- **decided** Backups are encrypted as well (3.20), independently of the volume encryption.
- Note: this costs some CPU on every write; sizing guidance and the capacity checks (3.2) take it into account.

### 3.23 IPv6, jobs & autoscaling

**IPv6**

- **decided** **Dual-stack from the start**: node subnets, service IPs, WireGuard, BIRD, nftables, Envoy, DNS (AAAA records) and failover IPs all handle IPv4 and IPv6; policies accept both CIDR families.
- **decided** **IPv6-only nodes** are supported, with IPv4 only where it is needed (e.g. on the ingress). Providers like Hetzner hand out /64s for free while IPv4 gets more expensive, so this is a real cost saver.

**Jobs**

- **decided** **One-off jobs**: `x-loadweaver` marks a compose service as a job that runs once per apply (e.g. database migrations), ordered before / after other services.
- **decided** **Cron jobs**: schedule, timezone, concurrency policy (allow / forbid / replace), retries, timeout.
- **decided** Cron jobs run **exactly once cluster-wide**, also during failover (leader-elected scheduler).
- **decided** Every run is visible with logs and exit code; failed runs alert (3.18).

**Autoscaling (in the MVP)**

- **decided** **Horizontal autoscaling** between min / max replicas, on CPU, memory, requests or custom metrics.
- **decided** Never beyond the **project quota** or the **cluster capacity**; the N+1 reserve for failover (3.12) is kept.
- **decided** Scaling actions are **automatic, not plans**, but audited and shown as events on graphs and the map. The min / max / metric settings themselves are desired state and go through plan / apply.

### 3.24 Fleet, integrations & product surface (all in the MVP)

- **decided** **Multi-cluster console**: one console manages several Loadweaver clusters. Each cluster keeps its own control plane (no cross-cluster dependency); the console connects to their APIs, similar to how the Agenstra controller connects to several agent-managers. Fleet views: all clusters' health, alerts, plans and upgrades in one place; access per cluster and project (3.17).
- **decided** **Terraform provider** on top of the API: `terraform plan` maps to a Loadweaver dry-run plan, `terraform apply` creates and applies a Loadweaver plan (still subject to approvals, 3.17). Resources: projects, groups, policies, deployments (compose), volumes, DNS, alert rules, backup policies.
- **decided** **Usage metering per project**: CPU, memory, storage, traffic, public IPs over time (from TimescaleDB, 3.13), exportable and consumable by **Decabill**, so hosters can resell Loadweaver capacity. Decabill already has tenant-scoped usage meters for arrear usage billing ([usage-meters.md](../docs/decabill/features/usage-meters.md)), which are the natural receiving end.
- **decided** **Docs and site**: a `frontend-docs` app (like Agenstra / Decabill) and the **loadweaver.com** landing page; the "Coming soon" entries on the ForePath landing page then link to it.

### 3.25 Overview, health & dashboards

Building blocks in the monorepo: `fpc-summary-bar` (paged, columns, autoplay), `fpc-summary-card` (with actions) and `fpc-panel-grid` from the shared `ui-components`; Decabill's console overview is built from exactly these.

**Cluster overview (landing page)**

- **decided** Layout, top to bottom:
  1. **Health headline** with the reason, e.g. "At risk: volume `db-data` has no replica outside `fra1`".
  2. **Needs attention inbox**: failed rollbacks (3.19), at-risk items (3.12), pending approvals (3.17), unacknowledged pins, drift (3.8), firing alerts (3.18), expiring certificates, failed backups / restore tests (3.20), available upgrades (3.21), pending cross-project requests. Each item links to where it is resolved.
  3. **Summary bar**: sites, nodes, deployments, capacity used vs. N+1 reserve, traffic, denies, backup state, SLO state.
  4. **Mini topology map** (live, 3.9), **per-site cards**, **recent activity** (plans, applies, failovers, migrations, node join / leave), **capacity forecast**.
- **decided** Project members land on the **same layout, scoped** to their project(s) (3.17).

**Health model**

- **decided** **Explained health tree**: every entity has a state, **healthy / degraded / at risk / failed / unknown**, with machine-readable reasons.
- **decided** States **roll up** along cluster → site → node and project → deployment → service → replica, with **rules instead of "worst child wins"** (e.g. 1 of 3 replicas down = degraded, not failed; a pinned item = at risk only if not acknowledged).
- **decided** Every badge answers **"why"** with a click (reason, affected entities, link to the fix).
- **decided** State changes are **events on the timeline**, so "how long were we at risk last month" is answerable, and they feed reports and SLOs.

**Customization**

- **decided** Same as decided for graphs and audit (3.18): **curated** overview, **saved views** via the URL filter, **fully custom dashboards** (in the MVP, 3.18).

**SLOs & status pages**

- **decided** Deployments can define **SLOs** (availability, latency) measured at the ingress. The overview shows **error budget burn** and monthly uptime.
- **decided** Optional **public status page per project**, hosted by the cluster itself and served via the ingress, with incident notes, built from the same data.

**Search**

- **decided** **Both**: a **context-bound quick search** on every page (filters the current list / view) and a **global search + command palette** (Ctrl / Cmd + K) as the fallback whenever the way to the right part of the UI would be too long.
- **decided** The global search covers every entity (clusters, projects, deployments, services, nodes, groups, policies, volumes, DNS records, plans, alerts) and **actions** ("drain node n2", "open terminal in api", "create plan"). Indexed in OpenSearch, scoped by access, recent items and favourites first.

**Fleet overview (3.24)**

- **decided** **One card per cluster** (health, sites, capacity, version, open alerts, pending plans / upgrades), a **merged needs-attention inbox** across clusters, a **world map of sites** when locations are known, and **side-by-side comparison** (versions, capacity, policy drift between clusters). Clicking a card opens that cluster's overview.

**Wallboard**

- **decided** **Kiosk view**: full-screen, auto-refreshing, read-only overview (health, inbox, live map, key graphs) for a screen on the wall. Opened with a **dedicated read-only token** that can only open this view; rotates through clusters / projects using the summary bar's autoplay.

**Reports**

- **decided** Handled **the way Decabill handles its periodic exports** (see the DATEV export in [billing-administration.md](../docs/decabill/features/billing-administration.md#datev-accounts-payable), [background-jobs.md](../docs/decabill/deployment/background-jobs.md) and [file-explorer.md](../docs/decabill/features/file-explorer.md)):
  - **periodic report jobs** (cron coordinator + per cluster / project unit jobs with idempotent IDs, e.g. `report.project.{id}.{year}-{month}`);
  - files stored through the shared **`util-file-storage`** lib (`FileStorageProvider`, `local` / `s3`), with **Garage** as the S3 backend by default (3.20) and external S3 as an option;
  - browsed in a **file tree** like Decabill's File Explorer: virtual tree from database storage keys, fixed folders (e.g. `reports/{cluster,project}/{year}/{month}`), single-file and folder-as-ZIP download, scoped by access.
- **decided** Content: uptime and SLOs, incidents (failovers, rollbacks), capacity trend and forecast, policy denies, backup and restore-test status, upgrades, usage (metering, 3.24).
- **decided** Providers and code are **reused from the other projects** where they exist (file storage, background jobs, signing / verification of documents) instead of being rebuilt.

### 3.26 Update rollout (OS, components, node agent)

Covers everything that runs on the nodes and the control plane: Linux packages and kernel, the node agent, control plane services, Envoy, BIRD, DRBD, WireGuard tools, gVisor, Garage, OpenSearch, Postgres / Patroni / TimescaleDB, etcd, registry, Trivy DB, and the CLI.

**Versioning**

- **decided** **One signed release bundle** per Loadweaver release: a manifest pinning **all components** to tested versions. Only tested combinations ever run.
- **decided** Third-party security fixes ship as **patch releases of the bundle**.
- **decided** An update is **a plan** (3.8) that shows the diff per component, compatibility notes and the failure analysis.
- **decided** Release channels **stable / beta**, announced through the shared updates feature.

**Distribution**

- **decided** The control plane downloads a bundle **once**, verifies signature and checksums, and stores the artifacts in the **built-in registry / Garage** (3.20, 3.22). Nodes fetch **only from the cluster**.
- **decided** **Air-gapped clusters** import a bundle as a single file (UI upload or CLI).
- **decided** **OS packages** go through a **cluster-local apt cache** the same way, so all nodes get identical package versions.

**Rollout**

- **decided** Order: **control plane first** (it stays compatible with **N-1 node agents**), then a **canary node**, then **waves**.
- **decided** A wave never takes down more than the failure domain allows (3.12): one site at a time, never more nodes than N+1 tolerates.
- **decided** Every step waits for **health gates**: health tree (3.25), SLO burn, error rates, replication state.
- **decided** On failure: **automatic pause and rollback of that step**, with the same semantics as applies (3.19), including "failed rollback = real state shown + fix-forward plan".
- **decided** Components update **without touching workloads** wherever possible:

  | Component                              | How it updates                                                               |
  | -------------------------------------- | ---------------------------------------------------------------------------- |
  | Node agent                             | binary swap + systemd restart; containers keep running (Docker live-restore) |
  | Docker                                 | live-restore, containers keep running across the daemon restart              |
  | Envoy                                  | hot restart with connection draining                                         |
  | BIRD                                   | graceful restart, routes stay installed                                      |
  | Postgres / Patroni                     | replicas first, then **switchover**, then the old leader                     |
  | etcd, OpenSearch, Garage               | one member at a time, waiting for quorum / green state                       |
  | Kernel, DRBD module, gVisor, WireGuard | **drain → update → reboot → rejoin** (3.10), one node at a time              |

**Control plane database migrations**

- **decided** **Expand / contract**: additive "expand" migrations run before the rollout (old and new code both work), "contract" migrations (dropping old columns) only after every component runs the new version. Keeps N-1 compatibility and makes rolling back a step safe.
- **decided** **Major Postgres versions** are their own plan (`pg_upgrade` via Patroni), with a backup (3.20) first.

**Automatic updates & maintenance windows**

- **decided** **Update policy per cluster**: notify only / auto-apply patch and security releases in maintenance windows / manual.
- **decided** Default: **security patches** (OS packages and bundle patch releases) apply **automatically in the maintenance window**; **minor / major releases need an approved plan**.
- **decided** Auto-updates still create a **visible plan** and respect approval rules (3.17).
- **decided** **OS updates are orchestrated by Loadweaver**, no independent `unattended-upgrades`, so reboots never happen uncoordinated.
- **decided** **Maintenance windows are policies** with selectors (e.g. "Tue + Thu 02:00-05:00 Europe/Berlin" for `site = fra1`), so sites and node groups can have different windows. An update that doesn't fit into one window pauses and continues in the next.
- **decided** Alerts are silenced automatically for planned drains (3.18).
- **decided** **Emergency security fixes** can be applied outside windows with an explicit approval.

**CLI and desktop app**

- **decided** The CLI and the desktop app check the cluster's version and warn when they are older than N-1. The CLI updates through its package channels; the desktop app updates **in-app** (signed, stable / beta channels) through the shared desktop release pipeline (3.32).

### 3.27 External BGP, own ASN & public addressing

Extends 3.4 (BIRD between nodes) and 3.6 (failover IPs) to peering with the outside world.

**Scope**

- **decided** Users can bring **their own ASN and IPv4 / IPv6 prefixes** (PI / PA, e.g. a /24 and a /48 from an LIR) and peer **directly** with upstreams, IXP route servers or provider BGP (e.g. Hetzner, Vultr, Equinix Metal) per site.
- **decided** Prefixes can be announced from **several sites** (multi-homing, anycast).
- **decided** The simple case stays covered: a provider-assigned / private ASN that only announces failover IPs (3.6).

**Configuration: peers and announcements are policies**

- **decided** ASNs, prefixes and peers are **cluster resources**, managed by infra operators / cluster admins (3.17).
- **decided** Which node group peers with whom, **what** is announced **where** (prefix, communities, AS-path prepends, MED, local-pref) and **when** (only while the backing service is healthy) are **policies with selectors**, compiled into BIRD like everything else (P6).
- **decided** The plan shows the effect in plain words, e.g. "announces 203.0.113.0/24 from `fra1` to AS64500, prepended 2× at `ams1`".
- **decided** Sessions, announced prefixes and received routes appear on the **map**, in **logs** (3.14) and in **graphs** (session state, prefixes received / announced, flaps).

**Route safety (strict by default, MANRS-aligned)**

- **decided** Only prefixes the cluster **owns** are announced; **RPKI** is checked and the plan warns about missing / invalid **ROAs** and **IRR** objects.
- **decided** Imports: **RPKI-invalid routes rejected**, **max-prefix limits**, **bogon filters**.
- **decided** **BFD** for fast failure detection on upstream sessions.
- **decided** **Graceful shutdown** (the BGP community, RFC 8326) before a node is drained (3.10, 3.26), so traffic moves away before the session drops.

**Outbound traffic**

- **decided** Per site, accept a **default route** or a **partial table** (e.g. the upstream's customer routes) and use it for egress from that site. **Full tables** only on dedicated edge nodes with enough RAM, optional.
- **decided** **Egress source IPs from own prefixes**: SNAT per workload group as a policy, so a project's outbound traffic leaves with **stable, known IPs** that third parties can allowlist.

**Public IPAM**

- **decided** **Built-in public IPAM**: own prefixes are pools; Loadweaver assigns from them to ingress IPs, port-forward IPs, egress SNAT IPs and DNS servers.
- **decided** Projects request IPs **within their quota** (3.17); assignments are desired state and shown in the plan; released IPs go into a **cooldown** before reuse.
- **decided** **Reverse DNS (PTR)** records are managed through the DNS providers (3.15).

**Anycast vs. primary / backup**

- **decided** Chosen **per announced IP / prefix by policy**:
  - **anycast**: all healthy sites announce, the nearest site wins. For stateless web and DNS.
  - **primary / backup**: one site announces, others prepend or withdraw. For stateful L4 port forwards that must not switch sites mid-connection.
- **decided** The plan **warns** when anycast is used for L4 services with long-lived connections.

**Sites and nodes without BGP**

- **decided** Nodes with upstream sessions form an **`edge` node group**.
- **decided** Traffic for services running elsewhere is **forwarded over WireGuard** to the nodes that run them, and **egress can be routed out through edge nodes**, so workloads on cheap nodes without BGP still use the own prefixes.
- **decided** Edge capacity and redundancy are part of the **failure analysis** (3.12): a prefix announced from a single edge node is a pin.

**Licensing**

- **decided** Like every feature, own-ASN peering is **in the public source**. It belongs to the multi-site component set, which is commercially limited by BUSL-1.1 (section 5).

### 3.28 DNS failover

For exposures whose IP **cannot float** (no shared L2, no BGP, no provider failover IP), and generally wherever traffic has to move between IPs, e.g. across sites or providers. Built on the DNS providers (3.15).

**When it's used**

- **decided** DNS failover is a regular **exposure option per hostname / port forward**, set by policy. It works on its own or **on top of floating IPs** (e.g. floating IPs within a site, DNS failover between sites at different providers).
- **decided** When the failure analysis (3.12) finds an exposure whose IP cannot float, the **plan suggests enabling DNS failover** for it. Without it, the exposure is a **pin**.

**Modes**

- **decided** **Failover**: one primary answer; ordered backups take over when it's unhealthy.
- **decided** **Healthy multi-value**: all healthy endpoints are returned (clients spread and retry); unhealthy ones are removed.
- **decided** **Weighted and geo / latency steering in the MVP**:
  - **weighted** answers decided by our own engine (e.g. 80 / 20 between sites);
  - **geo** via bind9 GeoIP views; **DB-IP Lite** (CC BY 4.0, redistributable with attribution) ships in the release bundle and is updated monthly; **MaxMind** GeoLite2 / GeoIP2 optional with the user's own license key;
  - **latency** steering from our multi-site probe measurements;
  - provider features (e.g. Cloudflare / Route 53 geo) only as accelerators, our engine decides.

**Health decisions**

- **decided** Endpoints are **actively probed from at least two sites** (HTTP(S), TCP or custom checks, from outside the target's own site where possible), combined with the **health tree** (3.25).
- **decided** A switch needs a **quorum of probes and the control-plane quorum**, so one isolated site can't flip records on its own.
- **decided** **Hysteresis**: N failed checks to fail over, M healthy checks to count as recovered.
- **decided** Clusters with a **single site** can add an **external probe location** (small VPS, can be the same machine as the witness, 3.2).

**Fail-back**

- **decided** **Automatic after a stable period** (default e.g. 10 minutes healthy) to avoid flapping.
- **decided** Per hostname it can be set to **manual**: stays on the backup until an operator confirms, e.g. when data has to be synced back first.
- **decided** Every switch (failover and fail-back) is an **event** on the timeline, in the **audit log** and raises an **alert** (3.18).

**TTLs & expectations**

- **decided** Failover-managed records get a **low TTL** (default **30 s**, bounded by the provider's minimum-TTL capability flag); all other records keep normal TTLs.
- **decided** The plan and the failure analysis show the **expected recovery time** (detection + update + TTL) per exposure, and warn that some resolvers / clients cache longer than the TTL. DNS failover is honestly labelled as **slower and fuzzier than floating IPs**.

**Providers**

- **decided** **Loadweaver's own engine always decides** (probes, quorum, hysteresis), with the same behaviour on every provider and on hosted bind9. Never two engines deciding independently.
- **decided** Provider features are used as **accelerators** via capability flags:
  - **Cloudflare proxied** HTTP records switch the origin instantly (clients don't cache the origin IP);
  - provider health-checked pools (e.g. Cloudflare Load Balancing, Route 53 failover) can be configured as a **mirror** of our decisions.
- **decided** **Multi-provider zones** (3.15): on a switch, every provider of the zone is updated **in parallel via API**, hosted bind9 instances get the change pushed directly, and AXFR secondaries get a **NOTIFY** for an immediate transfer. A switch counts as **done only when all authoritative servers answer the new record** (verified by querying each of them). Lagging providers raise an alert and show on the zone.

**L4 and stateful services**

- **decided** Works for **L4 port forwards** too: new connections go to the new endpoint, but **existing connections break** and clients must reconnect and re-resolve. The plan states this per port forward.
- **decided** DNS failover only counts as **covered** if the backup endpoint can actually serve: the failure analysis checks that the workload, its data replicas (3.5) and its policies exist at the backup site.

### 3.29 Configuration in Git (GitOps)

Everything can be done in the UI; **everything that is configuration can also live in Git**. UI and Git are two editors of the same YAML (3.8). **In the MVP.**

**What lives in Git**

- **decided** All declarative configuration: cluster settings, sites, node groups, providers (server, DNS, backup targets; without secret values), groups and policies, BGP peers and announcements, IPAM pools, DNS zones and records, deployments (compose + `x-loadweaver`), volumes, backup / alert / update / maintenance-window / retention policies, quotas, projects.
- **decided** **Not in Git**: runtime actions (drain, restore, terminal, tunnel, manual failover, rollback decisions), **secret values**, and live state (metrics, logs, health).
- **decided** A JSON Schema is published for every resource type, so editors validate the YAML (same schema the Monaco editor in the UI uses, 3.16).

**UI and Git together**

- **decided** Per connected scope (cluster or project), one of two modes:
  - **Git is authoritative**: UI edits open a **merge / pull request** with the YAML diff, which then follows the PR flow (on GitHub / GitLab: the plan bot, 3.30).
  - **Bidirectional**: UI changes are applied and Loadweaver **commits them back** with plan id and author.
- **decided** Pushes **always create plans** (3.8); the plan links to the commit, and the commit status shows the plan result (pending / approved / applied / failed). On GitHub / GitLab with the plan bot, **applies are triggered by PR comments, not by merges** (3.30).
- **decided** **Conflicts** (Git and UI changed the same resource) are shown in the plan, never silently overwritten.
- **decided** Changes made outside both (e.g. `docker run` on a node) stay **drift** and can be turned into a commit / PR from the drift view.

**Secrets**

- **decided** YAML only contains **secret references** (name + version, e.g. `secret://project/db-password`); values are set via UI / CLI / API or synced from an external KMS / Vault (3.22).
- **decided** Optionally **SOPS-encrypted** files in the repo, decrypted with a key held by the cluster (age / KMS), for teams that want secrets versioned alongside config.
- **decided** **Plaintext secrets in a push are rejected** and flagged (secret scanning on every push).

**Repos & access**

- **decided** The cluster scope and **each project** can connect **their own repo / branch / path** (a monorepo with paths works too).
- **decided** Supported: **GitHub, GitLab, Gitea / Forgejo** and plain Git over SSH / HTTPS, triggered by **webhooks** or **polling**. Deploy keys / tokens are secrets (3.22).
- **decided** Approval rules (3.17) still apply; a **merge review can count as the approval** if the scope is configured that way.
- **decided** **Memberships and roles** stay direct-API (instant revoke, 3.17), but can **optionally be managed from Git** as well; direct-API changes are then committed back so the repo stays complete.
- **decided** A cluster or project can be **exported to a repo** at any time (initial commit of the current state), which is also how existing UI-built setups move to Git.

### 3.30 Plan bot for GitHub & GitLab (Atlantis-style)

**In the MVP for GitHub and GitLab.** Gitea / Forgejo / plain Git keep the basic commit-status flow from 3.29; a Gitea / Forgejo bot adapter (their APIs and webhooks are GitHub-like) follows **after the MVP**.

**Integration**

- **decided** A **Loadweaver GitHub App** (installable per org / repo, fine-grained permissions, webhooks) and a **GitLab integration** (group / project access token + webhooks, gitlab.com and self-managed).
- **decided** Every connected cluster / project scope (3.29) can use it.

**What the bot posts**

- **decided** **One sticky comment per PR / MR**, updated on every push:
  - plan diff per resource and layer (deployments, policies, DNS, BGP, IPAM, ...);
  - new or acknowledged **pins** and **failure analysis** warnings (3.12);
  - **quota / capacity** impact (3.17, 3.2);
  - **image scan / policy** results (3.22);
  - **current drift** of the touched resources, so reviewers see when reality differs from the default branch (3.8);
  - **locks** held by other PRs on the same resources.
- **decided** A **status check** (can be made a required check) and a link to the full plan with the map overlay in the UI (3.9).

**Flow: comments trigger actions, merge does nothing**

- **decided** Opening a PR or pushing to it **plans automatically**.
- **decided** **Applies are triggered by comment** (`loadweaver apply`); **merging does not apply anything**.
- **decided** Apply requirements: the PR is **mergeable** (checks green, no conflicts) and the Loadweaver **approval rules** of the scope are met (3.17; a PR review can count as the approval if configured, 3.29).
- **decided** While a PR has an open plan, the touched resources are **locked** (3.8) until the PR is applied, closed or unlocked.
- **decided** After a successful apply the bot **merges the PR automatically** (default, configurable per scope), so the default branch matches what is running.
- **decided** Guard rails for the "merge does nothing" model:
  - a PR **merged without apply**, or a **direct push** to the default branch, creates a plan that is **not applied** and shows as **"default branch ahead of cluster"** drift in the console, in the needs-attention inbox (3.25) and in every following PR comment;
  - an apply that **fails** rolls back like any apply (3.19); the bot posts the result and the PR stays open.

**Commands**

- **decided** `loadweaver plan` (re-plan, optionally limited to a path / project), `loadweaver apply`, `loadweaver unlock`, `loadweaver approve`, `loadweaver drift` (show current drift).
- **decided** **Git accounts are linked to Loadweaver users** (OAuth link in the console). A command only works if the linked user has the role for it in that project (3.17); otherwise the bot replies with the reason.
- **decided** Every command is **audited** with PR, commit and user (3.18).

### 3.31 Remote access: external WireGuard clients

Lets people, machines and whole offices connect to the cluster and reach internal services **according to the policies assigned to them**, so a full company can run on Loadweaver. Builds on groups and allow-only policies (3.3), the policy-aware DNS (3.4), the proxy (3.7), the WireGuard compiler, logs (3.14), the canvas (3.9) and SSO (3.17).

**Who connects**

- **decided** A client is a **device that belongs to a user** (Loadweaver user, usually from Keycloak / SSO). The user's **identity-provider groups map to client groups**, which are normal groups in the policy model, so "group `sales` may reach the CRM on 443" is just a policy.
- **decided** **Machine clients** without a user (CI runners, servers elsewhere, office routers) with their own group membership, enrolled by admins.
- **decided** Policies stay **allow-only**: a client sees nothing unless a policy allows it.

**Gateways**

- **decided** Nodes in a **`vpn` node group** act as gateways. Clients get **one endpoint hostname** that resolves via failover IP, anycast or DNS failover (3.6, 3.27, 3.28), so a gateway failure means a short reconnect, not a reconfiguration.
- **decided** A client's key is valid on **all gateways**; gateways get peer state from the control plane.
- **decided** Gateway capacity and redundancy are part of the failure analysis (3.12); a single gateway is a pin.

**Enrollment & keys**

- **decided** **Self-service** in the console, desktop app or CLI; the keypair is **generated on the device** where possible (the private key never leaves it). Otherwise a one-time config / QR is shown once and not stored.
- **decided** **Keys expire** (e.g. 30 days, policy-configurable) and are renewed after a **fresh SSO login incl. MFA**, since WireGuard itself has no login.
- **decided** **Revocation is instant** on all gateways; offboarding a user in Keycloak revokes all their devices.

**Routing & DNS**

- **decided** **Split tunnel by default**: only the prefixes / service IPs the client's policies allow are routed (`AllowedIPs` generated from the policies, never more). Internal names resolve through the **policy-aware cluster DNS** via split DNS.
- **decided** **Full tunnel as a policy option** for groups that need it: all client traffic leaves through the cluster and passes the **egress proxy and egress policies** (company web filtering, fixed egress IPs, 3.7, 3.27).

**Site-to-site (offices)**

- **decided** An office router / firewall (any WireGuard-capable device: OPNsense, pfSense, MikroTik, Fritz!Box, Linux) connects as a **machine client** and announces its office subnets.
- **decided** Those subnets become a **group** in the policy model: "`office-berlin` may reach the intranet" is a policy, and services reach office devices (printers, NAS) only if a policy allows it. Return routes are added automatically; **overlapping office subnets are rejected** in the plan.

**Visibility & control**

- **decided** Every client IP maps to **user + device**, so proxy / firewall decisions, logs and audit show "alice@laptop" instead of an IP (3.14, 3.18).
- **decided** Clients appear on the canvas as a **"remote clients" group at the border** (3.9), with live connections and the path trace.
- **decided** Admins see **active sessions** and can **disconnect / revoke** a device instantly; users see their own devices and last connections.
- **decided** **Alerts** for unusual patterns (new country, many denies, posture changes, 3.18).

**Desktop app tunnel**

- **decided** The Electron desktop app (3.16) runs the **tunnel itself**, plus enrollment, key renewal after SSO login, posture reporting and a view of which services the user may reach.
- **decided** **OS-native WireGuard via small privileged helpers**, no own crypto and **no wireguard-go** (Go stays excluded, section 5):
  - **Linux**: kernel WireGuard, configured by a small helper (same approach as the node agent);
  - **Windows**: the official **wireguard-nt** driver / embeddable tunnel service;
  - **macOS**: **WireGuardKit** in a **Network Extension**.
    The Electron app only controls these helpers; the helpers are thin shims in the language the OS requires (C / Swift), the only non-TypeScript code in Loadweaver.
- **decided** **The Loadweaver desktop app is code-signed**: Apple Developer ID signing + notarization (incl. the Network Extension entitlement) and Windows Authenticode. Without that, the macOS tunnel can't ship at all. See **3.32** for the shared desktop release pipeline, which also covers Agenstra Desktop.
- **decided** **Phones and tablets** use the **Loadweaver mobile apps** (3.33) by default, with their own tunnel and posture. The **official WireGuard apps** stay possible: posture then comes **via MDM** (the MDM pushes the WireGuard config with a device ID and links it to its compliance state), and unmanaged phones enrolled by QR have posture **"unknown"**; policies decide what that means.

**Device posture (in the MVP, extensive)**

- **decided** **Core checks** reported by the desktop app at connect and periodically: disk encryption, OS version / minimum patch level, screen lock, OS firewall, desktop app version.
- **decided** **Integrations in the MVP**, behind a **posture plugin interface** (like the dynamic provider plugins):
  - **MDM**: Microsoft Intune, Jamf, Kandji (compliance state);
  - **EDR**: Microsoft Defender for Endpoint, CrowdStrike, SentinelOne (risk level);
  - **device certificates** from a company CA, or from Loadweaver's own CA issued at enrollment.
- **decided** Posture results are **policy conditions** per client group ("finance needs an encrypted disk, OS patched within 30 days and EDR risk low").
- **decided** **Failing posture moves the device into a restricted group** instead of disconnecting it (e.g. only helpdesk / wiki reachable), with the reason shown to the user.

**Licensing**

- **decided** Remote access is a single-site capability, so it belongs to the **AGPL** component set; using it across sites follows the multi-site BUSL split (section 5).

### 3.32 Shared desktop release pipeline (Loadweaver + Agenstra)

Today Agenstra Desktop (`apps/agenstra/native-agent-console`, Electron Forge) ships **unsigned and without in-app updates**, accepted as **AR-001** in [accepted-risks.md](../docs/agenstra/security/accepted-risks.md), mitigated by `SHA256SUMS` / `integrity-manifest.json` from `tools/release-integrity` ([vulnerability-reporting-and-artifacts.md](../docs/agenstra/security/vulnerability-reporting-and-artifacts.md#desktop-release-integrity)).

- **decided** **One shared desktop release pipeline** for every ForePath Electron app, built once as a shared tool next to `tools/release-integrity`:
  - **macOS**: Apple Developer ID signing + **notarization** (Loadweaver additionally with the Network Extension entitlement, 3.31);
  - **Windows**: **Authenticode** signing of installers and binaries;
  - **iOS / Android** (3.33): App Store / Play Store signing; managed distribution via MDM;
  - **Linux**: deb / rpm signed with a **ForePath GPG key** and published via **signed apt / rpm repositories** (updates through the package manager); AppImage / zip keep checksums;
  - the existing `SHA256SUMS` / `integrity-manifest.json` stay on top.
- **decided** **Agenstra Desktop moves onto it together with Loadweaver Desktop** (one switch for both apps, not ahead of it).
- **decided** **In-app auto-update for both apps** on **stable / beta** channels via Electron's update mechanism; every update is **signature- and manifest-verified** before install and never silently downgraded. (For Loadweaver this moves auto-update into the MVP.)
- **decided** **AR-001 is retired** once signing and auto-update are live: closed in the accepted-risks register with a note on what replaced it, and the vulnerability / artifact docs updated accordingly.
- Note: certificates and keys (Apple Developer ID, Authenticode, GPG) are release secrets of the pipeline, kept out of the repo and out of CI logs; their custody follows the same rules as other release-integrity material.

### 3.33 Mobile apps (Ionic)

- **decided** **Ionic + Capacitor + Angular**, matching the stack: the apps reuse the console's shared libs (`fpc-*` components where they fit mobile, data-access, brand palette 3.16). New app type in the monorepo, created with the Nx generators (section 6).
- **decided** **Scope: console + tunnel + posture**:
  - console in a mobile layout: overview and needs-attention inbox (3.25), **alerts as push notifications**, **approvals on the go** (3.17), logs, the canvas (3.9);
  - **VPN tunnel** with enrollment, key renewal after SSO + MFA, and the list of reachable services (3.31);
  - **posture reporting**.
- **decided** **Tunnel implementation**:
  - **iOS**: **WireGuardKit** (Swift) in a **Packet Tunnel** Network Extension;
  - **Android**: the official **`wireguard-android`** library (Apache-2.0) in a `VpnService`, as a **prebuilt dependency** (it uses wireguard-go internally; kernel WireGuard automatically where the device has it);
  - our own native code is limited to **thin Capacitor plugins** (Kotlin / Swift).
- **decided** **Mobile posture**: passcode / biometrics set, OS version / patch level, jailbreak / root detection, and **app attestation** (Apple App Attest, Google Play Integrity) so posture reports can't be faked by a modified app; plus **MDM compliance** where the device is managed (3.31). Disk encryption is implied on modern iOS / Android with a passcode. Same policy conditions and restricted-group fallback as desktop.
- **decided** **In the MVP**, on the parallel track (needs the API and the remote-access gateways from M4).
- **decided** **Distribution**: public **App Store** and **Play Store** listings, plus **managed distribution via MDM** (Intune / Jamf / Kandji app configuration with pre-filled endpoint and device ID). Signing through the shared release pipeline (3.32), extended with Apple / Google mobile signing.

### 3.34 Scale: from one node to ~1,000

**Target**

- **decided** **No cap on the number of nodes.** Only the control-plane _quorum_ is 3 or 5 members (3.2); every other node is a worker.
- **decided** Supported target: **1 to ~1,000 nodes per cluster**, across many sites. Beyond that: **several clusters** managed together through the fleet console (3.24).
- **decided** Small setups stay first-class (P2): everything below applies automatically as a cluster grows, nothing has to be configured up front, and small clusters keep the simple layout.

**Routing & tunnels**

- **decided** Small clusters keep **direct iBGP peering and direct tunnels**.
- **decided** Above a threshold (e.g. **16 nodes**), Loadweaver automatically designates **BIRD route reflectors per site** (a node group, redundant pairs) instead of full-mesh iBGP.
- **decided** **Cluster-wide built-in traffic** (control plane, telemetry, storage control) goes via **per-site hub nodes**; **direct node-to-node tunnels** are only built where workload policies actually need them, so the tunnel count grows with policies, not with N².
- **decided** Still compiled from groups and policies (P6) and shown in the plan ("promotes n4 / n9 to route reflectors for `fra1`").

**Data stores & telemetry**

- **decided** Default stays: control plane, Postgres / TimescaleDB, OpenSearch and Garage on the control-plane nodes (3.13, 3.14, 3.20), fine for small clusters.
- **decided** As the cluster grows, the plan **recommends** (and the capacity checks **enforce**) **dedicated node groups** for OpenSearch data nodes, a **separate Postgres / TimescaleDB cluster for metrics and flows** (keeping desired state small and fast), and Garage.
- **decided** Agents ship telemetry to **per-site collectors** that batch and forward, instead of every agent writing to the central stores.

**Control plane load** (consequences of the target, part of the same decision)

- The agent streams (3.19) terminate on all control-plane members / per-site collectors, not on a single leader.
- The failure analysis (3.12) and the policy compiler work **incrementally** (only what a change touches is recomputed), so plans stay fast at ~1,000 nodes.
- The canvas (3.9) relies on semantic zoom and aggregation (site → node → service) for large clusters.

**Verification**

- **decided** The multi-site lab (section 6) gets a **scale test** per release: real nodes plus **simulated nodes / agents** up to the target size, checking plan times, convergence after failover, and control-plane / store load.

---

## 4. Agenstra integration

- **decided** Agenstra hosts should be able to join a Loadweaver cluster later on (runtime management with gVisor support is the prerequisite).
- **decided** Integration in two steps:
  1. Agenstra's **agent-manager runs as a compose deployment on Loadweaver**, and Loadweaver nodes with gVisor are valid Agenstra hosts.
  2. Agent environments are **scheduled by Loadweaver** (placement, migration, HA), **in the MVP**: agent-manager gets a **runtime abstraction** with two runtimes, chosen **per workspace**:
     - **Docker host** (today, incl. the Squid egress guard), unchanged for existing installs;
     - **Loadweaver cluster**: agent environments become Loadweaver deployments on gVisor nodes, the egress guard is replaced by **Envoy policies compiled from Agenstra's egress config**, with **identical policy semantics** (modes, allow / deny, `network_allow`, Evaluate) in both runtimes.
- **decided** Loadweaver **can order new nodes itself**. The provider plugins Agenstra and Decabill already use (Hetzner Cloud, DigitalOcean, dynamic provider plugins, see [server-provisioning.md](../docs/agenstra/features/server-provisioning.md)) move into a **shared provider lib**, together with the DNS providers (3.15). Loadweaver uses it to add nodes on demand (manually or on a capacity warning, always via plan / apply) and to drive provider failover IPs (3.6).
- **decided** Boundaries: **Decabill** stays responsible for billing and subscriptions. A managed "Loadweaver Cloud" would be ordered through Decabill, like Agenstra Cloud.
- **decided** Agenstra on Loadweaver stays **agent-manager only** (step 1 above). The Agenstra controller and console keep running on their own servers; no deployment templates for them.
- **decided** Decabill itself does **not** run on Loadweaver either (same reasoning as the Agenstra controller / console). Its bare-server provisioning stays as it is.

**Decabill provisions Loadweaver**

- **decided** New bundled service kind **`loadweaver`** in Decabill's server provisioning, next to `agenstra-controller`, `agenstra-manager` and `decabill-billing` (see [server-provisioning.md](../docs/decabill/features/server-provisioning.md#bundled-product-stack)). Cloud-init installs a **single-node Loadweaver** (control plane, console, node agent) on the ordered server, using the normal bootstrap (3.21) and release bundle (3.26). That node is a full cluster (3.2).
- **decided** Decabill provisions and bills **only what it deploys**: the initial node with control plane and console, as a normal subscription of the `loadweaver` service kind.
- **decided** **Further nodes are ordered with provider tokens configured in the Loadweaver cluster, exactly like Agenstra** (a provisioned Agenstra controller orders servers with the `HETZNER_API_TOKEN` / `DIGITALOCEAN_API_TOKEN` it is configured with, see [server-provisioning.md](../docs/agenstra/features/server-provisioning.md)):
  - **mainly the user's own keys**: the customer adds their provider accounts in the cluster, or
  - **at ordering time in Decabill**: provider tokens can be entered as order fields and are passed to the cluster during provisioning, the same way Decabill merges customer input with **encrypted admin defaults** for its other stacks ([cloud-init-configs.md](../docs/decabill/features/cloud-init-configs.md)); **operator defaults** are possible too;
  - either way the tokens end up as **Loadweaver secrets** (3.22), never shown in plans, logs or audit;
  - Loadweaver orders nodes through the shared provider lib with them, via plan / apply, bounded by **Loadweaver quotas** (3.17);
  - with the user's own keys the customer **pays the provider directly**; Decabill is not involved in ordering or billing those nodes.
- **decided** Consequently there is **no Decabill metering for customer-ordered nodes**. Usage metering into Decabill (3.24) remains for hosters who resell capacity from **their own** Loadweaver clusters.
- **decided** **Removal and cancellation, data-safe**:
  - removing a node: Loadweaver drains it (3.21), then deletes the server through the provider lib;
  - cancelling the Decabill subscription: Decabill's existing subscription teardown runs, but first triggers a **final backup** to the customer's external target (if configured, 3.20) and a **grace period with read-only access** for export; then the **Decabill-provisioned** server, its IPs and DNS records are deleted. Nodes in the customer's own provider accounts are **not** deleted by Decabill; Loadweaver offers to decommission them (drain + delete with the customer's tokens) or leaves them for re-use. Every step is audited on both sides.

---

## 5. Stack & licensing

- **decided** Control plane API and UI in the monorepo's existing stack: **NestJS + Angular + Postgres**, like Agenstra and Decabill. Reuses shared libs (auth, OpenTelemetry, WebSocket gateways).
- **decided** **No Go: everything in TypeScript / Node.js**, so the existing technology stays (replaces the earlier "node agent in Go" decision).
  - **Node agent**: TypeScript, built as a **Node.js single executable application (SEA)** (one binary including the runtime, no Node install on the host), run as a **systemd service**. It lives outside Docker on purpose: it manages Docker and must be able to reconfigure the host network while Docker is down or being upgraded.
  - Docker via `dockerode`. Host networking and storage through the system tools' machine-readable interfaces (`ip -j`, `nft -j`, `wg`, `drbdsetup events2`, `birdc`), since Node has no native netlink / nftables libraries. This needs strict error handling and integration tests against real kernels, which the multi-site lab (section 7) provides.
  - gRPC (node stream, Envoy xDS server in the control plane) via `@grpc/grpc-js` with the Envoy protos.
  - Footprint: roughly 50-80 MB RAM per node for the agent; covered by the capacity checks.
  - Shared TypeScript types between control plane, agent, CLI and MCP server (policies, plans, health states).
  - **Only exceptions**: the thin OS tunnel helpers of the desktop app (C / Swift where the OS requires it, 3.31) and the thin native Capacitor plugins / tunnel extensions of the mobile apps (Kotlin / Swift, 3.33). Prebuilt third-party libraries (e.g. `wireguard-android`, which contains wireguard-go internally) are dependencies, not our code; the "no Go" rule is about code we write and maintain.
- **decided** **CLI in TypeScript**, also built as SEA binaries (Linux / macOS / Windows, amd64 / arm64) and published on **npm**; distributed via GitHub releases, an install script, Homebrew, a deb / rpm repo and a container image. Signed (cosign) with checksums.
- **decided** **MCP server**, built with the repo's existing MCP tooling (`apps/shared/mcp-devkit`):
  - **`loadweaver mcp`** in the CLI (stdio, uses the user's login / PAT) for local agents;
  - a **remote MCP endpoint** on the API (streamable HTTP, PAT / OAuth) for hosted agents, including Agenstra agents.
  - Both use the same access rules, approvals and audit (3.17): agents can read state, query logs / metrics, create plans and request approvals, but never bypass them.
- **decided** Licensing and tiers like Agenstra (see the Agenstra pricing page: AGPL-3.0 open source, BUSL-1.1 Startup / Business, commercial Enterprise, managed Cloud), with the line drawn at **multi-site**:

  | Tier        | License                            | Price                                          | Scope                                                                                                                                                                                                              |
  | ----------- | ---------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | Open Source | AGPL-3.0                           | free                                           | Full **single-site** cluster incl. HA, groups / policies, compose, migration, map, logs                                                                                                                            |
  | Startup     | BUSL-1.1 with Additional Use Grant | free (< €2M total finances / year)             | Adds **multi-site**: cross-site BGP, own ASN / multi-homing / anycast (3.27), cross-site storage replication, site failover                                                                                        |
  | Business    | BUSL-1.1 with Additional Use Grant | flat monthly, like Agenstra Business (€499/mo) | Includes Startup, for ≥ €2M; onboarding, standard support                                                                                                                                                          |
  | Enterprise  | Commercial                         | on request                                     | Includes Business; priority support, SLA, custom development                                                                                                                                                       |
  | Cloud       | managed                            | via Decabill                                   | Loadweaver operated by us, **in the MVP**: a **dedicated cluster per customer** (own control plane, nodes, keys), provisioned via Decabill's `loadweaver` service kind, operated through the multi-cluster console |

- **decided** **How the split works, exactly like Agenstra**: **all features are public source; nothing is closed.** The license is set **per component** (the repo default is MIT; each app / lib carries its own `LICENSE`, see the repo README):
  - single-site components (node agent, single-site control plane, console basics) under **AGPL-3.0**, like Agenstra's `backend-agent-manager`;
  - multi-site components (cross-site orchestration, multi-site storage replication, site failover, own-ASN BGP / multi-homing / anycast, fleet console) under **BUSL-1.1 with Additional Use Grant** (free production use below €2M total finances / year), like Agenstra's `backend-agent-controller`. Each BUSL release **converts to AGPL-3.0 three years** after its release;
  - landing page and docs **source-available** (viewing only), like the other products.
    The commercial limitation therefore comes from the license terms, not from hidden code.
- **decided** Pricing is **flat per tier**, not per node / cluster / site. That keeps the "start with one node and grow" story free of node counting and per-node license enforcement.
- Bundled third-party components and their licenses, to keep in mind: Envoy (Apache-2.0), OpenSearch (Apache-2.0), BIRD (GPL-2.0), bind9 (MPL-2.0), DRBD (GPL-2.0, kernel module + utils), Patroni (MIT), Garage (AGPL-3.0), Trivy (Apache-2.0), Coraza + OWASP CRS (Apache-2.0), wireguard-nt (GPL-2.0 driver / MIT-licensed embeddable parts, to check), WireGuardKit (MIT), wireguard-android (Apache-2.0), Ionic / Capacitor (MIT), CRIU (GPL-2.0, separate tool), DB-IP Lite (CC BY 4.0, attribution required), cosign (Apache-2.0), Distribution registry (Apache-2.0), etcd (Apache-2.0), TimescaleDB (Apache-2.0 core, some features under the Timescale License). Shipping them as separate components next to our AGPL / BUSL code is fine; we must not link GPL code into our own binaries.

---

## 6. Engineering principles & quality gates

Applies to **every implementation step** of Loadweaver, independent of the feature. Builds on what the repo already has: `.agenstra/rules/` (coding standards, architecture patterns, SOLID, testing strategy, security standards, code review, NestJS / Angular / TypeScript), `.agenstra/agents/` (architect, security, testing), `.agenstra/commands/` (code-review, impact, test-strategy), the Forepath Nx generators, the PR checks in `.github/workflows/pull-request-checks.yml` (affected detection, lint, format, commitlint, knowledge-graph blast radius) and the security tooling (Trivy, SBOMs, release integrity).

**Reuse & patterns**

- **decided** **Existing patterns are kept**: Nx generators for every new app / lib (`@forepath/code`), domain `loadweaver` (`apps/loadweaver/*`, `libs/domains/loadweaver/*`) with the usual `domain:` / `scope:` / `type:` tags and boundaries, the `.agenstra` rules for code, architecture and tests.
- **decided** **Reuse or extend shared libraries before writing new code**, e.g. `ui-components` (`fpc-*`, brands, chart theme), platform authentication, `util-file-storage`, background jobs, OpenTelemetry module, notifications / updates features, provider plugins, MCP tooling, Agenstra's terminal / file / egress / isolation concepts, Decabill's Cloudflare DNS, usage meters, file explorer and report jobs. New code instead of reuse needs a written reason in the PR.
- **decided** **UI: `fpc-*` components first.** Every Loadweaver screen (web, desktop, and mobile where they fit) is built from the shared `ui-components` (`fpc-*`). Components Loadweaver needs that don't exist yet (e.g. the Cytoscape canvas wrapper, query builder, widget board, progress rings, log explorer, terminal panel) are added **to the shared `ui-components` lib as new `fpc-*` components with Storybook stories and all brands**, not as app-local components, so Agenstra and Decabill can use them too. App-local components only for things that are truly Loadweaver-specific, and with a reason in the PR. On mobile, Ionic components are used only where no `fpc-*` component fits the mobile interaction (3.33).
- **decided** When a **shared lib is extended**, every product using it is part of the verification (see below), so Agenstra, Decabill and ForePath never regress because of Loadweaver.
- **decided** Cross-project changes check the **blast radius** via the knowledge graph (as the code-review rule already requires).

**Dependencies: exact versions only**

- **decided** Every new npm dependency is installed with **`--save-exact`** (e.g. `npm install --save-exact <pkg>`), so `package.json` gets exact versions, never `^` / `~` ranges. This applies to every package Loadweaver adds (e.g. Ionic / Capacitor, `@grpc/grpc-js`, `dockerode`, Cytoscape.js, Electron update tooling, MCP SDK).
- **decided** The same rule for everything outside npm:
  - **native mobile / desktop**: exact versions in Gradle (Android, `wireguard-android`) and Swift Package Manager (iOS / macOS, WireGuardKit), no dynamic or range versions;
  - **container images**: pinned by **digest** (3.22);
  - **third-party components on the nodes** (Envoy, BIRD, DRBD, Garage, OpenSearch, Postgres, ...): pinned in the **release bundle** (3.26);
  - **OS packages**: identical versions via the cluster-local apt cache (3.26).
- **decided** The repo's `.npmrc` stays as it is and applies to all Loadweaver dependencies:
  - **`ignore-scripts=true`**: install scripts never run. Dependencies that need a build / download step (e.g. Electron's binary, native modules) are handled **explicitly the same way the repo already handles Electron**, never by enabling scripts globally. Pattern: the shared composite action `.github/actions/setup-env/action.yml` has an **"Electron binary install"** step that runs the package's own install script in its `node_modules` folder (`working-directory: ./node_modules/electron`, `npm run postinstall || node install.js`). Each new dependency that needs this gets **its own explicit, package-scoped step** there (and the equivalent documented command for local setup). New steps **fail loudly**: unlike the existing Electron step's trailing `|| true`, they don't swallow errors, in line with "skipped checks are never allowed". New dependencies that only work with install scripts are avoided where an alternative exists.
  - **`min-release-age=7`**: versions younger than 7 days aren't installed (supply-chain protection). Since exact versions are pinned anyway, this simply means updates land at least a week after release. For an **urgent security fix**, the 7-day wait is accepted by default; bypassing it requires an explicit, reviewed exception, recorded in the PR.
- Note: `.npmrc` has no `save-exact`, which is why `--save-exact` must be passed explicitly on every install.
- **decided** Lockfiles are committed; dependency updates are deliberate changes that go through the full verify loop below (including regression tests and Trivy).
- Note: the root `package.json` currently has a few range-versioned entries (e.g. `@swc/helpers`, `@agentclientprotocol/sdk`); Loadweaver doesn't add more, and changing the existing ones is outside this plan.

**Verify loop (definition of done)**

- **decided** After **every** change, the **full gate** runs:
  1. format, lint, typecheck, build;
  2. **unit, integration and e2e tests** (Playwright) for **all Nx-affected projects**, including other products when shared libs change (**regression protection**);
  3. **self-rated code security review** using the security agent's rubric (critical / high / medium / low): injection, authN / authZ, secrets, crypto, SSRF, deserialization, race conditions, sensitive data in logs, ... This is a review of **our code**, separate from and in addition to Trivy;
  4. **code review** against the `.agenstra` rules (reuse, SOLID, patterns, error handling, performance);
  5. docs updated (`frontend-docs`, OpenAPI, JSON Schemas).
- **decided** **Any failure or any finding of medium or higher → fix → run the whole gate again.** A change is only done when **everything is green and no medium-to-critical finding is left**.
- **decided** **Skipped or disabled checks are never allowed** to reach "done".
- **decided** **Escalation instead of a silent stop**: if the loop hasn't converged after **5 rounds** (e.g. a fix keeps breaking something else), it stops and reports which checks still fail, which findings remain, what was tried, and a proposed way out (e.g. redesigning the unit). It is never marked done in that state.

**Security findings**

- **decided** **Medium, high and critical findings are always fixed.** No exceptions, no risk acceptance.
- **decided** **Low findings** may be accepted only as an entry in an **accepted-risks register** in the existing format (ID, area, configuration, rationale, acceptance and review date), like `docs/agenstra/security/accepted-risks.md`. Product constraints (like AR-001) go through the same register.
- **decided** Trivy (dependencies, images, secrets, misconfig), SBOMs and release integrity run as in the other products, on top of the self-rated review.

**Loadweaver-specific test levels** (on top of the repo's 70 / 20 / 10 pyramid)

- **decided** **Multi-site lab** on real VMs with real kernels: WireGuard, DRBD, LUKS, nftables, BIRD peering with test upstreams (incl. RPKI), IPv4 / IPv6, provider failover IPs, DNS providers.
- **decided** **Chaos tests**: kill nodes, partition sites, fill disks, break DNS providers / upstream sessions, asserting P8 and the health tree.
- **decided** **Upgrade tests** N-1 → N, including step rollback and failed-rollback handling (3.19, 3.26).
- **decided** **Timing tests** for migration, failover and DNS failover against the recovery times the plan promises (3.12, 3.28).
- **decided** **Scale tests** up to ~1,000 (partly simulated) nodes per release (3.34).
- **decided** **Policy compiler property tests**: the compiled tunnels / routes / rules equal the policies, never more (never transitive, 3.3).
- **decided** Lab and chaos suites run **per milestone** and **before every release**; unit / integration / e2e run on every change.

---

## 7. MVP scope

- **decided** **Multi-site from day one.** The MVP fully matches the landing page promise.
- **decided** MVP contents:
  - Node join / leave from 1 node upwards (no node cap, target ~1,000 per cluster, route reflectors / per-site hubs / dedicated data node groups as the cluster grows, 3.34), control plane growing to 3 / 5, optional witness for 2 nodes, capacity checks with workload selection on shrink.
  - WireGuard tunnels and **BIRD / BGP**, both compiled from groups and policies; policy-aware DNS; stable service IPs.
  - DRBD volumes, sync in site, **async across sites**.
  - Compose deployments with migration (v1 target, 3.10), drain on node leave, failover on node loss, **site failover opt-in**.
  - Ingress (L7 + L4) with failover IP via VRRP, BGP and provider APIs, built-in ACME.
  - DNS management via the unified provider interface: Cloudflare and hosted bind9 (cluster from 2 nodes), zones with one primary and optional secondary providers.
  - Envoy node proxies: egress, ingress, **east-west L7 with mTLS**.
  - Plan / apply with failure analysis, per-resource locks, drift handling.
  - Logs (OpenSearch), metrics / flows (TimescaleDB), topology map with live, timeline and plan views.
  - Projects, project and cluster roles, approvals, cross-project acceptance, quotas, PATs (3.17).
  - Backup management: recovery kit (Shamir shares) + optional KMS escrow, object lock with delayed, approved deletion, backup catalog with self-service restores and quotas, cross-cluster restore / cloning via fleet (3.20).
  - Backups to built-in Garage + external targets, PITR for the control plane, restore tests, cluster DR (3.20).
  - Moved in from the former after-MVP list: custom dashboards (3.18), DNSSEC and anycast name servers (3.15), weighted / geo / latency DNS steering (3.28), live migration with automatic fallback (3.10), Agenstra step 2 with per-workspace runtimes (section 4), mobile posture via MDM (3.31), Loadweaver Cloud with a dedicated cluster per customer (section 5).
  - Ionic mobile apps (iOS / Android): mobile console, push alerts, approvals, tunnel (WireGuardKit / wireguard-android), posture with app attestation + MDM, App Store / Play Store / MDM distribution (3.33).
  - Shared desktop release pipeline: macOS signing + notarization, Windows Authenticode, GPG-signed Linux repos, in-app auto-update (stable / beta) for Loadweaver and Agenstra Desktop, AR-001 retired (3.32).
  - Remote access: user and machine clients, office site-to-site, `vpn` gateway group, self-service enrollment with expiring keys, split / full tunnel, signed desktop app with own tunnel, posture incl. Intune / Jamf / Kandji / Defender / CrowdStrike / SentinelOne / certificates, official apps for mobile (3.31).
  - Canvas layers (DNS, addressing, routing, tunnels, certificates, storage, policies / traffic), semantic zoom + side panel, external side at the border, path trace tool (3.9).
  - Cluster / project / fleet overview with explained health tree, SLOs and status pages, context + global search, wallboard, periodic reports into a file tree (3.25).
  - Decabill service kind `loadweaver` (single-node cluster via cloud-init; further nodes with the customer's own provider tokens; data-safe teardown) (section 4).
  - Plan bot for GitHub and GitLab: sticky plan / drift / failure-analysis comments, comment-triggered applies (merge does nothing), locks, auto-merge after apply, role-checked commands (3.30).
  - Configuration in Git for everything declarative: per-scope repos, PR or bidirectional mode, secret references / SOPS, merge reviews as approvals (3.29).
  - DNS failover per hostname / port forward: failover and healthy multi-value modes, multi-site probes with quorum, automatic fail-back, low TTLs with RTO estimates, all providers updated and verified (3.28).
  - External BGP with own ASN / prefixes, RPKI-strict filtering, BFD, graceful shutdown, public IPAM incl. PTR, egress SNAT from own prefixes, anycast / primary-backup per policy, edge node group (3.27).
  - Ingress rate limits + optional WAF, required resource requests with project defaults, TypeScript CLI + MCP server (local + remote), Electron desktop app.
  - Signed release bundles, cluster-local distribution (air-gap capable), canary / wave rollout with health gates and auto-rollback, expand / contract migrations, update policy with maintenance windows (3.26).
  - Dual-stack IPv4 / IPv6, one-off and cron jobs, horizontal autoscaling (3.23).
  - Multi-cluster console, Terraform provider, usage metering for Decabill, docs app and loadweaver.com (3.24).
  - Built-in registry / pull-through cache, digest pinning, image scanning and signature policies, envelope-encrypted secrets, always-on volume encryption (3.22).
  - Debian / Ubuntu bootstrap, join of existing Docker hosts with import wizard, rolling upgrades as plans (3.21).
  - Live plans / applies with automatic rollback, container terminals (node shell opt-in), file browser for volumes and container filesystems, CLI port-forward (3.19).
  - Curated graphs per entity, global filter bar with saved views, hash-chained audit log, retention, built-in + custom alerts, Prometheus / OTLP / SIEM export (3.18).
- **decided** After the MVP: Gitea / Forgejo plan bot adapter (3.30).
- **decided** Order of work: **risk first**. Each milestone ends with a test in a multi-site lab:
  1. **M1** TypeScript node agent (SEA, systemd), bootstrap on Debian / Ubuntu and node join / leave (3.21), control plane growth (1 → 3 → 5, witness), dual-stack networking, WireGuard + BIRD compiled from groups / policies, nftables, DNS resolver. The biggest technical risk.
  2. **M2** Secrets and master key (3.22), DRBD volumes with LUKS (Docker volume plugin, sync / async), built-in registry, compose translation incl. jobs, migration, drain, failover on node loss.
  3. **M3** Ingress (L7 + L4), IP failover via VRRP, BGP and provider APIs, external BGP with own ASN, public IPAM, edge nodes (3.27), DNS failover incl. weighted / geo / latency steering (3.28), DNSSEC and anycast name servers (3.15), ACME, DNS providers (Cloudflare, hosted bind9, multi-provider zones).
  4. **M4** Envoy node proxies: egress, east-west L7 with mTLS, workload identities, image policies; remote access gateways, client groups, enrollment, site-to-site (3.31).
  5. **M5** Plan / apply with failure analysis, locks, approvals and automatic rollback; overview, health tree, SLOs, search, wallboard (3.25); custom dashboards (3.18); projects / roles / quotas (3.17); live plans, terminals, file browser, tunnels (3.19); Git configuration (3.29); plan bot (3.30); UI: topology map (live / timeline / plan), graphs, filters, logs, audit, alerting, export (3.18).
  6. **M6** Operations: live migration with fallback (3.10), Agenstra runtime on Loadweaver (section 4), update rollout (3.26), backups / DR with Garage (3.20), periodic reports and status pages (3.25), import of existing Docker hosts and rolling upgrades (3.21), autoscaling (3.23).
- **decided** **Milestone P** (after the MVP): the postponed concepts in section P, starting with the app store (P1).
- **decided** In parallel to M5 / M6, because they only need a stable API: desktop app tunnel helpers, shared desktop release pipeline incl. Agenstra Desktop (3.32), Ionic mobile apps (3.33), posture integrations incl. mobile via MDM (3.31), Loadweaver Cloud operations (section 5), multi-cluster console, Terraform provider, usage metering, docs app and loadweaver.com (3.24).
- Note: that is a big first release, and it grew with 3.20-3.24. M1, M3 (cross-site BGP failover) and M4 (east-west mTLS) carry most of the technical risk, so they come first; the parallel track keeps the product surface from delaying them.

---

## P. Milestone P: postponed (concept decided, implemented after the MVP)

**Milestone P** is the first milestone **after the MVP** (after M6 and the parallel track). Its concepts are decided now and implemented then. (The smaller after-MVP items stay in section 7.)

### P1. App store

A catalog of apps that can be deployed into a Loadweaver cluster with a few clicks. First apps: **Agenstra** and **Decabill**, more added over time.

- **Revises section 4 once implemented**: section 4 keeps the Agenstra controller / console and Decabill off Loadweaver for the MVP. With the app store, both become installable apps on Loadweaver.
- **decided** The app store is an **additional** way to deploy Agenstra and Decabill, **never a replacement**. **All existing deployment variants stay available and supported**:
  - **self-hosted Docker Compose** (the apps' own `docker-compose.yaml` setups and deployment docs);
  - **bare-server provisioning via Decabill's bundled stacks** (`agenstra-controller`, `agenstra-manager`, `decabill-billing`, see [server-provisioning.md](../docs/decabill/features/server-provisioning.md#bundled-product-stack));
  - **Agenstra Cloud** (managed);
  - Agenstra's agent-manager with the **Docker-host runtime** next to the Loadweaver runtime (section 4).
- **decided** App store packages are built from the **same images and versions** as the other variants (one release, several deployment channels), so no variant falls behind.

**Catalogs**

- **decided** An **official ForePath catalog** (Agenstra, Decabill first; curated and signed by ForePath).
- **decided** **Private catalogs**: companies / hosters add their own Git repo or OCI registry as a catalog for internal apps.
- **decided** A **community catalog from the start** (third-party submissions, see below).
- **decided** Every catalog is a source the **cluster admin enables**; projects only see enabled catalogs, and admins decide **which trust labels** their projects may install.

**Package format**

- **decided** An app is **Docker Compose with `x-loadweaver`** (it is just a deployment, P7) plus a **manifest**: version; parameters with JSON Schema (rendered as the install form); required secrets; dependencies (e.g. the Agenstra controller needs Postgres / Redis / OpenSearch, bundled or provided); suggested groups, policies, ingress and DNS; backup policies; health checks; upgrade migrations; license and docs links.
- **decided** Published as **signed OCI artifacts** (cosign) in the registry (3.22); images pinned by digest; exact versions throughout (section 6).

**Lifecycle: everything as plans, Git-able**

- **decided** **Install** = form → **plan** (failure analysis, quotas, policies, DNS) → apply. The installed app is a **normal deployment** (YAML, Git, plan bot, 3.29, 3.30).
- **decided** **Updates** show up as available versions per channel and run as **plans** with the manifest's migrations and a **backup first**; rollback as usual (3.19).
- **decided** **Uninstall** asks what to do with the data (keep volumes, final backup, or delete) and **never deletes silently**.

**Community apps: trust model**

- **decided** Publishers submit via **pull request** to the community catalog repo and sign their packages with their own cosign identity.
- **decided** **Automated checks** on every submission: manifest / JSON Schema validation, Trivy scan of all images, signature verification, policy lint (e.g. no host networking or privileged containers without a declared reason, no plaintext secrets), and a **test install in a sandbox cluster**.
- **decided** Then a **human review** before listing.
- **decided** **Trust labels**: **Official** (ForePath), **Verified publisher**, **Community**.
- **decided** Users can **report** apps; a **takedown** removes the app from the catalog and flags installed copies in affected clusters.

**Licensing**

- **decided** **Free apps only**: the store lists free / open-source apps and free tiers (e.g. Agenstra's AGPL / free Startup tier). Commercial licenses are handled **outside** the store; Loadweaver doesn't become a payment or license platform.

---

## 8. Open questions (to discuss next)

None right now. New questions go here.

---

## 9. Decision log

---

| Date       | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ------------------ |
| 2026-10-17 | Initial notes collected: Docker base, gVisor runtime mgmt, WireGuard/BIRD networking, shared storage, Agenstra-style proxy with selectors, plan/apply/lock, topology map, IP failover for web + L4, workload migration.                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2026-10-17 | Nodes join groups that share networking; group-to-group communication is granted like AWS security groups. "Everything is a policy": routing, tunneling and filtering all derive from group policies (P6, 3.3).                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2026-10-17 | Topology map shows live traffic flow. Postgres plus InfluxDB for time-based data. Deployments are Docker Compose projects and must be seamlessly migratable (P7). One host failing must not take apps down unless a policy pins data, deployment or traffic, and the plan warns about pins up front (P8).                                                                                                                                                                                                                                                                                                                        |
| 2026-10-17 | All logs (containers, proxy, routing, tunnels, ingress, ...) viewable in UI and backend API, scoped to deployment and other entities (P9, 3.14).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-10-17 | Groups: node + workload groups, allow-only between groups (deny only in proxy), standalone policies, never transitive (3.3).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2026-10-17 | Single node is a valid setup; nodes join/leave freely; no data loss on leave unless capacity is missing, then user picks workloads to keep and over-capacity selections are locked. Control plane on 3/5 designated nodes, Postgres Patroni-style (3.2).                                                                                                                                                                                                                                                                                                                                                                         |
| 2026-10-17 | TimescaleDB on the Postgres cluster instead of InfluxDB (3.13). OpenSearch as log store (3.14).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2026-10-17 | 2 nodes: optional witness for automatic failover, otherwise manual confirm. Storage: own DRBD-like replicated volumes as Docker volume plugin, sync in site / async across. Failure domain: node by default, site opt-in (3.2, 3.5, 3.12).                                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-10-17 | Per-node subnets + stable service IPs; policy-aware cluster DNS; node-level proxy; east-west L7 filtering from the start (3.4, 3.7).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2026-10-17 | Transparent mTLS between node proxies with workload identities; Envoy for all L7; deny wins; built-in ACME with certs in the control plane (3.6, 3.7).                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2026-10-17 | YAML definitions; API is source of truth, Git optional; per-resource locks; auto-heal runtime drift, report external changes as proposed plans (3.8).                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2026-10-17 | Migration v1: zero downtime with replicas, short stop otherwise; compose translated to Docker API; pins acknowledged in config with reason; OpenSearch on control-plane nodes (3.10-3.14).                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-10-17 | Agenstra: agent-manager as Loadweaver deployment first, Loadweaver scheduling later. NestJS + Angular control plane, Go node agent, licensing like Agenstra. MVP is multi-site from day one (4-6).                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2026-10-17 | Loadweaver orders nodes via a shared provider lib; Decabill keeps billing. Tiers like Agenstra with the open source / paid line at multi-site; flat pricing per tier. Milestones risk first (M1-M5).                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2026-10-17 | DNS management through a unified provider interface (like provisioning); Cloudflare supported; cluster can host its own bind9, clustered from 2 nodes (3.15).                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2026-10-17 | DNSSEC opt-in per zone after the MVP; multi-provider zones (one primary, optional secondaries via API or AXFR) in the MVP (3.15).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-10-17 | Console builds on the existing console concepts and shared `fpc-*` components, with the Loadweaver gold (`#FFC21A`) and logo as its brand (3.16).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-10-17 | Topology map with Cytoscape.js; Loadweaver warning color shifted towards orange to stay distinct from the gold primary (3.16).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 2026-10-17 | Access: auth like Agenstra; projects inside a cluster as access unit; project roles admin / operator / developer / viewer; cluster roles admin / infra operator / auditor; developer plans need approval (configurable four-eyes); cross-project policies need both sides; quotas per project; memberships change directly via API, audited (3.17).                                                                                                                                                                                                                                                                              |
| 2026-10-17 | Data: flows aggregated on the node every 10 s, raw only for denies / on demand; metrics 10 s → 1 min → 1 h; curated graphs per entity, custom dashboards later; one global filter bar in the URL with saved views; audit log in Postgres, transactional, append-only, hash-chained; tiered retention; built-in + custom alerts as policies; Prometheus / OTLP / SIEM / CSV export (3.18).                                                                                                                                                                                                                                        |
| 2026-10-17 | All remaining candidates accepted as written (policy model details, routing / failover, proxy model, DNS interface and operations, map, migration mechanics, compose mapping, failure analysis, logs, UI, access and metrics / audit details, MVP and after-MVP scope).                                                                                                                                                                                                                                                                                                                                                          |
| 2026-10-17 | Live: Socket.IO to the browser, outbound mTLS gRPC stream from each node; live plan / apply progress per resource with map overlay; automatic rollback, failed rollbacks shown as real state with fix-forward plan; container terminals, node shell opt-in for cluster admins; session metadata always audited, full recording per policy; file browser for volumes and container filesystems with warned writes; CLI port-forward (3.19).                                                                                                                                                                                       |
| 2026-10-17 | Backups: built-in Garage object storage on the cluster + optional external targets (missing off-cluster copy = pin); everything incl. logs and metrics, per data type (snapshots, WAL / PITR, OpenSearch snapshots), schedules as policies, restore tests, cluster DR (3.20).                                                                                                                                                                                                                                                                                                                                                    |
| 2026-10-17 | Nodes: Debian / Ubuntu LTS, amd64 / arm64, one-line join; any Docker host (incl. former Loadweaver nodes) can join via discovery + import wizard + one plan; rolling upgrades of Loadweaver and OS as plans (3.21).                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2026-10-17 | Built-in registry as pull-through cache + private registry on Garage, digest pinning; Trivy scans and signature / CVE policies (monitor / enforce); envelope-encrypted secrets with split master key or external KMS, tmpfs delivery, rotation as plans; all volumes always encrypted (LUKS under DRBD) (3.22).                                                                                                                                                                                                                                                                                                                  |
| 2026-10-17 | Dual-stack IPv4 / IPv6 incl. IPv6-only nodes; one-off and cron jobs via compose; horizontal autoscaling in the MVP within quota / capacity (3.23). Multi-cluster console, Terraform provider, usage metering for Decabill, docs and loadweaver.com all in the MVP (3.24).                                                                                                                                                                                                                                                                                                                                                        |
| 2026-10-17 | Milestones redistributed (risk-first order kept): bootstrap into M1, secrets / LUKS / registry / jobs into M2, image policies into M4, new M6 for backups, import, upgrades, autoscaling; fleet console, Terraform, metering, docs and site as a parallel track (6).                                                                                                                                                                                                                                                                                                                                                             |
| 2026-10-17 | Overview with health headline, needs-attention inbox, summary bar, mini map; explained health tree with rule-based roll-up; customization as in 3.18; SLOs + optional status pages; context search + global command palette; fleet cards + merged inbox; wallboard with read-only token; periodic reports like Decabill's DATEV export into a file tree via `util-file-storage` (3.25).                                                                                                                                                                                                                                          |
| 2026-10-17 | Ingress rate limits + optional Coraza WAF as policies; required resource requests with project defaults; Electron desktop app like Agenstra (3.6, 3.11, 3.16).                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 2026-10-17 | **No Go**: node agent and CLI in TypeScript as Node SEA binaries (agent as systemd service), replacing the Go node agent; MCP server in the CLI (stdio) and as remote endpoint on the API (section 5).                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2026-10-17 | Update rollout: one signed release bundle, downloaded once into the cluster (air-gap import, local apt cache); control plane first, canary, health-gated waves within the failure domain, auto-rollback per step; expand / contract migrations; per-cluster update policy with security auto-updates in maintenance windows (3.26).                                                                                                                                                                                                                                                                                              |
| 2026-10-17 | External BGP: own ASN + prefixes, multi-homed per site; peers and announcements as policies compiled into BIRD; RPKI-strict, max-prefix, bogons, BFD, graceful shutdown; default / partial table for egress with SNAT from own prefixes; built-in public IPAM with PTR; anycast or primary / backup per policy; edge node group with WireGuard forwarding (3.27).                                                                                                                                                                                                                                                                |
| 2026-10-17 | Licensing clarified: all features public source, license per component like Agenstra (AGPL single-site, BUSL-1.1 multi-site incl. own-ASN BGP, converting to AGPL after 3 years) (section 5).                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2026-10-17 | DNS failover as an exposure option per hostname / port forward (suggested by the plan when an IP can't float); failover + healthy multi-value modes; multi-site probes with quorum and hysteresis; automatic fail-back after a stable period (manual optional); 30 s TTL with RTO shown; own engine always decides, provider features as accelerators; all providers updated and verified; L4 allowed with warnings (3.28).                                                                                                                                                                                                      |
| 2026-10-17 | Git configuration moved into the MVP and covers everything declarative (not runtime actions, secret values, live state); per scope 'Git authoritative' (UI edits become PRs) or bidirectional (UI changes committed back); secret references in Git, SOPS optional, plaintext rejected; repo per scope, GitHub / GitLab / Gitea / plain Git; merge reviews can count as approval; access as code optional (3.29).                                                                                                                                                                                                                |
| 2026-10-17 | Plan bot for GitHub (App) and GitLab (integration) in the MVP, Atlantis-style: auto-plan on PR, sticky comment with plan, pins, failure analysis, capacity, image results and drift; applies only by comment, merge does nothing, auto-merge after successful apply; unapplied merges / direct pushes show as drift; commands plan / apply / unlock / approve / drift mapped to Loadweaver roles via linked accounts (3.30).                                                                                                                                                                                                     |
| 2026-10-17 | Engineering principles (P10, section 6): keep existing patterns and reuse / extend shared libs; full verify gate after every change (lint, build, unit / integration / e2e for all affected incl. other products, self-rated security review, code review, docs), looping until green with no medium+ findings, escalation after 5 rounds; medium+ always fixed, low only via accepted-risks register; lab, chaos, upgrade, timing and policy property tests. Desktop app update note aligned with AR-001.                                                                                                                       |
| 2026-10-17 | Decabill gets a `loadweaver` bundled service kind provisioning a single-node cluster (control plane + console + node agent); further nodes ordered by Loadweaver via the provider lib and billed by Decabill via metering. Agenstra on Loadweaver stays agent-manager only; Agenstra controller / console and Decabill keep their own servers (section 4).                                                                                                                                                                                                                                                                       |
| 2026-10-17 | Decabill-provisioned Loadweaver: Decabill deploys and bills only the initial node (control plane + console); further nodes use the customer's own provider tokens inside Loadweaver like Agenstra, bounded by Loadweaver quotas and paid to the provider directly, no Decabill metering for them; removal drains first; cancellation runs final backup and a read-only grace period before deleting only the Decabill-provisioned server (section 4). Supersedes 'further nodes billed by Decabill via metering'.                                                                                                                |
| 2026-10-17 | Correction: provider tokens for further nodes work exactly like Agenstra: mainly the user's own keys in the cluster, but they can also be set at ordering time in Decabill (order fields, encrypted admin defaults / operator defaults) and are passed in during provisioning (section 4).                                                                                                                                                                                                                                                                                                                                       |
| 2026-10-17 | Canvas shows everything network-related as switchable layers (DNS, addressing, routing, tunnels, certificates, storage, policies / traffic) with role presets; semantic zoom, tooltip + side panel with actions; external systems at the border; path trace tool in live / plan / timeline views; entity overviews also for BGP peers / prefixes, IP pools, certificates (3.9, 3.18).                                                                                                                                                                                                                                            |
| 2026-10-17 | Node join stays join-token only (one-liner or cloud-init), no SSH-based bootstrap; host requirements written down: supported OS, root / sudo, outbound to control plane, WireGuard UDP reachability (3.21).                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2026-10-17 | Join over pre-existing tunnels: usable as bootstrap path, agent switches make-before-break to its own WireGuard tunnel; the old tunnel is ignored entirely afterwards; port / subnet / route conflicts detected in discovery and resolved in the join plan, Loadweaver nftables in own tables (3.21).                                                                                                                                                                                                                                                                                                                            |
| 2026-10-17 | Remote access: user devices (IdP groups → client groups) and machine clients, offices as site-to-site machine clients; `vpn` gateway group behind one endpoint name; self-service enrollment, device-generated expiring keys renewed after SSO + MFA, instant revoke; split tunnel default, full tunnel per policy; user-attributed logs, canvas, sessions, alerts (3.31).                                                                                                                                                                                                                                                       |
| 2026-10-17 | Desktop app runs its own tunnel via OS-native WireGuard helpers (kernel / wireguard-nt / WireGuardKit, no Go) and is code-signed with its own pipeline (AR-001 unchanged for Agenstra); mobile via official WireGuard apps with unknown posture; extensive posture in the MVP: core checks + Intune, Jamf, Kandji, Defender, CrowdStrike, SentinelOne, device certificates, failing posture → restricted group (3.31).                                                                                                                                                                                                           |
| 2026-10-17 | Former after-MVP items moved into the MVP: custom dashboards (YAML resources, query builder), DNSSEC (auto signing, rollovers gated on verified DS), anycast name servers, weighted / geo (DB-IP Lite default, MaxMind optional) / latency DNS steering, live migration (CRIU / gVisor, eligibility per service, automatic fallback), Agenstra step 2 (runtime abstraction, Docker host or Loadweaver per workspace, Envoy-compiled egress with identical semantics), mobile posture via MDM, Loadweaver Cloud (dedicated cluster per customer). Still after the MVP: Gitea / Forgejo bot, desktop auto-update, own mobile apps. |
| 2026-10-17 | Shared desktop release pipeline for all ForePath Electron apps (Apple signing + notarization, Authenticode, GPG-signed Linux repos, checksums kept); Agenstra Desktop switches together with Loadweaver Desktop; in-app auto-update (stable / beta, verified) for both, moving Loadweaver auto-update into the MVP; AR-001 retired once live (3.32).                                                                                                                                                                                                                                                                             |
| 2026-10-17 | Mobile apps with Ionic + Capacitor + Angular in the MVP: mobile console (push alerts, approvals, logs, canvas) + tunnel (WireGuardKit Packet Tunnel on iOS, prebuilt wireguard-android on Android; prebuilt deps don't violate 'no Go') + posture (OS signals, App Attest / Play Integrity, MDM); App Store / Play Store / MDM distribution via the shared pipeline (3.33).                                                                                                                                                                                                                                                      |
| 2026-10-17 | Dependencies: exact versions only; new npm packages via `--save-exact`; same principle for Gradle / SwiftPM, images by digest, node components via the release bundle, OS packages via the apt cache; lockfiles committed, updates go through the verify loop (section 6).                                                                                                                                                                                                                                                                                                                                                       |
| 2026-10-17 | `.npmrc` (`ignore-scripts=true`, `min-release-age=7`) applies to Loadweaver: dependencies needing install steps handled explicitly like Electron today, never by enabling scripts; 7-day minimum release age accepted, bypass only as reviewed exception; `--save-exact` explicit since `.npmrc` doesn't set it (section 6).                                                                                                                                                                                                                                                                                                     |
| 2026-10-17 | Install-script dependencies follow the existing pattern in `.github/actions/setup-env/action.yml` (explicit, package-scoped install step like "Electron binary install"); new steps fail loudly instead of `                                                                                                                                                                                                                                                                                                                                                                                                                     |     | true` (section 6). |
| 2026-10-17 | Agenstra's progress pattern adopted 1:1 for all long-running operations (step + %, snapshot + live events, status channel for entities out of view, fpc-progress bars, stacked bars on parents, bar on the triggering button), also on canvas, mobile (incl. push on finish / failure), CLI `--watch`, plan bot comment and MCP (3.19).                                                                                                                                                                                                                                                                                          |
| 2026-10-17 | UI built from shared `fpc-*` components first; missing components are added to `ui-components` as new `fpc-*` components with Storybook stories and all brands, not app-local; Ionic components on mobile only where no `fpc-*` fits (section 6).                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-10-17 | No node cap (only the control-plane quorum is 3 / 5): target 1 to ~1,000 nodes per cluster, fleets beyond; automatic route reflectors and per-site hubs above ~16 nodes, direct tunnels only where policies need them; dedicated data node groups and per-site telemetry collectors as clusters grow; incremental failure analysis / compiler; scale tests per release; positioning 'start small, grow without limits' (P2, 3.34).                                                                                                                                                                                               |
| 2026-10-17 | Backup management: dedicated backup key hierarchy with mandatory confirmed recovery kit (Shamir shares) and optional KMS escrow, DR asks for kit first; object lock (compliance mode) with second-admin approval and delay for deletions; catalog per cluster / project with self-service restores, diffs and quotas; cross-cluster restore and cloning via fleet (3.20).                                                                                                                                                                                                                                                        |
| 2026-10-18 | Live migration keeps replica addresses (own IPAM plugin over a cluster pod supernet + host routes in BIRD): memory state and service IPs always follow, established direct / ingress connections follow, meshed (mTLS) flows reconnect via Envoy retries (3.10).                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-10-18 | Backups use Kopia (digest-pinned image) behind an append-only S3 gateway on the members: nodes never hold Garage keys, only the control plane's retention job deletes (after second-admin approval + delay); object lock on external targets (3.20).                                                                                                                                                                                                                                                                                                                                                                             |
| 2026-10-18 | Every control-plane backup carries a DR envelope (master key + control-plane environment, encrypted under the backup key, unlocked by the recovery kit or KMS escrow), so whole-cluster DR restores secrets, CA and identities (3.20).                                                                                                                                                                                                                                                                                                                                                                                           |
| 2026-10-18 | Live migration restores at the runc level (Docker's checkpoint restore is broken upstream): restored replicas run as agent-managed runc containers until their next restart, then return to Docker; gVisor services migrate stop-and-copy via runsc (3.10).                                                                                                                                                                                                                                                                                                                                                                      |
| 2026-10-18 | The append-only backup gateway is Kopia's repository server with ACLs on the members (one repository per trust boundary: cluster and each project); WAL-G and OpenSearch snapshots go through a minimal S3 gateway that enforces no-overwrite (3.20).                                                                                                                                                                                                                                                                                                                                                                            |
| 2026-10-19 | New section P (postponed: concept decided, implementation later). P1 app store: official ForePath catalog (Agenstra, Decabill first), private catalogs, community catalog from the start with PR submission, automated checks, sandbox install, human review and trust labels; apps = compose + manifest as signed OCI artifacts; install / update / uninstall as plans, Git-able; free apps only. Revises the section 4 exclusions once implemented.                                                                                                                                                                            |
| 2026-10-19 | App store is an additional channel only: self-hosted Docker Compose, Decabill bare-server stacks, Agenstra Cloud and the Docker-host agent-manager runtime all stay available; store packages use the same images and versions (P1).                                                                                                                                                                                                                                                                                                                                                                                             |
| 2026-10-19 | P is a milestone: Milestone P comes after the MVP (after M6 and the parallel track) and contains the postponed concepts, starting with the app store (P1).                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
