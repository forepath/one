# Backups

Replication is not a backup: a deleted volume or a `DROP TABLE` reaches every replica at once. Loadweaver backs up volumes on a schedule into the cluster's own object store (Garage), encrypted and deduplicated, copies them to external targets, tests restores and keeps the backups recoverable even if the whole cluster is lost.

This page covers volume backups and the backup key; the control plane's own data (Postgres point-in-time recovery, the log store, etcd) is summarised under [Control-plane data](#control-plane-data).

## How it works

```
node (volume primary)                       control-plane members                    object store
LVM thin snapshot ─► LUKS (read-only) ─►    Kopia repository server  ─────────────►  Garage bucket lw-backups
mount read-only ─► kopia client  ──TLS──►   (one per repository, ACLs)                <scope>/ = one repository
```

- **Kopia** (Apache-2.0, digest-pinned image) does the deduplication, compression, encryption and incremental upload. Backups are encrypted on the node before they leave it.
- **One repository per trust boundary**: one per project (`project-<name>`), plus `cluster`. Users of one repository share its key and its deduplication; projects never share data.
- **Repository servers on the control-plane members** hold the object-store key. Nodes never do: they connect to a server over TLS (certificate from the cluster CA, pinned by fingerprint) as the volume's own Kopia user, `v-<deployment>.<volume>@<project>`, with **APPEND / READ on its own snapshots only**. A node can create, list and restore its volume's snapshots; deleting snapshots, changing policies, running maintenance and seeing other volumes' snapshots are refused. Credentials are handed out per command and never stored on the node.
- The **control plane** has FULL access: retention, the catalog, diffs, the file browser, secondary copies. The servers run Kopia's maintenance under the control plane's identity.
- A **backup of a volume** runs on the node holding its primary: optional pre hook in the workload → LVM thin snapshot of the volume's LV (under LUKS and DRBD) → optional post hook → the snapshot opened read-only with the volume key and mounted read-only → Kopia snapshot → cleanup. The volume stays online; the snapshot is crash-consistent, the hooks make it app-consistent.

## Policies

Backups are configured with `BackupPolicy` resources (project or cluster scope) and go through plan / apply like everything else:

```yaml
apiVersion: loadweaver.com/v1
kind: BackupPolicy
metadata: { name: nightly, project: shop }
spec:
  selector:
    deployments: { matchLabels: { tier: critical } } # empty = every volume in scope
    volumes: [data] # optional: only these volume names
  schedules: ['0 * * * *', '30 2 * * *'] # cron, several allowed
  timeZone: Europe/Berlin
  retention: { keepLast: 3, hourly: 24, daily: 14, weekly: 8, monthly: 12, yearly: 2 }
  targets: [offsite] # BackupTarget names: secondary copies
  hooks: true # run the services' x-loadweaver.backup.hooks
  restoreTest: { schedule: '0 5 * * 0' } # weekly scratch restore + check hook
```

- Cluster policies select volumes of any project (`selector.projects` narrows them); project policies only their own project's.
- A volume is backed up when one of the schedules fired since its last backup started; missed runs collapse into one. A new volume waits for the next scheduled time — or use **Back up now** in the console (`POST /api/backups/now`).
- **Retention** works like restic / Kopia: a snapshot stays if any rule keeps it — the newest `keepLast`, and the newest snapshot of each hour / day / ISO week / month / year for the given number of periods (periods without a snapshot don't count), in the policy's time zone. The newest snapshot is always kept. The catalog shows why each backup is kept.

### Hooks and check (compose)

```yaml
services:
  db:
    image: postgres:17
    volumes: [data:/var/lib/postgresql/data]
    x-loadweaver:
      backup:
        hooks:
          pre: [sh, -c, 'pg_dump -U app app > /var/lib/postgresql/data/dump.sql']
          post: [rm, -f, /var/lib/postgresql/data/dump.sql]
          timeout: 5m
        check:
          command: [sh, -c, 'test -s /var/lib/postgresql/data/dump.sql']
          timeout: 10m
```

`pre` runs before the snapshot, `post` right after it (before the upload), both in a replica of the service on the volume's node. `check` runs during restore tests in a container of the service's image with the scratch restore mounted where the service mounts the volume; exit code 0 = passed.

## Targets and immutability

The cluster's object store is always the primary target. External targets are `BackupTarget` resources (cluster scope) and get a **secondary copy** of every repository whose policies name them (blob-level `kopia repository sync-to`, never deleting at the destination):

```yaml
kind: BackupTarget
metadata: { name: offsite }
spec:
  type: s3
  endpoint: https://s3.eu-central-1.example.com
  bucket: acme-loadweaver-backups
  region: eu-central-1
  prefix: cluster-a/
  credentials: secret://ops/offsite-s3 # JSON { "accessKeyId": "…", "secretAccessKey": "…" }
  objectLock: { mode: COMPLIANCE, days: 30 }
---
kind: BackupTarget
metadata: { name: vault }
spec:
  type: sftp
  host: backup.example.com
  user: loadweaver
  path: /srv/backups
  keySecret: secret://ops/backup-ssh-key
  knownHosts: | # every host-key type of the server (ssh-keyscan -t rsa,ecdsa,ed25519)
    backup.example.com ssh-ed25519 AAAA…
    backup.example.com ecdsa-sha2-nistp256 AAAA…
```

- **S3 with Object Lock**: create the bucket with object lock enabled and a **default retention in compliance mode** of at least `days`; Loadweaver checks the bucket's lock configuration before every copy and refuses the copy (and reports the target as failing) if it doesn't match. Every copied object is then immutable for that period — not even the target's root account can delete it. Use write / append-only credentials where the provider allows it. If something still deletes objects (delete markers), Kopia can read the repository as of an earlier time (`kopia repository connect … --point-in-time=<time>`).
- Garage ignores object-lock headers, so backups inside the cluster are protected by the repository servers' ACLs (nodes can't delete) and the deletion rules below, not by object lock.
- **Tested**: external copies are lab-tested against a second, independent Garage as the S3 target (no object lock).
  The object-lock path (bucket check, compliance retention on every object, no pruning while locked) is tested
  against an in-test fake S3 and in unit tests only — **object lock is not lab-verified against a real lock-capable
  S3 provider**; check a restore and a refused delete on your provider before relying on it.

**Pins**: as long as a backup policy exists without any external target, the cluster health and every plan touching backup policies show the pin _"backups don't survive the loss of the cluster"_ (acknowledge it at apply like any pin).

## Deleting backups and shortening retention

Ransomware or a compromised admin account must not be able to wipe the backups:

- **Deleting backups** (console catalog, `POST /api/backups/deletions`) creates a request that a **second admin** of the same scope (project admin, or cluster admin for the cluster) has to approve. The requester can't approve their own request.
- An approved request takes effect only **after a delay** (`LOADWEAVER_BACKUP_DELETION_DELAY_HOURS`, default 72 h, at least 1 h), counted from the request. Any admin of the scope can cancel it until then.
- **Shortening retention** works the same way: when a plan lowers any retention rule, rules that grow apply at once, the shortened ones only after a second admin approved the automatically created request and the delay passed. Until then the previous (longer) retention stays effective.
- Requests, approvals and executions are audited and raise the built-in alert `builtin:backup-deletion-requested` (webhooks / e-mail), so a deletion can't happen unnoticed.

Normal retention (snapshots ageing out under an unchanged policy) needs no approval.

## Restores

Restores are plans: the console's restore wizard creates a `Restore` resource, so project approvals apply (developers need an operator's approval) and the plan shows what will happen.

```yaml
kind: Restore
metadata: { name: restore-2026-10-19, project: shop }
spec:
  backup: 6f0c… # backup id from the catalog
  target:
    deployment: web
    volume: data # an existing volume, or a new one next to it (side by side)
    mode: replace # replace (empty the volume first) or merge
    # path: uploads/2026            # only this file / directory (single-file restore)
    # targetPath: uploads/restored  # where it goes (default: same path)
    # overwrite: false
```

- **Whole volume**, into the volume itself or **side by side** into another (new, empty) volume of the deployment — add the volume to the deployment in the same plan; the restore waits up to an hour for it to be placed. Containers using the target volume are stopped during a whole-volume restore and started again afterwards.
- **Single files / directories**: browse a backup in the console (file browser over the catalog), download a file directly, or restore a path into the volume (`path`; existing files are never overwritten unless `overwrite: true`).
- A `Restore` runs once per change of the resource; its progress and result are shown under _Backups → Restores_ (`GET /api/backups/restores`).
- Restores stay within their project: a backup of another project is refused. Restores into another cluster (disaster recovery to a standby, cloning) go through the fleet console.

## Restore tests

With `restoreTest` in a policy, the newest backup of every selected volume is restored on schedule into a scratch volume (a temporary thin LV, encrypted with a throw-away key, removed afterwards) on the volume's node, and the service's `check` hook runs against it. The result is shown on the backup and the volume, in the monthly report, and a failure raises `builtin:restore-test-failed`. A restore test also proves that the backup key still decrypts current backups. Start one by hand with _Restore test now_ (`POST /api/backups/{id}/restore-test`).

## Backup key and recovery kit

Backups use their **own key hierarchy**, separate from the cluster's secrets, so losing the cluster doesn't lose the ability to decrypt them:

- Per **generation** a random 256-bit root key. Everything else is derived from it (HKDF-SHA256): the data key of the generation, each repository's password, each Kopia user's password. The root is stored wrapped with the cluster master key (re-wrapped whenever the master key changes).
- The **recovery kit** is the root split Shamir-style into _n_ shares, any _k_ of which recover it (default 3 / 2, `LOADWEAVER_BACKUP_KIT_SHARES` / `LOADWEAVER_BACKUP_KIT_THRESHOLD`, or chosen when re-issuing). Each share can be **downloaded exactly once** (text with a JSON block and a checksum; print it or store it offline, one per person). Then the admins **confirm** the kit by entering _k_ shares back; Loadweaver checks that they reconstruct the key (typos fail the checksum, wrong or mixed shares are refused).
- Until the kit of the active generation is confirmed (or the key is escrowed, below), the cluster shows the pin **"backups not recoverable"** in health and the overview inbox, and the alert `builtin:backup-kit-unconfirmed` fires after a day.
- **KMS escrow** (optional): with an external KMS configured for the master key (`LOADWEAVER_MASTER_KEY_KMS`, e.g. Vault transit), the root can additionally be wrapped by the KMS (`POST /api/backups/keys/{generation}/escrow`).
- **Rotation** creates a new generation with a new kit; new repositories use it, older generations stay for restores.

Only cluster admins see and manage the keys (`/api/backups/keys`, scope `cluster:admin`).

### DR envelope

Every control-plane backup is stored together with a **DR envelope**: the master key, the cluster CA (certificate and key) and the environment a restore needs (`ENCRYPTION_KEY`, `JWT_SECRET`, `STATIC_API_KEY`, `DB_USERNAME`, `DB_PASSWORD`, `LOADWEAVER_POSTGRES_ADMIN_PASSWORD`, `LOADWEAVER_POSTGRES_REPLICATION_PASSWORD`, `KEYCLOAK_CLIENT_SECRET`, `REDIS_PASSWORD`, `LOADWEAVER_MASTER_KEY_KMS`, `LOADWEAVER_VAULT_TRANSIT_KEY`, and the non-secret settings a restored control plane starts with: `DB_DATABASE`, `AUTHENTICATION_METHOD`, the Keycloak and Vault addresses, `CORS_ORIGIN`, `LOADWEAVER_CLUSTER_NAME`, `LOADWEAVER_PUBLIC_URL`; never KMS tokens) and which backup it belongs to (name, database scope), encrypted (AES-256-GCM) with the data key of the current backup-key generation. The recovery kit or the KMS escrow opens it, so a whole-cluster restore brings back secrets, the CA and identities. It is never logged.

## Control-plane data

The control plane's own state is backed up by the members, not through Kopia: Postgres / TimescaleDB with continuous WAL archiving (WAL-G, point-in-time recovery into a new scope), the log store with OpenSearch snapshots and etcd with snapshots, all into the object store through a small S3 gateway on each member that allows only the overwrites / deletes those tools need. Every control-plane backup carries the [DR envelope](#dr-envelope). Restores of control-plane data are for cluster admins only. These backups appear in the catalog under the `cluster` scope.

| Data                     | How                                                                                            | Object keys in the bucket `lw-platform`              |
| ------------------------ | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Postgres + TimescaleDB   | WAL-G in Spilo: WAL archived continuously, base backups on a schedule → point-in-time recovery | `spilo/<cluster>/wal/17/{basebackups_005,wal_005}/…` |
| OpenSearch (logs, audit) | snapshot repository (`repository-s3`), snapshots of all regular indices on a schedule          | `opensearch/<cluster>/…`                             |
| etcd                     | snapshot (`etcdctl snapshot save` format) on a schedule, taken by the control plane            | `etcd/<cluster>/etcd-<time>.db`                      |
| DR envelope              | master key, cluster CA, control-plane environment, sealed under the backup key, one per backup | `dr-envelope/<backup>.json`                          |

The backups appear in the catalog as resources `platform/postgres`, `platform/opensearch` and `platform/etcd`
(cluster scope; only cluster roles see them); `builtin:backup-failed` covers them like volume backups (a kind that
can't run on this cluster, e.g. OpenSearch without `repository-s3`, is reported as `unavailable` in the status instead
of a failed backup).

### Schedules and retention

`Cluster.spec.backups.platform` (plan / apply like every cluster setting):

```yaml
spec:
  backups:
    platform:
      enabled: true # default
      timeZone: Europe/Berlin # default UTC
      postgres: { schedule: '0 2 * * *', keep: 7 } # base backups; WAL is archived continuously
      opensearch: { schedule: '30 2 * * *', keep: 14 }
      etcd: { schedule: '15 * * * *', keep: 48 }
```

Schedules are five-field cron expressions in `timeZone`; a missed run (e.g. while no control-plane replica was up)
runs once, not once per missed time. Retention keeps the newest `keep` backups of each kind; for Postgres the
recovery window starts at the end of the oldest kept base backup and reaches up to the last archived WAL segment.
Only the control plane deletes (see below); Spilo's own scheduled backup / retention script is disabled.

`loadweaver` CLI / API: `GET /api/backups/platform` (status, recovery window, catalogued backups, restores),
`POST /api/backups/platform/<kind>/run` ("back up now", cluster admins).

### The backup gateway

WAL-G and OpenSearch never get the object store's keys. They write through an **S3 gateway** that is part of the
control-plane API on every member (loopback only, port `7480` by default, `LOADWEAVER_BACKUP_GATEWAY_PORT`): it
holds the Garage key of the platform bucket and gives every member's WAL-G and OpenSearch their own credentials
(derived from the cluster's encryption key, sent to the member over the agent stream, never stored). The gateway
verifies each request's AWS Signature V4 (including `aws-chunked` uploads with chunk signatures and trailing
checksums), applies its rules, and forwards the request re-signed with its own key, streaming:

- reads and listings only under the client's prefix (`spilo/`, `opensearch/`), only in the platform bucket;
- **new objects only**: Garage ignores `If-None-Match` and object-lock headers, so the gateway checks for the key
  and writes in one step per key; an existing object is never overwritten. The only exceptions are the two blobs
  OpenSearch's repository format rewrites (`index.latest`, `incompatible-snapshots`);
- **no deletes**, except while the control plane's retention runs for that client (a short-lived grant). WAL-G's
  grants name the exact keys the run may remove (the victim base backups and the WAL segments before the oldest kept
  backup, listed before the run: `wal-g delete before FIND_FULL <oldest kept>`; `delete target` for a single backup
  and its deltas); OpenSearch's grant covers the cluster's repository prefix, because its snapshot deletion names
  blobs the control plane can't predict. The control plane deletes etcd snapshots and envelopes itself;
- multi-object deletes (`POST ?delete`) are parsed strictly (exactly S3's `Delete` / `Object` / `Key` / `Quiet`
  grammar: no attributes, namespace prefixes, comments, CDATA, DTDs or other entities, no `VersionId`); the gateway
  checks every key and forwards a body it rebuilt from the checked keys, never the client's bytes;
- no server-side copies, ACLs, policies, versions or other sub-resources; objects up to 5 GiB per request;
- client writes pause (`503 SlowDown`, clients retry) while the object store switches generations (the platform
  bucket moves with the generations).

A compromised database or log store (say, through an injection that runs shell commands) can therefore add backups
but not destroy the existing ones. Refusals are logged by the control plane.

**Accepted residual risks** (M6 security review):

- _Overwrite check per member_ (L3): the check-then-write of a new key is serialised by a per-key lock inside one
  member's gateway. Two members' gateways writing the same new key at the same moment could both pass the check, so
  the second write wins. Only the same client role on another member could do that (WAL-G writes only on the Patroni
  leader; OpenSearch's blobs are written once by name), and Garage ignores `If-None-Match` on `PUT`, so there is no
  conditional write to rely on; revisit when Garage honours conditional writes.
- _Kopia_ (L6): the repository server's start script hands Kopia user password hashes to
  `kopia server user add|set --user-password-hash` on its command line (visible to root on that control-plane
  member, who holds the object-store key anyway; the hash is a deliberately slow scrypt of a random 256-bit-derived
  password, the password itself only travels in the environment). And Kopia's ACLs can't grant APPEND without READ
  on content: a node's user can read content blobs of its repository it could also write; other volumes' snapshots
  stay out of reach (manifest ACLs), and nothing a node can do deletes or rewrites existing snapshots.

### Restoring the database to a point in time

A point-in-time restore clones the database into a **new Patroni scope**, side by side with the running cluster:

1. `POST /api/backups/platform/postgres/restores` with `{"targetTime": "2026-10-19T10:00:00Z"}` (omit it for the end
   of the archive; optionally `node`). One restore at a time; the target time must lie in the recovery window.
2. The chosen member starts the clone (`lw-postgres-pitr`, scope `<cluster>-r<id>`, Postgres on port `5442`, Patroni
   on `8018`): the newest base backup before the target, then WAL up to the target, then it promotes. The restore
   turns `ready` once the clone runs as primary. The clone archives its own WAL under its own scope, so it can
   become the new cluster with point-in-time recovery intact. The running cluster is not touched.
3. Inspect the clone (e.g. `psql -h <member overlay address> -p 5442 -U postgres loadweaver`); copy single rows back
   if that is all you need.
4. `DELETE /api/backups/platform/postgres/restores/<id>` discards the clone and its data.

Typical use: a table was dropped or rows were damaged — copy the affected data from the clone back into the running
database (e.g. `pg_dump -h <member> -p 5442 -t <table> loadweaver | psql …`), then discard the clone.

**Cut-over** makes a ready clone _the_ control-plane database (e.g. after a corruption that affects everything).
It is a plan with a second approval, because everything written after the clone's target time is lost:

1. `POST /api/backups/platform/postgres/restores/<id>/cutover` (cluster admin; console: Backups → Platform → the
   restore → _Switch control-plane database to this restore_) plans it. Refused while the clone isn't `ready`, while
   a member is offline or runs an agent without the `platform-cutover` protocol feature, or while another cut-over is
   open. The plan lists the steps and the warnings — **data written after the target time is lost** (resources,
   plans, joined nodes, secrets, audit entries), the control plane is unavailable for the switch (usually under a
   minute), and the current database is kept (see below).
2. A **second cluster admin** approves it (`POST /api/backups/platform/cutovers/<id>/approve`; the requester can't,
   so an API-key-only cluster can't cut over). `…/cancel` stops a planned or approved one.
3. The control plane takes a **final base backup** of the current database (it stays under `spilo/<old scope>/` with
   its WAL), writes the cut-over into the clone's own database (the control plane continues there afterwards) and
   switches the members through their desired state (`controlPlane.platformBackups.postgresCutover`): the clone's
   member stops its database, keeps the data directory as `postgres.pre-<restore>` and adopts the clone's directory
   as its database (`lw-postgres`, same Patroni scope as the clone, normal ports); every other member keeps its data
   directory the same way and starts empty as a replica of the clone. Each member remembers the scope its data
   belongs to (`<state>/postgres-scope`); only an explicit cut-over changes it.
4. The API reconnects (through the leader proxy) to the clone, finds the cut-over there and finishes it once every
   member's Patroni runs in the new scope with the clone's member as leader; then it takes a base backup right away,
   so point-in-time recovery continues under the new scope (`GET /api/backups/platform` → `postgresScope`).

Previous data directories (`postgres.pre-<restore>`, the newest one per member) and the old scope's archive are not
deleted automatically: remove the directories by hand once the new database is verified; the old archive can still
be cloned (it is outside the retention of the new scope). If a switch doesn't converge within 30 minutes
(`LOADWEAVER_PLATFORM_CUTOVER_TIMEOUT_MS`) the cut-over is marked `failed`; the members keep what they did, see the
log of the members' agents (`Postgres cut-over: …`) and [Disaster recovery](./disaster-recovery.md#manual-fixes).

### Restoring OpenSearch indices

`POST /api/backups/platform/opensearch/restore` with `{"snapshot": "lw-20261019t023000z", "indices": ["loadweaver-logs-*"]}`
restores the indices from a snapshot into the log store, renamed `restored-<index>` by default (`renamePrefix`; an
empty prefix restores under the original names, which must not exist). Snapshots need the OpenSearch image with the
`repository-s3` plugin (the release images have it; development images report snapshots as unavailable).

### Restoring etcd

etcd only holds Patroni's coordination state, which Patroni rebuilds; its snapshot matters for a whole-cluster
restore. `GET /api/backups/platform/etcd/<name>` downloads a snapshot (cluster admins), then:

```bash
etcdutl snapshot restore etcd-20261019t101500z.db --data-dir /var/lib/loadweaver/etcd \
  --name <node> --initial-cluster <node>=http://<overlay address>:2380 \
  --initial-advertise-peer-urls http://<overlay address>:2380
```

and start etcd on that member from the restored data directory; further members join as usual.

### External copy of the control-plane data

The platform bucket (WAL archive, base backups, OpenSearch and etcd snapshots, DR envelopes) is copied to the
cluster's external `BackupTarget`s, so the control plane survives the loss of the whole cluster:

- **Which targets**: `Cluster.spec.backups.platform.targets` (names of `BackupTarget`s); absent = every declared
  target, `[]` = none. Without any, the cluster shows the pin _"control-plane backups don't survive the loss of the
  cluster"_ (health, inbox, plans touching `spec.backups` or targets).
- **Encrypted before it leaves**: every object is encrypted by the control plane (AES-256-GCM in 1 MiB chunks, key
  derived from the backup key generation, object name and position authenticated) — the target only sees ciphertext
  and the object names (backup names and times). The recovery kit (or the KMS escrow) alone decrypts them.
  Layout: `<prefix>platform/<object key>` (S3) or `<path>/platform/<object key>` (SFTP), plus two small unencrypted
  descriptions a fresh node reads first: `platform/dr/cluster.json` (cluster id, database scope) and
  `platform/dr/keys.json` (key generations, kit shape, KMS-wrapped roots — no secrets).
- **When**: after every control-plane backup and every 5 minutes (`LOADWEAVER_PLATFORM_COPY_INTERVAL_MS`; WAL is
  archived continuously), only objects that are new or rewritten since (OpenSearch's `index.latest`); console /
  `POST /api/backups/platform/copies/run` copies now.
- **Verified**: every upload is checked on the target (size, and the ETag against the uploaded bytes on S3); each pass
  reads the newest DR envelope back from the target, decrypts it and opens it with the backup key. The status per
  target (`GET /api/backups/platform` → `copies`: last run, error, objects, bytes, verified envelope) is on the
  console's platform page; the catalog rows list the target with its lock end.
- **Object lock**: S3 targets with `objectLock` must have object lock enabled on the bucket (compliance mode, default
  retention not shorter than declared — checked before each pass); every copied object additionally gets that
  retention explicitly. (Tested against a fake S3 only, see [Targets and immutability](#targets-and-immutability).)
- **Pruning**: objects the platform retention removed from the bucket are removed from the target once their lock
  ended; append-only credentials (or a lifecycle rule on the bucket) keep them instead — refused deletes are logged
  and ignored. After a disaster recovery nothing copied before the loss is ever pruned automatically.
- Objects above 5 GiB aren't copied (WAL-G splits base backups into parts of 1 GiB by default).

Key rotation: copies are encrypted under the generation active when they are copied. Keep the previous kit until a
base backup under the new generation reached the target.

### Retention and deletion of control-plane backups

Shortening `Cluster.spec.backups.platform.<kind>.keep` follows the same rule as policy retention: the plan warns, the
longer value stays in effect, and a deletion request of kind `retention` (`cluster:backups.platform/<kind>`) waits
for a second cluster admin and the delay (`LOADWEAVER_BACKUP_DELETION_DELAY_HOURS`) — the console's platform page
shows the retention in effect and the open request. Longer retention applies at once. Deleting a control-plane backup
by hand (catalog → delete) is a deletion request like for volume backups; once approved and due, WAL-G deletes the
base backup under a short grant (`wal-g delete target`), OpenSearch / etcd snapshots and the DR envelope go with it.

## Disaster recovery (whole cluster)

A fresh node restores the whole cluster from the external copy: `loadweaver-agent bootstrap --restore` asks for the
recovery kit (or uses the KMS escrow), restores etcd, the database and the control-plane environment, starts the
control plane on the node and marks the previous nodes lost; the control plane then forms the object store anew,
re-seeds the backup repositories from the target, restores the volumes and redeploys. The runbook (what is
automatic, what is manual, timings from the drill) is in [Disaster recovery](./disaster-recovery.md).

## Catalog, quotas, alerts, reports

- **Catalog** per cluster and per project (`GET /api/backups`): every backup by volume with time, size, size after deduplication, targets, encryption, immutability (`lockedUntil` of the external copy), retention reasons and the restore-test result; a timeline per volume; the **diff** between two backups of a volume (`GET /api/backups/diff?from=&to=`: added / removed / changed files with sizes) and a file browser (`GET /api/backups/{id}/files?path=`, `GET /api/backups/{id}/download?path=`, audited).
- **Quotas**: the bytes a project's backups occupy in the repository (after deduplication) count against its storage quota (3.17).
- **Alerts** (built in): `builtin:backup-failed` (the latest backup of a volume failed), `builtin:restore-test-failed`, `builtin:backup-kit-unconfirmed`, `builtin:backup-deletion-requested`.
- **Reports**: the monthly report lists backups (failed ones, bytes backed up / stored) and restore tests.

## Operations

| Variable                                 | Default                 | Meaning                                                                                                         |
| ---------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| `LOADWEAVER_BACKUPS`                     | `on`                    | `off` stops the scheduler and command dispatch (tests)                                                          |
| `LOADWEAVER_BACKUP_DELETION_DELAY_HOURS` | `72`                    | Delay before approved deletions / retention shortening take effect (≥ 1)                                        |
| `LOADWEAVER_BACKUP_KIT_SHARES`           | `3`                     | Shares of a new recovery kit                                                                                    |
| `LOADWEAVER_BACKUP_KIT_THRESHOLD`        | `2`                     | Shares needed to recover                                                                                        |
| `LOADWEAVER_KOPIA_IMAGE`                 | pinned                  | Development override of the Kopia image on the nodes (reported as a warning in updates)                         |
| `LOADWEAVER_BACKUP_GATEWAY_PORT`         | `7480`                  | Loopback port of the members' S3 gateway for control-plane data (set by the control plane, sent to the members) |
| `LOADWEAVER_BACKUP_GATEWAY_LISTEN`       | set by the agent        | `host:port` the API's gateway listens on (only on members with `platform-backups`)                              |
| `LOADWEAVER_PLATFORM_BACKUPS`            | auto                    | `off` stops the control-plane data scheduler, `on` forces it; default: on where the gateway runs                |
| `LOADWEAVER_ETCD_ENDPOINT`               | `http://127.0.0.1:2379` | etcd client URL for snapshots                                                                                   |
| `LOADWEAVER_PLATFORM_RESTORE_TIMEOUT_MS` | `21600000`              | A point-in-time clone that isn't primary after this long is failed                                              |
| `LOADWEAVER_PLATFORM_COPY_INTERVAL_MS`   | `300000`                | Interval of the external copy of the control-plane data (≥ 10 s; also after every control-plane backup)         |
| `LOADWEAVER_PLATFORM_CUTOVER_TIMEOUT_MS` | `1800000`               | A cut-over whose members don't converge on the new scope after this long is failed                              |
| `LOADWEAVER_PLATFORM_CLONE_SSL`          | `require`               | TLS to a point-in-time clone when the cut-over is written into it (`disable` for labs only)                     |

- Repository servers listen on the members' overlay addresses, one port per repository from `7500–7755` (built-in policy `builtin:backups`: every node → control-plane members). At most 256 repositories (projects with backups) per cluster.
- Backups of a volume run on the node holding its primary and need the node agent's `backups` protocol feature; older agents are skipped until updated.
- The catalog keeps deleted backups (marked deleted) for the timeline.

## Known limitations

- **Quotas and stored bytes count the logical size** of a backup (the snapshot's file sizes), not the bytes Kopia actually uploaded after deduplication and compression: Kopia 0.23's `snapshot create --json` reports no upload statistics. Projects with well-deduplicating data are charged more than they store.
- **Repository passwords don't rotate with key generations**: a repository keeps the password derived from the generation it was created with; a rotation only applies to repositories created afterwards (older generations stay for restores).
- **At most 256 project repositories** per cluster (one Kopia repository server port per repository from `7500–7755`).
- **Backup hooks after a live migration**: a replica restored by a live migration runs as an agent-managed runc / runsc container until its next restart; pre / post / check hooks don't run in it until then.
- **Kopia on arm64**: the `kopia` binary in the control-plane image (retention, maintenance, catalog) is untested on arm64.

## Cross-cluster restore and final backup

Through the [fleet service](./fleet.md#cross-cluster-restore-and-cloning-320) a backup can be restored into another cluster (standby DR, cloning for staging). The cluster side:

- `GET /api/backups/:id/archive` exports a project backup as a tar archive (decrypted by this control plane; operators of the project, PAT scope `backups:export`, audited `backup.exported`).
- `POST /api/backups/imports?volume=<project/deployment/volume>` imports such an archive (`Content-Type: application/x-tar`, streamed) into the project's repository under this cluster's backup key, as a backup without policy (no retention removes it); restore it with a `Restore` resource (operators, scope `backups:import`, audited `backup.imported` with the source labels). Only files, directories and symbolic links are accepted. Only **uncompressed ustar** archives (POSIX / PAX or GNU headers, as the export writes them) are accepted: gzip / zstd / brotli input is refused before anything is extracted (a compressed upload would otherwise slip past the size cap, which counts uploaded bytes). The declared sizes of all entries count against the cap as well, and setuid / setgid / sticky bits are stripped from extracted modes.
- `POST /api/backups/now/all` backs up every placed volume now (cluster admins, scope `cluster:admin`), the final backup before a Loadweaver Cloud teardown.
- `LOADWEAVER_BACKUP_ARCHIVE_MAX_BYTES` (default 50 GiB) caps archives in both directions (uploaded bytes and the extracted contents). Exports and imports are staged in `LOADWEAVER_BACKUP_STAGING_DIR` (default: the OS temp dir). Recommended: point it at a dedicated filesystem or volume with a quota of at least twice the cap — an import holds the upload and the extracted tree at the same time — so a large transfer can't fill the control plane's root disk.
