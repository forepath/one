# Updates

Everything that runs on the nodes and the control plane — the node agent, the control plane, Envoy, BIRD, etcd,
Patroni / Spilo, OpenSearch, Garage, the registry, gVisor, the DRBD module, Docker / containerd / runc / CRIU and the
OS packages Loadweaver depends on — is updated together, from **one signed release bundle** per Loadweaver release.
An update is **a plan**: it shows what changes on which node, runs control-plane members first, then a canary, then
waves, waits for health gates after every step, and pauses and rolls a step back on its own when something gets worse.

## Release bundles

A bundle is one uncompressed tar:

| Entry           | Content                                                                                                                                                                                            |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `manifest.json` | The manifest in canonical JSON (sorted keys, no whitespace) — exactly the bytes that are signed                                                                                                    |
| `manifest.sig`  | `{ "algorithm": "ecdsa-p256-sha256", "keyId": "…", "signature": "<base64 DER>" }`; absent in unsigned dev bundles                                                                                  |
| `artifacts/…`   | Agent binaries per architecture, OCI archives of every image, gVisor tarballs, the DRBD source / prebuilt modules / compat patches per kernel, the apt snapshot index and its package packs per OS |

The manifest pins every component to a tested version: images by digest (`control-plane`, `envoy`, `ratelimit`,
`valkey`, `etcd`, `postgres` (Spilo), `opensearch` (with the `repository-s3` plugin, its checksum recorded), `garage`,
`registry`, `bind9`, `trivy`, `node-shell`), the `node-agent` binaries (SHA-256 per architecture), `gvisor` (the
release tarball, SHA-512 per architecture), `drbd` (the LINBIT source tarball by SHA-256, prebuilt modules per kernel
ABI where the pipeline built them, DRBD's compat patch per kernel of the release — see _DRBD without internet_ below),
and host packages per supported OS (`storage`: lvm2 / cryptsetup / drbd-utils /
thin-provisioning-tools, `docker`, `containerd` (with runc), `criu`, `bird`, `wireguard`). It also carries compatibility
notes, the channel (`stable`, or `beta` for prereleases) and an optional minimum version to update from (clusters below
it update through an intermediate release: N-1). Every file of the bundle is listed with size and SHA-256.

The pins live in one place in the source tree, `libs/domains/loadweaver/shared/util-release/src/lib/pins.ts`: the
release pipeline builds the manifest from it, and the node agent runs these pins when its desired state names no
release yet. The `LOADWEAVER_*_IMAGE` variables of the agent stay as **development overrides** only: the agent logs
them, reports them, and every update plan lists them as a warning.

The schema is forward compatible: the control plane updates first, so it imports bundles of the next release; unknown
fields and component kinds are kept and ignored, the signature always covers the bytes as received.

### Signatures and key handling

Bundles are signed with an ECDSA P-256 key over the manifest's canonical bytes (the same primitive the cosign verifier
of image policies uses). The control plane, the node agent and the CLI verify with the **public keys compiled into
them** (`RELEASE_SIGNING_KEYS.loadweaver` in the shared key registry `@forepath/shared/shared/util-release-keys`);
nothing in the cluster can add a trusted key.

- **Generate** a key pair with the shared release-integrity tool:
  `npx nx run release-integrity:generate-release-key -- --product loadweaver --private-key-out <file>`. It prints the key id and the public key and
  writes the private key only to the file (mode 0600).
- **Store** the private key as the repository secret `LOADWEAVER_RELEASE_SIGNING_KEY` (environment `production`) and
  delete the file. The release job builds the bundle without it (`build-bundle --defer-signature`) and passes it only
  to a separate, minimal step that signs the manifest and assembles the tar (`build-bundle.cjs --sign-deferred`, the
  script the build step compiled; no nx, no network); the release manifest is signed the same way
  (`release-manifest … sign`). It is never printed.
- **Publish** the public key: add it to `RELEASE_SIGNING_KEYS.loadweaver` in
  `libs/domains/shared/shared/util-release-keys/src/lib/release-keys.ts`; it ships with the next release.
- **Rotate**: add the new public key next to the old one, release, switch the secret, and remove the old key once no
  supported release is signed with it anymore. A signature names its key id, but every compiled-in key is tried.
- **Release manifest**: the same key signs `loadweaver-release-manifest-<version>.json` (+ `.sig`), attached to the
  GitHub release by the shared job _Sign Release Manifest_: the release's container images (control plane, console,
  landing page, billing console) by digest and the source commit, verifiable without a cluster:
  `npx nx run release-integrity:release-manifest -- verify --product loadweaver --manifest <file>`, or with OpenSSL as
  described in `tools/release-integrity/README.md`. The bundle keeps its own signed manifest.
- **Development**: unsigned bundles are refused unless `LOADWEAVER_ALLOW_UNSIGNED_BUNDLES=true` is set on the control
  plane **and** on the agents (VM labs, development clusters); imports are audited with a warning and update plans warn.
  With `NODE_ENV=production` (the control-plane containers, the packaged agent) the opt-in is ignored unless
  `LOADWEAVER_ALLOW_UNSIGNED_BUNDLES_IN_PRODUCTION=i-understand` is set as well. Either way the setting is logged as a
  warning on every start and shown in `GET /api/updates/status` (`unsignedBundles.allowed` / `notice`).
  Tests sign with throw-away keys passed as `LOADWEAVER_RELEASE_DEV_KEYS` (ignored when `NODE_ENV=production`, as on
  the control-plane containers).

### Building bundles

The release workflow (`.github/workflows/release.yml`, job _Build Loadweaver Release Bundle_) builds the agent as
single executables for amd64 and arm64, builds and pushes the OpenSearch image with `repository-s3`, resolves the
release's control-plane and console image digests (the console image, `loadweaver-console-server`, is not a cluster
component: it goes into the manifest's top-level `consoleImage`, which Loadweaver Cloud verifies and pulls by digest;
clusters and N-1 control planes ignore it), exports every image as an OCI archive (`skopeo copy --all`), downloads the
pinned gVisor tarballs and the DRBD source (checksums verified), freezes the apt snapshot for air-gapped clusters
(`scripts/apt-snapshot.ts`, every supported OS release × amd64 / arm64, see _Air-gapped OS updates_ below),
pre-generates DRBD's compat patch for every kernel that snapshot holds (`scripts/drbd-compat.sh` in a `debian:12` /
`debian:13` / `ubuntu:22.04` / `ubuntu:24.04` container per architecture, arm64 through QEMU), builds and signs the bundle
(`--require-signature`), and attaches `loadweaver-bundle-<version>.tar` (+ `.manifest.json`, `.manifest.sig`,
`.tar.sha256`) to the GitHub release. Bundles above 1.9 GB are uploaded in parts (`.tar.part000`, `.part001`, …;
GitHub limits assets to 2 GiB); the control plane reads the parts in order as one stream.

Locally (labs, development):

```sh
# Builds the agent and an unsigned bundle in dist/loadweaver-dev-bundle
npx nx run loadweaver-shared-util-release:dev-bundle --release 0.0.0-dev.1 \
  --control-plane-image ghcr.io/forepath/loadweaver-control-plane-api:<tag>@sha256:<digest>
# Full control: any combination of the release job's options
npx nx run loadweaver-shared-util-release:build-bundle --release 3.5.0 --control-plane-image <ref@digest> \
  --agent-amd64 <file> [--agent-arm64 <file>] [--console-image <ref@digest>] [--image-archive envoy=<oci.tar> …] \
  [--gvisor] [--drbd-source] \
  [--drbd-prebuilt <kernel>:<arch>=<modules.tar.gz> …] [--drbd-compat <kernel>:<arch>=<entry.tar.gz> …] \
  [--apt-snapshot <dir>/snapshot.json [--apt-files <dir>/blobs]] [--note …] [--minimum-version 3.4.0]
# The apt snapshot a bundle carries (network; packages are fetched by build-bundle, by checksum)
npx nx run loadweaver-shared-util-release:apt-snapshot --release 3.5.0 --host debian:13/amd64 [--host <os>/<arch> …] \
  [--package <extra root> …] [--out dist/apt]
# DRBD compat patches (as root, on a host / in a container of the target OS release and architecture; needs network)
libs/domains/loadweaver/shared/util-release/scripts/drbd-compat.sh <drbd-9.2.20.tar.gz> <sha256> <out-dir> [kernel …]
```

## Getting a bundle into the cluster

The control plane downloads a bundle **once**, verifies the signature and every artifact while it streams, and stores
it in the cluster: images go into the built-in registry as `lw-system/<component>@<digest>` (digest-preserving), files
into the object store by SHA-256. Nodes fetch **only from the cluster** (`/api/updates/artifacts/<sha256>`, public like
the installer; nodes verify every byte against the signed manifest themselves) and pull images by digest — from the
upstream registry when reachable, otherwise from `lw-system/…` in the cluster registry.

| Source (`Cluster.spec.updates.source`) | How                                                                                                   |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `github` (default)                     | The release asset of `LOADWEAVER_RELEASES_REPOSITORY` (default `forepath/one`), tag `v<version>`      |
| `mirror`                               | `<mirrorUrl>/<version>/loadweaver-bundle-<version>.tar` (HTTPS only)                                  |
| `upload`                               | Air-gapped: `POST /api/updates/bundles` (console upload, `loadweaver updates upload <file or parts>`) |

`POST /api/updates/releases/<version>/download` starts a download (the update policy does it automatically for
announced releases). Uploads are streamed and capped at `LOADWEAVER_BUNDLE_MAX_BYTES` (default 16 GiB). A bundle with a
bad signature, an unsigned bundle without the opt-in, an unlisted, missing or tampered artifact, or one above the cap
is refused before anything is stored and audited as `update.bundle-refused`; a successful import is audited as
`update.bundle-imported` (with the key id, or a warning for unsigned bundles).

## Releases and channels

New releases are announced through the shared updates feature (as in Agenstra and Decabill): every 6 hours
(`LOADWEAVER_UPDATE_CHECK_CRON`, `LOADWEAVER_UPDATE_CHECK=off` for air-gapped clusters) the control plane checks the
GitHub releases of its channel — `stable`, or `beta`, which includes prereleases — with the Loadweaver-scoped
changelog, records the newest as an `announced` release and publishes `update.available`. The shared admin view is
available at `/api/updates/announcements` (global admins). Releases are versions of the repository's release tags;
betas are prereleases from the `beta` branch.

## Update policy and maintenance windows

```yaml
apiVersion: loadweaver.com/v1
kind: Cluster
metadata: { name: cluster }
spec:
  updates:
    policy: auto-patch # notify | auto-patch (default) | manual
    channel: stable # stable | beta
    source: github # github | mirror | upload
    osUpdates: true # include OS security updates in automatic updates
    settleSeconds: 60 # how long a step must stay healthy
    stepTimeoutMinutes: 30 # how long a step may take before it counts as failed
```

- `notify`: announced releases are downloaded and imported; people create and approve update plans.
- `auto-patch` (default): additionally, a newer **patch** release becomes an update plan approved by the policy and runs
  inside maintenance windows; **minor / major** releases become plans that wait for an approval; with `osUpdates` and
  at least one maintenance window, OS updates of the current release are planned weekly. Automatic plans are visible
  and audited like any other.
- `manual`: nothing automatic (no checks, no downloads, no plans).

Maintenance windows are their own resources, selected per node (sites, labels, names):

```yaml
apiVersion: loadweaver.com/v1
kind: MaintenanceWindow
metadata: { name: fra1-nights }
spec:
  sites: [fra1]
  selector: { matchLabels: { tier: edge } }
  days: [tue, thu]
  start: '02:00'
  end: '05:00'
  timeZone: Europe/Berlin
```

The times are wall-clock times in the window's time zone on the start day; an `end` before `start` crosses midnight
(`tue 23:00–02:00` starts on Tuesday). Daylight saving time is followed: a start inside a spring-forward gap moves to the
first valid minute after it, a window across a fall-back night lasts one real hour longer. Steps on a node start only
inside one of its windows; a rollout that doesn't fit into one window waits and continues in the next. Nodes without any
window are updated only by plans that ignore windows. Clusters without any window run manually approved plans right
away (automatic plans need windows).

## Update plans

`POST /api/updates/rollouts` (console, `loadweaver updates plan <version> [--host] [--os-upgrade]`) creates a plan:

- the **diff** per node and component (current → target and how it updates, see below), from what the agents report;
- the release's **notes** and **warnings**: nodes whose agent predates release components (left out, to be updated with
  the installer), unsigned bundles, development image overrides, downgrades;
- the **steps**: control-plane members one at a time (Patroni replicas first, the leader last), then a **canary** (the
  least busy regular node), then **waves** — one site at a time, the canary's site first, at most one node per wave
  (`failureDomain: node`) or one site (`failureDomain: site`);
- the **failure analysis** of every wave: services and volumes without a copy outside the wave's nodes (host updates).

With `host` the plan also updates OS packages, the kernel, gVisor and the DRBD module (drain → update → reboot →
rejoin, below); a plan without a version does that for the current release. A new plan supersedes pending plans and
resolves a failed rollback (fix forward). Plans need the cluster-admin role; approving (`approve`, `--emergency` to run
outside maintenance windows — the explicit approval for emergency security fixes) starts them, one update at a time.

## Rollout

A rollout controller on the control plane runs approved plans. One replica holds the rollout's lease (renewed every
5 s and before every step decision, expiring after 30 s); every decision is derived from the steps stored in the
database, so when the leader dies — also when its own control-plane member was just updated and its process replaced —
the next replica continues exactly where it stopped. Step and rollout writes are fenced on the lease (owner and expiry):
a replica that lost it stops its pass without writing anything more.

A step: **wait for the window** → (host updates: **drain**) → set the node's target release (and host update /
Patroni switchover) → (host updates: wait for the packages, then **reboot** on a token) → **verify** the health gates
until they hold for `settleSeconds` → (uncordon). Health gates:

| Gate          | Passes when                                                                                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `reconnected` | the node is connected with a fresh heartbeat                                                                                                                                                                 |
| `version`     | the node reports the target release and the release's agent version (it reconnected with the new agent)                                                                                                      |
| `apply`       | the node applied the desired-state revision that carries the target, every layer included; a failed `components` / `control-plane` layer fails the step, another failed layer is waited for                  |
| `images`      | every platform container the node runs runs the release's digest (development overrides excepted), and a member runs its etcd / Postgres / API containers at all (witnesses: etcd)                           |
| `reboot`      | a new boot id after an ordered reboot                                                                                                                                                                        |
| `action`      | none of the step's update actions failed (self-update, host update, switchover) — a failure fails the step; release-keyed actions (`images:` / `self-update:`) of an earlier attempt don't count             |
| `health`      | no entity of the health tree became failed (fails) or at risk (waits) since the step started                                                                                                                 |
| `slo`         | no SLO started burning since the step started (fails)                                                                                                                                                        |
| `replication` | every node reports its DRBD volumes in sync (resync after a reboot is waited for)                                                                                                                            |
| `quorum`      | members only: every member connected; etcd healthy on every member that reports it, seeing every member; exactly one Patroni leader; every Postgres member answering and its replicas less than 1 MiB behind |

The agent reports a release only once an apply of the desired state carrying it completed — every layer, the
containers included — never while it is being applied (a rolled-back apply reports the previous release). Members and
witnesses also report their etcd's `/health` and member count, Patroni replicas their lag (`componentVersions.etcd`,
`postgresLag`; agents of the previous release don't, and aren't held to it).

A failing gate or a timeout (`stepTimeoutMinutes`; 30 min for drains) **pauses** the rollout and **rolls that step
back** at once: the node returns to its previous release. A rolled-back step is retried on `resume`; `rollback` returns
every updated node in reverse order (nodes first, control-plane members last, so no member runs older code than a node
talks to). Host updates can't be undone automatically once packages were installed: such a step ends
**`rollback-failed`** with the node's real versions shown, like a failed apply rollback (3.19), and a new update plan
fixes forward. Alerts about nodes a step is draining, restarting, rebooting or verifying are silenced (maintenance).
`cancel` is refused while steps are in flight (draining, applying, rebooting, verifying, rolling back): their nodes may
be drained and silenced, and only the controller gives them back. Wait until they finished (they keep moving while the
rollout is paused) or roll the update back; the error names the nodes.

How each component updates:

| Component                                                 | How                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node agent                                                | Binary swap + `systemctl restart`: downloaded from the cluster, checked against the signed manifest, swapped by a transient unit; containers keep running (Docker live-restore)                                                                                                                                                                                                                                                                                                                                                                                           |
| Envoy (ingress, node proxies)                             | Hot handover: the new image starts next to the running one (`SO_REUSEPORT`), then the old one drains (`/drain_listeners?graceful`) and stops after 30 s (`LOADWEAVER_ENVOY_DRAIN_SECONDS`)                                                                                                                                                                                                                                                                                                                                                                                |
| Control plane, etcd, registry, valkey, Garage, OpenSearch | Member by member (one step per member); the API keeps serving from the others; the next member waits for the apply / images gates (its containers run the release's digests) and the quorum gate (etcd healthy with every member, one Patroni leader, replicas caught up); OpenSearch green / Garage health count through the health tree, not as separate gates                                                                                                                                                                                                          |
| Postgres / Patroni                                        | Replicas first; on the leader's member the agent switches over to an updated replica (Patroni REST) before its database container changes. The leader is determined when the step starts, not at plan time: a member that leads by then without an updated replica lets a not-yet-updated replica go first, or waits — never updated in place (a single Postgres member excepted). An unknown Patroni role is retried and then fails the switchover; a failed switchover keeps Spilo on its image while the member's other layers converge, and fails the step (rollback) |
| BIRD (`bird2`)                                            | Host updates: `birdc graceful restart` before the package changes — peers keep the routes until BIRD is back                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Docker, containerd, runc, CRIU                            | Host updates from the cluster-local apt source; live-restore keeps containers running                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Kernel, DRBD module, gVisor, WireGuard                    | Drain → packages / module / gVisor → reboot → rejoin, one node at a time                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## OS and kernel updates

Host updates install only from the **cluster-local apt source**, a frozen snapshot the control plane takes when the
update is planned: the upstream `InRelease` and `Packages` indexes of every source the nodes need (Debian / Ubuntu
archives, the security archive, Docker's repository; per OS release and architecture — `LOADWEAVER_APT_SOURCES`
replaces them, e.g. with mirrors) are stored and served unchanged under `/api/updates/apt/<snapshot>/<source>/…`;
packages are fetched once from the upstream archive and stored by checksum (air-gapped bundles ship them) — but only
pool files the snapshot's frozen `Packages` indexes list, and only bytes with exactly the size and SHA-256 listed there
(anything else is a 404 without contacting the upstream; mismatches are neither stored nor cached), so the public
route is no general download proxy. Plain-`http` upstreams are logged as a warning when a snapshot is taken (prefer
https mirrors; integrity doesn't depend on the transport). apt on the
node verifies the distribution's signature over `InRelease` and every checksum itself, so every node of a rollout
installs exactly the same versions and the control plane can't change what gets installed. (`Check-Valid-Until` is off
for this source: the snapshot is frozen on purpose.)

On the node the agent writes its own apt configuration below `/var/lib/loadweaver/apt` (the host's sources stay
untouched), pins the release's host packages (installed ones only) and runs one script as a transient systemd unit:
`apt-get update`, `dist-upgrade` (OS updates) and the pinned versions (also as downgrades), BIRD's graceful restart,
gVisor (the verified tarball, registered with the shared install script, Docker reloaded, not restarted), and the DRBD 9
module for the kernel the next boot runs (prebuilt for that kernel, else built from the verified source against its
headers with the release's compat patch, offline — see below; build log in `/var/log/loadweaver-drbd-build-<kernel>.log`;
with Secure Boot on, only signed prebuilt modules are accepted). The script fails before any reboot unless
`modinfo -k <next kernel>` reports the release's DRBD version (VM lab: a real 6.12.107 → 6.12.113 kernel update with
the module rebuilt, GRUB's default on the new kernel, reboot and resync); its reason is the step's error
(`host update failed: …`). It never reboots on its own: once the
packages are in, the agent reports whether a reboot is needed (newer kernel, `/run/reboot-required`) and the controller
sends a reboot token; after the reboot the node rejoins with a new boot id and is uncordoned once its gates hold.
`unattended-upgrades` is switched off by the installer so reboots never happen uncoordinated.

### Air-gapped OS updates (bundled apt snapshot)

An air-gapped cluster reaches no upstream archive, so the release bundle carries the OS packages, too:

- **Snapshot** (`scripts/apt-snapshot.ts`, release job step _Freeze the apt snapshot for air-gapped clusters_): freezes
  `InRelease` / `Packages` of the default sources of every supported OS release × architecture (or
  `LOADWEAVER_APT_SOURCES`) and selects the packages a Loadweaver node installs or updates: every
  `Priority: required / important` package (the base system), the installer's and the pinned host packages (BIRD,
  keepalived, WireGuard, nftables, LVM / cryptsetup / drbd-utils, Docker / containerd, CRIU, …), what a cloud host runs
  (OpenSSH, sudo, cloud-init, GRUB / initramfs tools), the kernel and headers metapackages (Debian `linux-image-<arch>` /
  `-cloud-<arch>`, Ubuntu generic / virtual and HWE) and the DRBD build tools (gcc, make, …) — with their dependency
  closure (`Pre-Depends`, `Depends`, `Recommends`; virtual packages via `Provides`), each at the newest version in the
  snapshot (what `dist-upgrade` installs) or the release's pin. `--package` adds roots. It writes the index
  `snapshot.json` (`{ id, sources, files, pool }`), the frozen indexes by checksum and the selected kernels per OS /
  architecture (the DRBD compat step generates patches for exactly these).
- **Bundle** (`build-bundle --apt-snapshot … --apt-files …`): fetches every file the index names **by its checksum**
  (the frozen indexes from the snapshot step's directory, packages from the upstream archive), verifies size and
  SHA-256 (a mismatch fails the build), stores each file once and packs them per OS into
  `artifacts/apt/packages-<os>.tar` (members named by SHA-256). The packs are artifacts of the manifest (`aptPackages`)
  — checksummed and covered by the signature; the manifest lists the packs rather than thousands of packages because it
  goes to every node with each release target. The index names every member with its checksum, and apt on the node
  checks each package against the distribution-signed `Packages` index anyway.
- **Import**: the control plane unpacks the packs into its artifact store (every member must be a file the index
  names, with its size; stored by checksum) and registers the pool files. When the upstream archives are unreachable
  at plan time (or the cluster is upload-only), update plans use the bundle's snapshot, and the apt source serves
  indexes and packages from the store without contacting upstream; a package that is already in the store by its
  checksum is never fetched again, for any snapshot.
- **Scope**: packages outside the selection (installed on a node by hand) can't be upgraded from the bundle — their
  download fails the host step on an air-gapped cluster; build your own bundle with `--package` for them.
- **Size**: roughly 0.4–1 GB of packages per OS release and architecture (Ubuntu's kernels with their module packages
  and the HWE kernels are the largest part), several GB for all eight combinations — the bundle grows accordingly
  (uploaded in 1.9 GB parts to the GitHub release; `LOADWEAVER_BUNDLE_MAX_BYTES` defaults to 16 GiB). On import the
  packs are stored as artifacts and unpacked next to them, so the apt part takes about twice its size in the object
  store. Online clusters still snapshot upstream at plan time and fetch only what their nodes request.

### DRBD without internet (air-gapped)

DRBD 9 adapts its source to a kernel with a compat patch, looked up in its cache by the MD5 of the `compat.h` its
build probes from the kernel headers; for kernels it doesn't know, DRBD's build fetches the patch from LINBIT's
spatch-as-a-service (SPAAS) over the internet — which nodes may not reach (they fetch only from the cluster). So the
**bundle carries the patch**: at bundle build time the release job generates it for every kernel the supported OS
releases' kernel metapackages resolve to (Debian `linux-image-<arch>` / `linux-image-cloud-<arch>`, Ubuntu
`linux-image-generic` / `-virtual` and their HWE variants), one `cocci_cache/<md5>/` entry per kernel and distinct
`compat.h`, validated by `build-bundle` and listed in the manifest (`components.drbd.compat`: kernel, architecture,
file, MD5) — checksummed and covered by the signature like every artifact.

On the node the host update script:

1. before the `dist-upgrade`, simulates it and refuses every kernel it would install that the release has neither a
   prebuilt module nor a compat patch for (the step fails with "the release ships neither a prebuilt module nor a
   compat patch for kernel <k> … nothing was changed");
2. builds from the bundle's source with the compat entries for the target kernel extracted into DRBD's cache and
   `SPAAS=false` — no network at build time. Headers whose `compat.h` differs from the release's (another MD5) fail the
   build with a message naming the expected MD5s, before the reboot.

On an **air-gapped** cluster, kernels newer than the release are therefore refused rather than built through the
internet; third-party security fixes, kernels included, ship as patch releases of the bundle (whose snapshot carries
the kernel and its compat patch). The installer builds no DRBD module (it only loads one that is present), so bootstrap
and join from a bundle don't depend on SPAAS either.

**Online clusters** keep fresh plan-time snapshots, so security updates in maintenance windows include kernels newer
than the release. There, a kernel without a bundled compat patch / prebuilt module builds with SPAAS: the control plane
marks the host step `spaas` (agent protocol feature `drbd-spaas`; the plan's options show `drbdSpaas`) only when the
cluster isn't air-gapped — its bundles don't come by upload only (`Cluster.spec.updates.source` ≠ `upload`) **and**
the plan's apt snapshot was taken from the upstream archives (not the bundle's because upstream was unreachable). The
script then checks before any change that SPAAS answers (`https://spaas.drbd.io/api/v1/hello`; unreachable → "… and
LINBIT's SPAAS is unreachable …; nothing was changed") and builds that kernel with `SPAAS=true` (kernels the release
covers still use the bundled patch; a `compat.h` that differs from it gets its patch from SPAAS instead of failing).
Either way the update fails before the reboot unless `modinfo -k <next kernel>` reports the release's DRBD version.

## Agent self-update

When its target release ships another agent, the agent downloads the binary from the control plane by checksum,
verifies it against the manifest it verified itself, and starts two transient units: a rollback timer
(`systemd-run --on-active=300`) and the swap (`install` → keep the running binary as `.prev` → `mv` → `systemctl
restart loadweaver-agent`). The new agent confirms (stops the timer) once it reached the control plane and applied its
desired state; otherwise the timer puts the previous binary back, which reports `rolled-back` and doesn't retry that
version while the node stays on that release (the block is the action's error). Once the node is moved to another
release (the step's rollback, another update), the block is cleared and a later step retries the agent once more. The agent's version is baked in at build time (`VERSION`).

## Database migrations: expand / contract

Startup runs only **expand** migrations (`src/migrations/`; additive, old and new code both work). **Contract**
migrations (`src/migrations/contract/`, dropping what N-1 still used) run only after an update completed and every
component reports the new version (every node the release and its agent version, every member the release's
control-plane image); they have their own history table (`lw_contract_migrations`). `GET /api/updates/status` shows
what they wait for.

## Agent protocol

Release components travel in the desired state's `components` field, gated by the protocol feature `components`:
agents that don't advertise it never receive it (they are left out of plans with a warning). Agents report what they
run in the hello and every heartbeat. While members update one by one, an updated member's agent may talk to a control
plane one release behind; the control plane ignores agent fields it doesn't know yet. See
[Architecture](../architecture/README.md#agent-protocol-versioning).

## Versions of clients

Every API response carries the control plane's release in `X-Loadweaver-Version`. The CLI warns when it is more than
one release line behind (N-1) and shows both versions in `loadweaver version`.

## API

`GET /api/updates/status`, `GET /api/updates/releases`, `POST /api/updates/releases/<version>/download`,
`POST /api/updates/bundles`, `GET|POST /api/updates/rollouts`, `GET /api/updates/rollouts/<id>`,
`POST /api/updates/rollouts/<id>/{approve,pause,resume,rollback,cancel}` (see the OpenAPI spec), the public
`/api/updates/artifacts/<sha256>` and `/api/updates/apt/…`, and the shared `/api/updates/announcements`. Webhook events:
`update.available`, `update.planned`, `update.paused`, `update.completed`, `update.rolled-back`,
`update.rollback-failed`. Audit actions: `update.bundle-imported`, `update.bundle-refused`, `update.planned`,
`update.approve`, `update.pause`, `update.resume`, `update.rollback`, `update.cancel`, `update.paused`,
`update.completed`, `update.rolled-back`, `update.rollback-failed`.

| Variable                                          | Default        | Meaning                                                                               |
| ------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------- |
| `LOADWEAVER_BUNDLE_MAX_BYTES`                     | 16 GiB         | Largest accepted bundle                                                               |
| `LOADWEAVER_RELEASES_REPOSITORY`                  | `forepath/one` | GitHub repository of the release bundles                                              |
| `LOADWEAVER_UPDATE_CHECK`                         | on             | `off`: no release checks (air-gapped)                                                 |
| `LOADWEAVER_UPDATE_CHECK_CRON`                    | `17 */6 * * *` | When releases are checked                                                             |
| `LOADWEAVER_APT_SOURCES`                          | per OS         | Upstream apt sources of snapshots (JSON)                                              |
| `LOADWEAVER_ALLOW_UNSIGNED_BUNDLES`               | unset          | `true`: accept unsigned bundles (development; control plane and agents)               |
| `LOADWEAVER_ALLOW_UNSIGNED_BUNDLES_IN_PRODUCTION` | unset          | `i-understand`: honour `LOADWEAVER_ALLOW_UNSIGNED_BUNDLES` with `NODE_ENV=production` |
| `LOADWEAVER_ENVOY_DRAIN_SECONDS`                  | 30             | Drain time of a replaced Envoy                                                        |
