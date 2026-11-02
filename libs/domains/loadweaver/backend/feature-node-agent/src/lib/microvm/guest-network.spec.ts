import {
  eui64LinkLocal,
  GuestNetwork,
  guestNetConfig,
  guestNics,
  linksForNics,
  nicCarrierAddresses,
  microvmMac,
  networkMtu,
  renderGuestNetworkCommands,
  renderNamespaceCommands,
  usesTapNetworking,
} from './guest-network';

const generic = {
  id: 'shop/web/app/0',
  addresses: ['10.88.0.5', 'fd00:88::5'],
  microvm: { mode: 'generic' as const, vcpus: 2, memoryMiB: 512, rootfsBytes: 1024 ** 3 },
};
const vm = {
  id: 'shop/lw-vm/db1/0',
  addresses: ['10.88.0.10'],
  vm: {
    vcpus: 4,
    nics: [
      { name: 'eth0', mac: '52:54:00:aa:bb:01', addresses: ['10.88.0.10'] },
      { name: 'eth1', mac: '52:54:00:aa:bb:02', addresses: ['10.70.0.4', 'fd70::4'] },
    ],
  },
} as never;

describe('guest networking (3.35)', () => {
  it('derives stable guest MACs and their EUI-64 link-local addresses', () => {
    expect(microvmMac('shop/web/app/0')).toMatch(/^52:54:00(:[0-9a-f]{2}){3}$/);
    expect(microvmMac('shop/web/app/0')).toBe(microvmMac('shop/web/app/0'));
    expect(microvmMac('shop/web/app/1')).not.toBe(microvmMac('shop/web/app/0'));
    expect(eui64LinkLocal('52:54:00:12:34:56')).toBe('fe80::5054:ff:fe12:3456');
    expect(() => eui64LinkLocal('nope')).toThrow(/invalid MAC/);
  });

  it('has one tap for a generic microVM, one per NIC for a full VM and none for bundled images', () => {
    expect(guestNics(generic)).toEqual([
      { index: 0, tap: 'lwtap0', mac: microvmMac(generic.id), addresses: generic.addresses },
    ]);
    expect(guestNics(vm)).toEqual([
      { index: 0, tap: 'lwtap0', mac: '52:54:00:aa:bb:01', addresses: ['10.88.0.10'] },
      { index: 1, tap: 'lwtap1', mac: '52:54:00:aa:bb:02', addresses: ['10.70.0.4', 'fd70::4'] },
    ]);
    expect(guestNics({ ...generic, microvm: { ...generic.microvm, mode: 'bundled' } })).toEqual([]);
    expect(guestNics({ id: 'a/b/c/0', addresses: ['10.0.0.1'] })).toEqual([]);
    expect(usesTapNetworking(generic)).toBe(true);
    expect(usesTapNetworking(vm)).toBe(true);
    expect(usesTapNetworking({ microvm: { ...generic.microvm, mode: 'bundled' } })).toBe(false);
    expect(guestNetConfig(guestNics(generic)[0], 1420)).toEqual({
      mac: microvmMac(generic.id),
      mtu: 1420,
      ipv4: '10.88.0.5',
      ipv6: 'fd00:88::5',
    });
  });

  it('renders the tap, the redirect and the anti-spoofing filters (MAC + IP + ARP / NDP), then drops the rest', () => {
    const nic = { index: 0, tap: 'lwtap0', mac: '52:54:00:12:34:56', addresses: ['10.88.0.5', 'fd00:88::5'] };
    const commands = renderGuestNetworkCommands(nic, { ifname: 'eth0', mtu: 1420, addresses: [] }, 2).map((c) =>
      c.join(' '),
    );
    const redirect = 'action mirred egress redirect dev eth0';
    const from = 'tc filter add dev lwtap0 parent ffff:';

    expect(commands).toEqual([
      'ip link set dev eth0 address 52:54:00:12:34:56',
      'ip tuntap add dev lwtap0 mode tap user 10930 multi_queue',
      'ip link set dev lwtap0 mtu 1420 up',
      'ip addr flush dev eth0',
      'sysctl -q -w net.ipv6.conf.eth0.disable_ipv6=1',
      'tc qdisc add dev eth0 ingress',
      'tc qdisc add dev lwtap0 ingress',
      'tc filter add dev eth0 parent ffff: prio 1 matchall action mirred egress redirect dev lwtap0',
      `${from} prio 10 protocol ip flower src_mac 52:54:00:12:34:56 src_ip 10.88.0.5 ${redirect}`,
      `${from} prio 11 protocol arp flower src_mac 52:54:00:12:34:56 arp_sip 10.88.0.5 arp_sha 52:54:00:12:34:56 ${redirect}`,
      `${from} prio 12 protocol ipv6 flower src_mac 52:54:00:12:34:56 src_ip fd00:88::5 ${redirect}`,
      `${from} prio 13 protocol ipv6 flower src_mac 52:54:00:12:34:56 src_ip fe80::5054:ff:fe12:3456 ${redirect}`,
      `${from} prio 14 protocol ipv6 flower src_mac 52:54:00:12:34:56 src_ip :: ip_proto icmpv6 ${redirect}`,
      `${from} prio 99 matchall action drop`,
    ]);
    expect(renderNamespaceCommands()).toEqual([['sysctl', '-q', '-w', 'net.ipv4.conf.all.arp_ignore=8']]);

    // IPv4 only, one vCPU: no IPv6 address filter, no multiqueue.
    const v4 = renderGuestNetworkCommands(
      { ...nic, tap: 'lwtap1', addresses: ['10.70.0.4'] },
      { ifname: 'eth1', mtu: 1500, addresses: [] },
      1,
    ).map((c) => c.join(' '));

    expect(v4).toContain('ip tuntap add dev lwtap1 mode tap user 10930');
    // No group (spike S1): the VMM's group is a system gid, a group restriction refuses the session libvirt.
    expect(v4.join('\n')).not.toContain(' group ');
    expect(v4.filter((c) => c.includes('prio 12'))).toEqual([]);
    expect(v4.filter((c) => c.includes('src_ip 10.70.0.4'))).toHaveLength(1);
  });

  it('maps every NIC to the container interface carrying its address', () => {
    const links = [
      { ifname: 'lo', addr_info: [{ local: '127.0.0.1' }] },
      // A further NIC's container side carries the per-slot placeholder (G5), not the guest's IPv4 address.
      { ifname: 'eth1', mtu: 1500, addr_info: [{ local: '169.254.2.1' }, { local: 'fd70::4' }] },
      { ifname: 'eth0', mtu: 1420, addr_info: [{ local: '10.88.0.10' }] },
    ];

    expect([...linksForNics(guestNics(vm), links)]).toEqual([
      [0, { ifname: 'eth0', mtu: 1420, addresses: ['10.88.0.10'] }],
      [1, { ifname: 'eth1', mtu: 1500, addresses: ['169.254.2.1', 'fd70::4'] }],
    ]);
    expect(nicCarrierAddresses({ index: 1, addresses: ['10.70.0.4', 'fd70::4'] })).toEqual(['169.254.2.1', 'fd70::4']);
    expect(nicCarrierAddresses({ index: 0, addresses: ['10.88.0.10'] })).toEqual(['10.88.0.10']);
    expect(() => linksForNics(guestNics(vm), links.slice(0, 2))).toThrow(/no container interface carries 10.88.0.10/);
  });

  it('reads the endpoint MTU of a Docker network', async () => {
    const docker = (options?: Record<string, string>) =>
      ({ getNetwork: () => ({ inspect: async () => ({ Options: options }) }) }) as never;

    expect(await networkMtu(docker({ 'com.docker.network.driver.mtu': '1420' }), 'loadweaver')).toBe(1420);
    expect(await networkMtu(docker(), 'loadweaver')).toBe(1500);
    expect(await networkMtu(docker({ 'com.docker.network.driver.mtu': 'x' }), 'loadweaver')).toBe(1500);
  });

  describe('attach', () => {
    const setup = (links: unknown[], state = { Running: true, Pid: 4242 }) => {
      const commands = {
        run: jest.fn(async (_command: string, args: string[]) => ({
          stdout: args.includes('-j') ? JSON.stringify(links) : '',
          stderr: '',
        })),
      };
      const docker = { getContainer: () => ({ inspect: async () => ({ State: state }) }) };

      return { commands, network: new GuestNetwork(commands as never, docker as never) };
    };

    it('runs every command inside the launcher netns, per NIC', async () => {
      const { commands, network } = setup([
        { ifname: 'eth0', mtu: 1420, addr_info: [{ local: '10.88.0.10' }] },
        { ifname: 'eth1', mtu: 1500, addr_info: [{ local: '169.254.2.1' }] },
      ]);

      expect(await network.attach('c1', vm)).toBe(true);

      const calls = commands.run.mock.calls.map(([command, args]) => [command, ...args].join(' '));

      expect(calls.every((c) => c.startsWith('nsenter -t 4242 -n -- '))).toBe(true);
      expect(calls).toContain('nsenter -t 4242 -n -- ip tuntap add dev lwtap0 mode tap user 10930 multi_queue');
      expect(calls).toContain('nsenter -t 4242 -n -- ip tuntap add dev lwtap1 mode tap user 10930 multi_queue');
      expect(calls).toContain(
        'nsenter -t 4242 -n -- tc filter add dev eth1 parent ffff: prio 1 matchall action mirred egress redirect dev lwtap1',
      );
      expect(calls.filter((c) => c.includes('arp_ignore'))).toHaveLength(1);
    });

    it('serializes concurrent attaches of one launcher (apply + start event): the taps are created once', async () => {
      let created = false;
      const commands = {
        run: jest.fn(async (_command: string, args: string[]) => {
          await new Promise((r) => setTimeout(r, 5));

          if (args.includes('tuntap')) {
            if (created) throw new Error('ioctl(TUNSETIFF): Device or resource busy');

            created = true;
          }

          return {
            stdout: args.includes('-j')
              ? JSON.stringify(
                  created
                    ? [{ ifname: 'lwtap0' }, { ifname: 'eth0', addr_info: [] }]
                    : [{ ifname: 'eth0', mtu: 1420, addr_info: [{ local: '10.88.0.5' }] }],
                )
              : '',
            stderr: '',
          };
        }),
      };
      const docker = { getContainer: () => ({ inspect: async () => ({ State: { Running: true, Pid: 7 } }) }) };
      const network = new GuestNetwork(commands as never, docker as never);

      expect(await Promise.all([network.attach('c1', generic), network.attach('c1', generic)])).toEqual([true, true]);
      expect(commands.run.mock.calls.filter(([, args]) => args.includes('tuntap'))).toHaveLength(1);
    });

    it('is idempotent and skips launchers without taps or not running', async () => {
      const attached = setup([{ ifname: 'lwtap0' }, { ifname: 'eth0', addr_info: [] }]);

      expect(await attached.network.attach('c1', generic)).toBe(true);
      expect(attached.commands.run).toHaveBeenCalledTimes(1);

      const stopped = setup([], { Running: false, Pid: 0 });

      expect(await stopped.network.attach('c1', generic)).toBe(false);
      expect(stopped.commands.run).not.toHaveBeenCalled();
      expect(await stopped.network.attach('c1', { id: 'a/b/c/0', addresses: ['10.0.0.1'] })).toBe(false);
    });
  });
});
