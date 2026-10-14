/**
 * Shell scripts executed inside agent containers by {@link AgentFileSystemService}.
 * Always invoked as argv (`['sh', '-c', SCRIPT, 'sh', ...args]`) — never interpolate paths into them.
 */

export const AGENT_PATH_INSIDE_MARKER = 'AGENSTRA_PATH_INSIDE';
export const AGENT_PATH_OUTSIDE_MARKER = 'AGENSTRA_PATH_OUTSIDE';
/**
 * Canonical containment check run inside the container (`realpath -m` resolves existing symlinks).
 * Args: $1 boundary directory, $2 lexical target, $3 `follow` | `nofollow` | `exact`,
 * $4 lexical parent and $5 final name (computed in TypeScript; `nofollow` keeps the final name unresolved).
 */
export const AGENT_PATH_CONTAINMENT_SCRIPT = [
  'root=$(realpath -m -- "$1") || root=',
  'if [ "$3" = nofollow ]; then',
  '  parent=$(realpath -m -- "$4") || parent=',
  '  target="${parent%/}/$5"',
  '  [ -n "$parent" ] || target=',
  'else',
  '  target=$(realpath -m -- "$2") || target=',
  'fi',
  'if [ -n "$root" ] && [ -n "$target" ]; then',
  '  if [ "$3" = exact ]; then',
  `    if [ "$target" = "$2" ]; then echo ${AGENT_PATH_INSIDE_MARKER}; exit 0; fi`,
  '  else',
  `    case "$target" in "$root"|"$root"/*) echo ${AGENT_PATH_INSIDE_MARKER}; exit 0 ;; esac`,
  '  fi',
  'fi',
  `echo ${AGENT_PATH_OUTSIDE_MARKER}`,
].join('\n');
/**
 * Privileged (root) file operation for system paths outside the workspace, race-safe against symlink swaps:
 * walks the parent chain from `/` with `cd -P`, refusing symlinked components and verifying the physical
 * working directory after every step, then operates relative to that directory (cwd stays pinned).
 * Files are prepared inside a private root-owned 0700 staging directory (entered with `cd -P` and verified by
 * physical path, owner and mode, so the agent cannot swap the staged file for a symlink even when the parent
 * directory is agent-owned) and installed with `mv -fT` (never written through a final-component symlink).
 * Created entries are root-owned `u=rwX,go=rX`, and `rm -rf` never follows links. Entries stay read-only for the
 * agent only where their parent chain is root-owned (e.g. `/opt/agenstra/context`); in agent-owned directories
 * (e.g. `~/.config/opencode`) the agent can still remove or replace them, but never redirect root writes.
 * Args: $1 operation (write | touch | mkdir | delete), $2 absolute target. `write` reads base64 from stdin.
 */
export const AGENT_SYSTEM_FS_SCRIPT = [
  'set -eu',
  'op=$1',
  'target=$2',
  'parent=${target%/*}',
  'name=${target##*/}',
  `fail() { echo ${AGENT_PATH_OUTSIDE_MARKER}; exit 65; }`,
  'physical_cwd() { cwd=$(pwd -P && echo .); cwd=${cwd%?.}; }',
  // Private staging: `mktemp -d` creates a fresh 0700 dir owned by the exec user (root); verify it is still ours after entering it.
  'enter_stage() {',
  '  stage=$(mktemp -d ./.agenstra-stage.XXXXXX)',
  '  stage=${stage#./}',
  '  cd -P -- "$stage"',
  '  physical_cwd',
  '  [ "$cwd" = "$expected/$stage" ] || fail',
  '  [ "$(stat -c %u:%a .)" = "$(id -u):700" ] || fail',
  // `cd -P ..` follows the pinned directory's real parent, not the (agent-swappable) $PWD text.
  `  trap 'rm -f -- staged; cd -P .. && rmdir -- "$stage"' EXIT`,
  '}',
  'leave_stage() { trap - EXIT; cd -P .. && rmdir -- "$stage"; }',
  'case "$name" in ""|.|..) fail ;; esac',
  'cd /',
  'expected=',
  'set -f',
  'IFS=/',
  'for segment in $parent; do',
  '  [ -n "$segment" ] || continue',
  '  expected="$expected/$segment"',
  '  if [ -L "$segment" ]; then fail; fi',
  '  if [ ! -e "$segment" ]; then',
  `    if [ "$op" = delete ]; then echo ${AGENT_PATH_INSIDE_MARKER}; exit 0; fi`,
  '    mkdir -m 755 -- "$segment"',
  '  fi',
  '  cd -P -- "$segment"',
  '  physical_cwd',
  '  [ "$cwd" = "$expected" ] || fail',
  'done',
  'unset IFS',
  'set +f',
  'case "$op" in',
  '  write)',
  '    enter_stage',
  '    base64 -d > staged',
  '    chmod 644 -- staged',
  '    mv -fT -- staged "../$name"',
  '    leave_stage',
  '    ;;',
  '  touch)',
  '    if [ -L "$name" ]; then fail; fi',
  '    if [ ! -e "$name" ]; then',
  '      enter_stage',
  '      : > staged',
  '      chmod 644 -- staged',
  '      mv -fT -- staged "../$name"',
  '      leave_stage',
  '    fi',
  '    ;;',
  '  mkdir)',
  '    if [ -L "$name" ]; then fail; fi',
  '    [ -d "$name" ] || mkdir -m 755 -- "$name"',
  '    cd -P -- "$name"',
  '    physical_cwd',
  '    [ "$cwd" = "$target" ] || fail',
  // Directory itself only: a recursive chmod could follow hardlinks the agent planted in agent-owned trees.
  '    chmod u=rwX,go=rX .',
  '    ;;',
  '  delete)',
  '    rm -rf -- "$name"',
  '    ;;',
  '  *) exit 64 ;;',
  'esac',
  `echo ${AGENT_PATH_INSIDE_MARKER}`,
].join('\n');
