import { shellSingleQuote } from './env.utils';
import { buildSshdHardeningScript } from './ssh-hardening.utils';

export interface BareServerCloudInitConfig {
  ssh: {
    publicKey: string;
  };
}

export function buildBareServerCloudInitConfigFromRequest(
  effectiveConfig: Record<string, unknown>,
): BareServerCloudInitConfig {
  const publicKey = effectiveConfig['sshPublicKey'];

  return {
    ssh: {
      publicKey: typeof publicKey === 'string' ? publicKey : '',
    },
  };
}

/**
 * User data for plans without a provisioning process (`service: none`).
 * Installs no product stack: it only applies the SSH access baseline every provisioned host gets
 * (platform key in root's authorized_keys, password authentication disabled) so the customer can
 * reveal the access key and addons/updates can reach the host. Returned base64-encoded like the
 * integrated stacks and custom templates.
 */
export function buildBareServerCloudInitUserData(config: BareServerCloudInitConfig): string {
  const publicKey = config.ssh?.publicKey?.trim() ?? '';

  if (!publicKey) {
    throw new Error('Bare server provisioning requires an SSH public key');
  }

  const sshConfig = `
Include /etc/ssh/sshd_config.d/*.conf
PermitRootLogin prohibit-password
PasswordAuthentication no
KbdInteractiveAuthentication no
UsePAM yes
X11Forwarding no
PrintMotd no
AcceptEnv LANG LC_*
Subsystem       sftp    /usr/lib/openssh/sftp-server
`;
  const script = `#!/bin/bash
set -euo pipefail

# Cloud-init user-data script for bare server provisioning (no product stack)

log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $*" | tee -a /var/log/bare-server-provisioning.log
}

log "Starting bare server provisioning script (cloud-init user-data)"

for i in {1..10}; do
    if ping -c 1 -W 2 8.8.8.8 > /dev/null 2>&1; then
        log "Network is ready"
        break
    fi
    if [ $i -eq 10 ]; then
        log "WARNING: Network connectivity check failed, continuing anyway"
    fi
    sleep 1
done

export DEBIAN_FRONTEND=noninteractive
log "Updating system packages..."
apt-get update -qq
apt-get upgrade -y -qq

log "Installing openssh server..."
apt-get install -y openssh-server ssh

log "Adding SSH public key..."
mkdir -p /root/.ssh
chmod 700 /root/.ssh
printf '%s\\n' ${shellSingleQuote(publicKey)} > /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys

log "Configuring SSH server..."
cat > /etc/ssh/sshd_config <<'EOF'
${sshConfig}
EOF
${buildSshdHardeningScript()}
service ssh restart

log "Setting SSH password permanently..."
chage -d 1 -m 0 -M 99999 -I -1 -E -1 root

log "Bare server provisioning completed"
`;

  return Buffer.from(script).toString('base64');
}
