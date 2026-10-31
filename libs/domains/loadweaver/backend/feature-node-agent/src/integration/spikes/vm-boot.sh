#!/bin/bash
# Boots one Debian 13 genericcloud VM under QEMU/KVM inside a container (M6 spike 0a, VM lab).
# usage: vm-boot.sh <name> <workdir with debian-13-genericcloud-amd64-<v>.qcow2> [guest-mb]
# Lessons from the spike:
#  - the qcow2 must live in a Docker volume and use cache=none: with a bind-mounted WSL path the page cache is
#    charged to the container cgroup and the QEMU container gets OOM-killed;
#  - container --memory must be guest RAM + ~700 MiB;
#  - ssh from the WSL host to a published port was not usable here, so ssh runs inside the QEMU container
#    (docker exec <name> ssh -p 2222 lab@127.0.0.1).
set -euo pipefail
NAME=$1; WORK=$2; MB=${3:-2560}
IMG=$(cd "$WORK" && ls debian-13-genericcloud-amd64-*.qcow2 | head -1)
[ -f "$WORK/id_lab" ] || ssh-keygen -q -t ed25519 -N '' -f "$WORK/id_lab"
cat > "$WORK/user-data" <<UD
#cloud-config
hostname: $NAME
users:
  - name: lab
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    ssh_authorized_keys: ["$(cat "$WORK/id_lab.pub")"]
UD
printf 'instance-id: %s\nlocal-hostname: %s\n' "$NAME" "$NAME" > "$WORK/meta-data"
docker volume create "$NAME-disk" >/dev/null
docker run --rm -v "$NAME-disk:/d" -v "$WORK:/vm" lw-lab-qemu sh -c \
  "cp /vm/$IMG /d/base.qcow2 && cd /vm && cloud-localds /d/seed.img user-data meta-data && qemu-img create -q -f qcow2 -F qcow2 -b base.qcow2 /d/disk.qcow2 10G"
docker run -d --name "$NAME" --device /dev/kvm --memory "$((MB + 700))m" -v "$NAME-disk:/d" -v "$WORK:/vm" lw-lab-qemu sh -c \
  "cd /d && exec qemu-system-x86_64 -enable-kvm -cpu host -smp 4 -m $MB -nographic \
   -drive file=disk.qcow2,if=virtio,cache=none,aio=native -drive file=seed.img,if=virtio,format=raw \
   -netdev user,id=n0,hostfwd=tcp::2222-:22 -device virtio-net-pci,netdev=n0" >/dev/null
for _ in $(seq 1 120); do
  docker exec "$NAME" ssh -q -i /vm/id_lab -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=2 -p 2222 lab@127.0.0.1 true 2>/dev/null && exit 0
  sleep 1
done
echo "VM $NAME did not come up" >&2; exit 1
