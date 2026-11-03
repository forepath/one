import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type { DesktopAppConfig } from '../apps';

import type { Log, Runner } from './process';

export function macAppPath(app: DesktopAppConfig, arch: string, root = process.cwd()): string {
  return resolve(root, app.distDir, 'out', `${app.executableName}-darwin-${arch}`, `${app.executableName}.app`);
}

/** The update / download zip; same name Forge's zip maker uses, so the in-app updater and the docs find it. */
export function macZipPath(app: DesktopAppConfig, arch: string, version: string, root = process.cwd()): string {
  return resolve(
    root,
    app.distDir,
    'out',
    'make',
    'zip',
    'darwin',
    arch,
    `${app.executableName}-darwin-${arch}-${version}.zip`,
  );
}

/** SHA-1 of the first valid "Developer ID Application" identity in `security find-identity -v -p codesigning`. */
export function parseDeveloperIdIdentity(output: string): string {
  const match = /^\s*\d+\)\s+([0-9A-F]{40})\s+"Developer ID Application: [^"]+"/m.exec(output);

  if (!match) throw new Error('no valid "Developer ID Application" identity in the imported certificate');

  return match[1];
}

/** Whether `codesign -dv` output shows a Developer ID signature (not ad-hoc / unsigned). */
export function isDeveloperIdSigned(codesignDisplay: string): boolean {
  return /^Authority=Developer ID Application: /m.test(codesignDisplay);
}

interface OsxSign {
  signAsync(opts: Record<string, unknown>): Promise<void>;
}
interface Notarize {
  notarize(opts: Record<string, unknown>): Promise<void>;
}

export interface MacSignOptions {
  arch: string;
  root?: string;
  env?: NodeJS.ProcessEnv;
  /** Injected in tests; defaults to `@electron/osx-sign` / `@electron/notarize` from the workspace. */
  osxSign?: OsxSign;
  notarize?: Notarize;
}

/**
 * Developer ID signing (hardened runtime, the app's entitlements, inside-out via `@electron/osx-sign`), notarization
 * with an App Store Connect API key (`@electron/notarize` → notarytool) and stapling, then a Gatekeeper assessment.
 * The certificate lives in a temporary keychain that is deleted afterwards, together with the key files.
 */
export async function signAndNotarizeMac(
  app: DesktopAppConfig,
  opts: MacSignOptions,
  run: Runner,
  log: Log,
): Promise<void> {
  const env = opts.env ?? process.env;
  const root = opts.root ?? process.cwd();
  const appPath = macAppPath(app, opts.arch, root);

  if (!existsSync(appPath)) throw new Error(`packaged macOS app not found: ${appPath}`);

  const s = app.secrets.macos;
  const dir = mkdtempSync(join(tmpdir(), 'desktop-macos-'));
  const keychain = join(dir, 'signing.keychain-db');
  const keychainPassword = randomBytes(24).toString('hex');
  const previous = run('security', ['list-keychains', '-d', 'user'])
    .split('\n')
    .map((l) => l.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
  let keychainCreated = false;

  try {
    const p12 = join(dir, 'certificate.p12');
    const p8 = join(dir, 'AuthKey.p8');

    writeFileSync(p12, Buffer.from(env[s.certificateP12] ?? '', 'base64'), { mode: 0o600 });
    writeFileSync(p8, env[s.apiKeyP8] ?? '', { mode: 0o600 });

    run('security', ['create-keychain', '-p', keychainPassword, keychain], { secretArgs: true });
    keychainCreated = true;
    run('security', ['set-keychain-settings', '-lut', '21600', keychain]);
    run('security', ['unlock-keychain', '-p', keychainPassword, keychain], { secretArgs: true });
    run(
      'security',
      ['import', p12, '-k', keychain, '-P', env[s.certificatePassword] ?? '', '-T', '/usr/bin/codesign'],
      {
        secretArgs: true,
      },
    );
    run('security', ['set-key-partition-list', '-S', 'apple-tool:,apple:', '-s', '-k', keychainPassword, keychain], {
      secretArgs: true,
    });
    run('security', ['list-keychains', '-d', 'user', '-s', keychain, ...previous]);

    const identity = parseDeveloperIdIdentity(run('security', ['find-identity', '-v', '-p', 'codesigning', keychain]));
    const entitlements = resolve(root, app.macos.entitlements);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const osxSign: OsxSign = opts.osxSign ?? require('@electron/osx-sign');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const notarize: Notarize = opts.notarize ?? require('@electron/notarize');

    log.info(`codesign: ${appPath}`);
    await osxSign.signAsync({
      app: appPath,
      identity,
      keychain,
      platform: 'darwin',
      optionsForFile: () => ({ hardenedRuntime: true, entitlements }),
    });

    log.info('notarizing (notarytool) and stapling');
    await notarize.notarize({
      appPath,
      appleApiKey: p8,
      appleApiKeyId: env[s.apiKeyId] ?? '',
      appleApiIssuer: env[s.apiIssuer] ?? '',
    });

    run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);
    run('spctl', ['--assess', '--type', 'execute', '--verbose=2', appPath]);
    run('xcrun', ['stapler', 'validate', appPath]);
    log.info('signed, notarized and stapled');
  } finally {
    if (keychainCreated) {
      try {
        run('security', ['list-keychains', '-d', 'user', '-s', ...previous]);
        run('security', ['delete-keychain', keychain]);
      } catch {
        // the runner is discarded anyway
      }
    }

    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Zips the app for download and for Squirrel.Mac (`ditto --keepParent`, keeps signatures and the stapled ticket). An
 * app without a Developer ID signature (secrets not configured) gets an ad-hoc signature first so it still launches on
 * Apple silicon; Gatekeeper then asks the user to confirm it.
 */
export function zipMac(
  app: DesktopAppConfig,
  opts: { arch: string; version: string; root?: string },
  run: Runner,
  log: Log,
): string {
  const appPath = macAppPath(app, opts.arch, opts.root);

  if (!existsSync(appPath)) throw new Error(`packaged macOS app not found: ${appPath}`);

  let display = '';

  try {
    // `codesign -dv` prints to stderr; merge it for the check.
    display = run('sh', ['-c', 'codesign -dv --verbose=2 "$1" 2>&1', 'sh', appPath]);
  } catch {
    display = '';
  }

  if (!isDeveloperIdSigned(display)) {
    log.warn(
      'macOS app not Developer ID signed',
      `${app.productName} (${opts.arch}) is not signed with a Developer ID (signing secrets missing); publishing an ad-hoc signed zip that Gatekeeper will not trust and that cannot auto-update.`,
    );
    run('codesign', ['--force', '--deep', '--sign', '-', appPath]);
  }

  const zip = macZipPath(app, opts.arch, opts.version, opts.root);

  mkdirSync(resolve(zip, '..'), { recursive: true });
  rmSync(zip, { force: true });
  run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', appPath, zip]);
  log.info(`zip: ${zip}`);

  return zip;
}
