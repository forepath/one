#!/usr/bin/env bash
# Upload release SBOMs to a domain-specific object store bucket.
# Path layout is identical for every domain: releases/<version>/sboms/<filename>
set -euo pipefail

DOMAIN="${1:-}"
SBOM_DIR="${2:-dist/sboms}"
RELEASE_VERSION="${3:-}"
BUCKET="${4:-}"
ENDPOINT_URL="${5:-}"

usage() {
  echo "Usage: $0 <agenstra|decabill> [sbom-dir] <release-version> <bucket> <endpoint-url>" >&2
}

if [ "$DOMAIN" != "agenstra" ] && [ "$DOMAIN" != "decabill" ]; then
  usage
  exit 1
fi

if [ -z "$RELEASE_VERSION" ] || [ -z "$BUCKET" ] || [ -z "$ENDPOINT_URL" ]; then
  usage
  exit 1
fi

if [ ! -d "$SBOM_DIR" ]; then
  echo "SBOM directory not found: ${SBOM_DIR}" >&2
  exit 1
fi

is_decabill_sbom() {
  local filename="$1"
  case "$filename" in
    decabill-*.cdx.json) return 0 ;;
    container-decabill-*.cdx.json) return 0 ;;
    # Legacy container image names retained for older release artifacts.
    container-agenstra-billing-api*.cdx.json) return 0 ;;
    container-agenstra-billing-console-server*.cdx.json) return 0 ;;
    *) return 1 ;;
  esac
}

# Docs SBOM routing (no script changes required — covered by patterns above):
#   agenstra-frontend-docs.cdx.json              -> agenstra bucket
#   decabill-frontend-docs.cdx.json              -> decabill bucket
#   container-agenstra-docs-server.cdx.json      -> agenstra bucket
#   container-decabill-docs-server.cdx.json      -> decabill bucket

staging_dir="$(mktemp -d)"
trap 'rm -rf "$staging_dir"' EXIT

shopt -s nullglob
matched=0
for bom_path in "${SBOM_DIR}"/*.cdx.json; do
  filename="$(basename "$bom_path")"
  if [ "$DOMAIN" = "decabill" ]; then
    if is_decabill_sbom "$filename"; then
      cp "$bom_path" "${staging_dir}/${filename}"
      matched=1
    fi
  elif ! is_decabill_sbom "$filename"; then
    cp "$bom_path" "${staging_dir}/${filename}"
    matched=1
  fi
done

if [ "$matched" -eq 0 ]; then
  echo "No ${DOMAIN} SBOM files found in ${SBOM_DIR}; skipping upload."
  exit 0
fi

dest="s3://${BUCKET}/releases/${RELEASE_VERSION}/sboms/"
echo "Uploading ${DOMAIN} SBOMs to ${dest}"
aws s3 cp "${staging_dir}/" "${dest}" --recursive --endpoint-url "${ENDPOINT_URL}"
