# Console

The Loadweaver console is the web UI for one cluster. It runs next to each cluster's control plane and talks only to that control plane's REST API and Socket.IO namespaces. It never writes desired state directly: every change to resources becomes a [plan](./features/plan-and-apply.md) that is reviewed and applied like one made with the CLI.

The console only shows what the caller may read. The control plane scopes every list by the caller's [cluster and project roles](./features/projects-and-access.md). The console hides views and actions the caller can't use, but the API decides.

## Running the console

The console is an Angular app served by a small Express server (`apps/loadweaver/frontend-console`, image `ghcr.io/forepath/loadweaver-console-server`). The default port is **4602** (see `docs/port-allocation.md` in the repository).

```bash
npx nx run loadweaver-frontend-console:build:production   # en and de builds
npx nx run loadweaver-frontend-console:server             # server bundle in dist/apps/loadweaver/frontend-console/server
```

| Variable                                  | Default  | Meaning                                                                                   |
| ----------------------------------------- | -------- | ----------------------------------------------------------------------------------------- |
| `PORT`                                    | `4602`   | Listen port                                                                               |
| `DEFAULT_LOCALE`                          | `en`     | Locale used when neither the path (`/en/…`, `/de/…`) nor `Accept-Language` selects one    |
| `CONFIG`                                  | (none)   | URL of a JSON document merged over the built-in environment at runtime (see below)        |
| `CONFIG_ALLOWED_HOSTS`                    | (none)   | Comma-separated host allowlist for `CONFIG` (required in production when `CONFIG` is set) |
| `CONFIG_ALLOW_INSECURE_HTTP`              | `false`  | Allow an `http://` `CONFIG` URL in production                                             |
| `CONFIG_ALLOW_INTERNAL_HOST`              | `false`  | Allow a `CONFIG` host that resolves to a private or loopback address                      |
| `CONFIG_FETCH_TIMEOUT_MS`                 | `10000`  | Timeout for fetching `CONFIG`                                                             |
| `CONFIG_FETCH_MAX_BYTES`                  | `262144` | Maximum size of the `CONFIG` response                                                     |
| `CONFIG_JSON_MAX_DEPTH`                   | `12`     | Maximum JSON depth of the `CONFIG` response                                               |
| `CONFIG_JSON_MAX_KEYS`                    | `512`    | Maximum number of JSON keys                                                               |
| `CONFIG_CACHE_TTL_MS`                     | `60000`  | How long the server caches the fetched configuration                                      |
| `CSP_ENFORCE`, `CSP_CONNECT_SRC_EXTRA`, … |          | Content Security Policy, as for the other ForePath consoles                               |

Requests without a locale prefix are redirected to `/<locale>/…`. Source maps are never served.

### Runtime configuration

Like the other ForePath consoles, the server exposes `GET /config`. When `CONFIG` is set, the server fetches that URL (with the limits above), caches it and returns it; without `CONFIG` it returns `{}`. The browser merges the result over the environment it was built with, so one image serves every cluster. The configuration is also inlined into `index.html`, so the first render already uses it.

The console's part of the environment:

```json
{
  "console": {
    "urls": {
      "restApi": "https://cp.example.com/api",
      "frontend": "https://console.example.com",
      "websocket": {
        "default": "https://cp.example.com/socket/plans",
        "plans": "https://cp.example.com/socket/plans",
        "logs": "https://cp.example.com/socket/logs",
        "terminals": "https://cp.example.com/socket/terminals",
        "tunnels": "https://cp.example.com/socket/tunnels",
        "topology": "https://cp.example.com/socket/topology",
        "consoles": "https://cp.example.com/socket/consoles"
      }
    }
  },
  "authentication": {
    "config": { "type": "users", "disableSignup": true }
  }
}
```

- `console.urls.restApi` is the control plane's REST base (`…/api`); every view calls it.
- `console.urls.websocket` names one Socket.IO namespace per live feature: `plans` (plan status and apply progress), `logs` (live tail), `terminals` (terminal sessions), `tunnels` (debug tunnel state), `topology` (live traffic on the map) and `consoles` (serial and VNC consoles of virtual machines). `default` is the plans namespace.
- In production, allow the control plane's origin in `CSP_CONNECT_SRC_EXTRA` if it isn't served over `https:` / `wss:`.

### Fleet mode

One console can manage several clusters through the [fleet service](./features/fleet.md#console-fleet-mode). Set `"mode": "fleet"` and `fleet.apiUrl` / `fleet.websocketUrl` (the fleet's REST base and its `socket/fleet` namespace) in the runtime configuration; `console.urls` is then not used. Users sign in at the fleet; the sidebar gets the **Fleet** group (fleet overview, clusters and grants, compare, operations, fleet audit) and the top bar a **cluster switcher**. With a cluster selected, every view below works against that cluster through the fleet's relay, scoped by the user's fleet grant. Views the relay doesn't carry show "Not available through the fleet", and approvals are given in the cluster's own console. In production, allow the fleet's origin in `CSP_CONNECT_SRC_EXTRA` if needed. Without `mode` (or with `"cluster"`) the console behaves as described on this page. **Local development** (`nx serve loadweaver-frontend-console`) uses fleet mode by default against the local fleet service on `http://localhost:3500` (start it with `nx run loadweaver-backend-fleet:start-containers`); remove `mode` in `environment.console.ts` to talk to one control plane on port 3400 directly. Production builds stay single-cluster unless the runtime configuration sets `mode`.

### Authentication

The console uses the shared ForePath identity screens. `authentication.config.type` must match the control plane's `AUTHENTICATION_METHOD`:

| Type       | Login                                                                                                                                                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`    | Built-in accounts: login with email and password, optional registration (`disableSignup`), password reset, email confirmation, two-factor authentication (authenticator app or email). The first registered user becomes the administrator. |
| `keycloak` | Single sign-on through Keycloak (`authServerUrl`, `realm`, `clientId`).                                                                                                                                                                     |
| `api-key`  | A static API key, mainly for tests and local development.                                                                                                                                                                                   |

With `users` and `keycloak` the account menu also offers **Security** (`/settings/security`, password and 2FA, `users` only) and **Access tokens** (`/settings/tokens`, personal access tokens with [scopes](./features/projects-and-access.md) for the CLI and automation). Socket.IO namespaces accept interactive sessions only, so live features need a console login, not a personal access token.

## Roles and what the console shows

- **Cluster roles** (cluster admin, infra operator, auditor) see the whole cluster, including the infrastructure views (Drift, Nodes & sites) and traffic on the map.
- **Project roles** (admin, operator, developer, viewer) see their projects' part of every view. Infrastructure views are hidden from the sidebar.
- **Access** and **Git** are shown to everyone with any cluster or project role, **Wallboards** to cluster admins and project admins.
- The **Admin** popover at the bottom of the sidebar holds **Webhooks** (`/webhooks`, cluster admins), **Users** (`/users`, user management for global admins with `users` or `keycloak` authentication) and **Updates** (`/updates/announcements`, the release announcements of the shared updates feature, for global admins and the API key; a dot on **Admin** and **Updates** marks news there).

## Navigation

The sidebar is ordered by process, from setting up to daily use. **Overview** and **Map** are plain links; the rest is grouped into popovers that open next to the sidebar (one at a time, Enter or Space opens a focused group, Escape or a click outside closes it):

| Group              | Items                                                                     |
| ------------------ | ------------------------------------------------------------------------- |
| **Cluster**        | Nodes & sites, Import hosts, DNS, Certificates, Updates (rollouts), Drift |
| **Access & audit** | Access, Devices, Device posture, Audit                                    |
| **Deploy**         | Git, Resources, Policies, Plans                                           |
| **Operate**        | Terminals, Files, Sessions, Virtual machines, Backups                     |
| **Observe**        | Health, Alerts, SLOs, Status, Logs, Metrics, Reports, Wallboards          |
| **Account**        | Tokens (`users` / `keycloak` authentication), Git accounts                |

Each item keeps its visibility rule (see above): a group whose items are all hidden is not shown, a group with one visible item is shown as a plain link. A group is highlighted when the current page belongs to one of its items. **Admin** stays at the bottom of the sidebar.

## Top bar

- **Search and command palette:** the search field, or **Ctrl + K** / **Cmd + K** anywhere. Results are grouped by kind (favourites first); without a query the palette lists recently opened items and favourites. Links navigate, API actions run after a confirmation. `/search?q=…` shows all results. API: `GET /search`, `GET /search/favorites`, `POST /search/recent`. See [search and wallboard](./features/search-and-wallboard.md).
- **Language:** English and German. Each locale is its own build, so switching reloads the page under `/en/…` or `/de/…`.
- **Theme:** light or dark, stored in the browser.
- **Notifications, security, logout:** the notification indicator, the 2FA reminder (`users` authentication) and logout, optionally from every session.

## Views

| View                   | Route                                                                                                                                                           | Who                                                                                                                              | API                                                                                                                                                                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Overview               | `/overview`                                                                                                                                                     | Everyone signed in                                                                                                               | `GET /overview`, `GET /health/tree`                                                                                                                                                                                                  |
| Map                    | `/topology`                                                                                                                                                     | Everyone; traffic for cluster roles                                                                                              | `GET /topology`, `GET /topology/trace`, `socket/topology`                                                                                                                                                                            |
| Plans                  | `/plans`, `/plans/:id`                                                                                                                                          | Everyone (scoped)                                                                                                                | `GET /plans`, `GET /plans/{id}`, `POST /plans/{id}/…`, `socket/plans`                                                                                                                                                                |
| Git                    | `/git`, `/git/:id` (`?connection=<id>`)                                                                                                                         | Readers of the scope; scope admins manage                                                                                        | `/git/connections…`, `GET /git/sops/recipient`                                                                                                                                                                                       |
| Resources              | `/resources`, `/resources/:kind/:name`, `…/edit`, `/resources/new`                                                                                              | Everyone (scoped)                                                                                                                | `GET /resources`, `GET /schemas`, `GET /schemas/{kind}`, `POST /plans`                                                                                                                                                               |
| Groups & policies      | `/policies`, `/policies/:name`                                                                                                                                  | Everyone (scoped)                                                                                                                | `GET /resources`, `GET /topology`                                                                                                                                                                                                    |
| Health                 | `/health`, `/health/<key>`                                                                                                                                      | Everyone (scoped)                                                                                                                | `GET /health/tree`, `GET /health/history`                                                                                                                                                                                            |
| Alerts                 | `/alerts`, `/alerts/:id`                                                                                                                                        | Everyone (scoped)                                                                                                                | `GET /alerts`, `POST /alerts/{id}/…`, `/alerts/silences`, `GET /alerts/export`                                                                                                                                                       |
| SLOs                   | `/slos`                                                                                                                                                         | Everyone (scoped)                                                                                                                | `GET /slos`                                                                                                                                                                                                                          |
| Status pages           | `/status-pages`                                                                                                                                                 | Everyone (scoped); incidents written by project operators                                                                        | `GET /resources`, incidents per project                                                                                                                                                                                              |
| Logs                   | `/logs`                                                                                                                                                         | Everyone (scoped)                                                                                                                | `GET /logs`, `GET /logs/export`, `socket/logs`                                                                                                                                                                                       |
| Metrics and dashboards | `/metrics`                                                                                                                                                      | Everyone (scoped)                                                                                                                | `GET /metrics/names`, `GET /metrics/query`, `GET /metrics/events`, `POST /dashboards/query`                                                                                                                                          |
| Terminals              | `/terminals`                                                                                                                                                    | Project operators (developers if allowed), cluster admins                                                                        | `socket/terminals`                                                                                                                                                                                                                   |
| Files                  | `/files`                                                                                                                                                        | Project operators and admins                                                                                                     | `/live/files`, `/live/files/content`                                                                                                                                                                                                 |
| Sessions and tunnels   | `/live`                                                                                                                                                         | Auditors, cluster admins, project admins                                                                                         | `GET /live/sessions`, `GET /live/tunnels`                                                                                                                                                                                            |
| Virtual machines       | `/virtual-machines` (`?project=`), `/virtual-machines/:project/:name` (`?tab=overview\|serial\|vnc`)                                                            | Project members (power and consoles: operators, admins, developers with `developerExec`)                                         | `GET /virtual-machines`, `GET /projects/:p/virtual-machines/:name`, `socket/consoles`                                                                                                                                                |
| Audit log              | `/audit`                                                                                                                                                        | Auditors, cluster admins; project admins (scoped)                                                                                | `GET /audit`, `GET /audit/export`, `GET /cluster/audit/verify`                                                                                                                                                                       |
| Reports                | `/reports`                                                                                                                                                      | Everyone (scoped)                                                                                                                | `GET /reports`, `POST /reports/run`, `/reports/files…`                                                                                                                                                                               |
| Usage                  | `/usage`                                                                                                                                                        | Everyone (scoped; all projects for cluster roles)                                                                                | `GET /projects/{project}/usage`, `GET /usage`, `…/usage/export`                                                                                                                                                                      |
| Drift                  | `/drift`                                                                                                                                                        | Cluster roles                                                                                                                    | `GET /drift`, `POST /drift/plans`                                                                                                                                                                                                    |
| Nodes & sites          | `/nodes`, `/nodes/:name`                                                                                                                                        | Cluster roles                                                                                                                    | `GET /nodes`, `POST /nodes/{name}/…`, `/join-tokens`                                                                                                                                                                                 |
| Import hosts           | `/imports`, `/imports/:node`                                                                                                                                    | Cluster roles (read), infra operators and cluster admins (change)                                                                | `/imports`, `/imports/{node}/…`                                                                                                                                                                                                      |
| Updates                | `/updates` (`?tab=`), `/updates/rollouts/:id`, `/updates/announcements`                                                                                         | Cluster roles; cluster admins act; announcements for global admins                                                               | `GET /updates/status`, `/updates/releases…`, `POST /updates/bundles`, `/updates/rollouts…`, `GET /resources?kind=MaintenanceWindow`, `/updates/announcements`                                                                        |
| Backups                | `/backups` (`?project=`), `/backups/:id` (`?path=`), `/backups/diff?from=&to=`, `/backups/restores`, `/backups/deletions`, `/backups/keys`, `/backups/platform` | Everyone (scoped); operators back up / restore / test, admins request and approve deletions; the recovery kit for cluster admins | `GET /backups/status`, `GET /backups…`, `/backups/{id}/files`, `/backups/{id}/download`, `/backups/diff`, `POST /backups/now`, `/backups/restores`, `/backups/restore-tests`, `/backups/deletions…`, `/backups/keys…`, `POST /plans` |
| DNS                    | `/dns`                                                                                                                                                          | Everyone (scoped); zones, DNSSEC and failover for cluster roles                                                                  | `GET /resources`, `GET /dns/zones`, `GET /dns/dnssec`, `/dns/failover`                                                                                                                                                               |
| Access                 | `/access`, `/projects/:project/requests`                                                                                                                        | Any cluster or project role                                                                                                      | `/access/me`, `/cluster/members`, `/projects/{project}/…`, `/access/export`, `/access/import`                                                                                                                                        |
| Devices                | `/devices`                                                                                                                                                      | Everyone (own devices); all clients for infra operators and cluster admins                                                       | `GET /vpn/devices`, `DELETE /vpn/devices/{id}`                                                                                                                                                                                       |
| Device posture         | `/posture`                                                                                                                                                      | Infra operators (read), cluster admins (edit)                                                                                    | `GET /posture/plugins`, `/posture/integrations`, `/posture/certificates`; `POST` / `PATCH` / `DELETE /posture/integrations…`, `PUT /posture/certificates`                                                                            |
| Wallboards             | `/wallboards`                                                                                                                                                   | Cluster admins, project admins                                                                                                   | `/wallboards`                                                                                                                                                                                                                        |
| Linked Git accounts    | `/settings/git-accounts`                                                                                                                                        | Everyone signed in (own accounts)                                                                                                | `GET /git/accounts`, `POST /git/accounts/{provider}/authorize`, `GET` / `DELETE /git/accounts/pending/{nonce}`, `POST /git/accounts/confirm`, `DELETE /git/accounts/{id}`                                                            |
| Kiosk                  | `/kiosk#<token>`                                                                                                                                                | No login (wallboard token)                                                                                                       | `GET /public/wallboard`                                                                                                                                                                                                              |

### Overview

The headline from the health tree, the needs-attention inbox (critical first, then oldest first, each item linking to where it's resolved; Git items — default branch ahead, rejected push, connection error — link to the plan or the connection), the summary and recent activity. Cluster roles see the whole cluster; project members pick one of their projects. See [overview and health](./features/overview-and-health.md).

### Map

The [topology map](./features/topology-map.md): sites, nodes and replicas, groups and policy edges, tunnels, storage, DNS and addressing as layers you switch on and off. Cluster roles see traffic live (over `socket/topology`) or at a past time on the timeline; project members see only their projects' part of the map, without traffic. A pending plan can be shown as an overlay, a path trace follows a hostname to its replicas, and every element links to its logs, health, policy or terminal.

### Plans

The newest plans with status, author, creation time and the projects they touch, filtered by status and project and updated live over `socket/plans`. A plan's page shows the resource changes (before / after), the compiled effect per network layer (tunnels, routing, policies, DNS), replica moves and the failure analysis, pins, warnings and approvals, and while it runs the progress of the apply or rollback per node and layer. Depending on its state and the caller's role: approve, apply (confirming the pins), cancel or discard. See [plan and apply](./features/plan-and-apply.md).

Every plan shows where it came from: **Git** (commit with short SHA and ref, pull request and author, linked to the provider when the connection is readable), the **console**, the **API**, **drift** or the **system** (fix-forward). Resources changed outside Git since the last sync are shown prominently as `git-conflict` warnings. A console, API or drift plan touching a scope where **Git is authoritative** can't be applied here: the page explains it, links the pull request (or branch) Loadweaver opened for it and disables Apply; merging the pull request creates the plan that is applied. The pull request is opened in the background after the plan is created: until it is there the page says **Pull request is being opened…** and reads the plan again every 3 seconds (for at most 2 minutes) so the link appears without a reload. A plan bot plan links the plan it **supersedes** (the console / API plan pushed as its branch), and a superseded plan links the plan that **superseded** it; the pull request links to the provider (`rel="noopener noreferrer"`, http(s) URLs only). Plan bot plans limited to one project or path say **limited to …**, and a plan lists the Loadweaver users who authored the change in Git: they can't approve it (the console hides Approve for them).

### Resources and the editor

The desired state the caller may read, by kind and project: cluster-level resources for cluster roles, project resources for members. A resource's page shows its metadata and YAML (and a `Deployment`'s compose file) read-only.

The editor shows the resource as YAML in Monaco and validates it while typing against the JSON Schema the control plane publishes for its kind (`GET /schemas/{kind}`); a `Deployment`'s compose file has its own editor. **Saving never writes**: it creates a plan (`POST /plans`) and opens it for review. Changing the kind, name or project plans a rename (the old resource is deleted), and deleting a resource also plans the deletion. In a Git-authoritative scope the editor says so before saving (**Plan and open pull request**): the control plane turns the plan into a pull request, and the plan that opens links it as soon as the pull request exists (it is opened asynchronously).

### Groups & policies

Workload groups with their selectors, current members and the exposed flag, and the policies (from → to → rules, mode, action) per project. A policy's page shows the groups it connects. Changes are made in the resource editor. See [groups and policies](./features/groups-and-policies.md).

### Health

The explained health tree: cluster → site → node for cluster roles, project → deployment → service → replica for everyone who may read the project, each with its state, machine-readable reasons and since when. An entity's page shows its descendants, state changes and the time spent per state.

### Alerts

Firing, pending and resolved alerts with filters and CSV / JSON export; an alert's page shows what fired and why and its timeline. Alerts can be acknowledged, and silences created (rule or prefix ending in `*`, project, key, reason, time window) and ended. See [alerting](./features/alerting.md).

### SLOs and status pages

SLOs lists availability and latency objectives of exposed services with the error budget used, burn rate and monthly uptime, most urgent first. Status pages lists the projects' `StatusPage` resources (edited as resources, opened on their hostname) and the incident notes they show, which project operators write here. See [SLOs and status pages](./features/slos-and-status-pages.md).

### Logs

The [log explorer](./features/logs.md): time range, sources, levels, labels and full text, newest first, paged; live tail over `socket/logs`; export. The filter lives in the URL, so other views link to it (`/logs?project=shop&service=api`).

### Metrics and dashboards

One [metric](./features/metrics.md) over a time range, grouped and aggregated, with event markers; and the [`Dashboard` resources](./features/dashboards.md) as widget grids under a global time range and project filter. Dashboards are edited as resources.

### Terminals, files and sessions

- **Terminals:** pick a replica (project → deployment / service → replica) or, for cluster admins while the cluster allows it, a node shell, and work in several tabs over `socket/terminals`. Project operators and admins may open replica terminals; developers only when the project allows it. Recorded sessions show a banner. The map opens a terminal directly with `?replica=…`.
- **MicroVMs:** terminals and files of [microVM](./features/isolation-levels.md#microvms) replicas work the same way and open inside the guest.
- **Files:** a replica's container filesystem (writes are lost on restart) or a volume: list, preview text and images, download, upload (chunked above 10 MB), create, delete, rename, move and copy. `?target=…&path=…` deep links.
- **Sessions and tunnels:** the audited terminal session records with their recordings (download or replay in the browser), and the open debug tunnels. Tunnels are opened with the [CLI](./cli.md), not from the browser.

See [terminals, files and tunnels](./features/terminals-files-and-tunnels.md).

### Virtual machines

- **List** (`/virtual-machines`): every [virtual machine](./features/virtual-machines.md) you may read with phase, node, vCPUs, memory, disks and addresses; search and filters for project, phase and run strategy. With a project selected: its VM image imports and, for operators, **Import VM image** (URL, SHA-256, repository and tag, architecture, firmware, guest agent). **New** opens the resource editor with a `VirtualMachine` template; specs change through plans.
- **Detail** (`/virtual-machines/:project/:name`, `?tab=`): the actions the VM's state and your role allow (start, stop, shutdown, force off, reboot, reset, take snapshot, reimage), each confirmed; links to the YAML and to edit it through a plan. Tabs: **Overview** (status with the guest's power state, machine and pinned image, NICs with MACs, groups and addresses, disks with primary and copies, snapshots linking to their backups, recent node commands), **Serial console** (terminal panel, boot log first, recorded badge, reconnect) and **Graphical console** (noVNC with Ctrl+Alt+Del). Consoles follow the terminal rules: operators and admins, developers with `developerExec`.

### Audit log

Search by actor, action (exact or `prefix*`), target prefix, project, time and full text; newest first; entry details; CSV / NDJSON export. Auditors and cluster admins can verify the hash chain. Project admins see their projects' entries. See [audit and export](./features/audit-and-export.md).

### Reports

[Periodic reports](./features/periodic-reports.md) per scope and month, re-runs of a finished month (cluster admins and project admins), and the reports' file tree with downloads, folder archives and the printable report in a sandboxed viewer.

### Usage

[Metered usage](./features/usage-metering.md) per project: totals per meter, a table per period (hour, day or month, UTC) and project with open periods marked, filters for project, resolution and time range, and the CSV export. Project members see their projects; cluster roles can also look at all projects at once.

### Git

The [Git connections](./features/gitops.md) per scope (the cluster scope, each project): provider, repository, branch, path, mode (Git authoritative or bidirectional), trigger (webhooks and / or polling), options, the last synced commit, the last sync and the last error, and the commits Loadweaver synced or wrote, each with its plan, state (and the reported commit status), pull request and, for rejected pushes, the file, line and rule. `/git/<id>` (where the inbox links) or `/git?connection=<id>` shows one connection.

Cluster admins manage the cluster connection, project admins their projects' (everyone else who may read the scope sees them read-only): connect (validated like the API: HTTPS or SSH URLs only, credentials as `secret://project/name`, a project only with its own secrets), edit, disconnect, test the connection, sync now, export the scope to the repository (confirmed; replacing existing files with `force` needs an extra confirmation), reset a pinned SSH host key and read the webhook secret on demand (audited; a new connection shows it once) together with the webhook URL to configure at the provider. **Rotate webhook secret** (audited, behind a confirmation: the current secret stops working immediately, so the provider's webhook secret has to be updated afterwards) shows the new secret once; the page shows how often the secret was rotated. An export reports the resources it skipped because they come from SOPS-encrypted files (they are never written in clear); an export that would write plaintext secrets is refused with the control plane's message.

**GitHub App:** cluster admins can let a GitHub connection use the cluster's GitHub App (`Cluster.spec.git.github`) instead of an own token (option **Use the cluster's GitHub App**). The connection's API URL must be the cluster's GitHub API (`Cluster.spec.git.github.apiUrl`). Other scope admins see the option read-only while it is on (hidden while off); when one of them changes the repository, API URL or provider the control plane turns it off (the form warns before saving), and only a cluster admin can enable it again. The page also shows the cluster's SOPS age recipient with a copyable `sops --encrypt --age <recipient> …` command.

### Linked Git accounts

`/settings/git-accounts` (sidebar: **Git accounts**) lists the GitHub and GitLab accounts linked to the signed-in user for the plan bot, links another one and unlinks one after a confirmation. Linking goes to the provider's authorize URL; the provider sends the browser back with `?confirm=<nonce>` (or `?error=<reason>`), and the page asks **Link <login> on GitHub / GitLab to your account?** before anything is linked (only the user who started the flow can confirm it). Confirm links the account and refreshes the list; Cancel drops the request. An expired or unknown request says to start again, a provider account linked to another Loadweaver user says so; the parameter is removed from the URL right after it is read.

### Drift (cluster roles)

Containers on the nodes that Loadweaver doesn't manage, failed rollbacks whose configuration and reality may differ, and Git scopes whose **default branch is ahead of the cluster** (the head commit's plan isn't applied, or the push was rejected), with links to the commit, its plan and the connection. A foreign container can be turned into a proposed plan, reviewed and applied like any other (a pull request in Git-authoritative scopes).

### Nodes & sites (cluster roles)

Nodes grouped by site with lifecycle, connection, roles and capacity, and the control plane's membership. Infra operators and cluster admins create and revoke join tokens. A node's page shows lifecycle, connection and apply state, capacity, network and system, with the lifecycle actions the API offers for its state (cordon, drain, …). These are runtime actions, not plans, and each is confirmed first. A node's declarative part (site, labels, the KVM opt-out `virtualization.kvm: disabled`) is a `Node` resource and changes through the resource editor and a plan. See [nodes and joining](./features/nodes-and-joining.md).

### Import hosts (cluster roles)

Hosts that joined with `install.sh --discover` and wait for (or run) their join plan. The wizard shows what discovery found (compose projects, containers, ports, volumes, existing tunnels, a former installation) and asks per item: import as a deployment of a project, migrate to other nodes, or leave unmanaged; hostnames for HTTP ports; copy, empty or keep for each volume / bind mount; values for secrets that stayed on the host. "Build the join plan" shows conflicts (resolved or refused with a reason), warnings and the ordered steps; "Create the plan" opens the plan page. While the join plan runs, each step shows its progress. See [importing Docker hosts and former nodes](./features/import.md).

### Updates (cluster roles)

Release bundles, update plans and maintenance windows (3.26), in four tabs:

- **Overview:** the cluster's release, the control plane's version and the newest available release; the update policy from `Cluster.spec.updates` (read only, with a link to the Cluster resource in the editor, where cluster admins change it through a plan); every node with agent version, release and target, OS and kernel, a pending reboot, and its maintenance-window state (open until …, next window at …, or none).
- **Releases:** releases per channel (stable / beta) with their status, signature (signed / unsigned), notes and pinned components. Cluster admins download a release's bundle (GitHub or the mirror, imported in the background) or upload a bundle file (air-gapped): the file is streamed as `application/x-tar` with upload progress and can be cancelled; signature or checksum errors are shown.
- **Update plans:** every plan with status, versions, kind and progress. Cluster admins plan an update for an imported release (or host / OS updates only for the running one), optionally with host updates and a full OS upgrade.
- **Maintenance windows:** the `MaintenanceWindow` resources with their schedule and the nodes they select, links to create and edit them in the resources editor, and the next opening per node.

A plan's page shows the diff per node or per component, notes, warnings and the steps grouped by wave (control plane, canary, waves), each with state, health-gate results and errors, plus what the wave puts at risk. Cluster admins approve it (optionally as an **emergency** that runs outside maintenance windows, confirmed explicitly), pause, resume, roll back or cancel it, each after a confirmation. While a rollout runs the pages poll every 5 seconds. Global admins (and the API key) also get the release **announcements** of the shared updates feature at `/updates/announcements`. See [updates](./features/updates.md).

### Backups

The backup catalog (3.20). Project members see their projects' backups (the API scopes everything), cluster roles the whole cluster. See [backups](./features/backups.md).

- **Overview** (`/backups`, `?project=` filters): the backup pins (no confirmed recovery kit, no off-cluster copy), the state of the backup key's recovery kit (with a link to the kit page for cluster admins), backed-up and stored bytes (after deduplication, what counts against storage quotas) per project, the last copy to each backup target with its errors, and the number of pending deletion requests. Links to the `BackupPolicy` / `BackupTarget` resources and to new ones in the resources editor (prefilled with an example).
- **Catalog:** grouped by volume, each with a **timeline** (one bar per backup, oldest left, height by size, coloured by status, faded once deleted) and a table: time, status, size and bytes added to the repository, retention keep reasons, the latest restore test, immutability (`lockedUntil`) and the targets holding a copy. Per backup: browse the files, compare with another backup of the volume, restore (wizard), restore test now (operators), request deletion (admins). Per volume: **back up now** (operators), also for volumes that have no backup yet. The page polls every 5 seconds while a backup or restore test runs.
- **Backup** (`/backups/:id`): details (repository, policy, node, key generation, hooks, copies and their locks) and a **file browser** over the backup (`?path=`): open directories, download a file, or restore a file / directory with the wizard prefilled.
- **Compare** (`/backups/diff?from=&to=`): added, removed and changed files between two backups of the same volume with their sizes and the size change.
- **Restore wizard:** pick the backup and what to restore (the whole volume or one path), then where (the volume itself, or side by side into another volume of the project: a new one has to be added to the deployment in the same plan) and how (`replace` / `merge`, target path and `overwrite` for a single path). A whole-volume restore into an existing volume warns that the volume's containers are stopped during the restore. The wizard creates a plan with a `Restore` resource and opens it: approvals and apply work like any plan.
- **Restores** (`/backups/restores`): `Restore` executions with status and live progress (phase, bytes, files), and the restore tests with their check hook's exit code and output.
- **Deletion requests** (`/backups/deletions`): deleting backups (requested from the catalog with a reason) or shortening retention needs a **second admin** of the same scope and takes effect only after the delay (`notBefore`). Open requests show requester, approver and the earliest execution; admins approve (never their own request) or cancel, each after a confirmation; executed and cancelled requests are kept as history.
- **Platform backups** (`/backups/platform`, cluster roles; actions for cluster admins): the control plane's own backups (3.20) — pins (no external copy), per kind (Postgres, OpenSearch, etcd) schedule, the retention in effect (a shortened `keep` waits for a second admin and the delay: the open request with a link to the deletion requests), the last run, _back up now_ and the recent backups with their external copies and lock ends; point-in-time recovery (window, database scope, restores: request with an optional target time, discard) and the **cut-over** of a ready clone (a plan with the data-loss warning, approved by a second cluster admin, cancel); the external copy per target (last pass, objects, bytes, the newest DR envelope read back and decrypted; _copy now_); disaster recovery: the kit state, _Download DR info_ and the `bootstrap --restore` command. Polls every 5 seconds while something runs. The keys page has the DR info download too.
- **Recovery kit** (`/backups/keys`, cluster admins): the backup key generations with their kit (n shares, k needed). Each share is handed out **once**, after a confirmation: it is saved as a text file and shown once. Confirm the kit by pasting (or loading) enough shares back; re-issue the kit (default 3 shares, 2 needed), rotate the key, or escrow it in the configured KMS. Until the active generation's kit is confirmed (or the key escrowed) the page and the catalog warn that backups are not recoverable without the cluster.

### DNS

Declared records with their sync state and ownership conflicts (project members see their own records). Cluster roles also see the zones at their primary and secondary providers, DNSSEC keys and DS state, and DNS failovers with the manual fail-back. See [DNS](./features/dns.md) and [DNS failover](./features/dns-failover.md).

### Access

Cluster members (cluster roles read, cluster admins manage); per project its members, its settings (which plans need an approval, whether developers may open terminals, terminal recording) and requests from other projects, whose policies want to reach its groups. Cluster admins export and import access as YAML. These changes take effect immediately (they are not plans), are audited and are confirmed first. See [projects and access](./features/projects-and-access.md).

### Devices

The caller's [remote-access](./features/remote-access.md) devices (every client for infra operators and cluster admins) with posture facts (last report, MDM / EDR results, device certificate), restrictions and connection, instant revocation, and how to enroll a device with the CLI. The key pair is generated on the device, so no private key passes through the browser.

### Device posture

[Posture integrations](./features/device-posture.md) (Intune, Jamf Pro, Kandji, Defender for Endpoint, CrowdStrike, SentinelOne and plugins) with their sync state, last error and matched devices; cluster admins add, edit (stored secrets stay unless replaced), test, sync and delete them. Below, the trust for device certificates: company CA bundle, CRLs, the cluster CA and the proof-of-possession requirement.

### Wallboards and kiosk

Wallboard tokens are read-only and can only open the kiosk view: cluster-wide tokens for cluster admins, project tokens for project admins. A new token's kiosk URL is shown once.

The kiosk (`/kiosk#<token>`) needs no login, for a screen in the office. The token is in the URL fragment, so it never reaches the console server or proxy logs; the kiosk sends it only as `Authorization: Wallboard <token>` to the control plane. It shows the health headline, what needs attention and the summary full screen, rotating per section and refreshed every 30 seconds.

## Not there yet

- **Isolation levels:** the node pages don't show the per-level probe states yet. Use the API (`GET /api/nodes/{name}`: `runtimes`, `capabilities.isolation`, `capabilities.kvm`; `GET /api/nodes?runtime=…`; `POST /api/nodes/{name}/isolation-probe`), see [isolation levels](./features/isolation-levels.md#node-probes).
- **Display names:** members, authors and actors are shown by user id, not by name.
