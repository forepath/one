# Loadweaver VM lab (M6)

Real Debian 13 VMs (QEMU/KVM inside containers) for what containers can't test: DRBD 9 kernel modules, CRIU,
kernel / DRBD upgrades with reboots, crashes and rejoins. Nothing is installed on the host; everything lives in
Docker containers and volumes.

## Requirements

- Docker with `/dev/kvm` visible to containers (Docker Desktop on WSL2 exposes it):
  `docker run --rm --device /dev/kvm debian:trixie-slim ls -l /dev/kvm`.
- Internet access for the first golden-image build (Debian cloud image, Debian + Docker apt repositories, LINBIT
  DRBD tarball, gVisor release tarball, Node.js tarball, busybox image). Lab runs themselves need none.
- Memory: guest RAM + 700 MiB per VM (QEMU), default guest 1536 MiB → ~2.2 GiB per VM; `startVmLab` refuses labs
  above 7 GiB (`maxMemoryMb`). Disk: golden image 1.6 GB (qcow2, 12 GiB virtual), QEMU image 274 MB; each VM's overlay grows with what
  it writes (a few hundred MB per run) and is removed by `stop()`.

## Usage

```bash
npx nx run loadweaver-backend-feature-node-agent:vm-lab          # all *.vm-lab.spec.ts (slow, explicit only)
npx nx run loadweaver-backend-feature-node-agent:vm-lab -- --testPathPattern=drbd
npx nx run loadweaver-backend-feature-node-agent:vm-lab-cleanup  # leftovers of aborted runs (keeps the golden image)
bash libs/domains/loadweaver/backend/feature-node-agent/src/integration/vm-lab/cleanup.sh --golden  # everything
```

```ts
const lab = await startVmLab({
  vms: [
    { name: 'vm1', site: 'a', dataDiskGb: 4 },
    { name: 'vm2', site: 'a' },
    { name: 'vm3', site: 'b', memoryMb: 1536, cpus: 2 },
  ],
  interSiteDelayMs: 10, // optional netem delay on the routed link
});
await lab.vms.vm1.exec('drbdadm --version'); // bash as root, `set -euo pipefail`
await lab.vms.vm1.copyIn('/tmp/x', '/opt/x', '0755');
await lab.vms.vm1.copyOut('/var/log/syslog', '/tmp/syslog');
await lab.vms.vm2.reboot(); // clean reboot, waits for a new boot id
await lab.vms.vm3.crash(); // power cut (kills QEMU)
await lab.vms.vm3.start(); // boots again from the same disks
await lab.stop(); // removes this run's containers and volumes
```

## How it works

- **Golden image** (`golden.ts`, `golden-provision.sh`): Debian 13 genericcloud `20261017-2634` (sha512-checked)
  booted once under QEMU user networking and provisioned by cloud-init: Docker CE 29.9.1 / containerd.io 2.4.2 /
  runc 1.5.2 from Docker's apt repository (key fingerprint pinned, exact versions, runc version asserted), Debian
  `criu` 4.1.1-1, `drbd-utils` 9.22.0, the DRBD 9.2.20 module built against the guest kernel (LINBIT tarball,
  sha256-pinned; kernel packages held), `wireguard-tools`, `nftables`, `bird2`, `keepalived` (disabled), `lvm2`,
  `cryptsetup`, `thin-provisioning-tools`, Node.js 24.14.1 (sha256-pinned) and a digest-pinned busybox image.
  Stored as `golden.qcow2` in the Docker volume `lw-vmlab-golden-<hash>`; the hash covers every pin and script, so a
  change builds a new image (remove old ones with `cleanup.sh --golden`). A package manifest is in the guest at
  `/etc/loadweaver-lab-golden.manifest`.
- **VMs**: one container per VM (own memory cgroup, `--device /dev/kvm`), disks in a per-run Docker volume:
  `disk.qcow2` overlay on the golden image (`cache=none,aio=native`; bind-mounted images get the container
  OOM-killed), optional `data.qcow2` (`/dev/vdb`), cloud-init seed (hostname = VM name, user `lab` with a per-run
  ssh key, static address, optional packages).
- **Network**: a small switch container owns the network namespace all VM containers join
  (`--network container:<switch>`): one Linux bridge per site (`10.77.<n>.0/24`, gateway `.1`), one tap per VM,
  routing between sites (optional netem delay) and NAT to the internet. VM addresses are `10.77.<site>.11`, `.12`, …
  in declaration order. The test process reaches the guests with ssh from inside the switch container.
- Everything carries the label `org.forepath.loadweaver.vm-lab` (`run` + run id, `golden`, `image`) for cleanup.

## Timings (this machine: WSL2, Docker Desktop 29.8.2, 12 vCPUs)

| Step                                                                                     | Time      |
| ---------------------------------------------------------------------------------------- | --------- |
| QEMU image build (once)                                                                  | 31 s      |
| Golden image build (once per pin set; download, apt, Docker, DRBD module build, convert) | 5.5 min   |
| Golden image reuse check                                                                 | ~1 s      |
| Lab start, 3 VMs (overlays, seeds, boot to ssh + cloud-init done)                        | 24–38 s   |
| Single VM boot to ssh                                                                    | 19–30 s   |
| Clean reboot (`reboot()`, new boot id)                                                   | 16 s      |
| Boot after `crash()`                                                                     | 12–15 s   |
| `drbd.vm-lab.spec.ts` end to end (golden cached; 4 VMs since the volume follow-ups)      | 160–185 s |
| `stop()`                                                                                 | ~3 s      |

## Specs

- `drbd.vm-lab.spec.ts`: the node agent's `VolumeManager` + Docker volume plugin (bundled by the global setup with
  esbuild from `volume-driver.entry.ts`, run with the guest's Node.js) on four VMs with 1 GiB guests (two in site
  a, protocol C; two in site b, protocol A): LVM thin → LUKS2 → DRBD, writes through
  `docker run --volume-driver loadweaver`, crash of the primary, promotion of the sync replica, rejoin + resync,
  failback. Node names (`n1`…) differ from the host names (`vm1`…), so DRBD only works through the host names the
  assignments carry. Then the volume follow-ups: the cross-site replica moves vm3 → vm4 (new node id 3, full resync,
  vm3's copy removed, `forget-peer` of node id 2 checked in `dump-md` on vm2, data checked on vm4), and a fresh
  volume on vm1 / vm2 / vm4 gets the same LUKS volume key everywhere and a clean `drbdadm verify`.
- `live-migration.vm-lab.spec.ts` (M6 step 1b, ~2.5 min): the agent's live-migration side (bundled from
  `migration-agent.entry.ts`: `MigrationService`, CRIU through runc, mutual-TLS transfer with lab-CA node
  certificates, restored replicas, kept-address network plugin, `VolumeManager` on DRBD) on two VMs plus a client VM
  holding a TCP connection. The VMs can't reach the test process and a full control plane doesn't fit the memory
  guard, so the entry exposes a control API on a unix socket and the test sends the control plane's session
  commands in its order; a static route on the client stands in for BIRD's host route. Covers a live move with the
  connection kept (freeze measured), adoption of the restored replica and its return to Docker, a failed restore
  with abort and resume, and a stateful service on DRBD. Then gVisor (step 1c): a sandboxed counter with a fully
  established TCP connection moves vm1 → vm2 by stop-and-copy (`runsc checkpoint` / `runsc restore` into the
  placeholder's network namespace, kept address), is adopted (logs, stats, agent-run health check, `runsc exec`), a
  corrupted image aborts and the source resumes from its own image, and its next restart goes back to Docker.
  Results (freeze times) are printed at the end. The golden image carries the pinned gVisor release
  (`GOLDEN_PINS.gvisor`, same layout and Docker runtimes as the node installer).

- `backups.vm-lab.spec.ts` (M6 step 3a, ~3.5 min): the agent's backup side (bundled from `backup-agent.entry.ts`:
  `BackupService`, `BackupJobs`, `KopiaServerManager`, `VolumeManager` + volume plugin on DRBD, control API on a unix
  socket like the migration driver) on two VMs (vm1 2 GiB: primaries, single-node Garage, the Kopia repository server
  from desired state `backupServer` with a self-signed certificate pinned by fingerprint; vm2: second replicas). Kopia
  and Garage images come from the local Docker (`docker save` → `docker load`). The test plays the control plane:
  it creates the volume's Kopia user on the server and sends `backupRun` / `restoreRun`. Covers (a) a backup of a
  volume in use with pre / post hooks in the replica (`fsfreeze` around the LVM thin snapshot, read-only LUKS open
  with the volume key, `ro,noload` mount), the re-sent command re-reporting the stored result and an incremental
  backup; (b) a whole-volume restore into a new volume (sha256, owners, modes, symlinks equal); (c) a `replace`
  restore into the volume in use (its container stopped and started again, extra files gone); (d) single-path
  restores (refused without `overwrite`, overwritten with it, a directory into another place); (e) scratch restore
  tests with a passing check and a failing one (exit 3 + output reported); (f) the volume's user gets "access denied"
  deleting its snapshot. After each step no `lw-bk-*` LV, mapping, mount, container or key directory is left.
  Timings (golden cached): lab up 23 s, images 15 s, repository server up (create repository, ACLs, policy) 22 s,
  20 MB backup 9.5 s / incremental 7.8 s, restore into a new volume 6.9 s, replace in use 36 s (30 s of it the
  stop grace of the busybox replica), single file 4.8 s, scratch + check 8.7 s; whole spec ~205 s.
  Finding: the LUKS mapping of a snapshot carries DRBD's internal metadata at its end, so `blkid -p` and `mount`'s
  own probing report `drbd` → the agent probes with `-u filesystem` and mounts with an explicit `-t`.

- `import.vm-lab.spec.ts` (M6 step 4, 3.21; bundled from `import-agent.entry.ts`: `DiscoveryService`, `ImportExecutor`,
  `VolumeManager` + plugin on DRBD, pod network, `WorkloadManager`, `IngressManager` with the pinned Envoy; control
  API on a unix socket, the test plays the control plane and runs the join plan's steps; vm1 2 GiB, vm2 1.5 GiB).
  (a) a compose project as `docker compose up` leaves it (nginx on :80, named volume with an owner, a hard link and a
  symlink, `.env` with a secret): `discover` changes nothing (containers, volumes, networks, `nft -s` ruleset,
  addresses, routes, files newer than a marker, running units, packages compared), secrets are redacted; the join plan
  from the control plane's builder; components (the control plane's script, `components.generated.sh`, kept in sync by
  its unit test: installs only rsync, reloads Docker, nginx keeps running, a second run is a no-op); activation (pod
  network, replicated volume); rsync pre-copy while nginx serves; stop (restart policy off); final pass (late writes
  and a replaced link come along); the imported nginx on the volume with the ingress taking port 80; handover; the
  tree (owners, modes, links, checksums) equals the source. Needs internet once for the rsync package (lab NAT).
  (b) a former node of the same cluster: vm2 held a replica of a volume with vm1, "left" (agent gone, resource down)
  while vm1 wrote 8 MiB; discovery reports the former installation, `classifyFormer` keeps the replica, the same
  assignment brings it back with the same LUKS header and DRBD metadata — 8252 KiB resynced, `drbdadm verify` clean.

- `updates.vm-lab.spec.ts` (M6 step 2 + gate, 3.26; real `UpdatesService` from `updates-agent.entry.ts` under systemd,
  vm1 serves the cluster's frozen apt snapshot and artifact routes): (a) self-update + live-restore, (a2) platform
  image report (Docker's list API `Image` = created-from reference incl. digest; `docker inspect`'s `.Image` is the
  image ID — the golden's Docker 29 uses the containerd image store), (b) self-update rollback and the per-release
  block (cleared when the node moves to another release), (c) host update + reboot token on the default golden
  (`/run/reboot-required` as the reboot trigger: its kernel is the snapshot's newest), (d) **real kernel-ABI change**
  on the `older-kernel` golden (`OLDER_KERNEL_IMAGE` in `golden.ts`: Debian 13 cloud image `20260914-2601`, kernel
  6.12.107; own volume `lw-vmlab-golden-60be62f433e4`, ~1.8 GB, built in ~5 min on first use): vm2 holds a DRBD
  replica with vm3, drains (vm3 primary, keeps writing), dist-upgrades from the snapshot to 6.12.113, rebuilds DRBD
  9.2.20 from the release's verified source for it (`modinfo -k` / vermagic checked, build log
  `/var/log/loadweaver-drbd-build-<kernel>.log`), GRUB's first entry is the new kernel (`GRUB_DEFAULT=0`), reboots on
  the token into it, the replica resyncs and both writes are intact after failback. Timings: snapshot 6 s, host
  update incl. DRBD build ~123 s, reboot ~23 s, resync ~4 s; whole (d) ~3 min plus the lab start.
- `bootstrap.vm-lab.spec.ts` (M6 gate): first-node bootstrap with a phase timeline (agent output, Docker events,
  etcd / Patroni / API logs), cold (images pulled during the bootstrap, as in the DR drill) and warm (images pulled
  first). Needs the `loadweaver-control-plane-api:dr-lab` image like the DR drill. Result: 139 s cold, of which the
  Spilo pull is ~110 s; 19 s warm (Patroni finds the local etcd within 2 s and initialises in ~4–6 s).

- `cloud.vm-lab.spec.ts` (P gate, Loadweaver Cloud): the user-data Decabill renders for the `loadweaver` service kind
  (`buildLoadweaverCloudInitUserData`, bundled with esbuild at test time — no cross-domain import) runs on one VM
  (4 GiB) like cloud-init would. The release (manifest + signature + standalone SEA agent) comes from an HTTPS server
  on the VM (lab CA), dev-signed and passed as the trusted key, with `consoleImage` pinned to the digest of this
  tree's console image (loaded into the VM, not pulled). A manifest signed by another key and a tampered agent stop
  the script before anything is installed; the real run checks bootstrap `--public-url` (+ `LOADWEAVER_TRUST_PROXY`,
  claim hash only), `components.sh` + agent unit, the digest-pinned console, nginx (`/`, `/api`, `/config.json`,
  `/v2` token realm, HSTS, no version banner, `limit_req` 429s), the admin claim through nginx (403 / 403 / admin /
  503), `nft list table inet loadweaver_cloud` and that `<VM IP>:3400` is unreachable from the lab switch.
  Deviations: Certbot is stubbed (no public DNS: the stub issues a lab-CA certificate where Let's Encrypt would, the
  script's own switch to the Let's Encrypt nginx config runs) and the control plane is this tree's image through the
  agent's `LOADWEAVER_CONTROL_PLANE_IMAGE` override (bootstrap + a systemd drop-in for the installed agent). Needs `loadweaver-control-plane-api:dr-lab`,
  `ghcr.io/forepath/loadweaver-console-server:latest` and `dist/apps/loadweaver/backend-node-agent/sea/loadweaver-agent`.

## M7: shared harness, M7 specs and spikes

Since M7.6 the harness itself (`vm-lab.ts`, `golden.ts`, `docker.ts`, `cleanup.sh`) is a thin layer over the shared
VM-lab harness [`libs/domains/shared/backend/util-vm-lab`](../../../../../../shared/backend/util-vm-lab/README.md)
(also used by Agenstra's isolation lab): same API, names, labels and golden volume, plus nested-KVM VMs (`nested`,
default on; `cpuFlags`), `nestedKvm()` / `dockerSocket()` / `forward()` per VM, the heavy / VM-lab locks, the host
memory check and cleanup on exit.

- `m7/` (`vm-lab-m7` target, `jest.vm-lab-m7.config.cts`): isolation ladder, microVMs, live sessions / consoles, full
  VMs (node side), QEMU live migration — through the M7 node driver (`m7-agent.entry.ts`: the agent's real
  `NodeAgentModule` with a control API, the test plays the control plane) — and scheduling, the VM API, Agenstra on
  Loadweaver and capability updates on a real cluster (`m7-cluster.ts`, `m7-cluster-agent.entry.ts`: the agent with
  the lab reconciler incl. the built-in registry), required host packages (F2, the M6 update driver).
- `spikes/` (`vm-lab-spikes` target): S1–S10 with PASS / FAIL verdicts and measurements.

Durations, memory and prerequisites: see the shared harness README.

## Findings from the first real-DRBD run (M6 step 1a)

Fixed in `lib/volumes/volume.manager.ts` (unit tests in `volumes.spec.ts`):

- A new volume was Inconsistent on every replica and could never be promoted → on first mount the primary runs
  `drbdadm new-current-uuid --clear-bitmap` when its metadata is just created and every assigned peer is connected
  and Inconsistent (no initial sync, thin LVs stay thin); single replicas use `primary --force`.
- An apply interrupted between `luksFormat` and `create-md` left the volume stuck (`No valid meta data found` on
  every apply) → metadata is created when `up` / `adjust` reports it missing.
- A failed attach left the resource up but Diskless, which counted as "up" forever → Diskless resources are adjusted.
- Right after boot the agent raced LVM autoactivation; `cryptsetup isLuks` then failed on the missing device node
  and the manager went on to **`luksFormat`** → inactive LVs are activated, and formatting happens only when
  `isLuks` exits 1 (not LUKS) and `blkid` finds no other signature.
- One failing volume aborted the whole apply (later volumes and stale-replica removal never ran) → per-volume errors
  are collected and reported after all volumes converged.
- Metadata is created with `--max-peers=7` (default: only the configured peers, so adding / moving replicas later
  had no free bitmap slot).

Open after 1a: DRBD matches `on "<node>"` against `uname -n`, but the installer doesn't set the hostname to the node
name (DRBD then reports "not defined in your config (for this host)"); the module is unsigned (taints the kernel, no
Secure Boot).

## Volume follow-ups (M6)

- Host names: agents report `uname -n` in their hello, the control plane puts it on each replica (`host`, protocol
  feature `drbd-hostnames`) and the `on` / `connection` sections use it; no hostname override needed.
- Replica moves: the remaining replicas run `drbdsetup forget-peer <res> <old node id>` after `adjust` dropped the
  peer. In `dump-md` a peer is `peer[<node-id>] { bitmap-index <slot>; … }`; the forgotten one has `bitmap-index -1`.
  `dump-md` needs `drbdadm apply-al` after `down` ("meta data is unclean").
- Shared LUKS volume key (`--volume-key-file` on tmpfs, AES-XTS 512, 4 KiB sectors, offset 16 MiB): a fresh
  256 MiB volume verifies clean in ~4 s. cryptsetup 2.7 keeps volume keys in the kernel keyring
  (`dmsetup table --showkeys` shows a key reference), so the spec compares `luksDump --dump-volume-key`.
- `luksFormat` / `open` with LUKS2's default Argon2id key slot failed silently on the busy 1 GiB guests (exit 1 / 5,
  no output: interrupted by the agent's 30 s command timeout while the PBKDF took up to half the RAM) → new key slots
  use PBKDF2 with minimal iterations (the passphrase is the machine-generated volume secret, the volume key is derived
  from it anyway), cryptsetup gets 120 s.
- Crash flake: in 2 of ~10 runs LVM refused the thin pool after vm1's crash
  (`Check of pool loadweaver/pool failed (status:64). Manual repair required!`, at boot and on every retry;
  thin_check exits 64 for any error). Not reproduced in 6 crash cycles of a thin pool without DRBD nor in the 5
  runs since. The manager now waits for udev and retries activation (helps the boot race, not this); the rejoin step
  prints `thin_check` diagnostics if it happens again. Open.
