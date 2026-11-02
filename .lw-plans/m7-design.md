# Loadweaver M7 — Virtual machines: technical design

Scope: steps M7.1–M7.6 from `.lw-plans/implementation.md` "Extension after origin/main (2026-10-23)". The decisions themselves are in `loadweaver.md` 3.1, 3.35, section 6 and the decision log of 2026-10-23. This document only fills in the engineering. Paths refer to the post-merge tree: Loadweaver code as on `3fde1b8e`, Agenstra code as on `origin/main`.

## 0. Cross-cutting conventions

### 0.1 Protocol strategy (applies to every step)

- **Version.** `PROTOCOL_VERSION` stays **2**. Only `src/compat/v1/` is frozen, so v2 is still the unreleased development version. Every new feature is registered `since: 2`, and **no version bump is needed** as long as v2 isn't frozen before M7 ships. If a release freezes v2 first, bump to 3 and set `since: 3` for the M7 features.
- **No CP→agent enum is widened** (`versioning.ts` rule). New levels and kinds travel in **new optional fields** that are gated in `CONTROL_PLANE_FIELD_GATES`, and new message types are gated in `CONTROL_PLANE_MESSAGE_GATES`.
- **New "refuse" gate mode** (needed by M7). Today `forNode` strips a gated field for a node without the feature. For `isolation`, `vm`, `devices` and volume `mode: 'block'`, stripping would silently downgrade a workload, or turn a VM disk into a formatted filesystem. The change in `util-agent-protocol/src/lib/versioning.ts`:
  ```ts
  export interface FieldGate<F> { path: string; feature: F; onMissing?: 'strip' | 'refuse' } // default strip
  export class GatedFieldRefused extends Error { constructor(readonly type: string, readonly path: string, readonly feature: string) }
  ```
  `forNode` / `envelopeForNode` throw `GatedFieldRefused` when a refuse-gated path is **present**. The session's `send` catches it, logs and raises the alert `node-protocol-refused`, and does not send that envelope. The scheduler already keeps such workloads away from these nodes (`requiredFeatures`), so this is a safety net that must never fire. A unit test covers it, and the compat spec gets a case.
- **Agent→CP direction:** new optional fields only. Widening `nodeCapabilitiesSchema.runtimes` is allowed (the CP is updated first).

New `PROTOCOL_FEATURES` entries (all `agent: true` once implemented):

| feature            | unlocks                                                                                                           | gate mode                                |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `isolation-ladder` | `workloads[].isolation` (`sandboxed-kvm`, `microvm`); `desiredState.host.kvm`; restore on the gVisor KVM platform | refuse (`isolation`), strip (`host.kvm`) |
| `workload-devices` | `workloads[].devices` (allow-listed host devices)                                                                 | refuse                                   |
| `microvm`          | `workloads[].microvm` (mode, guest sizing, tap networking)                                                        | refuse                                   |
| `virtual-machines` | `workloads[].vm`; messages `vmPower`, `vmImageImport`                                                             | refuse                                   |
| `vm-block-volumes` | `volumes[].mode` (`block`) and `volumes[].initializeFrom`                                                         | refuse                                   |
| `vm-consoles`      | message `consoleOpen` (serial / vnc)                                                                              | message gate                             |
| `vm-migration`     | messages `vmMigrationPrepare`, `vmMigrationStart`, `vmMigrationSwitchover`                                        | message gate                             |

### 0.2 Spec hash stability

`buildWorkloadSpec` hashes the canonical spec (`workload-planning.utils.ts`). Every new field is **emitted only when it differs from the old behaviour**: `isolation` only for `sandboxed-kvm` / `microvm`, `devices` only when non-empty, `microvm` / `vm` only for those kinds. Existing replicas therefore keep their hash and are not recreated by the upgrade. A unit test asserts that the hash of a plain runc and a sandboxed service is unchanged.

## M7.1 Isolation ladder

### Types and enums

**Level type (`util-model/src/lib/resources/infrastructure.ts`):**

```ts
export const RUNTIMES = ['runc', 'sandboxed', 'sandboxed-kvm', 'microvm'] as const; // ladder order = rank
export const RUNTIME_RANK: Record<Runtime, number> = { runc: 1, sandboxed: 2, 'sandboxed-kvm': 3, microvm: 4 };
export function atLeast(level: Runtime, min: Runtime): boolean;
export const ISOLATION_STATES = ['ready', 'unsupported', 'installation-failed', 'probe-failed', 'disabled-by-admin'] as const; // Agenstra's names
```

**Node spec opt-out** (`nodeSpecSchema`):

```ts
virtualization: z.object({ kvm: z.enum(['auto', 'disabled']).default('auto') })
  .strict()
  .optional();
```

`disabled` means: no KVM preparation, no KVM levels, no microVMs and no full VMs on the node.

**Compose model:**

- `util-compose/src/lib/extensions.ts`: `runtime: z.enum(RUNTIMES).optional()` (imports `RUNTIMES`).
- `util-compose/src/lib/model.ts`: `runtime: Runtime`.
- `parse-compose.ts`: the compose `runtime:` key maps `runsc`/`runsc-systrap` → `sandboxed` and `runsc-kvm` → `sandboxed-kvm`. Any other value is an error: "unknown runtime, use x-loadweaver.runtime".

**Scheduler (`util-scheduler/src/lib/types.ts`):**

- `SchedulerNode.runtimes: Runtime[]` and `SchedulerService.runtime: Runtime`.
- New fields on `SchedulerNode`: `kvmDevice?: boolean`, `virtualMachines?: boolean`, `blockVolumes?: boolean`.
- New field on `SchedulerService`: `needsKvmDevice?: boolean`.

**Agent protocol (`util-agent-protocol/src/lib/messages.ts`):**

- `nodeCapabilitiesSchema.runtimes: z.array(z.enum(RUNTIMES_WIRE))`, with `RUNTIMES_WIRE` re-declared locally to keep the protocol lib free of model imports, as today.
- New optional `isolation: z.record(z.enum(RUNTIMES_WIRE), z.object({ state: z.enum(ISOLATION_STATES), reasonCode: z.string().max(64).optional(), reason: z.string().max(512).optional(), checkedAt: z.string().datetime() }).strict()).optional()`.
- New optional `kvm: z.object({ cpu, device, module, nested, hypervisor, usable: z.boolean(), optOut: z.boolean() }).strict().optional()`. The first five are `GvisorHostKvmFacts`.
- `checkpoint.runscKvm: z.boolean().optional()`.
- `microvm: z.object({ launcherDigest: z.string().max(100), unpackCache: z.boolean(), thinPool: z.boolean() }).strict().optional()`.
- `virtualMachines: z.boolean().optional()`.

**`workloadSpecSchema`:**

- `runtime` stays `z.enum(['runc','sandboxed'])`. It is the Docker family: `sandboxed-kvm` → `sandboxed`, `microvm` → `runc` (the launcher runs on runc).
- New `isolation: z.enum(['sandboxed-kvm','microvm']).optional()`, refuse-gated by `isolation-ladder`.
- New `devices: z.array(z.object({ path: z.literal('/dev/kvm'), permissions: z.enum(['rw','rwm']).default('rwm') }).strict()).max(4).optional()`, refuse-gated by `workload-devices`.

**Everything else that hard-codes the two levels** (found by grep), updated with the corresponding changes:

- `workload-planning.utils.ts:184`: the filter becomes `isRuntime`.
- `workload-planner.service.ts:188`.
- `migration-eligibility.utils.ts:165` (see the checkpoint rule below).
- `workload-container.ts:108` (`Runtime` per level).
- `host-info.service.ts`.
- `LoadweaverRuntime` (M7.5).

**Node agent runtime selection (`workload-container.ts`):**

```ts
export const SANDBOX_RUNTIME = 'runsc-systrap';
export const SANDBOX_KVM_RUNTIME = 'runsc-kvm'; // GVISOR_RUNTIMES.kvm.runtime
Runtime: spec.isolation === 'sandboxed-kvm' ? SANDBOX_KVM_RUNTIME : spec.runtime === 'sandboxed' ? SANDBOX_RUNTIME : 'runc';
```

Import the names from `@forepath/shared/backend/util-container-runtime` (`GVISOR_RUNTIMES`) instead of string literals. Loadweaver uses the Netstack variants. The `-hostnet` variants are Agenstra's egress guard concern and are never used here.

### Node probe design (`feature-node-agent/src/lib/host/isolation-probe.service.ts`, new)

**Inputs:**

- `docker info` → `Runtimes`; each runtime goes through `parseGvisorRuntimeArgs(runtimeArgs)`.
- The KVM facts from the existing host script: `buildGvisorHostScript` is already used by `os-update.manager.ts`. Run `bash /var/lib/loadweaver/updates/files/gvisor-host.sh check --json` and parse it with `parseGvisorHostReport`.

**Per level:**

| level         | static check                                                                                                                                                         | smoke test (container labelled `loadweaver.com/probe=1`, `--network none`, 64 MiB, 30 s)                                                                                                                                                                                                                                                     | reason codes (Agenstra's `IsolationReasonCode` strings)                           |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| runc          | docker reachable                                                                                                                                                     | `node-shell` image `true`                                                                                                                                                                                                                                                                                                                    | `E_DOCKER_BASELINE_UNAVAILABLE`, `E_RUNC_PROBE_FAILED`                            |
| sandboxed     | `runsc-systrap` registered; args `platform ∈ {systrap, null}`, `network === null`                                                                                    | `--runtime runsc-systrap node-shell dmesg` must contain `gVisor`                                                                                                                                                                                                                                                                             | `E_RUNTIME_NOT_REGISTERED`, `E_RUNTIME_MISCONFIGURED`, `E_PROBE_RUNTIME_MISMATCH` |
| sandboxed-kvm | KVM `usable` (`device=present`, `module=loaded`, `cpu=yes`, `/dev/kvm` openable), not opted out; `runsc-kvm` registered with `platform==='kvm'` and `network===null` | same with `--runtime runsc-kvm`                                                                                                                                                                                                                                                                                                              | `E_KVM_UNAVAILABLE`, `E_DISABLED_BY_ADMIN` (opt-out), `E_RUNTIME_MISCONFIGURED`   |
| microvm       | KVM usable, `/dev/net/tun` present, launcher image pullable (pinned digest), unpack cache writable                                                                   | probe microVM (M7.2): generic launcher booting `node-shell` from the unpack cache with tap networking; checks exec exit codes (0 / 3), stdout/stderr in `docker logs`, file coherence (guest writes `/probe/x`, host reads the overlay merged dir), the guest IP answering ICMP from the host, a clean stop with exit code 0. Timeout 240 s. | `E_MICROVM_BOOT_FAILED`, `E_MICROVM_IMAGE_UNSUPPORTED`, `E_PROBE_TIMEOUT`         |

**Full-VM capability:** `virtualMachines = microvm ready && drbd9 && OVMF present in the launcher` (`/usr/share/OVMF/OVMF_CODE_4M.fd` on amd64, `AAVMF_CODE.fd` on arm64; checked by `docker run launcher test -r`).

**Scheduling of probes:**

- At start and every 6 h (`LOADWEAVER_ISOLATION_PROBE_INTERVAL_MS`).
- After a host update step or a gVisor update (`updates.service.ts` hook).
- After 3 consecutive workload start failures on a level (same as Agenstra's `AGENT_ISOLATION_FAILURE_THRESHOLD`).
- On demand: new CP API `POST /api/nodes/:name/isolation-probe` → desired-state nonce `host.probeNonce`, strip-gated.

Results are cached in `agent-state.store.ts`. `HostInfoService.capabilities()` reports `runtimes = levels with state ready`, the full `isolation` map and `kvm`. `sandboxProbe` stays for N-1 control planes and is derived from `sandboxed`. The reconciler ignores probe containers (`managed-containers.ts` filter on `loadweaver.com/probe`); leftovers are removed at start.

### Capability reporting, selectors and the "at least" order

- **Scheduler:** `eligibleNodes` uses `n.runtimes.includes(service.runtime)`, i.e. the **exact level must be ready** on the node. A workload is never placed with another level: no downgrade, and no implicit upgrade either, because `microvm` and `sandboxed-kvm` change semantics. Levels above `sandboxed` add `requiredFeatures: ['isolation-ladder']`; `microvm` adds `'microvm'` as well.
- **"At least" ordering is used for:**
  1. Derived node system labels, written by `nodes.service.ts` from capabilities into the node's effective labels: `runtime.loadweaver.com/<level>: ready` per ready level, and `loadweaver.com/runtime: <highest ready level>`. Selectors such as `runtime = sandboxed-kvm` therefore work with the existing `In` operator. The query builder offers `runtime ≥ X`, which expands to an `In` over all levels with `RUNTIME_RANK ≥ X`.
  2. Capability aggregation for Agenstra (M7.5).
  3. Plan output: "service X needs ≥ sandboxed-kvm; nodes offering it: a, b".
- **Unschedulable reason:** `no eligible node (runtime microvm: 0 of 5 nodes ready — node-1 E_KVM_UNAVAILABLE, node-2 disabled by node spec)`, built from `isolation`.

**Open point for the coordinator:** this reading of "at least" placement (exact level, ordering only for selectors, aggregation and display) is my interpretation. If "at least" was meant to let a `sandboxed` service land on `sandboxed-kvm`, only `eligibleNodes` and the compiler's level choice change.

### `devices` pass-through

- **Compose** (`parse-compose.ts:598`): `devices` entries are parsed as today. New validation:
  - The only allowed path is `/dev/kvm`, either `"/dev/kvm"` or `"/dev/kvm:/dev/kvm[:rwm]"`.
  - Any other device is an error: "device X is not allowed (allow-list: /dev/kvm)".
  - `/dev/kvm` with runtime ≠ `runc` is an error, because gVisor and microVMs can't pass devices.
- **Who may request it:**
  - New `projectSpec.workloads.allowedDevices: z.array(z.literal('/dev/kvm')).max(1).optional()` in `util-model/.../workloads.ts`. Changing it is an admin-only field (same handling as other admin-only project fields).
  - A plan that uses `/dev/kvm` in a project without the allowance fails with a policy error.
  - The plan always warns "device access (/dev/kvm): the workload can run its own VMs; it is pinned for migration". The existing `pins.push({kind:'deployment', reason: 'device access (/dev/kvm)'})` stays, and eligibility falls back to short-stop or blue-green (existing `service.devices.length > 0`).
- **Scheduling:** `needsKvmDevice` → node must have `kvm.usable && !optOut`, plus `requiredFeatures: ['workload-devices']`.
- **Compiler** (`buildWorkloadSpec`): `devices: [{ path: '/dev/kvm', permissions: 'rwm' }]` only when present.
- **Agent:** `HostConfig.Devices = [{ PathOnHost:'/dev/kvm', PathInContainer:'/dev/kvm', CgroupPermissions }]`. Group access is not added automatically; the image must handle the `kvm` gid, which the docs explain. CapAdd is unchanged.
- **Platform-internal devices** (`/dev/net/tun`, `/dev/vhost-net`, `/dev/drbd<minor>`) are never in `spec.devices`. The agent adds them for launcher workloads only (M7.2 / M7.3).

### KVM host preparation through pins

- **Shared installer** (`libs/domains/shared/backend/util-container-runtime/src/lib/gvisor-install.script.ts`, shared lib, so Agenstra and Decabill are verified too): new option `kvmApt?: boolean` (default `true`) → env `AGENSTRA_KVM_APT`. When it is `0`, the `agenstra_apt_install "linux-modules-extra-$(uname -r)"` branch is skipped. Agenstra's behaviour is unchanged.
- **Loadweaver install script** (`install-script.utils.ts:100`): `buildGvisorInstallScript({..., kvm: true, kvmApt: false })`. Before it, it installs `linux-modules-extra-$(uname -r)` **from the cluster-local apt source** on Ubuntu, only when `modinfo kvm_intel || modinfo kvm_amd` fails, the CPU has `vmx`/`svm`, and the node isn't opted out. The opt-out is passed to the installer as `GVISOR_KVM=0 AGENSTRA_KVM=0`.
- **Release pins** (`util-release/src/lib/apt-bundle.ts` `bundleAptRoots`): on Ubuntu, add `linux-image-extra-virtual` and `linux-image-extra-virtual-hwe-${version}`. These metapackages pull `linux-modules-extra-<abi>` for exactly the kernels the bundle carries. Debian ships KVM in `linux-image-*`, so nothing is added there. `PACKAGE_PINS` gets no new entry: the modules follow the kernel ABI, and `selectedKernels()` already couples them to the kernel snapshot. Add a test that every selected Ubuntu `linux-image-<k>` has a `linux-modules-extra-<k>` in the selection.
- **Kernel rollout coupling** (`feature-node-agent/src/lib/updates/host-commands.ts`): the host update step installs `linux-modules-extra-<next kernel>=<pinned>` together with the kernel when the node uses KVM (`kvm.usable` before the update, and not opted out). It goes through the existing drain → update → reboot → rejoin flow (`rollout-planner.utils.ts` entry `kvm-modules`, same step as the kernel). After the reboot, the probe re-runs before the node is uncordoned. If KVM is lost, the KVM levels drop out of `runtimes`, and the rollout step reports `kvm lost after update` as a warning, which pauses the wave like other post-update health failures.
- **Opt-out at runtime:**
  - `desiredState.host.kvm: 'disabled'` (strip-gated `isolation-ladder`) → the agent runs `gvisor-host.sh install` with `GVISOR_KVM=0`. Spike S9 checks whether that removes `runsc-kvm*`; otherwise use `uninstall-kvm`.
  - The agent never reports KVM levels for an opted-out node.
  - The plan refuses to opt out a node that still runs KVM-level, microVM or VM workloads ("drain first").

### gVisor-KVM checkpoint same-platform rule

- **`checkpointSupport(node, runtime, platform)`** in `migration-eligibility.utils.ts`:
  - For `sandboxed-kvm`, both nodes need `checkpoint.runscKvm === true` and `sandboxed-kvm` ready.
  - For `sandboxed`, `checkpoint.runsc`.
  - Fallback reason: `no gVisor KVM checkpoint support on X (restore must use the same platform)`.
- **Freeze estimate:** `overheadMs` gets a key `runsc-kvm`, with the initial value 2 500 to be measured in the lab. `CheckpointRuntime` on the wire stays `runc | runsc`. The platform is derived on both nodes from the workload spec (`isolation`), so no migration message changes.
- **Agent:**
  - `restored-runtime.ts` `sandboxRuntimeOf(runtimes, platform: 'systrap' | 'kvm')` selects the registered runtime whose `parseGvisorRuntimeArgs(...).platform` matches and whose network is Netstack.
  - `checkpoint.manager.ts` reads the platform from the source container's runtime name and args, and the restore uses the same platform's binary and args.
  - `host-info.service.ts checkpoint()` reports `runscKvm` (the KVM runtime is registered, its binary runs, cgroup v2).

## M7.2 Shared launcher + microVMs

### Code moves (no Agenstra behaviour change)

| from (origin/main)                                                                                    | to                                                                                                                                                                      | Nx project                                                                                                                                  | notes                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `libs/domains/agenstra/backend/util-microvm-bridge/**`                                                | `libs/domains/shared/backend/util-microvm-bridge/**`                                                                                                                    | `shared-backend-util-microvm-bridge`, tags `domain:shared, scope:backend, type:util`, import `@forepath/shared/backend/util-microvm-bridge` | Pure move with `git mv`. Constants keep their **values** (`/usr/lib/agenstra-microvm`, `agenstra-vmm`/10930, label `io.agenstra.microvm.protocol`, channel `io.agenstra.bridge`, protocol 1), so existing worker images and managers keep working. Neutral aliases are added (`MICROVM_TOOLS_DIR = MICROVM_INSTALL_DIR`). Build outputs go to `dist/libs/domains/shared/backend/util-microvm-bridge/{bridge-host,bridge-guest}.cjs`.                   |
| `apps/agenstra/backend-agent-manager/worker-microvm/{launch,initramfs-init,guest-init,pty-helper.py}` | `apps/shared/microvm-launcher/rootfs/usr/lib/agenstra-microvm/…` plus new `launch-generic`, `launch-vm`, `initramfs-init-generic`, `vm-ctl`, `vm-console`, `seed-build` | `shared-microvm-launcher` (application, image-only; targets `container-image`, `container-image-test`)                                      | The Agenstra `launch` stays byte-identical for the bundled mode.                                                                                                                                                                                                                                                                                                                                                                                       |
| `Dockerfile.worker-microvm`, launcher stage                                                           | `apps/shared/microvm-launcher/Dockerfile`                                                                                                                               | same                                                                                                                                        | Produces `ghcr.io/forepath/microvm-launcher:<version>`, multi-arch amd64 + arm64 with `docker buildx`. Contents: QEMU (`qemu-system-x86` / `qemu-system-arm`), `libvirt-daemon(-driver-qemu)`, `libvirt-clients`, `virtiofsd`, `nodejs`, `tini`, `qemu-utils`, `ovmf` / `qemu-efi-aarch64`, `dosfstools`, `mtools`, `busybox-static`, `linux-image-cloud-<arch>`, the initramfs, `/usr/lib/agenstra-microvm/guest-tools/` (S2) and the bridge bundles. |
| `Dockerfile.worker-microvm`                                                                           | stays in Agenstra                                                                                                                                                       | —                                                                                                                                           | Becomes `FROM ghcr.io/forepath/microvm-launcher@sha256:…` (`ARG LAUNCHER_IMAGE`) + `COPY --from=guest / /guest/` + the same ENV and LABELs. The Nx target `worker-microvm-container-image` gets `dependsOn: ["shared-microvm-launcher:container-image"]`, and `copy-microvm-bridge` moves to the launcher project.                                                                                                                                     |

- **Imports** in `feature-agent-manager` (`docker.service.ts`, `toMicrovmExecOptions`, isolation probe) switch to `@forepath/shared/backend/util-microvm-bridge`.
- **Proof of no behaviour change:** the Agenstra isolation lab `microvm.isolation-lab.spec.ts` runs unchanged, and the bridge unit tests move along with the code. The manager's `assertMicrovmImage` (label check) is unchanged.
- **Release pin:** `COMPONENT_IMAGES['microvm-launcher']` in `util-release/src/lib/pins.ts`. It is a moving dev tag in the source tree, replaced with the release digest by the bundle builder (like `control-plane`), with override env `LOADWEAVER_MICROVM_LAUNCHER_IMAGE`. The launcher is scanned by Trivy in the release pipeline like other component images.

### Microvm workload modes (decided at plan time)

- **`compileMicrovm` (new `feature-control-plane/src/lib/utils/microvm-planning.utils.ts`):** `image-resolver.service.ts` already resolves digests. It also fetches the image config (labels, Entrypoint, Cmd, Env, User, WorkingDir, ExposedPorts, Healthcheck, StopSignal) and the platform list.
  - **`mode: 'bundled'`:** the image has `io.agenstra.microvm.protocol` (its value must be a supported bridge version). The image itself is the launcher; Agenstra's built-in user-mode networking and port forwarders are kept, and there is no unpack cache and no tap. The container gets the IP as today.
  - **`mode: 'generic'`:** otherwise. The container image is the pinned launcher, and the service image becomes the guest root.
- **Wire field** (`workloads[].microvm`, refuse-gated `microvm`):
  ```ts
  microvm: z.object({
    mode: z.enum(['bundled','generic']),
    guestImage: z.string().max(512).optional(),          // generic: digest-pinned service image (= what is scanned / policy-checked)
    layers: z.array(z.object({ digest: sha256Ref, diffId: sha256Ref, size: z.number().int().nonnegative(), mediaType: z.string().max(128) }).strict()).max(128).optional(),
    process: z.object({ entrypoint: z.array(z.string().max(8192)).max(256), cmd: z.array(...).max(256), env: z.array(z.string().max(32768)).max(1024), user: z.string().max(64), workingDir: absolutePath, stopSignal: z.string().max(16) }).strict().optional(), // image config merged with compose overrides
    vcpus: z.number().int().min(1).max(64), memoryMiB: z.number().int().min(128).max(1048576),
    rootfsBytes: z.number().int().positive(),            // per-replica writable layer quota
  }).strict().optional()
  ```
  `spec.image` = the launcher image (generic) or the service image (bundled). Image policy and scanning use `guestImage ?? image` (see Scanning below).
- **Compose:** `x-loadweaver.microvm: { rootfsSize?: '10Gi' }` in `extensions.ts`.
  - Guest memory is `deploy.resources.limits.memory`, or the request when there is no limit, default 512 MiB.
  - vCPUs = `ceil(limits.cpus ?? requests.cpus ?? 1)`.
- **Errors at plan time:**
  - `network_mode: host` or `pid: host`, `privileged`, any `devices`, `cap_add` (it has no meaning in a guest; a warning says caps apply inside the guest unrestricted), a `bind` of a host path outside volumes (allowed, as virtio-fs below `/guest`; it is pinned).
  - An image without an `ExposedPorts` mapping doesn't matter, because the guest owns the IP.

### Launcher container (node agent, `workload-container.ts` `microvmContainerOptions`)

**HostConfig:**

```ts
Runtime: 'runc', Init: false, Privileged: false, ReadonlyRootfs: true (generic; tmpfs /dev/shm 64m, /tmp 16m),
CapDrop: ['ALL'], CapAdd: MICROVM_LAUNCHER_CAPABILITIES /* moved to shared bridge lib constants */, SecurityOpt: ['no-new-privileges'],
Devices: [kvm, {PathOnHost:'/dev/net/tun',...,'rwm'}, (S1: '/dev/vhost-net')], PidsLimit: 1024,
Memory: (memoryMiB + LAUNCHER_OVERHEAD_MiB) MiB, NanoCpus: vcpus * 1e9 (+0.25 core for virtiofsd/bridge),
Mounts: [ {bind <vmroot>/replicas/<key>/merged -> /guest, rprivate}, {bind guest-tools ro is inside the image}, {bind <run>/vm/<key> -> /run/loadweaver/vm, ro except stats/}, volumes -> /guest<target>, secrets -> /guest<target> ]
```

- **Env** (`AGENSTRA_MICROVM_*`, stripped from the guest by the bridge): `ENTRYPOINT` (unused in generic; the process comes from `boot-process.json`), `MEMORY_MB`, `VCPUS`, `STOP_GRACE = stopGracePeriodMs/1000`, `FORWARD_PORTS=''` (generic: the guest owns the IP), `LW_MODE=generic`.
- **Entrypoint:** `/usr/bin/tini -- /usr/lib/agenstra-microvm/launch-generic`.
- **`LAUNCHER_OVERHEAD_MiB = 384`** (Agenstra's `LAUNCHER_OVERHEAD_MB`). The planner adds it to the scheduler requests (`toSchedulerService`), so capacity accounting is honest. memfd shared guest memory is charged to the container cgroup (spike S10).

### Image unpack cache (`feature-node-agent/src/lib/microvm/rootfs-cache.ts`, new)

- **Layout:** `/var/lib/loadweaver/vmroot/` (root 0700).
  - `layers/sha256/<diffId>/` holds the unpacked layer; its `.lw-complete` marker contains the JSON `{digest, diffId, bytes, unpackedAt}`.
  - `replicas/<sha256(workloadId)[0:24]>/` holds `upper/`, `work/` and `merged/`.
  - `staging/` holds in-progress unpacks.
- **Fetch:** the blobs are fetched directly from the cluster registry path the node already uses (`registry/registry-router.ts` / `image-routing.ts`, with the node's registry token). Docker's store is never used, because it hides containerd snapshot formats. The compressed digest is verified while streaming, the diffID (uncompressed sha256) after decompression; both must match `spec.microvm.layers`. Supported media types: OCI/Docker `tar`, `tar+gzip`, `tar+zstd`. Foreign or non-distributable layers are refused.
- **Content addressing** is by **diffID**, so equal content from different compressions is shared. Concurrency: one unpack per diffID (in-process lock plus an `O_EXCL` lock file).
- **Unpack security:** a child process `lw-unpack` runs the node agent binary in unpack mode inside `unshare --mount --pid --fork`, with a private `/` bind and only `staging/<id>` writable. Every step is in `rootfs-unpack.ts`, with unit tests using crafted tars:
  - Entries with absolute paths, `..` components, or paths through a symlink are rejected. Extraction resolves every parent with `openat2(RESOLVE_IN_ROOT | RESOLVE_NO_MAGICLINKS)`, through a tiny helper `lw-openat2` in the agent's SEA, or fallback: a manual parent walk with `O_NOFOLLOW` (`lstat` + `O_PATH | O_NOFOLLOW`).
  - Hardlinks may only point to entries already extracted from the same layer.
  - Char, block and FIFO entries are **dropped** with a count logged; the guest gets devtmpfs.
  - Whiteouts: `.wh.<name>` → `mknod c 0 0 <name>` (overlay whiteout); `.wh..wh..opq` → `setxattr trusted.overlay.opaque=y`.
  - Ownership and modes are preserved, including setuid/setgid, because they are the guest's semantics. Safety on the host comes from mount flags: the overlay is mounted `nosuid,nodev,noexec`, nothing on the host executes from it, and the parent dir is 0700 root.
  - xattrs: only `security.capability` and `user.*` are kept; `trusted.*` and `security.selinux` are dropped.
  - Size limit: the declared layer size × 8 and `LOADWEAVER_VMROOT_LAYER_MAX_BYTES` (default 16 GiB) bound decompression bombs.
  - Completion: `syncfs`, then `rename(staging/<id>, layers/sha256/<diffId>)`.
- **Per-replica overlay:**
  - The writable layer is a **thin LV** `lw-vmrw-<key>` in the node's volume thin pool, sized `rootfsBytes` and formatted ext4. That is a hard quota with discard on delete, and it supports `trusted.*` xattrs for the overlay.
  - Without a thin pool, the fallback is a sparse ext4 image at `replicas/<key>/rw.img`, loop-mounted, with a plan warning "no thin pool: writable layer on a loop file".
  - Mount: `mount -t overlay -o lowerdir=L_n:…:L_1,upperdir=…/upper,workdir=…/work,nosuid,nodev,noexec,index=off,redirect_dir=off,metacopy=off overlay merged`.
  - The writable layer is removed when the replica is deleted, not on restart (container semantics: a restart keeps the writable layer, a recreate discards it).
- **Disk accounting:**
  - The cache cap is `LOADWEAVER_VMROOT_CACHE_MAX_BYTES` (default 15 % of the `/var/lib` filesystem).
  - GC is LRU over layers not referenced by any mounted replica or the current desired state, triggered after every desired state and hourly.
  - `capacity.diskBytes` stays the filesystem total; the planner's disk check includes `rootfsBytes` + unique layer bytes for microVM replicas.
  - Metrics: `lw_vmroot_cache_bytes`, `lw_vmroot_layers`.
- **How the guest sees it:** the host `merged/` is bind-mounted at `/guest` in the launcher. `launch-generic` runs `virtiofsd --shared-dir=/guest --sandbox=chroot --cache=auto --announce-submounts`, the same flags as Agenstra plus submounts, so volumes below `/guest` are visible. Spike S3 covers virtiofsd on an overlay lower.
- **The file browser** for generic microVMs uses `merged/` on the host (`live-sessions.service.ts fileRoot`: for `loadweaver.com/microvm=generic`, return the replica's merged dir). Volume targets keep using the volume path. Coherence with the guest is bounded by `cache=auto` (≤ 1 s); the docs say so. Bundled mode continues to use Docker's `MergedDir` + `/guest`.

### Guest init contract for arbitrary images (generic mode)

- **Boot chain:** kernel (`linux-image-cloud`) → `initramfs-init-generic` (busybox).
  1. Mount virtio-fs `guestroot` at `/newroot` (the image root).
  2. Mount virtio-fs `lwtools` (**read-only**, the launcher's `/usr/lib/agenstra-microvm/guest-tools`, a second virtiofsd with `--readonly`) at `/tools`.
  3. Load the virtio_net modules and configure the network from the kernel cmdline (below).
  4. Start `/tools/bin/tini -s -g -- /tools/bin/node /tools/bridge-guest.cjs --root /newroot`.
  - The agent runs **outside** the image root, with no `switch_root`, so the image needs no node, python or tini, and the agent isn't visible to or writable by the workload.
- **Guest tools (S2):** node is shipped with its own loader and libraries (`/tools/lib/ld-linux-*.so.*`, invoked as `ld.so --library-path /tools/lib /tools/bin/node.real`) and is independent of the image's libc. `pty-helper.py` is replaced by a static C helper `lw-pty` (openpty + `TIOCSWINSZ`; built with `musl-gcc -static` in the launcher Dockerfile) for generic mode only. Bundled mode keeps `pty-helper.py`.
- **Workload start (bridge guest, new code path behind `boot.rootDir`):**
  - Before the workload starts: mount `proc`, `sys`, `devtmpfs`, `devpts`, `/dev/shm` and `mqueue` inside `/newroot`, plus a `tmpfs` on `/run` only when the image's `/run` is empty.
  - Write `/newroot/etc/hosts`, `/etc/hostname` and `/etc/resolv.conf` from the boot config. These are mounted from launcher tmpfs into the guest via the boot message, not written to the upper layer.
  - Run the process with `unshare --mount --pid --fork` + `chroot /newroot`, `setgroups`/`setgid`/`setuid` after resolving `user` against `/newroot/etc/passwd` and `/newroot/etc/group` (`guest-users.ts` gets a `root` parameter), with `cwd = workingDir` and `env = process.env` (+ `HOME`, `PATH` default).
- **Signals:** the launcher's SIGTERM → daemon `STOP` → guest sends `process.stopSignal` (default SIGTERM) to the workload's pid-ns init. After `STOP_GRACE` it sends SIGKILL, then `poweroff`. Docker's `StopTimeout` = grace + 10 s.
- **Exit codes:** `WORKLOAD_EXIT{code|signal}` → the launcher exits with `code`, or `128 + signal`. Launcher failures exit 125 (Agenstra's `EXIT_LAUNCH_FAILED`). Restart policies therefore work unchanged.
- **Healthchecks:** the compiler rewrites `test` to `["CMD", "/usr/lib/agenstra-microvm/vm-exec", "--", ...cmd]`. `CMD-SHELL x` becomes `vm-exec -- /bin/sh -c x`, and `/bin/sh` must exist in the image; otherwise the plan errors. The boot budget is added to `startPeriodMs` (`+15 s`).
- **Logs:** the workload's stdout/stderr go over bridge stream 1 → launcher stdout/stderr → `docker logs` → the existing log collectors. The kernel console goes to stderr prefixed `[guest]` (Agenstra's behaviour).

### Tap networking via tc redirect (`feature-node-agent/src/lib/microvm/guest-network.ts`, new)

Done by the node agent between `container.start()` and the launcher's wait. The launcher polls `/sys/class/net/lwtap0` for ≤ 30 s and then dies with `E_MICROVM_NET`.

**Steps:**

1. `pid = inspect().State.Pid`; every command runs as `nsenter -t <pid> -n …` through `CommandRunner`.
2. Read `eth0`: MAC and MTU (`ip -j link show eth0`), and the addresses from the spec (not from the netns).
3. `ip tuntap add dev lwtap0 mode tap user 10930 group 10930` (+ `multi_queue` when vcpus > 1), then `ip link set lwtap0 mtu <eth0 mtu> up`.
4. Remove the launcher's own L3 presence: `ip addr flush dev eth0`, `sysctl -w net.ipv6.conf.eth0.disable_ipv6=1`, `net.ipv4.conf.all.arp_ignore=8`. The launcher needs no network: exec goes over virtio-serial.
5. `tc qdisc add dev eth0 ingress`, `tc qdisc add dev lwtap0 ingress`.
6. eth0 → tap (everything inbound): `tc filter add dev eth0 parent ffff: prio 1 matchall action mirred egress redirect dev lwtap0`.
7. tap → eth0 with **anti-spoofing** (only these pass; the guest's MAC = eth0's MAC, set in the domain XML):
   ```
   prio 10 protocol ip   flower src_mac $MAC src_ip $V4 action mirred egress redirect dev eth0
   prio 11 protocol arp  flower src_mac $MAC arp_sip $V4 arp_sha $MAC action mirred egress redirect dev eth0
   prio 12 protocol ipv6 flower src_mac $MAC src_ip $V6 action mirred egress redirect dev eth0
   prio 13 protocol ipv6 flower src_mac $MAC src_ip $LLV6 action mirred egress redirect dev eth0   # EUI-64 of $MAC, NDP/RS
   prio 14 protocol ipv6 flower src_mac $MAC src_ip :: ip_proto ipv6-icmp action mirred egress redirect dev eth0  # DAD
   prio 99 matchall action drop
   ```
   tc ingress runs before netfilter in the netns, so filtering has to happen in tc. On the host, the existing `builtin:anti-spoofing` subnet rules (`nftables.renderer.ts:196`) and the per-veth `lw_kept` table still apply. Unit tests cover the rendered command list (`renderGuestNetworkCommands(spec, link)`), and the lab covers the behaviour (spoof attempts from a guest with `ip addr add`).

- **Guest addressing (static; no DHCP):**
  - Uniform **link-local gateway**: a guest always gets `<v4>/32` with `default via 169.254.1.1 onlink` and `<v6>/128` with `default via fe80::1`. The kept-address network already uses these gateways (`KEPT_GATEWAY_V4/V6`).
  - For the pod bridge, `pod-network.manager.ts` adds `169.254.1.1/32` and `fe80::1/64` to `lwbr0` and sets `net.ipv4.conf.lwbr0.send_redirects=0`.
  - Traffic between guests and containers on the same node is routed through the host (hairpin through `lwbr0`; `proxy_arp` is not needed because the gateway is real).
  - Result: a migrated guest's routes don't change (M7.4).
- **Delivery:** kernel cmdline `lw.ip4=<a>/32 lw.gw4=169.254.1.1 lw.ip6=<a>/128 lw.gw6=fe80::1 lw.mtu=<m>`, built by `launch-generic` from `/run/loadweaver/vm/net.json`, which the agent writes into the per-replica run dir before start. `initramfs-init-generic` applies it with busybox `ip` (`nodad` for v6). DNS: `resolv.conf` from the container's, which comes from the spec `Dns` = node DNS servers, delivered via the boot config.
- **MTU:** that of eth0 (overlay MTU, e.g. 1420 with WireGuard), on tap and guest alike.
- **Domain XML** (generic): `<interface type='ethernet'><mac address='$MAC'/><target dev='lwtap0' managed='no'/><model type='virtio'/><driver queues='$vcpus'/></interface>` (libvirt ≥ 5.7, unprivileged session can open the existing tap; spike S1).
- **Bundled mode keeps `<interface type='user'>`.** No tap is created, and the container IP stays on eth0.
- **Teardown:** nothing is needed; the netns dies with the container. On restart (same netns? no: Docker creates a new netns per start) the agent repeats the steps on every start event. The workload manager calls `guestNetwork.attach(containerId)` after `start()`, and also on Docker `start` events for restarts by Docker's restart policy (event listener in `workload.manager.ts`).

### `vm-exec` integration

- **Live terminals and machine exec** (`live-sessions.service.ts execInReplica`): for containers labelled `loadweaver.com/microvm` (bundled or generic), Docker exec options go through `toMicrovmExecOptions` from the shared bridge lib, so `Cmd` becomes `[MICROVM_EXEC_CLIENT_PATH, ...]`. Env names are passed as args and values stay in `Env`. TTY resize goes through Docker exec resize, which the vm-exec client forwards (Agenstra #698). Exit codes come from `exec.inspect().ExitCode`, as the bridge propagates them.
- **File browser:** the host merged dir (generic) or `/guest` paths via Docker's `MergedDir` (bundled). No exec is needed.
- **Tunnels:** unchanged, because they target the guest-owned IP.

### Metrics

- **Launcher cgroup** (existing Docker stats in `metrics-collector.service.ts`): `container_cpu`, `container_memory` = QEMU + virtiofsd + bridge, including guest RAM (memfd).
- **Guest accounting:** the bridge guest sends a new optional control message `STATS {memTotal, memAvailable, cpuSteal, load1}` every 10 s (an additive bridge message, protocol stays 1, and an unknown type is ignored by the host). The host daemon writes it to `/run/loadweaver/vm/stats.json` (rw subdir). The collector reads it and exports `lw_guest_memory_used_bytes`, `lw_guest_memory_total_bytes` and `lw_guest_cpu_steal_ratio`, labelled like container metrics. The console shows the guest metrics on the replica page.

### Image scanning

`image-scanner.ts` scans the **guest image** (`spec.microvm.guestImage`) with Trivy as for containers. Image policy (`imagePolicy`) is evaluated against it, and signature checks apply to it. For bundled images and the launcher, the scanner honours `io.forepath.scan.nested-rootfs` (`/guest`): it runs `trivy image` on the image and additionally `trivy rootfs` on the nested path of an exported filesystem (`docker create` + `docker export | tar -x` into a scratch dir under `paths.mounts`, cleaned afterwards).

### Sizing and boot budget

- **Overhead:** 384 MiB of memory and 0.25 core per microVM (planner).
- **Boot budget:**
  - Probe timeout 240 s; workload `startPeriod` +15 s.
  - Targets, lab-measured and recorded in the docs: ≤ 3 s from container start to workload exec on bare metal, ≤ 15 s nested (WSL).
  - The first start of a new image adds unpack time, around 1 s/100 MB; layers are pre-pulled on `migrationPrepare` and when a placement is decided.

## M7.3 Full VMs

### Resource (`util-model/src/lib/resources/virtual-machines.ts`, new; registered in `RESOURCE_KINDS` as `VirtualMachine`, scope `project`)

```yaml
apiVersion: loadweaver.com/v1
kind: VirtualMachine
metadata: { name: db1, project: shop, labels: { app: db } }
spec:
  image: registry.lw.internal/shop/debian-13:20261017@sha256:… # OCI VM image artifact (digest pinned at plan time)
  firmware: uefi # uefi | bios (bios amd64 only); default uefi
  cpu: { vcpus: 2, model: host-model } # host-model (default, migratable across same-vendor nodes) | host-passthrough (pins: no live migration)
  memory: 4Gi
  disks:
    - { name: root, size: 20Gi, source: image, replicas: 2, crossSite: async, bus: virtio, cache: none }
    - { name: data, size: 100Gi, source: blank, replicas: 2 }
  nics: # exactly one in M7 (the launcher container has one interface)
    - { name: eth0, groups: [db], ipv6: true }
  cloudInit:
    userData: | # or userDataSecret: secret://shop/db1-userdata ; values may contain secret:// refs
      #cloud-config
    sshAuthorizedKeys: ['ssh-ed25519 …']
    networkConfig: auto # auto (static, from the allocation) | none
  placement: { selector: { matchLabels: { tier: vm } }, spread: node }
  ha: { restartElsewhere: true }
  liveMigration: { enabled: true } # freeze budget = cluster default (3.10)
  runStrategy: Always # Always | Manual (power via API) | Halted
  console: { graphical: true }
```

- **Validation:**
  - Disk names are unique, at most 8 disks, exactly one `source: image`, which is the boot disk.
  - Size ≥ the image's `virtualSize`.
  - `memory` ≥ 256 Mi, `vcpus` 1–64.
  - Reserved deployment name `lw-vm`.
- JSON schema: `util-json-schema` generation; the GitOps and plan-bot paths pick the kind up automatically through `RESOURCE_KINDS`.

### Compiler → node desired state

**`feature-control-plane/src/lib/utils/vm-planning.utils.ts` (new):**

- **Scheduler service:** a VM becomes `{ id: '<p>/lw-vm/<name>', replicas: 1 (0 when stopped/Halted), runtime: 'microvm' (ladder level for the KVM launcher), requests: memory+384Mi / vcpus*1000+250m, volumes: disks, requiredFeatures: ['virtual-machines','vm-block-volumes','isolation-ladder'] }`. Node eligibility additionally requires `virtualMachines === true`. Selectors and spread are as for services. HA comes from the existing failover of single-replica stateful services (volume-primary co-location). `ha.restartElsewhere: false` → pinned to the current node (pin reason "ha disabled").
- **Workload spec:** `WorkloadSpec` with `id = <p>/lw-vm/<name>/0`, `kind: 'service'`, `image = launcher`, `runtime: 'runc'`, `isolation: 'microvm'`, `restart: 'always'` (Manual/Halted: driven by the power state), labels from metadata + `loadweaver.com/vm=<name>` (groups and policies match like services), and addresses allocated as for a service replica.
- **New field** `vm` (refuse-gated `virtual-machines`):
  ```ts
  vm: z.object({
    uid: z.string().uuid(),
    mac: macSchema /* 52:54:00 + 3 bytes of sha256(uid) */,
    firmware: z.enum(['uefi', 'bios']),
    cpuModel: z.enum(['host-model', 'host-passthrough']),
    vcpus,
    memoryMiB,
    disks: z.array(z.object({ name, volume: volumeIdSchema /* <p>/lw-vm/<name>.<disk> */, bus: z.literal('virtio'), cache: z.enum(['none', 'writeback']), boot: z.boolean() }).strict()).max(8),
    image: z.object({ ref: z.string().max(512), digest: sha256Ref, format: z.enum(['qcow2', 'raw']), layerDigest: sha256Ref }).strict(),
    cloudInit: z
      .object({ metaData: z.string().max(4096), networkConfig: z.string().max(16384).optional(), userData: z.string().max(65536).optional(), secretRefs: z.array(secretRef).max(32) })
      .strict()
      .optional(),
    graphics: z.boolean(),
    power: z.enum(['running', 'stopped']),
  })
    .strict()
    .optional();
  ```
  `vm.cloudInit` is outside the spec hash except for `metaData.instance-id`, so a change to user-data doesn't recreate the VM. cloud-init applies user-data only on the first boot anyway.
- **Volumes:** each disk becomes a `VolumeAssignment` with new refuse-gated fields `mode: 'block'` and `initializeFrom?: { digest, format }` (`vm-block-volumes`).

### OCI VM image artifacts

- **Media types (new `util-model/src/lib/vm-image.ts`):**
  - manifest `artifactType: application/vnd.loadweaver.vm-image.v1`;
  - config `application/vnd.loadweaver.vm-image.config.v1+json` = `{ arch: 'amd64'|'arm64', format: 'qcow2'|'raw', virtualSize, firmware: ['uefi','bios'], os?: {id, version}, guestAgent?: boolean }`;
  - a single layer `application/vnd.loadweaver.vm-image.disk.qcow2` or `…disk.raw+zstd`;
  - multi-arch via an OCI index.
  - **Also accepted:** KubeVirt `containerDisk` images (a regular image whose tar layer contains `/disk/*.qcow2|*.img`), detected at plan time.
- **Push:**
  - CLI `lw vm-image push <file> <registry>/<project>/<name>:<tag> [--arch] [--firmware]` (`apps/loadweaver/cli`): reads `qemu-img info --output=json` when available (else a header parse for qcow2/raw), uploads with chunked blob upload to the built-in registry with the user's registry token, and prints the digest.
  - API import: `POST /api/projects/:p/vm-images/import { url, sha256, ref }`. It is a background job in the CP (existing jobs infrastructure); the download is SSRF-checked with the existing egress URL checks, the sha256 is verified, and the result is pushed to the registry.
  - Console page "VM images" (list via registry catalog filtered by `artifactType`).
- **Signing and policy:** cosign signatures and image policies apply by repository exactly as for container images. The plan blocks unsigned images where the policy requires signatures.
- **Scanning** ("where possible", spike S6): a CP-side job in a sandboxed helper container (node-shell + `qemu-img`) converts the disk to raw and runs `trivy vm --scanners vuln <raw>`, with a raw/VMDK fallback through `qemu-img convert`. Unscannable images get the status `not-scannable`, and a plan warning, or a block in enforce mode with `block` thresholds.
- **Import to a DRBD disk** (agent `vm/vm-image-import.ts`): when the boot disk volume is first promoted on its primary and `initializeFrom` isn't recorded yet:
  1. Fetch the blob (digest verified) into `/var/lib/loadweaver/vmimages/sha256/<digest>`, a cache with LRU GC.
  2. Run the launcher image in `import` mode: `--device /dev/drbd<minor>`, blob read-only, `--network none`, caps dropped, `qemu-img convert -n -O raw -t none <blob> /dev/drbd<minor>`.
  3. Record `initializedFrom=<digest>` in the volume's state file on the DRBD device's metadata area. Practically, a small header file in the volume's LVM tags `lw.init=<digest>`, set on all replicas by the agent after the sync.
  - The guest grows its filesystem (cloud-init `growpart`).
  - The CP can trigger this explicitly with the `vmImageImport` message for the "reimage" action.

### DRBD block volumes as virtio-blk

- **`volume.manager.ts`:** `mode === 'block'` skips `mkfs`/`mount`. `ensureBlock(volume)` promotes on the primary (`drbdadm primary`) when the VM starts and returns `/dev/drbd<minor>`. Resource options are unchanged (LUKS below DRBD, so the guest sees plaintext; protocol C within the site).
- **Docker volume plugin:** not used for block. The launcher gets `HostConfig.Devices: [{ PathOnHost: '/dev/drbd<minor>', PathInContainer: '/dev/drbd<minor>', CgroupPermissions: 'rw' }]` (no `m`).
- **Launcher (`launch-vm`):** adds `stat -c %g /dev/drbd*` to the VMM user's groups (like the kvm gid). The domain XML has `<disk type='block' device='disk'><driver name='qemu' type='raw' cache='none' io='native' discard='unmap'/><source dev='/dev/drbd<minor>'/><target dev='vdX' bus='virtio'/></disk>`, with the boot disk first.
- **Demotion:** when the container stops (agent `stop` hook), the volume is demoted to secondary, as for filesystem volumes.

### cloud-init NoCloud seed

- **CP side** (`vm-planning.utils.ts`) builds:
  - `meta-data`: `instance-id: <uid>-<generation>`, `local-hostname: <name>`;
  - `network-config` v2: `ethernets: { eth0: { match: { macaddress: <mac> }, addresses: [v4/32, v6/128], routes: [{to: default, via: 169.254.1.1, on-link: true}, {to: '::/0', via: 'fe80::1'}], nameservers: { addresses: <node DNS>, search: [...] }, mtu: <pod mtu> } }`. The DNS servers are rendered per node by the agent: a placeholder `${LW_DNS}` filled by the agent.
  - `user-data`: as given, with `sshAuthorizedKeys` merged.
- **Secrets:** `secret://` refs inside user-data and `userDataSecret` are listed in `secretRefs`. The agent resolves them through the existing secret broker (tmpfs, never on disk) and substitutes them. The seed is built **on tmpfs**, `secretDir(runtimeDir, id)/seed/`, by the launcher at start (`seed-build`: `mkfs.vfat -n CIDATA` on a 4 MiB file in `/dev/shm` + `mcopy`), and attached read-only as `<disk type='file' device='cdrom'>` with `<readonly/>`. The seed never persists, and it is regenerated on every start with the same `instance-id`, so cloud-init doesn't re-run.

### Lifecycle API and console pages

- **API** (`feature-control-plane`, new `controllers/virtual-machines.controller.ts`, `services/virtual-machines.service.ts`; OpenAPI):
  - `GET /api/projects/:p/virtual-machines`, `GET …/:name` (spec + status: phase `Pending|Importing|Starting|Running|Stopping|Stopped|Migrating|Failed`, node, IPs, guest metrics, disks, last boot).
  - `POST …/:name/{start|stop|reboot|reset|shutdown}`: audited, role `operator` (developers per project setting), recorded as the operational power state `lw_vm_power(vm, desired, by, at)`. `start`/`stop` change `vm.power` and therefore replica presence. `reboot` (ACPI), `reset` and `shutdown` send `vmPower { replica, action }` (message gated `virtual-machines`); the agent runs `docker exec <launcher> /usr/lib/agenstra-microvm/vm-ctl <action>`, which wraps `virsh -c qemu:///session reboot|reset|shutdown`.
  - `POST …/:name/migrate { node? }`, reusing the planner's move path.
  - `GET/POST …/:name/snapshots` (= Kopia backups of all disks, see below).
  - `POST …/:name/console { kind: 'serial'|'vnc' }` → live session ticket.
  - Power in `runStrategy: Always` is only allowed for reboot/reset (start/stop return 409 "managed by spec").
- **Console** (`libs/domains/loadweaver/frontend/feature-console/src/lib/virtual-machines/`): list page, detail page (status, actions, disks, metrics, snapshots, events), serial console tab, VNC tab. All built from `fpc-*` components. The terminal panel already exists; **new shared component `fpc-vnc-viewer`** in `ui-components` wraps `@novnc/novnc` (installed with `--save-exact`) and gets Storybook stories in all brands. Data access goes in `data-access-console` (NgRx, the existing pattern).

### Serial and graphical consoles via the live path

- **Protocol:** new message `consoleOpen { target: { kind: 'replica', replica }, kind: 'serial' | 'vnc', cols?, rows? }` (message-gated `vm-consoles`). Data uses the existing `execInput` / `execOutput` / `execResize` / `execClose` / `execExit` on the same channel (binary-safe since `exec-stdio`).
- **Agent:** a Docker exec in the launcher **without** the vm-exec rewrite (agent-internal command, not user input):
  - serial: `/usr/lib/agenstra-microvm/vm-console serial`, which attaches to the domain's console unix socket (`<serial type='unix'>`); TTY true; resize ignored.
  - vnc: `/usr/lib/agenstra-microvm/vm-console vnc`, which relays raw RFB from `<graphics type='vnc' socket='…/vnc.sock'/>` on stdio, TTY false.
  - For full VMs, the daemon no longer copies the serial console to `docker logs` (the guest console is the user's); it goes to the console socket only. A console log ring buffer of 1 MiB is kept for "show boot log".
- **CP:** the live gateway (existing terminal websocket) gets a VNC websocket endpoint `/api/live/:session/vnc`, which relays binary frames between noVNC (`websockify`-compatible framing) and `execInput` / `execOutput`. Recordings: serial is recorded like terminals; VNC records session metadata and duration only (recording RFB is out of scope, stated in the docs). Roles and policy are identical to terminals.

### HA and failover

These are the existing semantics of single-replica stateful workloads: on node loss, the DRBD quorum and fencing promote a sync replica elsewhere and the VM restarts there (cold boot, crash-consistent disk). `ha.restartElsewhere: false` → no failover (pinned). Planned moves use M7.4 (live), or else stop-and-start.

### Snapshots and backups

- **`backup.manager.ts`** gets a block-mode branch:
  1. Pre hook: if the VM image declares `guestAgent: true`, run `vm-ctl fsfreeze` (`virsh domfsfreeze` through the qemu-guest-agent channel, which the domain XML adds as `<channel type='unix'><target type='virtio' name='org.qemu.guest_agent.0'/>`). Otherwise the snapshot is crash-consistent, and the run says so.
  2. LVM thin snapshot of the LV under LUKS.
  3. Thaw.
  4. `cryptsetup open --readonly` of the snapshot.
  5. `kopia snapshot create --stdin-file=<disk>.raw` reading the mapper device (`--parallel`, compression `zstd`). Kopia's content-defined chunking dedups across runs.
- **Restore:** `Restore` kind target `virtualMachineDisk: <vm>/<disk>` → the VM is stopped, the stream is written to a new LV via `kopia snapshot restore … | dd`, and DRBD does a full resync to the peers. `BackupPolicy` selectors can select VMs by labels.

### Terraform

`feature-terraform-provider/src/lib/resources.ts`: add `['loadweaver_virtual_machine', 'VirtualMachine']` with a typed schema generated from the zod spec (as for the other typed resources). Data source `loadweaver_vm_image` (digest lookup). Plus e2e in `apps/loadweaver/terraform-provider/src/terraform.e2e.spec.ts`.

### Quotas

`projectSpec.quotas` gets `virtualMachines` (count), `vmVcpus`, `vmMemory` and `vmDiskBytes`. These are checked in the planner (plan error), and also count into the existing CPU, memory and volume quotas. Usage metering adds the meter `vm-vcpu-hours` and `vm-memory-gib-hours`, following the existing usage meters.

### Documentation

- **New feature pages** under `docs/loadweaver/features/`: `isolation-levels.md`, `microvms.md`, `virtual-machines.md`, `vm-images.md`.
- **Updated feature pages:**
  - `terminals-files-and-tunnels.md`: serial and VNC consoles.
  - `migration.md`: QEMU, gVisor KVM and the microVM limits.
  - `backups.md`: block volumes.
  - `volumes.md`: block mode.
  - `nodes-and-joining.md`: KVM requirements, opt-out, probes.
  - `updates.md`: KVM modules with kernel rollouts.
  - `image-policies.md`: VM images and nested-rootfs scanning.
- **Other docs:**
  - `docs/loadweaver/deployment/`: system requirements (nested virtualization).
  - Terraform docs.
  - OpenAPI, the JSON schema for `VirtualMachine`, and `frontend-docs` navigation.
  - `docs/agenstra/features/container-isolation.md`: a section "On Loadweaver".
  - `.diagrams/loadweaver.mmd`.

## M7.4 QEMU live migration

### Eligibility (`migration-eligibility.utils.ts`)

- `MigrationMethod` gets `'vm-live'`, and `CheckpointRuntime` (CP entities only: `workload-placement.entity.ts`, `migration.entity.ts`, with a TypeORM migration for the column check) gets `'qemu'`. The wire `checkpointRuntimeSchema` is unchanged.
- **Applies to:** full VMs, and **generic microVMs without filesystem volumes** (tmpfs and secrets only).
- **Falls back to short-stop or blue-green when:**
  - a microVM has replicated filesystem volumes. ext4 on a dual-primary DRBD mounted by two virtiofsds is not safe; the reason text says so.
  - a bundled microVM is migrated, because its user-mode network state and forwarded TCP connections don't survive.
  - `cpu.model: host-passthrough` is used on non-identical CPUs (CPU flags differ, from the capability `cpuFlagsHash`).
  - either node lacks the `vm-migration` feature.
  - a disk has no synchronous replica on the target (existing `unsyncedVolumes`).
  - the freeze estimate exceeds the budget.
- **Freeze estimate:** `estimateFreeze` for `qemu` = (dirty rate × final round + device state ~ 2 MiB) / link + `overheadMs.qemu` (initial 300 ms). Pre-copy keeps it small, as for runc.

### Flow and messages (new in `util-agent-protocol/src/lib/migration.ts`, message-gated `vm-migration`, channel `migration:<id>`)

```ts
vmMigrationPrepare   → target { ...sessionFields, source, token, spec: workloadSpecSchema, addresses, volumes, expiresInSeconds }
vmMigrationStart     → source { ...sessionFields, target, endpoint, token, downtimeLimitMs, maxBandwidthBps?, maxSeconds }
vmMigrationSwitchover→ source { ...sessionFields }          // force completion (postcopy disabled; just lowers convergence: auto-converge on)
migrationCommit / migrationAbort / migrationProgress        // reused unchanged; phases prepare/precopy/freeze/restore/commit/abort
```

1. **prepare (target):**
   - Pull or unpack the launcher and guest layers.
   - Volumes: `drbdadm net-options --allow-two-primaries=yes <res>`, then `drbdadm primary`.
   - Network: create the replica on the **kept-address** network with `hostRoutes` (the existing mechanism: `keptNetworkName`, IPAM plugin); `MacAddress` = the VM MAC (the plugin honours the requested MAC).
   - For microVMs: prepare an empty upper (thin LV).
   - Start the launcher in **incoming mode**: the marker file `/run/loadweaver/vm/incoming` is in the per-replica run dir and is consumed on boot, so a later Docker restart cold-boots. `launch-vm` / `launch-generic` define the domain and start QEMU with `-incoming defer` through libvirt (`virsh create --paused` with the domain's `<qemu:commandline>` incoming arg, or `virsh migrate` receiving side; spike S4 chooses).
   - Tap and tc setup as usual.
   - The agent opens the transfer endpoint (`transfer.service.ts`, mTLS + token over WireGuard) as a **relay to the target launcher's libvirt session socket** (`/run/loadweaver/vm/libvirt.sock`, exposed from the VMM run dir into the rw run subdir).
   - Reports `prepare done {endpoint}`.
2. **start (source):**
   - `allow-two-primaries` on the source volumes.
   - The agent opens a local unix socket `/run/loadweaver/vm/peer.sock` (in the source launcher's run dir), relayed through mTLS to the target endpoint.
   - `docker exec launcher vm-ctl migrate --peer-socket /run/loadweaver/vm/peer.sock --downtime <ms> --max-seconds <s>` runs `virsh migrate --live --p2p --tunnelled --auto-converge --abort-on-error --undefinesource=no --persistent=no <dom> 'qemu+unix:///session?socket=/run/loadweaver/vm/peer.sock'` after `virsh migrate-setmaxdowntime`. Disks are shared (DRBD), so there is no `--copy-storage`.
   - Generic microVMs: the upper layer is synced first with rsync over the same relay as the runc upperdir path in `migration.service.ts`, and the virtio-fs device state migrates with `virtiofsd --migration-mode=find-paths` (spike S7). The final rsync happens inside the QEMU stop phase through the libvirt pre-switchover hook, else the method is `stop-and-copy`.
   - Progress: `precopy running {round, bytes, totalBytes, dirtyBytesPerSecond}` polled from `virsh domjobinfo` once a second; then `freeze done {freezeMs = downtime}`.
3. **restore (target):** QEMU resumes automatically. The agent detects the domain running (`virsh domstate`), reports `restore done`, and sends a gratuitous ARP/NA. QEMU announces after migration (`announce-*` defaults), so the switch and bridge tables learn the new port; the kept route is originated by BIRD (existing).
4. **commit:**
   - Source: the domain is gone (libvirt undefined it); stop and remove the launcher container, demote the volumes, reset `allow-two-primaries=no`, delete the upper (microVM).
   - Target: reset `allow-two-primaries=no`, and record that the replica runs under the kept address until its next recreate (existing semantics).
5. **abort:**
   - Source: `virsh domjobabort` (the guest keeps running on the source), demote nothing.
   - Target: destroy the incoming launcher, demote the volumes to secondary, reset the dual-primary option.
   - After abort, the CP continues with short-stop, as today.

- **CP:** `migration-state.utils.ts` `sessionCommands` gets a `qemu` branch that maps `CHECKPOINT_PHASES` to the new messages. `sessionStep` is unchanged: `prepare → precopy → freeze → restore → cutover`, with the transfer phase skipped because `freeze` done implies transfer done. Timeouts are the existing `DEFAULT_MIGRATION_TIMEOUTS`, plus `precopy` ≤ `maxSeconds` (default 120 s).
- **Licensing:** cross-site VM migration falls under the BUSL multi-site split (3.35). The eligibility check uses the existing cross-site licence gate.

## M7.5 Agenstra on Loadweaver

### Level mapping (`libs/domains/agenstra/backend/feature-agent-manager/src/lib/runtime/loadweaver/isolation-mapping.ts`, new)

| Agenstra `IsolationLevel` | Loadweaver `x-loadweaver.runtime` | image                                                              | notes                                                                                                   |
| ------------------------- | --------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| standard                  | runc                              | worker image                                                       | —                                                                                                       |
| sandboxed                 | sandboxed                         | worker image                                                       | gVisor systrap (Netstack; no egress-guard hostnet variant, because Loadweaver's node proxy does egress) |
| sandboxed-kvm             | sandboxed-kvm                     | worker image                                                       | gVisor KVM                                                                                              |
| microvm                   | microvm                           | `resolveMicrovmImage()` (Agenstra's labelled image → bundled mode) | `vm-exec` for exec                                                                                      |

- `toLoadweaverRuntime(level)` throws `BadRequestException(E_ISOLATION_RUNTIME_FAILED)` for unknown values and never falls back. `loadweaver.runtime.ts:229` and `:277` use it; `environment-compose.ts` gets `runtime: Runtime` (all four), and the parse at `:113` maps back exactly (unknown → error, not `sandboxed`).

### Aggregated capability probes

- **New CP API** `GET /api/projects/:p/isolation-capabilities?selector=…` (OpenAPI). It returns for each level `{ state: 'ready' | 'unsupported' | 'probe-failed' | 'disabled-by-admin', nodes: n, reasonCode?, reason? }`, where ready means **at least one schedulable node in the project's placement** (project node selector ∩ request selector, lifecycle active, agent features present) has the level `ready`. Otherwise the state is the most common non-ready state and its reason code.
- **Agent manager side:**
  - `LoadweaverRuntime.getDockerHostInfo()` lists runtimes from that response.
  - `runIsolationProbe({runtime})` and `runMicrovmProbe()` return `{ ok }` from the aggregate (`gvisorKernelDetected: true` for gVisor levels), cached 60 s.
  - `IsolationCapabilitiesService` therefore reports Loadweaver's real state.
  - If the plan later fails for lack of capacity, the environment creation fails with `E_ISOLATION_RUNTIME_FAILED` and is never downgraded.

### MicroVM environment compose variant (`environment-compose.ts`)

For `runtime: microvm`:

- `image` = the microVM image (pinned digest via `image-resolver`), with `x-loadweaver.runtime: microvm`.
- **No `cap_add`, `init` or `devices` in the compose.** The node agent applies the launcher HostConfig (`Init:false`, `CapDrop ALL` + launcher caps, `/dev/kvm`, `no-new-privileges`) for bundled mode, so the compose can't weaken it. Plan validation rejects `cap_add`, `privileged` and `devices` with `runtime: microvm`.
- Volumes: the environment volume target becomes `/guest${AGENT_ENVIRONMENT_MOUNT_TARGET}`; any other workspace mounts get a `/guest` prefix (as in `docker.service.ts:438-464`).
- Environment: `AGENSTRA_MICROVM_ENTRYPOINT`, `AGENSTRA_MICROVM_FORWARD_PORTS=4096,6080` (bundled mode keeps user-mode networking and the bridge forwards the container's ports), `AGENSTRA_MICROVM_LOOPBACK_PORTS` unset (no egress-guard proxy on Loadweaver), `AGENSTRA_MICROVM_MEMORY_MB` from the environment size.
- Healthcheck via `vm-exec`.

### `vm-exec` in LoadweaverRuntime exec paths

- `loadweaver-client.ts` `exec` and `startExec` (and `readFile` / `writeFile` when they exec) apply `toMicrovmExecOptions`-equivalent argv wrapping when the environment's runtime is `microvm`: `command = [MICROVM_EXEC_CLIENT_PATH, ...envNamesArgs, '--', ...command]`, with env values in `execOpen.env`.
- Live file operations use `/guest` paths. This is needed because Agenstra's file API targets the container; Loadweaver's file browser on bundled microVMs maps `path` to `/guest/path` via `MergedDir`, or uses `vm-exec cat` for coherence.
- Unit tests in `loadweaver.runtime.spec.ts` cover each level and the throw on unknown values.

## M7.6 Labs

### Shared VM-lab harness

- **New lib** `libs/domains/shared/backend/util-vm-lab/` (Nx `shared-backend-util-vm-lab`, `type:util`, test-only consumers), created by merging:
  - from Loadweaver `vm-lab/vm-lab.ts`, `golden.ts`, `docker.ts`, `qemu.Dockerfile`, `cleanup.sh`: the multi-VM switch container with per-site bridges and taps, golden images by content hash, per-run volumes, `maxMemoryMb` guard;
  - from Agenstra `feature-isolation-lab/src/integration/harness/{vm.ts, lab-host.ts, process.ts, images.ts}`: single VM with user-mode networking + ssh via `docker exec`, `exposeVirtualization`, Docker socket tunnel (`docker system dial-stdio`).
- **API:**
  ```ts
  startVmLab({ golden: GoldenSpec /* debian-13-loadweaver | ubuntu-22.04-agenstra */, vms: VmSpec[], network: 'switch' | 'user', nested: boolean /* -cpu host vs host,-vmx,-svm */, maxMemoryMb = 7168, label: 'org.forepath.vm-lab' })
  ```
  The `Vm` type gets `exec`, `copyIn`, `copyOut`, `reboot`, `crash`, `start` and `dockerSocket()` (Agenstra's tunnel). The golden specs stay in their products; the harness takes a `GoldenSpec { id, baseImage{url, sha512|sha256}, provision: string, files }`.
- **Moves:**
  - Loadweaver's `vm-lab/*.vm-lab.spec.ts` keep their place and import the shared harness.
  - Agenstra's `feature-isolation-lab` keeps its specs and config and imports the shared harness. Its Nx target `isolation-lab` and its labels stay; the cleanup scripts are unified with a `--label` parameter.

### Nested virtualization on the WSL / Docker Desktop host

- The host must expose `/dev/kvm` to containers: `docker run --rm --device /dev/kvm debian:trixie-slim ls -l /dev/kvm`.
- Lab VMs get `-cpu host` (vmx/svm visible), so `/dev/kvm` exists **inside** the lab VM. WSL2 requires `nestedVirtualization=true` in `.wslconfig` (default on Windows 11).
- A preflight in the global setup boots a minimal guest and checks `[ -c /dev/kvm ] && grep -E 'vmx|svm' /proc/cpuinfo`. Without it, KVM specs **fail**, unless `VM_LAB_ALLOW_NO_KVM=1`, in which case they are skipped with a visible warning (Agenstra's rule).
- Nesting depth: Hyper-V → WSL kernel → lab VM → microVM/VM (3 levels). Guests in labs use a 256–512 MiB microVM and a 512 MiB full VM.

### Lab specs (all under `libs/domains/loadweaver/backend/feature-node-agent/src/integration/vm-lab/`)

| spec                                                     | VMs (guest MiB)                       | asserts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `isolation-ladder.vm-lab.spec.ts`                        | 1 × 2048 nested + 1 × 1536 non-nested | Install script registers `runsc-systrap` and `runsc-kvm` with the exact args. The probe reports all 4 levels ready on the nested VM, and only runc + sandboxed with `E_KVM_UNAVAILABLE` on the other. Opt-out removes the KVM levels. The `linux-modules-extra` path runs from the snapshot only (apt log shows no other source). A kernel update + reboot keeps KVM. `sandboxed-kvm` workload runs with `dmesg` gVisor + `--platform=kvm` in `ps`. `/dev/kvm` device workload is allowed only with the project allowance.                                                                                                                                                                                                                                                                                                                 |
| `microvm.vm-lab.spec.ts`                                 | 1 × 3072 nested                       | Generic microVM from alpine and from `debian:trixie-slim` (no node in the image): entrypoint, cmd, env, user, workdir; exit code propagation (`exit 7` → container 7 → restart policy); SIGTERM grace; healthcheck via vm-exec; `docker logs`; terminal + machine exec (TTY resize); file browser coherence; guest-owned IP reachable from another node's container (policy allow) and blocked (policy deny); **spoofing** (guest `ip addr add <neighbour>` and a forged MAC both dropped); IPv6; MTU 1420 ping `-M do -s 1392`; unpack cache shared by 2 replicas (one layer dir), GC after delete; whiteouts, opaque dirs and setuid preserved in the guest, but never executable on the host (`noexec` mount); malicious tar (symlink escape, `..`, device node) refused. Launcher hardening as in Agenstra's spec. Boot time recorded. |
| `virtual-machine.vm-lab.spec.ts`                         | 2 × 2560 nested (same site)           | VM from a pushed Debian genericcloud OCI artifact: import to DRBD, cloud-init (hostname, ssh key, user-data secret substitution, seed not on disk: `find / -name '*.cidata*'` on the node), static network, serial console output, VNC handshake (RFB `RFB 003.008`), reboot / reset / stop / start, node crash → restart on the peer, Kopia backup of the disk + restore.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `vm-live-migration.vm-lab.spec.ts`                       | 2 × 2560 nested                       | VM live migration under a memory writer: freeze ≤ budget, TCP connection to the guest survives, IP kept (kept-address route), DRBD back to single-primary; abort path (kill the target mid-precopy → VM keeps running on the source); stateless generic microVM migration; microVM with fs volume falls back to short-stop (reason text). gVisor KVM checkpoint same-platform restore and refusal towards a node without KVM.                                                                                                                                                                                                                                                                                                                                                                                                              |
| Agenstra `microvm.isolation-lab.spec.ts`                 | unchanged (3072 + 768)                | Regression after the lib and image move.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `agenstra-on-loadweaver.vm-lab.spec.ts` (optional, M7.5) | 1 × 3584 nested                       | Agent manager with `LoadweaverRuntime` against a single-node cluster: the 4 levels in capabilities, an environment created at each level, vm-exec terminal in microvm.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

**Memory budget:** the guard stays ≤ 7 168 MiB per lab run (guest + 700 MiB per VM + switch). The 2-VM specs use 2 × (2560 + 700) = 6 520 MiB, and nested guests inside them stay ≤ 768 MiB in total (one VM of 512 MiB + launcher overhead). Specs run in band.

## Risks and spikes (do first, in the VM lab)

- **S1 Tap and libvirt session.** Check that `<interface type='ethernet'><target managed='no'>` works from an unprivileged session libvirt with only `/dev/net/tun` and a pre-created tap owned by uid 10930, and whether vhost-net can be used (`/dev/vhost-net` device, `<driver name='vhost'>`). Fallback: QEMU `-netdev tap,fd=` via a passed fd from the launcher's root part (the launcher has no NET_ADMIN, which is only needed for creation, and creation is done by the agent).
- **S2 Guest tools independent of the image's libc.** Node via an explicit loader on alpine/musl and distroless guests; a static `lw-pty`; tools RAM footprint.
- **S3 virtiofsd on a host overlayfs.** xattrs, `--announce-submounts`, inode stability, `cache=auto` coherence for the host-side file browser.
- **S4 libvirt tunnelled p2p migration** between two session daemons through a relayed unix socket (auth: session socket without SASL; the relay is only reachable by the agent). Alternative: QMP `migrate` to `unix:` + the agent's mTLS relay with `-incoming defer` on the target.
- **S5 Nesting budget on WSL.** Boot times at 3 levels and the memory ceiling.
- **S6 VM image scanning.** `trivy vm` on raw/qcow2 converted images.
- **S7 virtio-fs live migration.** QEMU 10 + virtiofsd 1.13 `--migration-mode`; otherwise microVMs migrate by stop-and-copy.
- **S8 Ubuntu bundle roots.** `linux-image-extra-virtual(-hwe)` resolves `linux-modules-extra` for all bundled kernels (arm64 included).
- **S9 KVM runtime removal.** Whether `GVISOR_KVM=0 install` removes previously registered KVM runtimes.
- **S10 Memory accounting.** memfd guest memory charged to the launcher cgroup (OOM behaviour), and whether `LAUNCHER_OVERHEAD_MiB = 384` holds with a second virtiofsd.
- **Other risks:**
  - DRBD dual-primary split-brain if the abort ordering is wrong. Mitigation: dual-primary only between the `prepare` and `commit`/`abort` confirmations, and `after-sb-*` policies stay disconnect.
  - Hairpin routing through `lwbr0` for intra-node guest traffic (ICMP redirects disabled).
  - The image size of the launcher (~600 MB).

## Work split (parallelizable agent tasks)

| task                            | scope (disjoint files)                                                                                                                                                                                                                                                                                                                                                      | depends on                                                       |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| W1 Types and protocol           | `util-model` (infrastructure.ts levels, node spec opt-out, project allowances and quotas, `virtual-machines.ts`, `vm-image.ts`, `RESOURCE_KINDS`); `util-agent-protocol` (messages.ts fields, migration.ts VM messages, versioning.ts features, gates, refuse mode, compat tests); `util-json-schema` regeneration                                                          | —                                                                |
| W2 Compose and scheduler        | `util-compose` (extensions, model, parse-compose levels, devices allow-list, microvm extension); `util-scheduler` (types, eligibility, KVM / VM node flags, reasons)                                                                                                                                                                                                        | W1                                                               |
| W3 CP planning and compiler     | `feature-control-plane` `utils/workload-planning.utils.ts`, new `microvm-planning.utils.ts`, `vm-planning.utils.ts`, `services/workload-planner.service.ts`, `image-resolver.service.ts` (config + labels), `nodes.service.ts` (derived labels), quotas                                                                                                                     | W1, W2                                                           |
| W4 Node probes and KVM prep     | node-agent `host/isolation-probe.service.ts`, `host-info.service.ts`, `updates/host-commands.ts`, `os-update.manager.ts`; CP `install-script.utils.ts`, `rollout-planner.utils.ts`; `util-release/apt-bundle.ts`; shared `util-container-runtime/gvisor-install.script.ts` (`kvmApt`)                                                                                       | W1                                                               |
| W5 Shared lib and launcher move | `git mv` of the bridge to `libs/domains/shared/backend/util-microvm-bridge`; new `apps/shared/microvm-launcher/**` (Dockerfile, scripts, `launch-generic`, `launch-vm`, `vm-ctl`, `vm-console`, `seed-build`, `lw-pty.c`, guest-tools build); Agenstra `Dockerfile.worker-microvm`, `project.json`, imports in `feature-agent-manager`; `util-release/pins.ts` launcher pin | — (start immediately)                                            |
| W6 MicroVM node side            | node-agent `microvm/{rootfs-cache.ts, rootfs-unpack.ts, guest-network.ts}`, `workloads/workload-container.ts` (levels, devices, launcher options), `workload.manager.ts` (attach network, start events), `pod-network.manager.ts` (link-local gateway), `metrics/` guest stats, `images/image-scanner.ts` (nested rootfs)                                                   | W1, W5 (S1–S3)                                                   |
| W7 Live and exec                | node-agent `live/live-sessions.service.ts` (vm-exec wrap, consoleOpen, file root); CP live gateway VNC endpoint                                                                                                                                                                                                                                                             | W1, W5                                                           |
| W8 Full VMs, CP + UI            | CP `controllers/virtual-machines.controller.ts`, `services/virtual-machines.service.ts`, vm-images import job, entities/migrations; console `feature-console/src/lib/virtual-machines/**`, `data-access-console` VM slice; `ui-components` `fpc-vnc-viewer`; CLI `vm-image push`                                                                                            | W1, W3                                                           |
| W9 Full VMs, node side          | node-agent `vm/{vm-image-import.ts, vm-power.ts, cloud-init-seed.ts}`, `volumes/volume.manager.ts` (block mode), `backups/backup.manager.ts` (block branch)                                                                                                                                                                                                                 | W1, W5, W6 (network)                                             |
| W10 Migration                   | CP `utils/migration-eligibility.utils.ts`, `migration-state.utils.ts`, `services/migration-session.service.ts`, entities; node-agent `migration/vm-migration.service.ts` (new), `transfer.service.ts` (unix relay), `checkpoint.manager.ts` / `restored-runtime.ts` (KVM platform)                                                                                          | W6, W9 (S4, S7)                                                  |
| W11 Agenstra on Loadweaver      | `feature-agent-manager/src/lib/runtime/loadweaver/**` (+ new `isolation-mapping.ts`); CP isolation-capabilities endpoint (`controllers/isolation-capabilities.controller.ts`)                                                                                                                                                                                               | W1, W3, W5                                                       |
| W12 Terraform and docs          | `feature-terraform-provider/src/lib/resources.ts` + e2e; `docs/loadweaver/**`, `docs/agenstra/features/container-isolation.md`, OpenAPI, `.diagrams/loadweaver.mmd`                                                                                                                                                                                                         | W8 (schema), parallel with the rest                              |
| W13 Labs                        | `libs/domains/shared/backend/util-vm-lab/**`; harness imports in both labs; new `*.vm-lab.spec.ts`                                                                                                                                                                                                                                                                          | W5 (harness first, in parallel), the specs after W4, W6, W9, W10 |

**Order:**

1. W1 and W5 in parallel, plus the S1–S10 spikes (in the W13 harness as soon as it exists).
2. W2 and W4.
3. W3, W6 and W7.
4. W8, W9 and W11.
5. W10.
6. W12 and the W13 specs.
7. Combined gate.

## Protocol version bump: summary

- **No bump** if v2 isn't frozen before M7 ships. All new features are `since: 2`.
- **Field-level additions** (`isolation`, `devices`, `microvm`, `vm`, `volumes[].mode` / `initializeFrom`, `host.kvm`, capability fields) are gated (refuse or strip).
- **New message types** (`consoleOpen`, `vmPower`, `vmImageImport`, `vmMigrationPrepare` / `Start` / `Switchover`) are message-gated.
- **The bridge protocol stays 1** (additive `STATS` message and `boot.rootDir`; launcher and guest tools ship in the same image).
- If a release freezes v2 first, bump `PROTOCOL_VERSION` to 3, set `since: 3` on the M7 features, and run `freeze-protocol`.

### Critical Files for Implementation

- /home/marcelmenk/github/forepath/one/libs/domains/loadweaver/shared/util-agent-protocol/src/lib/versioning.ts
- /home/marcelmenk/github/forepath/one/libs/domains/loadweaver/shared/util-agent-protocol/src/lib/messages.ts
- /home/marcelmenk/github/forepath/one/libs/domains/loadweaver/backend/feature-node-agent/src/lib/workloads/workload-container.ts
- /home/marcelmenk/github/forepath/one/libs/domains/loadweaver/backend/feature-control-plane/src/lib/utils/workload-planning.utils.ts
- /home/marcelmenk/github/forepath/one/libs/domains/loadweaver/backend/feature-control-plane/src/lib/utils/migration-eligibility.utils.ts
- origin/main: /home/marcelmenk/github/forepath/one/apps/agenstra/backend-agent-manager/worker-microvm/launch and libs/domains/agenstra/backend/util-microvm-bridge/\*\*

## Decisions on the design (user / coordinator, 2026-10-23)

- **Exact level (user)**: a workload always runs at exactly its declared isolation level; the strength order is only used for node selectors (derived node labels such as "can do at least sandboxed-kvm"), Agenstra's capability aggregation and plan output — the scheduler never upgrades or downgrades a workload's level.
- **Multiple NICs in M7 (user)**: full VMs get one or more interfaces in M7, each with its own groups / policies; the network compiler and node agent create one extra container interface + tap per additional NIC (per-NIC tc redirect + anti-spoofing, per-NIC kept addresses for live migration). W1 / W3 / W6 / W9 / W10 scopes grow accordingly.
- **One launcher image (coordinator)**: microVM kernel + UEFI firmware in one image (~600 MB, pulled once per node).
- **Launcher keeps its Agenstra names (coordinator)**: `/usr/lib/agenstra-microvm`, `agenstra-vmm` stay for now to avoid any Agenstra behaviour change; renaming deferred.
- **Landing page (user)**: W12 also updates the landing page(s) once each level is supported — Loadweaver landing (how-it-works isolation ladder + VMs, home / feature sections, i18n en/de, Agenstra's how-it-works pattern from main) and Agenstra's landing where it names Loadweaver as a runtime; microVM content after W6/W7, VM content after W8/W9.
