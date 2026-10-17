import { networkConfig } from '../test-fixtures';
import { renderBird } from './bird.renderer';

describe('renderBird', () => {
  const conf = renderBird(networkConfig());

  it('sets router id and device routes to link peers (IGP for recursive next hops)', () => {
    expect(conf).toContain('router id 10.93.0.1;');
    expect(conf).toContain('protocol static lw_links4 {\n  ipv4;\n  route 10.93.0.2/32 via "lw-0a1b2c3d";\n}');
    expect(conf).toContain('route fd00:93::2/128 via "lw-0a1b2c3d";');
  });

  it('originates pod subnets and overlay addresses as blackholes and only exports BGP + link routes to the kernel', () => {
    expect(conf).toContain('  route 10.88.0.0/24 blackhole;');
    expect(conf).toContain('  route fd00:42::/80 blackhole;');
    expect(conf).toContain(
      'export filter { if proto = "lw_links4" then accept; if source = RTS_BGP then accept; reject; };',
    );
  });

  it('renders one session per family with exact prefix filters', () => {
    expect(conf).toContain('protocol bgp lw_n2_4 {');
    expect(conf).toContain('protocol bgp lw_n2_6 {');
    expect(conf).toContain('  local 10.93.0.1 as 4200000000;\n  neighbor 10.93.0.2 as 4200000000;');
    expect(conf).toContain('  multihop;');
    expect(conf).toContain(
      'filter lw_n2_4_import {\n  if net ~ [ 10.88.1.0/24, 10.93.0.2/32 ] then accept;\n  reject;\n}',
    );
    expect(conf).toContain('filter lw_n2_6_export {\n  if net ~ [ fd00:93::1/128 ] then accept;\n  reject;\n}');
  });

  it('never rewrites next hops (no transit through reflectors) and marks reflector clients', () => {
    expect(conf).not.toContain('next hop self');

    const rr = networkConfig();

    rr.bgp.sessions[0].role = 'route-reflector-client';
    expect(renderBird(rr)).toContain('  rr client;');
  });

  it('rejects everything when a filter has no prefixes', () => {
    const cfg = networkConfig();

    cfg.bgp.sessions[0].imports = [];
    expect(renderBird(cfg)).toContain('filter lw_n2_4_import { reject; }');
  });
});
