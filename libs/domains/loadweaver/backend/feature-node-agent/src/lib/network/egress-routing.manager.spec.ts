import { EgressRoutingManager, egressRouting } from './egress-routing.manager';

describe('egress routing', () => {
  const egress = {
    routes: [
      { interface: 'lw-0000000a', sources: ['10.88.0.10', 'fd00:42::10'], destinations: ['0.0.0.0/0', '::/0'] },
      { interface: 'lw-0000000b', sources: ['10.88.0.11'], destinations: ['192.0.2.0/24', '198.51.100.0/24'] },
    ],
    snat: [],
  };

  it('sends what would take the default route through the gateway link, per source and family', () => {
    const { rules, routes } = egressRouting(egress);

    expect(routes).toEqual([
      { family: 4, table: 7480, interface: 'lw-0000000a', destination: 'default' },
      { family: 6, table: 7480, interface: 'lw-0000000a', destination: 'default' },
      { family: 4, table: 7481, interface: 'lw-0000000b', destination: '192.0.2.0/24' },
      { family: 4, table: 7481, interface: 'lw-0000000b', destination: '198.51.100.0/24' },
    ]);
    expect(rules.filter((r) => r.source === '10.88.0.10/32')).toEqual([
      { family: 4, priority: 7480, source: '10.88.0.10/32', table: 'main' },
      { family: 4, priority: 7481, source: '10.88.0.10/32', table: '7480' },
    ]);
    expect(rules.find((r) => r.source === 'fd00:42::10/128' && r.table !== 'main')?.table).toBe('7480');
    expect(egressRouting(undefined)).toEqual({ rules: [], routes: [] });
  });

  it('adds missing rules after the routes and removes stale ones', async () => {
    const calls: string[] = [];
    const commands = {
      run: jest.fn(async (_cmd: string, args: string[]) => {
        calls.push(args.join(' '));

        return { stdout: '', stderr: '' };
      }),
      json: jest.fn(async (_cmd: string, args: string[]) =>
        args[0] === '-4' && args[2] === 'route' && args[5] === 'all'
          ? [
              { dst: 'default', dev: 'lw-0000000a', table: '7480' },
              { dst: '203.0.113.0/24', dev: 'lw-0000000a', table: '7480' },
              { dst: 'default', dev: 'eth0' },
              { dst: '10.0.0.0/8', dev: 'eth0', table: 'local' },
            ]
          : args[0] === '-4' && args[2] === 'rule'
            ? [
                { priority: 7480, src: '10.88.0.10', srclen: 32, table: 'main', suppress_prefixlength: 0 },
                { priority: 7481, src: '10.88.0.99', srclen: 32, table: '7480' },
                { priority: 32766, table: 'main' },
              ]
            : [],
      ),
    };
    const manager = new EgressRoutingManager(commands as never);

    expect(await manager.apply({ routes: [egress.routes[0]], snat: [] })).toBe(true);
    expect(calls[0]).toBe('-4 route replace default dev lw-0000000a table 7480');
    expect(calls).toContain('-4 rule add from 10.88.0.10/32 lookup 7480 priority 7481');
    expect(calls).not.toContain('-4 rule add from 10.88.0.10/32 lookup main suppress_prefixlength 0 priority 7480');
    expect(calls).toContain('-6 rule add from fd00:42::10/128 lookup main suppress_prefixlength 0 priority 7480');
    expect(calls).toContain('-4 rule del from 10.88.0.99/32 lookup 7480 priority 7481');
    // A destination the policy no longer covers leaves the gateway table.
    expect(calls).toContain('-4 route del 203.0.113.0/24 table 7480');
    expect(calls).not.toContain('-4 route del default table 7480');
    expect(calls.filter((c) => c.includes('route del'))).toHaveLength(1);
    expect(calls.some((c) => c.includes('32766'))).toBe(false);
  });
});
