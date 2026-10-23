import {
  LauncherConfigError,
  parseMicrovmNetConfig,
  parseVmLaunchConfig,
  renderGuestNetCmdline,
  renderVmDomainXml,
} from './launcher-config';

const UID = '6f1c2a5e-3b4d-4c8e-9f00-112233445566';

function vm(overrides: Record<string, unknown> = {}) {
  return parseVmLaunchConfig({
    uid: UID,
    firmware: 'uefi',
    cpuModel: 'host-model',
    vcpus: 2,
    memoryMiB: 4096,
    graphics: true,
    disks: [
      { name: 'data', device: '/dev/drbd1001', cache: 'writeback', boot: false },
      { name: 'root', device: '/dev/drbd1000', cache: 'none', boot: true },
    ],
    nics: [
      { name: 'eth0', mac: '52:54:00:aa:bb:cc', tap: 'lwtap0' },
      { name: 'eth1', mac: '52:54:00:aa:bb:cd', tap: 'lwtap1' },
    ],
    ...overrides,
  });
}

describe('generic microVM network configuration', () => {
  it('renders the kernel command line with the link-local gateways', () => {
    const net = parseMicrovmNetConfig({ mac: '52:54:00:12:34:56', mtu: 1420, ipv4: '10.1.0.5', ipv6: 'fd00:1::5' });

    expect(renderGuestNetCmdline(net)).toBe(
      'lw.mac=52:54:00:12:34:56 lw.mtu=1420 lw.ip4=10.1.0.5/32 lw.gw4=169.254.1.1 lw.ip6=fd00:1::5/128 lw.gw6=fe80::1',
    );
    expect(renderGuestNetCmdline(parseMicrovmNetConfig({ mac: '52:54:00:12:34:56', ipv6: 'fd00::5' }))).toBe(
      'lw.mac=52:54:00:12:34:56 lw.mtu=1500 lw.ip6=fd00::5/128 lw.gw6=fe80::1',
    );
  });

  it('refuses values that could inject into the command line', () => {
    expect(() => parseMicrovmNetConfig({ mac: '52:54:00:12:34:56 init=/bin/sh', ipv4: '10.0.0.1' })).toThrow(
      LauncherConfigError,
    );
    expect(() => parseMicrovmNetConfig({ mac: '01:00:5e:00:00:01', ipv4: '10.0.0.1' })).toThrow('invalid mac');
    expect(() => parseMicrovmNetConfig({ mac: '52:54:00:12:34:56', ipv4: '10.0.0.1 quiet' })).toThrow('invalid ipv4');
    expect(() => parseMicrovmNetConfig({ mac: '52:54:00:12:34:56', ipv4: 'fd00::1' })).toThrow('invalid ipv4');
    expect(() => parseMicrovmNetConfig({ mac: '52:54:00:12:34:56', mtu: 100, ipv4: '10.0.0.1' })).toThrow(
      'invalid mtu',
    );
    expect(() => parseMicrovmNetConfig({ mac: '52:54:00:12:34:56' })).toThrow('IPv4 or IPv6');
  });
});

describe('full VM launch configuration', () => {
  it('orders the boot disk first and validates devices, taps and sizes', () => {
    const config = vm();

    expect(config.disks.map((disk) => disk.name)).toEqual(['root', 'data']);
    expect(config.guestAgent).toBe(true);
    expect(() => vm({ disks: [{ name: 'root', device: '/dev/sda', boot: true }] })).toThrow('invalid device');
    expect(() => vm({ disks: [{ name: 'root', device: '/dev/drbd1', boot: false }] })).toThrow('boot disk');
    expect(() => vm({ nics: [{ name: 'eth0', mac: '52:54:00:aa:bb:cc', tap: 'eth0' }] })).toThrow('invalid tap');
    expect(() =>
      vm({
        nics: [
          { name: 'eth0', mac: '52:54:00:aa:bb:cc', tap: 'lwtap0' },
          { name: 'eth1', mac: '52:54:00:aa:bb:cc', tap: 'lwtap1' },
        ],
      }),
    ).toThrow('NIC macs must be unique');
    expect(() => vm({ vcpus: 65 })).toThrow('invalid vcpus');
    expect(() => vm({ memoryMiB: 128 })).toThrow('invalid memoryMiB');
    expect(() => vm({ uid: 'x' })).toThrow('invalid uid');
  });

  it('renders a UEFI domain with block disks, taps, the seed, consoles and the guest agent', () => {
    const xml = renderVmDomainXml({
      config: vm(),
      arch: 'x86_64',
      runDir: '/dev/shm/agenstra-microvm/vmm',
      seedImage: '/dev/shm/agenstra-microvm/vmm/seed.img',
    });

    expect(xml).toContain(`<uuid>${UID}</uuid>`);
    expect(xml).toContain("<loader readonly='yes' type='pflash'>/usr/share/OVMF/OVMF_CODE_4M.fd</loader>");
    expect(xml).toContain(
      "<nvram template='/usr/share/OVMF/OVMF_VARS_4M.fd'>/dev/shm/agenstra-microvm/vmm/nvram.fd</nvram>",
    );
    expect(xml).toContain(
      "<disk type='block' device='disk'><driver name='qemu' type='raw' cache='none' io='native' discard='unmap'/><source dev='/dev/drbd1000'/><target dev='vda' bus='virtio'/><serial>root</serial></disk>",
    );
    expect(xml).toContain("cache='writeback' io='threads'");
    expect(xml).toContain("<source dev='/dev/drbd1001'/><target dev='vdb' bus='virtio'/>");
    expect(xml).toContain("<target dev='lwtap1' managed='no'/>");
    expect(xml).toContain("<driver queues='2'/>");
    expect(xml).toContain("device='cdrom'");
    expect(xml).toContain('<readonly/>');
    expect(xml).toContain("<graphics type='vnc' socket='/dev/shm/agenstra-microvm/vmm/vnc.sock'/>");
    expect(xml).toContain(
      "<serial type='unix'><source mode='bind' path='/dev/shm/agenstra-microvm/vmm/console.sock'/>",
    );
    expect(xml).toContain("name='org.qemu.guest_agent.0'");
    expect(xml).toContain("<cpu mode='host-model'/>");
  });

  it('uses AAVMF on arm64 and refuses BIOS there', () => {
    const xml = renderVmDomainXml({ config: vm({ graphics: false }), arch: 'aarch64', runDir: '/run/vm' });

    expect(xml).toContain("machine='virt'");
    expect(xml).toContain('/usr/share/AAVMF/AAVMF_CODE.fd');
    expect(xml).not.toContain('<graphics');
    expect(xml).not.toContain("device='cdrom'");
    expect(() => renderVmDomainXml({ config: vm({ firmware: 'bios' }), arch: 'aarch64', runDir: '/run/vm' })).toThrow(
      'BIOS firmware is not available on aarch64',
    );
    expect(renderVmDomainXml({ config: vm({ firmware: 'bios' }), arch: 'x86_64', runDir: '/run/vm' })).not.toContain(
      '<loader',
    );
  });

  it('escapes the run directory', () => {
    expect(renderVmDomainXml({ config: vm(), arch: 'x86_64', runDir: "/run/a'b<c" })).toContain(
      '/run/a&apos;b&lt;c/console.sock',
    );
  });
});
