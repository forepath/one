# Fleet service

One console for several Loadweaver clusters. The **fleet service** (`loadweaver-backend-fleet`) is a separate backend, like Agenstra's agent controller in front of its agent managers: it stores one connection per cluster, users sign in once at the fleet, and it relays requests to the clusters after checking the user's access to that cluster (and project). Every cluster keeps its own control plane and works without the fleet; removing a connection changes nothing in the cluster.

The fleet is a multi-site component and licensed under **BUSL-1.1 with the Additional Use Grant** (free production use below €2M total finances per year; each release converts to AGPL-3.0 three years after it is released), like Agenstra's `backend-agent-controller`.

## How it works

```
console ──(fleet login / PAT)──► fleet service ──(cluster service PAT + X-Loadweaver-On-Behalf-Of)──► cluster A
                                   │ grants, audit, cache                                         └──► cluster B
                                   └─ Postgres (connections, grants, operations), Valkey (jobs)
```

- **Connections**: name, HTTPS endpoint of the control plane, an optional CA bundle (private CAs), and a **service credential**: a Loadweaver PAT of a dedicated service user in that cluster. The credential is encrypted at rest with `ENCRYPTION_KEY` (AES-256-GCM, the shared `util-crypto` column transformer) and never returned by the API (only its last four characters).
- **Connection test**: registering or changing a connection calls `GET /api/cluster` with the credential first; an unreachable cluster or a rejected credential is refused. Changing the **endpoint or CA** of a connection requires re-entering the service credential in the same `PATCH` (400 otherwise): the stored credential is never sent to a new destination.
- **Health polls**: a coordinator job every minute (`FLEET_HEALTH_POLL_CRON`) enqueues one poll per cluster (job id per cluster and minute). States: `healthy`, `degraded` (nodes disconnected, 5xx), `unreachable`, `credential-rejected`. Changes are audited.
- **Relay**: `/api/clusters/:id/api/<path>` is forwarded to `<endpoint>/api/<path>` with the service credential, after the [access check](#access). Responses stream back with a filtered header set (the fleet asks clusters for uncompressed answers, `Accept-Encoding: identity`); request bodies (up to `FLEET_RELAY_MAX_REQUEST_BYTES`, default 11 MiB, enough for 10 MiB file-browser chunks) are streamed, too. Changes are audited at the fleet (`relay.request`). When a cluster answers **401 / 403** — it refused the fleet's service credential (revoked, expired, missing scope or role), never the caller's own credential, which isn't forwarded — the fleet answers **502** with `cluster rejected the fleet credential` (401) or `cluster refused the fleet credential: <reason>` (403) and `clusterStatus`.
- **Query strings** are parsed exactly like the cluster parses them (`node:querystring`, Express 5 `simple` parser, same `maxKeys`), limited to 100 parameters / 8 KiB with plain parameter names (no percent-encoding, `+`, brackets, empty pairs), a repeated `project` is refused, and the forwarded query is re-serialised from the validated parameters. Lists filtered by `?project=` accept only their own parameters (`plans`: `project`, `status`, `limit`; `backups`: `project`, `resource`, `includeDeleted`, `limit`; `backups/restores`: `project`). So the cluster reads exactly the parameters the fleet authorised.
- **Socket relay**: the Socket.IO namespace `socket/fleet` attaches a console socket to the live namespaces of a cluster (`plans`, `topology`, `logs`, `terminals`, `consoles`); each attachment is its own remote socket, so events only reach the socket that attached (see the fleet AsyncAPI). Access is **re-checked** every `FLEET_SOCKET_RECHECK_MS` (60 s) and immediately when a grant, the connection or the read-only grace of that cluster changes (in the replica that made the change; other replicas within the interval): the caller's token is validated again and every attachment re-authorised; what is no longer allowed is closed (`detached` with reason `access-revoked`; the whole console socket when the token is gone).
- **SSRF / DNS rebinding**: every connection to a cluster (REST relay, views, polls, sockets) goes through an agent whose `lookup` resolves the hostname and refuses private / loopback / link-local answers in the same step (unless `FLEET_CLUSTER_ENDPOINT_ALLOW_INTERNAL_HOST=true`), so an answer that changes after a check can't redirect the connection; registration additionally refuses such hosts up front.
- **Fleet views** (3.25): one card per cluster, a merged needs-attention inbox, sites for the world map and a side-by-side comparison, aggregated from the clusters' own endpoints and cached for `FLEET_CACHE_TTL_MS` (default 30 s, per replica).

## Access

Users sign in at the fleet (`api-key`, `users` or `keycloak`, the same identity setup as the other backends). **Fleet admins** (global admins, the static API key) manage connections and grants and have the admin role on every cluster. Everybody else needs a **grant** per cluster:

| Fleet role | Relay                                                                                                                                                                                                                                                                                | Mirrors (3.17)                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| `viewer`   | reads: overview, health, nodes, plans, resources, virtual machines and VM image imports, topology, metrics, logs, alerts, backups catalog, updates, usage, reports                                                                                                                   | project viewer / auditor          |
| `operator` | + plans (create, apply, cancel, discard), drift plans, node cordon / drain, alert acknowledgement / silences, backups now / restore tests, incidents, live sessions list, terminals, VM power actions / snapshots / reimage / image imports, VM serial and VNC consoles (`consoles`) | project operator / infra operator |
| `admin`    | + replica files (file browser read / write), backup downloads / archives, cluster and project members, settings, audit, certificates, backup keys and deletions, platform backups, update rollouts, Git connections, posture                                                         | cluster admin                     |

- A grant is **cluster-wide** or limited to **one project**. Project grants only open project routes (`/projects/<project>/…`) and lists filtered by `?project=` (plans, backups, restores); cluster-wide views, cards' aggregates and live sockets need a cluster-wide grant, because the service credential sees every project.
- The relay works on an **allow-list** of methods and paths (`relay-rules.ts`). Not relayed at all, for any role (a hard deny list checked before the rules): secrets, personal resources of the service user (VPN devices, Git account links, search favourites, registry tokens), node joining, **join tokens** and installer endpoints, and every **approval / acceptance** (plan approvals, cross-project acceptances, backup deletion, platform cutover and rollout approvals). Paths with encoded characters, `..` or empty segments are refused before anything is forwarded.
- **Approvals stay native**: four-eyes decisions are made in the cluster's own console by the cluster's own users — through the fleet every approval would come from the one service user, which would defeat the rule. The fleet shows pending approvals (cards, inbox) with a link to the cluster's console.
- **What a grant reaches** — the relay acts with the service credential, so a grant is about as strong as the matching cluster role, limited by the allow-list:
  - `viewer`: read-only views of everything the service user sees (on a cluster-wide grant: all projects' plans, resources, logs, metrics, alerts, backup catalog and file lists, usage, reports). No replica or backup **contents**.
  - `operator`: ≈ broad operational access to the cluster: create and apply plans (deploy anything a plan can express, subject to the cluster's approval rules), drain nodes, start backups and restore tests, and **terminals** into replicas (which can read whatever the replica can, including mounted secrets). Grant it like cluster `infra-operator`.
  - `admin`: ≈ cluster admin: additionally reads and writes **replica files** and downloads **backup contents** (`live/files`, `backups/:id/download|archive` — the data paths out of the secrets boundary), and administers members, settings, certificates, keys and rollouts. Secrets endpoints, join tokens and installers stay closed even for admins.
  - Project grants reach only their project's routes and `?project=`-filtered lists, never live streams, files or backup downloads (those are cluster-wide routes).
- PAT scopes at the fleet: `fleet:read` (views, read relay), `fleet:relay` (changing relay calls), `fleet:restore` (cross-cluster operations), `fleet:admin` (connections, grants, audit), `cloud:register` / `cloud:teardown` (Loadweaver Cloud). Socket relays need an interactive session.
- **Audit on both sides**: every relayed request carries `X-Loadweaver-On-Behalf-Of: fleet:<email>`. A cluster records it as `details.onBehalfOf` in its audit log when the service user's PAT carries the opt-in scope **`fleet:on-behalf-of`** (grantable only by accounts with a cluster-wide role — cluster admins and the fleet service user; the control plane refuses it at PAT creation / change for everyone else); for any other caller (interactive sessions, the static API key, PATs without the scope) the header is ignored. The audit actor stays the service user, so the header can annotate but never impersonate.

## The cluster's service user

Create a dedicated user in each cluster (e.g. `fleet@example.com`), give it a cluster role and create a PAT for it. Least privilege:

| Fleet use                                                    | Cluster role    | PAT scopes                                                                                                                                                          |
| ------------------------------------------------------------ | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read-only fleet views and viewer grants                      | `auditor`       | `cluster:read`, `projects:read`, `resources:read`, `alerts:read`, `metrics:read`, `logs:read`, `audit:read`, `usage:read`, `fleet:on-behalf-of`                     |
| Operator / admin grants, cross-cluster restore, final backup | `cluster-admin` | the above plus `plans:create`, `plans:apply`, `alerts:write`, `cluster:nodes`, `live:access`, `cluster:admin`, `projects:admin`, `backups:export`, `backups:import` |

`plans:approve` is not needed (approvals are never relayed). The fleet never exceeds what the service user may do (the cluster enforces its role and scopes), and grants at the fleet narrow it further per user. A cluster used only as a cross-cluster restore **source** needs `backups:export` (operator of the projects), a **target** `backups:import` plus `plans:create` / `plans:apply`. Rotate the PAT by updating the connection (`PATCH /api/clusters/:id`).

## Cross-cluster restore and cloning (3.20)

A backup of cluster A can be restored into cluster B — disaster recovery to a standby cluster, or cloning a deployment with its data for staging. `POST /api/operations` (scope `fleet:restore`; the caller must be operator of the backup's project on A and of the target project on B):

1. **validate**: the backups exist and succeeded on A; the target deployment exists on B (clone: the source deployment exists on A and the target one doesn't exist on B yet).
2. **deployment plan / apply** (clone only): the source `Deployment` is copied to B under the target project and name; groups and policies are matched by name on B, and the plan shows what does not resolve there.
3. **transfer**: A exports each backup as a tar archive (`GET /api/backups/:id/archive`, decrypted by A's control plane, audited `backup.exported`), the fleet streams it — without storing it — into B (`POST /api/backups/imports`), which snapshots it into its own repository under **its own backup key** as a new catalog entry without policy (audited `backup.imported` with the source labels).
4. **restore plan**: one `Restore` resource per volume through a normal plan on B.
5. **apply** (only with `apply: true`): the fleet applies the plan; B's approval rules still hold it until approved. Without `apply` the plan waits in B for its operators.
6. **wait**: until B reports every restore `done` (or `failed`).

Each step is a queue job with an idempotent id, records what it created (so a retry re-uses it) and is audited at the fleet; the clusters audit their side with the acting user as on-behalf-of. Waiting steps are polled every minute (`FLEET_OPERATIONS_CRON`) and give up after 6 hours. `POST /api/operations/:id/cancel` stops the operation at the fleet; imports and plans already created stay visible in B.

The archive travels decrypted over TLS between the clusters and the fleet; it is never written to the fleet's disk. If cluster A is down, use the cluster DR flow with the recovery kit instead ([Disaster recovery](./disaster-recovery.md)): the fleet only relays between running control planes.

## Loadweaver Cloud

Decabill provisions a single-node cluster per customer ([Loadweaver Cloud](../deployment/loadweaver-cloud.md)) but holds no cluster credentials. Cloud clusters are operated through the fleet:

1. **Registration**: once the customer has claimed the admin account, the operator creates the fleet service user + PAT in the cluster (table above, `cluster-admin`) and registers it with `POST /api/cloud/clusters` (fleet admin, scope `cloud:register`) with `reference: decabill:<subscriptionId>:<itemId>` and optional grants (e.g. the customer's fleet account as `admin`).
2. **Teardown**: when a cancelled Loadweaver subscription's grace period starts, Decabill calls `PUT /api/cloud/clusters/<reference>/teardown` with the end of the grace (`readOnlyUntil`). Configure Decabill with `LOADWEAVER_FLEET_URL` and `LOADWEAVER_FLEET_TOKEN` (a PAT of a fleet admin with only `cloud:teardown`); without them Decabill behaves as before. The call is idempotent and repeated every `LOADWEAVER_FLEET_SYNC_INTERVAL_MS` (15 min) during the grace, walking all subscriptions in grace page by page in id order (500 per page, so a large backlog never starves); clusters that are not registered are skipped.
3. **Final backup**: the first teardown call starts a `final-backup` operation on the cluster: platform backups (Postgres, OpenSearch, etcd; components that are not enabled are skipped), a backup of every volume (`POST /api/backups/now/all`), waiting for them, then the copy to the external targets (`POST /api/backups/platform/copies/run`). Best effort: a failing step doesn't stop the others. One operation per teardown: repeated teardown calls (Decabill repeats them every sync interval) return it whatever its outcome — a failed final backup is not restarted automatically (check its steps on the cluster page); a new teardown after a resume starts a new one.
4. **Read-only grace**: Loadweaver has no read-only mode, so the restriction lives at the fleet: during the grace every grant on that cluster (admins included) is capped at **viewer** — reads and the catalog work; changes, terminals, replica files and backup downloads / archives (admin) don't, and cross-cluster restores / clones **out of** a cluster in grace are refused (they need operator on the source). The data path out of a cluster in grace is the **final backup plus its external copy** (step 3), not the fleet. When the grace ends the connection is **retired** (relay closed, polling stops). `DELETE /api/cloud/clusters/<reference>/teardown` gives full access back if the subscription is resumed.

Customers who also have direct access to their cluster (their own admin account) are not restricted by the fleet; the read-only grace applies to access through the fleet.

## Console (fleet mode)

The fleet views are a **mode of the Loadweaver console**, not a separate app: the same image and the same feature library, switched by the runtime configuration ([Console](../console.md#fleet-mode)):

```json
{
  "mode": "fleet",
  "fleet": {
    "apiUrl": "https://fleet.example.com/api",
    "websocketUrl": "https://fleet.example.com/socket/fleet"
  },
  "authentication": { "config": { "type": "users" } }
}
```

- **Sign-in at the fleet**: the console's identity screens, tokens and user management talk to the fleet's API (`authentication.config.type` must match the fleet's `AUTHENTICATION_METHOD`). One login reaches every cluster the user has a grant on; the console never holds a cluster credential.
- **Fleet pages** (sidebar group **Fleet**): **Fleet overview** (`/fleet`: summary bar, one card per cluster with connection and health, sites, nodes, CPU / memory, version and available upgrade, open alerts, pending plans, inbox counts, update running, Loadweaver Cloud teardown with the end of the read-only grace; the merged needs-attention inbox; a world map of the sites with `Site.spec.location`, or the count of sites without one), **Clusters** (`/fleet/clusters`: connections with health, version, endpoint and the caller's access; fleet admins register, test, edit and remove connections — the service credential is write-only, never shown again, and changing the endpoint or the CA asks for it again in the same request), **Cluster** (`/fleet/clusters/:id`: connection, health check now, Loadweaver Cloud state with the final backup's steps, and the **grants** per user — cluster-wide or one project, viewer / operator / admin; users are searched in the fleet's identity, or entered by id), **Compare** (`/fleet/compare?clusters=…`: versions, capacity and policy drift of 2 to 8 clusters), **Operations** (`/fleet/operations`: cross-cluster restores, clones and final backups with their steps and progress, cancel; the wizard picks the source cluster and its backups through the relay, the target volumes, the target cluster, project and deployment, restore mode and whether the target applies the plans) and **Fleet audit** (`/fleet/audit`, fleet admins).
- **Opening a cluster**: a card, an inbox item, the cluster list or the **cluster switcher** in the top bar makes that cluster **active** (per browser tab) and opens its overview. From then on every cluster view of the console works unchanged against that cluster: REST calls go to `<fleet>/clusters/<id>/api/*`, live views (plans, map traffic, log tail, terminals, VM consoles) attach through `socket/fleet`. Switching clusters clears everything the console had loaded for the previous one. Links of the form `/clusters/<id>/<path>` (cards, merged inbox) enter the cluster and continue at `<path>`.
- **What the console shows per grant**: the sidebar, guards and actions follow the **fleet grant**, not the cluster's service user: admin → cluster admin, operator → infra operator, viewer → auditor (project grants keep their role; the read-only grace caps everything at auditor / viewer). The file browser needs the admin grant; join tokens and the installer, Git connections, VPN devices, linked Git accounts, webhooks and release announcements are not reachable through the fleet (their pages say so and point to the cluster's own console).
- **Approvals stay native**: plans, cross-project requests, backup deletions, platform cut-overs and update rollouts are never approved through the fleet. The console hides those actions in fleet mode; pending approvals in the merged inbox link to the cluster's own console (`nativeUrl`).
- **Refusals**: when the fleet refuses a relayed request, the view's error says why — not available through the fleet (`404 … is not relayed`), no permission with the current grant (`403`), the read-only grace (`403`), or a broken cluster connection (`502` when the cluster rejected the fleet's service credential — a fleet admin rotates it under Clusters; the user stays signed in). A live view whose access was revoked (`detached` with `access-revoked`) closes with a notice.

Single-cluster mode (no `mode` or `mode: "cluster"`) is unchanged.

## Deployment

Run the fleet next to (not inside) the clusters it manages: its own Postgres and Valkey, image `ghcr.io/forepath/loadweaver-fleet-api`, port **3500** (`apps/loadweaver/backend-fleet/docker-compose.yaml`, all settings with defaults in `.start-containers.env.example`).

- `ENCRYPTION_KEY` (32 bytes, base64) is required in production — it protects every stored service credential. Back it up with the fleet database.
- `FLEET_CLUSTER_ENDPOINT_ALLOWED_HOSTS` is required in production (comma-separated hostnames, or `*`); `FLEET_CLUSTER_ENDPOINT_ALLOW_INTERNAL_HOST=true` when fleet and clusters share a private network (otherwise private / loopback targets and DNS answers are refused); `FLEET_CLUSTER_ENDPOINT_ALLOW_INSECURE_HTTP` and `FLEET_CLUSTER_TLS_REJECT_UNAUTHORIZED=false` only outside production.
- `CORS_ORIGIN` / `WEBSOCKET_CORS_ORIGIN`: the console origin that shows the fleet views.
- Limits: `FLEET_SOCKET_RECHECK_MS` (60 s, min 5 s), `FLEET_RELAY_TIMEOUT_MS` (60 s), `FLEET_RELAY_MAX_RESPONSE_BYTES` (1 GiB), `FLEET_TRANSFER_TIMEOUT_MS` (6 h per archive), `FLEET_CLUSTER_REQUEST_TIMEOUT_MS` (10 s for views and polls); clusters cap archives with `LOADWEAVER_BACKUP_ARCHIVE_MAX_BYTES` (50 GiB) and need that much temporary space on the control plane during an export / import.
- `QUEUE_ROLE` splits API and workers like the other backends; health polls and operation steps run on workers.

## API

- REST: [openapi.yaml](/spec/fleet/openapi.yaml) (source: `libs/domains/loadweaver/backend/feature-fleet/spec/openapi.yaml`)
- Socket relay: [asyncapi.yaml](/spec/fleet/asyncapi.yaml) (source: `libs/domains/loadweaver/backend/feature-fleet/spec/asyncapi.yaml`)
- Cluster side: `GET /backups/{id}/archive`, `POST /backups/imports`, `POST /backups/now/all` and the `X-Loadweaver-On-Behalf-Of` header in the [control-plane API](/spec/control-plane/openapi.yaml)
