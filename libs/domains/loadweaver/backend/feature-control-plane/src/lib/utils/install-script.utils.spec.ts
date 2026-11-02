import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  AGENT_SYSTEMD_UNIT,
  buildComponentsScript,
  buildNodeInstallScript,
  kvmInstallSection,
  STORAGE_PACKAGE_PINS,
} from './install-script.utils';

const options = {
  controlPlaneUrl: 'https://cp.example.com',
  caCertHash: `sha256:${'a'.repeat(64)}`,
  agentSha256: { amd64: 'b'.repeat(64) },
};

describe('node install script', () => {
  const script = buildNodeInstallScript(options);

  it('is valid bash (installer and component script)', () => {
    execFileSync('bash', ['-n'], { input: script });
    execFileSync('bash', ['-n'], { input: buildComponentsScript() });
  });

  it('--discover installs only the agent and joins pending, before any component (3.21)', () => {
    expect(script).toContain('--discover) LW_DISCOVER=1; shift ;;');
    expect(script).toContain(
      'LW_JOIN=(join --discover --server "$LW_CP_URL" --name "$LW_NAME" --ca-cert-hash "$LW_CA_HASH")',
    );
    const discover = script.indexOf('if [ -n "$LW_DISCOVER" ]; then');

    // Nothing is installed (apt, Docker, sysctls) before the discover branch exits.
    expect(discover).toBeGreaterThan(0);
    expect(script.indexOf('lw_apt_install ca-certificates')).toBeGreaterThan(discover);
    expect(script.indexOf('/etc/sysctl.d/90-loadweaver.conf')).toBeGreaterThan(discover);
    expect(script.slice(discover, script.indexOf('exit 0', discover))).not.toMatch(
      /apt-get|sysctl|daemon\.json|modprobe/,
    );
    expect(script).toContain('--discover and --restore exclude each other');
  });

  it('keeps the VM lab copy of the component script in sync (UPDATE_GENERATED=1 rewrites it)', () => {
    const path = join(__dirname, '../../../../feature-node-agent/src/integration/vm-lab/components.generated.sh');

    if (process.env['UPDATE_GENERATED'] === '1') writeFileSync(path, buildComponentsScript());

    expect(readFileSync(path, 'utf8')).toBe(buildComponentsScript());
  });

  it('component script for imports: idempotent apt, rsync, never restarts Docker (3.21)', () => {
    const components = buildComponentsScript();

    // apt waits for a lock held by unattended-upgrades instead of failing (G5), in both scripts, before any apt run.
    for (const s of [components, script]) {
      const wrapper = s.indexOf('apt-get() { command apt-get -o DPkg::Lock::Timeout=600 "$@"; }');

      expect(wrapper).toBeGreaterThan(0);
      expect(s.indexOf('apt-get update')).toBeGreaterThan(wrapper);
    }

    expect(components).toContain(
      'lw_apt_install ca-certificates curl gnupg jq iproute2 wireguard-tools nftables bird2 keepalived rsync',
    );
    // MicroVM guest roots (3.35): setfattr (overlay whiteouts) and mkfs.ext4 (writable layers), installer and imports.
    expect(components).toContain('lw_apt_install attr e2fsprogs');
    expect(script).toContain('lw_apt_install attr e2fsprogs');
    expect(components).toContain('[ ${#missing[@]} -eq 0 ] && return 0');
    expect(components).toContain('.["live-restore"] = true');
    expect(components).not.toContain('systemctl reload docker || systemctl restart docker');
    expect(components).toContain('not restarting a host that runs containers');
    expect(components).not.toMatch(/loadweaver-agent|LOADWEAVER_JOIN_TOKEN/);
    // The installer itself may restart a fresh Docker.
    expect(script).toContain('systemctl reload docker || systemctl restart docker');
  });

  it('embeds no secrets and requires the token from the environment', () => {
    expect(script).toContain('[ -n "${LOADWEAVER_JOIN_TOKEN:-}" ] || die "set LOADWEAVER_JOIN_TOKEN"');
    expect(script).not.toMatch(/lwj_/);
  });

  it('restores a lost cluster with --restore: saved agent checked against the checksum, bootstrap --restore, no join', () => {
    expect(script).toContain('--restore) LW_RESTORE=1; shift ;;');
    expect(script).toContain('--) shift; LW_RESTORE_ARGS=("$@"); break ;;');
    expect(script).toContain('cp "$LW_AGENT_FILE" "$LW_TMP"');
    // The same checksum check for both paths, before anything is installed.
    expect(script.indexOf('sha256sum -c -')).toBeLessThan(script.indexOf('bootstrap --restore --name'));
    expect(script).toContain(
      '/usr/local/bin/loadweaver-agent bootstrap --restore --name "$LW_NAME" --public-host "$LW_ENDPOINT_HOST" "${LW_RESTORE_ARGS[@]}"',
    );
    // The unit comes from the script (the cluster that served it is gone).
    expect(script).toContain(`<<'LWUNIT'\n${AGENT_SYSTEMD_UNIT}LWUNIT`);
    expect(script).toContain('--agent-file and arguments after -- need --restore');
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

  it('installs the volume storage stack pinned per OS and checks for a DRBD 9 module (3.5)', () => {
    // Debian 13: the versions of the VM lab's golden image.
    expect(script).toContain(
      'debian:13) LW_STORAGE_PACKAGES=("lvm2=2.03.31-2" "cryptsetup=2:2.7.5-2" "drbd-utils=9.22.0-1.1" "thin-provisioning-tools=1.1.0-4+b1") ;;',
    );

    for (const os of ['debian:12', 'ubuntu:22.04', 'ubuntu:24.04'])
      expect(script).toContain(`  ${os}) LW_STORAGE_PACKAGES=(`);

    for (const pins of Object.values(STORAGE_PACKAGE_PINS))
      expect(Object.keys(pins).sort()).toEqual(['cryptsetup', 'drbd-utils', 'lvm2', 'thin-provisioning-tools']);

    expect(script).toContain('lw_apt_install "${LW_STORAGE_PACKAGES[@]}"');
    expect(script).toContain('modinfo -F version drbd');
    expect(script).toContain('comes with the Loadweaver release bundle');
  });

  it('installs the release-pinned gVisor tarball and leaves OS updates to Loadweaver (3.26)', () => {
    expect(script).toContain('GVISOR_RELEASE:-20261012.0');
    expect(script).toContain(
      '9606445eed5aedfcf05310e7ccef61d994089914c6622fc82624c24d2b18db1b2210f40e40a7be27b8b7772859de7d95c501b4eba66423053c960bf671377c5e',
    );
    expect(script).toContain('systemctl disable --now unattended-upgrades.service apt-daily-upgrade.timer');
  });

  describe('KVM host preparation (3.1)', () => {
    const snapshot = {
      aptBase: '/api/updates/apt/s-20261023-ab12',
      sources: [
        {
          name: 'ubuntu-noble',
          suites: ['noble', 'noble-updates'],
          components: ['main', 'universe'],
          arches: ['amd64'],
          keyring: '/usr/share/keyrings/ubuntu-archive-keyring.gpg',
          os: 'ubuntu:24.04',
        },
        {
          name: 'ubuntu-ports-noble',
          suites: ['noble'],
          components: ['main'],
          arches: ['arm64'],
          keyring: '/usr/share/keyrings/ubuntu-archive-keyring.gpg',
          os: 'ubuntu:24.04',
        },
        {
          name: 'debian-trixie',
          suites: ['trixie'],
          components: ['main'],
          arches: ['amd64'],
          keyring: '/usr/share/keyrings/debian-archive-keyring.gpg',
          os: 'debian:13',
        },
      ],
    };

    /** Runs the KVM section on a stubbed host; returns the apt calls, the sources it used and the exports. */
    function runSection(
      section: string,
      host: {
        id: string;
        versionId: string;
        arch?: string;
        cpu?: string;
        module?: boolean;
        env?: Record<string, string>;
      },
    ) {
      const dir = mkdtempSync(join(tmpdir(), 'lw-kvm-install-'));

      try {
        const stubs = `
ID=${host.id}; VERSION_ID=${host.versionId}
dpkg() { echo ${host.arch ?? 'amd64'}; }
uname() { echo 6.8.0-90-generic; }
grep() { case "$*" in *vmx*) [ "${host.cpu ?? 'vmx'}" != none ] ;; *) command grep "$@" ;; esac; }
modinfo() { [ "${host.module ? '1' : '0'}" = 1 ]; }
apt-get() { echo "apt-get $*" >> ${dir}/calls; for a in "$@"; do case "$a" in Dir::Etc::sourcelist=*) cp "\${a#*=}" ${dir}/sources ;; esac; done; }
`;
        const result = spawnSync(
          'bash',
          [
            '-c',
            `set -euo pipefail\n${stubs}\n${section}\necho "GVISOR_KVM=\${GVISOR_KVM:-} AGENSTRA_KVM=\${AGENSTRA_KVM:-} AGENSTRA_KVM_APT=\${AGENSTRA_KVM_APT:-}"`,
          ],
          { encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin', ...(host.env ?? {}) } },
        );
        const read = (f: string) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : '');

        return {
          status: result.status,
          stdout: result.stdout,
          stderr: result.stderr,
          calls: read('calls'),
          sources: read('sources'),
        };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }

    it('prepares KVM through the shared installer without its own package installs', () => {
      expect(script).toContain('AGENSTRA_GVISOR_KVM_ENABLED="$(printf \'%s\' "${GVISOR_KVM:-1}")"');
      expect(script).toContain('AGENSTRA_KVM_APT_ENABLED="$(printf \'%s\' "${AGENSTRA_KVM_APT:-0}")"');
      expect(script.indexOf('lw_kvm_modules\nfi\nexport AGENSTRA_KVM_APT=0')).toBeGreaterThan(0);
      expect(script.indexOf('export AGENSTRA_KVM_APT=0')).toBeLessThan(script.indexOf('agenstra_prepare_gvisor() {'));
      expect(buildComponentsScript()).toContain('AGENSTRA_KVM_APT:-0');
    });

    it('opts a node out with --no-kvm (no preparation, no KVM runtimes)', () => {
      expect(script).toContain('--no-kvm) LOADWEAVER_KVM=disabled; shift ;;');

      const out = runSection(kvmInstallSection(options.controlPlaneUrl, snapshot), {
        id: 'ubuntu',
        versionId: '24.04',
        env: { LOADWEAVER_KVM: 'disabled' },
      });

      expect(out.status).toBe(0);
      expect(out.calls).toBe('');
      expect(out.stdout).toContain('GVISOR_KVM=0 AGENSTRA_KVM=0 AGENSTRA_KVM_APT=0');
    });

    it("installs Ubuntu's missing KVM modules only from the cluster's apt snapshot", () => {
      const section = kvmInstallSection(options.controlPlaneUrl, snapshot);

      expect(section).toContain('    ubuntu:24.04:amd64) lw_kvm_source /usr/share/keyrings/ubuntu-archive-keyring.gpg');
      expect(section).toContain('    ubuntu:24.04:arm64) lw_kvm_source');
      expect(section).not.toContain('debian-trixie');
      execFileSync('bash', ['-n'], { input: section });

      // The section runs only where the keyring exists; the stubbed host uses /dev/null for it.
      const devnull = {
        ...snapshot,
        sources: snapshot.sources.map((s) => ({ ...s, keyring: '/dev/null' })),
      };
      const out = runSection(kvmInstallSection(options.controlPlaneUrl, devnull), { id: 'ubuntu', versionId: '24.04' });

      expect(out.status).toBe(0);
      expect(out.sources).toBe(
        'deb [signed-by=/dev/null] https://cp.example.com/api/updates/apt/s-20261023-ab12/ubuntu-noble noble main universe\n' +
          'deb [signed-by=/dev/null] https://cp.example.com/api/updates/apt/s-20261023-ab12/ubuntu-noble noble-updates main universe\n',
      );
      expect(out.calls).toContain('-o Dir::Etc::sourceparts=- ');
      expect(out.calls).toContain('install -y -q --no-install-recommends linux-modules-extra-6.8.0-90-generic');
      expect(out.stdout).toContain('AGENSTRA_KVM_APT=0');
      expect(out.stdout).not.toContain('GVISOR_KVM=0');
    });

    it('installs nothing when the module exists, the CPU lacks virtualization, on Debian or without a snapshot', () => {
      const section = kvmInstallSection(options.controlPlaneUrl, {
        ...snapshot,
        sources: snapshot.sources.map((s) => ({ ...s, keyring: '/dev/null' })),
      });

      expect(runSection(section, { id: 'ubuntu', versionId: '24.04', module: true }).calls).toBe('');
      expect(runSection(section, { id: 'ubuntu', versionId: '24.04', cpu: 'none' }).calls).toBe('');
      expect(runSection(section, { id: 'debian', versionId: '13' }).calls).toBe('');
      expect(runSection(section, { id: 'ubuntu', versionId: '22.04' }).calls).toBe('');

      const none = runSection(kvmInstallSection(options.controlPlaneUrl, undefined), {
        id: 'ubuntu',
        versionId: '24.04',
      });

      expect(none.status).toBe(0);
      expect(none.calls).toBe('');
      expect(none.stderr).toContain('comes with the next host update');
    });

    it('rejects snapshot sources that would end up unsafe in the script', () => {
      const bad = (patch: Record<string, unknown>) => ({
        aptBase: '/api/updates/apt/s-1',
        sources: [{ ...snapshot.sources[0], ...patch }],
      });

      expect(() => buildNodeInstallScript({ ...options, aptSnapshot: bad({ name: 'x; rm -rf /' }) })).toThrow();
      expect(() => buildNodeInstallScript({ ...options, aptSnapshot: bad({ suites: ['$(id)'] }) })).toThrow();
      expect(() => buildNodeInstallScript({ ...options, aptSnapshot: bad({ keyring: '/k" x' }) })).toThrow();
      expect(() => buildNodeInstallScript({ ...options, aptSnapshot: { aptBase: '/x y', sources: [] } })).toThrow();
      execFileSync('bash', ['-n'], { input: buildNodeInstallScript({ ...options, aptSnapshot: snapshot }) });
    });
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
