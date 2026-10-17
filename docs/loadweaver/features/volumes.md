# Volumes

Named compose volumes are replicated block devices: **DRBD** on top of **LUKS** on top of an LVM thin volume. A workload always runs next to its volume's primary copy.

```yaml
volumes:
  db-data:
    x-loadweaver: { size: 20g, replicas: 2, crossSite: async }
```

- `replicas`: copies in the workload's site, written synchronously.
- `crossSite`: `async` (default) keeps a copy in another site that may lag slightly, `sync` waits for it, `none` keeps all copies in one site (shown as a pin).
- Volumes are **always encrypted**. Each volume has its own key in the secrets system; only nodes holding a copy receive it, and only in memory.
- Deleting a deployment never deletes its volumes. Removing data is a separate, explicit action.

When a stateful workload moves, the primary moves with it (short stop). When a node drains, its volume copies are rebuilt elsewhere before it may leave.

After a power cut, a node's LVM thin pool can carry leaked data blocks (allocated, used by nothing). LVM's default metadata check refuses such a pool ("Check of pool … failed (status:64). Manual repair required!"); the agent activates its volumes with `thin_check --ignore-non-fatal-errors`, so the copy comes back and resyncs on the next apply. Damaged mappings or metadata still fail the check and need a manual `lvconvert --repair`; the leaked space is reclaimed by such a repair.

Replication is not a backup: volumes are backed up by `BackupPolicy` resources from an LVM thin snapshot of the volume (crash-consistent, app-consistent with hooks), encrypted and deduplicated, with restores of whole volumes or single files — see [Backups](./backups.md).

## Where copies can live

Volumes need the **DRBD 9 kernel module** on every node holding a copy. Each agent reports whether one is loaded or loadable (node capability `drbd9`); nodes without it get no volume copies, and a stateful service that has no node with the module left is refused by the plan (`no eligible node has the DRBD 9 kernel module its volumes need`). Plans warn about nodes without the module, and about nodes whose agent is too old to report it (copies are then placed assuming the module is there). See [Host requirements](../deployment/host-requirements.md#storage-for-volumes).

DRBD identifies hosts by their kernel host name (`uname -n`), not by the Loadweaver node name. Agents report their host name when they connect, and the control plane names each copy's host by it, so node names and host names may differ. Older agents don't report it; their node name is used instead (with a plan warning), and it then has to equal the host name.

**Nodes that are still joining** get no new volume copies. A node counts as joining while its agent isn't connected yet, hasn't applied its current desired state or (members) reports a failed control-plane step — it is ready as soon as it reports its desired state applied, and after 30 minutes it counts as ready whatever it reports (an upper bound, so a stuck node doesn't hold copies back forever; a member still initialising after that long can get a copy whose apply then waits for it) — a new control-plane member pulls and starts etcd, Postgres and the API before it gets to its volumes, so a copy planned there would hold the apply up until the timeout and roll the plan back. Copies a joining node already holds stay. A new volume then gets fewer copies than asked for, and the plan says so (`volume data gets no copy on n2 (joining: …) while it is joining; plan again once the node is ready to add the copy`); the next plan after the node is ready adds the copy and lists it with the plan's workload changes (`volume shop/db/data: copy added on n2`; `GET /api/plans/{id}` → `workloadChanges` entries with `action: copy`). Every copy a plan adds to an existing volume is listed that way, also for plans that otherwise change no workloads. A new volume's primary goes to a ready node whenever one fits; only if a joining node is the only fit is it created there, with a plan warning that its apply waits for that node.

## Moving copies

When a copy moves to another node (draining, rebalancing, a node lost for good), the new node gets a fresh DRBD node id and a full sync from the current data; the old copy is removed from its node, and the remaining copies release the old peer's bookkeeping slot (`drbdsetup forget-peer`). A configuration change counts as done only once `drbdadm adjust` succeeded: until then a pending marker next to the resource file (`lw-<minor>.res.pending`, outside DRBD's `*.res` include) keeps the adjust and the peers to forget, so an adjust that failed or was interrupted by an agent restart is retried on the next apply, even though the file is already current. A `forget-peer` that fails (the adjust itself succeeded) stays in that marker as well and is retried on every apply until DRBD accepts it (a slot DRBD no longer has for that node id counts as forgotten; a peer that holds a copy again is dropped from the list); meanwhile the node's last apply report shows a warning on its `volumes` step (`DRBD forget-peer pending, retried on the next reconcile: <volume> (node-id <n>: <error>)`) without failing the apply. Each copy's metadata has slots for 7 peers. A node keeps its node id for as long as it holds a copy: failovers and migrations change roles, never ids.

## Encryption details

All copies of a volume are encrypted with the **same LUKS2 volume key**, derived from the volume's key in the secrets system; the key protecting the key slot is the volume's key itself. Copies therefore encrypt identically, and blocks that were never written read the same on every copy, so DRBD's online verification (`drbdadm verify`, enabled with `verify-alg sha256`) finds no differences on a fresh volume. During formatting the derived key is handed to `cryptsetup` through a root-only file on tmpfs (`/run/loadweaver`), removed right after; it is never written to disk. New copies use AES-XTS with a 512-bit key and 4 KiB sectors; their key slot uses PBKDF2 with minimal iterations, since its passphrase is the machine-generated volume key from the secrets system (a slow key-derivation function only matters for human passwords).

Volumes created before this change keep their per-copy keys and are not reformatted; they keep working as before, except that online verification can report blocks that were never written as different. A copy that is added or moved later gets the shared key and a full sync.
