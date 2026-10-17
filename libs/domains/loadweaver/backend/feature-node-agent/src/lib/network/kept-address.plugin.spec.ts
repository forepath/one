import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { KeptAddressPlugin, keptInterface, keptNetworkName, renderKeptTable } from './kept-address.plugin';

describe('kept-address network plugin (3.10)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lw-kept-'));
    process.env['LOADWEAVER_STATE_DIR'] = dir;
  });

  afterEach(async () => {
    delete process.env['LOADWEAVER_STATE_DIR'];
    await rm(dir, { recursive: true, force: true });
  });

  it('names networks per address family mix and veths within the kernel limit', () => {
    expect(keptNetworkName(['10.88.0.5'])).toBe('loadweaver-kept-4');
    expect(keptNetworkName(['10.88.0.5', 'fd00:42::5'])).toBe('loadweaver-kept-46');
    expect(keptNetworkName(['fd00:42::5'])).toBe('loadweaver-kept-6');
    expect(keptInterface('e'.repeat(64))).toMatch(/^lwk[0-9a-f]{10}$/);
    expect(`${keptInterface('e'.repeat(64))}c`.length).toBeLessThanOrEqual(15);
  });

  it('lets every kept veth send only with its own addresses', () => {
    const table = renderKeptTable([{ id: 'ep1', v4: '10.88.0.5' }]);
    const name = keptInterface('ep1');

    expect(table).toContain(`iifname "${name}" meta nfproto ipv4 ip saddr != 10.88.0.5 counter drop`);
    expect(table).toContain(`iifname "${name}" meta nfproto ipv6 ip6 saddr != { fe80::/10, ::/128 } counter drop`);
    expect(table.startsWith('table inet lw_kept\ndelete table inet lw_kept\n')).toBe(true);
  });

  it('hands out exactly the kept address and wires a routed veth to it', async () => {
    const commands: string[] = [];
    const runner = {
      run: jest.fn(
        async (cmd: string, args: string[]) => (commands.push(`${cmd} ${args.join(' ')}`), { stdout: '', stderr: '' }),
      ),
    };
    const plugin = new KeptAddressPlugin(runner as never, {} as never);
    const h = plugin.handlers;

    expect(await h['/Plugin.Activate']({})).toEqual({ Implements: ['NetworkDriver', 'IpamDriver'] });
    expect(await h['/IpamDriver.RequestPool']({})).toMatchObject({ Pool: '0.0.0.0/0', PoolID: 'v4' });
    expect(await h['/IpamDriver.RequestPool']({ V6: true })).toMatchObject({ Pool: '::/0', PoolID: 'v6' });
    expect(
      await h['/IpamDriver.RequestAddress']({
        PoolID: 'v4',
        Options: { RequestAddressType: 'com.docker.network.gateway' },
      }),
    ).toEqual({ Address: '169.254.1.1/32' });
    expect(await h['/IpamDriver.RequestAddress']({ PoolID: 'v4', Address: '10.88.0.5' })).toEqual({
      Address: '10.88.0.5/32',
    });
    expect(await h['/IpamDriver.RequestAddress']({ PoolID: 'v4' })).toMatchObject({ Err: expect.any(String) });

    await h['/NetworkDriver.CreateEndpoint']({ EndpointID: 'ep1', Interface: { Address: '10.88.0.5/32' } });

    const host = keptInterface('ep1');
    const join = await h['/NetworkDriver.Join']({ EndpointID: 'ep1' });

    expect(join).toEqual({
      InterfaceName: { SrcName: `${host}c`, DstPrefix: 'eth' },
      Gateway: '169.254.1.1',
      StaticRoutes: [{ Destination: '169.254.1.1/32', RouteType: 1 }],
      DisableGatewayService: true,
    });
    expect(commands).toEqual(
      expect.arrayContaining([
        `ip link add ${host} type veth peer name ${host}c`,
        `ip addr replace 169.254.1.1/32 dev ${host}`,
        `ip route replace 10.88.0.5/32 dev ${host}`,
        'nft -f -',
      ]),
    );

    await h['/NetworkDriver.DeleteEndpoint']({ EndpointID: 'ep1' });
    expect(commands).toContain(`ip link del ${host}`);
  });
  it('serializes concurrent endpoint writes, each through its own temp file', async () => {
    const runner = { run: jest.fn(async () => ({ stdout: '', stderr: '' })) };
    const plugin = new KeptAddressPlugin(runner as never, {} as never);
    const h = plugin.handlers;

    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        h['/NetworkDriver.CreateEndpoint']({ EndpointID: `ep${i}`, Interface: { Address: `10.88.0.${i + 2}/32` } }),
      ),
    );

    const stored = JSON.parse(await readFile(join(dir, 'kept-endpoints.json'), 'utf8')) as { id: string }[];

    expect(stored.map((e) => e.id).sort()).toEqual(Array.from({ length: 10 }, (_, i) => `ep${i}`).sort());
    expect((await readdir(dir)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it("rebuilds a corrupt endpoint file from Docker's kept-address networks", async () => {
    await writeFile(join(dir, 'kept-endpoints.json'), '[{"id": "ep1", "v4": "10.8');
    process.env['LOADWEAVER_KEPT_PLUGIN_SOCKET'] = join(dir, 'kept.sock');

    const commands: string[] = [];
    const runner = {
      run: jest.fn(
        async (cmd: string, args: string[]) => (commands.push(`${cmd} ${args.join(' ')}`), { stdout: '', stderr: '' }),
      ),
    };
    const docker = {
      listNetworks: jest.fn(async () => [{ Id: 'net1', Name: 'loadweaver-kept-46' }]),
      getNetwork: jest.fn(() => ({
        inspect: async () => ({
          Containers: { c1: { EndpointID: 'ep1', IPv4Address: '10.88.0.5/32', IPv6Address: 'fd00:42::5/128' } },
        }),
      })),
    };
    const plugin = new KeptAddressPlugin(runner as never, docker as never);

    try {
      await plugin.start();
      expect(docker.listNetworks).toHaveBeenCalledWith({ filters: { driver: ['loadweaver-kept'] } });
      expect(JSON.parse(await readFile(join(dir, 'kept-endpoints.json'), 'utf8'))).toEqual([
        { id: 'ep1', v4: '10.88.0.5', v6: 'fd00:42::5' },
      ]);
      expect(await plugin.handlers['/NetworkDriver.Join']({ EndpointID: 'ep1' })).toMatchObject({
        Gateway: '169.254.1.1',
      });
    } finally {
      plugin.onModuleDestroy();
      delete process.env['LOADWEAVER_KEPT_PLUGIN_SOCKET'];
    }
  });
});
