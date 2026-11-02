#!/usr/bin/env bash
# Removes VM lab leftovers of one lab (containers + run volumes of aborted runs) by its Docker label.
# usage: cleanup.sh --label <label> [--ready-marker <file>] [--prune-unfinished-golden] [--golden] [--force]
#   --label                    the lab's label (org.forepath.loadweaver.vm-lab, io.agenstra.isolation-lab)
#   --prune-unfinished-golden  also removes golden volumes without <ready-marker> (an interrupted build)
#   --ready-marker <file>      the file a finished golden volume holds (default: ready)
#   --golden                   also removes every golden volume and the lab images (rebuilt on the next run)
#   --force                    run even while /tmp/lw-vmlab.lock is held by a running process
set -euo pipefail

label=""
ready="ready"
prune=0
golden=0
force=0
while [ $# -gt 0 ]; do
  case "$1" in
    --label) label="$2"; shift 2 ;;
    --ready-marker) ready="$2"; shift 2 ;;
    --prune-unfinished-golden) prune=1; shift ;;
    --golden) golden=1; shift ;;
    --force) force=1; shift ;;
    *) echo "cleanup.sh: unknown argument $1" >&2; exit 2 ;;
  esac
done
[ -n "$label" ] || { echo "cleanup.sh: --label is required" >&2; exit 2; }

# A running lab owns its containers: never pull them away from under it (the lab's own exit cleanup removes them).
lock=/tmp/lw-vmlab.lock
if [ "$force" -eq 0 ] && [ -f "$lock" ]; then
  holder_pid=$(sed -n 's/^pid=//p' "$lock" 2>/dev/null || true)
  holder_token=$(sed -n 's/^token=//p' "$lock" 2>/dev/null || true)
  if [ -n "$holder_pid" ] && kill -0 "$holder_pid" 2>/dev/null && [ "$holder_token" != "${LW_VMLAB_LOCK_TOKEN:-}" ]; then
    echo "cleanup.sh: a VM lab runs (pid $holder_pid holds $lock); not cleaning up (use --force)" >&2
    exit 1
  fi
fi

mapfile -t ids < <(docker ps -aq --filter "label=${label}")
# VM containers that share a switch container's network namespace go first.
for c in "${ids[@]}"; do
  case "$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$c" 2>/dev/null || true)" in
    container:*) docker rm -f "$c" >/dev/null ;;
  esac
done
mapfile -t ids < <(docker ps -aq --filter "label=${label}")
if [ "${#ids[@]}" -gt 0 ]; then
  docker rm -f "${ids[@]}" >/dev/null
fi

mapfile -t volumes < <(docker volume ls -q --filter "label=${label}=run")
if [ "${#volumes[@]}" -gt 0 ]; then
  docker volume rm -f "${volumes[@]}" >/dev/null
fi

mapfile -t goldens < <(docker volume ls -q --filter "label=${label}=golden")
for v in "${goldens[@]}"; do
  if [ "$golden" -eq 1 ]; then
    docker volume rm "$v" >/dev/null 2>&1 && echo "removed golden volume $v"
  elif [ "$prune" -eq 1 ] &&
    ! docker run --rm -v "$v:/g:ro" docker.io/library/debian:trixie-slim@sha256:a29215f6a35e51e22adffa17f89e9d2ef06214e64a2bad10d765c46aea49f11f test -f "/g/$ready"; then
    # A volume still in use (golden build running) stays.
    docker volume rm "$v" >/dev/null 2>&1 && echo "removed unfinished golden volume $v"
  fi
done

if [ "$golden" -eq 1 ]; then
  mapfile -t images < <(docker image ls -q --filter "label=${label}=image")
  if [ "${#images[@]}" -gt 0 ]; then
    docker image rm -f "${images[@]}" >/dev/null
  fi
fi

echo "VM lab cleanup done (${label}); remaining golden volumes:"
docker volume ls -q --filter "label=${label}=golden"
