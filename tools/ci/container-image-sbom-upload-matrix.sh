#!/usr/bin/env bash
# Build a GitHub Actions matrix for Dependency-Track uploads (one SBOM per container image file).
set -euo pipefail

SBOM_DIR="${1:-dist/sboms}"
PROJECT_VERSION="${2:-0.0.0-SNAPSHOT}"
# Set CONTAINER_IMAGE_SBOM_PARENT in release.yml (prepare-container-image-sbom-uploads job) for CI.
CONTAINER_IMAGE_SBOM_PARENT="${CONTAINER_IMAGE_SBOM_PARENT:-}"
if [ -z "$CONTAINER_IMAGE_SBOM_PARENT" ]; then
  echo "CONTAINER_IMAGE_SBOM_PARENT is not set (configure in .github/workflows/release.yml)." >&2
  exit 1
fi

# Longest names first so multi-segment image names match correctly.
KNOWN_IMAGE_NAMES=(
  decabill-billing-console-server
  decabill-billing-api
  decabill-docs-server
  agenstra-billing-console-server
  agenstra-console-server
  agenstra-controller-api
  agenstra-manager-worker
  agenstra-manager-api
  agenstra-manager-vnc
  agenstra-manager-ssh
  agenstra-manager-agi
  agenstra-portal-server
  agenstra-docs-server
)

include=()

shopt -s nullglob
for bom_path in "${SBOM_DIR}"/container-*.cdx.json; do
  stem="$(basename "$bom_path" .cdx.json)"
  image_part="${stem#container-}"
  projectname=""

  for image_name in "${KNOWN_IMAGE_NAMES[@]}"; do
    if [ "$image_part" = "$image_name" ] || [[ "$image_part" == "${image_name}-"* ]]; then
      projectname="container-${image_name}"
      break
    fi
  done

  if [ -z "$projectname" ]; then
    projectname="container-${image_part}"
  fi

  # Basename only: publish-container-image-sboms downloads the artifact flat to workspace root.
  bom_basename="$(basename "$bom_path")"
  include+=("$(
    jq -cn \
      --arg bomfilename "$bom_basename" \
      --arg projectname "$projectname" \
      --arg projectversion "$PROJECT_VERSION" \
      --arg parent "$CONTAINER_IMAGE_SBOM_PARENT" \
      '{bomfilename: $bomfilename, projectname: $projectname, projectversion: $projectversion, parent: $parent}'
  )")
done

if [ "${#include[@]}" -eq 0 ]; then
  printf '%s' '{"include":[]}'
  exit 0
fi

printf '%s' "$(printf '%s\n' "${include[@]}" | jq -sc '{include: .}')"
