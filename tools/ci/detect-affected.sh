#!/usr/bin/env bash
# Emit GitHub Actions outputs for affected Nx projects and common target subsets.
set -euo pipefail

list_affected_projects() {
  local extra_args=("$@")
  npx nx show projects --affected "${extra_args[@]}" | sed '/^\s*$/d' || true
}

write_bool_output() {
  local name="$1"
  local value="$2"
  echo "${name}=${value}" >> "$GITHUB_OUTPUT"
}

write_multiline_output() {
  local name="$1"
  local value="$2"
  {
    echo "${name}<<EOF"
    printf '%s\n' "$value"
    echo 'EOF'
  } >> "$GITHUB_OUTPUT"
}

PROJECTS="$(list_affected_projects)"

if [ -n "$PROJECTS" ]; then
  write_bool_output has_affected true
  write_multiline_output projects "$PROJECTS"
  echo "Affected projects:"
  printf '%s\n' "$PROJECTS"
else
  write_bool_output has_affected false
  write_multiline_output projects ""
  echo "No affected projects; nx affected jobs and steps will be skipped."
fi

for target in test e2e lint build; do
  target_projects="$(list_affected_projects --with-target="$target")"
  if [ -n "$target_projects" ]; then
    write_bool_output "has_${target}" true
  else
    write_bool_output "has_${target}" false
  fi
done
