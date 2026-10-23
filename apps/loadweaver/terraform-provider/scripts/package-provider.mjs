#!/usr/bin/env node
/**
 * Packages the Terraform provider for the Terraform registry (and for `terraform providers mirror`-style installs):
 *
 *   build      one Node single executable per platform (`terraform-provider-loadweaver_v<version>[.exe]`), each in
 *              `terraform-provider-loadweaver_<version>_<os>_<arch>.zip`
 *   checksums  `terraform-provider-loadweaver_<version>_manifest.json` (copy of terraform-registry-manifest.json) and
 *              `terraform-provider-loadweaver_<version>_SHA256SUMS` over the zips + manifest in a directory
 *
 * Node binaries of other platforms are the official builds of the same Node version, verified against the release's
 * SHASUMS256.txt, whose GPG signature (SHASUMS256.txt.sig) must come from a pinned Node.js release key
 * (node-dist-verify.cjs; needs `gpg`, fails closed without it unless `--allow-unsigned-node-sums`, never in CI). Cached
 * archives and extracted binaries are re-hashed on every use. macOS binaries are re-signed ad hoc after the blob is injected (needs `codesign` on macOS or
 * `rcodesign`); the release workflow builds them on a macOS runner. The registry's GPG signature of the SHA256SUMS
 * file is added by the release workflow (signature hook), not here.
 *
 *   node package-provider.mjs build --bundle dist/.../main.js --version 1.2.3 --out dist/terraform-provider \
 *     [--platforms linux_amd64,linux_arm64,windows_amd64,darwin_amd64,darwin_arm64] [--node-version 24.14.1]
 *     [--node-cache DIR] [--allow-unsigned-node-sums]
 *   node package-provider.mjs checksums --version 1.2.3 --dir dist/terraform-provider
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import {
  chmodSync,
  copyFileSync,
  createWriteStream,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import verify from './node-dist-verify.cjs';

const NAME = 'terraform-provider-loadweaver';
const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
const ALL_PLATFORMS = [
  'linux_amd64',
  'linux_arm64',
  'darwin_amd64',
  'darwin_arm64',
  'windows_amd64',
];
const here = dirname(fileURLToPath(import.meta.url));
// Fixed timestamp inside the zips: the same binary always gives the same archive (2020-01-01, DOS time has no 1970).
const ZIP_DATE = new Date('2020-01-01T00:00:00Z');

const [command, ...rest] = process.argv.slice(2);
const { values } = parseArgs({
  args: rest,
  options: {
    bundle: { type: 'string' },
    version: { type: 'string' },
    out: { type: 'string' },
    dir: { type: 'string' },
    platforms: { type: 'string' },
    'node-version': { type: 'string' },
    'node-cache': { type: 'string' },
    'allow-unsigned-node-sums': { type: 'boolean' },
  },
});

function fail(message) {
  console.error(`package-provider: ${message}`);
  process.exit(1);
}

const version = (values.version ?? '').replace(/^v/, '');

if (!/^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/.test(version))
  fail('--version must be a semantic version, e.g. 1.2.3');

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/** `linux_amd64` → the Node.js download names. */
function nodeDist(platform) {
  const [os, arch] = platform.split('_');
  const nodeArch = arch === 'amd64' ? 'x64' : arch;

  if (os === 'windows')
    return { archive: `win-${nodeArch}/node.exe`, member: null };

  const ext = os === 'darwin' ? 'tar.gz' : 'tar.xz';
  const dir = `node-v${values['node-version'] ?? process.versions.node}-${os}-${nodeArch}`;

  return { archive: `${dir}.${ext}`, member: `${dir}/bin/node` };
}

function hostPlatform() {
  const os = { linux: 'linux', darwin: 'darwin', win32: 'windows' }[
    process.platform
  ];
  const arch = { x64: 'amd64', arm64: 'arm64' }[process.arch];

  return `${os}_${arch}`;
}

async function download(url, file) {
  const response = await fetch(url);

  if (!response.ok) fail(`download ${url}: HTTP ${response.status}`);

  writeFileSync(file, Buffer.from(await response.arrayBuffer()));
}

/**
 * Verifies `sums` against `sig` with gpg in a throw-away GNUPGHOME holding the pinned Node.js release keys; exits
 * unless a pinned key made the signature.
 */
async function verifyShasums(sums, sig) {
  const mode = verify.signatureMode({
    hasGpg: which('gpg'),
    allowUnsigned: values['allow-unsigned-node-sums'] === true,
  });

  if (mode.mode === 'error') fail(mode.message);

  if (mode.mode === 'skip') {
    console.warn(
      'package-provider: WARNING --allow-unsigned-node-sums: SHASUMS256.txt signature NOT verified',
    );

    return;
  }

  const home = mkdtempSync(join(tmpdir(), 'lw-tf-gnupg-'));

  try {
    chmodSync(home, 0o700);

    for (const fingerprint of verify.NODE_RELEASE_KEY_FINGERPRINTS) {
      const keyFile = join(home, `${fingerprint}.asc`);

      await download(verify.releaseKeyUrl(fingerprint), keyFile);
      execFileSync(
        'gpg',
        ['--homedir', home, '--batch', '--quiet', '--import', keyFile],
        {
          stdio: ['ignore', 'ignore', 'ignore'],
        },
      );
    }

    let status = '';

    try {
      status = execFileSync(
        'gpg',
        [
          '--homedir',
          home,
          '--batch',
          '--status-fd',
          '1',
          '--verify',
          sig,
          sums,
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      );
    } catch (error) {
      status = String(error.stdout ?? '');
    }

    const result = verify.checkGpgStatus(status);

    if (!result.ok)
      fail(`SHASUMS256.txt signature check failed: ${result.reason}`);

    console.log(
      `Verified SHASUMS256.txt (Node.js release key ${result.fingerprint})`,
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

/** The Node binary for a platform: this one for the host (same version), else the verified official build. */
async function nodeBinary(platform, cache, verifiedSums) {
  const nodeVersion = values['node-version'] ?? process.versions.node;

  if (platform === hostPlatform() && nodeVersion === process.versions.node)
    return process.execPath;

  const base = `https://nodejs.org/dist/v${nodeVersion}`;
  const sums = join(cache, `SHASUMS256-${nodeVersion}.txt`);

  // Signature checked once per run (also for cached files), before any hash from it is trusted.
  if (!verifiedSums.has(nodeVersion)) {
    const sig = `${sums}.sig`;

    await download(`${base}/SHASUMS256.txt`, sums);
    await download(`${base}/SHASUMS256.txt.sig`, sig);
    await verifyShasums(sums, sig);
    verifiedSums.set(nodeVersion, readFileSync(sums, 'utf8'));
  }

  const { archive, member } = nodeDist(platform);
  const expected = verify.shasumFor(verifiedSums.get(nodeVersion), archive);

  if (!expected) fail(`no checksum for ${archive} in ${base}/SHASUMS256.txt`);

  const file = join(cache, archive.replace(/\//g, '-'));
  const matches = () =>
    verify.fileMatches({ fs, hash: sha256, file, expected });

  if (!matches()) await download(`${base}/${archive}`, file);

  if (!matches()) fail(`checksum mismatch for ${archive}`);

  if (!member) return file;

  return verify.cachedExtractedBinary({
    fs,
    hash: sha256,
    cache,
    archive: file,
    archiveHash: expected,
    member,
    extract: (archivePath, dir, entry) =>
      execFileSync('tar', ['-xf', archivePath, '-C', dir, entry], {
        stdio: 'inherit',
      }),
  });
}

function which(tool) {
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', [tool], {
      stdio: 'ignore',
    });

    return true;
  } catch {
    return false;
  }
}

/** Zip with one executable entry (unix mode 0755), via archiver (already a root dependency). */
async function zipOne(file, entryName, zipPath) {
  const { ZipArchive } = await import('archiver');

  await new Promise((resolvePromise, reject) => {
    const output = createWriteStream(zipPath);
    const archive = new ZipArchive({ zlib: { level: 9 } });

    output.on('close', resolvePromise);
    archive.on('error', reject);
    archive.pipe(output);
    archive.file(file, { name: entryName, mode: 0o755, date: ZIP_DATE });
    archive.finalize();
  });
}

async function build() {
  if (!values.bundle || !values.out) fail('build needs --bundle and --out');

  const out = resolve(values.out);
  const platforms = (values.platforms ?? ALL_PLATFORMS.join(','))
    .split(',')
    .map((p) => p.trim());

  for (const p of platforms)
    if (!ALL_PLATFORMS.includes(p)) fail(`unknown platform ${p}`);

  const codesignTool =
    process.platform === 'darwin' && which('codesign')
      ? 'codesign'
      : which('rcodesign')
        ? 'rcodesign'
        : null;

  if (platforms.some((p) => p.startsWith('darwin_')) && !codesignTool)
    fail(
      'darwin platforms need codesign (macOS) or rcodesign to re-sign the binaries',
    );

  const cache = resolve(
    values['node-cache'] ?? join(tmpdir(), 'lw-tf-node-cache'),
  );
  const work = join(out, '.work');
  const blob = join(work, 'sea-prep.blob');
  const config = join(work, 'sea-config.json');

  try {
    verify.ensurePrivateCacheDir({ fs, dir: cache, uid: process.getuid?.() });
  } catch (error) {
    fail(error.message);
  }

  mkdirSync(work, { recursive: true });
  // useCodeCache / useSnapshot off: the blob then works for every platform of the same Node version.
  writeFileSync(
    config,
    JSON.stringify({
      main: resolve(values.bundle),
      output: blob,
      disableExperimentalSEAWarning: true,
      useCodeCache: false,
      useSnapshot: false,
    }),
  );
  execFileSync(process.execPath, ['--experimental-sea-config', config], {
    stdio: 'inherit',
  });

  const verifiedSums = new Map();

  for (const platform of platforms) {
    const [os] = platform.split('_');
    const binaryName = `${NAME}_v${version}${os === 'windows' ? '.exe' : ''}`;
    const dir = join(work, platform);
    const binary = join(dir, binaryName);
    const darwin = os === 'darwin';
    const codesign = darwin ? codesignTool : null;

    mkdirSync(dir, { recursive: true });
    copyFileSync(await nodeBinary(platform, cache, verifiedSums), binary);
    chmodSync(binary, 0o755);

    if (codesign === 'codesign')
      execFileSync('codesign', ['--remove-signature', binary], {
        stdio: 'inherit',
      });

    execFileSync(
      process.execPath,
      [
        resolve(here, '../../../../node_modules/postject/dist/cli.js'),
        binary,
        'NODE_SEA_BLOB',
        blob,
        '--sentinel-fuse',
        SEA_FUSE,
        ...(darwin ? ['--macho-segment-name', 'NODE_SEA'] : []),
      ],
      { stdio: 'inherit' },
    );

    if (codesign === 'codesign')
      execFileSync('codesign', ['--sign', '-', binary], { stdio: 'inherit' });
    else if (codesign === 'rcodesign')
      execFileSync('rcodesign', ['sign', binary], { stdio: 'inherit' });

    const zip = join(out, `${NAME}_${version}_${platform}.zip`);

    await zipOne(binary, binaryName, zip);
    console.log(`Built ${zip}`);
  }

  rmSync(work, { recursive: true, force: true });
}

function checksums() {
  const dir = resolve(values.dir ?? values.out ?? '');

  if (!values.dir && !values.out) fail('checksums needs --dir');

  const manifest = join(dir, `${NAME}_${version}_manifest.json`);

  copyFileSync(resolve(here, '../terraform-registry-manifest.json'), manifest);

  const files = readdirSync(dir)
    .filter(
      (f) =>
        f.startsWith(`${NAME}_${version}_`) &&
        (f.endsWith('.zip') || f === basename(manifest)),
    )
    .sort();

  if (!files.some((f) => f.endsWith('.zip')))
    fail(`no ${NAME}_${version}_*.zip in ${dir}`);

  const sums =
    files.map((f) => `${sha256(join(dir, f))}  ${f}`).join('\n') + '\n';

  writeFileSync(join(dir, `${NAME}_${version}_SHA256SUMS`), sums);
  console.log(sums.trimEnd());
}

if (command === 'build') await build();
else if (command === 'checksums') checksums();
else fail('usage: package-provider.mjs build|checksums ...');
