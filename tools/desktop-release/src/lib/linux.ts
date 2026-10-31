import {
  accessSync,
  chmodSync,
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, isAbsolute, join, resolve } from 'node:path';

import type { DesktopUpdateChannel } from '@forepath/shared/shared/util-release-signing';

import type { DesktopAppConfig } from '../apps';

import type { Log, Runner } from './process';

/** rpm versions can't contain `-`: prereleases use `~`, which sorts before the release (`1.2.0~beta.1` < `1.2.0`). */
export function rpmVersion(version: string): string {
  return version.replace('-', '~');
}

/** Forge arch → rpm / Debian arch. */
export function linuxArches(arch: string): { rpm: string; deb: string } {
  switch (arch) {
    case 'x64':
      return { rpm: 'x86_64', deb: 'amd64' };
    case 'arm64':
      return { rpm: 'aarch64', deb: 'arm64' };
    default:
      throw new Error(`unsupported Linux arch: ${arch}`);
  }
}

function assertSafePath(path: string): string {
  if (!/^[A-Za-z0-9._/~+-]+$/.test(path)) throw new Error(`unsupported characters in path: ${path}`);

  return path;
}

export function desktopEntry(app: DesktopAppConfig): string {
  return [
    '[Desktop Entry]',
    `Name=${app.productName}`,
    `Comment=${app.summary}`,
    `Exec=/usr/lib/${app.packageName}/${app.executableName} %U`,
    `Icon=${app.packageName}`,
    'Type=Application',
    'Terminal=false',
    'Categories=Development;',
    `StartupWMClass=${app.executableName}`,
    '',
  ].join('\n');
}

export interface RpmSpecInput {
  version: string;
  arch: string;
  /** Absolute path of Forge's packaged Linux app. */
  packagedDir: string;
  /** Absolute paths of the desktop entry and icon to install. */
  desktopFile: string;
  iconFile: string;
}

/**
 * Spec that repackages Forge's packaged Linux app as an rpm with the deb's layout (`/usr/lib/<package>`, `/usr/bin`
 * symlink, desktop entry): no rebuild, no stripping (Electron binaries stay byte-identical), Chromium's sandbox helper
 * setuid as Electron requires.
 */
export function rpmSpec(app: DesktopAppConfig, input: RpmSpecInput): string {
  const pkg = app.packageName;
  const src = assertSafePath(input.packagedDir);

  return [
    '%define debug_package %{nil}',
    '%define _build_id_links none',
    '%global __os_install_post %{nil}',
    '%global __strip /bin/true',
    `Name: ${pkg}`,
    `Version: ${rpmVersion(input.version)}`,
    'Release: 1',
    `Summary: ${app.summary}`,
    `License: ${app.license}`,
    `URL: ${app.homepage}`,
    `Vendor: ${app.vendor}`,
    `Packager: ${app.maintainer}`,
    `BuildArch: ${linuxArches(input.arch).rpm}`,
    'AutoReqProv: no',
    ...app.linux.rpmRequires.map((r) => `Requires: ${r}`),
    '',
    '%description',
    app.description,
    '',
    '%install',
    `mkdir -p %{buildroot}/usr/lib/${pkg} %{buildroot}/usr/bin %{buildroot}/usr/share/applications %{buildroot}/usr/share/pixmaps`,
    `cp -a ${src}/. %{buildroot}/usr/lib/${pkg}/`,
    // Forge's packaged directory is 0700 (created via mkdtemp) and `cp -a <dir>/.` copies that mode onto the target:
    // normalise so non-root users can run the app (setuid `chrome-sandbox` comes from %attr below).
    `chmod -R u+rwX,go+rX,go-w %{buildroot}/usr/lib/${pkg}`,
    `ln -s /usr/lib/${pkg}/${app.executableName} %{buildroot}/usr/bin/${pkg}`,
    `install -m 0644 ${assertSafePath(input.desktopFile)} %{buildroot}/usr/share/applications/${pkg}.desktop`,
    `install -m 0644 ${assertSafePath(input.iconFile)} %{buildroot}/usr/share/pixmaps/${pkg}.png`,
    '',
    '%files',
    `/usr/lib/${pkg}`,
    `%attr(4755, root, root) /usr/lib/${pkg}/chrome-sandbox`,
    `/usr/bin/${pkg}`,
    `/usr/share/applications/${pkg}.desktop`,
    `/usr/share/pixmaps/${pkg}.png`,
    '',
  ].join('\n');
}

/** Builds the rpm from the packaged Linux app into `<distDir>/out/make/rpm/<arch>/`. Returns its path. */
export function buildRpm(
  app: DesktopAppConfig,
  opts: { version: string; arch: string; root?: string },
  run: Runner,
  log: Log,
): string {
  const root = opts.root ?? process.cwd();
  const packaged = resolve(root, app.distDir, 'out', `${app.executableName}-linux-${opts.arch}`);

  if (!existsSync(packaged)) throw new Error(`packaged Linux app not found: ${packaged}`);

  const top = mkdtempSync(join(tmpdir(), 'desktop-rpm-'));

  try {
    const desktopFile = join(top, `${app.packageName}.desktop`);

    writeFileSync(desktopFile, desktopEntry(app));

    const specFile = join(top, `${app.packageName}.spec`);

    writeFileSync(
      specFile,
      rpmSpec(app, {
        version: opts.version,
        arch: opts.arch,
        packagedDir: packaged,
        desktopFile,
        iconFile: resolve(root, app.distDir, app.icon),
      }),
    );
    run('rpmbuild', ['-bb', '--define', `_topdir ${top}`, specFile]);

    const rpmArch = linuxArches(opts.arch).rpm;
    const built = join(top, 'RPMS', rpmArch);
    const file = readdirSync(built).find((f) => f.endsWith('.rpm'));

    if (!file) throw new Error('rpmbuild produced no rpm');

    const outDir = resolve(root, app.distDir, 'out', 'make', 'rpm', opts.arch);

    mkdirSync(outDir, { recursive: true });
    copyFileSync(join(built, file), join(outDir, file));
    log.info(`rpm: ${join(outDir, file)}`);

    return join(outDir, file);
  } finally {
    rmSync(top, { recursive: true, force: true });
  }
}

/**
 * Absolute path of an executable on `PATH`. rpmsign execs `%{__gpg}` without a PATH lookup, and Ubuntu's rpm macros
 * point it at `/usr/bin/gpg2`, which Ubuntu (incl. the GitHub runners) doesn't ship — so the path is set explicitly.
 */
export function findExecutable(name: string, searchPath: string = process.env['PATH'] ?? ''): string | undefined {
  for (const dir of searchPath.split(delimiter)) {
    if (!dir || !isAbsolute(dir)) continue;

    const candidate = join(dir, name);

    try {
      accessSync(candidate, constants.X_OK);

      return candidate;
    } catch {
      // not here
    }
  }

  return undefined;
}

/** Fingerprint of the (first) secret key in `gpg --with-colons --list-secret-keys` output. */
export function parseSecretKeyFingerprint(colons: string): string {
  const lines = colons.split('\n');
  const sec = lines.findIndex((l) => l.startsWith('sec:'));
  const fpr = sec >= 0 ? lines.slice(sec + 1).find((l) => l.startsWith('fpr:')) : undefined;
  const value = fpr?.split(':')[9];

  if (!value || !/^[0-9A-F]{40,64}$/.test(value)) throw new Error('no secret GPG key found in the imported key');

  return value;
}

/**
 * How long a signed apt `Release` stays valid. apt refuses an expired `Release` (`Valid-Until`), so a mirror or
 * attacker can't freeze clients on old metadata for longer than this; every release re-signs it, and without a
 * release in this window the metadata has to be re-published (README: "Re-publishing the apt metadata").
 */
export const APT_RELEASE_VALID_DAYS = 30;

/**
 * `apt-ftparchive release` options for one channel (suite = codename = channel). `Date` is the signing time and
 * `Valid-Until` comes from `ValidTime` (seconds): apt-ftparchive only writes `Valid-Until` when `ValidTime` is set — a
 * `Release::Valid-Until` override alone is silently ignored (checked with apt 2.8 in the P gate).
 */
export function aptReleaseOptions(app: DesktopAppConfig, channel: DesktopUpdateChannel, arches: string[]): string[] {
  const o = (k: string, v: string) => ['-o', `APT::FTPArchive::Release::${k}=${v}`];

  return [
    ...o('Origin', app.linux.repoOrigin),
    ...o('Label', app.linux.repoLabel),
    ...o('Suite', channel),
    ...o('Codename', channel),
    ...o('Architectures', arches.join(' ')),
    ...o('Components', 'main'),
    ...o('Description', `${app.productName} (${channel})`),
    ...o('ValidTime', String(APT_RELEASE_VALID_DAYS * 24 * 60 * 60)),
  ];
}

export function aptSourcesFile(app: DesktopAppConfig, channel: DesktopUpdateChannel): string {
  return [
    'Types: deb',
    `URIs: ${app.downloadsBaseUrl}/apt`,
    `Suites: ${channel}`,
    'Components: main',
    `Signed-By: /usr/share/keyrings/${app.linux.gpgPublicKeyFile.replace(/\.asc$/, '.gpg')}`,
    '',
  ].join('\n');
}

export function rpmRepoFile(app: DesktopAppConfig, channel: DesktopUpdateChannel): string {
  return [
    `[${app.packageName}-${channel}]`,
    `name=${app.productName} (${channel})`,
    `baseurl=${app.downloadsBaseUrl}/rpm/${channel}/$basearch`,
    'enabled=1',
    'gpgcheck=1',
    'repo_gpgcheck=1',
    `gpgkey=${app.downloadsBaseUrl}/${app.linux.gpgPublicKeyFile}`,
    '',
  ].join('\n');
}

function findFiles(dir: string, suffix: string): string[] {
  if (!existsSync(dir)) return [];

  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith(suffix))
    .map((e) => join(e.parentPath, e.name))
    .sort();
}

export interface LinuxRepoOptions {
  channels: readonly DesktopUpdateChannel[];
  /** Directory holding the packages (searched recursively); the rpms in it are signed in place. */
  packagesDir: string;
  /** Repository tree to upload to the bucket root (`apt/`, `rpm/`, public key). */
  outDir: string;
  env?: NodeJS.ProcessEnv;
  /** Absolute path of gpg for rpmsign (default: found on `PATH`). */
  gpgPath?: string;
}

/**
 * Signs the rpms (`rpmsign --addsign`) and builds the signed repositories: apt (`apt-ftparchive`, `InRelease` +
 * `Release.gpg`) and rpm (`createrepo_c`, `repomd.xml.asc`) per channel, plus the exported public key and ready-made
 * `.sources` / `.repo` files. The GPG key lives in a throw-away keyring that is deleted afterwards.
 */
export function buildLinuxRepos(app: DesktopAppConfig, opts: LinuxRepoOptions, run: Runner, log: Log): void {
  const env = opts.env ?? process.env;
  const secretKey = env[app.secrets.linux.gpgPrivateKey] ?? '';
  const passphrase = env[app.secrets.linux.gpgPassphrase] ?? '';
  const debs = findFiles(opts.packagesDir, '.deb');
  const rpms = findFiles(opts.packagesDir, '.rpm');

  if (debs.length + rpms.length === 0) throw new Error(`no .deb / .rpm packages below ${opts.packagesDir}`);

  const home = mkdtempSync(join(tmpdir(), 'desktop-gpg-'));

  chmodSync(home, 0o700);

  try {
    const passFile = join(home, 'passphrase');

    writeFileSync(passFile, passphrase, { mode: 0o600 });

    const gpgBase = [
      '--homedir',
      home,
      '--batch',
      '--yes',
      '--pinentry-mode',
      'loopback',
      '--passphrase-file',
      passFile,
    ];

    run('gpg', [...gpgBase, '--import'], { input: secretKey });

    const fpr = parseSecretKeyFingerprint(
      run('gpg', ['--homedir', home, '--batch', '--with-colons', '--list-secret-keys']),
    );
    const gpgSign = [...gpgBase, '--local-user', fpr, '--digest-algo', 'SHA512'];

    log.info(`signing with GPG key ${fpr}`);

    const gpgPath = rpms.length ? (opts.gpgPath ?? findExecutable('gpg', env['PATH'])) : undefined;

    if (rpms.length && !gpgPath) throw new Error('gpg not found on PATH (needed by rpmsign)');

    for (const rpm of rpms) {
      run('rpmsign', [
        '--addsign',
        '--define',
        `__gpg ${assertSafePath(gpgPath ?? '')}`,
        '--define',
        `_gpg_name ${fpr}`,
        '--define',
        `_gpg_path ${home}`,
        '--define',
        // rpm execs the first word with the rest as argv: the second word is argv[0] (`gpg`), as in rpm's own macro.
        `__gpg_sign_cmd %{__gpg} gpg --homedir ${home} --batch --no-verbose --no-armor --pinentry-mode loopback --passphrase-file ${passFile} -u ${fpr} --digest-algo sha256 -sbo %{__signature_filename} %{__plaintext_filename}`,
        rpm,
      ]);
    }

    mkdirSync(opts.outDir, { recursive: true });
    writeFileSync(
      join(opts.outDir, app.linux.gpgPublicKeyFile),
      run('gpg', ['--homedir', home, '--armor', '--export', fpr]),
    );

    if (debs.length) {
      const apt = join(opts.outDir, 'apt');
      const pool = join(apt, 'pool', 'main', app.packageName[0], app.packageName);

      mkdirSync(pool, { recursive: true });
      debs.forEach((d) => copyFileSync(d, join(pool, basename(d))));

      const arches = [...new Set(debs.map((d) => /_([a-z0-9]+)\.deb$/.exec(d)?.[1] ?? 'amd64'))].sort();

      for (const channel of opts.channels) {
        const dist = join(apt, 'dists', channel);

        for (const arch of arches) {
          const binDir = join(dist, 'main', `binary-${arch}`);

          mkdirSync(binDir, { recursive: true });

          const packages = run('apt-ftparchive', ['--arch', arch, 'packages', 'pool'], { cwd: apt });

          writeFileSync(join(binDir, 'Packages'), packages);
          run('gzip', ['-9', '-k', '-f', join(binDir, 'Packages')]);
        }

        const release = run(
          'apt-ftparchive',
          [...aptReleaseOptions(app, channel, arches), 'release', `dists/${channel}`],
          {
            cwd: apt,
          },
        );

        // Fail closed: a Release without Valid-Until would let a mirror freeze clients on old metadata forever.
        if (!/^Valid-Until: \S/m.test(release)) throw new Error(`apt Release for ${channel} has no Valid-Until`);

        writeFileSync(join(dist, 'Release'), release);
        run('gpg', [...gpgSign, '--clearsign', '-o', join(dist, 'InRelease'), join(dist, 'Release')]);
        run('gpg', [...gpgSign, '--armor', '--detach-sign', '-o', join(dist, 'Release.gpg'), join(dist, 'Release')]);
        writeFileSync(join(apt, `${app.packageName}-${channel}.sources`), aptSourcesFile(app, channel));
      }
    }

    for (const channel of rpms.length ? opts.channels : []) {
      const channelDir = join(opts.outDir, 'rpm', channel);

      for (const rpm of rpms) {
        const arch = /\.([a-z0-9_]+)\.rpm$/.exec(rpm)?.[1] ?? 'x86_64';
        const dir = join(channelDir, arch);

        mkdirSync(dir, { recursive: true });
        copyFileSync(rpm, join(dir, basename(rpm)));
      }

      for (const arch of readdirSync(channelDir)) {
        const dir = join(channelDir, arch);

        run('createrepo_c', ['--quiet', dir]);
        run('gpg', [
          ...gpgSign,
          '--armor',
          '--detach-sign',
          '-o',
          join(dir, 'repodata', 'repomd.xml.asc'),
          join(dir, 'repodata', 'repomd.xml'),
        ]);
      }

      writeFileSync(join(channelDir, `${app.packageName}.repo`), rpmRepoFile(app, channel));
    }

    log.info(`repositories (${opts.channels.join(', ')}) written to ${opts.outDir}`);
  } finally {
    try {
      run('gpgconf', ['--homedir', home, '--kill', 'gpg-agent']);
    } catch {
      // no agent started
    }

    rmSync(home, { recursive: true, force: true });
  }
}
