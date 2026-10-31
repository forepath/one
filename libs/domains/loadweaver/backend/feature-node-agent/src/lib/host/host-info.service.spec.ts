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

  it('reports the isolation levels from the probes: ready levels, every state, KVM facts, no name matching', async () => {
    const at = '2026-10-23T10:00:00.000Z';
    const report = {
      checkedAt: at,
      levels: {
        runc: { state: 'ready', checkedAt: at },
        sandboxed: { state: 'ready', checkedAt: at },
        'sandboxed-kvm': { state: 'unsupported', reasonCode: 'E_KVM_UNAVAILABLE', checkedAt: at },
        microvm: { state: 'disabled-by-admin', reasonCode: 'E_DISABLED_BY_ADMIN', checkedAt: at },
      },
      runtimes: ['runc', 'sandboxed'],
      kvm: {
        cpu: 'no',
        device: 'absent',
        module: 'absent',
        nested: 'no',
        hypervisor: 'yes',
        usable: false,
        optOut: true,
      },
      cpuFlagsHash: 'a'.repeat(64),
      dockerRuntimes: {
        'runsc-systrap': { path: 'runsc', runtimeArgs: ['--platform=systrap'] },
        'runsc-kvm': { path: 'runsc', runtimeArgs: ['--platform=kvm'] },
      },
    };
    const commands = {
      run: jest.fn(async () => ({ stdout: '', stderr: '' })),
      available: jest.fn(async () => true),
      json: jest.fn(async (cmd: string) => (cmd === 'docker' ? { ServerVersion: '29.0.0' } : [])),
    };
    const caps = await new HostInfoService(commands as never, { current: async () => report } as never).capabilities();

    expect(caps.runtimes).toEqual(['runc', 'sandboxed']);
    expect(caps.sandboxProbe).toBe('ready');
    expect(caps.isolation).toBe(report.levels);
    expect(caps.kvm).toEqual(report.kvm);
    expect(caps.cpuFlagsHash).toBe('a'.repeat(64));
    expect(caps.dockerVersion).toBe('29.0.0');
    // The KVM runtime is registered, but its level isn't ready: no gVisor-KVM checkpoints.
    expect(caps.checkpoint?.runscKvm).toBe(false);
    // No microVM level: no full VMs either.
    expect(caps.virtualMachines).toBe(false);
  });

  it('offers full VMs with a ready microVM level, the launcher and DRBD 9', async () => {
    const at = '2026-10-23T10:00:00.000Z';
    const report = {
      checkedAt: at,
      levels: { runc: { state: 'ready', checkedAt: at }, microvm: { state: 'ready', checkedAt: at } },
      runtimes: ['runc', 'microvm'],
      microvm: { launcherDigest: `sha256:${'b'.repeat(64)}`, unpackCache: true, thinPool: true },
      dockerRuntimes: {},
    };
    const commands = {
      run: jest.fn(async () => ({ stdout: '', stderr: '' })),
      available: jest.fn(async () => true),
      json: jest.fn(async (cmd: string) => (cmd === 'docker' ? { ServerVersion: '29.0.0' } : [])),
    };
    const service = new HostInfoService(commands as never, { current: async () => report } as never);

    jest.spyOn(service, 'drbd9').mockResolvedValue(true);
    expect((await service.capabilities()).virtualMachines).toBe(true);

    jest.spyOn(service, 'drbd9').mockResolvedValue(false);
    expect((await service.capabilities()).virtualMachines).toBe(false);
    // Generic microVM live migration (M7 W10b): only with the launcher's virtio-fs migration support.
    expect((await service.capabilities()).microvmMigration).toBe(false);
    report.microvm = { ...report.microvm, migration: { generic: true, modes: ['generic', 'vm'] } } as never;
    expect((await service.capabilities()).microvmMigration).toBe(true);
    // Bundled microVMs (M7 F5): their image is the launcher; the agent drives them where the microVM level is ready.
    expect((await service.capabilities()).microvmBundledMigration).toBe(true);
    report.levels.microvm = { state: 'probe-failed', checkedAt: at };
    expect((await service.capabilities()).microvmBundledMigration).toBe(false);
  });

  it('reports the kernel host name DRBD matches against, if DRBD can use it', () => {
    expect(kernelHostname('node-1')).toBe('node-1');
    expect(kernelHostname('node-1.dc1.example.com')).toBe('node-1.dc1.example.com');
    expect(kernelHostname('bad"name')).toBeUndefined();
  });
});
