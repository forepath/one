# Shared VM-lab harness (`@forepath/shared/backend/util-vm-lab`)

Real VMs (QEMU/KVM inside Docker containers, nothing installed on the host) for tests that containers can't cover:
kernel modules, reboots, crashes, gVisor on KVM, microVMs and full VMs inside the lab VMs (nested KVM). Test-only:
Loadweaver's VM lab (`feature-node-agent/src/integration/vm-lab`) and Agenstra's isolation lab
(`feature-isolation-lab`) use it. Importing the library has no side effects.

## What it provides

| Module                   | What                                                                                                                                                                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `switch-lab.ts`          | `startSwitchLab`: several VMs behind a switch container (one bridge per site, taps, routing, netem, NAT); per VM `exec` / `copyIn` / `copyOut` / `reboot` / `crash` / `start` / `wipe`, plus `nestedKvm()`, `dockerSocket()`, `forward(port)`. `nested` (default on) and `cpuFlags` per VM. |
| `user-net-vm.ts`         | `startUserNetVm`: one VM with QEMU user networking, ssh through `docker exec` (Agenstra's model), `dockerSocket()`, `forward()`, `loadImage()`.                                                                                                                                             |
| `golden.ts`, `images.ts` | Golden images by content hash (`ensureGoldenVolume`; the products keep their pins / provisioning / volume names), content-addressed tool images (`ensureDockerImage`), `requireLocalImage` for prerequisites the gate builds.                                                               |
| `locks.ts`               | The machine's heavy lock (`flock` on `/tmp/lw-3a.lock`, the file `/tmp/lw-3a-lock.sh` locks; skipped when a parent holds it) and the VM-lab lock `/tmp/lw-vmlab.lock` (atomic `O_EXCL` = `noclobber`, owner record, only the owner removes it; stale locks are reported, never removed).    |
| `memory.ts`              | Explicit per-VM memory, the lab guard (≤ 7 GiB = 7168 MiB incl. 700 MiB QEMU overhead per VM and the switch) and the host check (MemAvailable ≥ lab + 1 GiB).                                                                                                                               |
| `nested.ts`              | Nested-virtualization preflight (no VM: `/dev/kvm` in a container, vmx / svm, the KVM `nested` parameter) written to a report the specs read; the per-VM check; the skip / fail policy.                                                                                                     |
| `exit.ts`                | Synchronous exit hooks: containers, volumes and locks of a run are removed on normal exit, Ctrl+C, SIGTERM, SIGHUP.                                                                                                                                                                         |
| `tunnel.ts`              | Stdio tunnels into a VM (Docker socket via `docker system dial-stdio`, TCP via bash `/dev/tcp`): unix sockets in a per-run dir or `127.0.0.1:<ephemeral>` — nothing published, no fixed ports.                                                                                              |
| `measure.ts`, `spike.ts` | `LabRecorder` (measurements against budgets, verdicts, notes → stderr + `$VM_LAB_RESULTS_DIR/<suite>-<ts>.json`, default `<tmp>/vm-lab/results`), `SpikeRecorder` (what a spike validates, what to change when it fails, PASS / FAIL).                                                      |
| `scripts/run-lab.sh`     | The gate's runner: heavy lock → memory (≥ 8 GiB available) and disk (≥ 30 GiB) checks → VM-lab lock → `jest --runInBand <filters>` with a watchdog (stops below 3 GiB available) and a timeout → cleanup by label → own lock removed.                                                       |
| `scripts/cleanup.sh`     | Leftovers of one lab by `--label` (`--prune-unfinished-golden`, `--golden`; refuses while a lab holds `/tmp/lw-vmlab.lock`, `--force` overrides).                                                                                                                                           |

Names always carry a per-run id (`lw-vmlab-<run>-…`, `agenstra-isolation-lab-vm-<name>-<run>`); the lab subnets live in
the switch's own network namespace. Golden volumes: `lw-vmlab-golden-<hash>` (Debian 13, Loadweaver),
`agenstra-isolation-lab-golden-<hash>` (Ubuntu 22.04, Agenstra) — unchanged names, cached volumes are reused.

## Nested virtualization

MicroVMs and full VMs run inside the lab VMs: Hyper-V → WSL kernel → lab VM → microVM (three levels). Lab VMs get
`-cpu host` (vmx / svm visible); WSL2 needs `nestedVirtualization=true` in `.wslconfig` (default on Windows 11).
The global setup's preflight writes the verdict; specs needing nested KVM use `nestedDescribe(...)` /
`requireNested(vm)` and are **skipped with the reason** printed when nesting is unavailable — the combined gate
decides. `VM_LAB_REQUIRE_NESTED=1` turns the skip into a failure. Agenstra's isolation lab keeps its own rule
(`ISOLATION_LAB_ALLOW_NO_KVM=1` to skip, fail otherwise). Spike S5 measures the costs.

Environment: `VM_LAB_REQUIRE_NESTED`, `VM_LAB_SKIP_MEMORY_CHECK`, `VM_LAB_SKIP_DISK_CHECK`, `VM_LAB_RESULTS_DIR`,
`VM_LAB_NESTED_REPORT`, image overrides `VM_LAB_LAUNCHER_IMAGE`, `VM_LAB_CP_IMAGE`, `VM_LAB_AGENSTRA_MICROVM_IMAGE`,
`VM_LAB_AGENSTRA_WORKER_IMAGE`.

## Running (combined gate)

One at a time, no other Docker-based command in parallel (the runner takes the locks itself):

```bash
NX_DAEMON=false npx nx run loadweaver-backend-feature-node-agent:vm-lab-spikes                 # S1–S10
NX_DAEMON=false npx nx run loadweaver-backend-feature-node-agent:vm-lab-spikes -- s04           # one spike
NX_DAEMON=false npx nx run loadweaver-backend-feature-node-agent:vm-lab-m7 -- isolation-ladder  # one M7 spec
NX_DAEMON=false npx nx run loadweaver-backend-feature-node-agent:vm-lab-m7                      # all M7 specs
NX_DAEMON=false npx nx run loadweaver-backend-feature-node-agent:vm-lab                         # M6 specs (unchanged)
NX_DAEMON=false npx nx run agenstra-backend-feature-isolation-lab:isolation-lab                 # Agenstra (unchanged)
NX_DAEMON=false npx nx run shared-backend-util-vm-lab:vm-lab-cleanup                            # leftovers of both labs
```

Prerequisites built by the gate before the M7 runs (the specs check and name the command): the launcher
`registry.forenet.internal/forepath/microvm-launcher:test` (`nx run shared-microvm-launcher:container-image`), the
control plane `loadweaver-control-plane-api:dr-lab` (cluster specs), the isolation lab's
`agenstra-isolation-lab-microvm:local` / `-microvm-guest:local` (Agenstra on Loadweaver, bundled microVMs; built by
the isolation lab's `buildLabMicrovmImages`). Internet through the lab NAT (Debian cloud image, Docker Hub images,
apt). The global setup reuses the golden image and bundles the M7 node driver, the cluster agent, the CLI and the M6
update driver (~2–4 min, one tsc run of the agent).

### Expected duration and memory (this machine: WSL2, 12 vCPUs; nested runs are slower than bare metal)

Memory = the lab's containers (guest + 700 MiB per VM + 128 MiB switch); the host additionally needs 1 GiB margin.

| Spec / spike (`vm-lab-m7` / `vm-lab-spikes`)              | VMs (guest MiB, n = nested)      | Lab memory | Expected       |
| --------------------------------------------------------- | -------------------------------- | ---------- | -------------- |
| `m7/isolation-ladder` (W4)                                | 2048 n + 1536                    | 5 112 MiB  | 20–30 min      |
| `m7/microvm` (W6 / F1)                                    | 3072 n + 1024                    | 5 624 MiB  | 25–35 min      |
| `m7/live-sessions` (W7 / W8)                              | 3584 n                           | 4 412 MiB  | 20–30 min      |
| `m7/virtual-machine` (W9 / F3a / F3b)                     | 2 × 2560 n                       | 6 648 MiB  | 45–70 min      |
| `m7/vm-live-migration` (W10)                              | 2 × 2560 n                       | 6 648 MiB  | 40–60 min      |
| `m7/scheduling` (W2 / W3 / W4 CP side, CPU rule; cluster) | 3072 n + 2304 n (`-avx2`)        | 6 904 MiB  | 45–60 min      |
| `m7/vm-api` (W8 / F3a, backups; cluster)                  | 2816 + 2560 n                    | 6 904 MiB  | 60–90 min      |
| `m7/agenstra-on-loadweaver` (W11; cluster)                | 3584 n                           | 4 412 MiB  | 40–60 min      |
| `m7/capability-update` (F1; cluster)                      | 3072 n                           | 3 900 MiB  | 20–30 min      |
| `m7/host-packages` (F2)                                   | 1024 + 1536                      | 4 088 MiB  | 10–15 min      |
| **M7 total**                                              | in band, one lab at a time       | ≤ 6 904    | **~5.5–8 h**   |
| `spikes/s01` tap + session libvirt                        | 2048 n                           | 2 876 MiB  | 10–15 min      |
| `spikes/s02` guest tools on musl / no libc                | 3072 n                           | 3 900 MiB  | 15 min         |
| `spikes/s03` virtiofsd on overlayfs                       | 2048 n                           | 2 876 MiB  | 10–15 min      |
| `spikes/s04` tunnelled p2p migration via the relay        | 2 × 2560 n                       | 6 648 MiB  | 25–35 min      |
| `spikes/s05` nesting budget                               | 3584 n                           | 4 412 MiB  | 25–40 min      |
| `spikes/s06` `trivy vm`                                   | 3072                             | 3 900 MiB  | 15–25 min      |
| `spikes/s07` virtio-fs live migration                     | 2 × 2560 n                       | 6 648 MiB  | 15–25 min      |
| `spikes/s08` Ubuntu KVM modules in the bundle             | none (test process, apt indexes) | —          | 5–15 min       |
| `spikes/s09` KVM runtime removal                          | 2048 n                           | 2 876 MiB  | 10–15 min      |
| `spikes/s10` memory accounting                            | 2048 n                           | 2 876 MiB  | 10–15 min      |
| **Spikes total**                                          |                                  | ≤ 6 648    | **~2.5–3.5 h** |

Run the spikes first (the design's order: S1–S10 decide details the specs assume), then the M7 specs one by one.
