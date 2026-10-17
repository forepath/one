#!/bin/bash
# Provisions the VM lab's golden image inside a Debian 13 genericcloud guest (run once by cloud-init, see golden.ts).
# The pinned versions / checksums are prepended by golden.ts as shell variables (LW_*). Prints LW-GOLDEN-OK or
# LW-GOLDEN-FAIL on the serial console and powers off either way; the builder container checks the marker.
set -euo pipefail
console() { echo "$*" > /dev/ttyS0; echo "$*"; }
trap 'console "LW-GOLDEN-FAIL line $LINENO"; systemctl poweroff --no-block' ERR
export DEBIAN_FRONTEND=noninteractive
KVER=$(uname -r)
START=$(date +%s)
console "LW-GOLDEN-STEP base packages (kernel $KVER)"

apt-get update -q
apt-get install -y -q --no-install-recommends ca-certificates curl gnupg jq xz-utils bzip2 iproute2 build-essential \
  "linux-headers-$KVER"

console "LW-GOLDEN-STEP docker repository"
curl -fsSL -o /tmp/docker.asc https://download.docker.com/linux/debian/gpg
FPR=$(gpg --show-keys --with-colons /tmp/docker.asc | awk -F: '/^fpr/ { print $10; exit }')
[ "$FPR" = "$LW_DOCKER_KEY_FPR" ] || { console "docker repo key fingerprint $FPR != $LW_DOCKER_KEY_FPR"; false; }
install -D -m 0644 /tmp/docker.asc /etc/apt/keyrings/docker.asc
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian trixie stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update -q

console "LW-GOLDEN-STEP node packages"
apt-get install -y -q --no-install-recommends \
  "docker-ce=$LW_DOCKER_VERSION" "docker-ce-cli=$LW_DOCKER_VERSION" "containerd.io=$LW_CONTAINERD_VERSION" \
  "criu=$LW_CRIU_VERSION" "drbd-utils=$LW_DRBD_UTILS_VERSION" \
  wireguard-tools nftables bird2 keepalived lvm2 cryptsetup thin-provisioning-tools
RUNC=$(runc --version | awk '/^runc version/ { print $3 }')
[ "$RUNC" = "$LW_RUNC_VERSION" ] || { console "runc $RUNC != $LW_RUNC_VERSION"; false; }
# The agent manages BIRD and keepalived; keep the lab guests quiet until a test configures them.
systemctl disable --now bird keepalived || true
install -D -m 0644 /dev/stdin /etc/docker/daemon.json <<< '{ "live-restore": true }'
systemctl restart docker

console "LW-GOLDEN-STEP drbd $LW_DRBD_VERSION module"
curl -fsSL -o /tmp/drbd.tar.gz "$LW_DRBD_URL"
echo "$LW_DRBD_SHA256  /tmp/drbd.tar.gz" | sha256sum -c -
tar -C /usr/src -xzf /tmp/drbd.tar.gz
make -C "/usr/src/drbd-$LW_DRBD_VERSION" -j"$(nproc)" KDIR="/lib/modules/$KVER/build" > /tmp/drbd-build.log 2>&1 \
  || { tail -50 /tmp/drbd-build.log > /dev/ttyS0; false; }
make -C "/usr/src/drbd-$LW_DRBD_VERSION" install KDIR="/lib/modules/$KVER/build" >> /tmp/drbd-build.log 2>&1
depmod -a "$KVER"
[ "$(modinfo -F version drbd)" = "$LW_DRBD_VERSION" ] || { console "drbd module $(modinfo -F version drbd)"; false; }
echo drbd > /etc/modules-load.d/drbd.conf
modprobe drbd
grep -q "^version: $LW_DRBD_VERSION" /proc/drbd
# Real nodes get kernel and DRBD module together from the release bundle; the lab keeps its kernel fixed.
apt-mark hold linux-image-amd64 "linux-image-$KVER" "linux-headers-$KVER"

console "LW-GOLDEN-STEP node.js $LW_NODE_VERSION"
curl -fsSL -o /tmp/node.tar.xz "https://nodejs.org/dist/v$LW_NODE_VERSION/node-v$LW_NODE_VERSION-linux-x64.tar.xz"
echo "$LW_NODE_SHA256  /tmp/node.tar.xz" | sha256sum -c -
tar -xJf /tmp/node.tar.xz -O "node-v$LW_NODE_VERSION-linux-x64/bin/node" > /usr/local/bin/node
chmod 0755 /usr/local/bin/node
node --version

console "LW-GOLDEN-STEP lab images"
docker pull -q "$LW_BUSYBOX_IMAGE"

console "LW-GOLDEN-STEP gvisor $LW_GVISOR_RELEASE"
# Same layout and runtimes as the node installer (util-container-runtime's gVisor script): the whole release under
# /usr/local/lib/agenstra-gvisor/<release>, `current` + /usr/local/bin links, Docker runtimes `runsc-systrap`
# (gVisor netstack, what sandboxed workloads run on) and `runsc-systrap-hostnet`, both on the systrap platform.
GV=/usr/local/lib/agenstra-gvisor
curl -fsSL -o /tmp/gvisor.tar.bz2 \
  "https://storage.googleapis.com/gvisor/releases/release/$LW_GVISOR_RELEASE/x86_64/gvisor.tar.bz2"
echo "$LW_GVISOR_SHA512  /tmp/gvisor.tar.bz2" | sha512sum -c -
install -d -m 0755 "$GV/$LW_GVISOR_RELEASE"
tar -xjf /tmp/gvisor.tar.bz2 -C "$GV/$LW_GVISOR_RELEASE" --no-same-owner
chmod -R go-w "$GV/$LW_GVISOR_RELEASE"
ln -sfn "$GV/$LW_GVISOR_RELEASE" "$GV/current"
ln -sf "$GV/current/runsc" /usr/local/bin/runsc
ln -sf "$GV/current/containerd-shim-runsc-v1" /usr/local/bin/containerd-shim-runsc-v1
"$GV/$LW_GVISOR_RELEASE/runsc" install --runtime=runsc-systrap -- --platform=systrap
"$GV/$LW_GVISOR_RELEASE/runsc" install --runtime=runsc-systrap-hostnet -- --platform=systrap --network=host
systemctl restart docker
docker run --rm --runtime=runsc-systrap --network=none "$LW_BUSYBOX_IMAGE" true
jq -e '."live-restore" == true and .runtimes."runsc-systrap".runtimeArgs == ["--platform=systrap"]' /etc/docker/daemon.json

console "LW-GOLDEN-STEP manifest + cleanup"
{
  echo "kernel $KVER"
  grep '^version' /proc/drbd
  docker version --format 'docker {{.Server.Version}}'
  runc --version | head -1
  criu --version | head -1
  runsc --version | head -1
  dpkg-query -W -f '${Package} ${Version}\n'
} > /etc/loadweaver-lab-golden.manifest
apt-get clean
rm -rf /var/lib/apt/lists/* /tmp/* "/usr/src/drbd-$LW_DRBD_VERSION"
# Every clone is a new instance: fresh machine id, host keys and cloud-init state from its own seed.
rm -f /etc/ssh/ssh_host_* /var/lib/dbus/machine-id
truncate -s 0 /etc/machine-id
fstrim -av || true
console "LW-GOLDEN-OK $(( $(date +%s) - START ))s"
trap - ERR
cloud-init clean --logs || true
systemctl poweroff --no-block
