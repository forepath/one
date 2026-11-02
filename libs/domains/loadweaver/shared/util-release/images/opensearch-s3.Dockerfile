# OpenSearch with the official repository-s3 plugin (3.20 snapshots to the object store; the pinned 3.9.0 image does
# not ship it, M6 spike). Built by the release pipeline; the release bundle pins the resulting image by digest.
# Base image and plugin checksum: libs/domains/loadweaver/shared/util-release/src/lib/pins.ts.
FROM docker.io/opensearchproject/opensearch:3.9.0@sha256:adfa61f85025d06b4aeb562e7e74fde7e31c437039c93c3862c17e9acebd6c7c
ARG REPOSITORY_S3_URL=https://artifacts.opensearch.org/releases/plugins/repository-s3/3.9.0/repository-s3-3.9.0.zip
ARG REPOSITORY_S3_SHA512=bde558e2be3fdab306b02a51d92aee7b08cb9759e9c38dc204ed8c897720da8316a2776ecc1b2a6a8cc6876144b94bb00c813a5b7c118b37ad8b46dd2cb13cb7
RUN curl -fsSL -o /tmp/repository-s3.zip "$REPOSITORY_S3_URL" \
 && echo "$REPOSITORY_S3_SHA512  /tmp/repository-s3.zip" | sha512sum -c - \
 && bin/opensearch-plugin install --batch file:///tmp/repository-s3.zip \
 && rm /tmp/repository-s3.zip
