# Disaster recovery

When a whole cluster is lost (every node, or every control-plane member and the object store with them), a fresh
node restores it from the **external copy** of the backups. This page is the runbook. Backups themselves, the
recovery kit and the external copy are described in [Backups](./backups.md).

## What you need — prepare it now

| What                       | Where it comes from                                                                                                                                                                                                                                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| An external target         | A `BackupTarget` (S3, ideally with object lock in compliance mode, or SFTP) that receives the external copy of the control-plane data (`Cluster.spec.backups.platform.targets`, default: every target) and that your backup policies name for the volumes. Without one, the cluster shows the pin _"control-plane backups don't survive the loss of the cluster"_. |
| The recovery kit           | _k_ of the _n_ shares of the backup key (Backups → Keys: download each share once, confirm the kit), or the backup key escrowed in a KMS (Vault transit) and credentials for it.                                                                                                                                                                                   |
| The DR info file           | Backups → Platform → _Download DR info_ (`GET /api/backups/platform/dr-info`): cluster id, database scope, the targets (endpoint, bucket, prefix / host, path, `known_hosts`), the key generations with their KMS-wrapped roots. No secrets — store it next to the kit.                                                                                            |
| Credentials for the target | An S3 access key with read access to the bucket, or the SFTP private key. The cluster's own copy of these credentials is a secret inside the lost cluster: keep a separate (read-only) key outside.                                                                                                                                                                |
| A fresh host               | Like any node ([host requirements](../deployment/host-requirements.md)): supported OS, the installer's packages (Docker, DRBD, …), the `loadweaver-agent` binary of the same release, outbound access to the target and to the container registries.                                                                                                               |

Check regularly: the platform page shows, per target, the last copy and the newest DR envelope read back and
decrypted from the target ("verified envelope").

## The restore

```bash
sudo LOADWEAVER_DR_ACCESS_KEY_ID=… LOADWEAVER_DR_SECRET_ACCESS_KEY=… \
  loadweaver-agent bootstrap --restore --name n1 --public-host n1.example.com \
  --dr-info loadweaver-dr-info-lw-1a2b3c4d.json \
  --share-file share-1.txt --share-file share-3.txt
```

- Target: `--dr-info <file>` (first target, or `--target <name>`), or flags: `--s3-endpoint <url> --s3-bucket <b>
[--s3-region <r>] [--s3-prefix <p/>]`, or `--sftp-host <h> [--sftp-port <p>] --sftp-user <u> --sftp-path </p>
--known-hosts-file <f> --sftp-key-file <f>`.
- Key: one `--share-file` per share (the printed kit text, the JSON document or the bare `lws1.` line); without them
  the agent asks for the shares on the terminal (paste each, empty line to finish) until the threshold is reached.
  Or `--kms vault-transit` with `VAULT_ADDR`, `VAULT_TOKEN` (and `VAULT_NAMESPACE`, `LOADWEAVER_VAULT_TRANSIT_MOUNT`,
  `LOADWEAVER_VAULT_TRANSIT_KEY` if they differ from the defaults); the escrowed root comes from the target.
- `--target-time <ISO 8601>` restores the newest base backup before that time and replays the WAL up to it (default:
  everything the target holds). `--no-volume-restore` leaves the volumes empty (restore them yourself).
  `--keep-staging` keeps the decrypted download in `<state>/dr` for inspection (removed by default).

Run it on a host that never was part of the cluster (or remove `/var/lib/loadweaver` first). The node may get the
name of a lost member; everything else about it is new (keys, certificate).

### With the node installer

The installer (`/api/install/install.sh` of the cluster, saved with the kit) sets the host up like for a join
(Docker, gVisor, WireGuard, DRBD userland, …) and then runs the restore instead of joining. The cluster that served
the agent is gone, so it takes the saved `loadweaver-agent` binary (`/api/install/agent/<arch>`, or the release
bundle's) and checks it against the checksum in the script; everything after `--` goes to `bootstrap --restore`:

```bash
sudo LOADWEAVER_DR_ACCESS_KEY_ID=… LOADWEAVER_DR_SECRET_ACCESS_KEY=… \
  bash install.sh --restore --name n1 --endpoint-host n1.example.com --agent-file ./loadweaver-agent-amd64 \
  -- --dr-info loadweaver-dr-info-lw-1a2b3c4d.json --share-file share-1.txt --share-file share-3.txt
```

It installs the agent's systemd unit and starts the agent after the restore. Run the saved file with `bash` (not
`curl … | bash`) if the shares are to be typed in: a piped script has no terminal to ask on.

## What happens

| Phase            | Where                                  | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Key           | agent → DR tool (control-plane image)  | The agent runs `node main.js dr` of the control-plane image as a one-shot container (it has the code that decrypts the copy). The request (shares or KMS settings, target credentials) is a 0600 file on tmpfs, removed right after. The tool combines the shares (checksums verified, too few / mixed / duplicate shares refused) or unwraps the escrowed root through the KMS.                                                                                                                       |
| 2. Locate        | DR tool                                | Reads `platform/dr/cluster.json` and `platform/dr/keys.json`, then the DR envelopes newest first: the first whose base backup's stop sentinel is on the target (and that the kit's key generation decrypts) wins; with `--target-time` the newest finished before it. The envelope names the backup and the database scope (after a cut-over not the cluster id).                                                                                                                                      |
| 3. Download      | DR tool                                | Decrypts (and authenticates) into `<state>/dr`: the base backup, every WAL segment from its start on (all timelines, history files), the newest etcd snapshot (before the target time). The envelope gives the environment (`ENCRYPTION_KEY`, `JWT_SECRET`, database and replication passwords, auth settings) and the master key, written to the agent as a 0600 result file and deleted after reading.                                                                                               |
| 4. etcd          | agent                                  | `etcdutl snapshot restore` with this node as the only member; Patroni's keys of the lost cluster (`/service/…`) are removed (etcd only holds Patroni's coordination state today).                                                                                                                                                                                                                                                                                                                      |
| 5. Postgres      | agent (Spilo image, no network)        | `wal-g backup-fetch` from the decrypted copy, Postgres replays the WAL (to the end or the target time) and promotes; the data directory is marked with the database scope.                                                                                                                                                                                                                                                                                                                             |
| 6. Control plane | agent                                  | etcd, Spilo (Patroni takes the promoted data directory over as the leader of a new cluster), Valkey and the API start on this node as the only member, with the restored environment and the node's public host.                                                                                                                                                                                                                                                                                       |
| 7. Join + key    | agent → API                            | The node joins with a one-time token the restored API registered for it; the agent hands the master key over (`POST /api/dr/master-key`, authenticated by a one-time secret in the API's environment) and waits until it is sealed to this node's key (membership re-share). From then on the API unseals through this node like any member; the one-time settings disappear with the next desired state.                                                                                              |
| 8. Recovery      | API (`DrRecoveryService`)              | On its first start with the recovery settings: every previous node is marked `left` (lost), the object store's generations are retired (a new one forms on the new member), volumes whose replicas were all lost are re-placed (empty), stale runs (backups, restores, clones, cut-overs) are failed, the external copy's bookkeeping starts over (nothing copied before the loss is ever pruned).                                                                                                     |
| 9. Repositories  | API                                    | Once the new object store is active and the master key unsealed: each Kopia repository is re-seeded from the first target that has it (S3: object by object; SFTP: `kopia repository sync-to`), **before** its repository server may start on the empty bucket. Then a base backup restarts point-in-time recovery.                                                                                                                                                                                    |
| 10. Volumes      | API → nodes                            | Each re-placed volume is restored (`replace`) from its newest backup as soon as its new primary node is connected and has applied its desired state; the deployment may briefly start on the empty volume — the restore stops it, restores and starts it again.                                                                                                                                                                                                                                        |
| 11. Workloads    | API (`DrRecoveryService`), controllers | Once the restoring node joined as a member, every deployment is re-planned in failover mode onto the nodes that exist (replicas of lost nodes move, re-placed volumes get their new replicas); while something doesn't fit yet (e.g. a volume that needs a second node) the re-plan repeats each pass until replacement nodes joined, but writes placements (and recompiles) only when what it computes differs from what is placed. The controllers then start the replicas like after any node loss. |

Progress: the agent prints each phase with its duration; afterwards `GET /api/dr/status` (with the recovery secret,
during the restore) and the console's platform page (repositories, volumes, copies).

## After the restore — manual steps

- **Other nodes**: create join tokens and join replacement nodes (or wiped former nodes under their old names) with
  the installer. Former nodes that survived still hold their old certificate but are marked `left`: re-join them.
- **More members**: the control plane grows to 3 / 5 members as nodes join, like after a bootstrap.
- **DNS / ingress / failover IPs** pointing to the old nodes: they follow the placements once the ingress nodes are
  back; provider-side settings outside Loadweaver are yours to check.
- **Volumes without a backup** (or with `--no-volume-restore`) stay empty; restore them from the catalog.
- **Secrets, users, PATs, the cluster CA** come back with the database and the envelope: users log in as before,
  nodes get new certificates from the same CA.
- **What is lost**: everything after the restored point (newest base backup + the WAL that reached the target),
  logs and metrics not in the restored database / snapshots, OpenSearch indices (restore them from their snapshots
  if needed, see [Backups](./backups.md#restoring-opensearch-indices)).
- Download a new DR info file and check the external copy of the restored cluster (platform page) — it continues on
  the same target.

## Manual fixes

- _"no usable control-plane backup on the target"_: wrong kit generation (keys rotated: use the kit that was current
  when the newest base backup was copied), wrong prefix / bucket, or no complete base backup copied yet.
- A restore interrupted after phase 6: remove `/var/lib/loadweaver`, `docker rm -f lw-etcd lw-postgres lw-queue
lw-control-plane`, and start again.
- A cut-over that failed: the members' agents log what they did (`Postgres cut-over: …`); previous data directories
  are kept as `postgres.pre-<restore>`. Restoring one of them means stopping `lw-postgres`, moving the directory
  back, writing the scope it belongs to into `<state>/postgres-scope` and starting the agent.

## Tested

- Integration lab (`platform-dr.integration.spec.ts`): external copy to a second, independent Garage (the S3
  target), object lock against an in-test fake S3 (lock check, compliance retention per object, refused deletes
  kept), retention and deletion gating, cut-over with the agent's real cut-over code, the DR tool (2 of 3 shares)
  against the copy, etcd and Postgres restore with the agent's scripts (Patroni adopting the data), the API's
  recovery (nodes lost, object store retired, join token, master key re-sealed to the new member). Unit tests cover
  the re-plan and the lock check.
- **Object lock is not lab-verified against a real lock-capable S3**: Garage (the labs' only S3) has none.
- VM drill (`dr.vm-lab.spec.ts`, two KVM VMs with the real agent and the control plane built from the tree, a
  second Garage in the lab network as the external S3 target): a two-member cluster with a deployment whose
  replicated volume holds a known file, a volume backup copied to the target, base backup + etcd snapshot + DR
  envelopes copied encrypted; both VMs wiped; `bootstrap --restore --dr-info … --share-file … --share-file …` (2 of
  3 shares) on a fresh vm1; the admin logs in, the deployment and a secret written after the base backup (WAL) are
  back, the previous nodes are `left`, vm2 re-joins with a new token, the repository is re-seeded from the target,
  the volume is restored with the same checksum and the deployment runs on it; the next external copy uses the
  target's credentials secret (decrypted with the recovered master key).

### Drill timings

From the passing drill run (lab VMs: 3 / 2.5 GiB, 3 / 2 vCPUs; one base backup, a 4 MiB file on a 256 MiB volume):

| Phase                                                                   | Seconds |
| ----------------------------------------------------------------------- | ------: |
| `bootstrap --restore` in total                                          |     186 |
| – fetch and decrypt the control-plane backup from the target            |     4.5 |
| – restore etcd                                                          |    11.2 |
| – restore the database (WAL-G fetch, WAL replay, promotion)             |   146.9 |
| – start the control plane                                               |    18.8 |
| – join the restored cluster, hand over the master key                   |     2.8 |
| Volumes restored (vm2 re-joined, repository re-seeded, volume restored) |   202.9 |

The control plane answers after about three minutes; the volume follows once the replacement node joined.
