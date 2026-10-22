#!/usr/bin/env bash
# Scan locally built ghcr.io/forepath/* and registry.forenet.internal/forepath/* images.
# Requires Trivy on PATH (use aquasecurity/setup-trivy or trivy-action in the workflow first).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

SARIF_CATEGORY="${TRIVY_SARIF_CATEGORY:-trivy-container-images}"
SARIF_FILE="${TRIVY_SARIF_FILE:-trivy-results-${SARIF_CATEGORY}.sarif}"

IMAGE_REGISTRY_PATTERN='^ghcr\.io/forepath/|^registry\.forenet\.internal/forepath/'

mapfile -t images < <(
  docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null \
    | grep -E "$IMAGE_REGISTRY_PATTERN" \
    | sort -u || true
)

if [ "${#images[@]}" -eq 0 ]; then
  echo "No local ghcr.io/forepath/* or registry.forenet.internal/forepath/* images found; skipping Trivy image scan."
  exit 0
fi

echo "Scanning ${#images[@]} local image(s): ${images[*]}"

if ! command -v trivy >/dev/null 2>&1; then
  echo "trivy is not on PATH; add aquasecurity/setup-trivy before this script." >&2
  exit 1
fi

# shellcheck source=tools/ci/trivy-nested-rootfs.sh
. "$REPO_ROOT/tools/ci/trivy-nested-rootfs.sh"

sarif_parts=()
cleanup_parts=()
cleanup_roots=()

cleanup() {
  for part in "${cleanup_parts[@]}"; do
    rm -f "$part"
  done

  for root in "${cleanup_roots[@]}"; do
    remove_nested_rootfs "$root"
  done
}
trap cleanup EXIT

# Scans one target twice: SARIF report (non-blocking exit code so upload can run when findings exist), then the
# severity gate (CRITICAL per trivy.yaml) as a table.
scan_target() {
  local sarif_part

  sarif_part="$(mktemp "${TMPDIR:-/tmp}/trivy-image-XXXXXX.sarif")"
  cleanup_parts+=("$sarif_part")

  trivy "$@" \
    --config trivy.yaml \
    --quiet \
    --format sarif \
    --output "$sarif_part" \
    --exit-code 0

  sarif_parts+=("$sarif_part")

  trivy "$@" \
    --config trivy.yaml \
    --quiet \
    --format table
}

for image in "${images[@]}"; do
  echo "Scanning image: $image"

  nested_rootfs="$(nested_rootfs_of "$image")"

  if [ -z "$nested_rootfs" ]; then
    scan_target image "$image"
    continue
  fi

  scan_target image "$image" --skip-dirs "$nested_rootfs"

  echo "Scanning nested root filesystem /${nested_rootfs} of image: $image"
  nested_root="$(extract_nested_rootfs "$image" "$nested_rootfs")"
  cleanup_roots+=("$nested_root")
  scan_target rootfs "$nested_root"
  remove_nested_rootfs "$nested_root"
done

if [ "${#sarif_parts[@]}" -eq 1 ]; then
  cp "${sarif_parts[0]}" "$SARIF_FILE"
elif command -v jq >/dev/null 2>&1; then
  jq -s '{version: .[0].version, "$schema": .[0]["$schema"], runs: [.[].runs[]]}' "${sarif_parts[@]}" >"$SARIF_FILE"
else
  echo "warning: jq not found; SARIF contains only the last scanned image" >&2
  last_sarif="${sarif_parts[${#sarif_parts[@]}-1]}"
  cp "$last_sarif" "$SARIF_FILE"
fi

echo "SARIF written to $SARIF_FILE"
