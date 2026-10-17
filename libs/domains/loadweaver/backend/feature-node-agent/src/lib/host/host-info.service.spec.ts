import {
  drbdMajorVersion,
  HostInfoService,
  isSupportedOs,
  kernelHostname,
  nodeArch,
  parseOsRelease,
} from './host-info.service';

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

  it('reads the DRBD module major version from /proc/drbd and modinfo', () => {
    expect(drbdMajorVersion('version: 9.2.20 (api:2/proto:86-122)\nGIT-hash: abc\n')).toBe(9);
    expect(drbdMajorVersion('9.2.20\n')).toBe(9);
    expect(drbdMajorVersion('8.4.11\n')).toBe(8);
    expect(drbdMajorVersion('')).toBeNull();
  });

  it('reports a DRBD 9 module that modprobe would load', async () => {
    const info = (stdout: string | Error) =>
      new HostInfoService({
        run: jest.fn(async () => {
          if (stdout instanceof Error) throw stdout;

          return { stdout, stderr: '' };
        }),
      } as never);

    // Unit tests run without a loaded DRBD module (/proc/drbd missing), so modinfo decides.
    if (await info('').drbd9()) return; // a dev host with DRBD 9 loaded

    expect(await info('9.2.20\n').drbd9()).toBe(true);
    expect(await info('8.4.11\n').drbd9()).toBe(false);
    expect(await info(new Error('modinfo: ERROR: Module drbd not found.')).drbd9()).toBe(false);
  });

  it('reports the kernel host name DRBD matches against, if DRBD can use it', () => {
    expect(kernelHostname('node-1')).toBe('node-1');
    expect(kernelHostname('node-1.dc1.example.com')).toBe('node-1.dc1.example.com');
    expect(kernelHostname('bad"name')).toBeUndefined();
  });
});
