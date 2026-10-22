#!/usr/bin/env bash
# Remove leftovers of aborted isolation lab runs (VM containers and their run volumes).
# `--golden` also removes the golden images and the QEMU image (rebuilt on the next run).
set -euo pipefail

label='io.agenstra.isolation-lab'

mapfile -t containers < <(docker ps -aq --filter "label=${label}")
if [ "${#containers[@]}" -gt 0 ]; then
  docker rm -f "${containers[@]}" >/dev/null
fi

mapfile -t volumes < <(docker volume ls -q --filter "label=${label}=run")
if [ "${#volumes[@]}" -gt 0 ]; then
  docker volume rm -f "${volumes[@]}" >/dev/null
fi

if [ "${1:-}" = "--golden" ]; then
  mapfile -t golden < <(docker volume ls -q --filter "label=${label}=golden")
  if [ "${#golden[@]}" -gt 0 ]; then
    docker volume rm -f "${golden[@]}" >/dev/null
  fi
  mapfile -t images < <(docker image ls -q --filter "label=${label}=image")
  if [ "${#images[@]}" -gt 0 ]; then
    docker image rm -f "${images[@]}" >/dev/null
  fi
fi

echo "Isolation lab leftovers removed"
