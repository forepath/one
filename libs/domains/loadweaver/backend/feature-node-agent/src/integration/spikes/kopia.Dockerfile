# Kopia from the official release tarball, sha256 from the release checksums.txt (v0.23.1).
FROM debian:trixie-slim@sha256:a29215f6a35e51e22adffa17f89e9d2ef06214e64a2bad10d765c46aea49f11f
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssh-client && rm -rf /var/lib/apt/lists/*
COPY kopia-0.23.1-linux-x64.tar.gz /tmp/k.tgz
RUN echo "416d0f84a3dbb321a8b2d8f0997b1a0a6e915babe79ee76fa6e4d2bd1e1c5178  /tmp/k.tgz" | sha256sum -c - && tar -xzf /tmp/k.tgz -C /tmp && install -m 0755 /tmp/kopia-0.23.1-linux-x64/kopia /usr/local/bin/kopia && rm -rf /tmp/k*
ENTRYPOINT ["kopia"]
