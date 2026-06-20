#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <path-to-install-provider-plugins.js>" >&2
  exit 1
fi

install_script="$1"

if [ ! -f "$install_script" ]; then
  echo "Install script not found: $install_script" >&2
  exit 1
fi

plugin_path="$(mktemp -d /tmp/forepath-provider-plugin-smoke.XXXXXX)"
trap 'rm -rf "$plugin_path"' EXIT

export DYNAMIC_PROVIDER_PLUGIN_PATH="$plugin_path"
node "$install_script"
