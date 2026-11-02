# -----------------------------------------------------------------------------
# Image:      microvm-launcher
# Project:    shared-microvm-launcher — Nx target `container-image` (linux/amd64 + linux/arm64)
# Registry:   ghcr.io/forepath/microvm-launcher
# Base:       debian:trixie-slim (pinned by digest; key packages pinned to their trixie versions)
# User:       root (launcher); libvirt, QEMU and the bridge daemon run as agenstra-vmm (uid 10930)
# Build:      npx nx run shared-microvm-launcher:container-image
# Run:        only through Agenstra's agent manager or Loadweaver's node agent: needs --device /dev/kvm, the reduced
#             capability set (MICROVM_LAUNCHER_CAPABILITIES) and no-new-privileges.
# Notes:      The shared KVM launcher of Agenstra and Loadweaver (one image: QEMU + libvirt session + virtiofsd +
#             microVM guest kernel + UEFI firmware). Entrypoints below /usr/lib/agenstra-microvm (names stay
#             Agenstra's):
#               launch          Agenstra's bundled microVM (worker image below /guest; FROM this image)
#               launch-generic  any OCI image as a microVM (default; image root mounted at /guest by the node agent)
#               launch-vm       full VMs (DRBD block disks, UEFI / BIOS, cloud-init seed)
#               vm-exec, vm-ctl, vm-console, seed-build: helpers run through `docker exec`
#             guest-tools/ is what a generic guest runs from (read-only virtio-fs): node with its own loader and
#             libraries, tini, busybox, lw-pty and the guest bridge; independent of the guest image's libc.
# -----------------------------------------------------------------------------
#
ARG DEBIAN_IMAGE=docker.io/library/debian:trixie-slim@sha256:a29215f6a35e51e22adffa17f89e9d2ef06214e64a2bad10d765c46aea49f11f

# Static workload / exec helper of generic guests (musl, no dependency on the guest image).
FROM ${DEBIAN_IMAGE} AS lw-pty

ARG MUSL_TOOLS_VERSION=1.2.5-3.1~deb13u1
ARG GCC_VERSION=4:14.2.0-1

COPY src/lw-pty.c /src/lw-pty.c
RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      "gcc=${GCC_VERSION}" "musl-tools=${MUSL_TOOLS_VERSION}" && \
    musl-gcc -static -s -Os -Wall -Wextra -Werror -o /lw-pty /src/lw-pty.c && \
    /lw-pty --root / 2>&1 | grep -q 'missing command'

# Launcher root.
FROM ${DEBIAN_IMAGE}

ARG VERSION=0.0.0
ENV VERSION=${VERSION}
ENV DEBIAN_FRONTEND=noninteractive

# Debian trixie package versions (section 6): QEMU, libvirt, virtiofsd, firmware, the guest kernel and the guest
# tools' runtime. Bump together; the release scan (Trivy) covers the image.
# Never name a build argument QEMU_*: build arguments are environment variables of every RUN, and qemu-user (binfmt,
# the arm64 stages of the multi-arch release build) reads QEMU_VERSION & co. as its own options — QEMU_VERSION makes
# it print its version and exit 0 instead of running the step, which silently produced an empty arm64 launcher.
ARG PKG_QEMU_VERSION=1:10.0.13+ds-0+deb13u1
ARG LIBVIRT_VERSION=11.3.0-3+deb13u3
ARG VIRTIOFSD_VERSION=1.13.2-1+deb13u1
ARG EDK2_VERSION=2025.02-8+deb13u1
ARG LINUX_IMAGE_CLOUD_VERSION=6.12.113-1
ARG NODEJS_VERSION=20.19.2+dfsg-1+deb13u3
ARG TINI_VERSION=0.19.0-3+b8
ARG BUSYBOX_VERSION=1:1.37.0-6+b9
ARG DOSFSTOOLS_VERSION=4.2-1.2
ARG MTOOLS_VERSION=4.0.48-1

COPY --chmod=0755 rootfs/usr/lib/agenstra-microvm/initramfs-init /tmp/agenstra-initramfs-init
COPY --chmod=0755 rootfs/usr/lib/agenstra-microvm/initramfs-init-generic /tmp/agenstra-initramfs-init-generic
RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    case "${arch}" in \
      amd64) qemu=qemu-system-x86 firmware=ovmf ;; \
      arm64) qemu=qemu-system-arm firmware=qemu-efi-aarch64 ;; \
      *) echo "unsupported architecture ${arch}" >&2; exit 1 ;; \
    esac; \
    apt-get update; \
    apt-get upgrade -y --no-install-recommends; \
    apt-get install -y --no-install-recommends \
      "${qemu}=${PKG_QEMU_VERSION}" "qemu-utils=${PKG_QEMU_VERSION}" \
      "libvirt-daemon=${LIBVIRT_VERSION}" "libvirt-daemon-driver-qemu=${LIBVIRT_VERSION}" \
      "libvirt-clients=${LIBVIRT_VERSION}" "virtiofsd=${VIRTIOFSD_VERSION}" "${firmware}=${EDK2_VERSION}" \
      "linux-image-cloud-${arch}=${LINUX_IMAGE_CLOUD_VERSION}" "nodejs=${NODEJS_VERSION}" "tini=${TINI_VERSION}" \
      "busybox-static=${BUSYBOX_VERSION}" "dosfstools=${DOSFSTOOLS_VERSION}" "mtools=${MTOOLS_VERSION}" \
      procps util-linux cpio xz-utils; \
    install -d -m 0755 /usr/lib/agenstra-microvm; \
    # initramfs images: static busybox, the virtio network driver and the init (bundled: switch_root into the
    # worker below /guest; generic: stays the agent's root and runs the guest tools).
    kernel_version="$(ls /lib/modules)"; \
    for variant in initramfs:agenstra-initramfs-init initramfs-generic:agenstra-initramfs-init-generic; do \
      staging="$(mktemp -d)"; \
      mkdir -p "${staging}/bin" "${staging}/modules"; \
      cp /usr/bin/busybox "${staging}/bin/busybox"; \
      install -m 0755 "/tmp/${variant#*:}" "${staging}/init"; \
      for module in kernel/net/core/failover kernel/drivers/net/net_failover kernel/drivers/net/virtio_net; do \
        xz -dc "/lib/modules/${kernel_version}/${module}.ko.xz" > "${staging}/modules/$(basename "${module}").ko"; \
      done; \
      (cd "${staging}" && find . | cpio -o -H newc --quiet) | gzip -9 > "/usr/lib/agenstra-microvm/${variant%%:*}.img"; \
      rm -rf "${staging}"; \
    done; \
    # Guest tools (generic mode): node with its own loader and libraries, static tini and busybox.
    tools=/usr/lib/agenstra-microvm/guest-tools; \
    install -d -m 0755 "${tools}" "${tools}/bin" "${tools}/lib"; \
    cp /usr/bin/node "${tools}/bin/node.real"; \
    ldd /usr/bin/node | awk '$2 == "=>" && $3 ~ /^\// { print $3 } $1 ~ /^\// { print $1 }' | sort -u | \
      while read -r library; do cp -L "${library}" "${tools}/lib/"; done; \
    loader="$(ldd /usr/bin/node | awk '$1 ~ /^\/.*ld-linux/ { print $1 }')"; \
    ln -s "$(basename "${loader}")" "${tools}/lib/ld.so"; \
    # Debian's libnode loads some builtins (acorn, cjs-module-lexer, minimatch, undici) from /usr/share/nodejs at
    # runtime: ship exactly the files it references; the generic initramfs links /usr/share/nodejs to them (S2).
    libnode="$(ldd /usr/bin/node | awk '$1 ~ /^libnode/ { print $3 }')"; \
    grep -aoE '/usr/share/nodejs/[A-Za-z0-9/_.@-]+[.]m?js' "${libnode}" | sort -u | \
      while read -r builtin; do install -D -m 0644 "${builtin}" "${tools}/share${builtin#/usr/share}"; done; \
    test -s "${tools}/share/nodejs/cjs-module-lexer/lexer.js"; \
    cp /usr/bin/tini-static "${tools}/bin/tini"; \
    cp /usr/bin/busybox "${tools}/bin/busybox"; \
    "${tools}/lib/ld.so" --library-path "${tools}/lib" "${tools}/bin/node.real" --version; \
    rm -rf /tmp/agenstra-initramfs-init /tmp/agenstra-initramfs-init-generic /boot/initrd.img* /initrd.img* /vmlinuz.old; \
    apt-get clean; \
    rm -rf /var/lib/apt/lists/*; \
    useradd --system --uid 10930 --user-group --no-create-home --home-dir /nonexistent \
      --shell /usr/sbin/nologin agenstra-vmm

COPY --chmod=0755 --from=lw-pty /lw-pty /usr/lib/agenstra-microvm/guest-tools/bin/lw-pty
COPY --chmod=0644 microvm-bridge/bridge-guest.cjs /usr/lib/agenstra-microvm/guest-tools/bridge-guest.cjs

# Launcher scripts (Agenstra's bundled `launch` unchanged) and the guest files Agenstra's bundled worker image
# installs into its guest root (guest-init, pty-helper.py, bridge-guest.cjs).
COPY --chmod=0755 rootfs/usr/lib/agenstra-microvm/launch rootfs/usr/lib/agenstra-microvm/launch-generic \
     rootfs/usr/lib/agenstra-microvm/launch-vm rootfs/usr/lib/agenstra-microvm/vm-ctl \
     rootfs/usr/lib/agenstra-microvm/vm-console rootfs/usr/lib/agenstra-microvm/seed-build \
     rootfs/usr/lib/agenstra-microvm/guest-init /usr/lib/agenstra-microvm/
COPY --chmod=0644 rootfs/usr/lib/agenstra-microvm/launcher-lib.sh rootfs/usr/lib/agenstra-microvm/pty-helper.py \
     /usr/lib/agenstra-microvm/
COPY --chmod=0644 microvm-bridge/bridge-host.cjs microvm-bridge/bridge-guest.cjs /usr/lib/agenstra-microvm/
RUN printf '#!/bin/sh\nexec /usr/bin/node /usr/lib/agenstra-microvm/bridge-host.cjs exec "$@"\n' \
      > /usr/lib/agenstra-microvm/vm-exec && \
    chmod 0755 /usr/lib/agenstra-microvm/vm-exec

# Live migration (M7 W10b, bundled M7 F5): the modes whose launcher scripts send / receive a QEMU live migration
# (`generic`: launch-generic, `vm`: launch-vm, `bundled`: `launch` with AGENSTRA_MICROVM_MIGRATION=1 and its incoming
# mode) and the QEMU / virtiofsd versions (vhost-user-fs state migration); the node agent reports them as
# `capabilities.microvmMigration`. Images built FROM this one inherit the labels: a bundled image (Agenstra's
# worker-microvm) that keeps `launch` as its entrypoint migrates live; one that replaces the launcher script must
# override the label. QEMU migrates the vhost-user-fs state on its own (no device property; spike S7).
LABEL io.forepath.microvm.migration="generic,vm,bundled" \
      io.forepath.microvm.qemu-version="${PKG_QEMU_VERSION}" \
      io.forepath.microvm.virtiofsd-version="${VIRTIOFSD_VERSION}"

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/lib/agenstra-microvm/launch-generic"]
