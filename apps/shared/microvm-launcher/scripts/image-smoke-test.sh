#!/usr/bin/env bash
# Smoke test of a built launcher image without KVM (Nx target shared-microvm-launcher:container-image-test): the
# tools, the guest tools (node through its own loader), lw-pty, the seed builder and the launcher config renderers.
# The boot paths themselves need /dev/kvm and run in the VM labs (combined gate).
set -euo pipefail

image="${1:?usage: image-smoke-test.sh <image>}"

# The QEMU package version label must be set and match the installed package (an empty label or a missing package
# means the build steps did not run, e.g. qemu-user taking a QEMU_* build argument as its own option).
qemu_label="$(docker image inspect --format '{{ index .Config.Labels "io.forepath.microvm.qemu-version" }}' "${image}")"
if [ -z "${qemu_label}" ] || [ "${qemu_label}" = '<no value>' ]; then
  echo "label io.forepath.microvm.qemu-version is missing on ${image}" >&2
  exit 1
fi

docker run --rm --memory 1g --network none -e "EXPECTED_QEMU_VERSION=${qemu_label}" --entrypoint /bin/bash "${image}" \
  -euo pipefail -c '
test "$(dpkg-query -W -f "\${Version}" qemu-utils)" = "${EXPECTED_QEMU_VERSION}"
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
# Every builtin libnode loads from /usr/share/nodejs is in the guest tools (the guest has no /usr/share/nodejs).
libnode="$(ls "${tools}"/lib/libnode.so.* | head -n1)"
grep -aoE "/usr/share/nodejs/[A-Za-z0-9/_.@-]+[.]m?js" "${libnode}" | sort -u | while read -r builtin; do
  test -s "${tools}/share${builtin#/usr/share}" || { echo "guest tools lack ${builtin}" >&2; exit 1; }
done
zcat "${dir}/initramfs-generic.img" >/tmp/initramfs-generic.cpio
grep -aq "ln -sfn /tools/share/nodejs /usr/share/nodejs" /tmp/initramfs-generic.cpio
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

# Every virtiofsd the launch scripts start must run with exactly the capabilities the node agent / agent manager give
# the launcher container (MICROVM_LAUNCHER_CAPABILITIES): virtiofsd exits when it can't apply its capability set
# (found in the combined gate: the guest-tools virtiofsd lacked --modcaps=-setfcap). The flags are taken from the
# scripts themselves; no KVM needed.
caps=()
for cap in CHOWN DAC_OVERRIDE FOWNER FSETID SETUID SETGID MKNOD KILL SETPCAP SYS_CHROOT; do caps+=(--cap-add "${cap}"); done
docker run --rm --memory 256m --network none --cap-drop ALL "${caps[@]}" --security-opt no-new-privileges \
  --entrypoint /bin/bash "${image}" -euo pipefail -c '
dir=/usr/lib/agenstra-microvm
mkdir -p /tmp/vfs/share
n=0
# Each invocation: the options after --socket-group (continuation lines joined), shell expansions dropped.
while IFS= read -r line; do
  n=$((n + 1))
  opts=$(printf "%s" "${line}" | grep -oE -- "--(sandbox|cache|modcaps|readonly|announce-submounts|xattr|migration-[a-z-]+)(=[a-z,=+-]+)?" | tr "\n" " ")
  # shellcheck disable=SC2086
  /usr/libexec/virtiofsd --shared-dir=/tmp/vfs/share --socket-path="/tmp/vfs/${n}.sock" --log-level=error ${opts} \
    2>"/tmp/vfs/${n}.err" &
  pid=$!
  sleep 1
  if ! kill -0 "${pid}" 2>/dev/null; then
    echo "virtiofsd (${opts}) exits under the launcher capabilities: $(cat "/tmp/vfs/${n}.err")" >&2
    exit 1
  fi
  kill "${pid}"
done < <(cat "${dir}/launch" "${dir}/launch-generic" | sed -e ":a" -e "/\\\\$/N; s/\\\\\n//; ta" | grep "/usr/libexec/virtiofsd ")
[ "${n}" -ge 4 ] || { echo "expected at least 4 virtiofsd invocations in the launch scripts, found ${n}" >&2; exit 1; }
echo "virtiofsd: ${n} launcher configurations start under the launcher capabilities"
'
