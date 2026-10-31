import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildManifest } from '@forepath/loadweaver/shared/util-release';

import { hostUpdateScript } from './host-commands';
import { OsUpdateManager } from './os-update.manager';
import { UpdateActions } from './update-actions';

/** KVM preparation through Loadweaver's update path (3.1): modules from the snapshot, with the kernel; opt-out. */
describe('KVM in host updates (3.1)', () => {
  const base = {
    apt: { dir: '/var/lib/loadweaver/apt' },
    upgrade: true,
    install: {},
    birdGracefulRestart: false,
    resultFile: '/var/lib/loadweaver/updates/host-1.result',
  };
  const gvisor = {
    release: '20261012.0',
    tarball: '/var/lib/loadweaver/updates/files/g.tar.bz2',
    script: '/var/lib/loadweaver/updates/files/g.sh',
  };

  it('installs linux-modules-extra for the running and the next kernel at the kernel version, from the snapshot', () => {
    const script = hostUpdateScript({ ...base, kvmModules: true, gvisor });

    expect(script).toContain(
      'for KVER in $(printf \'%s\\n\' "$(uname -r)" "$(ls /lib/modules | sort -V | tail -1)" | sort -u); do',
    );
    expect(script).toContain('if modinfo -k "$KVER" "$lw_kvm_module" >/dev/null 2>&1; then continue; fi');
    expect(script).toContain('v=$(dpkg-query -W -f=\'${Version}\' "linux-image-$KVER"');
    // The agent's apt configuration only (the snapshot), exactly the kernel package's version.
    expect(script).toMatch(
      /'apt-get' '-o' 'Dir::Etc::sourcelist=\/var\/lib\/loadweaver\/apt\/sources.list' .* -y --no-install-recommends install "linux-modules-extra-\$KVER=\$v" \|\| echo "KVM modules: /,
    );
    // After the kernel arrives (dist-upgrade), before gVisor registers the KVM runtimes.
    expect(script.indexOf('-y dist-upgrade')).toBeLessThan(script.indexOf('linux-modules-extra-$KVER'));
    expect(script.indexOf('linux-modules-extra-$KVER')).toBeLessThan(
      script.indexOf("bash '/var/lib/loadweaver/updates/files/g.sh' install"),
    );
    // No upstream package installs from the shared installer.
    expect(script).toContain("AGENSTRA_KVM_APT=0 bash '/var/lib/loadweaver/updates/files/g.sh' install");
    expect(script).not.toContain('GVISOR_KVM=0');
    expect(script).not.toContain('reboot');
    expect(spawnSync('/bin/bash', ['-n'], { input: script }).status).toBe(0);
  });

  it('leaves KVM out for nodes that opted out (and without KVM use)', () => {
    const optedOut = hostUpdateScript({ ...base, gvisor: { ...gvisor, kvm: false } });

    expect(optedOut).toContain(
      "GVISOR_KVM=0 AGENSTRA_KVM=0 AGENSTRA_KVM_APT=0 bash '/var/lib/loadweaver/updates/files/g.sh' install",
    );
    expect(optedOut).not.toContain('linux-modules-extra');
    expect(spawnSync('/bin/bash', ['-n'], { input: optedOut }).status).toBe(0);
  });

  it('runs the KVM modules step without failing the update when the snapshot lacks the package', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lw-kvm-step-'));

    try {
      const script = hostUpdateScript({ ...base, upgrade: false, kvmModules: true, resultFile: join(dir, 'result') });
      // Stubbed host: the next kernel lacks kvm_intel, its extra package isn't in the snapshot.
      const stubs = `
uname() { echo 6.8.0-90-generic; }
ls() { printf '6.8.0-90-generic\\n6.8.0-100-generic\\n'; }
grep() { [ "$2" = vmx ]; }
modinfo() { [ "$2" = 6.8.0-90-generic ]; }
dpkg-query() { echo 6.8.0-100.100; }
mkdir() { :; }
apt-get() { echo "apt-get $*" >> ${join(dir, 'calls')}; case "$*" in *install*) return 100 ;; esac; }
`;
      const result = spawnSync('/bin/bash', ['-c', `${stubs}\n${script.replace('#!/bin/bash\n', '')}`], {
        encoding: 'utf8',
      });
      const calls = readFileSync(join(dir, 'calls'), 'utf8');

      expect(result.status).toBe(0);
      expect(readFileSync(join(dir, 'result'), 'utf8').trim()).toBe('ok');
      expect(calls).toContain('install linux-modules-extra-6.8.0-100-generic=6.8.0-100.100');
      expect(calls).not.toContain('linux-modules-extra-6.8.0-90-generic');
      expect(result.stderr).toContain(
        "linux-modules-extra-6.8.0-100-generic=6.8.0-100.100 is not in the release's apt snapshot",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('couples the modules to Ubuntu nodes that use KVM and are not opted out', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lw-kvm-update-'));

    try {
      let n = 0;
      const id = '6f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f';
      const host = {
        id,
        snapshot: 's-1',
        aptBase: '/api/updates/apt/s-1',
        sources: [
          { name: 'ubuntu-noble', suites: ['noble'], components: ['main'], keyring: '/usr/share/keyrings/u.gpg' },
        ],
        upgrade: true,
      };
      const manifest = buildManifest({
        version: '3.5.0',
        channel: 'stable',
        created: '2026-10-19T00:00:00.000Z',
        images: { 'control-plane': `ghcr.io/forepath/loadweaver-control-plane-api:3.5.0@sha256:${'c'.repeat(64)}` },
        agentBinaries: {},
      });

      delete (manifest.components as Record<string, unknown>)['drbd'];
      delete (manifest.components as Record<string, unknown>)['gvisor'];

      const scriptFor = async (os: { id: string; versionId: string }, kvm?: { optOut: boolean; capable: boolean }) => {
        const updates = join(dir, `updates-${n++}`);
        const commands = {
          run: jest.fn(async (cmd: string) => {
            if (cmd === 'systemd-run') writeFileSync(join(updates, `host-${id}.result`), 'ok\n');

            return { stdout: '', stderr: '' };
          }),
        };
        const actions = new UpdateActions(updates);

        await new OsUpdateManager(updates, join(dir, 'apt'), commands as never, actions, jest.fn()).run(
          host,
          manifest,
          'https://cp.example.com',
          '/api/updates/artifacts',
          { ...os, arch: 'amd64' },
          kvm,
        );

        return readFileSync(join(updates, `host-${id}.sh`), 'utf8');
      };

      expect(await scriptFor({ id: 'ubuntu', versionId: '24.04' }, { optOut: false, capable: true })).toContain(
        'linux-modules-extra-$KVER',
      );
      expect(await scriptFor({ id: 'ubuntu', versionId: '24.04' }, { optOut: true, capable: true })).not.toContain(
        'linux-modules-extra',
      );
      expect(await scriptFor({ id: 'ubuntu', versionId: '24.04' }, { optOut: false, capable: false })).not.toContain(
        'linux-modules-extra',
      );
      expect(await scriptFor({ id: 'ubuntu', versionId: '24.04' })).not.toContain('linux-modules-extra');
      // Debian ships KVM in linux-image-*.
      expect(await scriptFor({ id: 'debian', versionId: '13' }, { optOut: false, capable: true })).not.toContain(
        'linux-modules-extra',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
