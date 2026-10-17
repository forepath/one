import { isSupportedOs, nodeArch, parseOsRelease } from './host-info.service';

describe('host info', () => {
  it('parses os-release', () => {
    expect(parseOsRelease('ID=debian\nVERSION_ID="12"\nPRETTY_NAME=\'Debian GNU/Linux 12\'\n# comment\n')).toEqual({
      ID: 'debian',
      VERSION_ID: '12',
      PRETTY_NAME: 'Debian GNU/Linux 12',
    });
  });

  it('knows the supported hosts', () => {
    expect(isSupportedOs({ id: 'debian', versionId: '13', kernel: '', arch: 'amd64' })).toBe(true);
    expect(isSupportedOs({ id: 'ubuntu', versionId: '24.04', kernel: '', arch: 'arm64' })).toBe(true);
    expect(isSupportedOs({ id: 'ubuntu', versionId: '23.10', kernel: '', arch: 'amd64' })).toBe(false);
    expect(isSupportedOs({ id: 'centos', versionId: '9', kernel: '', arch: 'amd64' })).toBe(false);
  });

  it('maps architectures', () => {
    expect(nodeArch('x64')).toBe('amd64');
    expect(nodeArch('arm64')).toBe('arm64');
    expect(() => nodeArch('ia32')).toThrow('unsupported architecture');
  });
});
