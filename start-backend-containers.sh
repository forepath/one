#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

backend_apps=(
  "agenstra/backend-agent-controller:agenstra-backend-agent-controller"
  "agenstra/backend-agent-manager:agenstra-backend-agent-manager"
  "decabill/backend-billing-manager:decabill-backend-billing-manager"
  "forepath/backend-communication:forepath-backend-communication"
)

for app in "${backend_apps[@]}"; do
  app_dir="${app%%:*}"
  example="$ROOT_DIR/apps/$app_dir/.start-containers.env.example"

  if [[ ! -f "$example" ]]; then
    printf 'Missing env example: %s\n' "$example" >&2
    exit 1
  fi
done

for app in "${backend_apps[@]}"; do
  app_dir="${app%%:*}"
  example="$ROOT_DIR/apps/$app_dir/.start-containers.env.example"
  env_file="$ROOT_DIR/apps/$app_dir/.start-containers.env"

  if [[ ! -e "$env_file" && ! -L "$env_file" ]]; then
    cp -- "$example" "$env_file"
    printf 'Created %s\n' "$env_file"
  else
    printf 'Preserving existing %s\n' "$env_file"
  fi
done

for app in "${backend_apps[@]}"; do
  project="${app#*:}"
  printf '\nStarting %s\n' "$project"
  npx nx run "$project:start-containers"
done