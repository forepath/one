import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { DESKTOP_APPS } from '../apps';

import {
  aptReleaseOptions,
  aptSourcesFile,
  buildLinuxRepos,
  findExecutable,
  linuxArches,
  parseSecretKeyFingerprint,
  rpmRepoFile,
  rpmSpec,
  rpmVersion,
} from './linux';
import type { Log, RunOptions } from './process';

const app = DESKTOP_APPS['agenstra'];
const FPR = 'ABCDEF0123456789ABCDEF0123456789ABCDEF01';
const quiet: Log = { info: () => undefined, warn: () => undefined };

describe('rpm packaging', () => {
  it('maps versions and arches', () => {
    expect(rpmVersion('1.2.3')).toBe('1.2.3');
    expect(rpmVersion('1.2.3-beta.4')).toBe('1.2.3~beta.4');
    expect(linuxArches('x64')).toEqual({ rpm: 'x86_64', deb: 'amd64' });
    expect(() => linuxArches('ia32')).toThrow();
  });

  it('writes a spec with the deb layout, no stripping and the setuid sandbox', () => {
    const spec = rpmSpec(app, {
      version: '1.2.3-beta.1',
      arch: 'x64',
      packagedDir: '/w/out/native-agent-console-linux-x64',
      desktopFile: '/t/agenstra.desktop',
      iconFile: '/w/icon.png',
    });

    expect(spec).toContain('Name: agenstra\nVersion: 1.2.3~beta.1\nRelease: 1');
    expect(spec).toContain('BuildArch: x86_64');
    expect(spec).toContain('%global __os_install_post %{nil}');
    expect(spec).toContain('cp -a /w/out/native-agent-console-linux-x64/. %{buildroot}/usr/lib/agenstra/');
    expect(spec).toContain('chmod -R u+rwX,go+rX,go-w %{buildroot}/usr/lib/agenstra\n');
    expect(spec).toContain('ln -s /usr/lib/agenstra/native-agent-console %{buildroot}/usr/bin/agenstra');
    expect(spec).toContain('%attr(4755, root, root) /usr/lib/agenstra/chrome-sandbox');
    expect(spec).toContain('Requires: nss');
  });

  it('refuses paths that would need shell quoting in the spec', () => {
    expect(() =>
      rpmSpec(app, { version: '1.0.0', arch: 'x64', packagedDir: '/w/a b', desktopFile: '/d', iconFile: '/i' }),
    ).toThrow();
    expect(() =>
      rpmSpec(app, { version: '1.0.0', arch: 'x64', packagedDir: '/w/$(id)', desktopFile: '/d', iconFile: '/i' }),
    ).toThrow();
  });
});

describe('repository metadata', () => {
  it('parses the fingerprint of the imported secret key', () => {
    const colons = [
      'sec:u:4096:1:0123456789ABCDEF:1700000000:::u:::scESC:::+:::23::0:',
      `fpr:::::::::${FPR}:`,
      'uid:u::::',
    ].join('\n');

    expect(parseSecretKeyFingerprint(colons)).toBe(FPR);
    expect(() => parseSecretKeyFingerprint('pub:u:4096\nfpr:::::::::ABC:')).toThrow();
  });

  it('builds apt Release options and client configuration', () => {
    expect(aptReleaseOptions(app, 'beta', ['amd64'])).toEqual(
      expect.arrayContaining(['APT::FTPArchive::Release::Suite=beta', 'APT::FTPArchive::Release::Architectures=amd64']),
    );
    // 30 days; apt-ftparchive ignores a plain Valid-Until override, only ValidTime makes it write the field.
    expect(aptReleaseOptions(app, 'stable', ['amd64'])).toContain('APT::FTPArchive::Release::ValidTime=2592000');
    expect(aptReleaseOptions(app, 'stable', ['amd64']).some((a) => a.includes('Valid-Until'))).toBe(false);
    expect(aptSourcesFile(app, 'stable')).toContain('URIs: https://downloads.agenstra.com/apt\nSuites: stable');
    expect(aptSourcesFile(app, 'stable')).toContain('Signed-By: /usr/share/keyrings/forepath-desktop.gpg');
    expect(rpmRepoFile(app, 'stable')).toContain('baseurl=https://downloads.agenstra.com/rpm/stable/$basearch');
    expect(rpmRepoFile(app, 'stable')).toContain('repo_gpgcheck=1');
  });
});

describe('buildLinuxRepos', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'desktop-repo-spec-'));
    mkdirSync(join(dir, 'make', 'deb', 'x64'), { recursive: true });
    mkdirSync(join(dir, 'make', 'rpm', 'x64'), { recursive: true });
    writeFileSync(join(dir, 'make', 'deb', 'x64', 'agenstra_1.2.3_amd64.deb'), 'deb');
    writeFileSync(join(dir, 'make', 'rpm', 'x64', 'agenstra-1.2.3-1.x86_64.rpm'), 'rpm');
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  let releaseExtra = 'Valid-Until: Fri, 20 Nov 2026 12:00:00 UTC\n';

  it('signs rpms, builds signed apt and rpm repositories per channel and removes the keyring', () => {
    const calls: { command: string; args: readonly string[]; options?: RunOptions }[] = [];
    let home = '';
    const run = (command: string, args: readonly string[], options?: RunOptions): string => {
      calls.push({ command, args, options });
      home ||= args[args.indexOf('--homedir') + 1] ?? '';

      if (command === 'gpg' && args.includes('--list-secret-keys'))
        return `sec:u:4096:1:X:1:::u:::scESC:\nfpr:::::::::${FPR}:\n`;

      if (command === 'gpg' && args.includes('--export')) return '-----BEGIN PGP PUBLIC KEY BLOCK-----';

      if (command === 'apt-ftparchive')
        return args.includes('packages') ? 'Package: agenstra\n' : `Origin: ForePath\n${releaseExtra}`;

      if (command === 'createrepo_c') mkdirSync(join(args[args.length - 1], 'repodata'), { recursive: true });

      return '';
    };
    const out = join(dir, 'repo');

    buildLinuxRepos(
      app,
      {
        channels: ['stable', 'beta'],
        packagesDir: join(dir, 'make'),
        outDir: out,
        env: { DESKTOP_LINUX_GPG_PRIVATE_KEY: 'KEY', DESKTOP_LINUX_GPG_PASSPHRASE: 'pw' },
        gpgPath: '/usr/bin/gpg',
      },
      run,
      quiet,
    );

    expect(calls[0]).toMatchObject({ command: 'gpg', options: { input: 'KEY' } });
    expect(calls[0].args).toContain('--import');
    expect(calls.find((c) => c.command === 'rpmsign')?.args).toEqual(
      expect.arrayContaining([
        '--addsign',
        '__gpg /usr/bin/gpg',
        `_gpg_name ${FPR}`,
        join(dir, 'make', 'rpm', 'x64', 'agenstra-1.2.3-1.x86_64.rpm'),
      ]),
    );
    expect(calls.find((c) => c.command === 'rpmsign')?.args.find((a) => a.startsWith('__gpg_sign_cmd '))).toMatch(
      /^__gpg_sign_cmd %\{__gpg\} gpg --homedir /,
    );
    // No secret value ever appears in an argument list.
    expect(calls.flatMap((c) => c.args).some((a) => a.includes('KEY') || a === 'pw')).toBe(false);

    for (const channel of ['stable', 'beta']) {
      expect(readFileSync(join(out, 'apt', 'dists', channel, 'main', 'binary-amd64', 'Packages'), 'utf8')).toContain(
        'agenstra',
      );
      expect(readFileSync(join(out, 'apt', 'dists', channel, 'Release'), 'utf8')).toContain('ForePath');
      expect(existsSync(join(out, 'rpm', channel, 'x86_64', 'agenstra-1.2.3-1.x86_64.rpm'))).toBe(true);
      expect(readFileSync(join(out, 'rpm', channel, 'agenstra.repo'), 'utf8')).toContain(`[agenstra-${channel}]`);
      expect(
        calls.some(
          (c) => c.args.includes('--clearsign') && c.args.includes(join(out, 'apt', 'dists', channel, 'InRelease')),
        ),
      ).toBe(true);
      expect(
        calls.some((c) => c.args.includes(join(out, 'rpm', channel, 'x86_64', 'repodata', 'repomd.xml.asc'))),
      ).toBe(true);
    }

    expect(existsSync(join(out, 'apt', 'pool', 'main', 'a', 'agenstra', 'agenstra_1.2.3_amd64.deb'))).toBe(true);
    expect(readFileSync(join(out, 'forepath-desktop.asc'), 'utf8')).toContain('PGP PUBLIC KEY');
    expect(calls[calls.length - 1]).toMatchObject({ command: 'gpgconf' });
    expect(home).not.toBe('');
    expect(existsSync(home)).toBe(false);
  });

  it('refuses an apt Release without Valid-Until and still removes the keyring', () => {
    releaseExtra = '';
    let home = '';
    const run = (command: string, args: readonly string[]): string => {
      home ||= args[args.indexOf('--homedir') + 1] ?? '';

      if (command === 'gpg' && args.includes('--list-secret-keys'))
        return `sec:u:4096:1:X:1:::u:::scESC:\nfpr:::::::::${FPR}:\n`;

      if (command === 'apt-ftparchive') return args.includes('packages') ? 'Package: agenstra\n' : 'Origin: ForePath\n';

      if (command === 'createrepo_c') mkdirSync(join(args[args.length - 1], 'repodata'), { recursive: true });

      return '';
    };

    expect(() =>
      buildLinuxRepos(
        app,
        {
          channels: ['stable'],
          packagesDir: join(dir, 'make'),
          outDir: join(dir, 'repo'),
          env: { DESKTOP_LINUX_GPG_PRIVATE_KEY: 'KEY' },
          gpgPath: '/usr/bin/gpg',
        },
        run,
        quiet,
      ),
    ).toThrow(/no Valid-Until/);
    expect(existsSync(home)).toBe(false);
    releaseExtra = 'Valid-Until: Fri, 20 Nov 2026 12:00:00 UTC\n';
  });

  it('finds gpg on PATH by absolute path only (rpmsign execs it without a lookup)', () => {
    const bin = join(dir, 'bin');

    mkdirSync(bin);
    writeFileSync(join(bin, 'gpg'), '#!/bin/sh\n', { mode: 0o755 });
    writeFileSync(join(bin, 'gpg2'), 'not executable', { mode: 0o644 });

    expect(findExecutable('gpg', `relative/bin${delimiter}${bin}`)).toBe(join(bin, 'gpg'));
    expect(findExecutable('gpg2', bin)).toBeUndefined();
  });

  it('fails without packages', () => {
    expect(() =>
      buildLinuxRepos(
        app,
        { channels: ['stable'], packagesDir: join(dir, 'none'), outDir: join(dir, 'o') },
        () => '',
        quiet,
      ),
    ).toThrow(/no .deb/);
  });
});
