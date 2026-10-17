import { networkConfig } from '../test-fixtures';
import { renderNftables, ruleTag } from './nftables.renderer';

describe('renderNftables', () => {
  const script = renderNftables(networkConfig());

  it('atomically replaces only the Loadweaver table', () => {
    expect(script.startsWith('table inet loadweaver\ndelete table inet loadweaver\ntable inet loadweaver {')).toBe(
      true,
    );
    expect(script).not.toMatch(/flush ruleset/);
  });

  it('renders per-family interval sets', () => {
    expect(script).toContain(
      'set lw_00000001_4 { type ipv4_addr; flags interval; auto-merge; elements = { 10.88.0.10/32 } }',
    );
    expect(script).toContain(
      'set lw_00000001_6 { type ipv6_addr; flags interval; auto-merge; elements = { fd00:42::10/128 } }',
    );
    expect(script).not.toContain('lw_00000002_6');
  });

  it('renders stateful allow rules only for families both sets have', () => {
    expect(script).toContain(
      '    ip saddr @lw_00000001_4 ip daddr @lw_00000002_4 tcp dport { 8080 } counter accept comment "shop/web-to-api"',
    );
    expect(script).not.toContain('ip6 saddr @lw_00000001_6 ip6 daddr @lw_00000002_6');
  });

  it('logs monitor-mode traffic as observed instead of enforcing', () => {
    expect(script).toContain(
      `tcp dport { 443, 8000-8100 } counter log prefix "lwobs ${ruleTag('shop/expose#2')} " accept`,
    );
  });

  it('matches ICMP per family and ends every managed chain with a logged default deny', () => {
    expect(script).toContain('ip saddr @lw_00000002_4 ip daddr @lw_00000001_4 meta l4proto icmp counter accept');
    expect(script.match(/limit rate 10\/second log prefix "lwdeny " counter drop/g)).toHaveLength(4);
    expect(script).toContain('ct state established,related accept');
  });

  it('allows DNS to the node resolver and DNATs service IPs to reachable replicas', () => {
    expect(script).toContain('iifname "lwbr0" meta l4proto { tcp, udp } th dport 53 accept');
    expect(script).toContain(
      'ip daddr 10.92.0.10 dnat ip to numgen random mod 1 map { 0 : 10.88.1.10 } comment "api.shop.lw"',
    );
    expect(script).toContain('type nat hook prerouting priority dstnat; policy accept;');
  });

  it('strips characters from comments that nft could misinterpret', () => {
    const rules = [{ ...networkConfig().firewall.rules[0], policy: 'evil"; flush ruleset; #' }];
    const out = renderNftables(networkConfig({ firewall: { ...networkConfig().firewall, rules } }));

    expect(out).toContain('comment "evil flush ruleset #"');
  });

  it('omits NAT chains when there are no services', () => {
    expect(renderNftables(networkConfig({ services: [] }))).not.toContain('services_prerouting');
  });
});

describe('egress NAT', () => {
  it('masquerades pod subnets leaving through unmanaged interfaces only', () => {
    const script = renderNftables(networkConfig());

    expect(script).toContain('type nat hook postrouting priority srcnat; policy accept;');
    expect(script).toContain(
      'ip saddr { 10.88.0.0/24 } oifname != { "lw-*", "lwbr0" } counter masquerade comment "builtin:egress"',
    );
    expect(script).toContain(
      'ip6 saddr { fd00:42::/80 } oifname != { "lw-*", "lwbr0" } counter masquerade comment "builtin:egress"',
    );
    // Host routes of the overlay are not pod subnets.
    expect(script).not.toContain('10.93.0.1/32 } oifname');
  });

  it('source-NATs egress policy sources to their address on the gateway, before the masquerade', () => {
    const script = renderNftables({
      ...networkConfig(),
      egress: {
        routes: [],
        snat: [
          { address: '198.51.100.7', sources: ['10.88.0.10', '10.88.1.10'] },
          { address: '2001:db8::7', sources: ['fd00:42::10'] },
        ],
      },
    });
    const snat = script.indexOf('snat ip to 198.51.100.7');

    expect(script).toContain(
      'ip saddr { 10.88.0.10, 10.88.1.10 } oifname != { "lw-*", "lwbr0" } counter snat ip to 198.51.100.7 comment "builtin:egress-snat"',
    );
    expect(script).toContain(
      'ip6 saddr { fd00:42::10 } oifname != { "lw-*", "lwbr0" } counter snat ip6 to 2001:db8::7',
    );
    expect(snat).toBeLessThan(script.indexOf('masquerade'));
  });

  it('NATs remote clients leaving through the active gateway only', () => {
    const remoteAccess = {
      active: true,
      listenPort: 51800,
      address: '100.96.0.1/22',
      peers: [],
      prefixes: ['100.96.0.0/22', '192.168.10.0/24'],
    };

    expect(renderNftables({ ...networkConfig(), remoteAccess })).toContain(
      'ip saddr { 100.96.0.0/22, 192.168.10.0/24 } oifname != { "lw-*", "lwbr0" } counter masquerade comment "builtin:vpn-egress"',
    );
    expect(
      renderNftables({ ...networkConfig(), remoteAccess: { ...remoteAccess, active: false, prefixes: [] } }),
    ).not.toContain('vpn-egress');
  });

  it('drops forged sources from the pod bridge before anything else', () => {
    const script = renderNftables(networkConfig());
    const forward = script.slice(script.indexOf('chain forward'));

    expect(forward).toMatch(
      /iifname "lwbr0" meta nfproto ipv4 ip saddr != \{ [^}]+ \} counter drop comment "builtin:anti-spoofing"/,
    );
    expect(forward.indexOf('anti-spoofing')).toBeLessThan(forward.indexOf('ct state established'));
    expect(script).toContain('fe80::/10, ::/128 } counter drop comment "builtin:anti-spoofing"');
  });
});
