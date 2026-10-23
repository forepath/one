#!/usr/bin/env bash
# Shared helpers for images that embed a second root filesystem (for example the microVM worker image, which ships
# the guest's root below /guest). Such images declare the directory with the io.forepath.scan.nested-rootfs label.
#
# Trivy only reads the package databases of the image's own root (/var/lib/dpkg/status, /lib/apk/db/installed, …).
# Inside a nested root it therefore misses every OS package and reports files those packages own (Debian's
# python3-certifi egg-info, for example) as stand-alone language packages. The nested root is skipped in the image
# scan and scanned on its own with `trivy rootfs`, where the guest's package databases are found.
#
# Source this file; it defines functions only.

NESTED_ROOTFS_LABEL='io.forepath.scan.nested-rootfs'

# Prints the nested root of <image> relative to "/" (for example "guest"), or nothing when the image has none.
nested_rootfs_of() {
  local image="$1" value

  value="$(docker image inspect --format "{{ index .Config.Labels \"${NESTED_ROOTFS_LABEL}\" }}" "$image" 2>/dev/null || true)"
  value="${value#/}"
  value="${value%/}"

  if [ -z "$value" ] || [ "$value" = '<no value>' ]; then
    return 0
  fi

  if ! printf '%s\n' "$value" | grep -qE '^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$' || printf '%s\n' "$value" | grep -qE '(^|/)\.\.?(/|$)'; then
    echo "warning: ignoring invalid ${NESTED_ROOTFS_LABEL} label '${value}' on ${image}" >&2
    return 0
  fi

  printf '%s\n' "$value"
}

# Extracts <dir> of <image> into a new temporary directory and prints the path of the extracted root.
# Remove the returned path's parent with remove_nested_rootfs when done.
extract_nested_rootfs() {
  local image="$1" dir="$2" target container status=0

  target="$(mktemp -d "${TMPDIR:-/tmp}/trivy-rootfs-XXXXXX")"
  container="$(docker create "$image")"

  docker export "$container" | tar -x -C "$target" --no-same-owner "$dir" || status=$?
  docker rm -f "$container" >/dev/null

  if [ "$status" -ne 0 ] || [ ! -d "${target}/${dir}" ]; then
    echo "failed to extract /${dir} from ${image}" >&2
    remove_nested_rootfs "${target}/${dir}"
    return 1
  fi

  printf '%s\n' "${target}/${dir}"
}

# Removes a root extracted by extract_nested_rootfs (read-only directories from the image included).
remove_nested_rootfs() {
  local root="$1" target

  target="$(dirname "$root")"

  case "$target" in
    "${TMPDIR:-/tmp}"/trivy-rootfs-*) ;;
    *) return 0 ;;
  esac

  chmod -R u+rwX "$target" 2>/dev/null || true
  rm -rf "$target"
}
