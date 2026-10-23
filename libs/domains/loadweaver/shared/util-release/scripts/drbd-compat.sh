#!/bin/bash
# Pre-generates DRBD's compat patch per kernel at bundle build time (3.26, air-gapped clusters; see
# src/lib/drbd-compat.ts). Run as root on a host / in a container of the target OS release and architecture whose apt
# sources are the archive state the release freezes (the release job: the distribution's own image, apt-get update at
# bundle build time):
#
#   drbd-compat.sh <drbd-source.tar.gz> <sha256> <out-dir> [kernel …]
#
# Without kernels: the kernels the OS's kernel metapackages resolve to — what `dist-upgrade` installs on a node of
# that release (Debian: linux-image-<arch>, linux-image-cloud-<arch>; Ubuntu: linux-image-generic / -virtual and
# their HWE variants). Per kernel: installs its headers, runs DRBD's compat probe (`make -C drbd prep`), which takes
# the patch from DRBD's own cache, a local coccinelle or LINBIT's SPAAS (network is fine here, unlike on nodes), and
# writes <out-dir>/<kernel>.tar.gz = cocci_cache/<md5 of compat.h>/{compat.h,compat.patch,kernelrelease.txt}, the
# entry `build-bundle --drbd-compat <kernel>:<arch>=<file>` adds to the bundle. Build log: <out-dir>/<kernel>.log.
set -euo pipefail

src_tgz=${1:?drbd source tarball}
sha=${2:?sha256 of the source}
out=${3:?output directory}
shift 3

echo "$sha  $src_tgz" | sha256sum -c --quiet -
mkdir -p "$out"
export DEBIAN_FRONTEND=noninteractive LC_ALL=C
. /etc/os-release
arch=$(dpkg --print-architecture)

apt-get update -q >/dev/null
apt-get install -y -q --no-install-recommends gcc make perl patch diffutils curl ca-certificates kmod >/dev/null

kernels=("$@")
if [ ${#kernels[@]} -eq 0 ]; then
  case "$ID" in
    debian) metas=("linux-image-$arch" "linux-image-cloud-$arch") ;;
    ubuntu) metas=(linux-image-generic linux-image-virtual "linux-image-generic-hwe-$VERSION_ID" "linux-image-virtual-hwe-$VERSION_ID") ;;
    *) echo "drbd-compat: unsupported OS $ID" >&2; exit 1 ;;
  esac
  for meta in "${metas[@]}"; do
    apt-cache show "$meta" >/dev/null 2>&1 || continue
    k=$(apt-cache depends "$meta" | sed -n 's/^ *Depends: linux-image-\(unsigned-\)\{0,1\}\([0-9][^ ]*\)$/\2/p' | head -1)
    [ -n "$k" ] && kernels+=("$k")
  done
  mapfile -t kernels < <(printf '%s\n' "${kernels[@]}" | sort -u)
fi
[ ${#kernels[@]} -gt 0 ] || { echo "drbd-compat: no kernels found for $ID $VERSION_ID $arch" >&2; exit 1; }

for k in "${kernels[@]}"; do
  [[ $k =~ ^[0-9][0-9A-Za-z._+~-]*$ ]] || { echo "drbd-compat: unsafe kernel $k" >&2; exit 1; }
  apt-get install -y -q --no-install-recommends "linux-headers-$k" >/dev/null
  kdir="/lib/modules/$k/build"
  [ -e "$kdir/Makefile" ] || kdir="/usr/src/linux-headers-$k"
  work=$(mktemp -d)
  tar -xzf "$src_tgz" -C "$work" --strip-components=1 --no-same-owner
  log="$out/$k.log"
  if ! make -C "$work/drbd" prep KDIR="$kdir" SPAAS=true >"$log" 2>&1; then
    tail -n 40 "$log" >&2
    echo "drbd-compat: compat probe for $k failed" >&2
    exit 1
  fi
  patch_file=$(readlink -f "$work/drbd/build-current/compat.patch")
  cache=$(dirname "$patch_file")
  md5=$(basename "$cache")
  [ "$(md5sum < "$cache/compat.h" | cut -d' ' -f1)" = "$md5" ] || { echo "drbd-compat: $cache: checksum mismatch" >&2; exit 1; }
  grep -qxF "$k" "$cache/kernelrelease.txt" || echo "$k" >> "$cache/kernelrelease.txt"
  tar -czf "$out/$k.tar.gz" -C "$work/drbd/drbd-kernel-compat" --owner=0 --group=0 --numeric-owner \
    "cocci_cache/$md5/compat.h" "cocci_cache/$md5/compat.patch" "cocci_cache/$md5/kernelrelease.txt"
  echo "drbd-compat: $k $arch -> $md5 ($(stat -c %s "$cache/compat.patch") bytes of patch)"
  rm -rf "$work"
done
