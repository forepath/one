import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildManifest, REQUIRED_HOST_PACKAGES } from '@forepath/loadweaver/shared/util-release';

import { hostUpdateScript } from './host-commands';
import { OsUpdateManager } from './os-update.manager';
import { UpdateActions } from './update-actions';

/** Required host packages (F2): nodes installed before a package became required get it with the next host update. */
describe('required host packages in host updates', () => {
  const base = {
    apt: { dir: '/var/lib/loadweaver/apt' },
    upgrade: false,
    install: {},
    birdGracefulRestart: false,
    resultFile: '/var/lib/loadweaver/updates/host-1.result',
  };

  /** Runs the rendered script against stubs: `installed` packages report `installed`, apt calls are logged. */
  const runStubbed = (requiredPackages: string[], installed: string[], aptFails = false) => {
    const dir = mkdtempSync(join(tmpdir(), 'lw-required-'));

    try {
      const script = hostUpdateScript({ ...base, requiredPackages, resultFile: join(dir, 'result') });
      const stubs = `
mkdir() { :; }
dpkg-query() { case " ${installed.join(' ')} " in *" \${@: -1} "*) echo installed ;; *) return 1 ;; esac; }
apt-get() { echo "apt-get $*" >> ${join(dir, 'calls')}; case "$*" in *' install '*) return ${aptFails ? 100 : 0} ;; esac; }
`;
      const result = spawnSync('/bin/bash', ['-c', `${stubs}\n${script.replace('#!/bin/bash\n', '')}`], {
        encoding: 'utf8',
      });
      const calls = existsSync(join(dir, 'calls')) ? readFileSync(join(dir, 'calls'), 'utf8') : '';

      return {
        status: result.status,
        stderr: result.stderr,
        result: readFileSync(join(dir, 'result'), 'utf8').trim(),
        calls,
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it('lists the microVM host packages as required', () => {
    expect(REQUIRED_HOST_PACKAGES).toEqual(expect.arrayContaining(['attr', 'e2fsprogs']));
  });

  it('installs missing required packages from the snapshot (the agent apt configuration only), after the pins', () => {
    const script = hostUpdateScript({
      ...base,
      upgrade: true,
      install: { bird2: '2.17.5-0+deb13u1' },
      requiredPackages: ['attr', 'e2fsprogs'],
    });

    expect(script).toContain("for spec in 'attr' 'e2fsprogs'; do");
    expect(script).toMatch(
      /'apt-get' '-o' 'Dir::Etc::sourcelist=\/var\/lib\/loadweaver\/apt\/sources.list' '-o' 'Dir::Etc::sourceparts=-' .* -y --no-install-recommends install "\$\{lw_missing\[@\]\}" \|\| lw_fail /,
    );
    expect(script.indexOf('-y dist-upgrade')).toBeLessThan(script.indexOf('lw_missing=()'));
    expect(script.indexOf("install 'bird2=2.17.5-0+deb13u1'")).toBeLessThan(script.indexOf('lw_missing=()'));
    // No reboot of its own (the control plane decides reboots from the kernel / reboot-required flag).
    expect(script).not.toContain('reboot');
    expect(spawnSync('/bin/bash', ['-n'], { input: script }).status).toBe(0);
    // Without required packages the step is left out.
    expect(hostUpdateScript(base)).not.toContain('lw_missing');
  });

  it('installs only the missing ones (stubbed host)', () => {
    const run = runStubbed(['attr', 'e2fsprogs'], ['e2fsprogs']);

    expect(run.status).toBe(0);
    expect(run.result).toBe('ok');
    expect(run.calls).toMatch(/-y --no-install-recommends install attr\n/);
    expect(run.calls).not.toContain('install e2fsprogs');
    expect(run.calls).toContain('Dir::Etc::sourcelist=/var/lib/loadweaver/apt/sources.list');
    expect(run.stderr).toContain('Required host packages from the snapshot: attr');
  });

  it('leaves present packages untouched', () => {
    const run = runStubbed(['attr', 'e2fsprogs'], ['attr', 'e2fsprogs']);

    expect(run.status).toBe(0);
    expect(run.result).toBe('ok');
    expect(run.calls).not.toContain(' install ');
  });

  it('installs pinned required packages at the pin and fails with the reason when the snapshot lacks one', () => {
    expect(runStubbed(['attr=1:2.5.2-3'], []).calls).toMatch(/install attr=1:2\.5\.2-3\n/);

    const failed = runStubbed(['attr', 'e2fsprogs'], [], true);

    expect(failed.status).not.toBe(0);
    expect(failed.result).toBe(
      "failed: required host packages attr e2fsprogs: not installable from the release's apt snapshot",
    );
  });

  it('rejects unsafe package names', () => {
    expect(() => hostUpdateScript({ ...base, requiredPackages: ['attr; rm -rf /'] })).toThrow('unsafe package');
    expect(() => hostUpdateScript({ ...base, requiredPackages: ['attr=$(id)'] })).toThrow('unsafe version');
  });

  it('runs on air-gapped clusters from the bundle snapshot (no upstream), also without an OS upgrade', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lw-required-airgap-'));

    try {
      const id = '6f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f';
      // The bundle's snapshot (the upstream archives were unreachable at plan time): served by the control plane.
      const host = {
        id,
        snapshot: 'bundle-3.5.0',
        aptBase: '/api/updates/apt/bundle-3.5.0',
        sources: [
          { name: 'debian-trixie', suites: ['trixie'], components: ['main'], keyring: '/usr/share/keyrings/d.gpg' },
        ],
        upgrade: false,
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

      const updates = join(dir, 'updates');
      const commands = {
        run: jest.fn(async (cmd: string) => {
          if (cmd === 'systemd-run') writeFileSync(join(updates, `host-${id}.result`), 'ok\n');

          return { stdout: cmd === 'dpkg-query' ? 'e2fsprogs 1.47.2-3 installed\n' : '', stderr: '' };
        }),
      };

      await new OsUpdateManager(
        updates,
        join(dir, 'apt'),
        commands as never,
        new UpdateActions(updates),
        jest.fn(),
      ).run(host, manifest, 'https://cp.example.com', '/api/updates/artifacts', {
        id: 'debian',
        versionId: '13',
        arch: 'amd64',
      });

      const script = readFileSync(join(updates, `host-${id}.sh`), 'utf8');
      const sources = readFileSync(join(dir, 'apt', 'sources.list'), 'utf8');

      expect(sources).toBe(
        'deb [signed-by=/usr/share/keyrings/d.gpg] https://cp.example.com/api/updates/apt/bundle-3.5.0/debian-trixie trixie main\n',
      );
      expect(script).toContain(`for spec in ${REQUIRED_HOST_PACKAGES.map((p) => `'${p}'`).join(' ')}; do`);
      expect(script).not.toContain('dist-upgrade');
      // Only the agent's apt configuration (the control plane's snapshot), never the host's sources or a URL.
      expect(script).toContain(`Dir::Etc::sourcelist=${join(dir, 'apt')}/sources.list`);
      expect(script).toContain('Dir::Etc::sourceparts=-');
      expect(script).not.toMatch(/https?:\/\//);
      expect(spawnSync('/bin/bash', ['-n'], { input: script }).status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
