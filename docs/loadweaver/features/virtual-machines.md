# Virtual machines

A `VirtualMachine` is a full virtual machine with its own operating system: a QEMU / KVM guest booted from a disk image, with replicated disks, one or more network interfaces and cloud-init for the first boot. It runs next to your compose services on the same nodes, joins the same groups and policies, and goes through the same plan and apply, Git, approvals and Terraform.

VMs and [microVMs](./isolation-levels.md#microvms) share their base: the same hardened launcher container, the same tap networking (the guest owns its address) and the same node probes. The difference is the input: a microVM boots a container image, a VM boots a **disk image** and keeps its disks.

|            | MicroVM (`x-loadweaver.runtime: microvm`)        | Virtual machine (`kind: VirtualMachine`)                           |
| ---------- | ------------------------------------------------ | ------------------------------------------------------------------ |
| Defined in | a compose service                                | its own resource                                                   |
| Boots      | the container image (unpacked, shared read-only) | a VM disk image (qcow2 / raw), written to the VM's own boot disk   |
| Replicas   | like any service                                 | exactly one instance                                               |
| Storage    | compose volumes, shared through virtio-fs        | disks: DRBD block volumes attached as virtio-blk                   |
| Network    | one interface (the replica's address)            | one or more NICs, each with its own addresses, groups and policies |
| Access     | terminals, exec and files inside the guest       | serial and graphical (VNC) consoles, SSH into the guest            |
| First boot | the image's entrypoint                           | cloud-init (NoCloud seed with user data, SSH keys, network config) |

## Requirements

VMs only run on nodes where the `microvm` [isolation level](./isolation-levels.md) is ready (a usable `/dev/kvm`, the release's launcher) and DRBD 9 is available for block-mode disks. Such nodes report the capability `virtualMachines` and the agent features `virtual-machines` / `vm-block-volumes`; the scheduler never places a VM anywhere else and says why in the plan. See [host requirements](../deployment/host-requirements.md#isolation-levels-kvm-and-microvms) for KVM, nested virtualization and the per-node opt-out.

## The resource

```yaml
apiVersion: loadweaver.com/v1
kind: VirtualMachine
metadata:
  name: db1
  project: shop
  labels: { app: db, tier: data }
spec:
  description: Postgres primary
  image: registry.lw/shop/debian-13:20261017 # pinned to its digest by the plan
  firmware: uefi # uefi (default) | bios (amd64 only)
  cpu: { vcpus: 4, model: host-model } # host-model (default) | host-passthrough
  memory: 8Gi
  disks:
    - { name: root, size: 20Gi, source: image, replicas: 2 } # the boot disk, written from the image
    - { name: data, size: 200Gi, replicas: 2, crossSite: async, cache: none }
  nics:
    - { name: eth0, groups: [db] } # primary: default route and the VM's DNS name
    - { name: backup, groups: [backup-net], labels: { net: backup }, ipv6: false }
  cloudInit:
    userData: |
      #cloud-config
      packages: [postgresql]
      write_files:
        - path: /etc/postgresql/replication.pass
          permissions: '0600'
          content: secret://shop/pg-replication
    sshAuthorizedKeys: ['ssh-ed25519 AAAAC3Nz… ops@example.com']
    networkConfig: auto # auto (default) | none
  placement:
    selector: { matchLabels: { tier: vm } }
    spread: node
  ha: { restartElsewhere: true } # default
  liveMigration: { enabled: true } # default
  runStrategy: Always # Always (default) | Manual | Halted
  console: { graphical: true } # default
```

| Field                   | Default           | Meaning                                                                                                                                                                               |
| ----------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `image`                 | (required)        | A [VM image](#images) in a registry the cluster pulls from, usually `registry.lw/<project>/<repository>:<tag>`; the plan pins it to its digest                                        |
| `firmware`              | `uefi`            | `uefi` or `bios` (amd64 only); the image must declare it                                                                                                                              |
| `cpu.vcpus`             | (required)        | 1-64 virtual CPUs                                                                                                                                                                     |
| `cpu.model`             | `host-model`      | `host-model` live-migrates between nodes of the same CPU vendor; `host-passthrough` exposes every host CPU flag and live-migrates only between identical CPUs                         |
| `memory`                | (required)        | Guest memory, at least `256Mi`; binary units (`G` = `Gi`)                                                                                                                             |
| `disks[]`               | (1-8 disks)       | `name`, `size` (required), `source` (`image` for exactly one disk: the boot disk; `blank` otherwise), `replicas` (1-5), `crossSite`, `bus` (`virtio`), `cache` (`none` / `writeback`) |
| `nics[]`                | (1-8 NICs)        | `name` (the interface name in the guest), `groups`, `labels`, `ipv4` / `ipv6` (default: every family the cluster has a pod pool for)                                                  |
| `cloudInit`             | none              | `userData` or `userDataSecret`, `sshAuthorizedKeys`, `networkConfig`; see [cloud-init](#cloud-init)                                                                                   |
| `placement`             | anywhere eligible | `selector` (as for services, incl. the [derived runtime labels](./isolation-levels.md#selecting-nodes-by-level)) and `spread` (`node` / `site`)                                       |
| `ha.restartElsewhere`   | `true`            | Restart on a node with a disk copy when the node fails; `false` pins the VM to its node                                                                                               |
| `liveMigration.enabled` | `true`            | Use [QEMU live migration](#live-migration) for planned moves                                                                                                                          |
| `runStrategy`           | `Always`          | `Always`: runs; `Manual`: powered on / off through the API or console; `Halted`: stopped                                                                                              |
| `console.graphical`     | `true`            | Offer the graphical (VNC) console next to the serial console                                                                                                                          |

- A plan checks the spec with the kind's JSON Schema (`GET /api/schemas/VirtualMachine`, also used by the console's Spec tab and create wizard) and then against the cluster: the image must be a VM image of the cluster's architecture, the boot disk at least the image's virtual size, the firmware one the image supports, the project's [quotas](#quotas) must hold and a node must be able to run the VM.
- The plan shows the VM as a replica `<project>/lw-vm/<name>/0` (the deployment name `lw-vm` is reserved for this) with a note where it can run: `runs at exactly microvm; nodes offering it: node-1, node-3`.
- Its disks are volumes `<project>/lw-vm/<name>.<disk>`.
- A VM has no replicas and no rolling updates: a spec change that needs a new instance (image, CPU, memory, disks, NICs, firmware) restarts the VM with a short stop. Changing the user data alone doesn't restart it (cloud-init only applies user data on the first boot anyway).

## Images

VM base images are **OCI artifacts** in the [built-in registry](./built-in-registry.md), stored, replicated and pulled like container images:

- the manifest has `artifactType: application/vnd.loadweaver.vm-image.v1`;
- the config blob (`application/vnd.loadweaver.vm-image.config.v1+json`) declares `arch` (`amd64` / `arm64`), `format` (`qcow2` / `raw`), `virtualSize` in bytes, `firmware` (`[uefi]`, `[uefi, bios]`, …), optionally `os` and `guestAgent: true` when the image runs qemu-guest-agent (consistent snapshots);
- a single disk layer: `application/vnd.loadweaver.vm-image.disk.qcow2` or `…disk.raw+zstd` (raw disks are stored zstd-compressed);
- several architectures go into an OCI index; the plan picks the cluster's architecture (VMs are single-architecture: arm64 only in all-arm64 clusters).

**KubeVirt containerDisk** images (a regular image whose layer holds `/disk/<file>.qcow2` or `.img`) are accepted as `image` as well, so existing KubeVirt image builds keep working.

### Uploading an image

With the [CLI](../cli.md), from a local qcow2 or raw file or a KubeVirt containerDisk archive:

```bash
loadweaver vm-image push debian-13-genericcloud-amd64.qcow2 registry.lw/shop/debian-13:20261017 \
  --arch amd64 --firmware uefi,bios --guest-agent
```

The CLI reads the format and virtual size (`qemu-img info --output=json` when installed, else the qcow2 / raw header; `--format qcow2|raw` overrides), refuses images with a backing file, uploads the disk in chunks to the cluster's registry through the control plane with your login (personal access tokens need `registry:push`) and prints the pushed reference with its digest. `--guest-agent` declares that the image runs qemu-guest-agent.

From a URL, as a background job on the control plane:

```bash
curl -s -X POST https://cp.example.com/api/projects/shop/vm-images/import \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"url": "https://cloud.debian.org/images/cloud/trixie/latest/debian-13-genericcloud-amd64.qcow2",
       "sha256": "<sha256 of the file>", "ref": "debian-13:20261017",
       "arch": "amd64", "firmware": ["uefi", "bios"], "guestAgent": true}'
```

- `202` with the import; `GET /api/projects/shop/vm-images/imports[/{id}]` shows its status. In the console, a project's **VM images** tab lists its imports and has an **Import VM image** dialog (also linked from the VM create wizard's source step).
- The download is HTTPS to public addresses only, checked again on **every redirect hop** (no internal addresses, as for webhooks), capped in size and verified against the checksum: exactly one of `sha256` and `sha512` (hex, optionally `sha256:` / `sha512:` prefixed; Debian and Alpine publish SHA-512 only). Accepted: qcow2, raw (compressed with zstd for storage), gzip-compressed files, and KubeVirt containerDisk tars (converted into a regular VM image).
- The result is pushed to `registry.lw/<project>/<ref>`; `ref` is `<repository>:<tag>` inside the project (or the full `registry.lw/<project>/…`).
- Operators of the project (scope `registry:push`); audited as `vm-image.import`, `vm-image.imported`, `vm-image.import-failed`.

| Variable (control plane)        | Default       | Meaning                                                      |
| ------------------------------- | ------------- | ------------------------------------------------------------ |
| `LOADWEAVER_VM_IMAGE_IMPORTS`   | `on`          | `off` stops the import job on this control-plane replica     |
| `LOADWEAVER_VM_IMAGE_MAX_BYTES` | `68719476736` | Largest download (64 GiB)                                    |
| `LOADWEAVER_VM_IMAGE_WORKDIR`   | the temp dir  | Scratch space for downloads and conversion (needs the space) |

### Image catalog

Instead of typing a URL and checksum, pick a recommended image. The catalog has three sources:

- **Recommended** (`source: shipped`): a curated list shipped with each release, pinned to dated builds with the checksums the publishers list: Ubuntu 24.04 / 22.04 LTS, Debian 13 / 12 (genericcloud), AlmaLinux 9 / 10, Rocky Linux 9 / 10, Fedora (current release) and Alpine (cloud-init), each for amd64 and arm64. Older builds can disappear upstream; the next release (or the live lookup) brings current ones.
- **Cluster** (`source: cluster`): the cluster's own entries in `Cluster.spec.vmImages.catalog[]`, changed through plans like every Cluster setting (Git-able, audited).
- **Other versions** (`source: upstream`): read on demand from the distros' published indexes and checksum lists (`SHA256SUMS`, `SHA512SUMS`, `CHECKSUM`, `releases.json`, `<file>.sha512`) of a fixed, built-in set of official HTTPS sources. Each line is cached for 10 minutes (failures for 1 minute), times out after 10 s and is size-capped; the SSRF check runs on every hop. A line that fails is left out and named in `warnings`; without outbound access only Recommended, Cluster and a manual import remain.

```yaml
kind: Cluster
spec:
  vmImages:
    catalog:
      - name: company-base # slug; unique per name and arch
        label: Company base image
        version: '2026.10'
        arch: amd64 # amd64 | arm64
        url: https://images.example.com/company-base-2026.10.qcow2
        sha512: <128 hex characters> # or sha256 (exactly one)
        firmware: [uefi, bios] # bios is amd64 only
        guestAgent: true
        description: Hardened base with our CA and agents
```

Entries (`VmImageCatalogEntry`) carry `id` (`ubuntu-24.04-amd64`, `cluster:<name>-<arch>`, `upstream:<distro>-<version>-<arch>-<build>`), `source`, `distro`, `label`, `version`, `arch`, `url`, `checksum { algorithm, value }`, optional `firmware`, `guestAgent`, `description`, `build`, and a `suggestedRef` for the import (`ubuntu:24.04`, `ubuntu:24.04-arm64`). Choosing one runs the normal import above into the project's registry, with its progress, audit, role (`registry:push`) and download cap. In the console the VM wizard's image step and the project's **VM images** tab offer the catalog. Through the [fleet](./fleet.md) both catalog reads are relayed read-only for any grant on the cluster (a project's too); imports are relayed for project operators and need `registry:push` on the fleet's service token.

### Signatures and policies

[Image policies](./image-policies.md) apply by repository exactly as for container images: a policy that requires cosign signatures blocks an unsigned VM image at plan time. Trivy vulnerability scans cover container images and microVM guest images, not the contents of VM disk images.

## Disks

Every disk is a [volume](./volumes.md) in **block mode**: a DRBD device (replicated, LUKS-encrypted below DRBD, so the guest sees plaintext) handed to the launcher as a device and attached as virtio-blk (`cache=none`, `io=native`, discard passed through). It is never formatted or mounted on the host: the guest owns its file systems. `replicas` and `crossSite` work as for volumes, and the VM always runs on a node holding a synchronous copy of every disk.

- **Boot disk.** On the first start the node writes the pinned image onto the boot disk: it fetches the image layer through the node's registry router (digest verified while streaming), keeps it in a node-local image cache, checks it with `qemu-img info` (format, no backing file, virtual size ≤ disk size) and converts it onto the DRBD device with `qemu-img convert` in a locked-down launcher container (no network, no capabilities, only that device). The import runs in the background on the node (other workloads on that node keep reconciling; at most `LOADWEAVER_VM_IMPORT_CONCURRENCY` imports at once): the VM's phase is `Importing` meanwhile, with the progress (`queued`, `fetching` with the bytes downloaded, `writing` with bytes of the image's virtual size) in the status, and the VM boots once the disk is written. A failed import shows the VM as `Failed` with the reason and an event, and is retried with backoff (1 minute, doubling up to 30 minutes). Deleting or stopping the VM cancels a running import; an import interrupted by an agent restart is repeated. Planned moves wait for the first import: while the node reports it `queued`, `fetching` or `writing`, plans (placement changes, rebalancing) keep the VM and its disks on that node with a plan note ("waiting for the boot-disk import"), and a drain moves everything else first and reports the VM as waiting (control-plane log; a `leave` refused meanwhile names it). The VM moves on the next plan / drain pass after the import finished. Afterwards the disk is marked with the image digest and never written from the image again; the guest grows its partition and file system on first boot (cloud-init `growpart`).
- **Failover and moves** never re-import: a node taking over a disk adopts the data on it. Failover isn't held by an import: if a node is lost in the middle of the first import, the next node adopts the half-written disk; re-image the VM (below).
- **Re-image** (`POST /api/projects/{p}/virtual-machines/{name}/reimage`, console **Reimage**): writes a stopped VM's boot disk again from its pinned image and bumps the cloud-init instance generation, so first-boot configuration runs again. Data disks stay as they are. Operators; audited `vm.reimage`.

| Variable (node agent)                | Default                        | Meaning                                                  |
| ------------------------------------ | ------------------------------ | -------------------------------------------------------- |
| `LOADWEAVER_VMIMAGE_DIR`             | `/var/lib/loadweaver/vmimages` | Node-local cache of VM image layers (sparse, by digest)  |
| `LOADWEAVER_VMIMAGE_CACHE_MAX_BYTES` | 15 % of the file system        | Cache size; least recently used images are removed first |
| `LOADWEAVER_VM_IMPORT_CONCURRENCY`   | `2`                            | Boot disk imports running at once on the node (1–16)     |

## Networking

Each NIC is a member of the network on its own, exactly like a service replica:

- It gets **its own addresses** from the pod pools (IPv4 and / or IPv6 per `ipv4` / `ipv6`) and a stable MAC (`52:54:00:…`, derived from the VM). Adding a NIC keeps the addresses of the existing ones.
- It belongs to the **workload groups** in `groups`, and group selectors match the VM's labels merged with the NIC's `labels`. [Policies](./groups-and-policies.md) between groups apply per NIC, so `eth0` can be reachable from the web tier while `backup` only talks to the backup network.
- The **guest owns the address**: the node connects each NIC through a tap device in the launcher (the same mechanism as microVMs), with anti-spoofing filters (only the NIC's MAC and addresses leave the guest). Ingress, egress policies, identities and kept addresses work as for containers; the guest is reachable on any port its policies allow.
- The **first NIC is the primary one**: default routes, DNS servers and the VM's DNS name (`<vm>.<project>.lw`, like a service). Further NICs get their own routing table with source rules, so replies leave through the NIC they came in on.
- With `cloudInit.networkConfig: auto` (default) cloud-init configures every NIC statically (`/32` and `/128` addresses, link-local gateways `169.254.1.1` / `fe80::1`, the node's DNS servers and the project's search domains, the pod network's MTU), matched by MAC. With `none` the image configures itself (the addresses still are the allocated ones: anything else is dropped).

## cloud-init

The first boot is configured through a **cloud-init NoCloud seed** (a small read-only disk labelled `CIDATA`):

- `meta-data`: instance id (`<vm uid>-<generation>`), host name (the VM name) and the SSH keys from `sshAuthorizedKeys`;
- `network-config`: version 2, as above (`networkConfig: auto`);
- `user-data`: `userData` as given, or the content of the secret in `userDataSecret` (`secret://<project>/<name>`).

The node builds the seed **on tmpfs** before every start and never writes it to disk. The instance id only changes on a re-image, so cloud-init doesn't run its first-boot modules again on a restart, a failover or a migration.

### Cloud-init secrets

VM cloud-init user data supports `secret://<project>/<name>[@<version>]` references, anywhere in `userData` (and `userDataSecret` itself is one):

- Only the VM's current placement node can fetch the refs listed in its control-plane-stored desired workload spec, and only from the VM's own project; unlisted refs and platform-reserved `lw-` secrets are refused.
- A pinned `@N` returns exactly version N (a missing version is refused). The plan pins unpinned refs to the secret's latest version, so a later secret change shows up in a plan instead of silently changing the next boot; unpinned refs use the applied deployment's secret version, or the latest version if none is recorded.
- Before each boot the node resolves the refs into the seed on tmpfs. Secret values are never logged, and nodes receive only a generic refusal while details stay in the control-plane log.

See [secrets and encryption](./secrets-and-encryption.md).

## Lifecycle and power

| `runStrategy` | The VM …                                                                              | Power actions                                               |
| ------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `Always`      | runs whenever it can; a guest that powers itself off is started again                 | `reboot`, `reset`                                           |
| `Manual`      | runs or stays off as last set through the API / console (starts running when created) | `start`, `stop`, `shutdown`, `force-off`, `reboot`, `reset` |
| `Halted`      | stays stopped (its disks stay)                                                        | none (re-image only)                                        |

- `start` places the VM right away (quotas and the scheduler apply: no capacity or a quota answers `409`) and recompiles the network; no plan is needed because the spec doesn't change.
- `stop` stops the VM with an ACPI shutdown within the launcher's grace period, `shutdown` asks the guest to shut down (ACPI) and leaves it off, `force-off` powers it off without asking the guest.
- `reboot` (ACPI) and `reset` (hard reset) go to the VM's node.
- In `Always` / `Halted` the run strategy owns the power: `start` / `stop` answer `409 managed by the spec`; change the run strategy through a plan instead.

The status shows a **phase**: `Pending` (not placed yet), `Importing` (the boot disk is being written), `Starting`, `Running`, `Stopping`, `Stopped`, `Migrating`, `Failed`, plus the guest's own power state as the launcher sees it (`running`, `paused`, `shutting-down`, `shut-off`, `crashed`, …), the node, the last boot, every NIC with MAC, groups and addresses, every disk with its primary and copies, and the last commands sent to the node.

### API

| Method and path                                                             | Scope                              | Who                                                      |
| --------------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------- |
| `GET /api/virtual-machines?project=`                                        | `resources:read`                   | VMs of every readable project                            |
| `GET /api/projects/{p}/virtual-machines[/{name}]`                           | `resources:read`                   | project members                                          |
| `POST /api/projects/{p}/virtual-machines/{name}/{action}`                   | `live:access`                      | operators, admins; developers when `developerExec` is on |
| `POST /api/projects/{p}/virtual-machines/{name}/reimage`                    | `plans:apply`                      | operators, admins                                        |
| `GET/POST /api/projects/{p}/virtual-machines/{name}/snapshots`              | `resources:read` / `plans:apply`   | members / operators, admins                              |
| `POST /api/projects/{p}/vm-images/import`, `GET …/vm-images/imports[/{id}]` | `registry:push` / `resources:read` | operators, admins / members                              |
| `GET /api/vm-images/catalog`                                                | `resources:read`                   | any project member or cluster role                       |
| `GET /api/vm-images/catalog/upstream` (10 per minute and caller)            | `resources:read`                   | any project member or cluster role                       |

`{action}` is `start`, `stop`, `force-off`, `shutdown`, `reboot` or `reset`. The detail response lists the `actions` the VM's state and the caller's role allow. The spec itself only changes through plans (`VirtualMachine` resources in the console's editor, the [CLI](../cli.md), [GitOps](./gitops.md) or [Terraform](../guides/terraform.md#virtual-machines)). Every action is audited (`vm.start`, `vm.stop`, `vm.force-off`, `vm.shutdown`, `vm.reboot`, `vm.reset`, `vm.reimage`, `vm.snapshot`). The OpenAPI document has the full schemas (`VirtualMachine`, `VirtualMachineSummary`, `VmSnapshot`, `VmImageImport`).

## Consoles

Two consoles per running VM, both through the audited live path (the browser never talks to a node; the control plane relays over the node's stream):

- **Serial console**: the guest's serial line in the browser terminal, with the boot log first (the last 1 MiB is kept). Recorded like a terminal when the cluster or project records terminals.
- **Graphical console**: the VGA screen through noVNC (`fpc-vnc-viewer`), with Ctrl+Alt+Del. Only metadata and duration are recorded, not the screen. Off with `console.graphical: false`.

Who may: as for [terminals](./terminals-files-and-tunnels.md#who-may), operators and admins of the VM's project, developers when the project allows `developerExec`. Sessions are audited (`vm.console.open` / `vm.console.close`) and listed with the terminal sessions (target `virtual-machine/<project>/<name>/console/<kind>`); idle consoles close after 30 minutes.

Clients use the Socket.IO namespace `socket/consoles` (console configuration key `consoles`): `openConsole { replica: "<project>/lw-vm/<name>/0", kind: "serial" | "vnc", cols?, rows? }` → `consoleOpened { sessionId, kind, recorded }`; `consoleInput` (serial text, VNC binary RFB), `consoleResize`, `closeConsole`; output `consoleOutput`, `consoleClosed`, `error`. Through the [fleet](./fleet.md) the namespace is relayed for cluster-wide `operator` grants.

The detail response's `consoles` says whether each console is available and why not (VM not running, the node lacks the `vm-consoles` feature, graphical console off, no permission).

## Snapshots, backups and restores

VM disks are backed up by [Kopia](./backups.md) like volumes, from an LVM thin snapshot of the disk on its primary node:

- **Consistency**: for a running VM the node asks qemu-guest-agent to freeze the guest's file systems (`fsfreeze`) right around the snapshot (at most 60 s) and thaws them before the upload. The backup is tagged `consistency:filesystem-frozen`, or `consistency:crash` when the guest has no agent or the freeze failed (a crash-consistent disk is what a power loss leaves: journaling file systems and databases recover from it).
- **Backup policies** select VMs by labels: every disk of a VM carries the VM's labels plus `loadweaver.com/vm: <name>` (`selector.deployments: { matchLabels: { loadweaver.com/vm: db1 } }`), all disks of a VM together. Compose backup hooks don't apply to VMs.
- **Snapshots** (`POST …/virtual-machines/{name}/snapshots`, console **Take snapshot**): one backup of every disk now, grouped as one snapshot (application-consistent when the image declares `guestAgent`, else crash-consistent); `GET …/snapshots` lists them with the per-disk backups. Operators; audited `vm.snapshot`.
- A disk backup holds one file, the raw disk (`<vm>.<disk>.raw`); Kopia's content-defined chunking deduplicates unchanged blocks between runs.
- **Restore** a whole disk with a `Restore` resource (console restore wizard): target `deployment: lw-vm`, `volume: <vm>.<disk>`, `mode: replace`. A running VM is stopped for the restore and started again; the disk is written in place on its primary and the copies follow through DRBD. Single-file restores (`path`) of VM disks are refused: boot the restored disk, or restore it into another VM, to get at files.

```yaml
apiVersion: loadweaver.com/v1
kind: Restore
metadata: { name: db1-data-2026-10-20, project: shop }
spec:
  backup: 6f0c… # a backup of shop/lw-vm/db1.data from the catalog
  target: { deployment: lw-vm, volume: db1.data, mode: replace }
```

## HA and failover

A VM is a single-instance stateful workload: when its node fails, DRBD's quorum and fencing promote a synchronous copy of each disk on another node and the VM **cold-boots** there (crash-consistent disks, like after a power loss). `ha.restartElsewhere: false` pins the VM to its node: it waits for that node to come back. Disks need `replicas` ≥ 2 for failover. Node loss is never a live migration.

## Live migration

Planned moves (a plan that changes the placement, draining or cordoning a node, rebalancing) move a running VM with **QEMU live migration**, shown in the plan as `vm-live (QEMU)`:

1. **prepare**: the target node prepares the launcher in incoming mode on the VM's kept addresses and MACs, its NIC taps, and the disks in **DRBD dual-primary** (both nodes may write during the switch).
2. **pre-copy**: QEMU copies the guest's memory to the target while the VM keeps running, over the encrypted WireGuard mesh (the agents' mutual-TLS transfer endpoint with a single-use token), round after round with auto-converge until the remaining dirty memory fits the freeze budget.
3. **freeze and switch**: the guest pauses for the last round and the device state, resumes on the target and announces its addresses (gratuitous ARP / unsolicited NA); routes follow as for any kept address.
4. **commit**: the source launcher is removed, the disks go back to one primary.

Disks don't move (they are already replicated). Open connections survive; the guest sees a short pause. An attempt that fails is aborted, the VM keeps running on the source, and Loadweaver falls back to a short stop.

A VM moves with a **short stop** (shut down, start on the target) instead when:

- `liveMigration.enabled: false`;
- `cpu.model: host-passthrough` and the two nodes' CPUs differ;
- either node's agent lacks VM live migration support;
- a disk has no synchronous copy on the target;
- the estimated freeze (the memory dirtied in the last round plus the device state, divided by the link speed between the nodes, plus a fixed QEMU cost) exceeds the cluster's freeze budget (`LOADWEAVER_LIVE_MIGRATION_FREEZE_BUDGET_MS`, default 3 s).

The reason is shown in the plan, for example `short-stop (cpu model host-passthrough needs identical CPUs on node-1 and node-2)`. Migrations are listed in the [migration history](./migration.md#history). Moves between sites follow the multi-site licence split.

Generic microVMs (`x-loadweaver.runtime: microvm`) live-migrate on the same machinery, shown as `microvm-live (QEMU)`: their writable layer and tmpfs volumes are pre-copied file by file, virtio-fs state moves with QEMU, and filesystem volumes are handed over during the freeze (one primary, never dual-mounted) instead of running dual-primary. See [live migration of microVMs](./migration.md#microvms).

## Quotas

Cluster admins limit VMs per project in the `Project` resource ([quotas](./projects-and-access.md#quotas)):

```yaml
spec:
  quota:
    virtualMachines: 10 # VirtualMachine resources
    vmVcpus: 32 # vCPUs of running VMs
    vmMemory: 64g # memory of running VMs
    vmDiskBytes: 2t # disk sizes of all VMs, each disk once
```

A running VM also counts into the project's `cpu` and `memory` quotas with the launcher's overhead (vCPUs + 0.25 CPU, memory + 384 MiB), and its disks into `storage`. Plans over a quota fail with the usage and the limit; `start` of a `Manual` VM is checked the same way.

## Roles

| Who                                | May                                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| viewers (and every project member) | read VMs, their status, snapshots and image imports                                                                 |
| developers                         | plan `VirtualMachine` changes (applied after approval, as for deployments); power and consoles with `developerExec` |
| operators, admins                  | apply, power actions, consoles, snapshots, re-image, image imports                                                  |
| cluster admins                     | everything; project quotas                                                                                          |

## Console

VMs are objects in the console's resource tree (under their node in the Placement view, under their project in the Projects view) and in **Contents** (`/resources/cluster?tab=contents&kind=VirtualMachine`, with phase, node and health; search with `project:`, `status:`, `node:` …). **Create ▾ › Virtual machine** opens the wizard (`/create/VirtualMachine`: General → Source image / import → Hardware → Placement → Network → Review, with **Edit as YAML** at every step); the VM goes into the draft and is created when the draft is submitted as a plan. A project's **VM images** tab lists its image imports and has the **Import VM image** dialog (operators).

A VM's page (`/resources/virtualmachine/<project>/<name>`) has the actions the VM's state and your role allow in its header (power ▾, snapshot, reimage, edit, delete; each confirmed), and tabs:

- **Summary**: status (incl. the guest's power state), machine (image and pinned digest, firmware, CPU, memory, cloud-init generation), NICs, disks with their copies, node commands;
- **Console**: the serial console (terminal panel with the boot log, a recorded badge and reconnect) and the graphical console (noVNC with Ctrl+Alt+Del);
- **Hardware** and **Snapshots** (with links to the backups);
- **Backups**, **Health**, **Metrics**, **Logs** and **Task history**.

The spec itself only changes through the draft and a plan (or the [CLI](../cli.md), [GitOps](./gitops.md), [Terraform](../guides/terraform.md#virtual-machines)).

## Limits

- One instance per VM; no PCI passthrough, GPUs, USB or hot-plugging of CPUs, memory, disks or NICs (a change restarts the VM).
- At most 8 disks and 8 NICs, 64 vCPUs; virtio is the only disk bus, so guests need virtio drivers (every current Linux cloud image has them; Windows needs the virtio drivers installed).
- No live snapshots of memory: snapshots are disk backups.
- VM disk images aren't vulnerability-scanned.
- An existing disk isn't resized (as for volumes): add another disk instead.
- Additional NICs get the pod network's MTU.

## Related

- [Isolation levels and microVMs](./isolation-levels.md): the KVM base, node probes and opt-out
- [Volumes](./volumes.md) and [backups](./backups.md): replication, encryption and Kopia
- [Migration](./migration.md): methods and history
- [Terraform](../guides/terraform.md#virtual-machines): `loadweaver_virtual_machine`
- [Built-in registry](./built-in-registry.md): where VM images live
