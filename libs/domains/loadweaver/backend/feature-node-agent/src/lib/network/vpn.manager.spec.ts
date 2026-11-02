import { agentMessage, type NodeNetworkConfig } from '@forepath/loadweaver/shared/util-agent-protocol';

import { activeSessions, parseVpnDump, renderVpnConf, vpnDiffers, VpnManager } from './vpn.manager';

type RemoteAccess = NonNullable<NodeNetworkConfig['remoteAccess']>;

const GATEWAY_PRIVATE = 'eE0p3ByhSkMOMRCVOzVbjNHq9kGOWzDTNMvSdoB1q2o=';
const GATEWAY_PUBLIC = 'xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=';
const LAPTOP = 'HIgo9xNzJMWLKASShiTqIybxZ0U3wGLiUeJ1PKf8ykw=';
const OFFICE = 'TrMvSoP4jYQlY6RIzBgbssQqY3vxI2Pi+y71lOWWXX0=';

function config(extra: Partial<RemoteAccess> = {}): RemoteAccess {
  return {
    active: true,
    listenPort: 51800,
    address: '100.96.0.1/22',
    peers: [
      {
        id: '0b8f7c38-4c55-4a52-9f3e-6a0d1fd4a001',
        label: 'alice@example.com/laptop',
        publicKey: LAPTOP,
        allowedIps: ['100.96.0.10/32'],
      },
      {
        id: '0b8f7c38-4c55-4a52-9f3e-6a0d1fd4a002',
        label: 'machine/berlin',
        publicKey: OFFICE,
        allowedIps: ['100.96.0.20/32', '192.168.10.0/24'],
      },
    ],
    prefixes: ['100.96.0.0/22', '192.168.10.0/24'],
    privateKey: GATEWAY_PRIVATE,
    ...extra,
  };
}

const DUMP = [
  `PRIV\t${GATEWAY_PUBLIC}\t51800\toff`,
  `${LAPTOP}\t(none)\t198.51.100.7:40211\t100.96.0.10/32\t1700000000\t1200\t3400\toff`,
  `${OFFICE}\t(none)\t(none)\t192.168.10.0/24,100.96.0.20/32\t0\t0\t0\toff`,
].join('\n');

function fakeRunner(options: { exists?: boolean; dump?: string; addrs?: string[]; routes?: object[] } = {}) {
  const calls: { cmd: string; args: string[]; input?: string }[] = [];

  return {
    calls,
    run: jest.fn(async (cmd: string, args: string[], opts: { input?: string } = {}) => {
      calls.push({ cmd, args, input: opts.input });

      if (cmd === 'wg' && args[0] === 'show' && args[1] === 'interfaces')
        return { stdout: options.exists === false ? 'lw-0a1b2c3d\n' : 'lw-0a1b2c3d lw-vpn\n', stderr: '' };

      if (cmd === 'wg' && args[0] === 'show') return { stdout: options.dump ?? DUMP, stderr: '' };

      if (cmd === 'wg' && args[0] === 'pubkey') return { stdout: `${GATEWAY_PUBLIC}\n`, stderr: '' };

      return { stdout: '', stderr: '' };
    }),
    json: jest.fn(async (_cmd: string, args: string[]) =>
      args.includes('addr')
        ? [
            {
              addr_info: (options.addrs ?? []).map((a) => ({
                local: a.split('/')[0],
                prefixlen: Number(a.split('/')[1]),
                family: 'inet',
              })),
            },
          ]
        : (options.routes ?? []),
    ),
  };
}

describe('VpnManager', () => {
  it('renders the syncconf input with the gateway key and every client', () => {
    expect(renderVpnConf(config(), GATEWAY_PRIVATE)).toBe(
      [
        '[Interface]',
        `PrivateKey = ${GATEWAY_PRIVATE}`,
        'ListenPort = 51800',
        '',
        '[Peer]',
        `PublicKey = ${LAPTOP}`,
        'AllowedIPs = 100.96.0.10/32',
        '',
        '[Peer]',
        `PublicKey = ${OFFICE}`,
        'AllowedIPs = 100.96.0.20/32, 192.168.10.0/24',
        '',
      ].join('\n'),
    );
  });

  it('parses dumps, detects differences and keeps only recent sessions', () => {
    const dump = parseVpnDump(DUMP);

    expect(dump?.publicKey).toBe(GATEWAY_PUBLIC);
    expect(dump?.peers[1].allowedIps).toEqual(['100.96.0.20/32', '192.168.10.0/24']);
    expect(vpnDiffers(config(), dump, GATEWAY_PUBLIC)).toBe(false);
    expect(vpnDiffers(config({ listenPort: 51901 }), dump, GATEWAY_PUBLIC)).toBe(true);
    expect(vpnDiffers(config({ peers: config().peers.slice(0, 1) }), dump, GATEWAY_PUBLIC)).toBe(true);
    // A rotated gateway key needs a sync too.
    expect(vpnDiffers(config(), dump, LAPTOP)).toBe(true);
    expect(activeSessions(dump?.peers ?? [], 1_700_000_100)).toEqual([
      {
        publicKey: LAPTOP,
        endpoint: '198.51.100.7:40211',
        latestHandshake: 1_700_000_000,
        rxBytes: 1200,
        txBytes: 3400,
      },
    ]);
    expect(activeSessions(dump?.peers ?? [], 1_700_000_500)).toEqual([]);
  });

  it('creates the interface, syncs peers through stdin and routes office subnets on the active gateway', async () => {
    const runner = fakeRunner({ exists: false, dump: `PRIV\t${GATEWAY_PUBLIC}\t0\toff` });

    expect(await new VpnManager(runner as never).apply(config())).toBe(true);

    const commands = runner.calls.map((c) => [c.cmd, ...c.args].join(' '));

    expect(commands).toEqual(
      expect.arrayContaining([
        'ip link add dev lw-vpn type wireguard',
        'wg syncconf lw-vpn /dev/stdin',
        'ip addr add 100.96.0.1/22 dev lw-vpn',
        'ip link set dev lw-vpn mtu 1420 up',
        'ip route replace 192.168.10.0/24 dev lw-vpn',
      ]),
    );
    // The key only ever passes through stdin, never through arguments.
    expect(commands.some((c) => c.includes(GATEWAY_PRIVATE))).toBe(false);
    expect(runner.calls.find((c) => c.args[0] === 'syncconf')?.input).toContain(GATEWAY_PRIVATE);
    // The client network is the address's connected route, not a separate one.
    expect(commands).not.toContain('ip route replace 100.96.0.0/22 dev lw-vpn');
  });

  it('keeps standby gateways without address and routes, and removes the interface when no longer a gateway', async () => {
    const runner = fakeRunner({
      addrs: ['100.96.0.1/22'],
      routes: [
        { dst: '100.96.0.0/22', protocol: 'kernel' },
        { dst: '192.168.10.0/24', protocol: 'boot' },
      ],
    });

    await new VpnManager(runner as never).apply(config({ active: false, prefixes: [] }));

    const commands = runner.calls.map((c) => [c.cmd, ...c.args].join(' '));

    expect(commands).toContain('ip addr del 100.96.0.1/22 dev lw-vpn');
    expect(commands).toContain('ip route del 192.168.10.0/24 dev lw-vpn');
    expect(commands).not.toContain('wg syncconf lw-vpn /dev/stdin');

    const removal = fakeRunner();

    expect(await new VpnManager(removal as never).apply(undefined)).toBe(true);
    expect(removal.calls.map((c) => [c.cmd, ...c.args].join(' '))).toContain('ip link del dev lw-vpn');
  });

  it('leaves the gateway alone without its key, and reports sessions only while active', async () => {
    const runner = fakeRunner();
    const manager = new VpnManager(runner as never);

    // Without the key the interface stays as it is, and the node's other layers still apply.
    expect(await manager.apply(config({ privateKey: undefined }))).toBe(false);
    expect(runner.calls).toEqual([]);

    const send = jest.fn();

    manager.attach(send);
    await manager.apply(config({ active: false }));
    await manager.report(1_700_000_100);
    expect(send).not.toHaveBeenCalled();

    await manager.apply(config());
    await manager.report(1_700_000_100);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'vpnSessions',
        payload: agentMessage('vpnSessions', {
          sessions: [
            {
              publicKey: LAPTOP,
              endpoint: '198.51.100.7:40211',
              latestHandshake: 1_700_000_000,
              rxBytes: 1200,
              txBytes: 3400,
            },
          ],
        }).payload,
      }),
    );
    manager.onModuleDestroy();
  });
});
