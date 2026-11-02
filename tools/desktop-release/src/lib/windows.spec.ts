import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DESKTOP_APPS } from '../apps';

import type { Log, RunOptions } from './process';
import {
  filesToSign,
  findSigntool,
  importPfxScript,
  parseThumbprints,
  powershellPath,
  removeCertificatesScript,
  signtoolSignArgs,
  signWindows,
} from './windows';

const app = DESKTOP_APPS['agenstra'];
const quiet: Log = { info: () => undefined, warn: () => undefined };
const THUMB = '0123456789ABCDEF0123456789ABCDEF01234567';
const OTHER = 'FEDCBA9876543210FEDCBA9876543210FEDCBA98';

describe('Authenticode signing', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'desktop-win-spec-'));
    mkdirSync(join(dir, 'bundle', 'resources'), { recursive: true });
    writeFileSync(join(dir, 'bundle', 'native-agent-console.exe'), 'x');
    writeFileSync(join(dir, 'bundle', 'ffmpeg.dll'), 'x');
    writeFileSync(join(dir, 'bundle', 'resources', 'addon.node'), 'x');
    writeFileSync(join(dir, 'bundle', 'resources', 'app.asar'), 'x');
    writeFileSync(join(dir, 'bundle', 'LICENSE'), 'x');
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('selects executables, DLLs and native modules', () => {
    expect(filesToSign(join(dir, 'bundle')).map((f) => f.slice(dir.length + 8))).toEqual([
      'ffmpeg.dll',
      'native-agent-console.exe',
      join('resources', 'addon.node'),
    ]);
    expect(filesToSign(join(dir, 'bundle'), { topLevelOnly: true, extensions: ['.exe'] })).toHaveLength(1);
    expect(filesToSign(join(dir, 'bundle', 'LICENSE'))).toEqual([join(dir, 'bundle', 'LICENSE')]);
    expect(() => filesToSign(join(dir, 'missing'))).toThrow();
  });

  it('finds the newest signtool of the installed SDKs', () => {
    for (const v of ['10.0.19041.0', '10.0.22621.0', '10.0.9999.0']) {
      mkdirSync(join(dir, 'kits', v, 'x64'), { recursive: true });
      writeFileSync(join(dir, 'kits', v, 'x64', 'signtool.exe'), '');
    }

    expect(findSigntool({}, join(dir, 'kits'))).toBe(join(dir, 'kits', '10.0.22621.0', 'x64', 'signtool.exe'));
    expect(findSigntool({ SIGNTOOL_PATH: 'C:\\st.exe' }, join(dir, 'kits'))).toBe('C:\\st.exe');
    expect(() => findSigntool({}, join(dir, 'none'))).toThrow(/signtool/);
  });

  it('signs with SHA-256, an RFC 3161 timestamp and the certificate selected by thumbprint', () => {
    const args = signtoolSignArgs(app, THUMB, ['a.exe']);

    expect(args).toEqual(
      expect.arrayContaining(['/fd', 'sha256', '/tr', 'http://timestamp.digicert.com', '/td', '/sha1', THUMB, 'a.exe']),
    );
    expect(args).not.toContain('/p');
    expect(args).not.toContain('/f');
  });

  it('imports the PFX with the password from the environment and removes it again', () => {
    const script = importPfxScript('DESKTOP_WINDOWS_CERTIFICATE_PASSWORD');

    expect(script).toContain('ConvertTo-SecureString -String $env:DESKTOP_WINDOWS_CERTIFICATE_PASSWORD');
    expect(script).toContain('Import-PfxCertificate -FilePath $env:DESKTOP_AUTHENTICODE_PFX_FILE');
    expect(() => importPfxScript('X; rm -rf /')).toThrow();
    expect(removeCertificatesScript([THUMB])).toBe(
      `Remove-Item -LiteralPath 'Cert:\\CurrentUser\\My\\${THUMB}' -DeleteKey -ErrorAction SilentlyContinue`,
    );
    expect(() => removeCertificatesScript(["x' ; evil"])).toThrow();
    expect(parseThumbprints(`${THUMB.toLowerCase()}\r\n${OTHER}\r\n`)).toEqual([THUMB, OTHER]);
    expect(() => parseThumbprints('')).toThrow();
    expect(powershellPath({ SystemRoot: 'C:\\Windows' })).toBe(
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    );
    expect(powershellPath({})).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  });

  it('keeps the password out of argv, verifies and removes certificate and file', () => {
    const calls: { command: string; args: readonly string[]; options?: RunOptions }[] = [];
    let pfx = '';
    const run = (command: string, args: readonly string[], options?: RunOptions): string => {
      calls.push({ command, args, options });

      if (args.join(' ').includes('Import-PfxCertificate')) {
        pfx = options?.env?.['DESKTOP_AUTHENTICODE_PFX_FILE'] ?? '';
        expect(readFileSync(pfx, 'utf8')).toBe('certificate');
        expect(options?.env?.['DESKTOP_WINDOWS_CERTIFICATE_PASSWORD']).toBe('pw');

        return `${THUMB}\r\n${OTHER}\r\n`;
      }

      return '';
    };
    const signed = signWindows(
      app,
      {
        paths: [join(dir, 'bundle')],
        env: {
          SystemRoot: 'C:\\Windows',
          SIGNTOOL_PATH: 'signtool.exe',
          DESKTOP_WINDOWS_CERTIFICATE_PFX: Buffer.from('certificate').toString('base64'),
          DESKTOP_WINDOWS_CERTIFICATE_PASSWORD: 'pw',
        },
      },
      run,
      quiet,
    );

    expect(signed).toBe(3);
    expect(calls.every((c) => !c.args.includes('pw'))).toBe(true);
    expect(calls[0].command).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    expect(calls[1].args).toEqual(expect.arrayContaining(['sign', '/sha1', THUMB]));
    expect(calls[2].args.slice(0, 3)).toEqual(['verify', '/pa', '/q']);
    expect(calls[3].args.join(' ')).toContain(`Cert:\\CurrentUser\\My\\${THUMB}' -DeleteKey`);
    expect(calls[3].args.join(' ')).toContain(`Cert:\\CurrentUser\\My\\${OTHER}' -DeleteKey`);
    expect(existsSync(pfx)).toBe(false);
  });

  it('removes the certificate when signing fails', () => {
    const calls: string[] = [];
    const run = (_command: string, args: readonly string[]): string => {
      const line = args.join(' ');

      calls.push(line);

      if (line.includes('Import-PfxCertificate')) return THUMB;

      if (args[0] === 'sign') throw new Error('signtool failed');

      return '';
    };

    expect(() =>
      signWindows(
        app,
        {
          paths: [join(dir, 'bundle')],
          env: {
            SIGNTOOL_PATH: 'signtool.exe',
            DESKTOP_WINDOWS_CERTIFICATE_PFX: 'eA==',
            DESKTOP_WINDOWS_CERTIFICATE_PASSWORD: 'pw',
          },
        },
        run,
        quiet,
      ),
    ).toThrow('signtool failed');
    expect(calls[calls.length - 1]).toContain('Remove-Item');
  });
});
