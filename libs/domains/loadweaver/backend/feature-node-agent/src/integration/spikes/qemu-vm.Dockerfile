# QEMU/KVM in a container (Docker Desktop exposes /dev/kvm). Used by the M6 VM lab; see vm-boot.sh.
# build: docker build -f qemu-vm.Dockerfile -t lw-lab-qemu <dir>
FROM debian:trixie-slim@sha256:a29215f6a35e51e22adffa17f89e9d2ef06214e64a2bad10d765c46aea49f11f
RUN apt-get update && apt-get install -y --no-install-recommends \
      qemu-system-x86=1:10.0.13+ds-0+deb13u1 qemu-utils=1:10.0.13+ds-0+deb13u1 \
      cloud-image-utils=0.33-1 openssh-client=1:10.0p1-7+deb13u4 \
    && rm -rf /var/lib/apt/lists/*
