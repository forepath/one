import type { ReleaseFile } from '@forepath/shared/shared/util-release-signing';

import {
  authenticodeAccepts,
  effectiveUpdateChannel,
  isNsisInstall,
  linuxInstallKind,
  linuxUpdateInstructions,
  selectUpdateFile,
  updateFeedUrl,
  windowsPowerShellPath,
} from './update-config';

const file = (path: string): ReleaseFile => ({ path: `desktop/${path}`, sha256: 'a'.repeat(64), size: 1 });
const release = [
  file('native-agent-console-darwin-arm64-1.3.0.zip'),
  file('native-agent-console-darwin-x64-1.3.0.zip'),
  file('native-agent-console-linux-x64-1.3.0.zip'),
  file('native-agent-console-win32-x64-1.3.0.zip'),
  file('agenstra_1.3.0_amd64.exe'),
  file('agenstra_1.3.0_amd64.deb'),
  file('agenstra-1.3.0-1.x86_64.rpm'),
];

describe('update channel', () => {
  it('uses the configured channel, else the channel of the installed version', () => {
    expect(effectiveUpdateChannel('beta', '1.0.0')).toBe('beta');
    expect(effectiveUpdateChannel('stable', '1.1.0-beta.1')).toBe('stable');
    expect(effectiveUpdateChannel(undefined, '1.0.0')).toBe('stable');
    expect(effectiveUpdateChannel('nightly', '1.1.0-beta.1')).toBe('beta');
    expect(updateFeedUrl('beta')).toBe('https://downloads.agenstra.com/updates/desktop/beta.json');
  });
});

describe('update file per platform', () => {
  it('picks the Squirrel.Mac zip per arch, the NSIS installer and the deb', () => {
    expect(selectUpdateFile('darwin', 'arm64')(release)?.path).toBe(
      'desktop/native-agent-console-darwin-arm64-1.3.0.zip',
    );
    expect(selectUpdateFile('darwin', 'x64')(release)?.path).toBe('desktop/native-agent-console-darwin-x64-1.3.0.zip');
    expect(selectUpdateFile('win32', 'x64')(release)?.path).toBe('desktop/agenstra_1.3.0_amd64.exe');
    expect(selectUpdateFile('linux', 'x64')(release)?.path).toBe('desktop/agenstra_1.3.0_amd64.deb');
  });

  it('offers nothing for unsupported platforms or ambiguous releases', () => {
    expect(selectUpdateFile('win32', 'arm64')(release)).toBeUndefined();
    expect(selectUpdateFile('freebsd', 'x64')(release)).toBeUndefined();
    expect(selectUpdateFile('win32', 'x64')([...release, file('agenstra_1.3.1_amd64.exe')])).toBeUndefined();
    expect(
      selectUpdateFile('darwin', 'arm64')([file('nested/native-agent-console-darwin-arm64-1.3.0.zip')]),
    ).toBeUndefined();
  });
});

describe('Authenticode check of the downloaded installer', () => {
  const signed = { status: 'Valid', subject: 'CN=ForePath GmbH, O=ForePath GmbH, C=DE' };

  it('requires the same publisher when the installed app is signed', () => {
    expect(authenticodeAccepts(signed, { ...signed })).toBe(true);
    expect(authenticodeAccepts(signed, { status: 'Valid', subject: 'CN=Someone Else' })).toBe(false);
    expect(authenticodeAccepts(signed, { status: 'NotSigned' })).toBe(false);
    expect(authenticodeAccepts(signed, { status: 'HashMismatch', subject: signed.subject })).toBe(false);
    expect(authenticodeAccepts({ status: 'Valid' }, { status: 'Valid' })).toBe(false);
  });

  it('lets an unsigned install rely on the signed manifest but refuses broken signatures', () => {
    expect(authenticodeAccepts({ status: 'NotSigned' }, { status: 'NotSigned' })).toBe(true);
    expect(authenticodeAccepts({ status: 'NotSigned' }, signed)).toBe(true);
    expect(authenticodeAccepts({ status: 'NotSigned' }, { status: 'HashMismatch' })).toBe(false);
    expect(authenticodeAccepts({ status: 'Unknown' }, { status: 'Unknown' })).toBe(false);
  });

  it('fails closed when the status of the installed app is not positively known', () => {
    expect(authenticodeAccepts({ status: 'Unknown' }, signed)).toBe(false);
    expect(authenticodeAccepts({ status: 'Unknown' }, { status: 'NotSigned' })).toBe(false);
    expect(authenticodeAccepts({ status: 'HashMismatch' }, signed)).toBe(false);
    expect(authenticodeAccepts({ status: 'UnknownError' }, signed)).toBe(false);
  });

  it('calls Windows PowerShell by absolute path', () => {
    expect(windowsPowerShellPath('C:\\Windows')).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    expect(windowsPowerShellPath('D:\\WINNT\\')).toBe('D:\\WINNT\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    expect(windowsPowerShellPath(undefined)).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    expect(windowsPowerShellPath('relative\\dir')).toBe(
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    );
  });

  it('detects NSIS installs by their uninstaller', () => {
    expect(isNsisInstall(['native-agent-console.exe', 'Uninstall Agenstra Agent Console.exe'])).toBe(true);
    expect(isNsisInstall(['native-agent-console.exe', 'ffmpeg.dll'])).toBe(false);
  });
});

describe('Linux updates through the package manager', () => {
  it('tells package installs how to upgrade and archive installs where to download', () => {
    expect(linuxInstallKind('/usr/lib/agenstra/native-agent-console', true, false)).toBe('apt');
    expect(linuxInstallKind('/usr/lib/agenstra/native-agent-console', false, true)).toBe('dnf');
    expect(linuxInstallKind('/home/u/agenstra/native-agent-console', true, false)).toBe('archive');
    expect(linuxUpdateInstructions('apt', '1.3.0')).toContain(
      'sudo apt update && sudo apt install --only-upgrade agenstra',
    );
    expect(linuxUpdateInstructions('dnf', '1.3.0')).toContain('sudo dnf upgrade agenstra');
    expect(linuxUpdateInstructions('archive', '1.3.0')).toContain('https://downloads.agenstra.com/');
  });
});
