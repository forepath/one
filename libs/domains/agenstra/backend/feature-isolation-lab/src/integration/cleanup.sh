#!/usr/bin/env bash
# Remove leftovers of aborted isolation lab runs (VM containers and their run volumes).
# `--golden` also removes the golden images and the QEMU image (rebuilt on the next run).
# The shared VM-lab harness's cleanup with this lab's label (libs/domains/shared/backend/util-vm-lab/scripts).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$HERE/../../../../../shared/backend/util-vm-lab/scripts/cleanup.sh" --label io.agenstra.isolation-lab "$@"
