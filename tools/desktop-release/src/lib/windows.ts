import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';

import type { DesktopAppConfig } from '../apps';

import type { Log, Runner } from './process';

/** What Authenticode covers in an Electron app: executables, DLLs and native modules. */
export const AUTHENTICODE_EXTENSIONS = ['.exe', '.dll', '.node'] as const;

/** Files to sign: the file itself, or the signable files in a directory (recursively unless `topLevelOnly`). */
export function filesToSign(
  path: string,
  opts: { topLevelOnly?: boolean; extensions?: readonly string[] } = {},
): string[] {
  const extensions = opts.extensions ?? AUTHENTICODE_EXTENSIONS;

  if (!existsSync(path)) throw new Error(`not found: ${path}`);

  if (statSync(path).isFile()) return [path];

  return readdirSync(path, { withFileTypes: true, recursive: !opts.topLevelOnly })
    .filter((e) => e.isFile() && extensions.includes(extname(e.name).toLowerCase()))
    .map((e) => join(e.parentPath, e.name))
    .sort();
}

/** The newest x64 `signtool.exe` of the installed Windows SDKs (or `SIGNTOOL_PATH`). */
export function findSigntool(
  env: NodeJS.ProcessEnv = process.env,
  kitsRoot = 'C:\\Program Files (x86)\\Windows Kits\\10\\bin',
): string {
  if (env['SIGNTOOL_PATH']) return env['SIGNTOOL_PATH'];

  const versions = existsSync(kitsRoot)
    ? readdirSync(kitsRoot)
        .filter((v) => /^\d+\.\d+\.\d+\.\d+$/.test(v) && existsSync(join(kitsRoot, v, 'x64', 'signtool.exe')))
        .sort((a, b) => {
          const x = a.split('.').map(Number);
          const y = b.split('.').map(Number);

          for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return x[i] - y[i];

          return 0;
        })
    : [];

  if (!versions.length) throw new Error('signtool.exe not found (install the Windows SDK or set SIGNTOOL_PATH)');

  return join(kitsRoot, versions[versions.length - 1], 'x64', 'signtool.exe');
}

/**
 * `signtool sign` arguments (SHA-256 file digest, RFC 3161 timestamp). The certificate is selected by thumbprint
 * from the CurrentUser `My` store (imported there by `importPfxScript`), so no secret is on the command line.
 */
export function signtoolSignArgs(app: DesktopAppConfig, thumbprint: string, files: readonly string[]): string[] {
  return [
    'sign',
    '/fd',
    'sha256',
    '/tr',
    app.windows.timestampUrl,
    '/td',
    'sha256',
    '/s',
    'My',
    '/sha1',
    thumbprint,
    '/d',
    app.productName,
    '/du',
    app.homepage,
    ...files,
  ];
}

/** Windows PowerShell by absolute path (never resolved through `PATH`). */
export function powershellPath(env: NodeJS.ProcessEnv = process.env): string {
  const root = env['SystemRoot'] ?? env['SYSTEMROOT'];
  const base = root && /^[A-Za-z]:\\[^"<>|?*]*$/.test(root) ? root.replace(/\\+$/, '') : 'C:\\Windows';

  return `${base}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
}

export const PFX_FILE_ENV = 'DESKTOP_AUTHENTICODE_PFX_FILE';

/**
 * Imports the PFX (path in `PFX_FILE_ENV`, password read from the named environment variable as a SecureString)
 * into `Cert:\CurrentUser\My`, non-exportable, and prints the thumbprints of the imported certificates — the one
 * with the private key first.
 */
export function importPfxScript(passwordEnv: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(passwordEnv))
    throw new Error(`invalid environment variable name: ${passwordEnv}`);

  return [
    "$ErrorActionPreference = 'Stop'",
    `$pw = ConvertTo-SecureString -String $env:${passwordEnv} -AsPlainText -Force`,
    `$certs = @(Import-PfxCertificate -FilePath $env:${PFX_FILE_ENV} -CertStoreLocation Cert:\\CurrentUser\\My -Password $pw)`,
    '$signing = @($certs | Where-Object { $_.HasPrivateKey })',
    "if ($signing.Count -ne 1) { throw 'the PFX must contain exactly one certificate with a private key' }",
    '$others = @($certs | Where-Object { -not $_.HasPrivateKey })',
    '(@($signing) + @($others) | ForEach-Object { $_.Thumbprint }) -join "`n"',
  ].join('; ');
}

/** Removes the imported certificates (and the signing key) from `Cert:\CurrentUser\My`. */
export function removeCertificatesScript(thumbprints: readonly string[]): string {
  return thumbprints
    .map((t) => {
      if (!/^[0-9A-F]{40}$/.test(t)) throw new Error(`invalid certificate thumbprint: ${t}`);

      return `Remove-Item -LiteralPath 'Cert:\\CurrentUser\\My\\${t}' -DeleteKey -ErrorAction SilentlyContinue`;
    })
    .join('; ');
}

export function parseThumbprints(stdout: string): string[] {
  const thumbprints = stdout
    .split(/\r?\n/)
    .map((l) => l.trim().toUpperCase())
    .filter(Boolean);

  if (!thumbprints.length || thumbprints.some((t) => !/^[0-9A-F]{40}$/.test(t)))
    throw new Error('importing the Authenticode certificate returned no valid thumbprint');

  return thumbprints;
}

export interface WindowsSignOptions {
  paths: readonly string[];
  topLevelOnly?: boolean;
  env?: NodeJS.ProcessEnv;
}

/**
 * Authenticode-signs the given files / directories and verifies the result with `signtool verify /pa`. The PFX from
 * the app's secret is written to a private temp file, imported into the CurrentUser certificate store (password via
 * environment as a SecureString, never in argv) and selected by thumbprint; certificate, key and temp file are
 * removed afterwards, also on failure.
 */
export function signWindows(app: DesktopAppConfig, opts: WindowsSignOptions, run: Runner, log: Log): number {
  const env = opts.env ?? process.env;
  const files = opts.paths.flatMap((p) => filesToSign(p, { topLevelOnly: opts.topLevelOnly }));

  if (!files.length) {
    log.warn('Nothing to sign', `no ${AUTHENTICODE_EXTENSIONS.join(' / ')} files in ${opts.paths.join(', ')}`);

    return 0;
  }

  const signtool = findSigntool(env);
  const powershell = powershellPath(env);
  const psArgs = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command'];
  const dir = mkdtempSync(join(tmpdir(), 'desktop-authenticode-'));
  let thumbprints: string[] = [];

  try {
    const pfx = join(dir, 'certificate.pfx');

    writeFileSync(pfx, Buffer.from(env[app.secrets.windows.certificatePfx] ?? '', 'base64'), { mode: 0o600 });

    thumbprints = parseThumbprints(
      run(powershell, [...psArgs, importPfxScript(app.secrets.windows.certificatePassword)], {
        env: { ...env, [PFX_FILE_ENV]: pfx },
      }),
    );

    for (let i = 0; i < files.length; i += 50) {
      const batch = files.slice(i, i + 50);

      run(signtool, signtoolSignArgs(app, thumbprints[0], batch));
      run(signtool, ['verify', '/pa', '/q', ...batch]);
    }

    log.info(`Authenticode: signed ${files.length} file(s)`);

    return files.length;
  } finally {
    try {
      if (thumbprints.length) run(powershell, [...psArgs, removeCertificatesScript(thumbprints)]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}
