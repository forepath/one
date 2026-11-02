import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { renderKeepalived } from './keepalived.renderer';
import { loopbackPublicAddresses, PublicAddressManager } from './public-address.manager';

describe('public addresses on the node', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lw-pa-'));
    process.env['LOADWEAVER_KEEPALIVED_CONFIG'] = join(dir, 'keepalived.conf');
  });

  afterEach(() => {
    delete process.env['LOADWEAVER_KEEPALIVED_CONFIG'];
    rmSync(dir, { recursive: true, force: true });
  });

  it('renders one VRRP instance per address, IPv6 natively', () => {
    const config = renderKeepalived('n1', [
      { address: '2001:db8::10', dev: 'eth0', vrid: 7, priority: 100 },
      { address: '203.0.113.10', dev: 'eth0', vrid: 3, priority: 200 },
    ]);

    expect(config.indexOf('vrrp_instance lw_3')).toBeLessThan(config.indexOf('vrrp_instance lw_7'));
    expect(config).toContain('    203.0.113.10/32 dev eth0');
    expect(config).toContain('  native_ipv6');
    expect(config).toContain('  nopreempt');
  });

  it('binds provider addresses on the holder, VRRP through keepalived, BGP on the loopback', async () => {
    const runs: string[] = [];
    let bound: { address: string; dev: string }[] = [{ address: '198.51.100.9/32', dev: 'eth0' }];
    const commands = {
      run: jest.fn(async (cmd: string, args: string[]) => {
        runs.push(`${cmd} ${args.join(' ')}`);

        return { stdout: '', stderr: '' };
      }),
      json: jest.fn(async () => [{ dev: 'eth0' }]),
    };
    const state = {
      boundPublicAddresses: jest.fn(async () => bound),
      saveBoundPublicAddresses: jest.fn(async (b: typeof bound) => void (bound = b)),
    };
    const manager = new PublicAddressManager(commands as never, state as never);
    const addresses = [
      { address: '203.0.113.10', mode: 'provider' as const, active: true },
      { address: '203.0.113.11', mode: 'provider' as const, active: false },
      { address: '198.51.100.1', mode: 'vrrp' as const, active: true, vrrp: { vrid: 1, priority: 200 } },
      { address: '192.0.2.1', mode: 'bgp' as const, active: true, interface: 'ens3' },
    ];

    expect(await manager.apply('n1', addresses)).toBe(true);
    expect(runs).toEqual([
      expect.stringMatching(/^keepalived --config-test -f .*keepalived\.conf\.loadweaver-new$/),
      'systemctl reload-or-restart keepalived',
      'ip addr del 198.51.100.9/32 dev eth0',
      'ip addr replace 203.0.113.10/32 dev eth0',
    ]);
    expect(readFileSync(join(dir, 'keepalived.conf'), 'utf8')).toContain('virtual_router_id 1');
    expect(bound).toEqual([{ address: '203.0.113.10/32', dev: 'eth0' }]);
    expect(loopbackPublicAddresses(addresses)).toEqual(['192.0.2.1/32']);

    runs.length = 0;
    expect(await manager.apply('n1', addresses)).toBe(false);
    expect(runs).toEqual(['ip addr replace 203.0.113.10/32 dev eth0']);
  });
});
