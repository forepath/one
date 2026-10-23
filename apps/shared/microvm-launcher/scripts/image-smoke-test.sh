#!/usr/bin/env bash
# Smoke test of a built launcher image without KVM (Nx target shared-microvm-launcher:container-image-test): the
# tools, the guest tools (node through its own loader), lw-pty, the seed builder and the launcher config renderers.
# The boot paths themselves need /dev/kvm and run in the VM labs (combined gate).
set -euo pipefail

image="${1:?usage: image-smoke-test.sh <image>}"

docker run --rm --network none --entrypoint /bin/bash "${image}" -euo pipefail -c '
dir=/usr/lib/agenstra-microvm
tools="${dir}/guest-tools"

for file in launch launch-generic launch-vm vm-exec vm-ctl vm-console seed-build guest-init; do
  test -x "${dir}/${file}"
done
for file in initramfs.img initramfs-generic.img bridge-host.cjs bridge-guest.cjs pty-helper.py launcher-lib.sh; do
  test -s "${dir}/${file}"
done
test "$(id -u agenstra-vmm)" = 10930
ls /boot/vmlinuz-* >/dev/null
test -x /usr/libexec/virtiofsd
# Live migration of generic microVMs (M7 W10b): virtiofsd state migration.
/usr/libexec/virtiofsd --help | grep -q -- --migration-mode
# Bundled launcher (M7 F5): migration mode with an incoming mode, as the image label (`bundled`) declares.
grep -q "AGENSTRA_MICROVM_MIGRATION" "${dir}/launch"
grep -q -- "-incoming" "${dir}/launch"
qemu-img --version >/dev/null
virsh --version >/dev/null
case "$(uname -m)" in
  x86_64) qemu-system-x86_64 --version >/dev/null; test -s /usr/share/OVMF/OVMF_CODE_4M.fd ;;
  aarch64) qemu-system-aarch64 --version >/dev/null; test -s /usr/share/AAVMF/AAVMF_CODE.fd ;;
esac

# Guest tools: independent of the launcher root (no /usr/lib in the library path).
env -i "${tools}/lib/ld.so" --library-path "${tools}/lib" "${tools}/bin/node.real" -e "process.exit(0)"
"${tools}/bin/tini" --version >/dev/null
"${tools}/bin/busybox" true
if "${tools}/bin/lw-pty" --root / 2>/tmp/lw-pty.err; then exit 1; fi
grep -q "missing command" /tmp/lw-pty.err
test -s "${tools}/bridge-guest.cjs"

# Seed image (tmpfs only).
mkdir -p /tmp/seed
printf "instance-id: smoke\n" >/tmp/seed/meta-data
printf "#cloud-config\n" >/tmp/seed/user-data
"${dir}/seed-build" /tmp/seed /dev/shm/seed.img
mdir -i /dev/shm/seed.img :: | grep -q meta-data
if "${dir}/seed-build" /tmp/seed /tmp/seed.img 2>/dev/null; then exit 1; fi

# Launcher configuration renderers.
printf "{\"mac\":\"52:54:00:12:34:56\",\"mtu\":1420,\"ipv4\":\"10.1.0.5\"}" >/tmp/net.json
node "${dir}/bridge-host.cjs" net-config --net-file /tmp/net.json | grep -q "lw.ip4=10.1.0.5/32"
printf "{\"uid\":\"6f1c2a5e-3b4d-4c8e-9f00-112233445566\",\"vcpus\":1,\"memoryMiB\":512,\"disks\":[{\"name\":\"root\",\"device\":\"/dev/drbd1000\",\"boot\":true}],\"nics\":[{\"name\":\"eth0\",\"mac\":\"52:54:00:12:34:56\",\"tap\":\"lwtap0\"}]}" >/tmp/vm.json
node "${dir}/bridge-host.cjs" vm-domain --config /tmp/vm.json --run-dir /dev/shm/vmm --out /tmp/domain.xml >/dev/null
grep -q "/dev/drbd1000" /tmp/domain.xml
echo "microvm-launcher smoke test passed ($(uname -m))"
'
