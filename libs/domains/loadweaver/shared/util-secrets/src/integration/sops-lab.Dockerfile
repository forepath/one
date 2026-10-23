# Lab image for the age / SOPS interoperability tests: the official SOPS image (age support built in) plus the
# official age release binaries, both pinned (image digest, release tarball sha256 from the GitHub release).
FROM ghcr.io/getsops/sops:v3.13.3-alpine@sha256:ae501277bf742f1662e0f881f43dd8fd6798b489a8058e921dbf6cda597140ea

ARG TARGETARCH
ARG AGE_VERSION=v1.3.2

RUN set -eu; \
    case "${TARGETARCH:-amd64}" in \
      amd64) sum=cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10 ;; \
      arm64) sum=6b8dc4333c53a5a57c9e5834e3a48f92605d7154014cd07269ff3327db5d37f4 ;; \
      *) echo "unsupported architecture ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    wget -q -O /tmp/age.tar.gz "https://github.com/FiloSottile/age/releases/download/${AGE_VERSION}/age-${AGE_VERSION}-linux-${TARGETARCH:-amd64}.tar.gz"; \
    echo "${sum}  /tmp/age.tar.gz" | sha256sum -c -; \
    tar -xzf /tmp/age.tar.gz -C /tmp; \
    install -m 0755 /tmp/age/age /tmp/age/age-keygen /usr/local/bin/; \
    rm -rf /tmp/age /tmp/age.tar.gz

USER 65534:65534
WORKDIR /tmp
HEALTHCHECK NONE
ENTRYPOINT []
CMD ["sh"]
