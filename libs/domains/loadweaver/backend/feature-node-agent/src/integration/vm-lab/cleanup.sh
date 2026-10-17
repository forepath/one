#!/bin/bash
# Removes VM lab leftovers (containers + volumes of aborted runs, unfinished golden builds).
# usage: cleanup.sh [--golden]   --golden also removes the cached golden image volumes and the QEMU image.
set -euo pipefail
LABEL=org.forepath.loadweaver.vm-lab

ids=$(docker ps -aq --filter "label=$LABEL")
# VM containers share the switch container's network namespace: remove them before the switches.
for c in $ids; do
  case "$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$c")" in
    container:*) docker rm -f "$c" >/dev/null ;;
  esac
done
ids=$(docker ps -aq --filter "label=$LABEL")
[ -z "$ids" ] || docker rm -f $ids >/dev/null

vols=$(docker volume ls -q --filter "label=$LABEL=run")
[ -z "$vols" ] || docker volume rm -f $vols >/dev/null

for v in $(docker volume ls -q --filter "label=$LABEL=golden"); do
  if [ "${1:-}" = "--golden" ] ||
    ! docker run --rm -v "$v:/g:ro" docker.io/library/debian:trixie-slim@sha256:a29215f6a35e51e22adffa17f89e9d2ef06214e64a2bad10d765c46aea49f11f test -f /g/ready; then
    # A volume still in use (golden build running) stays.
    docker volume rm "$v" >/dev/null 2>&1 && echo "removed golden volume $v"
  fi
done

if [ "${1:-}" = "--golden" ]; then
  imgs=$(docker images -q --filter "label=$LABEL=image")
  [ -z "$imgs" ] || docker rmi -f $imgs >/dev/null
fi

echo "VM lab cleanup done; remaining golden volumes:"
docker volume ls -q --filter "label=$LABEL=golden"
