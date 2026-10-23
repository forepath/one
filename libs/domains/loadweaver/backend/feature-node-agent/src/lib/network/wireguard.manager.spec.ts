import { networkConfig } from '../test-fixtures';
import { linkDiffers, parseWgDump, WireguardManager } from './wireguard.manager';

const DUMP = [
  'lw-0a1b2c3d\tPRIV\tPUB\t51820\toff',
  'lw-0a1b2c3d\txTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=\t(none)\tn2.example.test:51821\t10.93.0.2/32,10.88.1.10/32,fd00:93::2/128\t0\t0\t0\toff',
  'lw-deadbeef\tPRIV\tPUB\t51821\toff',
  'wg0\tPRIV\tPUB\t51900\toff',
].join('\n');

function fakeRunner(dump: string, addrs: Record<string, string[]> = {}) {
  const calls: string[][] = [];

  return {
    calls,
    run: jest.fn(async (cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);

      return { stdout: cmd === 'wg' && args[0] === 'show' ? dump : '', stderr: '' };
    }),
    json: jest.fn(async (_cmd: string, args: string[]) => [
      {
        addr_info: (addrs[args[args.length - 1]] ?? []).map((a) => ({
          local: a.split('/')[0],
          prefixlen: Number(a.split('/')[1]),
        })),
      },
    ]),
  };
}

describe('WireguardManager', () => {
  const state = { wireguardKeyPath: () => '/var/lib/loadweaver/wireguard.key' };

  it('parses wg dumps', () => {
    const parsed = parseWgDump(DUMP);

    expect(parsed.get('lw-0a1b2c3d')).toEqual({
      name: 'lw-0a1b2c3d',
      listenPort: 51820,
      peers: [
        {
          publicKey: 'xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=',
          endpoint: 'n2.example.test:51821',
          allowedIps: ['10.88.1.10/32', '10.93.0.2/32', 'fd00:93::2/128'],
          keepalive: null,
        },
      ],
    });
    expect(parsed.get('wg0')?.peers).toEqual([]);
  });

  it('detects differences in peers, endpoints, allowed IPs and keepalive', () => {
    const link = networkConfig().wireguard[0];
    const current = parseWgDump(DUMP).get('lw-0a1b2c3d');

    expect(linkDiffers(link, current)).toBe(false);
    expect(linkDiffers({ ...link, allowedIps: ['10.93.0.2/32'] }, current)).toBe(true);
    expect(linkDiffers({ ...link, persistentKeepalive: 25 }, current)).toBe(true);
    expect(linkDiffers({ ...link, peerEndpoint: undefined }, current)).toBe(false);
    expect(linkDiffers(link, undefined)).toBe(true);
  });

  it('removes stale lw- interfaces only, never foreign tunnels', async () => {
    const runner = fakeRunner(DUMP, { 'lw-0a1b2c3d': ['10.93.0.1/32', 'fd00:93::1/128'] });
    const manager = new WireguardManager(runner as never, state as never);

    await manager.apply(networkConfig().wireguard);

    expect(runner.calls).toContainEqual(['ip', 'link', 'del', 'dev', 'lw-deadbeef']);
    expect(runner.calls.some((c) => c.includes('wg0'))).toBe(false);
    expect(runner.calls.some((c) => c[0] === 'wg' && c[1] === 'set')).toBe(false);
  });

  it('creates and configures a new link with exact allowed IPs and addresses', async () => {
    const runner = fakeRunner('');
    const manager = new WireguardManager(runner as never, state as never);
    const link = { ...networkConfig().wireguard[0], persistentKeepalive: 25, peerEndpoint: undefined };

    expect(await manager.apply([link])).toBe(true);
    expect(runner.calls).toContainEqual(['ip', 'link', 'add', 'dev', 'lw-0a1b2c3d', 'type', 'wireguard']);
    expect(runner.calls).toContainEqual([
      'wg',
      'set',
      'lw-0a1b2c3d',
      'listen-port',
      '51820',
      'private-key',
      '/var/lib/loadweaver/wireguard.key',
      'peer',
      'xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=',
      'allowed-ips',
      '10.88.1.10/32,10.93.0.2/32,fd00:93::2/128',
      'persistent-keepalive',
      '25',
    ]);
    expect(runner.calls).toContainEqual(['ip', 'addr', 'add', '10.93.0.1/32', 'dev', 'lw-0a1b2c3d']);
    expect(runner.calls).toContainEqual(['ip', 'link', 'set', 'dev', 'lw-0a1b2c3d', 'mtu', '1420', 'up']);
  });
});
