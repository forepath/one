# Agenstra on Loadweaver

Agenstra's **agent manager** runs as a normal Loadweaver deployment. Its agent environments then either run on Loadweaver too (the **Loadweaver runtime**, scheduled, migrated and failed over by Loadweaver) or, as today, on the Docker of the node the manager runs on (the **Docker runtime**). The Agenstra controller and console keep running on their own servers.

The runtime is chosen per agent manager, i.e. per Agenstra workspace, with `AGENT_RUNTIME` (`docker` is the default and leaves existing installs unchanged).

| Runtime      | Environments                                            | Egress filtering                                         | Manager deployment                                     |
| ------------ | ------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------ |
| `loadweaver` | Loadweaver deployments in the workspace's project       | Loadweaver node proxies, compiled from Agenstra's policy | `compose.loadweaver-runtime.yaml` (sandboxed, no pins) |
| `docker`     | Containers on the manager's node (delegated, not drift) | Agenstra's guard sidecars (Squid)                        | `compose.docker-host.yaml` (Docker socket: a pin)      |

Both compose files are in `apps/agenstra/backend-agent-manager/loadweaver/`.

## Nodes

- Environments of the **sandboxed** isolation level run with `runtime: sandboxed` (gVisor). Loadweaver places them on nodes whose agent reports a working gVisor runtime ([host requirements](../deployment/host-requirements.md)); a plan without such capacity fails, and Agenstra reports the environment as not created. The **standard** level runs with `runc`.
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

   The same documents come from `loadweaverWorkspacePolicies(project)` in `@forepath/agenstra/shared/util-opencode-config`.

3. **Service user and token.** Create a user for the manager, add it to the project as **operator** (not admin), and create a personal access token for it with the scopes `projects:read resources:read plans:create plans:apply secrets:write logs:read metrics:read live:access live:exec`. The token can never exceed the user's role: the manager can change only its own project.

   > **Current limitation:** the project secrets API (`PUT` / `DELETE /api/projects/{project}/secrets/{name}`) still accepts cluster admins only. Creating, changing the variables of and deleting an environment store its environment file as a project secret, so with a project operator alone these calls fail with `403`; everything else (plans, machine exec, files, logs, metrics) works with the operator role. Until the secrets API accepts project roles, don't use the Loadweaver runtime in production (granting the manager a cluster role would let it act on every project).

4. **Secrets** in the project (values never appear in plans, logs or the audit log):
   - `loadweaver-token`: the PAT from step 3;
   - `agent-manager-env`: shell-style `KEY=value` lines with the manager's own secrets (`DB_PASSWORD`, `ENCRYPTION_KEY`, `STATIC_API_KEY` or `JWT_SECRET`, ...), loaded by the entrypoint from tmpfs;
   - `agent-manager-db`: the Postgres password.
5. **Deploy** `compose.loadweaver-runtime.yaml` as the `spec.compose` of a `Deployment` named `agent-manager` in the project (replace `LOADWEAVER_URL`, `LOADWEAVER_PROJECT` and the ingress hostname) and `loadweaver plan -f agent-manager.yaml --apply`. Exposing the manager through the ingress is internet exposure, so this plan needs an approval in `risky` mode.
6. In Agenstra's controller, register the manager's URL (the ingress hostname) like any other agent manager.

## How environments run

- **One deployment per environment**: `env-<agent id>` with one service `worker` and the volume `workspace` (mounted at the provider's base path, `/app`; replicated by Loadweaver, so the environment can move between nodes). Created, changed and deleted through plan + apply; the plans have the source `api` and appear in the plan history.
- **Environment variables** (OpenCode credentials, Git tokens, the workspace's variables) are one project secret `env-<agent id>-env`, mounted as Agenstra's environment file (`/etc/agenstra/environment/environment`). A change stores a new secret version and re-plans the deployment with it pinned, which recreates the container; the workspace volume stays. Nothing secret is in the compose file.
- **Reachability**: the manager talks to OpenCode (4096) and VNC (6080) at the environment's **service address** (stable across restarts, migrations and failover), allowed by the standing policy `agenstra-manager-environments`.
- **Commands** (Git, file operations, ACP sessions, the workspace watcher) run over [machine exec](../features/terminals-files-and-tunnels.md#machine-exec) (`live:exec`): binary-safe, as the requested user, with the environment's variables, audited per command. Files the guard sidecar used to receive go through `/api/live/files`.
- **Logs and stats** come from Loadweaver's logs API (container lines of the replica) and metrics (`replica.cpu_cores`, `replica.memory_bytes`).
- **Stop / start** set the deployment to zero / one replica; a restart is a stop and a start (the replica may come back on another node).
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
