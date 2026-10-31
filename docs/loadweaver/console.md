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

One console can manage several clusters through the [fleet service](./features/fleet.md#console-fleet-mode). Set `"mode": "fleet"` and `fleet.apiUrl` / `fleet.websocketUrl` (the fleet's REST base and its `socket/fleet` namespace) in the runtime configuration; `console.urls` is then not used. Users sign in at the fleet. The resource tree starts at **Fleet** → **Clusters** → every cluster, and at the fleet root the rail shows the fleet pages (Overview, Clusters, Compare, Operations, Audit). Expanding a cluster in the tree (or opening it from a card, the inbox or the cluster list) makes it the **active cluster**: the rail then starts with a **Fleet** level tile and the cluster's name, followed by the cluster's sections, and every page below works against that cluster through the fleet's relay exactly as in single-cluster mode — drafts, previews and plans included — limited only by the user's fleet grant. Users with project grants (no cluster-wide grant) work in their projects through the signed per-user identity claim (the cluster must trust the fleet), live updates of plans, drafts and the topology included; without a trusted fleet the topology refreshes periodically instead. Only the native-only items show "Not available through the fleet" (VPN devices and linked Git accounts of the fleet's service user, trusted fleets); the recovery kit's shares are handled in the cluster's own console, approvals too unless the cluster trusts the fleet ([Approvals through the fleet](./features/fleet.md#approvals-through-the-fleet), **Admin › Trusted fleets** in the cluster's own console). In production, allow the fleet's origin in `CSP_CONNECT_SRC_EXTRA` if needed. Without `mode` (or with `"cluster"`) the console behaves as described on this page. **Local development** (`nx serve loadweaver-frontend-console`) uses fleet mode by default against the local fleet service on `http://localhost:3500` (start it with `nx run loadweaver-backend-fleet:start-containers`); remove `mode` in `environment.console.ts` to talk to one control plane on port 3400 directly. Production builds stay single-cluster unless the runtime configuration sets `mode`.

### Authentication

The console uses the shared ForePath identity screens. `authentication.config.type` must match the control plane's `AUTHENTICATION_METHOD`:

| Type       | Login                                                                                                                                                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`    | Built-in accounts: login with email and password, optional registration (`disableSignup`), password reset, email confirmation, two-factor authentication (authenticator app or email). The first registered user becomes the administrator. |
| `keycloak` | Single sign-on through Keycloak (`authServerUrl`, `realm`, `clientId`).                                                                                                                                                                     |
| `api-key`  | A static API key, mainly for tests and local development.                                                                                                                                                                                   |

With `users` and `keycloak` the top bar also offers **Security** (`/settings/security`, password and 2FA, `users` only) and the **Account** popover **Tokens** (`/account/tokens`, personal access tokens with [scopes](./features/projects-and-access.md) for the CLI and automation). Socket.IO namespaces accept interactive sessions only, so live features need a console login, not a personal access token.

#### Email and two-factor login

With `users`, login requires an email code (forced two-factor login) unless `DISABLE_FORCE_LOGIN_2FA=true`. **The email code is only required once the control plane can send email**: `SMTP_HOST` and `SMTP_PORT` are set in the control-plane environment (`SMTP_USER` / `SMTP_PASSWORD` for authenticated SMTP, port 465 for SMTPS, sender `EMAIL_FROM`). Until then:

- logins succeed with email and password alone (no code could arrive), and the control plane logs a warning at start;
- accounts that turned on email two-factor themselves sign in without the code as well, and email two-factor can't be turned on; an **authenticator app (TOTP) is always enforced**, so set one up;
- cluster admins see the warning "Email is not configured — two-factor login is not enforced" in the console (`emailLogin2faSuspended` on `GET /api/access/me`).

Clusters created with `loadweaver-agent bootstrap` without email flags and Loadweaver Cloud clusters start without SMTP, so the first administrator can sign in right after the claim. Alert and report emails need SMTP too. Like the other Forepath apps, Loadweaver takes SMTP from the environment only (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM`, `EMAIL_COMPANY_*`); there is no email settings page or API.

**Setting SMTP when creating a cluster.** `loadweaver-agent bootstrap` takes the email settings of the new cluster:

```bash
printf '%s' 'the-smtp-password' | sudo install -m 600 /dev/stdin /root/smtp-password
sudo loadweaver-agent bootstrap --name n1 --public-host n1.example.com \
  --smtp-host smtp.example.com --smtp-port 587 --smtp-user loadweaver \
  --smtp-password-file /root/smtp-password --email-from 'Loadweaver <noreply@example.com>'
```

| Flag                                                                                                                                                                                                                      | Control-plane variable                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `--smtp-host`                                                                                                                                                                                                             | `SMTP_HOST`                                              |
| `--smtp-port` (default 587; 465 is SMTPS)                                                                                                                                                                                 | `SMTP_PORT`                                              |
| `--smtp-user` + `--smtp-password-file` (or `LOADWEAVER_SMTP_PASSWORD`; never on the command line)                                                                                                                         | `SMTP_USER`, `SMTP_PASSWORD`                             |
| `--email-from` (`name@example.com` or `Name <name@example.com>`)                                                                                                                                                          | `EMAIL_FROM`                                             |
| `--email-company-name`, `--email-company-address`, `--email-company-postal-code`, `--email-company-city`, `--email-company-country`, `--email-company-vat-id`, `--email-company-email` (sender block in the email footer) | `EMAIL_COMPANY_NAME`, `EMAIL_COMPANY_ADDRESS_LINE1`, ... |

The settings are part of the control-plane environment: every control-plane member gets them, and the DR envelope keeps them (the SMTP password encrypted with the other secrets), so a cluster restored with `bootstrap --restore` keeps sending email (the email flags are refused with `--restore`).

**Changing SMTP later.** The control-plane environment of a running cluster can't be edited: each control-plane member gets it from the replicas (and a restore takes it from the DR envelope), and there is no command or API to change it yet. To add or change SMTP, create the cluster again with `loadweaver-agent bootstrap` and the email flags above (`bootstrap --restore` refuses them and brings back the environment of the backup). Until then, keep an authenticator app set up: it is enforced whether or not email is configured.

## Roles and what the console shows

- **Cluster roles** (cluster admin, infra operator, auditor) see the whole cluster, including the infrastructure pages (Import hosts, Drift, Updates, Certificates, Device posture, platform backups and the recovery kit), the Placement view of the resource tree with sites and nodes, and traffic on the topology. Their landing page is the cluster's **Summary** (`/resources/cluster`).
- **Project roles** (admin, operator, developer, viewer) see their projects' part of every page. Infrastructure pages are hidden from the sections' sub-navs, the resource tree opens in the **Projects** view, and `/` lands on their first project's **Summary** (`/resources/project/<name>`).
- **Members & projects** and **Git** are shown to everyone with any cluster or project role, **Wallboards** to cluster admins and project admins, **Secrets** to cluster admins and project admins / operators.
- Object tabs follow the same rules: **Options**, **Shell**, **Updates** and a site's **Network** for cluster roles, **Permissions** for cluster admins, **Files** in fleet mode only with the admin grant.
- The rail is stable per role: pages inside a section are hidden, the section's tile stays; a tile disappears only when none of its pages is visible.

## Navigation

The console is a fixed frame: top bar, a flat **function rail** on the left, the page, and the task dock at the bottom of the page. The page itself never scrolls; every column (tree, list, detail, inspector) scrolls on its own.

### Rail and sections

Every rail tile is one click and opens the first page of its section you may see. A section's pages are its **sub-nav**, a vertical tab list with headings next to the page (hidden when the section has a single page for you, a select on phones).

| Section       | Pages (sub-nav heading: pages)                                                                                             | Shortcut |
| ------------- | -------------------------------------------------------------------------------------------------------------------------- | -------- |
| **Setup**     | The cluster's setup checklist (`/setup`): its external providers and cluster-wide settings, with state, edit and test      | `g s`    |
| **Resources** | The resource tree and the object pages (`/resources/…`), create wizards (`/create/…`)                                      | `g r`    |
| **Activity**  | Plans, Drafts, Tasks, Audit                                                                                                | `g a`    |
| **Observe**   | Health & alerts: Health, Alerts, SLOs, Status · Telemetry: Logs, Metrics, Topology · Reporting: Reports, Usage, Wallboards | `g o`    |
| **Operate**   | Live access: Terminals, Files, Sessions · Data: Backups, Restores, Deletions, Platform, Recovery kit · Hosts: Import hosts | `g p`    |
| **Delivery**  | Source: Git, SOPS, Secrets, Drift · Releases: Updates · Edge: Certificates, DNS                                            | `g d`    |
| **Access**    | Members & projects, Devices, Device posture                                                                                | `g c`    |

At the bottom of the rail:

- **Account**: **Tokens** (`/account/tokens`, personal access tokens; `users` / `keycloak` authentication) and **Git accounts** (`/account/git-accounts`).
- **Admin**: **Webhooks** (`/webhooks`, cluster admins), **Trusted fleets** (`/settings/trusted-fleets`, cluster admins, the cluster's own console only), **Users** (`/users`, user management for global admins with `users` or `keycloak` authentication) and **Updates** (`/updates/announcements`, the release announcements of the shared updates feature, for global admins and the API key; a dot on **Admin** and **Updates** marks news there).

Both open as popovers (Enter or Space opens a focused one, Escape or a click outside closes it). **Operate › Backups › Deletions** shows the number of open deletion requests.

### Top bar

- **Search and command palette:** the search field, or **Ctrl + K** / **Cmd + K** anywhere (see [Search and shortcuts](#search-and-shortcuts)).
- **Create ▾:** Deployment, Virtual machine, Volume, Policy, DNS record, or **Other kind (YAML)** — opens the [create wizard](#create-wizards).
- **Draft chip** ("Draft: N"): opens the [draft tray](#drafts-and-the-draft-tray).
- **Running tasks:** a spinner with the number of running tasks while something runs; it opens the [task dock](#task-dock).
- **Density:** compact (default) or comfortable, stored per user, so it follows you across browsers.
- **Saved views:** named list states (search query, filters, columns, sort) and console settings (density, the tree's view and favourites) are stored per user on the control plane. Each view belongs to one list (`scope`, e.g. `contents`, `audit`, `plans`; console settings use `settings`), names are unique per list, at most 200 views per user and 16 KiB of state each; creating, changing and deleting a view is audited (`view.create` / `view.update` / `view.delete`). In fleet mode views are yours on that cluster when the cluster trusts the fleet (stored for `fleet:<issuer>:<user>`, never for the fleet's service user). API: `GET /views?scope=`, `POST /views`, `PATCH /views/{id}`, `DELETE /views/{id}` (scope `cluster:read`).
- **Language:** English and German. Each locale is its own build, so switching reloads the page under `/en/…` or `/de/…`.
- **Theme:** light or dark, stored in the browser.
- **Notifications, security, logout:** the notification indicator, **Security** (`/settings/security`, password and 2FA, with a reminder while no authenticator app is set up; `users` authentication) and logout, optionally from every session.

## Resources

### Resource tree

**Resources** shows a tree column next to the object page (drag its edge between 240 and 480 px; `[` collapses it). It has its own search and four views:

| View          | Structure                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Placement** | Cluster → sites → nodes → services, virtual machines and volumes on them; projects; unplaced and cluster-level items (default for cluster roles) |
| **Projects**  | Projects → kinds → items (default for project members)                                                                                           |
| **Kind**      | Kinds → items                                                                                                                                    |
| **Labels**    | Label keys and values → items                                                                                                                    |

Each entry shows a health dot, a ● when the active draft changes it and a count of its children. Right-click (long-press on touch) opens the item's actions — the same as in its header — and **Pin to favourites**; favourites are pinned on top. The tree's search uses the [search syntax](#search-syntax) (`kind:`, `project:`, `status:`, `health:`, `node:`, `site:`, `label:`) and keeps the ancestors of every match. Opening an object anywhere (search, links, Contents) selects it in the tree and expands its ancestors. The view and the favourites are stored per user.

### Object pages

Every object has one page with a header and tabs; the tab is in the URL (`?tab=`, an unknown tab falls back to **Summary**).

| Object           | Route                                                                                                                                                                                                           |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cluster          | `/resources/cluster` (also `/resources`)                                                                                                                                                                        |
| Site             | `/resources/site/<name>` (`?join=1` opens **Add a node**)                                                                                                                                                       |
| Node             | `/resources/node/<name>`                                                                                                                                                                                        |
| Project          | `/resources/project/<name>`                                                                                                                                                                                     |
| Any other object | `/resources/<kind>/<project>/<name>`, kind in lower case, `-` as project for cluster-level kinds (e.g. `/resources/deployment/shop/web`, `/resources/virtualmachine/shop/vm1`, `/resources/policy/-/allow-dns`) |

The **header** shows breadcrumbs (Cluster › project › site › node › object), the kind's icon, the name, the health badge, a ● when the draft changes the object, the primary actions and **More ▾** with the rest. The Cluster and Project headers have **Create**, the Cluster header **Join node** (installer line for a new node, roles that may add nodes). The **Join tokens** tab of the Cluster (all sites) and of a site (its tokens) lists the tokens (prefix, site, description, labels, status Active / Used / Revoked / Expired, expiry) with search, **Add a node** and **Revoke** for active ones; it is shown to the roles that may add nodes (infra operators and cluster admins; through the fleet only the cluster-wide admin grant — the installer itself is served by the cluster, so the dialog links its own console).

| Object                 | Tabs                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ |
| Cluster                | Summary, Contents, Topology, Policies, Options, Permissions, Join tokens, Task history                       |
| Site                   | Summary, Contents, Topology, Network, Join tokens, Task history                                              |
| Node                   | Summary, Workloads, Volumes, Health, Metrics, Logs, Shell, Updates, Task history                             |
| Deployment             | Summary, Replicas, Spec, Health, Logs, Metrics, Terminal, Files, Backups, Autoscaling, Network, Task history |
| Virtual machine        | Summary, Console, Hardware, Spec, Snapshots, Backups, Health, Metrics, Logs, Task history                    |
| Volume                 | Summary, Backups, Files, Task history                                                                        |
| Project                | Summary, Contents, Topology, VM images, Members, Secrets, Requests, SLOs, Usage, Git, Task history           |
| Policy, workload group | Summary, Members, Spec, Task history                                                                         |
| Other kinds            | Summary, Spec, Task history                                                                                  |

- **Summary** of the cluster and of a project: the health headline, the summary bar and two lanes, **Needs attention** (critical first, then oldest first; every item links to where it's resolved; Git items — default branch ahead, rejected push, connection error — link to the plan or the connection) and **Recent activity**. Cluster roles see the whole cluster, project members their project. See [overview and health](./features/overview-and-health.md).
- **Summary** of a site: its facts and how many of its nodes are healthy. Of a node: lifecycle, connection and apply state, capacity, network and system. Of a resource: its metadata and YAML (and a `Deployment`'s compose file) read-only.
- **Contents**, **Policies** (Cluster: Contents filtered to `kind:Policy`), **Workloads** / **Volumes** (node) and **Replicas** (deployment) are [Contents tables](#contents).
- A node's **Workloads** tab also lists, below the workloads, a read-only **Platform** group: the platform components the node runs from its desired state (etcd, PostgreSQL with its leader / replica role, job queue, control-plane API replica — pending until the database handover, log store, object-store generations, registry and its mirrors, ingress, authoritative DNS, VPN gateway, external BGP, rate limiter, backup repository servers), each with its state from the agent's last apply (running, failed with the error, unknown) and a short detail (`GET /api/nodes/:name/platform`).
- **Topology** (Cluster, Site, Project): the [topology](./features/topology-map.md#console) limited to that scope, live only, with a link to **Observe › Topology**.
- The `Cluster` resource itself (network, access, services, operations) is edited like every resource: **More ▾ › Edit in draft** (or `e`) on the cluster page, cluster admins. **Permissions**: links to **Access › Members & projects** (cluster admins).
- **Health**: the object's explained health with its descendants and state history. **Autoscaling**: replicas within the range, the metric against its target, the last evaluation and scaling, and why a scale-up is blocked.
- **Members**: a policy's peers with their current members, or the workloads a group selects. See [groups and policies](./features/groups-and-policies.md).
- **VM images** (Project): the project's VM image imports with progress, the images in its registry and, for operators, **Import VM image** (URL, SHA-256, repository and tag, architecture, firmware, guest agent).
- **Logs**, **Metrics**, **Shell**, **Terminal**, **Files**, **Backups**, **Updates**, **Network**, and a project's **Members**, **Requests**, **SLOs**, **Usage** and **Git** open the matching section page filtered to the object (e.g. **Observe › Logs** with `?project=shop&deployment=web`).
- **Task history**: two lanes, **Plans** (the plans whose changes touch the object) and **Events** (its audit entries), with **Open all** to the full lists.

Virtual machine tabs: **Summary** (status with the guest's power state, machine and pinned image, NICs with MACs, groups and addresses, disks with primary and copies, recent node commands), **Console** (serial console: terminal panel, boot log first, recorded badge, reconnect; graphical console: noVNC with Ctrl+Alt+Del), **Hardware** (the friendly view of machine, disks and NICs), **Spec** (the full `VirtualMachine` resource: form / YAML / draft, like every other kind) and **Snapshots** (linking to their backups). The header has the actions the VM's state and your role allow (power ▾: start, stop, shutdown, force off, reboot, reset; take snapshot; reimage), each confirmed. Consoles follow the terminal rules: operators and admins, developers with `developerExec`. See [virtual machines](./features/virtual-machines.md).

Node actions (cordon, drain, leave, confirm lost, …) are the lifecycle actions the API offers for the node's state: runtime actions, not plans, each confirmed first. A node's declarative part (site, labels, the KVM opt-out `virtualization.kvm: disabled`) is a `Node` resource and changes through its Spec and a plan. See [nodes and joining](./features/nodes-and-joining.md).

### Contents

**Contents** is one table of the items in a scope (cluster, site, node, project, deployment), from the same model as the tree. The toolbar has the search (with `field:value` chips), the column chooser and refresh; rows show health, a ● for draft changes, their primary action and **More ▾**. Filters are in the URL: `?q=` and the link filters `?kind=`, `?project=`, `?status=` (they become terms of the search, e.g. `/resources/cluster?tab=contents&kind=Node`).

**Batch actions** on the selected rows: **Label in draft** (`key=value`), **Delete in draft** (one confirmation), and the immediate actions every selected row offers (node lifecycle, VM power, backup now, …) behind one confirmation.

### Editing: Spec, drafts and plans

Editing never applies. Changes go into a **draft**, shared with everyone who may change the same projects, and become a plan when you submit it.

- **Spec tab** (`?tab=spec`, or `e` on an object page): **Form** (generated from the kind's JSON Schema, `GET /schemas/{kind}`) or **YAML** (Monaco, validated while typing; a `Deployment`'s compose file has its own editor). **Draft vs live** shows the live YAML read-only beside the edited one with line highlights (changed lines on both sides, added lines on the draft side, removed lines on the live side); the Form marks every field whose value differs from live (Changed / Added / Removed, the live value as a hint and tooltip) with **Revert field**; a badge marks a resource **Changed in the draft**. **Save to draft** (primary) stores the change; changing the kind, name or project saves a rename (the old resource is deleted). **Undo in draft** drops the object's change. **Plan now** skips the draft and creates a plan (`POST /plans`) right away; in a Git-authoritative scope the editor says so first (the control plane turns the plan into a pull request, linked from the plan as soon as it exists).
- **Delete:** the header's **Delete**, `Del` on an object page, **Delete in draft** in Contents, or the tree's context menu put the deletion into the draft.
- **Topology:** with **Edit on map** on, dragging a service or VM to another node or site writes into the same draft (see [topology](./features/topology-map.md#console)).

#### Drafts and the draft tray

The **Draft** chip in the top bar opens the tray, on every page:

- the draft's title (rename) and its changes, each linking to its object page, with **Undo** per change;
- **conflicts** when a resource changed in the cluster meanwhile: **Keep mine** or **Take current**; collaborators' edits appear live;
- **Preview** runs a dry-run plan: changes, replica moves, warnings, issues and risk, and **Show on map** (`/observe/topology?draft=<id>`) marks them on the topology;
- **Submit as plan** opens the ordinary plan (`/activity/plans/<id>`) for review, approval and apply (in Git-authoritative scopes as a pull request titled with the draft); **Discard**; switch to another draft or start a **New draft**.

`?draft=<id>` on any console URL opens that draft. Objects the draft changes carry a ● in the tree, in Contents, in their header and in the topology inspector. API: `/drafts`, `POST /drafts/{id}/preview`.

#### Create wizards

`/create/<kind>` (from **Create ▾** in the top bar, the Cluster and Project headers, and the create buttons on the backups, updates, DNS and status pages):

| Kind                                                           | Steps                                                                     |
| -------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Deployment                                                     | General → Workload → Placement → Network → Review                         |
| VirtualMachine                                                 | General → Source image / import → Hardware → Placement → Network → Review |
| Other typed kinds (Volume, Policy, DnsRecord, BackupPolicy, …) | General → Settings → Review                                               |

General asks for name and project. **Edit as YAML** switches every step to the same document as YAML (nested lists such as a VM's disks and NICs are edited there). Review offers **Preview now** and **Add to draft**, which opens the new object's page. `/create` without a kind is **Other kind**: YAML only. The VM wizard's source step links to the project's **VM images** tab for new imports.

#### Immediate actions

Runtime actions — node lifecycle, VM power, snapshots and reimage, backup now, restore tests, DNS fail-back, access changes — are not drafts: they run right away after a confirmation (disruptive ones are also in the context menus) and show up in the task dock.

## Task dock

The dock at the bottom of the page (collapsible, resizable, remembered; `` ` `` toggles it; the running badge in the top bar opens it):

- **Tasks:** plan applies and rollbacks (running, and finished within 24 hours), update rollouts with progress, restores and restore tests, node drain / leave / import, and in fleet mode the fleet's operations — each with status, progress and a link. Controls where the API has them: **Cancel** an applying plan, **Pause** / **Resume** / **Cancel** an update rollout, **Cancel** a running or waiting fleet operation (each asked first).
- **Events:** alert fires and resolves and the latest audit entries.

Each tab has its own filter and **Open all** (→ **Activity › Tasks** or **Activity › Audit**). The dock refreshes every 10 seconds while open and every 30 seconds while closed. **Activity › Tasks** (`/activity/tasks`) shows the same feed as a table with the same **Cancel** / **Pause** / **Resume** controls (cancel asks first).

## Drafts

**Activity › Drafts** (`/activity/drafts`, `/activity/drafts/<id>`) lists the server-side drafts: title, owner, the projects they touch, the number of changes, the last change and the status (**Open** live; **Submitted** and **Discarded** on demand), with a search and **New draft**. A draft opens in the detail lane (≥ xl beside the list): its facts and changes (each links its object page) and, while open, **Open in tray**, **Preview** (dry run: changes, workload moves, warnings, issues, risk, conflicts, **Show on map**), **Submit as plan** and **Discard** (asks first). These actions make it your active draft, so the tray and the Spec tabs continue with it. A submitted draft links its plan.

## Search and shortcuts

### Search and command palette

The top-bar search or **Ctrl + K** / **Cmd + K** opens the palette. Results are grouped by kind (favourites first); without a query it lists recently opened items and favourites. Scope tokens narrow it: `in:project/shop`, `kind:VirtualMachine`. On an object page it also offers **go to tab** commands for that page. Enter opens the object page and reveals it in the tree, Ctrl-click opens it in a new tab; API actions run after a confirmation. `/search?q=…` shows all results (with the star for favourites). In fleet mode favourites are yours on that cluster when the cluster trusts the fleet (Trusted fleets); otherwise the star is hidden with a hint. API: `GET /search`, `GET /search/favorites`, `POST /search/recent`. See [search and wallboard](./features/search-and-wallboard.md).

### Search syntax

The tree, Contents, the topology and the lists share one syntax: free text, `field:value`, quoted values (`label:"tier=web"`), and `-field:value` to exclude. Terms are combined with AND and shown as chips you can remove. The query is in the URL (`?q=`, filters `?f=`), so a filtered list can be linked.

### Shortcuts

| Keys                                 | Action                                                         |
| ------------------------------------ | -------------------------------------------------------------- |
| Ctrl + K / Cmd + K                   | Search and command palette                                     |
| `/`                                  | Search                                                         |
| `g` then `s` `r` `a` `o` `p` `d` `c` | Setup, Resources, Activity, Observe, Operate, Delivery, Access |
| `` ` ``                              | Task dock                                                      |
| `[`                                  | Resource tree column                                           |
| `?`                                  | Keyboard shortcuts (also **Account › Keyboard shortcuts**)     |
| `e`                                  | Object page: Spec tab                                          |
| `Del`                                | Object page: delete into the draft                             |
| `F`, right-click on the background   | Topology: fit the map to the view                              |
| Escape                               | Close the palette, popover or dialog                           |

Keys typed into fields and editors are never shortcuts. In the palette, ↑ / ↓ move between results and Enter opens one.

## Lists and master-detail

**Views ▾**: every list toolbar (the Contents and Tasks tables, Plans, Drafts, Alerts, Audit, Logs, Backups, restores and deletions, Certificates, Git, Updates, DNS, Members & projects, Devices, the fleet lists, Search, Topology and the other section lists) and the resource tree (scope `tree`: view, filter, expanded branches) offer saved views: **Save current view…** stores the search, filters, columns, sort and the density under a name (an existing name is updated), a click applies a view (the matching one is ticked), the pencil renames and the bin deletes one (asks first). Views are per user and list, stored on the control plane (see [Top bar](#top-bar)).

Pages with several lists use **lanes**: each list in its own column with a header (title, count, actions), its own search and its own scroll — **Members & projects** (Cluster | Members | Settings & requests), **Devices** (devices | enrolment), **DNS** (records; zones | providers; DNSSEC; failovers), **Backups › Restores** (Restores | Restore tests) and **› Deletions** (Open | History), **Updates** (Releases | Rollouts | Windows; Overview: Policy | Nodes), **Delivery › Drift** (Default branch ahead | Failed rollbacks | Foreign containers | Delegated), **Operate › Sessions** (replay | sessions | tunnels), **› Backups › Platform** (per kind | point-in-time recovery | external copy and DR), **› Backup diff** (Added | Removed | Changed), **Access › Device posture** (integrations | device certificates), **Wallboards**, **Trusted fleets**, **Account › Git accounts** and the detail parts of object tabs (node, VM, policy, health, alert, update rollout, plan tabs, fleet cluster). Pages with one main list and its facts or forms use a **workbench** (main lane + 360 px side lane): **Import** (workloads | join plan), **Files** (browser | preview), **Backup keys** (generations | disaster recovery), a backup (files | details), a resource's Summary (YAML | metadata). Only genuine dashboards keep a card grid under the summary bar (Health, Metrics, SLOs, fleet overview / compare). The page itself never scrolls; every lane scrolls on its own. On phones a tab switch picks the lane.

On wide screens (≥ xl) **Plans**, **Alerts**, **Backups**, **Certificates** and **Git** show the list and the open item side by side; **Drafts** and **Updates › Rollouts** work the same; the detail route (`/activity/plans/<id>`, `/activity/drafts/<id>`, `/observe/alerts/<id>`, `/operate/backups/<id>`, `/delivery/certificates/<id>`, `/delivery/git/<id>`, `/delivery/updates/rollouts/<id>`) stays the deep link. An open rollout takes the place of the Releases and Windows lanes beside the Rollouts lane. With no alert open, the detail lane of **Alerts** shows the current and upcoming silences. Below xl one lane is shown at a time and browser back returns to the list.

## Phones

Below the md breakpoint the rail becomes a **bottom tab bar** (the first five tiles and **More**, a sheet with the remaining tiles, the fleet level, Account and Admin), the resource tree an **off-canvas drawer** (closes on navigation), the task dock a **full-screen sheet**, lanes switch with a **tab group**, sub-navs become a select and the topology's inspector a bottom sheet. Editing works on phones too.

## Pages

**Setup** (`/setup`, the first rail tile, cluster roles; the cluster's setup checklist): every external provider and cluster-wide setting of the cluster in one list, grouped by area — Git connections and the GitHub App / GitLab application of the plan bot, DNS providers and registrars, failover-IP providers (`IpPool` with `failover: provider`), backup targets and the control-plane backup targets, SIEM forwarding (with its delivery state: forwarded, failures, last error) and alert emails, webhooks, ACME and custom certificates, registry mirrors, the release source, BGP peers and RPKI validators, and device posture. Each row shows its state (configured, failing, not set up). **⋮ Edit** opens the resource in the edit modal — Cluster settings on the right step (Services: Git, registry, ACME; Operations: SIEM, alert emails, updates, backups) —, **Set up** creates the first one of a kind, **Open** goes to the dedicated page (Git connections, posture, webhooks, certificates, updates), and **Test connection** checks DNS providers, backup targets, failover-IP providers and SIEM targets with their stored credentials (the result shows as the row's state and a notice; the test is audited). Who may do what follows the usual rules: editing like drafting the resource (cluster admins and infra operators for cluster-wide kinds, cluster admins for the Cluster's settings), tests for infra operators and cluster admins (SIEM targets: cluster admins). Cluster admins also see what is **set in the environment** (email / SMTP, OTLP export, GeoIP database, release checks, posture sync, the master-key KMS, sign-in method, loaded plugins) — read-only and without secrets; those are changed in the control plane's environment. In fleet mode the page works for the open cluster through the relay.

| Page                   | Route                                                                                                                                                        | Who                                                                                                                              | API                                                                                                                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Landing                | `/` → `/resources/cluster` (project members: `/resources/project/<first project>`)                                                                           | Everyone signed in                                                                                                               | `GET /access/me`                                                                                                                                                                                                                     |
| Cluster                | `/resources/cluster` (`?tab=summary\|contents\|topology\|policies\|options\|permissions\|tokens\|history`)                                                   | Everyone signed in (scoped); Options, Permissions see above                                                                      | `GET /overview`, `GET /health/tree`, `GET /topology`, `GET /resources`, `GET /nodes`                                                                                                                                                 |
| Site, node             | `/resources/site/<name>` (`?join=1`), `/resources/node/<name>`                                                                                               | Cluster roles                                                                                                                    | `GET /nodes`, `POST /nodes/{name}/…`, `/join-tokens`                                                                                                                                                                                 |
| Project                | `/resources/project/<name>`                                                                                                                                  | Members of the project, cluster roles                                                                                            | `GET /overview?project=`, `/projects/{project}/vm-images…`                                                                                                                                                                           |
| Object                 | `/resources/<kind>/<project or ->/<name>` (`?tab=`, `?tab=spec` to edit)                                                                                     | Everyone (scoped); editing for writers                                                                                           | `GET /resources`, `GET /schemas`, `GET /schemas/{kind}`, `/drafts`, `POST /plans`                                                                                                                                                    |
| Virtual machine        | `/resources/virtualmachine/<project>/<name>` (`?tab=console\|hardware\|snapshots\|…`)                                                                        | Project members (power and consoles: operators, admins, developers with `developerExec`)                                         | `GET /virtual-machines`, `GET /projects/:p/virtual-machines/:name`, `socket/consoles`                                                                                                                                                |
| Create                 | `/create/<kind>`, `/create` (YAML)                                                                                                                           | Developers and up, cluster roles                                                                                                 | `GET /schemas/{kind}`, `/drafts`, `POST /drafts/{id}/preview`                                                                                                                                                                        |
| Plans                  | `/activity/plans`, `/activity/plans/<id>`                                                                                                                    | Everyone (scoped)                                                                                                                | `GET /plans`, `GET /plans/{id}`, `POST /plans/{id}/…`, `socket/plans`                                                                                                                                                                |
| Drafts                 | `/activity/drafts`, `/activity/drafts/<id>`                                                                                                                  | Everyone (scoped)                                                                                                                | `GET /drafts?status=`, `GET /drafts/{id}`, `POST /drafts/{id}/preview`, `POST /drafts/{id}/submit`, `POST /drafts/{id}/discard`                                                                                                      |
| Tasks                  | `/activity/tasks`                                                                                                                                            | Everyone (scoped)                                                                                                                | `GET /plans`, `GET /updates/rollouts`, `GET /nodes`, `GET /backups/restores`                                                                                                                                                         |
| Audit log              | `/activity/audit`                                                                                                                                            | Auditors, cluster admins; project admins (scoped)                                                                                | `GET /audit`, `GET /audit/export`, `GET /cluster/audit/verify`                                                                                                                                                                       |
| Health                 | `/observe/health`, `/observe/health/<key>`                                                                                                                   | Everyone (scoped)                                                                                                                | `GET /health/tree`, `GET /health/history`                                                                                                                                                                                            |
| Alerts                 | `/observe/alerts`, `/observe/alerts/<id>`                                                                                                                    | Everyone (scoped)                                                                                                                | `GET /alerts`, `POST /alerts/{id}/…`, `/alerts/silences`, `GET /alerts/export`                                                                                                                                                       |
| SLOs                   | `/observe/slos`                                                                                                                                              | Everyone (scoped)                                                                                                                | `GET /slos`                                                                                                                                                                                                                          |
| Status pages           | `/observe/status-pages`                                                                                                                                      | Everyone (scoped); incidents written by project operators                                                                        | `GET /resources`, incidents per project                                                                                                                                                                                              |
| Logs                   | `/observe/logs`                                                                                                                                              | Everyone (scoped)                                                                                                                | `GET /logs`, `GET /logs/export`, `socket/logs`                                                                                                                                                                                       |
| Metrics and dashboards | `/observe/metrics`                                                                                                                                           | Everyone (scoped)                                                                                                                | `GET /metrics/names`, `GET /metrics/query`, `GET /metrics/events`, `POST /dashboards/query`                                                                                                                                          |
| Topology               | `/observe/topology` (`?select=`, `q`, `layers`, `mode`, `plan`, `at`, `draft`)                                                                               | Everyone (scoped); traffic and timeline for cluster roles; editing for writers                                                   | `GET /topology`, `GET /topology/trace`, `POST /topology/preview`, `/drafts`, `socket/topology`, `socket/plans`                                                                                                                       |
| Reports                | `/observe/reports`                                                                                                                                           | Everyone (scoped)                                                                                                                | `GET /reports`, `POST /reports/run`, `/reports/files…`                                                                                                                                                                               |
| Usage                  | `/observe/usage`                                                                                                                                             | Everyone (scoped; all projects for cluster roles)                                                                                | `GET /projects/{project}/usage`, `GET /usage`, `…/usage/export`                                                                                                                                                                      |
| Wallboards             | `/observe/wallboards`                                                                                                                                        | Cluster admins, project admins                                                                                                   | `/wallboards`                                                                                                                                                                                                                        |
| Terminals              | `/operate/terminals`                                                                                                                                         | Project operators (developers if allowed), cluster admins                                                                        | `socket/terminals`                                                                                                                                                                                                                   |
| Files                  | `/operate/files`                                                                                                                                             | Project operators and admins                                                                                                     | `/live/files`, `/live/files/content`                                                                                                                                                                                                 |
| Sessions and tunnels   | `/operate/sessions`                                                                                                                                          | Auditors, cluster admins, project admins                                                                                         | `GET /live/sessions`, `GET /live/tunnels`                                                                                                                                                                                            |
| Backups                | `/operate/backups` (`?project=`), `/operate/backups/<id>` (`?path=`), `/operate/backups/diff?from=&to=`, `…/restores`, `…/deletions`, `…/keys`, `…/platform` | Everyone (scoped); operators back up / restore / test, admins request and approve deletions; the recovery kit for cluster admins | `GET /backups/status`, `GET /backups…`, `/backups/{id}/files`, `/backups/{id}/download`, `/backups/diff`, `POST /backups/now`, `/backups/restores`, `/backups/restore-tests`, `/backups/deletions…`, `/backups/keys…`, `POST /plans` |
| Import hosts           | `/operate/imports`, `/operate/imports/<node>`                                                                                                                | Cluster roles (read), infra operators and cluster admins (change)                                                                | `/imports`, `/imports/{node}/…`                                                                                                                                                                                                      |
| Git                    | `/delivery/git`, `/delivery/git/<id>` (`?connection=<id>`)                                                                                                   | Readers of the scope; scope admins manage                                                                                        | `/git/connections…`, `GET /git/sops/recipient`                                                                                                                                                                                       |
| Drift                  | `/delivery/drift`                                                                                                                                            | Cluster roles                                                                                                                    | `GET /drift`, `POST /drift/plans`                                                                                                                                                                                                    |
| Updates                | `/delivery/updates` (`?tab=`), `/delivery/updates/rollouts/<id>`                                                                                             | Cluster roles; cluster admins act                                                                                                | `GET /updates/status`, `/updates/releases…`, `POST /updates/bundles`, `/updates/rollouts…`, `GET /resources?kind=MaintenanceWindow`                                                                                                  |
| Certificates           | `/delivery/certificates`, `/delivery/certificates/<id>`                                                                                                      | Cluster roles                                                                                                                    | `/certificates…`                                                                                                                                                                                                                     |
| DNS                    | `/delivery/dns`                                                                                                                                              | Everyone (scoped); zones, DNSSEC and failover for cluster roles                                                                  | `GET /resources`, `GET /dns/zones`, `GET /dns/dnssec`, `/dns/failover`                                                                                                                                                               |
| Members & projects     | `/access/members` (`?project=`), `/access/requests/<project>`                                                                                                | Any cluster or project role                                                                                                      | `/access/me`, `/cluster/members`, `/projects/{project}/…`, `/access/export`, `/access/import`                                                                                                                                        |
| Devices                | `/access/devices`                                                                                                                                            | Everyone (own devices); all clients for infra operators and cluster admins                                                       | `GET /vpn/devices`, `DELETE /vpn/devices/{id}`                                                                                                                                                                                       |
| Device posture         | `/access/posture`                                                                                                                                            | Infra operators (read), cluster admins (edit)                                                                                    | `GET /posture/plugins`, `/posture/integrations`, `/posture/certificates`; `POST` / `PATCH` / `DELETE /posture/integrations…`, `PUT /posture/certificates`                                                                            |
| Search                 | `/search?q=`                                                                                                                                                 | Everyone signed in                                                                                                               | `GET /search`, `/search/favorites`                                                                                                                                                                                                   |
| Access tokens          | `/account/tokens`                                                                                                                                            | Everyone signed in (`users` / `keycloak`)                                                                                        | personal access tokens                                                                                                                                                                                                               |
| Linked Git accounts    | `/account/git-accounts`                                                                                                                                      | Everyone signed in (own accounts)                                                                                                | `GET /git/accounts`, `POST /git/accounts/{provider}/authorize`, `GET` / `DELETE /git/accounts/pending/{nonce}`, `POST /git/accounts/confirm`, `DELETE /git/accounts/{id}`                                                            |
| Admin                  | `/webhooks`, `/settings/trusted-fleets`, `/users`, `/updates/announcements`                                                                                  | See [Rail and sections](#rail-and-sections)                                                                                      | `/trusted-fleets…`; webhooks, users and announcements from the shared admin features                                                                                                                                                 |
| Fleet                  | `/fleet`, `/fleet/clusters`, `/fleet/clusters/<id>`, `/fleet/compare`, `/fleet/operations`, `/fleet/audit`; `/clusters/<id>/<path>` enters a cluster         | Fleet mode, see [Fleet](./features/fleet.md#console-fleet-mode)                                                                  | the fleet's API                                                                                                                                                                                                                      |
| Kiosk                  | `/kiosk#<token>`                                                                                                                                             | No login (wallboard token)                                                                                                       | `GET /public/wallboard`                                                                                                                                                                                                              |

### Plans

**Activity › Plans** lists the newest plans with status, author, creation time and the projects they touch, filtered by status and project and updated live over `socket/plans`. A plan's page shows the resource changes (before / after), the compiled effect per network layer (tunnels, routing, policies, DNS), replica moves and the failure analysis, pins, warnings and approvals, and while it runs the progress of the apply or rollback per node and layer. Depending on its state and the caller's role: approve, apply (confirming the pins), cancel or discard. The plan's overlay on the map is at `/observe/topology?mode=plan&plan=<id>`. See [plan and apply](./features/plan-and-apply.md).

Every plan shows where it came from: **Git** (commit with short SHA and ref, pull request and author, linked to the provider when the connection is readable), the **console**, the **API**, **drift** or the **system** (fix-forward). Resources changed outside Git since the last sync are shown prominently as `git-conflict` warnings. A console, API or drift plan touching a scope where **Git is authoritative** can't be applied here: the page explains it, links the pull request (or branch) Loadweaver opened for it and disables Apply; merging the pull request creates the plan that is applied. The pull request is opened in the background after the plan is created: until it is there the page says **Pull request is being opened…** and reads the plan again every 3 seconds (for at most 2 minutes) so the link appears without a reload. A plan bot plan links the plan it **supersedes** (the console / API plan pushed as its branch), and a superseded plan links the plan that **superseded** it; the pull request links to the provider (`rel="noopener noreferrer"`, http(s) URLs only). Plan bot plans limited to one project or path say **limited to …**, and a plan lists the Loadweaver users who authored the change in Git: they can't approve it (the console hides Approve for them).

### Audit log

**Activity › Audit**: search by actor, action (exact or `prefix*`), target prefix, project, time and full text; newest first; entry details; CSV / NDJSON export. Auditors and cluster admins can verify the hash chain. Project admins see their projects' entries. See [audit and export](./features/audit-and-export.md).

### Health

**Observe › Health**: the explained health tree: cluster → site → node for cluster roles, project → deployment → service → replica for everyone who may read the project, each with its state, machine-readable reasons and since when. An entity's page (`/observe/health/<key>`, also an object's **Health** tab) shows its descendants, state changes and the time spent per state.

### Alerts

**Observe › Alerts**: firing, pending and resolved alerts with filters and CSV / JSON export; an alert's page shows what fired and why and its timeline. Alerts can be acknowledged, and silences created (rule or prefix ending in `*`, project, key, reason, time window) and ended on the list's **Silences** tab. See [alerting](./features/alerting.md).

### SLOs and status pages

**Observe › SLOs** lists availability and latency objectives of exposed services with the error budget used, burn rate and monthly uptime, most urgent first. **Observe › Status** lists the projects' `StatusPage` resources (edited as resources, opened on their hostname) and the incident notes they show, which project operators write here. See [SLOs and status pages](./features/slos-and-status-pages.md).

### Logs

**Observe › Logs**, the [log explorer](./features/logs.md): time range, sources, levels, labels and full text, newest first, paged; live tail over `socket/logs`; export. The filter lives in the URL, so other pages link to it (`/observe/logs?project=shop&deployment=web`).

### Metrics and dashboards

**Observe › Metrics**: one [metric](./features/metrics.md) over a time range, grouped and aggregated, with event markers; and the [`Dashboard` resources](./features/dashboards.md) as widget grids under a global time range and project filter. Dashboards are edited as resources.

### Topology

**Observe › Topology** (`/observe/topology`) shows the cluster as a map: sites, nodes, service stacks, VMs and volumes in a grouped layout, groups and policy edges, tunnels, storage, DNS and addressing as layers. A toolbar switches between **Live**, **Timeline** (cluster roles) and **Plan**, picks the layers, traces a hostname's path and searches with the [search syntax](#search-syntax); a 360 px inspector shows the selected item with its actions and **Open object page**. Gestures that change things (drag to place, draw a policy) are only active with **Edit on map** and write into the draft. See [topology map](./features/topology-map.md#console).

### Reports

**Observe › Reports**: [periodic reports](./features/periodic-reports.md) per scope and month, re-runs of a finished month (cluster admins and project admins), and the reports' file tree with downloads, folder archives and the printable report in a sandboxed viewer.

### Usage

**Observe › Usage**: [metered usage](./features/usage-metering.md) per project: totals per meter, a table per period (hour, day or month, UTC) and project with open periods marked, filters for project, resolution and time range, and the CSV export. Project members see their projects; cluster roles can also look at all projects at once.

### Wallboards and kiosk

**Observe › Wallboards**: wallboard tokens are read-only and can only open the kiosk view: cluster-wide tokens for cluster admins, project tokens for project admins. A new token's kiosk URL is shown once.

The kiosk (`/kiosk#<token>`) needs no login, for a screen in the office. The token is in the URL fragment, so it never reaches the console server or proxy logs; the kiosk sends it only as `Authorization: Wallboard <token>` to the control plane. It shows the health headline, what needs attention and the summary full screen, rotating per section and refreshed every 30 seconds.

### Terminals, files and sessions

- **Operate › Terminals:** pick a replica (project → deployment / service → replica) or, for cluster admins while the cluster allows it, a node shell, and work in several tabs over `socket/terminals`. Project operators and admins may open replica terminals; developers only when the project allows it. Recorded sessions show a banner. Object pages (Terminal, Shell) and the topology open a terminal directly.
- **MicroVMs:** terminals and files of [microVM](./features/isolation-levels.md#microvms) replicas work the same way and open inside the guest.
- **Operate › Files:** a replica's container filesystem (writes are lost on restart) or a volume: list, preview text and images, download, upload (chunked above 10 MB), create, delete, rename, move and copy. `?target=…&path=…` deep links.
- **Operate › Sessions:** the audited terminal session records with their recordings (download or replay in the browser), and the open debug tunnels. Tunnels are opened with the [CLI](./cli.md), not from the browser.

See [terminals, files and tunnels](./features/terminals-files-and-tunnels.md).

### Backups

**Operate › Backups**, the backup catalog (3.20). Project members see their projects' backups (the API scopes everything), cluster roles the whole cluster. The section's sub-nav has **Backups**, **Restores**, **Deletions** (with the number of open requests), **Platform** and **Recovery kit**. See [backups](./features/backups.md).

- **Overview** (`/operate/backups`, `?project=` filters): the backup pins (no confirmed recovery kit, no off-cluster copy), the state of the backup key's recovery kit (with a link to the kit page for cluster admins), backed-up and stored bytes (after deduplication, what counts against storage quotas) per project, the last copy to each backup target with its errors, and the number of pending deletion requests. Links to the `BackupPolicy` / `BackupTarget` resources (Contents) and to new ones (create wizard).
- **Catalog:** grouped by volume, each with a **timeline** (one bar per backup, oldest left, height by size, coloured by status, faded once deleted) and a table: time, status, size and bytes added to the repository, retention keep reasons, the latest restore test, immutability (`lockedUntil`) and the targets holding a copy. Per backup: browse the files, compare with another backup of the volume, restore (wizard), restore test now (operators), request deletion (admins). Per volume: **back up now** (operators), also for volumes that have no backup yet. The page polls every 5 seconds while a backup or restore test runs.
- **Backup** (`/operate/backups/<id>`, beside the list on wide screens): details (repository, policy, node, key generation, hooks, copies and their locks) and a **file browser** over the backup (`?path=`): open directories, download a file, or restore a file / directory with the wizard prefilled.
- **Compare** (`/operate/backups/diff?from=&to=`): added, removed and changed files between two backups of the same volume with their sizes and the size change.
- **Restore wizard:** pick the backup and what to restore (the whole volume or one path), then where (the volume itself, or side by side into another volume of the project: a new one has to be added to the deployment in the same plan) and how (`replace` / `merge`, target path and `overwrite` for a single path). A whole-volume restore into an existing volume warns that the volume's containers are stopped during the restore. The wizard creates a plan with a `Restore` resource and opens it: approvals and apply work like any plan.
- **Restores** (`/operate/backups/restores`): `Restore` executions with status and live progress (phase, bytes, files), and the restore tests with their check hook's exit code and output.
- **Deletions** (`/operate/backups/deletions`): deleting backups (requested from the catalog with a reason) or shortening retention needs a **second admin** of the same scope and takes effect only after the delay (`notBefore`). Open requests show requester, approver and the earliest execution; admins approve (never their own request) or cancel, each after a confirmation; executed and cancelled requests are kept as history.
- **Platform** (`/operate/backups/platform`, cluster roles; actions for cluster admins): the control plane's own backups (3.20) — pins (no external copy), per kind (Postgres, OpenSearch, etcd) schedule, the retention in effect (a shortened `keep` waits for a second admin and the delay: the open request with a link to the deletion requests), the last run, _back up now_ and the recent backups with their external copies and lock ends; point-in-time recovery (window, database scope, restores: request with an optional target time, discard) and the **cut-over** of a ready clone (a plan with the data-loss warning, approved by a second cluster admin, cancel); the external copy per target (last pass, objects, bytes, the newest DR envelope read back and decrypted; _copy now_); disaster recovery: the kit state, _Download DR info_ and the `bootstrap --restore` command. Polls every 5 seconds while something runs. The recovery kit page has the DR info download too.
- **Recovery kit** (`/operate/backups/keys`, cluster admins): the backup key generations with their kit (n shares, k needed). Each share is handed out **once**, after a confirmation: it is saved as a text file and shown once. Confirm the kit by pasting (or loading) enough shares back; re-issue the kit (default 3 shares, 2 needed), rotate the key, or escrow it in the configured KMS. Until the active generation's kit is confirmed (or the key escrowed) the page and the catalog warn that backups are not recoverable without the cluster.

### Import hosts (cluster roles)

**Operate › Import hosts**: hosts that joined with `install.sh --discover` and wait for (or run) their join plan. The wizard (`/operate/imports/<node>`) shows what discovery found (compose projects, containers, ports, volumes, existing tunnels, a former installation) and asks per item: import as a deployment of a project, migrate to other nodes, or leave unmanaged; hostnames for HTTP ports; copy, empty or keep for each volume / bind mount; values for secrets that stayed on the host. "Build the join plan" shows conflicts (resolved or refused with a reason), warnings and the ordered steps; "Create the plan" opens the plan page. While the join plan runs, each step shows its progress. See [importing Docker hosts and former nodes](./features/import.md).

### Git

**Delivery › Git**: the [Git connections](./features/gitops.md) per scope (the cluster scope, each project): provider, repository, branch, path, mode (Git authoritative or bidirectional), trigger (webhooks and / or polling), options, the last synced commit, the last sync and the last error, and the commits Loadweaver synced or wrote, each with its plan, state (and the reported commit status), pull request and, for rejected pushes, the file, line and rule. `/delivery/git/<id>` (where the inbox links) or `/delivery/git?connection=<id>` shows one connection; a project's **Git** tab opens its connections.

Cluster admins manage the cluster connection, project admins their projects' (everyone else who may read the scope sees them read-only): connect (validated like the API: HTTPS or SSH URLs only, credentials as `secret://project/name`, a project only with its own secrets), edit, disconnect, test the connection, sync now, export the scope to the repository (confirmed; replacing existing files with `force` needs an extra confirmation), reset a pinned SSH host key and read the webhook secret on demand (audited; a new connection shows it once) together with the webhook URL to configure at the provider. **Rotate webhook secret** (audited, behind a confirmation: the current secret stops working immediately, so the provider's webhook secret has to be updated afterwards) shows the new secret once; the page shows how often the secret was rotated. An export reports the resources it skipped because they come from SOPS-encrypted files (they are never written in clear); an export that would write plaintext secrets is refused with the control plane's message.

**GitHub App:** cluster admins can let a GitHub connection use the cluster's GitHub App (`Cluster.spec.git.github`) instead of an own token (option **Use the cluster's GitHub App**). The connection's API URL must be the cluster's GitHub API (`Cluster.spec.git.github.apiUrl`). Other scope admins see the option read-only while it is on (hidden while off); when one of them changes the repository, API URL or provider the control plane turns it off (the form warns before saving), and only a cluster admin can enable it again. The page also shows the cluster's SOPS age recipient with a copyable `sops --encrypt --age <recipient> …` command.

### Linked Git accounts

`/account/git-accounts` (**Account › Git accounts**) lists the GitHub and GitLab accounts linked to the signed-in user for the plan bot, links another one and unlinks one after a confirmation. Linking goes to the provider's authorize URL; the provider sends the browser back with `?confirm=<nonce>` (or `?error=<reason>`), and the page asks **Link <login> on GitHub / GitLab to your account?** before anything is linked (only the user who started the flow can confirm it). Confirm links the account and refreshes the list; Cancel drops the request. An expired or unknown request says to start again, a provider account linked to another Loadweaver user says so; the parameter is removed from the URL right after it is read.

### Drift (cluster roles)

**Delivery › Secrets** (`/delivery/secrets`) and a project's **Secrets** tab: the [secrets](./features/secrets-and-encryption.md#managing-secrets-in-the-console) the caller may manage (project admins / operators their projects', cluster admins all; the cluster-wide page with a Project column), with version, the resources that reference each one and when / by whom it was last set. **+** adds a secret, **⋮ Set new value** writes a new version — the value is typed into a password field or loaded from a file (keys, certificates), sent once and forgotten; it can never be shown again. When resources still run an older version, **Roll out** creates a plan with `refresh` for exactly those. **Delete** is disabled while resources reference the secret (the cluster refuses with the list). `lw-` platform secrets are changed by cluster admins only. Works the same through a [fleet](./features/fleet.md) whose cluster verifies the fleet's identity: the request goes as the signed person, the value only streams through.

**Delivery › Drift**: containers on the nodes that Loadweaver doesn't manage, failed rollbacks whose configuration and reality may differ, and Git scopes whose **default branch is ahead of the cluster** (the head commit's plan isn't applied, or the push was rejected), with links to the commit, its plan and the connection. A foreign container can be turned into a proposed plan, reviewed and applied like any other (a pull request in Git-authoritative scopes).

### Updates (cluster roles)

**Delivery › Updates**: release bundles, update plans and maintenance windows (3.26), in two tabs — **Overview** and **Releases, rollouts & windows** (three lanes, each with its own search; `?tab=releases|plans|windows` picks the lane on phones):

- **Overview:** the cluster's release, the control plane's version and the newest available release; the update policy from `Cluster.spec.updates` (read only, with a link to the Cluster's **Options** tab, where cluster admins change it through the draft and a plan); every node with agent version, release and target, OS and kernel, a pending reboot, and its maintenance-window state (open until …, next window at …, or none).
- **Releases:** releases per channel (stable / beta) with their status, signature (signed / unsigned), notes and pinned components. Cluster admins download a release's bundle (GitHub or the mirror, imported in the background) or upload a bundle file (air-gapped): the file is streamed as `application/x-tar` with upload progress and can be cancelled; signature or checksum errors are shown.
- **Update plans:** every plan with status, versions, kind and progress. Cluster admins plan an update for an imported release (or host / OS updates only for the running one), optionally with host updates and a full OS upgrade.
- **Maintenance windows:** the `MaintenanceWindow` resources with their schedule and the nodes they select, links to their object pages and to the create wizard, and the next opening per node.

A plan's page (`/delivery/updates/rollouts/<id>`) shows the diff per node or per component, notes, warnings and the steps grouped by wave (control plane, canary, waves), each with state, health-gate results and errors, plus what the wave puts at risk. Cluster admins approve it (optionally as an **emergency** that runs outside maintenance windows, confirmed explicitly), pause, resume, roll back or cancel it, each after a confirmation (pause, resume and cancel also from the task dock). While a rollout runs the pages poll every 5 seconds. Global admins (and the API key) also get the release **announcements** of the shared updates feature at **Admin › Updates** (`/updates/announcements`). See [updates](./features/updates.md).

### Certificates (cluster roles)

**Delivery › Certificates**: the ingress certificates (ACME and uploaded) with their state and expiry; a certificate's details open beside the list on wide screens (`/delivery/certificates/<id>`). See [ingress](./features/ingress.md).

### DNS

**Delivery › DNS**: declared records with their sync state and ownership conflicts (project members see their own records). Cluster roles also see the zones at their primary and secondary providers, DNSSEC keys and DS state, and DNS failovers with the manual fail-back. New records come from the create wizard (`/create/DnsRecord`). See [DNS](./features/dns.md) and [DNS failover](./features/dns-failover.md).

### Members & projects

**Access › Members & projects**: cluster members (cluster roles read, cluster admins manage); per project its members, its settings (which plans need an approval, whether developers may open terminals, terminal recording) and requests from other projects whose policies want to reach its groups (`/access/requests/<project>`, also a project's **Requests** tab). Cluster admins export and import access as YAML. These changes take effect immediately (they are not plans), are audited and are confirmed first. See [projects and access](./features/projects-and-access.md).

### Devices

**Access › Devices**: the caller's [remote-access](./features/remote-access.md) devices (every client for infra operators and cluster admins) with posture facts (last report, MDM / EDR results, device certificate), restrictions and connection, instant revocation, and how to enroll a device with the CLI. The key pair is generated on the device, so no private key passes through the browser.

### Device posture

**Access › Device posture**: [posture integrations](./features/device-posture.md) (Intune, Jamf Pro, Kandji, Defender for Endpoint, CrowdStrike, SentinelOne and plugins) with their sync state, last error and matched devices; cluster admins add, edit (stored secrets stay unless replaced), test, sync and delete them. Below, the trust for device certificates: company CA bundle, CRLs, the cluster CA and the proof-of-possession requirement.

## Not there yet

- **Isolation levels:** the node pages don't show the per-level probe states yet. Use the API (`GET /api/nodes/{name}`: `runtimes`, `capabilities.isolation`, `capabilities.kvm`; `GET /api/nodes?runtime=…`; `POST /api/nodes/{name}/isolation-probe`), see [isolation levels](./features/isolation-levels.md#node-probes).
- **Display names:** members, authors and actors are shown by user id, not by name.
- **Task dock:** VM image imports and Git syncs don't appear as tasks yet.
