import { networkConfig } from '../test-fixtures';
import { PodNetworkManager, podGatewayCommands } from './pod-network.manager';

describe('pod network guest gateways (3.35)', () => {
  it('gives the bridge the link-local gateways of microVM / VM guests and turns ICMP redirects off', () => {
    expect(podGatewayCommands([], true)).toEqual([
      ['ip', 'addr', 'add', '169.254.1.1/32', 'dev', 'lwbr0'],
      ['ip', '-6', 'addr', 'add', 'fe80::1/64', 'dev', 'lwbr0', 'nodad'],
      ['sysctl', '-q', '-w', 'net.ipv4.conf.lwbr0.send_redirects=0'],
    ]);
    expect(
      podGatewayCommands([{ ifname: 'lwbr0', addr_info: [{ local: '169.254.1.1' }, { local: 'fe80::1' }] }], true),
    ).toEqual([['sysctl', '-q', '-w', 'net.ipv4.conf.lwbr0.send_redirects=0']]);
    // IPv4-only pod network: no IPv6 gateway.
    expect(podGatewayCommands([], false).map((c) => c.join(' '))).not.toContain(
      'ip -6 addr add fe80::1/64 dev lwbr0 nodad',
    );
  });

  it('ensures the gateways on every apply, also when the Docker network is unchanged', async () => {
    const config = networkConfig();
    const subnets = config.bgp.originate.filter((p) => (p.includes(':') ? !p.endsWith('/128') : !p.endsWith('/32')));
    const docker = {
      listNetworks: jest.fn(async () => [
        { Id: 'n', Name: 'loadweaver', IPAM: { Config: subnets.map((Subnet) => ({ Subnet })) } },
      ]),
    };
    const commands = {
      json: jest.fn(async () => [{ ifname: 'lwbr0', addr_info: [] }]),
      run: jest.fn(async () => ({ stdout: '', stderr: '' })),
    };
    const result = await new PodNetworkManager(docker as never, commands as never).apply(config);

    expect(result.changed).toBe(true);
    expect(commands.run).toHaveBeenCalledWith('ip', ['addr', 'add', '169.254.1.1/32', 'dev', 'lwbr0']);
    expect(commands.run).toHaveBeenCalledWith('sysctl', ['-q', '-w', 'net.ipv4.conf.lwbr0.send_redirects=0']);

    // Without the command runner (lab entries construct it with Docker only) nothing else happens.
    expect((await new PodNetworkManager(docker as never).apply(config)).changed).toBe(false);
  });
});
