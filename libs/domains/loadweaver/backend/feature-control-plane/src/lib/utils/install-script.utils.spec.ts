import { AGENT_SYSTEMD_UNIT, buildNodeInstallScript } from './install-script.utils';

const options = {
  controlPlaneUrl: 'https://cp.example.com',
  caCertHash: `sha256:${'a'.repeat(64)}`,
  agentSha256: { amd64: 'b'.repeat(64) },
};

describe('node install script', () => {
  const script = buildNodeInstallScript(options);

  it('embeds no secrets and requires the token from the environment', () => {
    expect(script).toContain('[ -n "${LOADWEAVER_JOIN_TOKEN:-}" ] || die "set LOADWEAVER_JOIN_TOKEN"');
    expect(script).not.toMatch(/lwj_/);
  });

  it('pins the cluster CA and verifies the agent checksum before installing it', () => {
    expect(script).toContain(`LW_CA_HASH="sha256:${'a'.repeat(64)}"`);
    expect(script).toContain('sha256sum -c -');
    expect(script).toContain('--ca-cert-hash "$LW_CA_HASH"');
  });

  it('installs the node components with Docker live-restore and the shared gVisor block', () => {
    expect(script).toContain('wireguard-tools nftables bird2 keepalived');
    expect(script).toContain('net.ipv4.ip_nonlocal_bind = 1');
    expect(script).toContain('.["live-restore"] = true');
    expect(script).toContain('agenstra_prepare_gvisor');
    expect(script).toContain('net.ipv6.conf.all.forwarding = 1');
  });

  it('only supports Debian / Ubuntu LTS on amd64 / arm64 (3.21)', () => {
    expect(script).toContain('debian:12|debian:13|ubuntu:22.04|ubuntu:24.04) ;;');
  });

  it('rejects unsafe inputs that would end up in the script', () => {
    expect(() => buildNodeInstallScript({ ...options, controlPlaneUrl: 'http://cp.example.com' })).toThrow();
    expect(() => buildNodeInstallScript({ ...options, controlPlaneUrl: 'https://cp.example.com/$(reboot)' })).toThrow();
    expect(() => buildNodeInstallScript({ ...options, caCertHash: 'sha256:x' })).toThrow();
    expect(() => buildNodeInstallScript({ ...options, agentSha256: { amd64: 'x"; rm -rf /' } })).toThrow();
  });

  it('ships a hardened systemd unit', () => {
    expect(AGENT_SYSTEMD_UNIT).toContain('ExecStart=/usr/local/bin/loadweaver-agent run');
    expect(AGENT_SYSTEMD_UNIT).toContain('NoNewPrivileges=yes');
  });
});
