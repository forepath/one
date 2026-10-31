# Shared VM-lab harness (`@forepath/shared/backend/util-vm-lab`)

Real VMs (QEMU/KVM inside Docker containers, nothing installed on the host) for tests that containers can't cover:
kernel modules, reboots, crashes, gVisor on KVM, microVMs and full VMs inside the lab VMs (nested KVM). Test-only:
Loadweaver's VM lab (`feature-node-agent/src/integration/vm-lab`) and Agenstra's isolation lab
(`feature-isolation-lab`) use it. Importing the library has no side effects.

## What it provides

| Module                   | What                                                                                                                                                                                                                                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `switch-lab.ts`          | `startSwitchLab`: several VMs behind a switch container (one bridge per site, taps, routing, netem, NAT); per VM `exec` / `copyIn` / `copyOut` / `reboot` / `crash` / `start` / `wipe`, plus `nestedKvm()`, `dockerSocket()`, `forward(port)`. `nested` (default on) and `cpuFlags` per VM.                                                |
| `user-net-vm.ts`         | `startUserNetVm`: one VM with QEMU user networking, ssh through `docker exec` (Agenstra's model), `dockerSocket()`, `forward()`, `loadImage()`.                                                                                                                                                                                            |
| `golden.ts`, `images.ts` | Golden images by content hash (`ensureGoldenVolume`; the products keep their pins / provisioning / volume names), content-addressed tool images (`ensureDockerImage`), `requireLocalImage` for prerequisites the gate builds.                                                                                                              |
| `locks.ts`               | The machine's heavy lock (`flock` on `/tmp/lw-3a.lock`, the file `/tmp/lw-3a-lock.sh` locks; skipped when a parent holds it) and the VM-lab lock `/tmp/lw-vmlab.lock` (atomic `O_EXCL` = `noclobber`, owner record, only the owner removes it; stale locks are reported, never removed).                                                   |
| `memory.ts`              | Explicit per-VM memory, the lab guard (≤ 7 GiB = 7168 MiB incl. 700 MiB QEMU overhead per VM and the switch) and the host check (MemAvailable ≥ lab + 1 GiB).                                                                                                                                                                              |
| `nested.ts`              | Nested-virtualization preflight (no VM: `/dev/kvm` in a container, vmx / svm, the KVM `nested` parameter) written to a report the specs read; the per-VM check; the skip / fail policy.                                                                                                                                                    |
| `exit.ts`                | Synchronous exit hooks: containers, volumes and locks of a run are removed on normal exit, Ctrl+C, SIGTERM, SIGHUP.                                                                                                                                                                                                                        |
| `tunnel.ts`              | Stdio tunnels into a VM (Docker socket via `docker system dial-stdio`, TCP via bash `/dev/tcp`): unix sockets in a per-run dir or `127.0.0.1:<ephemeral>` — nothing published, no fixed ports.                                                                                                                                             |
| `cache.ts`               | The persistent lab cache outside `/tmp` (`$VM_LAB_CACHE_DIR`, default `~/.cache/forepath-vm-lab`): `imageArchive(image)` = `docker save` once per image ID (`images/<tag>--<id>.tar`, older IDs of the tag pruned), used by both labs to load local images into VMs.                                                                       |
| `keep.ts`                | Keep-alive (development only): `LW_LAB_KEEP=1` + a keep key keeps a lab up after the run and re-attaches the next run with the same key and lab fingerprint (`<cache>/keep/<key>.json`); without the env a kept lab of that key is removed first. Supported by `startSwitchLab({ keep })` and `startUserNetVm(…, { keep })`.               |
| `cases.ts`               | Fail-fast helpers: `LabCases` (`it('(b) …', cases.run('b', ['a'], …))` fails a case at once when a case it requires failed in this run; `cases.step(id, …)` for sub-steps), `stallGuard` (no progress for N min → `FatalWait`), `persistGuard` (a bad state held for N min → `FatalWait`).                                                 |
| `measure.ts`, `spike.ts` | `LabRecorder` (measurements against budgets, verdicts, notes → stderr + `$VM_LAB_RESULTS_DIR/<suite>-<ts>.json`, default `<tmp>/vm-lab/results`), `SpikeRecorder` (what a spike validates, what to change when it fails, PASS / FAIL).                                                                                                     |
| `scripts/run-lab.sh`     | The runner of every lab target (both labs): heavy lock → memory (≥ 8 GiB available) and disk (≥ 30 GiB) checks → VM-lab lock → `jest --runInBand <spec patterns> [-t <--case>]` with a watchdog (stops below 3 GiB available, `VM_LAB_WATCHDOG_MB` overrides) and a timeout → cleanup by label (skipped with `--keep`) → own lock removed. |
| `scripts/cleanup.sh`     | Leftovers of one lab by `--label` (`--prune-unfinished-golden`, `--golden`; refuses while a lab holds `/tmp/lw-vmlab.lock`, `--force` overrides).                                                                                                                                                                                          |

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
NX_DAEMON=false npx nx run agenstra-backend-feature-isolation-lab:isolation-lab                 # Agenstra (same runner)
NX_DAEMON=false npx nx run agenstra-backend-feature-isolation-lab:isolation-lab -- microvm      # one Agenstra spec
NX_DAEMON=false npx nx run shared-backend-util-vm-lab:vm-lab-cleanup                            # leftovers of both labs
```

Prerequisites built by the gate before the M7 runs (the specs check and name the command): the launcher
`registry.forenet.internal/forepath/microvm-launcher:test` (`nx run shared-microvm-launcher:container-image`), the
control plane `loadweaver-control-plane-api:dr-lab` (cluster specs), the isolation lab's
`agenstra-isolation-lab-microvm:local` / `-microvm-guest:local` (Agenstra on Loadweaver, bundled microVMs; built by
the isolation lab's `buildLabMicrovmImages`). Internet through the lab NAT (Debian cloud image, Docker Hub images,
apt). The global setup reuses the golden image and bundles the M7 node driver, the cluster agent, the CLI and the M6
update driver (~2–4 min, one tsc run of the agent).

## Fast runs: focused cases, keep-alive, caches, fail-fast (2026-10-26)

Both labs share one model (lab speed-ups 2026-10-26, `.lw-plans/implementation.md`):

- **Tiers.** _Full_ = every spec file, cold (the gate; nothing kept). _Focused_ = one spec file
  (`-- <pattern>`) or single cases (`--case '\(e\)'` = Jest `-t`). Every case still runs in the full tier.
- **Keep-alive (development only, never in the gate).** `--keep` (= `LW_LAB_KEEP=1`) leaves labs with a keep key up
  after the run (`run-lab.sh` skips its cleanup; the VM-lab lock is released) and records them in
  `<cache>/keep/<key>.json`; the next run with the same key and the same lab fingerprint re-attaches in seconds.
  Keys: Loadweaver's cluster specs (`m7-vm-api`, `m7-scheduling`, `m7-agenstra-on-loadweaver`,
  `m7-capability-update`; the cluster is logged into again instead of bootstrapped), Agenstra's lab VMs
  (`isolation-lab-<vm name>`). `beforeAll` runs again on a kept lab (applies, pushes, host preparation: idempotent).
  A kept lab holds memory without holding a lock, so `run-lab.sh` **refuses every other lab run while one exists**
  (only a `--keep` run of the same lab may start: it re-attaches or replaces by key); remove kept labs with
  `cleanup.sh --label <lab label>` when done — other heavy jobs on this machine should check
  `docker ps --filter label=org.forepath.loadweaver.vm-lab=run --filter …` / run the cleanup first.
  `LW_LAB_CP_HOTSWAP=1` (Loadweaver, with a kept cluster): a rebuilt `loadweaver-control-plane-api:dr-lab` replaces
  the running control plane (the agent alone keeps the old container: its spec hash covers the image reference, not
  the image ID).

  ```bash
  RUN=libs/domains/shared/backend/util-vm-lab/scripts/run-lab.sh
  CFG='--config libs/domains/loadweaver/backend/feature-node-agent/jest.vm-lab-m7.config.cts --label org.forepath.loadweaver.vm-lab'
  bash $RUN $CFG --keep -- 'vm-api\.vm-lab'                     # cold once, the lab + cluster stay up
  bash $RUN $CFG --keep --case '\(e\)' -- 'vm-api\.vm-lab'      # fix → re-run only (e) on the kept cluster
  LW_LAB_CP_HOTSWAP=1 bash $RUN $CFG --keep --case '\(a\)' -- 'vm-api\.vm-lab'  # after a control-plane rebuild
  bash $RUN $CFG -- 'vm-api\.vm-lab'                            # cold again (removes the kept lab first)
  ```

- **Caches.** Golden images (Docker volumes named by content hash; Loadweaver's also carries the pinned platform
  images a cluster runs, the lab packages and the Debian test images), image archives by image ID
  (`<cache>/images`), keep state (`<cache>/keep`). Results: `$VM_LAB_RESULTS_DIR` (default `<tmp>/vm-lab/results`),
  one `LabRecorder` JSON per suite in both labs.
- **Fail-fast.** Waits end at once on terminal failures (`FatalWait`), on stalled progress and on bad states that
  persist; dependent cases fail immediately (`LabCases`). Budgets are ≈ 2–3× the green timings, not 15–30 min.

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
