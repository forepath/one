#!/usr/bin/env bash
# Generate CycloneDX SBOMs for locally built container images (one file per image tag).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

SBOM_OUTPUT_DIR="${SBOM_OUTPUT_DIR:-dist/sboms}"
PROJECT_VERSION="${PROJECT_VERSION:-}"
CYCLONEDX_SPEC_VERSION="${CYCLONEDX_SPEC_VERSION:-1.6}"
CYCLONEDX_SCHEMA_URL="http://cyclonedx.org/schema/bom-${CYCLONEDX_SPEC_VERSION}.schema.json"

normalize_container_cyclonedx_spec() {
  local bom_path="$1"
  if ! command -v jq >/dev/null 2>&1; then
    echo "jq is required to normalize CycloneDX specVersion in ${bom_path}" >&2
    exit 1
  fi
  local tmp
  tmp="$(mktemp)"
  jq --arg spec "$CYCLONEDX_SPEC_VERSION" --arg schema "$CYCLONEDX_SCHEMA_URL" '
    .specVersion = $spec
    | if has("$schema") then .["$schema"] = $schema else . end
  ' "$bom_path" >"$tmp"
  mv "$tmp" "$bom_path"
}

IMAGE_REGISTRY_PATTERN='^ghcr\.io/forepath/|^registry\.forenet\.internal/forepath/'

is_release_project_version() {
  [ -n "$PROJECT_VERSION" ] \
    && [ "$PROJECT_VERSION" != "0.0.0-SNAPSHOT" ] \
    && printf '%s\n' "$PROJECT_VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+'
}

image_tag_matches_filter() {
  local tag="$1"
  if is_release_project_version; then
    [ "$tag" = "$PROJECT_VERSION" ]
    return
  fi
  [ "$tag" = "latest" ] || [ "$tag" = "test" ]
}

mkdir -p "$SBOM_OUTPUT_DIR"

mapfile -t images < <(
  docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null \
    | grep -E "$IMAGE_REGISTRY_PATTERN" \
    | sort -u || true
)

filtered_images=()
for image in "${images[@]}"; do
  tag="${image#*:}"
  if image_tag_matches_filter "$tag"; then
    filtered_images+=("$image")
  fi
done

if [ "${#filtered_images[@]}" -eq 0 ]; then
  if [ "${#images[@]}" -eq 0 ]; then
    echo "No local container images found; skipping Trivy image SBOM generation."
  else
    echo "No container images match tag filter (PROJECT_VERSION=${PROJECT_VERSION:-<unset>}); skipping SBOM generation."
    echo "Images on runner: ${images[*]}"
  fi
  exit 0
fi

if ! command -v trivy >/dev/null 2>&1; then
  echo "trivy is not on PATH; add aquasecurity/setup-trivy before this script." >&2
  exit 1
fi

echo "Generating CycloneDX SBOMs for ${#filtered_images[@]} image(s): ${filtered_images[*]}"

for image in "${filtered_images[@]}"; do
  repo="${image%%:*}"
  repo_name="${repo##*/}"
  bom_path="${SBOM_OUTPUT_DIR}/container-${repo_name}.cdx.json"

  echo "SBOM for ${image} -> ${bom_path}"

  trivy image "$image" \
    --config trivy.yaml \
    --quiet \
    --format cyclonedx \
    --output "$bom_path" \
    --exit-code 0

  normalize_container_cyclonedx_spec "$bom_path"
done

echo "Wrote ${#filtered_images[@]} container image SBOM file(s) under ${SBOM_OUTPUT_DIR}"
