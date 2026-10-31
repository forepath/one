# Agenstra on Loadweaver

Agenstra's **agent manager** runs as a normal Loadweaver deployment. Its agent environments then either run on Loadweaver too (the **Loadweaver runtime**, scheduled, migrated and failed over by Loadweaver) or, as today, on the Docker of the node the manager runs on (the **Docker runtime**). The Agenstra controller and console keep running on their own servers.

The runtime is chosen per agent manager, i.e. per Agenstra workspace, with `AGENT_RUNTIME` (`docker` is the default and leaves existing installs unchanged).

| Runtime      | Environments                                            | Egress filtering                                         | Manager deployment                                     |
| ------------ | ------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------ |
| `loadweaver` | Loadweaver deployments in the workspace's project       | Loadweaver node proxies, compiled from Agenstra's policy | `compose.loadweaver-runtime.yaml` (sandboxed, no pins) |
| `docker`     | Containers on the manager's node (delegated, not drift) | Agenstra's guard sidecars (Squid)                        | `compose.docker-host.yaml` (Docker socket: a pin)      |

Both compose files are in `apps/agenstra/backend-agent-manager/loadweaver/`.

## Nodes

- All four Agenstra isolation levels work on Loadweaver. The mapping to `x-loadweaver.runtime` is explicit, 1:1 and never downgrades (or upgrades):

  | Agenstra level  | Loadweaver runtime | Environment image                                                     | Notes                                                                                                                    |
  | --------------- | ------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
  | `standard`      | `runc`             | worker image (`AGENT_DEFAULT_IMAGE`)                                  | —                                                                                                                        |
  | `sandboxed`     | `sandboxed`        | worker image                                                          | gVisor systrap with gVisor's own network stack (no `-hostnet` variant: Loadweaver's node proxy does egress, not a guard) |
  | `sandboxed-kvm` | `sandboxed-kvm`    | worker image                                                          | gVisor on its KVM platform                                                                                               |
  | `microvm`       | `microvm`          | Agenstra's microVM image (`AGENT_MICROVM_IMAGE`), run in bundled mode | QEMU microVM; commands, terminals and files go into the guest through `vm-exec` (the node agent rewrites every exec)     |

  Each environment runs at exactly its level: Loadweaver places it only on nodes where that level's probe passed ([isolation levels](../features/isolation-levels.md), [host requirements](../deployment/host-requirements.md#isolation-levels-kvm-and-microvms)). A plan without such capacity fails, and Agenstra reports the environment as not created (`E_ISOLATION_RUNTIME_FAILED`) instead of running it on another level. An unknown level or runtime name is refused the same way before anything is stored.

- **Which levels Agenstra offers.** A level is ready when **at least one schedulable node in the project's placement** (active, reachable, no witness, agent with the level's protocol features) passes its probe. The control plane aggregates this per project (`GET /api/projects/<project>/isolation-capabilities`, scope `resources:read`, which the manager's token already has); the manager's isolation probes answer from that view (cached for 60 s), so `GET /api/isolation` on the manager shows Loadweaver's real state with the per-node causes (e.g. `runtime microvm: 0 of 3 nodes ready — node-1 E_KVM_UNAVAILABLE`). The administrative switches (`AGENT_ISOLATION_SANDBOX_ENABLED`, `AGENT_ISOLATION_SANDBOX_KVM_ENABLED`, `AGENT_ISOLATION_MICROVM_ENABLED`) still apply. Capacity isn't part of the view: a ready level can still fail a plan when the nodes offering it are full.
- **MicroVM environments.** Agenstra's microVM image carries the microVM bridge label (`io.agenstra.microvm.protocol`), so Loadweaver runs it as its own launcher (bundled mode) with the launcher's fixed host settings: runc, no Docker init, all capabilities dropped except the launcher set, `no-new-privileges`, only `/dev/kvm`. The environment's compose therefore has no `cap_add`, `cap_drop`, `init` or `devices`. The workspace volume and the environment file are mounted below the launcher's `/guest` by the node agent (the compose keeps the guest's paths, e.g. `/app`). The bridge forwards OpenCode (4096) and VNC (6080) into the guest, so the manager reaches them through the environment's service address as before; the guard's loopback relay is off (`AGENSTRA_MICROVM_LOOPBACK_PORTS` empty). The guest size comes from `LOADWEAVER_ENVIRONMENT_MICROVM_CPUS` (default `2`) and `LOADWEAVER_ENVIRONMENT_MICROVM_MEMORY` (default `2g`) as compose limits. The scheduler reserves the full guest memory (memory reservation = limit, no overcommit) and `LOADWEAVER_ENVIRONMENT_MICROVM_CPU_RESERVATION` CPUs (compose `reservations.cpus`; default the CPU limit; must be greater than 0 and at most `LOADWEAVER_ENVIRONMENT_MICROVM_CPUS`, otherwise the manager refuses to start). A lower reservation packs more microVM environments per node by overcommitting vCPUs; the guest still gets `LOADWEAVER_ENVIRONMENT_MICROVM_CPUS` vCPUs. Loadweaver adds the launcher overhead (384 MiB, 0.25 CPU) to the replica's requests. New values apply to environments created afterwards; existing ones keep the size in their compose.
- **KVM on the nodes.** The node installation prepares KVM by default (KVM modules from the cluster's apt snapshot on Ubuntu where missing, the gVisor KVM runtimes). Opt a node out at install time with `--no-kvm` (or `LOADWEAVER_KVM=disabled`) and keep it out with the node spec `virtualization: { kvm: disabled }`; such nodes never offer `sandboxed-kvm` or `microvm` (the view reports them as `disabled-by-admin`, `E_DISABLED_BY_ADMIN`), and a node can only be opted out once it runs no KVM-level workloads. Host updates install the matching `linux-modules-extra` with each new kernel on Ubuntu nodes that use KVM, and re-run the isolation probes after the reboot; a node that loses KVM fails the rollout step (`kvm lost after update`). `POST /api/nodes/<node>/isolation-probe` re-probes a node on demand.
- The manager itself needs no Docker socket with the Loadweaver runtime, so it runs sandboxed as well.

## Setting up a workspace (Loadweaver runtime)

1. **Project.** A cluster admin creates one project per workspace, e.g. `agenstra-acme`, with approval mode `risky`: operators apply environment plans directly, while anything exposing the project to the internet needs an approval.
2. **Standing policies** (once per project, applied and approved by an admin; they open the internet, so they are risky by design):

   ```yaml
   apiVersion: loadweaver.com/v1
   kind: Policy
   metadata: { name: agenstra-manager-environments, project: agenstra-acme }
   spec:
     description: Agenstra - the agent manager reaches OpenCode and VNC of its environments
     from: [{ selector: { matchLabels: { agenstra.io/role: manager } } }]
     to: [{ selector: { matchLabels: { agenstra.io/role: environment } } }]
     rules: [{ protocol: tcp, ports: [4096, 6080] }]
   ---
   apiVersion: loadweaver.com/v1
   kind: Policy
   metadata: { name: agenstra-environments-manager, project: agenstra-acme }
   spec:
     description: Agenstra - environments reach the agent manager API (agent context MCP) in every egress mode
     from: [{ selector: { matchLabels: { agenstra.io/role: environment } } }]
     to: [{ selector: { matchLabels: { agenstra.io/role: manager } } }]
     rules: [{ protocol: tcp, ports: [3000] }]
   ---
   apiVersion: loadweaver.com/v1
   kind: Policy
   metadata: { name: agenstra-environments-open, project: agenstra-acme }
   spec:
     description: Agenstra - environments without filtering (off / monitor) reach the internet
     from: [{ selector: { matchLabels: { agenstra.io/role: environment, agenstra.io/egress-network: open } } }]
     to: [{ builtin: internet }]
     rules: [{ protocol: any }]
   ---
   apiVersion: loadweaver.com/v1
   kind: Policy
   metadata: { name: agenstra-environments-web, project: agenstra-acme }
   spec:
     description: Agenstra - filtered environments (enforce / offline) reach the web through the node proxy only
     from: [{ selector: { matchLabels: { agenstra.io/role: environment, agenstra.io/egress-network: filtered } } }]
     to: [{ builtin: internet }]
     rules: [{ protocol: tcp, ports: [80, 443] }]
   ```

   The same documents come from `loadweaverWorkspacePolicies(project)` in `@forepath/agenstra/shared/util-opencode-config` (`{ managerApiPort }` when the manager doesn't listen on 3000).

3. **Service user and token.** Create a user for the manager, add it to the project as **operator** (not admin), and create a personal access token for it with the scopes `projects:read resources:read plans:create plans:apply secrets:write logs:read metrics:read live:access live:exec`. The token can never exceed the user's role: the manager can change only its own project.

4. **Secrets** in the project (values never appear in plans, logs or the audit log):
   - `loadweaver-token`: the PAT from step 3;
   - `agent-manager-env`: shell-style `KEY=value` lines with the manager's own secrets (`DB_PASSWORD`, `ENCRYPTION_KEY`, `STATIC_API_KEY` or `JWT_SECRET`, `AGENT_CONTEXT_TOKEN_SECRET` for the [agent context MCP](../../agenstra/ai-agents/context-mcp.md), ...), loaded by the entrypoint from tmpfs;
   - `agent-manager-db`: the Postgres password.
5. **Deploy** `compose.loadweaver-runtime.yaml` as the `spec.compose` of a `Deployment` named `agent-manager` in the project (replace `LOADWEAVER_URL`, `LOADWEAVER_PROJECT`, the project in `AGENT_CONTEXT_MCP_MANAGER_URL` and the ingress hostname) and `loadweaver plan -f agent-manager.yaml --apply`. Exposing the manager through the ingress is internet exposure, so this plan needs an approval in `risky` mode. The ingress exposes only the controller-facing routes (`/api/agents`, `/api/egress`, `/api/config…`, `/api/health`, `/api/instance-status`, `/api/isolation`, `/socket.io`): the agent context API (`/api/agent-context`) is for environments inside the cluster and is never published.
6. In Agenstra's controller, register the manager's URL (the ingress hostname) like any other agent manager.

## How environments run

- **One deployment per environment**: `env-<agent id>` with one service `worker` and the volume `workspace` (mounted at the provider's base path, `/app`; replicated by Loadweaver, so the environment can move between nodes). Created, changed and deleted through plan + apply; the plans have the source `api` and appear in the plan history.
- **Environment variables** (OpenCode credentials, Git tokens, the workspace's variables) are one project secret `env-<agent id>-env`, mounted as Agenstra's environment file (`/etc/agenstra/environment/environment`). A change stores a new secret version and re-plans the deployment with it pinned, which recreates the container; the workspace volume stays. Nothing secret is in the compose file.
- **Reachability**: the manager talks to OpenCode (4096) and VNC (6080) at the environment's **service address** (stable across restarts, migrations and failover), allowed by the standing policy `agenstra-manager-environments`.
- **Commands** (Git, file operations, the workspace watcher) run over [machine exec](../features/terminals-files-and-tunnels.md#machine-exec) (`live:exec`): binary-safe, as the requested user, with the environment's variables, audited per command. Files the guard sidecar used to receive go through `/api/live/files`.
- **Agent context MCP**: environments reach the manager's API at its service address (`AGENT_CONTEXT_MCP_MANAGER_URL=http://api.<project>.lw:3000/api`), allowed by the standing policy `agenstra-environments-manager` and, per environment, by `env-…-egress-platform` (the guard's platform allow). Both are in-cluster allows, which no egress mode blocks (`offline` only stops traffic leaving the cluster). The worker image's `io.agenstra.context-mcp` label isn't visible through Loadweaver's API, so the manager derives it from the image content (the bundled context MCP server) once per environment and image.
- **Logs and stats** come from Loadweaver's logs API (container lines of the replica) and metrics (`replica.cpu_cores`, `replica.memory_bytes`).
- **Stop / start** set the deployment to zero / one replica; a restart is a stop and a start (the replica may come back on another node).
- **Moving between nodes** (drain, rebalancing, plan changes): environments migrate like other Loadweaver workloads ([Migration](../features/migration.md)). `standard` environments move live, `sandboxed` / `sandboxed-kvm` ones with a gVisor checkpoint. **`microvm` environments move live too** (`microvm-live (QEMU; guest connections reset: user-mode networking)`): OpenCode, running agents, their processes and memory, the workspace volume and every file the guest changed come along, and the service address stays. The guest uses QEMU's user-mode network, whose connection state stays on the old node, so **connections inside the workspace are reset** — OpenCode's outbound provider requests, Git fetches, package downloads and the manager's open OpenCode / VNC connections reconnect (an agent's in-flight model request may be retried); terminals and commands running through the manager at that moment end with `replica migrated to <node>`. The workspace volume is handed over during the short freeze (never mounted on two nodes). Environments created from a microVM image built before this release (launcher label without `bundled`) and moves to nodes whose agent doesn't report `capabilities.microvmBundledMigration` fall back to a short stop. On a Docker host (the Docker runtime) nothing changes.
- **Not available** with this runtime: the read-only workspace context mount (`/opt/workspace`, all agents' workspaces of a Docker host).

## Egress

Agenstra's effective egress policy of an environment (global → workspace → environment, with locks) becomes Loadweaver policies of its deployment, in the same plan as the environment, so it never runs unfiltered:

| Agenstra                                                     | Loadweaver                                                                                     |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `mode`                                                       | `egressMode` on a settings policy selecting the deployment (`env-…-egress`)                    |
| `deny_url_patterns`                                          | `denyUrlPatterns` (translated to RE2; untranslatable patterns fail the plan)                   |
| `block_private_networks`, `block_ip_literals`, `log_allowed` | the same settings on that policy                                                               |
| `allow_hosts` (domains)                                      | allow policy with hostname destinations on TCP 80 / 443 (`env-…-egress-allow`)                 |
| `allow_hosts` (IPs / CIDRs)                                  | allow policy with CIDR destinations on TCP 80 / 443 (`-allow-addr`)                            |
| `deny_hosts` (domains / IPs)                                 | deny policies on TCP 80 / 443 (`-deny`, `-deny-addr`)                                          |
| `network_allow`                                              | one policy per rule with CIDRs, protocol and ports (`-net-<n>`)                                |
| platform allows (agent context MCP)                          | in-cluster allow to the manager's API port in every mode (`-platform`)                         |
| environments in `off` / `monitor`                            | service label `agenstra.io/egress-network: open` (standing policy: internet on every protocol) |
| environments in `enforce` / `offline`                        | label `filtered` (standing policy: internet on 80 / 443 only, decided by the node proxy)       |

The semantics are the same as the guard's:

- `example.com`, `*.example.com` and `.example.com` match the name and its subdomains on both sides.
- Deny wins; an empty allow list means unrestricted web; explicit IP / CIDR allows lift the private-network and IP-literal blocks for exactly those addresses; the private ranges are the same list.
- URL patterns apply to plain HTTP only and are matched case-insensitively anywhere in the URL.
- `offline` lets nothing leave the cluster; `monitor` lets everything through and records what `enforce` would block.
- A table-driven property test runs the compiled rules through a real Envoy and compares every decision with Agenstra's `evaluateEgressDestination` (allowed / denied / URL pattern / offline).

Differences to know:

- Settings combine with the cluster's, the most restrictive wins: a `block_private_networks: false` doesn't loosen a cluster that blocks them, and a stricter cluster mode applies.
- An allowed IP / CIDR also lets through every hostname resolving into it, as in the guard (Squid's `dst`); Evaluate only looks at the name.
- POSIX bracket classes in URL patterns (`[[:digit:]]`) keep their POSIX meaning, as in the guard (Squid); Agenstra's own `evaluateEgressDestination` reads them as JavaScript classes.
- Agenstra domain entries with underscores can't be Loadweaver hostnames: such a policy is not applied, and the environment's egress status shows the entry.
- Changing an environment between the `open` and `filtered` classes changes its service label, which recreates its container (the workspace stays). Changes within a class (lists, patterns, `enforce` ↔ `offline`, `off` ↔ `monitor`) only change policies.

**Decisions** come back from Loadweaver's logs: the node proxy logs one line per request with the decision and the rule, the node attributes it to the environment (project, deployment, replica labels; fields `egressDecision`, `egressRule`, `egressHost`), and the manager collects them (`GET /api/logs?sources=proxy&deployment=env-…`) into Agenstra's egress events, so the controller's audit ingestion and the console views work as before. Evaluate stays on Agenstra's side.

## The Docker runtime on a Loadweaver node

`compose.docker-host.yaml` keeps today's behaviour, including the guard sidecars, but deploys the manager through Loadweaver:

- The manager binds `/var/run/docker.sock` and `/opt/agents` (the environments' workspaces): host paths are **pins**. The compose file acknowledges them (`x-loadweaver.pinned` with the reason); the plan still lists them, and without the acknowledgement it would warn about unacknowledged pins and need an explicit confirmation (and an approval in `risky` mode).
- It is pinned to one node (`placement.selector`, live migration off) and runs with `runc` (gVisor can't hand it the host's Docker).
- Containers it starts carry `io.agenstra.*` labels. The service declares them in `loadweaver.com/delegates: io.agenstra.`; the node reports such containers as **delegated** to the manager's replica, so the drift view lists them separately instead of as foreign containers, and they can't be adopted into a plan.
- Loadweaver's egress filtering and policies don't apply to these containers (they aren't Loadweaver workloads); the guard sidecars filter them as before.

## Moving a workspace between runtimes

The runtime is a property of the manager. Environments created by one runtime are not moved by the other: recreate them after switching `AGENT_RUNTIME` (their Git state is in the repository; the workspace volume isn't migrated automatically).
