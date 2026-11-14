import { buildBareServerCloudInitConfigFromRequest, buildBareServerCloudInitUserData } from './bare-server.utils';

function decode(userData: string): string {
  return Buffer.from(userData, 'base64').toString('utf8');
}

describe('bare-server.utils', () => {
  it('reads the SSH public key from the effective config', () => {
    expect(buildBareServerCloudInitConfigFromRequest({ sshPublicKey: 'ssh-rsa AAA' })).toEqual({
      ssh: { publicKey: 'ssh-rsa AAA' },
    });
    expect(buildBareServerCloudInitConfigFromRequest({ sshPublicKey: 42 })).toEqual({ ssh: { publicKey: '' } });
  });

  it('builds a base64 bash script that installs no product stack', () => {
    const script = decode(buildBareServerCloudInitUserData({ ssh: { publicKey: 'ssh-ed25519 AAAA key' } }));

    expect(script.startsWith('#!/bin/bash\nset -euo pipefail')).toBe(true);
    expect(script).toContain(`printf '%s\\n' 'ssh-ed25519 AAAA key' > /root/.ssh/authorized_keys`);
    expect(script).toContain('chmod 600 /root/.ssh/authorized_keys');
    expect(script).toContain('PasswordAuthentication no');
    expect(script).toContain('PermitRootLogin prohibit-password');
    expect(script).not.toMatch(/docker|compose|certbot|nginx/i);
  });

  it('writes the hardening as a drop-in that sorts before image drop-ins and validates sshd', () => {
    const script = decode(buildBareServerCloudInitUserData({ ssh: { publicKey: 'ssh-ed25519 AAAA key' } }));
    const dropIn = script.indexOf('cat > /etc/ssh/sshd_config.d/00-decabill-hardening.conf');

    expect(dropIn).toBeGreaterThan(-1);
    expect(script.slice(dropIn)).toMatch(
      /^[^]*PasswordAuthentication no\nKbdInteractiveAuthentication no\nSSHD_HARDENING_EOF/,
    );
    expect(script.indexOf('sshd -t')).toBeGreaterThan(dropIn);
    expect(script.indexOf('service ssh restart')).toBeGreaterThan(script.indexOf('sshd -t'));
  });

  it('quotes the key so shell metacharacters and line breaks cannot inject commands', () => {
    const script = decode(buildBareServerCloudInitUserData({ ssh: { publicKey: "ssh-rsa AAA'; rm -rf / #\nreboot" } }));

    expect(script).toContain(`printf '%s\\n' 'ssh-rsa AAA'\\''; rm -rf / # reboot' > /root/.ssh/authorized_keys`);
    expect(script).not.toContain('\nreboot');
  });

  it('fails closed without an SSH public key', () => {
    expect(() => buildBareServerCloudInitUserData({ ssh: { publicKey: '  ' } })).toThrow(
      'Bare server provisioning requires an SSH public key',
    );
  });
});
