# Isolation Levels and MicroVMs

A service in Loadweaver runs at one of four **isolation levels**, ordered from weakest to strongest. The names are the same as in [Agenstra](../../agenstra/features/container-isolation.md), so an Agenstra host and a Loadweaver node mean the same thing by "sandboxed-kvm".

| Level           | Docker runtime on the node           | Kernel boundary                                                                                                   | Node needs                                             |
| --------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `runc`          | `runc` (Docker's default)            | Shares the host kernel (namespaces, cgroups, seccomp, capabilities)                                               | Docker (every node)                                    |
| `sandboxed`     | `runsc-systrap` (gVisor, `systrap`)  | gVisor's Sentry, a Linux kernel in user space, between the workload and the host; no KVM needed                   | The installer's gVisor runtime                         |
| `sandboxed-kvm` | `runsc-kvm` (gVisor, `kvm`)          | The Sentry in a hardware-virtualized address space; system calls trap into it through VM exits instead of seccomp | gVisor's KVM runtime and a usable `/dev/kvm`           |
| `microvm`       | `runc` (hardened launcher container) | Its own Linux guest kernel in a QEMU / KVM virtual machine; the container image becomes the guest                 | A usable `/dev/kvm` and the release's microVM launcher |

```yaml
services:
  api:
    image: ghcr.io/acme/api:1.4 # runc (default)
  render:
    image: ghcr.io/acme/render:3
    x-loadweaver: { runtime: sandboxed }
  untrusted-build:
    image: ghcr.io/acme/builder:7
    x-loadweaver:
      runtime: microvm
      microvm: { rootfsSize: 20Gi } # writable layer per replica, default 10 GiB
```

## Exact levels

- **A service always runs at exactly its declared level**, never a stronger or a weaker one. A plan that can't place it on a node offering that level fails with a reason; it is never downgraded, and a `runc` service never lands in a microVM because a node happens to offer one.
- The **order** of the levels is only used where "at least" makes sense: node selectors, Agenstra's capability view and the plan output.
- Every node reports each level separately (`sandboxed-kvm` can be ready while `sandboxed` isn't, `microvm` doesn't need gVisor at all). Without a working `runc` level nothing runs on the node.
- The plan notes, per isolated service, where it can run: `runs at exactly microvm; nodes offering it: node-1, node-3`. When no node offers the level, the reason names the nodes and why (`runtime microvm: 0 of 5 nodes ready — node-1 E_KVM_UNAVAILABLE, node-2 disabled by node spec, …`).

Compose's own `runtime:` key is accepted too: `runc` → `runc`, `runsc` / `runsc-systrap` → `sandboxed`, `runsc-kvm` → `sandboxed-kvm`; any other value is an error ("unknown runtime X, use x-loadweaver.runtime"). `x-loadweaver.runtime` wins when both are set, with a warning when they differ.

## Selecting nodes by level

Each node gets **derived labels** from its ready levels, next to `loadweaver.com/site` / `loadweaver.com/node`:

| Label                            | Value                                      |
| -------------------------------- | ------------------------------------------ |
| `runtime.loadweaver.com/<level>` | `ready` for every level whose probe passed |
| `loadweaver.com/runtime`         | the node's strongest ready level           |

They win over labels set by hand. Use them in any selector (placement, node groups, policies). "At least sandboxed-kvm" is an `In` over the stronger levels:

```yaml
x-loadweaver:
  runtime: runc
  placement:
    selector:
      matchExpressions:
        - { key: loadweaver.com/runtime, operator: In, values: [sandboxed-kvm, microvm] }
```

The service above still runs on `runc`; the selector only picks nodes that could run stronger workloads too.

The nodes API filters the same way: `GET /api/nodes?runtime=microvm` lists the nodes where `microvm` is ready, `GET /api/nodes?runtime=>=sandboxed-kvm` those whose strongest ready level is at least `sandboxed-kvm` (URL-encode `>=` as `%3E%3D`). Every node in the response carries `runtimes` (its ready levels in ladder order) and `effectiveLabels` (the labels selectors see). Agenstra uses `GET /api/projects/{project}/isolation-capabilities` for its per-project view ([Agenstra on Loadweaver](../guides/agenstra-on-loadweaver.md)).

## Node probes

The node agent proves each level with real checks instead of trusting names:

| Level           | What the probe checks                                                                                                                                                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runc`          | Docker answers and a smoke container runs                                                                                                                                                                                                          |
| `sandboxed`     | `runsc-systrap` is registered with the expected arguments (systrap platform, gVisor's network stack) and a smoke container's `dmesg` shows gVisor                                                                                                  |
| `sandboxed-kvm` | The same for `runsc-kvm` (platform `kvm`), plus KVM usable and not opted out                                                                                                                                                                       |
| `microvm`       | KVM usable and not opted out, `runc` ready, `/dev/net/tun`, the release's launcher image present, the unpack tools and cache usable, and a **probe microVM boots**: output, exec exit codes, file coherence, ping of the guest address, clean stop |

- Smoke and probe containers are labelled `loadweaver.com/probe=1`, run without network (the microVM probe uses its own internal network `loadweaver-microvm-probe`), are limited (64 MB, 64 processes, 30 s; the microVM probe 240 s) and are always removed. They never count as drift.
- **When**: on agent start (a result from the same boot answers at once while a fresh probe runs; never across a reboot), every 6 hours (`LOADWEAVER_ISOLATION_PROBE_INTERVAL_MS`, at least 60 s), after host updates, after three failed starts in a row on one level, and on demand.
- **On demand**: `POST /api/nodes/{name}/isolation-probe` (cluster admins and infra operators, scope `cluster:nodes`, audited as `node.isolation-probe`) puts a fresh nonce into the node's desired state; the agent probes and reports its new capabilities (`202` with `{ node, probeNonce }`).
- **States** per level: `ready`, `unsupported`, `installation-failed`, `probe-failed`, `disabled-by-admin`, with Agenstra's reason codes (`E_RUNTIME_NOT_REGISTERED`, `E_RUNTIME_MISCONFIGURED`, `E_PROBE_RUNTIME_MISMATCH`, `E_PROBE_START_FAILED`, `E_PROBE_TIMEOUT`, `E_PROBE_IMAGE_UNAVAILABLE`, `E_KVM_UNAVAILABLE`, `E_DISABLED_BY_ADMIN`, `E_MICROVM_IMAGE_UNSUPPORTED`, `E_MICROVM_BOOT_FAILED`, `E_DOCKER_BASELINE_UNAVAILABLE`). They are in the node's `capabilities.isolation`.
- **KVM facts** (`capabilities.kvm`): CPU virtualization support (`cpu`: `vmx` / `svm`; `unknown` on arm64, which builds KVM in), `/dev/kvm` present (`device`), KVM module loaded, nested virtualization, running under a hypervisor, plus `usable` (the device opens read-write and the CPU doesn't rule KVM out) and `optOut`. A hash of the CPU flags (`cpuFlagsHash`) tells nodes with identical CPUs apart for later live migration of KVM workloads.

## KVM on the nodes

- **Preparation**: the installer prepares KVM where the CPU supports it: the gVisor KVM runtime (`runsc-kvm`) is registered next to `runsc-systrap`, and on Ubuntu without a loaded `kvm_intel` / `kvm_amd` module `linux-modules-extra-$(uname -r)` is installed **from the cluster's apt snapshot only** (no other source; without a snapshot entry the installer warns and the next host update brings the package).
- **Host updates** keep the KVM modules in step with the kernel: on Ubuntu nodes that use KVM, `linux-modules-extra-<kernel>` for the running and the next-boot kernel comes from the snapshot after the upgrade (the release pins `linux-image-extra-virtual` and its HWE variant). The update plan lists them as `kvm-modules` ("with the kernel: drain → update → reboot → rejoin, isolation probe before uncordon"), and the rollout's **`kvm` gate** fails the step ("kvm lost after update on <node>", pause and step rollback) when a node that used KVM comes back from the reboot without it. See [Updates](./updates.md).
- **Opting a node out**: `--no-kvm` on the installer (or `LOADWEAVER_KVM=disabled`) skips KVM preparation from the start. Later, set it in the node's spec:

  ```yaml
  apiVersion: loadweaver.com/v1
  kind: Node
  metadata: { name: node-2 }
  spec:
    site: fra1
    virtualization: { kvm: disabled } # default: auto
  ```

  The node then reports neither `sandboxed-kvm` nor `microvm` (state `disabled-by-admin`) and gets no KVM workloads, no `/dev/kvm` device access and no microVMs. The agent unregisters gVisor's KVM runtime without reinstalling gVisor; switching back to `auto` registers it again and re-probes. A plan that opts a node out while KVM-level, `/dev/kvm` or microVM replicas still run there fails ("drain it first").

- **Without usable `/dev/kvm`** (most cloud VMs without nested virtualization) a node simply offers `runc` and `sandboxed`.

## Devices: `/dev/kvm`

Compose `devices` is restricted to an allow-list with one entry, `/dev/kvm`, for workloads that run their own VMs (CI runners, emulators, Agenstra's own microVM environments on the Docker runtime):

```yaml
services:
  ci-runner:
    image: ghcr.io/acme/runner:5
    devices: ['/dev/kvm:/dev/kvm:rwm'] # or the long form { source, target, permissions }
```

- Only `/dev/kvm`, mapped to the same path, permissions `rw` or `rwm` (default `rwm`), once. Anything else is a plan error ("device X is not allowed (allow-list: /dev/kvm)").
- Only for `runtime: runc`: gVisor and microVMs can't pass host devices through.
- The project must allow it: `spec.workloads.allowedDevices: ['/dev/kvm']` in the `Project` resource, which only cluster admins can change ([Projects and access](./projects-and-access.md#quotas)). A plan using the device without the allowance fails with a policy error.
- Placement needs a node with usable KVM that isn't opted out. Device access is a **pin** ("device access (/dev/kvm): the workload can run its own VMs; it is pinned for migration"); the warning stays even when acknowledged.

## MicroVMs

`x-loadweaver.runtime: microvm` turns an ordinary compose service into a virtual machine with its own kernel. Nothing is built per workload: **the container image becomes the guest**.

- **Launcher**: the node starts a hardened `runc` launcher container from the release's `microvm-launcher` image (QEMU through libvirt in session mode, virtiofsd). It gets `/dev/kvm` and `/dev/net/tun`, drops every capability except the launcher's small set, runs with `no-new-privileges`, a read-only root file system and the unprivileged VMM user (uid 10930). Docker, volumes, scheduling and the node agent keep managing a container.
- **Guest root from the unpacked image cache**: the agent unpacks each image layer **once** into a content-addressed, read-only cache on the node (`/var/lib/loadweaver/vmroot`, one directory per layer `diffID`, shared by every replica and every image that uses it) and mounts the layers plus a **per-replica writable layer** (a thin LV of `rootfsSize` in the volume pool, else a sparse file; ext4, `nosuid,nodev,noexec`) as an overlay. The guest boots that overlay through virtio-fs. Unpacking runs confined (own mount and PID namespace, everything else read-only) with strict archive rules: no paths outside the root, no device nodes, overlay whiteouts and opaque directories kept, setuid bits and file capabilities preserved, digests verified while streaming. Unused layers are garbage collected (LRU, at most `LOADWEAVER_VMROOT_CACHE_MAX_BYTES`, default 15 % of the file system). A container restart keeps the writable layer; a recreated or removed replica gets a fresh one.
- **Images that already are microVMs**: images carrying Agenstra's label `io.agenstra.microvm.protocol` (bridge protocol 1) run as they are with their own launcher; others run in the generic launcher.
- **Process**: the image's entrypoint, command, environment, user, working directory and stop signal, overridden by compose as usual. An image without entrypoint or command is a plan error; health checks run inside the guest (`CMD-SHELL` needs `/bin/sh` in the image, a warning says so; the start period gets 15 s for the boot).
- **Sizing**: vCPUs = the CPU limit (rounded up), else the request, else 1; guest memory = the memory limit, else the request, else 512 MiB (at least 128 MiB). The launcher adds **384 MiB and 0.25 CPU** on top; requests, capacity checks and the project's `cpu` / `memory` quotas count that overhead.
- **Guest memory is not all workload memory**: the guest kernel and the guest tools (bridge agent) take about 60 MiB of it, so a 256 MiB microVM leaves ≈ 157 MiB for the workload. Size the memory limit for the workload plus that overhead. When the workload fills the guest's memory, the guest's OOM killer ends the workload, never the bridge agent: the container exits with 137 and the restart policy applies.
- **Multi-architecture guest images**: in clusters with amd64 and arm64 nodes the plan pins the guest image's layers for every architecture it offers and each node unpacks its own. Nodes whose architecture the image lacks don't get its replicas (the plan warns "… has no linux/arm64 variant; its replicas avoid those nodes"); a node never boots layers of the wrong architecture (`E_MICROVM_IMAGE_UNSUPPORTED`).
- **Compose limits**: `network_mode: host` and `privileged` are errors; `cap_add` applies inside the guest (warning); `devices` can't be passed through; bind mounts work (pinned as for containers); volumes, tmpfs and secrets are mounted into the guest. Filesystem volumes are mounted by the node agent and shared with the guest through a virtio-fs share of their own (the guest binds each one to its target), apart from the image root, so a live migration can hand them over; tmpfs and secrets appear below the image root.

### Networking: the guest owns the workload address

The guest gets the replica's **workload IP** itself. The agent creates a tap device inside the launcher's network namespace and redirects traffic between the container's interface and the tap with traffic-control rules (the Kata Containers pattern), so QEMU needs no `NET_ADMIN`. Traffic from the guest is only forwarded with the guest's own MAC and addresses (anti-spoofing); everything else is dropped. Groups, policies, workload identities, egress filtering, ingress and kept addresses work unchanged, and inbound traffic reaches the guest on any port. The guest's gateway is link-local (`169.254.1.1`, `fe80::1`) on the node's pod bridge.

### Terminals, exec and files

- **Terminals and machine exec** open inside the guest through the shared `vm-exec` bridge: same API, roles and recordings as for containers ([Terminals, files and tunnels](./terminals-files-and-tunnels.md)). TTY resize works; environment values are passed without appearing in the launcher's process list; exit codes are the guest command's.
- **File browser**: browses the guest root (the replica's overlay), so files the workload wrote are visible.

### Metrics

Besides the launcher container's own `replica.cpu_cores` / `replica.memory_bytes`, the guest reports through the bridge: `replica.guest_memory_total_bytes`, `replica.guest_memory_used_bytes`, `replica.guest_cpu_steal_ratio` and `replica.guest_load1` (Prometheus: `loadweaver_replica_guest_…`; only while the readings are at most 60 s old). Nodes add `node.vmroot_cache_bytes` and `node.vmroot_layers` for the unpack cache. See [Metrics](./metrics.md).

### Image policies and scans

[Image policies](./image-policies.md) apply to the **original image** (the guest image), not to the launcher: signatures are checked at plan time, and the node scans the guest image with Trivy before the first start and rescans it daily. Images with a nested root file system (Agenstra's microVM images) declare it with the label `io.forepath.scan.nested-rootfs` (an absolute path such as `/guest`); the scanner extracts that tree with the unpack rules and merges its findings into the image's scan.

## Protocol safety

The isolation fields (`isolation`, `devices`, `microvm`) are only sent to agents that advertise the matching protocol features; the scheduler never places such a workload on an older agent ("no eligible node has an agent with the protocol features … update the node agents"). If the control plane would still send one to an agent that can't take it, the message is refused and dropped instead of being sent without the field (a weaker container would start otherwise); the node keeps its previous desired state. Each refusal is recorded as a `node-protocol-refused` event (at most one a minute per node, message and field) and raises the critical built-in alert **`builtin:node-protocol-refused`** ([Alerting](./alerting.md#built-in-alerts)): update the node's agent or move the workload away.

## Limits

- **Migration**: `sandboxed-kvm` services migrate with a gVisor checkpoint restored on the same KVM platform (`stop-and-copy (gVisor KVM)`). Generic microVMs **live-migrate** like other workloads, shown in the plan as `microvm-live (QEMU)` — with or without filesystem volumes; see [live migration of microVMs](./migration.md#microvms). They fall back to a short stop (stateful) or blue / green (stateless) only when a node can't: its launcher lacks virtio-fs state migration (QEMU 10.0+, virtiofsd 1.13+; reported as `capabilities.microvmMigration`), the microVM level isn't ready there, or the usual checks fail (synchronous volume replicas, freeze budget). Bundled microVMs (Agenstra's images) live-migrate as well when their image's launcher declares it (label `io.forepath.microvm.migration` with `bundled`, images built on this release's launcher) and both nodes' agents report `capabilities.microvmBundledMigration`; they keep their processes, memory and files, but use QEMU's user-mode network, so **the guest's open TCP connections are reset** by the move (plan: `microvm-live (QEMU; guest connections reset: user-mode networking)`; see [bundled microVMs](./migration.md#bundled-microvms)). Older bundled images move with a short stop or blue / green. MicroVMs boot with the host CPU model, so they live-migrate only between nodes with identical CPUs. See [Migration](./migration.md) and, for full VMs, [live migration of VMs](./virtual-machines.md#live-migration).
- `/dev/kvm` device access is only for `runc` services and pins them to their node for migration.
- MicroVMs need nodes with usable KVM: bare metal, or VMs with nested virtualization.

## Related

- [Virtual machines](./virtual-machines.md): full VMs (`kind: VirtualMachine`) on the same KVM base
- [Host requirements](../deployment/host-requirements.md#isolation-levels-kvm-and-microvms)
- [Nodes and joining](./nodes-and-joining.md)
- [Deployments and jobs](./deployments-and-jobs.md#isolation-level)
- [Agenstra's isolation levels](../../agenstra/features/container-isolation.md)
