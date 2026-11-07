import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DESKTOP_APPS } from '../apps';

import {
  isDeveloperIdSigned,
  macAppPath,
  macZipPath,
  parseDeveloperIdIdentity,
  signAndNotarizeMac,
  zipMac,
} from './macos';
import type { Log, RunOptions } from './process';

const app = DESKTOP_APPS['agenstra'];
const SHA = '0123456789ABCDEF0123456789ABCDEF01234567';

describe('macOS identities', () => {
  it('picks the Developer ID Application identity', () => {
    const out = [
      `  1) ${'F'.repeat(40)} "Apple Development: Someone (ABC)"`,
      `  2) ${SHA} "Developer ID Application: ForePath GmbH (TEAM123456)"`,
      '     2 valid identities found',
    ].join('\n');

    expect(parseDeveloperIdIdentity(out)).toBe(SHA);
    expect(() => parseDeveloperIdIdentity('     0 valid identities found')).toThrow();
  });

  it('recognises Developer ID signatures', () => {
    expect(isDeveloperIdSigned('Authority=Developer ID Application: ForePath (T)\nAuthority=Apple Root CA')).toBe(true);
    expect(isDeveloperIdSigned('Signature=adhoc')).toBe(false);
  });

  it('uses Forge names for the app and zip', () => {
    expect(macAppPath(app, 'arm64', '/w')).toBe(
      '/w/dist/apps/agenstra/native-agent-console/out/native-agent-console-darwin-arm64/native-agent-console.app',
    );
    expect(macZipPath(app, 'x64', '1.2.3', '/w')).toBe(
      '/w/dist/apps/agenstra/native-agent-console/out/make/zip/darwin/x64/native-agent-console-darwin-x64-1.2.3.zip',
    );
  });
});

describe('macOS signing', () => {
  let root: string;
  const warnings: string[] = [];
  const log: Log = { info: () => undefined, warn: (t) => warnings.push(t) };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'desktop-mac-spec-'));
    mkdirSync(macAppPath(app, 'arm64', root), { recursive: true });
    warnings.length = 0;
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('signs in a temporary keychain, notarizes with the API key and cleans up', async () => {
    const calls: { command: string; args: readonly string[]; options?: RunOptions }[] = [];
    let keyFile = '';
    const run = (command: string, args: readonly string[], options?: RunOptions): string => {
      calls.push({ command, args, options });

      if (command === 'security' && args[0] === 'list-keychains' && args.length === 3)
        return '    "/Users/r/login.keychain-db"\n';

      if (command === 'security' && args[0] === 'find-identity')
        return `  1) ${SHA} "Developer ID Application: ForePath GmbH (TEAM123456)"\n`;

      return '';
    };
    const osxSign = { signAsync: jest.fn().mockResolvedValue(undefined) };
    const notarize = {
      notarize: jest.fn().mockImplementation(async (o: { appleApiKey: string }) => {
        keyFile = o.appleApiKey;
        expect(readFileSync(keyFile, 'utf8')).toBe('P8');
      }),
    };

    await signAndNotarizeMac(
      app,
      {
        arch: 'arm64',
        root,
        osxSign,
        notarize,
        env: {
          DESKTOP_MACOS_CERTIFICATE_P12: Buffer.from('p12').toString('base64'),
          DESKTOP_MACOS_CERTIFICATE_PASSWORD: 'certpw',
          DESKTOP_APPLE_API_KEY_P8: 'P8',
          DESKTOP_APPLE_API_KEY_ID: 'KEYID',
          DESKTOP_APPLE_API_ISSUER: 'ISSUER',
        },
      },
      run,
      log,
    );

    expect(osxSign.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({ app: macAppPath(app, 'arm64', root), identity: SHA, platform: 'darwin' }),
    );
    const perFile = osxSign.signAsync.mock.calls[0][0].optionsForFile('x');

    expect(perFile).toEqual({ hardenedRuntime: true, entitlements: join(root, app.macos.entitlements) });
    expect(notarize.notarize).toHaveBeenCalledWith(
      expect.objectContaining({ appleApiKeyId: 'KEYID', appleApiIssuer: 'ISSUER' }),
    );

    // Passwords only in calls flagged secret.
    for (const c of calls) if (c.args.includes('certpw')) expect(c.options?.secretArgs).toBe(true);

    expect(calls.some((c) => c.command === 'spctl')).toBe(true);
    expect(calls.some((c) => c.command === 'security' && c.args[0] === 'delete-keychain')).toBe(true);
    // The temporary keychain is searched during signing, then the previous search list is restored.
    const lists = calls
      .filter((c) => c.args[0] === 'list-keychains' && c.args.includes('-s'))
      .map((c) => c.args.slice(4));

    expect(lists[0]).toHaveLength(2);
    expect(lists[0][1]).toBe('/Users/r/login.keychain-db');
    expect(lists[lists.length - 1]).toEqual(['/Users/r/login.keychain-db']);
    expect(existsSync(keyFile)).toBe(false);
  });

  it('cleans up the keychain when notarization fails', async () => {
    const calls: string[][] = [];
    const run = (command: string, args: readonly string[]): string => {
      calls.push([command, ...args]);

      return command === 'security' && args[0] === 'find-identity'
        ? `  1) ${SHA} "Developer ID Application: F (T)"`
        : '';
    };

    await expect(
      signAndNotarizeMac(
        app,
        {
          arch: 'arm64',
          root,
          env: {},
          osxSign: { signAsync: async () => undefined },
          notarize: { notarize: async () => Promise.reject(new Error('Invalid')) },
        },
        run,
        log,
      ),
    ).rejects.toThrow('Invalid');
    expect(calls.some((c) => c[0] === 'security' && c[1] === 'delete-keychain')).toBe(true);
  });

  it('zips with ditto and ad-hoc signs an app without Developer ID signature (with a warning)', () => {
    const calls: string[][] = [];

    zipMac(app, { arch: 'arm64', version: '1.2.3', root }, (c, a) => (calls.push([c, ...a]), 'Signature=adhoc'), log);

    expect(warnings).toEqual(['macOS app not Developer ID signed']);
    expect(calls.find((c) => c[0] === 'codesign')).toEqual([
      'codesign',
      '--force',
      '--deep',
      '--sign',
      '-',
      macAppPath(app, 'arm64', root),
    ]);
    expect(calls[calls.length - 1]).toEqual([
      'ditto',
      '-c',
      '-k',
      '--sequesterRsrc',
      '--keepParent',
      macAppPath(app, 'arm64', root),
      macZipPath(app, 'arm64', '1.2.3', root),
    ]);
  });

  it('keeps a Developer ID signature untouched', () => {
    const calls: string[][] = [];

    zipMac(
      app,
      { arch: 'arm64', version: '1.2.3', root },
      (c, a) => (calls.push([c, ...a]), 'Authority=Developer ID Application: F (T)'),
      log,
    );

    expect(warnings).toEqual([]);
    expect(calls.some((c) => c[0] === 'codesign')).toBe(false);
  });
});
