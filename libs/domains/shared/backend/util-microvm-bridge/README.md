# shared-backend-util-microvm-bridge

The bridge between a microVM launcher container and its guest, shared by Agenstra (isolation level `microvm`, see
[Container Isolation Levels](../../../../../docs/agenstra/features/container-isolation.md#microvm-level)) and
Loadweaver (microVM workloads and full VMs). It ships in the shared launcher image
[`apps/shared/microvm-launcher`](../../../../../apps/shared/microvm-launcher/Dockerfile). Names and values keep
Agenstra's (`/usr/lib/agenstra-microvm`, `agenstra-vmm`, `io.agenstra.*`), so existing worker images and managers
keep working; neutral aliases (`MICROVM_TOOLS_DIR`, …) are exported for new code.

- **Launcher side** (`bridge-host.cjs`, runs as `agenstra-vmm` in the container): `daemon` connects to the
  virtio-serial channel `io.agenstra.bridge`, hands the boot configuration to the guest, relays the workload's
  stdout/stderr to `docker logs`, serves `vm-exec` clients on `/dev/shm/agenstra-microvm/vmm/exec.sock` and
  tunnels the forwarded container ports into the guest. `boot-config` snapshots the container's view (worker
  image environment, manager environment, hostname, hosts, resolver) before boot. `exec` is the `vm-exec`
  client that `docker exec` runs for microVM workers.
- **Guest side** (`bridge-guest.cjs`, runs as root in the guest under tini): applies the container's identity,
  starts the workload (the worker image's entrypoint), runs exec sessions with Docker's exec semantics (users,
  `HOME`, exit status, TTY through `pty-helper.py`), opens TCP connections for forwarded ports and relays guest
  loopback ports (the egress guard's explicit proxy) to the container's loopback.
- **Agent manager** (`toMicrovmExecOptions`): rewrites every `docker exec` of a microVM worker to `vm-exec`. Only
  the names of exec-specific environment variables travel as arguments; the values stay in the exec `Env`.
- **Generic mode** (Loadweaver, `boot.rootDir`): the guest agent runs from the launcher's read-only guest tools in the
  initramfs (`bridge-guest.cjs --root /newroot`) and starts the workload of an arbitrary image chrooted into the image
  root, in its own mount and PID namespaces, through the static helper `lw-pty` (also exec sessions and PTYs). The
  identity files are bind-mounted from tmpfs, `/dev` is a fresh tmpfs (the guest's devtmpfs would expose the bridge
  port). `boot-config --process-file` builds the boot configuration from the node agent's `boot-process.json`;
  `net-config` and `vm-domain` validate the node agent's `net.json` / `vm.json` for the launcher scripts.

## Protocol

Frames are `u32 length | u8 type | u32 stream | payload` (payload at most 64 KiB). Stream `0` is control
(`HELLO`, `BOOT`, `READY`, `STOP`, `WORKLOAD_EXIT`, `STATS`), stream `1` the workload's output, streams `2..` are exec
sessions and TCP connections allocated by the launcher. Data is flow-controlled per stream and direction (256 KiB
window, `WINDOW` grants), so a slow consumer never stalls other streams. The launcher relays `vm-exec` streams end
to end, including their credits. Every guest-bound message is validated against a strict schema; the version is
published as the image label `io.agenstra.microvm.protocol` and checked by the agent manager.

Protocol 1 has two additive extensions that only appear when the launcher asks for them, so older launchers and guests
never see them: the optional `BOOT` fields `rootDir`, `stopSignal`, `dnsServers` and `statsIntervalSeconds`, and the
guest → launcher message `STATS` (`memTotal`, `memAvailable`, `cpuSteal`, `load1`; the daemon writes it to
`--stats-file`, `/run/loadweaver/vm/stats/stats.json`, for the node agent's metrics).

## Build and test

```bash
npx nx run shared-backend-util-microvm-bridge:build   # bundles bridge-host.cjs / bridge-guest.cjs (node20, cjs)
npx nx test shared-backend-util-microvm-bridge        # protocol, validation, generic mode and an end-to-end daemon <-> agent <-> client test
```

The bundles are copied into the launcher's image build context by `shared-microvm-launcher:copy-microvm-bridge` and
installed by `apps/shared/microvm-launcher/Dockerfile`; Agenstra's `Dockerfile.worker-microvm` is built `FROM` that
image.
