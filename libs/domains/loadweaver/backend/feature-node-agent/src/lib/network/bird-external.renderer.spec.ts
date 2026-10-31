import { renderExternalBgp } from './bird-external.renderer';

describe('renderExternalBgp', () => {
  const ext = {
    asn: 4200000001,
    peers: [
      {
        name: 'transit',
        address: '192.0.2.1',
        asn: 64500,
        bfd: true,
        import: 'partial' as const,
        maxPrefixes: 1000,
        password: 'pw',
        multihop: 2,
        localPref: 200,
      },
      { name: 'ix-v6', address: '2001:db8::1', asn: 64501, bfd: false, import: 'none' as const, maxPrefixes: 1 },
    ],
    announcements: [
      { prefix: '203.0.113.0/24', peers: ['transit'], communities: ['64500:1'], prepend: 1, med: 50 },
      { prefix: '2001:db8:100::/48', peers: ['ix-v6'], communities: [], prepend: 0 },
    ],
    rtrServers: [{ address: '192.0.2.10', port: 323 }],
    gracefulShutdown: true,
  };
  const config = renderExternalBgp(ext);

  it('only exports the announcements meant for each peer, with their attributes', () => {
    expect(config).toContain(
      'filter lw_ext_transit_out {\n  if proto != "lw_announce4" then reject;\n  if net = 203.0.113.0/24 then {\n    bgp_path.prepend(4200000001);\n    bgp_community.add((64500,1));\n    bgp_med = 50;\n    bgp_community.add((65535,0));\n    accept;\n  }\n  reject;\n}',
    );
    expect(config).toContain('route 2001:db8:100::/48 blackhole;');
  });

  it('filters imports: bogons, own prefixes, RPKI-invalid, and limits', () => {
    expect(config).toContain('if net ~ LW_BOGONS4 then reject;');
    expect(config).toContain('if net ~ [ 203.0.113.0/24+ ] then reject;');
    expect(config).toContain('if roa_check(lw_roa4, net, bgp_path.last_nonaggregated) = ROA_INVALID then reject;');
    expect(config).toContain('bgp_local_pref = 200;');
    expect(config).toContain('import limit 1000 action restart;');
    expect(config).toMatch(
      /filter lw_ext_ix_v6_in \{\n {2}if net ~ LW_BOGONS6 then reject;\n {2}if net ~ \[ 2001:db8:100::\/48\+ \] then reject;\n {2}reject;\n\}/,
    );
  });

  it('configures sessions with password, multihop, BFD and RPKI validators', () => {
    expect(config).toContain('  password "pw";');
    expect(config).toContain('  multihop 2;');
    expect(config).toContain('protocol bfd lw_bfd');
    expect(config).toContain('remote 192.0.2.10 port 323;');
  });
});
