# Agenstra E2E isolation lab

Real virtual machines for the container isolation parts that unit tests and Docker Desktop cannot cover:
persistent gVisor, gVisor on its KVM platform (`sandboxed-kvm`), the real egress guard with its netfilter
rules, name resolution, and the real host preparation scripts. QEMU/KVM runs **inside Docker containers**, so
nothing is installed on the lab host.

The VMs are prepared like provisioned agent manager hosts:

- **Image:** pinned Ubuntu 22.04 cloud image (`ISOLATION_LAB_UBUNTU_IMAGE`, sha256-checked).
- **Docker:** installed with `get.docker.com`, like the Agenstra providers do.
- **gVisor:** not in the image. Each spec installs it with the real cloud-init block (`buildGvisorInstallScript()`) or the committed host script (`apps/agenstra/backend-agent-manager/host/agenstra-gvisor.sh`).

The specs drive the guest's Docker through the agent manager's own services (`DockerService`,
`IsolationCapabilitiesService`, egress guard rendering) over a tunnelled Docker socket. So runtime
selection, probes and guard configuration use the production code paths.

## Requirements

- **Docker with `/dev/kvm` available to containers.** Linux Docker or Docker Desktop on WSL2 both work. Check with:
  `docker run --rm --device /dev/kvm debian:trixie-slim ls -l /dev/kvm`.
- **Nested virtualization** on the lab host, for the `sandboxed-kvm` scenarios. Each lab VM gets `-cpu host`, so the guest has `/dev/kvm` itself. Without it the KVM scenarios fail unless `ISOLATION_LAB_ALLOW_NO_KVM=1` is set; in that case they are skipped and a visible warning is printed. They never pass silently.
- **`ssh-keygen`** on the lab host. SSH itself runs inside the VM containers.
- **Internet access** for the Ubuntu image, Docker, gVisor, the base images, and the guard / DNS checks (`example.com` allowed, `example.org` denied).
- **Resources:**

  | Resource      | Need                                                            |
  | ------------- | --------------------------------------------------------------- |
  | Memory per VM | 3 GiB guest + 768 MiB for QEMU. The networking spec uses 4 GiB. |
  | VMs at a time | One at a time                                                   |
  | Disk          | Golden image about 2 GB, plus a per-run overlay                 |

## Usage

```bash
npx nx run agenstra-backend-feature-isolation-lab:isolation-lab                                  # every *.isolation-lab.spec.ts (slow, explicit only)
npx nx run agenstra-backend-feature-isolation-lab:isolation-lab -- networking                    # one spec (Jest path pattern)
npx nx run agenstra-backend-feature-isolation-lab:isolation-lab -- --case 'idempotent' host-prep # single cases (Jest -t)
npx nx run agenstra-backend-feature-isolation-lab:isolation-lab -- --keep microvm                # keep the VM, re-attach next run (dev only)
npx nx run agenstra-backend-feature-isolation-lab:isolation-lab-cleanup                          # leftovers of aborted runs
bash libs/domains/agenstra/backend/feature-isolation-lab/src/integration/cleanup.sh --golden     # also golden + QEMU images
npx nx test agenstra-backend-feature-isolation-lab                                               # unit tests of the lab configuration only
```

The lab target is deliberately not called `e2e`, because PR CI runs every `e2e` target automatically. It runs
in band and is never cached. Since 2026-10-26 it uses the shared runner `run-lab.sh` like Loadweaver's VM labs
(heavy lock, memory / disk checks, watchdog, timeout, cleanup by label) and shares their fast-run model: focused
cases (`--case`), keep-alive (`--keep`, keys `isolation-lab-<vm name>`), image archives cached by image ID, a
`LabRecorder` result per VM start (`isolation-lab-<vm name>-<ts>.json` in `$VM_LAB_RESULTS_DIR`). See the shared
harness README ("Fast runs").

## Specs

| Spec                                     | What it proves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `host-preparation.isolation-lab.spec.ts` | **With nested KVM:** the provider cloud-init block installs both gVisor platforms without failing the boot script. `docker info` reports the exact runtime arguments, and runc stays the default runtime. The host script's `check --json` report and KVM facts are correct. Workloads run on every runtime, with the gVisor kernel on the gVisor runtimes and `--platform=kvm` on the KVM runtimes. Re-running `install` is idempotent. When `/dev/kvm` disappears, the stale KVM runtimes are removed and systrap is kept. The next `install` restores KVM (modules loaded and persisted). `uninstall` leaves runc working. **Without nested virtualization:** only systrap is installed and `sandboxedKvm` is `unsupported`.                                                                                                                                                                                                                                                                                           |
| `capabilities.isolation-lab.spec.ts`     | The manager's real probe on a host with the egress guard enabled and an agent network, which includes the shared-namespace and embedded-DNS checks with `runsc-kvm-hostnet`. It covers: <ul><li>every level `ready`, with `sandboxed-kvm` recommended</li><li>`E_RUNTIME_MISCONFIGURED` for a KVM runtime registered on systrap</li><li>`E_KVM_UNAVAILABLE` after losing `/dev/kvm`, with `sandboxed` still ready</li><li>the administrative switch</li><li>`E_RUNTIME_NOT_REGISTERED` on a host without nested virtualization</li></ul>                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `decabill-update.isolation-lab.spec.ts`  | A host provisioned before the isolation runtimes existed gets them, including `sandboxed-kvm` where KVM is available, from Decabill's agent manager update command (`buildAgentManagerUpdateCommand`). Running containers are not restarted, and repeated updates are idempotent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `microvm.isolation-lab.spec.ts`          | The microvm level on a host with nested KVM, using a lab microVM image built from the real `Dockerfile.worker-microvm`, launcher scripts and bridge bundles on a small Debian worker: <ul><li>the manager's real probe reports `microvm` ready and recommends it, and leaves no probe containers behind</li><li>a microVM worker created by `DockerService`: launcher hardening (`runc`, only `/dev/kvm`, `CapDrop ALL` without `NET_ADMIN` / `NET_RAW` / `SYS_ADMIN`, `no-new-privileges`), its own guest kernel, no `/dev/kvm` and no launcher files in the guest, exec as root / agent user with the managed environment, volume coherence with ownership, `docker logs`, the VMM as `agenstra-vmm`, environment updates as an in-place restart, and the recreation when it joins an egress guard</li><li>the networking matrix (default bridge, agent network, guard `off` / `monitor` / `enforce` / `offline`) with the same allow / deny and bypass checks as the other levels, run from inside the guest</li></ul> |
| `networking.isolation-lab.spec.ts`       | Every level × topology: default bridge, agent network, and egress guard in `off` / `monitor` / `enforce` / `offline`. Each scenario checks: <ul><li>the runtime chosen by `DockerService` (Netstack only on the default bridge)</li><li>the gVisor kernel as isolation evidence</li><li>DNS (public names, and container names through `127.0.0.11`)</li><li>HTTP/HTTPS through the explicit proxy and transparent interception</li><li>the guard keeping its interfaces and the loopback proxy being reachable</li><li>the platform allow (context API) in every mode</li><li>allow / deny per mode</li><li>bypass attempts: foreign resolver, IP literals, and the guard's exemption mark (`SO_MARK`, tried as root in the worker; only the connection to DoT 853 counts). IPv6 must be disabled in the guard's namespace</li></ul>                                                                                                                                                                                     |

## How it works

- **QEMU image:** `debian:trixie-slim` with QEMU and cloud-image-utils, content-addressed by its Dockerfile.
- **Golden image:** the pinned Ubuntu cloud image, booted once under QEMU and provisioned by cloud-init (Docker, a few pre-pulled images). The build only succeeds when the guest prints a marker on its serial console after a working `docker run`. The image is stored in the Docker volume `agenstra-isolation-lab-golden-<hash>`. The hash covers every pin and the provisioning, so a change builds a new image; remove old ones with `cleanup.sh --golden`.
- **VMs:**
  - **Container and disk:** one container per VM with `--device /dev/kvm` and its own memory limit. The VM runs on a qcow2 overlay of the golden image.
  - **Access:** a per-run cloud-init seed (hostname, `lab` user, per-run SSH key). QEMU user networking forwards the guest's SSH to the VM container's loopback. The test process runs `ssh` inside that container (`docker exec`), so no port is published on the lab host. That also works where published loopback ports are not reachable, as with Docker Desktop on WSL2. The private key only lives in the run volume. The guest's serial console is written to `serial.log` in the run volume.
  - **Selected options:** `-cpu host` exposes nested virtualization; `exposeVirtualization: false` (`host,-vmx,-svm`) simulates an ordinary cloud VM.
- **Manager services:** the specs use the agent manager's `DockerService`, bound to a local unix socket. Each connection to it is bridged to `docker system dial-stdio` in the guest over SSH. The egress guard image is built from `apps/agenstra/backend-agent-manager/Dockerfile.egress-guard` and loaded into the guest.
- **Cleanup:** everything carries the label `io.agenstra.isolation-lab` (`run`, `golden`, `image`).
- **Shared harness (M7.6):** process helpers, the QEMU / golden image builders, the VM itself (`startUserNetVm`), the
  Docker socket tunnel and the cleanup script come from the shared VM-lab harness
  [`libs/domains/shared/backend/util-vm-lab`](../../../shared/backend/util-vm-lab/README.md), which Loadweaver's VM lab
  uses too. The lab's pins, cloud-init, QEMU arguments and names stay here (same golden / image names as before). A
  lab run takes the machine's heavy lock (`/tmp/lw-3a.lock`) and the VM-lab lock (`/tmp/lw-vmlab.lock`), checks the
  host's available memory, keeps all VMs of the process within 7 GiB, and removes its containers on exit
  (also on Ctrl+C).

## Notes

- **Nesting depth.** On WSL2 the KVM scenarios run three levels deep: Hyper-V, then the WSL2 kernel with KVM, then the lab VM, then gVisor on KVM. That works, but it is slow. On bare-metal Linux hosts the lab VM is the only nested guest.
- **Not Vagrant.** The lab uses plain QEMU in containers rather than Vagrant, which is licensed under BUSL and is not open source.
- **Docker version in the golden image.** It is whatever `get.docker.com` installs when the golden image is built, as on provisioned hosts. The version is recorded in the guest at `/etc/agenstra-isolation-lab-golden.docker-version`. To pick up a newer Docker, rebuild with `cleanup.sh --golden`.
- **No libvirt on lab or production hosts.** gVisor's KVM platform only needs `/dev/kvm`; the microvm level ships libvirt / QEMU inside its container image.
- **MicroVM nesting.** On WSL2 the microvm spec runs microVMs four levels deep (Hyper-V, WSL2, lab VM, microVM). The lab VM gets 5 GiB and 2 vCPUs (run it alone; other lab specs and heavy builds in parallel can exhaust WSL2 memory); boots and execs are slow at that depth, so the spec uses long timeouts.
