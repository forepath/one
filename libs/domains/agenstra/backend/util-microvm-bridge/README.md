# agenstra-backend-util-microvm-bridge

The bridge between a microVM worker's launcher container and its guest (isolation level `microvm`, see
[Container Isolation Levels](../../../../../docs/agenstra/features/container-isolation.md#microvm-level)).

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

## Protocol

Frames are `u32 length | u8 type | u32 stream | payload` (payload at most 64 KiB). Stream `0` is control
(`HELLO`, `BOOT`, `READY`, `STOP`, `WORKLOAD_EXIT`), stream `1` the workload's output, streams `2..` are exec
sessions and TCP connections allocated by the launcher. Data is flow-controlled per stream and direction (256 KiB
window, `WINDOW` grants), so a slow consumer never stalls other streams. The launcher relays `vm-exec` streams end
to end, including their credits. Every guest-bound message is validated against a strict schema; the version is
published as the image label `io.agenstra.microvm.protocol` and checked by the agent manager.

## Build and test

```bash
npx nx run agenstra-backend-util-microvm-bridge:build   # bundles bridge-host.cjs / bridge-guest.cjs (node20, cjs)
npx nx test agenstra-backend-util-microvm-bridge        # protocol, validation and an end-to-end daemon <-> agent <-> client test
```

The bundles are copied into the manager's image build context by `agenstra-backend-agent-manager:copy-microvm-bridge`
and installed by `apps/agenstra/backend-agent-manager/Dockerfile.worker-microvm`.
