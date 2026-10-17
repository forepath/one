import { GVISOR_PIN, PACKAGE_PINS } from '@forepath/loadweaver/shared/util-release';
import { buildGvisorInstallScript } from '@forepath/shared/backend/util-container-runtime';

export interface InstallScriptOptions {
  /** Public HTTPS URL of the control plane (configured, never taken from request headers). */
  controlPlaneUrl: string;
  /** `sha256:<hex>` of the cluster CA (DER), pinned by the agent during join. */
  caCertHash: string;
  /** SHA-256 of the agent binaries served by this control plane, per architecture. */
  agentSha256: Partial<Record<'amd64' | 'arm64', string>>;
}

/**
 * Storage packages for replicated volumes (3.5: LVM thin → LUKS2 → DRBD 9), pinned per supported OS to the versions
 * Loadweaver is tested with — from the release pins (`util-release`, the source of truth the bundle is built from).
 * Only the userland: the DRBD 9 kernel module comes with the Loadweaver release bundle (distribution kernels ship
 * DRBD 8.4).
 */
export const STORAGE_PACKAGE_PINS = PACKAGE_PINS.storage as Record<
  'debian:12' | 'debian:13' | 'ubuntu:22.04' | 'ubuntu:24.04',
  Record<'lvm2' | 'cryptsetup' | 'drbd-utils' | 'thin-provisioning-tools', string>
>;

function storagePackageCases(): string {
  return Object.entries(STORAGE_PACKAGE_PINS)
    .map(
      ([os, pins]) =>
        `  ${os}) LW_STORAGE_PACKAGES=(${Object.entries(pins)
          .map(([pkg, version]) => `"${pkg}=${version}"`)
          .join(' ')}) ;;`,
    )
    .join('\n');
}

const URL_PATTERN = /^https:\/\/[A-Za-z0-9.-]+(:\d{1,5})?(\/[A-Za-z0-9._~/-]*)?$/;
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SHA_PATTERN = /^[0-9a-f]{64}$/;

/**
 * The node components (3.21, 3.26): base and storage packages (pinned), DRBD 9 module check, Docker with live-restore,
 * gVisor, no unattended upgrades, WireGuard / forwarding sysctls, BIRD, keepalived. Idempotent: only missing packages
 * are installed (no apt run when everything is there), Docker is installed only when absent. `restartDocker: false`
 * (import of a running host) only reloads Docker — live-restore is reloadable, running containers are never stopped.
 * Expects `$ID` / `$VERSION_ID` / `$VERSION_CODENAME` from `/etc/os-release`.
 */
function componentsSection(options: { restartDocker: boolean }): string {
  const restart = options.restartDocker
    ? 'systemctl reload docker || systemctl restart docker'
    : 'systemctl reload docker || { echo "loadweaver-components: Docker did not reload (live-restore); not restarting a host that runs containers" >&2; exit 1; }';

  return `export DEBIAN_FRONTEND=noninteractive
LW_APT_UPDATED=""
# Installs the packages (name or name=version) that are missing or at another version; nothing when all are there.
lw_apt_install() {
  local missing=() spec name want have
  for spec in "$@"; do
    name="\${spec%%=*}"; want=""; [ "$name" = "$spec" ] || want="\${spec#*=}"
    have="$(dpkg-query -W -f='\${db:Status-Status} \${Version}' "$name" 2>/dev/null || true)"
    case "$have" in
      "installed "*) [ -z "$want" ] || [ "\${have#installed }" = "$want" ] || missing+=("$spec") ;;
      *) missing+=("$spec") ;;
    esac
  done
  [ \${#missing[@]} -eq 0 ] && return 0
  [ -n "$LW_APT_UPDATED" ] || { apt-get update -q; LW_APT_UPDATED=1; }
  apt-get install -y -q --no-install-recommends "\${missing[@]}"
}
lw_apt_install ca-certificates curl gnupg jq iproute2 wireguard-tools nftables bird2 keepalived rsync

# Replicated volumes (LVM thin -> LUKS2 -> DRBD 9): userland pinned to the tested versions.
case "$ID:$VERSION_ID" in
${storagePackageCases()}
esac
lw_apt_install "\${LW_STORAGE_PACKAGES[@]}"
# The DRBD 9 kernel module (built and signed for Secure Boot) comes with the Loadweaver release bundle; distribution
# kernels ship DRBD 8.4. The agent reports whether DRBD 9 is loadable (capability drbd9); without it the control
# plane places no volumes on this node.
if [ "$(modinfo -F version drbd 2>/dev/null | cut -d. -f1)" -ge 9 ] 2>/dev/null; then
  echo drbd > /etc/modules-load.d/loadweaver-drbd.conf
  modprobe drbd
else
  echo "loadweaver-install: no DRBD 9 kernel module on this host; it gets no volume replicas until one is installed" >&2
fi

# Docker Engine with live-restore, so agent and daemon upgrades never stop workloads (3.26).
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/$ID/gpg" | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/$ID $VERSION_CODENAME stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -y -q --no-install-recommends docker-ce docker-ce-cli containerd.io
fi
mkdir -p /etc/docker
[ -s /etc/docker/daemon.json ] || echo '{}' > /etc/docker/daemon.json
jq '.["live-restore"] = true' /etc/docker/daemon.json > /etc/docker/daemon.json.loadweaver
mv /etc/docker/daemon.json.loadweaver /etc/docker/daemon.json
systemctl enable --now docker
${restart}

${buildGvisorInstallScript({ release: GVISOR_PIN.release, sha512: { x86_64: GVISOR_PIN.sha512.amd64, aarch64: GVISOR_PIN.sha512.arm64 } })}
# OS updates are orchestrated by Loadweaver (3.26: drain → update → reboot, from the cluster-local apt snapshot), so
# reboots never happen uncoordinated: no unattended upgrades of their own.
systemctl disable --now unattended-upgrades.service apt-daily-upgrade.timer >/dev/null 2>&1 || true
# Kernel features for the overlay: WireGuard, forwarding for IPv4 and IPv6.
modprobe wireguard
cat > /etc/sysctl.d/90-loadweaver.conf <<'SYSCTL'
net.ipv4.ip_forward = 1
net.ipv6.conf.all.forwarding = 1
# The ingress listens on failover addresses this node may not hold right now (3.6).
net.ipv4.ip_nonlocal_bind = 1
net.ipv6.ip_nonlocal_bind = 1
SYSCTL
sysctl --system >/dev/null

systemctl enable --now bird
# keepalived starts once the agent writes a configuration with VRRP addresses (3.6).
mkdir -p /etc/keepalived
systemctl enable keepalived
`;
}

/**
 * The one-line installer (3.21): `curl -fsSL <cp>/api/install/install.sh | sudo LOADWEAVER_JOIN_TOKEN=... bash -s -- --name n2`.
 * Installs Docker (live-restore), gVisor (the release's pinned tarball), WireGuard, nftables, BIRD and the volume
 * storage stack (LVM thin, LUKS2, DRBD 9 userland; pinned), checks for a DRBD 9 kernel module, turns off unattended
 * upgrades (Loadweaver orchestrates OS updates), then the node agent from this cluster
 * (checksum-verified) and joins with the token. Nothing secret is embedded; the token comes from the user.
 *
 * `--restore` (whole-cluster disaster recovery, 3.20): the same host setup on a fresh node, but no join — the agent
 * binary comes from `--agent-file` (saved with the recovery kit: this cluster is gone; checked against the same
 * checksum), the systemd unit is written from the script, and `loadweaver-agent bootstrap --restore` runs with the
 * arguments after `--` (DR info, kit shares or KMS, target credentials from the environment).
 */
export function buildNodeInstallScript(options: InstallScriptOptions): string {
  if (!URL_PATTERN.test(options.controlPlaneUrl)) throw new Error('control-plane URL must be a plain https URL');

  if (!HASH_PATTERN.test(options.caCertHash)) throw new Error('invalid CA hash');

  for (const sha of Object.values(options.agentSha256)) {
    if (sha && !SHA_PATTERN.test(sha)) throw new Error('invalid agent checksum');
  }

  return `#!/usr/bin/env bash
# Loadweaver node installer, generated by the control plane at ${options.controlPlaneUrl}.
# Usage: curl -fsSL ${options.controlPlaneUrl}/api/install/install.sh | sudo LOADWEAVER_JOIN_TOKEN=<token> bash -s -- --name <node> [--endpoint-host <public host>] [--label k=v ...]
# Import a host that already runs things (or a former node): add --discover (only the agent is installed; it
# discovers read-only and waits for the join plan from the console's import wizard).
# Disaster recovery (the cluster is lost; run the copy of this script saved with the recovery kit):
#   sudo LOADWEAVER_DR_ACCESS_KEY_ID=... LOADWEAVER_DR_SECRET_ACCESS_KEY=... bash install.sh --restore --name <node> \
#     --endpoint-host <public host> --agent-file <saved loadweaver-agent> -- --dr-info <file> --share-file <f> --share-file <f>
set -euo pipefail

LW_CP_URL="${options.controlPlaneUrl}"
LW_CA_HASH="${options.caCertHash}"
LW_AGENT_SHA256_AMD64="${options.agentSha256.amd64 ?? ''}"
LW_AGENT_SHA256_ARM64="${options.agentSha256.arm64 ?? ''}"
LW_NAME=""
LW_ENDPOINT_HOST=""
LW_LABELS=()
LW_RESTORE=""
LW_AGENT_FILE=""
LW_RESTORE_ARGS=()
LW_DISCOVER=""

die() { echo "loadweaver-install: $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --name) LW_NAME="\${2:-}"; shift 2 ;;
    --endpoint-host) LW_ENDPOINT_HOST="\${2:-}"; shift 2 ;;
    --label) LW_LABELS+=(--label "\${2:-}"); shift 2 ;;
    --restore) LW_RESTORE=1; shift ;;
    --discover) LW_DISCOVER=1; shift ;;
    --agent-file) LW_AGENT_FILE="\${2:-}"; shift 2 ;;
    --) shift; LW_RESTORE_ARGS=("$@"); break ;;
    *) die "unknown option $1" ;;
  esac
done

[ "$(id -u)" -eq 0 ] || die "run as root (sudo)"
[ -z "$LW_DISCOVER" ] || [ -z "$LW_RESTORE" ] || die "--discover and --restore exclude each other"
if [ -n "$LW_RESTORE" ]; then
  [ -n "$LW_ENDPOINT_HOST" ] || die "--restore needs --endpoint-host (the restored control plane's public host)"
  [ -n "$LW_AGENT_FILE" ] && [ -f "$LW_AGENT_FILE" ] || die "--restore needs --agent-file (the loadweaver-agent saved with the recovery kit)"
  [ \${#LW_LABELS[@]} -eq 0 ] || die "--label is not used with --restore (the restored node keeps no labels; set them later)"
else
  [ -n "\${LOADWEAVER_JOIN_TOKEN:-}" ] || die "set LOADWEAVER_JOIN_TOKEN"
  [ \${#LW_RESTORE_ARGS[@]} -eq 0 ] && [ -z "$LW_AGENT_FILE" ] || die "--agent-file and arguments after -- need --restore"
fi
[ -n "$LW_NAME" ] || LW_NAME="$(hostname -s | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9-\\n' '-')"
printf '%s' "$LW_NAME" | grep -Eq '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$' || die "invalid node name '$LW_NAME'"

# Supported hosts: Debian 12 / 13, Ubuntu 22.04 / 24.04 LTS on amd64 / arm64.
. /etc/os-release
case "$ID:$VERSION_ID" in
  debian:12|debian:13|ubuntu:22.04|ubuntu:24.04) ;;
  *) die "unsupported OS $ID $VERSION_ID" ;;
esac
case "$(uname -m)" in
  x86_64|amd64) LW_ARCH=amd64; LW_AGENT_SHA256="$LW_AGENT_SHA256_AMD64" ;;
  aarch64|arm64) LW_ARCH=arm64; LW_AGENT_SHA256="$LW_AGENT_SHA256_ARM64" ;;
  *) die "unsupported architecture $(uname -m)" ;;
esac
[ -n "$LW_AGENT_SHA256" ] || die "this control plane serves no agent for $LW_ARCH"

# Node agent from this cluster, verified before it is installed (3.26: nodes fetch only from the cluster). In a
# disaster recovery the cluster is gone: the saved binary, verified against the same checksum.
LW_TMP="$(mktemp)"
trap 'rm -f "$LW_TMP"' EXIT
lw_install_agent() {
  if [ -n "$LW_RESTORE" ]; then
    cp "$LW_AGENT_FILE" "$LW_TMP"
  else
    curl -fsSL "$LW_CP_URL/api/install/agent/$LW_ARCH" -o "$LW_TMP"
  fi
  echo "$LW_AGENT_SHA256  $LW_TMP" | sha256sum -c - >/dev/null || die "agent checksum mismatch"
  install -m 0755 "$LW_TMP" /usr/local/bin/loadweaver-agent
}

# Import of an existing Docker host or former node (3.21): only the agent binary and its unit. The agent discovers
# read-only and joins as pending; nothing else on the host changes until the join plan is approved in the console,
# which installs the components (the same steps as below, idempotent) as its first step.
if [ -n "$LW_DISCOVER" ]; then
  systemctl stop loadweaver-agent >/dev/null 2>&1 || true
  lw_install_agent
  curl -fsSL "$LW_CP_URL/api/install/loadweaver-agent.service" -o /etc/systemd/system/loadweaver-agent.service
  LW_JOIN=(join --discover --server "$LW_CP_URL" --name "$LW_NAME" --ca-cert-hash "$LW_CA_HASH")
  [ -z "$LW_ENDPOINT_HOST" ] || LW_JOIN+=(--endpoint-host "$LW_ENDPOINT_HOST")
  LOADWEAVER_JOIN_TOKEN="$LOADWEAVER_JOIN_TOKEN" /usr/local/bin/loadweaver-agent "\${LW_JOIN[@]}" "\${LW_LABELS[@]}"
  systemctl daemon-reload
  systemctl enable --now loadweaver-agent
  echo "Node $LW_NAME discovered and pending: choose what to import in the console (Nodes > Import $LW_NAME)."
  exit 0
fi

${componentsSection({ restartDocker: true })}
lw_install_agent

if [ -n "$LW_RESTORE" ]; then
  cat > /etc/systemd/system/loadweaver-agent.service <<'LWUNIT'
${AGENT_SYSTEMD_UNIT}LWUNIT
  /usr/local/bin/loadweaver-agent bootstrap --restore --name "$LW_NAME" --public-host "$LW_ENDPOINT_HOST" "\${LW_RESTORE_ARGS[@]}"
  systemctl daemon-reload
  systemctl enable --now loadweaver-agent
  echo "Cluster restored on $LW_NAME. Join the other nodes again with new join tokens."
  exit 0
fi
curl -fsSL "$LW_CP_URL/api/install/loadweaver-agent.service" -o /etc/systemd/system/loadweaver-agent.service

LW_JOIN=(join --server "$LW_CP_URL" --name "$LW_NAME" --ca-cert-hash "$LW_CA_HASH")
[ -z "$LW_ENDPOINT_HOST" ] || LW_JOIN+=(--endpoint-host "$LW_ENDPOINT_HOST")
LOADWEAVER_JOIN_TOKEN="$LOADWEAVER_JOIN_TOKEN" /usr/local/bin/loadweaver-agent "\${LW_JOIN[@]}" "\${LW_LABELS[@]}"
systemctl daemon-reload
systemctl enable --now loadweaver-agent
echo "Node $LW_NAME joined the cluster."
`;
}

/**
 * The join plan's component step (3.21): the installer's component setup as a standalone, idempotent script, run by
 * the agent on an imported host. Never restarts Docker (the host runs containers; live-restore is reloaded).
 */
export function buildComponentsScript(): string {
  return `#!/usr/bin/env bash
# Loadweaver node components for an imported host (join plan step "components"); idempotent.
set -euo pipefail
. /etc/os-release
case "$ID:$VERSION_ID" in
  debian:12|debian:13|ubuntu:22.04|ubuntu:24.04) ;;
  *) echo "loadweaver-components: unsupported OS $ID $VERSION_ID" >&2; exit 1 ;;
esac
${componentsSection({ restartDocker: false })}
echo "loadweaver-components: installed"
`;
}

/** systemd unit of the node agent (served by the control plane next to the binary). */
export const AGENT_SYSTEMD_UNIT = `# Loadweaver node agent (3.21). Runs outside Docker on purpose: it manages Docker and the host network,
# and must keep working while Docker is down or being upgraded.
[Unit]
Description=Loadweaver node agent
Documentation=https://loadweaver.com/docs
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/loadweaver-agent run
Restart=always
RestartSec=2
Environment=LOADWEAVER_STATE_DIR=/var/lib/loadweaver
# Needs root for WireGuard, nftables, BIRD and Docker; everything else is locked down.
NoNewPrivileges=yes
ProtectSystem=full
ProtectHome=yes
PrivateTmp=yes
ReadWritePaths=/var/lib/loadweaver /etc/bird /etc/keepalived /run
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
`;
