#!/bin/bash
# Removes VM lab leftovers (containers + volumes of aborted runs, unfinished golden builds).
# usage: cleanup.sh [--golden] [--force]   --golden also removes the cached golden image volumes and the QEMU image.
# The shared VM-lab harness's cleanup with this lab's label (libs/domains/shared/backend/util-vm-lab/scripts).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$HERE/../../../../../../shared/backend/util-vm-lab/scripts/cleanup.sh" \
  --label org.forepath.loadweaver.vm-lab --ready-marker ready --prune-unfinished-golden "$@"
