# Container Isolation Levels

Agenstra can run agent environments with **stronger container isolation** than Docker's default. Every agent manager host offers the **standard** level (Docker's `runc`) and, when the host has been prepared for it, the **sandboxed** level, which runs the environment's worker container on **gVisor** (`runsc`) instead of directly on the host kernel. Hosts that expose hardware virtualization (`/dev/kvm`) can additionally offer **sandboxed-kvm**, which runs gVisor on its KVM platform, and **microvm**, which runs the environment as a real KVM virtual machine with its own guest kernel. The level is chosen per environment at creation time, is validated against what the host can **actually** run (real runtime probes, never configuration alone), and is never silently downgraded.

## Levels

| Level           | Rank | Docker runtime                      | Kernel boundary                                                                                     | Availability                                                                                              |
| --------------- | ---- | ----------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `standard`      | 1    | `runc` (Docker default)             | Shares the host kernel (namespaces, cgroups, seccomp, capabilities)                                 | Mandatory floor of every host; the setup every manager supported before                                   |
| `sandboxed`     | 2    | `runsc-systrap` (gVisor, `systrap`) | gVisor **Sentry** application kernel in userspace between app and host                              | Only when the gVisor runtime is registered with Docker **and** passes the probe                           |
| `sandboxed-kvm` | 3    | `runsc-kvm` (gVisor, `kvm`)         | gVisor Sentry in a hardware-virtualized address space; system calls trap into it via VM exits (KVM) | Only when the host exposes `/dev/kvm`, the KVM runtime is registered with Docker **and** passes the probe |
| `microvm`       | 4    | `runc` (launcher container)         | Own guest kernel in a KVM virtual machine (libvirt / QEMU); the VMM runs in a hardened container    | Only when the host exposes `/dev/kvm` **and** a probe microVM of the microVM image boots and passes       |

- **Higher rank means stronger isolation.** The recommended (preselected) level of a host is its strongest **ready** level.
- **gVisor is not a VM.** The Sentry implements the Linux system call interface in userspace and only uses a small, filtered set of host system calls itself. Networking is handled by gVisor's own user-space network stack (**Netstack**), file access goes through gVisor's file proxy. A kernel exploit inside the workload therefore has to break the Sentry first instead of hitting the host kernel directly.
- **`systrap` platform** The sandboxed runtime is registered with `--platform=systrap`, which intercepts system calls with seccomp and needs **no KVM / nested virtualization**. It works on ordinary cloud VMs.
- **`kvm` platform** The sandboxed-kvm runtime is registered with `--platform=kvm`. The Sentry runs in a hardware-virtualized address space and application system calls trap into it through the CPU's virtualization extensions (VM exits) instead of seccomp. It needs `/dev/kvm` on the host (bare metal, or a VM with nested virtualization). It is still gVisor, **not a full VM** (there is no hypervisor guest kernel).
- **`microvm`** The worker runs as a virtual machine with its **own Linux kernel**. The container of the environment becomes a hardened **launcher**: it runs libvirt (session mode), QEMU/KVM and virtiofsd and boots the worker filesystem as the VM. A guest kernel exploit lands in the VM, and escaping it means breaking QEMU's device model, which runs unprivileged inside a container without network or system administration capabilities. See [MicroVM level](#microvm-level).
- **Levels are probed independently.** `sandboxed-kvm` can be ready while `sandboxed` is not, and vice versa; `microvm` does not depend on gVisor at all.
- **Standard is the floor.** If the standard probe fails, the host cannot run environments at all: no level is recommended and creation fails with `503`, even if gVisor itself would work.
- Environments created before isolation levels existed are `standard` and keep running exactly as before.

## Selection

### Automatic selection

When an environment is created without an explicit level, the strongest ready level of the host is used (`selectionSource: automatic`). On a host with KVM where the microVM probe passed this is `microvm`, on a prepared host with KVM otherwise `sandboxed-kvm`, on a prepared host without KVM `sandboxed`; on any other host it is `standard`.

### Explicit choice and override

The **Create environment** dialog shows the levels as a radio group (**MicroVM (KVM)**, **Sandboxed (gVisor on KVM)**, **Sandboxed (gVisor)**, **Standard Docker**) with the recommendation preselected. The KVM and microVM options are only shown when the workspace host reports the level. Unavailable levels are disabled and show the reason reported by the host.

- Choosing the recommended level (or a stronger one) is recorded as `user-confirmed`.
- Choosing a **weaker** level than the recommendation (for example `standard` on a host where `sandboxed` is ready, `sandboxed` / `standard` on a host where `sandboxed-kvm` is ready, or any other level on a host where `microvm` is ready) is an **override**. The console asks for confirmation before submitting, the selection is recorded as `user-override` together with the selecting user, and the controller publishes an `agent.isolation_override` notification.
- An explicit level is **never replaced** by another one. If it is not ready (anymore), creation is rejected with `409 Conflict`.

### Capability revision (stale forms)

Every capability record carries a **revision** (`sha256:` content hash over Docker and kernel version, registered runtimes, probe image id and the per-level state). The console submits the revision it displayed as `capabilityRevision`. If the host's capabilities changed while the form was open (for example gVisor became unavailable), the request is rejected with `409 Conflict` and the user has to review the selection again. Requests without a revision are validated against the current state only.

### Validation chain

1. The **controller** validates the request against the host's current capabilities (`invalid-level` -> `400`, `host-not-runnable` -> `503`, `level-unavailable` / `stale-revision` -> `409`) and forwards only `isolationLevel`, the current `capabilityRevision` and the selecting user id. Client-supplied `isolationSelection` is ignored.
2. The **agent manager** re-validates with the same rules immediately before provisioning (before the egress guard or any container is created) and derives the persisted selection record itself; only `selectedBy` is taken from the controller.
3. The level is persisted on the environment (`isolation_level`, `isolation_selection`). Every later recreate (environment variable migration, configuration sync, restart paths) pins the same level, so a sandboxed, sandboxed-kvm or microvm environment never comes back on a weaker runtime (microVM launchers are always recreated from the microVM image, on `runc`, with `/dev/kvm` and the launcher capability set).

### Selection record

```json
{
  "level": "standard",
  "runtime": "runc",
  "selection": {
    "automaticSelection": "sandboxed",
    "effectiveSelection": "standard",
    "selectionSource": "user-override",
    "selectedBy": "user-uuid",
    "selectedAt": "2026-10-15T09:12:00.000Z",
    "capabilityRevision": "sha256:4f1c..."
  }
}
```

Returned as `isolation` on agent responses. `selection` is `null` for environments created before isolation levels existed.

## Failure behavior

- **No silent downgrade.** If a gVisor worker container (`sandboxed` or `sandboxed-kvm`) or a microVM (`microvm`) cannot be created or started, or never becomes healthy, the environment is **not created** and the request fails with `400`. A failed start is never retried on a weaker level; the user decides.
- The `400` body carries a machine-readable code and the level (the controller passes both through):

  ```json
  {
    "statusCode": 400,
    "error": "Bad Request",
    "message": "The sandboxed-kvm (gVisor on KVM) container could not be started: ... The environment was not created; retry or explicitly choose the standard isolation level.",
    "code": "E_ISOLATION_RUNTIME_FAILED",
    "isolationLevel": "sandboxed-kvm"
  }
  ```

  For the sandboxed level the message reads `The sandboxed (gVisor) container could not be started: ...`, for the microvm level `The microvm (KVM microVM) container could not be started: ...`.

- The controller publishes `agent.sandbox_creation_failed` for such runtime failures (not for validation errors such as a duplicate name) and refreshes the workspace's capability snapshot.
- **Re-probe after repeated failures.** The manager counts consecutive runtime failures **per gVisor or microVM level**. After `AGENT_ISOLATION_FAILURE_THRESHOLD` (default `3`) failures of a level it re-probes; a broken runtime then turns `probe-failed` and stops being offered. A successful start on that level resets its counter.
- An unreachable registry or other transient failure of the **standard** probe does not keep a host unusable until the next scheduled probe: creation re-probes when the floor is not ready.

## Capability probing

The agent manager probes which levels it can run:

- on **startup** (stale probe containers and volumes of an interrupted process are removed first; environment creation waits for the first probe),
- **periodically** every `AGENT_ISOLATION_PROBE_INTERVAL_MS` (default 6 h, ±10 % jitter, minimum 1 min; disable with `AGENT_ISOLATION_PROBE_ENABLED=false`),
- **on demand** (`POST /api/isolation/probe`; joins a running probe and reuses results younger than 30 s),
- after **repeated runtime failures** of a gVisor or microVM level (see above).

Concurrent requests share one in-flight probe. The current record is served from memory; `probing: true` indicates that a probe is running and the states still reflect the previous one.

### What a probe checks

Each level is probed with short-lived containers (label `io.agenstra.isolation-probe=1`, name prefix `agenstra-isolation-probe-`) on the level's runtime, using the **real worker image** (`AGENT_ISOLATION_PROBE_IMAGE`, otherwise the configured worker image). Pulling the image does not count against the probe timeout.

1. Docker daemon reachable (`docker info`), runtime registered with Docker (gVisor levels only)
2. Container starts and actually runs on the requested runtime (`HostConfig.Runtime`)
3. Volume file operations (write, `sync`, rename, read back, delete)
4. `docker exec` exit codes are propagated, and exec as a non-root user works
5. stdout and stderr are captured in the container logs
6. **Shared network namespace** (gVisor levels only, when the egress guard is enabled): a `runc` container owns the namespace and a container on the level's hostnet runtime (`runsc-systrap-hostnet` / `runsc-kvm-hostnet`) joins it with `NetworkMode: container:<owner>`, exactly like a gVisor worker joins its egress guard
7. Everything finishes within `AGENT_ISOLATION_PROBE_TIMEOUT_MS` (default 90 s)

Each gVisor level is checked in this order; the first failing step determines its state:

1. Disabled by configuration (`disabled-by-admin`)
2. Runtime registered with Docker (`unsupported`)
3. Probe image available (`probe-failed`)
4. Hostnet runtime registered, when the egress guard is enabled (`unsupported`)
5. Runtime arguments match the level (`probe-failed` with `E_RUNTIME_MISCONFIGURED`). On every gVisor level the guard runtime must use `--network=host`. `sandboxed-kvm` additionally needs `--platform=kvm` and runtime names not used by another level.
6. Standard floor ready (`probe-failed`)
7. Full probe (steps above)

gVisor levels are only probed on top of a healthy standard floor. Presence of the `runsc` binary or a `daemon.json` entry alone never makes a level ready.

The **microvm** level is checked in this order:

1. Disabled by configuration (`AGENT_ISOLATION_MICROVM_ENABLED=false`, `disabled-by-admin`)
2. Standard floor ready (`probe-failed`, `E_RUNC_PROBE_FAILED`)
3. MicroVM image available (`AGENT_MICROVM_IMAGE`, pulled outside of the timeout; `probe-failed` with `E_PROBE_IMAGE_UNAVAILABLE`) and carrying the bridge protocol label `io.agenstra.microvm.protocol` of this manager (`unsupported` with `E_MICROVM_IMAGE_UNSUPPORTED`)
4. A probe microVM boots (`unsupported` with `E_KVM_UNAVAILABLE` when Docker cannot pass `/dev/kvm` or the launcher cannot open it, otherwise `probe-failed` with `E_MICROVM_BOOT_FAILED`)
5. The worker contract **inside the guest**: volume file operations, guest writes visible through Docker's archive API, exec exit codes, non-root exec and stdout/stderr logs
6. The guard topology: the launcher joins a `runc` owner's network namespace; the guest reaches the owner's `127.0.0.1` service through the loopback relay, resolves the owner's name through Docker's embedded DNS (agent network) and the owner keeps its interface
7. Everything finishes within `AGENT_ISOLATION_MICROVM_PROBE_TIMEOUT_MS` (default 4 min; a VM boot takes longer than a container start, especially nested)

One probe microVM covers all checks (512 MiB guest, 1 vCPU), so the probe boots a single VM. Microvm launchers run without Docker's init (`Init: false`; tini is the entrypoint). Before the microVM image is pulled, a tiny container from the probe image checks that Docker can hand `/dev/kvm` to containers, so hosts without KVM never pull the microVM image.

The microvm probe runs **after** the other levels were committed, in the background: environment creation and the API never wait for an image pull or a VM boot. Until it completes the level keeps its last known state (`E_PROBE_PENDING` right after a manager start, so `sandboxed-kvm` or `sandboxed` is recommended during the first minutes); its result is committed as a new capability revision. `probing` is `true` while it runs.

### States

| State                 | Meaning                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `ready`               | The probe passed; the level can be selected                                                                                     |
| `unsupported`         | The runtime is not registered with Docker on this host (host not prepared or no KVM)                                            |
| `installation-failed` | Reserved for host preparation that failed to install the runtime                                                                |
| `probe-failed`        | The runtime is registered but a probe step failed (or the probe has not completed yet)                                          |
| `disabled-by-admin`   | `AGENT_ISOLATION_SANDBOX_ENABLED=false` / `AGENT_ISOLATION_SANDBOX_KVM_ENABLED=false` / `AGENT_ISOLATION_MICROVM_ENABLED=false` |

### Reason codes

| Code                                    | Meaning                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `E_RUNTIME_NOT_REGISTERED`              | `AGENT_SANDBOX_RUNTIME` / `AGENT_SANDBOX_KVM_RUNTIME` is not a registered Docker runtime                                                                                                                                                                                                                                                                                                           |
| `E_RUNTIME_MISCONFIGURED`               | A runtime is registered under the expected name but contradicts the level, according to Docker's reported `runtimeArgs`. On every gVisor level the guard runtime lacks `--network=host`. For `sandboxed-kvm`, the platform is not `kvm` or a runtime name is reused by another level. Docker versions without `runtimeArgs` and runtimes registered as a containerd shim are checked by name only. |
| `E_KVM_UNAVAILABLE`                     | The KVM platform cannot open `/dev/kvm` (probe start error `opening device file for platform "kvm"...`), or Docker cannot pass `/dev/kvm` to the microVM launcher. For `microvm` the state is `unsupported`                                                                                                                                                                                        |
| `E_MICROVM_IMAGE_UNSUPPORTED`           | The configured microVM image (`AGENT_MICROVM_IMAGE`) does not carry `io.agenstra.microvm.protocol` with the bridge protocol version of this manager (state `unsupported`)                                                                                                                                                                                                                          |
| `E_MICROVM_BOOT_FAILED`                 | The probe microVM did not boot or failed the worker contract; the reason contains the last launcher log lines                                                                                                                                                                                                                                                                                      |
| `E_DOCKER_BASELINE_UNAVAILABLE`         | Docker daemon not reachable                                                                                                                                                                                                                                                                                                                                                                        |
| `E_RUNC_PROBE_FAILED`                   | Standard probe failed (also reported for gVisor levels skipped for that reason)                                                                                                                                                                                                                                                                                                                    |
| `E_PROBE_PENDING`                       | No probe has completed since the manager started                                                                                                                                                                                                                                                                                                                                                   |
| `E_PROBE_IMAGE_UNAVAILABLE`             | The probe (worker) image could not be pulled. The standard level stays `ready` (reported with this code, the Docker baseline itself is reachable); gVisor levels are withheld because they cannot be verified                                                                                                                                                                                      |
| `E_PROBE_START_FAILED`                  | The probe container could not be created or started                                                                                                                                                                                                                                                                                                                                                |
| `E_PROBE_EXEC_FAILED`                   | Exec exit codes or non-root exec failed                                                                                                                                                                                                                                                                                                                                                            |
| `E_PROBE_FILESYSTEM_FAILED`             | Volume file operations failed                                                                                                                                                                                                                                                                                                                                                                      |
| `E_PROBE_LOGS_FAILED`                   | Container logs were not captured                                                                                                                                                                                                                                                                                                                                                                   |
| `E_PROBE_RUNTIME_MISMATCH`              | The container did not run on the requested runtime                                                                                                                                                                                                                                                                                                                                                 |
| `E_PROBE_TIMEOUT`                       | The probe exceeded `AGENT_ISOLATION_PROBE_TIMEOUT_MS`                                                                                                                                                                                                                                                                                                                                              |
| `E_SHARED_NETNS_FAILED`                 | The guard topology check failed (loopback proxy unreachable or owner lost its interfaces)                                                                                                                                                                                                                                                                                                          |
| `E_SHARED_NETNS_RUNTIME_NOT_REGISTERED` | `AGENT_SANDBOX_SHARED_NETNS_RUNTIME` / `AGENT_SANDBOX_KVM_SHARED_NETNS_RUNTIME` is not registered (egress guard enabled)                                                                                                                                                                                                                                                                           |
| `E_REPEATED_RUNTIME_FAILURES`           | Reserved for runtime failures that exceeded the failure threshold                                                                                                                                                                                                                                                                                                                                  |
| `E_DISABLED_BY_ADMIN`                   | gVisor level disabled by configuration                                                                                                                                                                                                                                                                                                                                                             |
| `E_MANAGER_UNSUPPORTED`                 | Controller only: the workspace's agent manager predates isolation levels, or does not report this level (an older manager without `sandboxed-kvm` or `microvm`; missing levels are filled as `unsupported`)                                                                                                                                                                                        |

Reasons are short operator-facing texts and never contain secrets or workspace content.

## MicroVM level

The microvm level runs the environment's workload as a KVM virtual machine **without leaving Docker**: the environment is still one container, created, recreated, stopped and removed through the Docker API like every other worker. Only what runs inside it differs.

### Image layout

The microVM worker image (`agenstra-manager-worker-microvm`, Nx target `worker-microvm-container-image`, built from `Dockerfile.worker-microvm`) is a two-part image built from the regular worker image:

- **Container root = the launcher**: a clean Debian tree with libvirt (session mode), QEMU, virtiofsd, Node.js, a pinned Debian cloud kernel, an initramfs and the bridge daemon. The guest never sees this tree.
- **`/guest` = the worker**: the unchanged `agenstra-manager-worker` filesystem (`COPY --from=<worker image> / /guest/`) plus a root-owned Node.js runtime for the guest agent. It is the root filesystem of the VM.

Keeping the two apart is a security requirement: the guest's file sharing only reaches `/guest`, so nothing a compromised guest writes (even as guest root) can replace the launcher's programs, libraries or configuration. The launcher additionally refuses to start when a volume or bind ends up outside `/guest` (for example after the guest replaced a directory of `/guest` with a symlink). Archive operations of the manager (the environment file) follow paths below `/guest` that the guest can rearrange while it runs; they never target an existing launcher directory, but they are not a security boundary of their own. As a consequence, **volumes, the managed environment file and archive paths of microVM workers live below `/guest`** (the manager remaps them automatically; use `/guest/...` for manual `docker cp`). The image is about the size of the worker image plus the launcher (no layers are shared with the worker image). It is pulled lazily like the worker image: by the capability probe and on environment creation, never by cloud-init.

Custom worker images get the level by building `Dockerfile.worker-microvm` with `--build-arg WORKER_IMAGE=<custom image>`; the guest needs a Debian-compatible package manager (the build installs `nodejs`, `tini`, `python3` and `util-linux` into it) and the workload entrypoint at `/usr/local/bin/docker-entrypoint.sh` (or `AGENSTRA_MICROVM_ENTRYPOINT`). Images without the bridge label are rejected (`E_MICROVM_IMAGE_UNSUPPORTED`).

### Launcher

- **Container:** `runc` (QEMU needs the host kernel's KVM, never gVisor), `--device /dev/kvm` only, `CapDrop: ALL` plus `CHOWN`, `DAC_OVERRIDE`, `FOWNER`, `FSETID`, `SETUID`, `SETGID`, `MKNOD`, `KILL`, `SETPCAP`, `SYS_CHROOT` (a strict subset of Docker's defaults; never `NET_ADMIN`, `NET_RAW` or `SYS_ADMIN`), `no-new-privileges`, Docker's default seccomp and AppArmor profiles.
- **Processes:** the launcher script and virtiofsd run as container root with the reduced set (virtiofsd keeps only what file ownership of the guest root needs, drops `SETFCAP` and confines itself to `/guest` with its chroot sandbox). libvirtd, QEMU and the bridge daemon run as the unprivileged user `agenstra-vmm` (uid `10930`, never the egress guard's exempt uid) with the kvm group and no capabilities.
- **VM:** q35 (virt on arm64), host CPU passthrough, direct kernel boot with an initramfs, a single virtio-fs device for `/guest`, a virtio network device (QEMU user networking), a virtio-serial channel for the bridge, a virtio RNG; no USB, no display, no balloon. Memory follows the container memory limit minus 384 MiB launcher overhead (2 GiB without a limit; `AGENSTRA_MICROVM_MEMORY_MB`), vCPUs follow the container CPU quota (else all host CPUs; `AGENSTRA_MICROVM_VCPUS`).
- **Lifecycle:** `docker stop` asks the guest to stop the workload (SIGTERM, SIGKILL after 8 s), the VM powers off and the container exits with the workload's exit status. `docker logs` shows the workload's stdout/stderr; guest console messages appear on stderr, prefixed `agenstra-microvm console:` (streamed, never buffered on disk).
- **Guest root filesystem:** before boot the launcher refuses kernel filesystems (proc, sysfs, ...) mounted below `/guest`, so the guest can never reach the container's own `/proc` through virtio-fs, and any volume or bind mounted outside `/guest` (Docker resolves mount targets inside the container, so a guest that replaced a directory of `/guest` with a symlink could otherwise redirect a mount into the launcher tree on the next start).

### Exec, ports and files

- **Exec bridge.** `docker exec` would land in the launcher, so the manager rewrites every exec of a microVM worker to `/usr/lib/agenstra-microvm/vm-exec` (run as `agenstra-vmm`). The client forwards argv, user, working directory, exec-specific environment (values stay in the exec `Env`, never in argv), TTY and resize over a multiplexed, flow-controlled protocol on the virtio-serial channel to the guest agent, which runs the command with Docker's exec semantics (user / group resolution, `HOME`, exit status `128 + signal`, `127` for missing commands). `vm-exec` waits for the launcher's exec socket after a container start (up to 3 min), and control messages larger than one frame (big managed environments) are split into continuation frames (up to 8 MiB); a peer that ignores flow control is disconnected. TTY sessions run on a real pseudo terminal in the guest.
- **Ports.** The workload's ports (`AGENSTRA_MICROVM_FORWARD_PORTS`, default `4096,6080`) are served by the bridge daemon in the container's network namespace and tunnelled into the guest, so published ports, the agent network and the guard topology work unchanged.
- **Files.** The guest root is the container's `/guest` tree over virtio-fs: `docker cp`, the archive API and volumes see the guest's files and vice versa, with the guest's file ownership.

### Network

QEMU user networking (libslirp) turns every guest connection into an ordinary socket of the **launcher's network namespace**, owned by `agenstra-vmm`. The guest gets `10.0.2.15/24` with gateway `10.0.2.2`; DNS `10.0.2.3` is forwarded to the container's resolver (Docker's embedded `127.0.0.11` on the agent network). The guest's hostname, `/etc/hosts` and resolver search / options follow the container's. The launcher never creates network interfaces (no tap, no bridge), so it needs no network capability. (passt was evaluated and rejected: it always sandboxes itself in a user namespace, which Docker's default seccomp profile and Ubuntu 24.04's AppArmor userns restriction block.)

## Egress guard interaction

The [egress guard](./egress-filtering.md) sidecar always runs on Docker's default runtime (**`runc`**; it needs netfilter and `CAP_NET_ADMIN` in its network namespace). Sandboxed and sandboxed-kvm workers behind a guard join the guard's network namespace like standard workers.

gVisor's own network stack (Netstack) cannot be used in that topology: it takes over the namespace's interfaces (the guard loses its address) and bypasses the guard's netfilter rules and its loopback proxy. Sandboxed workers that share a guard's namespace therefore run on a second gVisor runtime, **`runsc-systrap-hostnet`** (`--platform=systrap --network=host`, `AGENT_SANDBOX_SHARED_NETNS_RUNTIME`): the sandbox still mediates every system call in the Sentry, but socket operations use the kernel network stack of the guard's namespace (not the host's), so the guard's rules and proxy apply unchanged. The same variant is used for sandboxed workers attached to a user-defined Docker network (`AGENT_DOCKER_NETWORK`, the default in the provided compose setup): Docker's embedded DNS (`127.0.0.11`) is implemented with netfilter rules inside the container namespace, which Netstack bypasses, so Netstack workers there could not resolve any name. Only sandboxed workers on the default bridge (no guard, no agent network) use Netstack (`runsc-systrap`). The agent manager picks the variant automatically on every create and recreate (for example when an environment later joins a guard).

The **sandboxed-kvm** level follows exactly the same rules with its own runtime pair: **`runsc-kvm-hostnet`** (`--platform=kvm --network=host`, `AGENT_SANDBOX_KVM_SHARED_NETNS_RUNTIME`) behind a guard or on the agent network, **`runsc-kvm`** (Netstack) only on the default bridge. Guard modes (`off` / `monitor` / `enforce` / `offline`), Squid, dnsmasq, iptables and the platform allow list work unchanged, because they depend on the network mode, not on the gVisor platform.

On hosts with the guard enabled, a gVisor level is only `ready` when both of its runtimes are registered and the probe verified the guard topology with the hostnet runtime: a default-runtime container serves on `127.0.0.1` in its namespace, the gVisor member must reach it there, the owner must keep its interfaces, and Docker's embedded DNS must resolve on the agent network.

**MicroVM workers** behind a guard join the guard's namespace like every other worker (the launcher is a `runc` container). Because the guest's traffic leaves as the launcher's own sockets in that namespace, the guard's NAT redirects to Squid / dnsmasq, its rejects and its uid / mark exemptions apply exactly as for `runc` workers; a guest cannot set the guard's exemption mark on the launcher's sockets. Guarded workers reach the guard's explicit proxy as `127.0.0.1:3128`: the guest agent relays the guest's `127.0.0.1:3128` (`AGENSTRA_MICROVM_LOOPBACK_PORTS`) to the namespace's loopback. The launcher never takes the guard's interfaces over (no Netstack, no taps).

## Legacy agent managers

Agent managers that predate isolation levels have no `/api/isolation` endpoint and run every environment on `runc`. The controller treats them as **standard-only**: the workspace summary reports `supported: false`, `sandboxed`, `sandboxed-kvm` and `microvm` as `unsupported` (`E_MANAGER_UNSUPPORTED`), an explicit level request other than `standard` is rejected with `409`, and environments are created on `runc` as before. Managers that support isolation levels but predate `sandboxed-kvm` or `microvm` do not report those levels; the controller fills them as `unsupported` (`E_MANAGER_UNSUPPORTED`). Upgrade the manager (and prepare the host) to offer the stronger levels.

### Upgrading to the sandboxed-kvm level

- **Rollout order:** update the agent console and the agent controller together, and update the agent managers afterwards. An older console does not know `sandboxed-kvm`. If it shows the capabilities of a manager that recommends `sandboxed-kvm`, it preselects no level and does not ask for confirmation before a weaker level is chosen. The server still records such a choice as `user-override` and publishes `agent.isolation_override`.
- **Open forms:** the capability revision of every upgraded manager changes once, because the record now contains the `sandboxed-kvm` level. Create Environment dialogs that were already open are rejected once with `409` (stale revision) and have to be reviewed again.
- **Host preparation:** re-running `agenstra-gvisor.sh install` on an existing host adds the KVM runtimes when the host exposes hardware virtualization. The systrap runtimes and running environments are not affected.

### Upgrading to the microvm level

- **Rollout order:** as for `sandboxed-kvm`: console and controller first, then the agent managers. Consoles without the level do not preselect `microvm` and do not confirm a weaker choice; the server still records it as `user-override`.
- **Open forms:** the capability revision of every upgraded manager changes once (new level and the microVM image id are part of it).
- **Hosts:** no new host packages. Hosts that already offer `sandboxed-kvm` have `/dev/kvm`; the manager pulls the microVM image (`AGENT_MICROVM_IMAGE`) on its first probe. Release builds publish `ghcr.io/forepath/agenstra-manager-worker-microvm` next to the worker image.
- **Database:** the controller migration `1793100000000_AddClientIsolationSnapshotMicrovmState` adds the nullable snapshot column `microvm_state`.

## API

### Agent manager

- `GET /api/isolation` - Current capability record (`HostIsolationCapabilitiesDto`)
- `POST /api/isolation/probe` - Re-probe now (joins a running probe; results younger than 30 s are reused)
- `GET /api/config` - Includes `isolation` (same record)
- `POST /api/agents` - Accepts `isolationLevel`, `capabilityRevision`, `isolationSelection` (only `selectedBy` is used); `400` invalid level or gVisor / microVM start failure (`code: E_ISOLATION_RUNTIME_FAILED`), `409` unavailable level or stale revision, `503` host cannot run environments
- `GET /api/agents`, `GET /api/agents/:id` - Include `isolation` (`level`, `runtime`, `selection`); `level` can be `sandboxed-kvm` with `runtime` `runsc-kvm` or `runsc-kvm-hostnet`, or `microvm` with `runtime` `runc` (the launcher container)

`HostIsolationCapabilitiesDto` (`levels` always contains `standard`, `sandboxed`, `sandboxed-kvm` and `microvm`):

```json
{
  "revision": "sha256:4f1c...",
  "probedAt": "2026-10-15T09:00:00.000Z",
  "probing": false,
  "levels": {
    "standard": { "rank": 1, "runtime": "runc", "state": "ready" },
    "sandboxed": { "rank": 2, "runtime": "runsc-systrap", "state": "ready" },
    "sandboxed-kvm": { "rank": 3, "runtime": "runsc-kvm", "state": "ready" },
    "microvm": { "rank": 4, "runtime": "runc", "state": "ready" }
  },
  "recommendedLevel": "microvm",
  "availableLevels": ["microvm", "sandboxed-kvm", "sandboxed", "standard"]
}
```

### Agent controller

- `GET /api/clients/:id/isolation` - Workspace isolation summary (`clients:read` and workspace access); falls back to the last stored snapshot (`stale: true`) when the manager is unreachable
- `POST /api/clients/:id/isolation/probe` - Re-probe the workspace host (`clients:write` and workspace management access)
- `GET /api/clients`, `GET /api/clients/:id` - Include `isolation` (summary) next to `config`
- `POST /api/clients/:id/agents` - Accepts `isolationLevel` and `capabilityRevision`; same status codes as the manager

`ClientIsolationSummaryDto` carries the manager record (`levels`, `recommendedLevel`, `availableLevels`, `revision`, `probedAt`, `probing`) plus `supported` (`false` for legacy managers, `revision` is then `null`) and `stale`. See the OpenAPI specifications for the full schemas.

## Notifications

The controller keeps the last observed capability record per workspace (`client_isolation_snapshots`) and publishes **transitions** as [webhook](./webhooks.md) events. Snapshots are updated whenever capabilities are fetched (workspace responses, `GET`/`POST` isolation endpoints, failed gVisor creations) and by the background job **`isolation-capabilities`** (coordinator + per-workspace unit job, oldest snapshots first). Only completed probes are recorded; a conditional update ensures each transition is published once even with several controller instances. The sandboxed-kvm and microvm states are stored in their own columns (`sandboxed_kvm_state`, `microvm_state`, nullable for snapshots taken before a level existed).

| Event                               | When                                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `isolation.sandbox_available`       | The sandboxed level of a workspace host became `ready`                                                 |
| `isolation.sandbox_unavailable`     | The sandboxed level was `ready` and is not anymore                                                     |
| `isolation.sandbox_kvm_available`   | The sandboxed-kvm level of a workspace host became `ready`                                             |
| `isolation.sandbox_kvm_unavailable` | The sandboxed-kvm level was `ready` and is not anymore                                                 |
| `isolation.microvm_available`       | The microvm level of a workspace host became `ready`                                                   |
| `isolation.microvm_unavailable`     | The microvm level was `ready` and is not anymore                                                       |
| `isolation.baseline_failed`         | The standard floor is not `ready` (host cannot run environments); once per new state                   |
| `agent.isolation_override`          | An environment was created with a weaker level than recommended                                        |
| `agent.sandbox_creation_failed`     | A sandboxed, sandboxed-kvm or microvm environment could not be started (not retried on a weaker level) |

## Host preparation

The sandboxed level needs the gVisor runtimes registered with Docker on the agent manager host; the sandboxed-kvm level additionally needs `/dev/kvm` and the KVM runtimes. Docker's **default runtime stays `runc`**; gVisor is added as additional runtimes that only the agent manager selects explicitly per container. Host preparation is shared by the cloud-init script and the standalone script (`libs/domains/shared/backend/util-container-runtime`; the standalone script is generated with `nx run shared-backend-util-container-runtime:generate-host-script`).

### Provisioned servers

Servers provisioned by Agenstra (Hetzner Cloud, DigitalOcean) and Decabill-provisioned hosts prepare container isolation in their cloud-init script after Docker is installed:

1. Prepare **KVM** (`/dev/kvm`, see below) first and independently of gVisor: the microvm level needs only `/dev/kvm`, so neither a failed gVisor installation nor `GVISOR_KVM=0` withholds it
2. Download a **pinned** gVisor release (`GVISOR_RELEASE`) and verify its **checksums**
3. Register the runtimes `runsc-systrap` (`--platform=systrap`) and `runsc-systrap-hostnet` (`--platform=systrap --network=host`) with `runsc install` (merges into `/etc/docker/daemon.json`; the default runtime is not changed) and reload Docker
4. Verify the runtimes with a test container
5. On any failure, **roll back** the gVisor installation and runtime registration
6. Only when the systrap runtimes succeeded: register the **gVisor KVM runtimes** (see below)

Host preparation never fails provisioning: the `runc` floor is always preserved, and the manager simply reports the gVisor levels as `unsupported` or `probe-failed`.

**Updates:** Decabill-provisioned agent manager hosts also refresh this preparation with every scheduled update. The refresh only reloads Docker and never fails the update. Hosts provisioned before a level existed therefore receive it without being re-provisioned. The manager picks up new runtimes when it starts, so right after an update that recreated it. If the update did not change any image, it picks them up at its next scheduled probe. To see them immediately, use **Re-check isolation** (or `POST /api/isolation/probe`).

**User data size:** the preparation adds to the cloud-init user data, which providers limit. Hetzner Cloud rejects a submitted `user_data` string longer than 32768 characters. The Agenstra provider checks the base64 string it submits, and Decabill submits plain text. DigitalOcean allows 64 KiB.

### KVM platform

Before anything else, the preparation detects hardware virtualization: the `vmx` / `svm` CPU flag (x86_64; on aarch64 the presence of `/dev/kvm` is the signal), `/dev/kvm`, loaded modules, the nested virtualization state and the `hypervisor` CPU flag (the host itself is a VM).

1. If `/dev/kvm` is missing but the CPU supports virtualization, load `kvm` and `kvm_intel` / `kvm_amd` with `modprobe`; only if that fails on apt-based systems, install `linux-modules-extra-$(uname -r)` and retry. The modules are persisted in `/etc/modules-load.d/agenstra-kvm.conf`.
2. After the systrap runtimes are installed and only when `/dev/kvm` is usable, register `runsc-kvm` (`--platform=kvm`) and `runsc-kvm-hostnet` (`--platform=kvm --network=host`) and smoke-test both (`hello-world`, `--network=none`).
3. On failure, roll back **only** the KVM runtimes (own backup `/etc/docker/daemon.json.agenstra-gvisor-kvm.bak`); the systrap runtimes and `runc` stay untouched. Stale KVM runtimes are unregistered when KVM is no longer available.

The KVM steps are never fatal. `GVISOR_KVM=0` skips only the gVisor KVM runtimes (generator option `kvm: false`); `AGENSTRA_KVM=0` skips the host KVM preparation as well. `uninstall` removes the runtime registrations but keeps the persisted KVM modules, which the microvm level needs without gVisor. No libvirt, QEMU or other hypervisor stack is installed **on the host**: gVisor's KVM platform only needs `/dev/kvm`, and the microvm level ships libvirt / QEMU inside its container image. A host-level libvirt daemon was rejected because it adds a privileged daemon, its own bridge / NAT rules next to Docker's and the egress guard's, attack surface and patch burden, and its VMs would bypass the egress guard topology.

**MicroVM level:** needs nothing beyond `/dev/kvm` from the KVM step, also on hosts where gVisor cannot be installed (unsupported kernel or architecture, failed download): `install` and cloud-init prepare KVM first. The launcher container gets `/dev/kvm` from Docker; the microVM image is pulled by the manager.

Hetzner Cloud servers and DigitalOcean droplets normally do **not** expose `/dev/kvm`, so `sandboxed-kvm` and `microvm` usually report `unsupported` there. Dedicated / bare-metal hosts or VMs with nested virtualization can offer them.

### Existing hosts

Use the standalone script `apps/agenstra/backend-agent-manager/host/agenstra-gvisor.sh` (run as root on the Docker host):

```bash
sudo ./agenstra-gvisor.sh check            # report Docker baseline, runtime registration and KVM facts
sudo ./agenstra-gvisor.sh install          # install pinned gVisor, register the systrap (and, with KVM, the KVM) runtimes; rolls back on failure
sudo ./agenstra-gvisor.sh uninstall        # remove the runtime registrations (binaries stay under /usr/local/lib/agenstra-gvisor)
sudo ./agenstra-gvisor.sh check --json     # machine-readable output
sudo GVISOR_KVM=0 ./agenstra-gvisor.sh install   # skip the gVisor KVM runtimes (/dev/kvm is still prepared)
sudo AGENSTRA_KVM=0 GVISOR_KVM=0 ./agenstra-gvisor.sh install   # skip every KVM step
```

For the standalone script, `GVISOR_RELEASE` overrides the pinned release and then requires `GVISOR_SHA512` (the archive checksum for the host architecture); cloud-init always installs the pinned release. After installing, trigger **Re-check isolation** (Update Workspace modal) (or `POST /api/isolation/probe`) instead of waiting for the next scheduled probe. The script registers both systrap runtimes (`runsc-systrap` and `runsc-systrap-hostnet`) and, when KVM is usable, both KVM runtimes (`runsc-kvm` and `runsc-kvm-hostnet`); if you register them under other names, set `AGENT_SANDBOX_RUNTIME` / `AGENT_SANDBOX_SHARED_NETNS_RUNTIME` / `AGENT_SANDBOX_KVM_RUNTIME` / `AGENT_SANDBOX_KVM_SHARED_NETNS_RUNTIME` accordingly. The standalone script only reloads Docker (runtimes are reloadable); it never restarts a running host.

`check` and `install` print `Sandboxed KVM (runsc-kvm, runsc-kvm-hostnet): <state>` and `KVM: cpu=.. device=.. module=.. nested=.. hypervisor=..`. With `--json` the output adds `kvmRuntime`, `kvmSharedNetnsRuntime`, `sandboxedKvm` (`registered`, `ready`, `not-registered` when `/dev/kvm` is present but the runtimes are missing, `unsupported` without `/dev/kvm`) and `kvm` (`cpu`: `yes` / `no` / `unknown`, `device`: `present` / `absent`, `module`: `loaded` / `absent`, `nested`: `yes` / `no` / `unknown`, `hypervisor`: `yes` / `no`). Exit codes are unchanged and only reflect the systrap runtimes.

Host requirements for the sandboxed level: Linux kernel **5.6 or newer**, **x86_64** or **arm64**, cgroup v2 recommended. The sandboxed-kvm and microvm levels additionally need hardware virtualization exposed to the host (`/dev/kvm`; Intel VT-x / AMD-V, or nested virtualization in a VM). See [System Requirements](../deployment/system-requirements.md).

## Configuration

### Agent manager

| Variable                                   | Default                                                   | Description                                                                                                             |
| ------------------------------------------ | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `AGENT_SANDBOX_RUNTIME`                    | `runsc-systrap`                                           | Docker runtime name of the sandboxed level (`[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}`; invalid values fall back to the default) |
| `AGENT_SANDBOX_SHARED_NETNS_RUNTIME`       | `runsc-systrap-hostnet`                                   | gVisor runtime (`--network=host`) for sandboxed workers sharing their egress guard's network namespace                  |
| `AGENT_ISOLATION_SANDBOX_ENABLED`          | `true`                                                    | `false` disables the sandboxed level (`disabled-by-admin`)                                                              |
| `AGENT_SANDBOX_KVM_RUNTIME`                | `runsc-kvm`                                               | Docker runtime name of the sandboxed-kvm level (same charset validation as `AGENT_SANDBOX_RUNTIME`)                     |
| `AGENT_SANDBOX_KVM_SHARED_NETNS_RUNTIME`   | `runsc-kvm-hostnet`                                       | gVisor KVM runtime (`--network=host`) for sandboxed-kvm workers behind an egress guard or on the agent network          |
| `AGENT_ISOLATION_SANDBOX_KVM_ENABLED`      | `true`                                                    | `false` disables the sandboxed-kvm level (`disabled-by-admin`)                                                          |
| `AGENT_ISOLATION_MICROVM_ENABLED`          | `true`                                                    | `false` disables the microvm level (`disabled-by-admin`)                                                                |
| `AGENT_MICROVM_IMAGE`                      | `ghcr.io/forepath/agenstra-manager-worker-microvm:latest` | Image of microVM workers (used instead of the agent provider's worker image) and of the microvm probe                   |
| `AGENT_ISOLATION_MICROVM_PROBE_TIMEOUT_MS` | `240000`                                                  | Upper bound of the microvm probe, including the VM boot (minimum `30000`)                                               |
| `AGENT_ISOLATION_PROBE_ENABLED`            | `true`                                                    | `false` disables the periodic re-probe (startup, on-demand and failure-triggered probes still run)                      |
| `AGENT_ISOLATION_PROBE_INTERVAL_MS`        | `21600000` (6 h)                                          | Periodic re-probe interval (minimum `60000`)                                                                            |
| `AGENT_ISOLATION_PROBE_TIMEOUT_MS`         | `90000`                                                   | Upper bound of a single level probe (minimum `5000`)                                                                    |
| `AGENT_ISOLATION_PROBE_IMAGE`              | worker image                                              | Probe image; empty uses `OPENCODE_AGENT_DOCKER_IMAGE` / `AGENT_DEFAULT_IMAGE`                                           |
| `AGENT_ISOLATION_FAILURE_THRESHOLD`        | `3`                                                       | Consecutive runtime failures of a gVisor or microVM level that trigger a re-probe (counted per level)                   |

The manager needs the Docker socket (as for agent containers). It does not need access to `daemon.json`, the `runsc` binary or `/dev/kvm`; host preparation is done outside the manager container.

The microVM image reads these launcher settings from its environment (image defaults; they are not handed to the guest): `AGENSTRA_MICROVM_ENTRYPOINT` (`/usr/local/bin/docker-entrypoint.sh`), `AGENSTRA_MICROVM_USER` (workload user, default root), `AGENSTRA_MICROVM_FORWARD_PORTS` (`4096,6080`), `AGENSTRA_MICROVM_LOOPBACK_PORTS` (`3128`), `AGENSTRA_MICROVM_MEMORY_MB`, `AGENSTRA_MICROVM_VCPUS` and `AGENSTRA_MICROVM_STOP_GRACE` (`8`).

### Agent controller

| Variable                             | Default  | Description                                 |
| ------------------------------------ | -------- | ------------------------------------------- |
| `ISOLATION_CAPABILITIES_INTERVAL_MS` | `900000` | Coordinator interval (`0` disables the job) |
| `ISOLATION_CAPABILITIES_BATCH_SIZE`  | `25`     | Workspaces refreshed per coordinator run    |

See [Background Jobs](../deployment/background-jobs.md).

## Limitations and performance

- **Compatibility** gVisor implements most, but not all, of the Linux system call surface. Known gaps relevant to agent workloads: no `io_uring`, no `iptables` / netfilter configuration inside the sandbox, no KVM (no nested VMs or emulators that need `/dev/kvm`), limited FUSE support, and **Docker-in-Docker** or other container runtimes inside the environment are not supported. Tools that need raw kernel features (eBPF, kernel modules, `perf`) do not work. These limitations apply to `sandboxed-kvm` as well (gVisor on KVM does not expose `/dev/kvm` inside the sandbox either). Use the `standard` level (an explicit, confirmed override) for such environments.
- **Performance** CPU-bound work runs at near-native speed. System-call-heavy work is slower: filesystem **metadata** operations (`npm install`, `git status` on large trees, builds touching many small files) and **network** throughput through Netstack show noticeable overhead. Expect slower dependency installs and builds than on `runc`.
- **KVM platform performance** `sandboxed-kvm` is fastest on bare metal. Under nested virtualization every VM exit is expensive, so it can be slower than systrap for system-call- and network-heavy work (with the hostnet runtimes every socket system call is a host system call from the Sentry). It is still recommended automatically when ready; users who prefer systrap choose `sandboxed` (recorded as an override).
- **Memory** The Sentry and gofer processes add some memory overhead per environment.
- **Not a VM boundary** gVisor substantially reduces the host kernel attack surface but is not a full VM, also on the KVM platform (no hypervisor guest kernel); it complements, and does not replace, non-root workloads, the egress guard and host hardening. Use `microvm` where a VM boundary is required.
- **MicroVM boot and overhead** A microVM environment boots a kernel before the workload starts (about 2 to 5 s on bare metal or one nesting level, longer under deeper nesting). The launcher takes about 384 MiB on top of the guest memory, and every `docker exec` pays roughly 0.2 s for the bridge client. Environment updates that restart a worker in place (for example the configuration sync right after creation) reboot the guest: for about 10 s file operations, exec and terminals of that environment are unavailable and commands running at that moment are ended, where a `runc` restart takes about a second. Under nested virtualization (a cloud VM exposing `/dev/kvm`) VM exits are expensive and I/O-heavy work is noticeably slower.
- **MicroVM compatibility** The guest runs a full Linux kernel, so `io_uring`, eBPF, FUSE and `iptables` inside the guest work; there is no nested KVM inside the guest. Paths of volumes and archives are below `/guest` (see above). Ports below 1024 cannot be forwarded (the bridge daemon is unprivileged). Checkpoint / restore of microVM environments is not supported.
- The egress guard sidecar always runs on `runc`; only the agent worker container is sandboxed. Guarded gVisor workers use the namespace's kernel network stack (`runsc-systrap-hostnet` / `runsc-kvm-hostnet`) instead of Netstack, so the network part of the sandbox is weaker than for unguarded workers (the guard's namespace, not the host network, is exposed).
- The level is fixed at creation. To change it, create a new environment with the desired level.
- `installation-failed` and `E_REPEATED_RUNTIME_FAILURES` are reserved values; the current manager reports host preparation problems as `unsupported` / `probe-failed`.

## Troubleshooting

| Symptom                                                        | Check                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sandboxed level shows `unsupported`                            | Host not prepared or runtime registered under another name: run `agenstra-gvisor.sh check`, `docker info --format '{{json .Runtimes}}'`, compare with `AGENT_SANDBOX_RUNTIME`                                                                                              |
| `E_PROBE_IMAGE_UNAVAILABLE` (sandboxed withheld)               | Registry unreachable or wrong `AGENT_ISOLATION_PROBE_IMAGE`; fix and **Re-check isolation**                                                                                                                                                                                |
| Sandboxed KVM level shows `unsupported`                        | No `/dev/kvm` (typical on cloud VMs without nested virtualization) or KVM runtimes not registered: run `agenstra-gvisor.sh check` (`KVM:` line), compare `docker info` runtimes with `AGENT_SANDBOX_KVM_RUNTIME`                                                           |
| `probe-failed` with `E_KVM_UNAVAILABLE`                        | The KVM platform cannot open `/dev/kvm`: check that the device exists and is accessible to Docker, load `kvm` / `kvm_intel` / `kvm_amd`, enable nested virtualization on VMs                                                                                               |
| `probe-failed` with `E_RUNTIME_MISCONFIGURED`                  | A gVisor runtime is registered with the wrong platform or network mode (e.g. a guard runtime without `--network=host`), or `sandboxed-kvm` reuses another level's runtime name. Re-run `agenstra-gvisor.sh install` or fix the `runtimeArgs` in `/etc/docker/daemon.json`. |
| `probe-failed` with `E_SHARED_NETNS_FAILED`                    | gVisor release too old or misconfigured for shared namespaces; reinstall with the pinned release                                                                                                                                                                           |
| `probe-failed` with `E_PROBE_TIMEOUT`                          | Host overloaded or slow storage; raise `AGENT_ISOLATION_PROBE_TIMEOUT_MS`                                                                                                                                                                                                  |
| Creation fails with `409`                                      | Capabilities changed while the dialog was open (stale revision) or the chosen level is no longer ready; reopen the dialog and review                                                                                                                                       |
| Creation fails with `503`                                      | Standard (`runc`) baseline failed: check Docker on the host (`E_DOCKER_BASELINE_UNAVAILABLE`, `E_RUNC_PROBE_FAILED`)                                                                                                                                                       |
| "sandboxed (gVisor) container could not be started"            | Workload incompatible with gVisor or runtime broken; check `docker logs` of the manager, retry, or create the environment as `standard`                                                                                                                                    |
| "sandboxed-kvm (gVisor on KVM) container could not be started" | Same as above, or KVM became unavailable; retry, or explicitly choose `sandboxed` or `standard`                                                                                                                                                                            |
| MicroVM level shows `unsupported` (`E_KVM_UNAVAILABLE`)        | No `/dev/kvm` on the host (see the KVM platform checks above); `docker run --rm --device /dev/kvm debian:trixie-slim ls -l /dev/kvm` must work on the host                                                                                                                 |
| MicroVM level shows `E_MICROVM_IMAGE_UNSUPPORTED`              | `AGENT_MICROVM_IMAGE` points at an image without the microVM bridge (for example the regular worker image) or one built for another manager release; use the matching `agenstra-manager-worker-microvm` tag                                                                |
| `probe-failed` with `E_MICROVM_BOOT_FAILED`                    | The reason shows the last launcher lines. Check `docker logs` of a microVM worker (`agenstra-microvm:` lines and the guest console); under deep nesting raise `AGENT_ISOLATION_MICROVM_PROBE_TIMEOUT_MS`                                                                   |
| "microvm (KVM microVM) container could not be started"         | The VM did not boot or the workload never became healthy; check `docker logs` of the worker, retry, or explicitly choose a weaker level                                                                                                                                    |
| Summary shows `stale: true`                                    | The agent manager is unreachable; the last stored snapshot is shown                                                                                                                                                                                                        |
| Leftover `agenstra-isolation-probe-*` containers               | Removed automatically on the next manager start                                                                                                                                                                                                                            |

## Validation and testing

- The KVM platform was validated with gVisor `20261005.0` on WSL2 / Docker Desktop with `/dev/kvm` (2026-10-22): both runtimes start, HTTP and DNS work, a hostnet member reaches a `runc` owner's `127.0.0.1` while the owner keeps `eth0`, and Docker's embedded DNS works with the hostnet runtime. Netstack in the owner's namespace removes the owner's interfaces, which is why the hostnet mapping is mandatory.
- The registered runtime arguments are part of the probe when Docker reports them. A `sandboxed-kvm` runtime must use `--platform=kvm`. The runtime used behind an egress guard must use `--network=host`, on every gVisor level. A `sandboxed-kvm` runtime name must not reuse another level's runtime. Otherwise the level reports `E_RUNTIME_MISCONFIGURED`. Configure distinct runtime names: the runtime variables are trusted on environment recreation, which is not gated by a probe.
- The microvm level was validated on WSL2 / Docker Desktop 29.8 with `/dev/kvm` (2026-10-22, Debian trixie: libvirt 11.3, QEMU 10.0, virtiofsd 1.13, kernel 6.12 cloud) under the hardened launcher profile: guest root semantics (`useradd`, `chown`, `runuser`, `mknod`), its own `/proc`, no `/dev/kvm` in the guest, guest HTTP caught by a `runc` owner's NAT redirect and HTTPS by its reject, the owner's loopback reachable while it keeps its interface, container names resolved through `127.0.0.11`, and `docker cp` coherence in both directions within about one second. The guest kernel was up in about 2.4 s.
- An end-to-end **isolation lab** (QEMU/KVM VMs inside Docker containers) is run explicitly with `nx run agenstra-backend-feature-isolation-lab:isolation-lab`; see the [isolation lab README](../../../libs/domains/agenstra/backend/feature-isolation-lab/README.md). Its microvm spec runs microVMs nested inside a lab VM.

## Related documentation

- **[Agent Management](./agent-management.md)** Creating environments
- **[Client Management](./client-management.md)** Workspace isolation summary
- **[Server Provisioning](./server-provisioning.md)** gVisor host preparation
- **[Egress Filtering](./egress-filtering.md)** Egress guard sidecar
- **[Webhooks](./webhooks.md)** Isolation notifications
- **[Backend Agent Manager](../applications/backend-agent-manager.md)** `/isolation`, `/isolation/probe`

---

_Diagram: `libs/domains/agenstra/backend/feature-agent-controller/docs/isolation-capabilities.mmd`._
