/** sshd drop-in written by every generated user-data script; `00-` sorts before image drop-ins. */
export const SSHD_HARDENING_DROP_IN_PATH = '/etc/ssh/sshd_config.d/00-decabill-hardening.conf';

/**
 * Shell lines that enforce key-only SSH access, to run right before sshd is restarted.
 *
 * sshd keeps the first value it reads for most keywords and processes `Include` where it appears.
 * Generated `sshd_config` files start with `Include /etc/ssh/sshd_config.d/*.conf`, and provider images
 * ship drop-ins such as `50-cloud-init.conf` with `PasswordAuthentication yes` (written when the server is
 * created without provider SSH keys). A drop-in that sorts first therefore wins over both. `sshd -t`
 * validates the resulting configuration so a broken config fails the script instead of locking out SSH.
 */
export function buildSshdHardeningScript(): string {
  return `mkdir -p /etc/ssh/sshd_config.d
cat > ${SSHD_HARDENING_DROP_IN_PATH} <<'SSHD_HARDENING_EOF'
PermitRootLogin prohibit-password
PasswordAuthentication no
KbdInteractiveAuthentication no
SSHD_HARDENING_EOF
chmod 644 ${SSHD_HARDENING_DROP_IN_PATH}
sshd -t`;
}
