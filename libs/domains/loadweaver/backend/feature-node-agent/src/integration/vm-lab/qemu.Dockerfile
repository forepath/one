# VM lab image (M6): QEMU/KVM inside a container (Docker Desktop exposes /dev/kvm), plus the lab switch tools
# (bridges, taps, nftables NAT, ssh to the guests) and the golden-image builder tools (curl, cloud-localds).
# Built by vm-lab.global-setup.ts; see README.md.
FROM docker.io/library/debian:trixie-slim@sha256:a29215f6a35e51e22adffa17f89e9d2ef06214e64a2bad10d765c46aea49f11f
RUN apt-get update && apt-get install -y --no-install-recommends \
      qemu-system-x86=1:10.0.13+ds-0+deb13u1 qemu-utils=1:10.0.13+ds-0+deb13u1 \
      cloud-image-utils=0.33-1 openssh-client=1:10.0p1-7+deb13u4 \
      iproute2=6.15.0-1 nftables=1.1.3-1 curl=8.14.1-2+deb13u7 ca-certificates=20250419 \
    && rm -rf /var/lib/apt/lists/*
