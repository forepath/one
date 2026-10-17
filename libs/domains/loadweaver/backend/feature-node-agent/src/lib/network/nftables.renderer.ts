import { createHash } from 'node:crypto';

import type { NodeNetworkConfig } from '@forepath/loadweaver/shared/util-agent-protocol';

import { EGRESS_HTTP_PORT, EGRESS_TLS_PORT, MESH_OUTBOUND_PORT } from '../mesh/mesh-config';
import { podNetworkSpec } from './pod-network.manager';

/** Loadweaver keeps all rules in its own table, so foreign rules stay intact (3.21). */
export const NFT_TABLE = 'loadweaver';
/** Interfaces whose traffic Loadweaver owns: WireGuard links and the workload bridge. */
export const MANAGED_INTERFACES = ['lw-*', 'lwbr0'];

type FirewallRule = NodeNetworkConfig['firewall']['rules'][number];

function isV6(address: string): boolean {
  return address.includes(':');
}

/** Short stable id for log prefixes (nft limits prefixes to 127 characters). */
export function ruleTag(id: string): string {
  return createHash('sha256').update(id).digest('hex').slice(0, 12);
}

function quote(value: string): string {
  // Comments only carry policy names from the control plane; strip anything nft could misread.
  return `"${value.replace(/[^A-Za-z0-9 :/#._-]/g, '').slice(0, 120)}"`;
}

function renderSet(name: string, family: 4 | 6, members: string[]): string {
  const type = family === 4 ? 'ipv4_addr' : 'ipv6_addr';
  const elements = members.length > 0 ? ` elements = { ${members.join(', ')} }` : '';

  return `  set ${name}_${family} { type ${type}; flags interval; auto-merge;${elements} }`;
}

function l4Match(rule: FirewallRule, family: 4 | 6): string {
  switch (rule.protocol) {
    case 'any':
      return '';
    case 'icmp':
      return family === 4 ? 'meta l4proto icmp' : 'meta l4proto ipv6-icmp';
    default:
      return rule.ports.length > 0
        ? `${rule.protocol} dport { ${rule.ports.join(', ')} }`
        : `meta l4proto ${rule.protocol}`;
  }
}

function renderRule(rule: FirewallRule, family: 4 | 6, available: Set<string>): string | null {
  const src = `${rule.srcSet}_${family}`;
  const dst = `${rule.dstSet}_${family}`;

  if (!available.has(src) || !available.has(dst)) return null;

  const addr = family === 4 ? 'ip' : 'ip6';
  const verdict = rule.action === 'observe' ? `log prefix "lwobs ${ruleTag(rule.id)} " accept` : 'accept';
  const parts = [
    `${addr} saddr @${src}`,
    `${addr} daddr @${dst}`,
    l4Match(rule, family),
    'counter',
    verdict,
    `comment ${quote(rule.policy)}`,
  ].filter(Boolean);

  return `    ${parts.join(' ')}`;
}

/** Stable service IPs DNAT'ed to the replicas this node may reach (3.4). */
function renderServiceNat(config: NodeNetworkConfig): string[] {
  const lines: string[] = [];

  for (const service of config.services) {
    if (service.backends.length === 0) continue;

    const addr = isV6(service.serviceIp) ? 'ip6' : 'ip';
    const backends = service.backends.map((b, i) => `${i} : ${b}`).join(', ');

    lines.push(
      `    ${addr} daddr ${service.serviceIp} dnat ${addr} to numgen random mod ${service.backends.length} map { ${backends} } comment ${quote(service.name)}`,
    );
  }

  return lines;
}

/**
 * Service traffic the node proxy carries (3.7): redirected to its outbound listener on the pod gateway; the proxy
 * reads the original service address and port (`original_dst`).
 */
function renderMeshRedirects(config: NodeNetworkConfig): string[] {
  return (config.mesh?.outbound ?? []).map((o) => {
    const family = isV6(o.serviceIp) ? 'ip6' : 'ip';

    return `    ${family} saddr ${o.source} ${family} daddr ${o.serviceIp} tcp dport ${o.port} counter redirect to :${MESH_OUTBOUND_PORT} comment "builtin:mesh"`;
  });
}

/**
 * Web egress the node proxy inspects (3.7): per source and web port, exactly the destinations its policies allow
 * outside the cluster (the redirect skips the forward chain, so it must not cover more).
 */
function renderEgressRedirects(config: NodeNetworkConfig): string[] {
  const filter = config.egressFilter;

  if (!filter) return [];

  return filter.sources.flatMap((s) =>
    s.ports.map((p) => {
      const family = isV6(s.address) ? 'ip6' : 'ip';
      const cluster = filter.clusterRanges.filter((r) => isV6(r) === isV6(s.address));
      const target = p.port === 80 ? EGRESS_HTTP_PORT : EGRESS_TLS_PORT;

      return [
        `    ${family} saddr ${s.address}`,
        ...(cluster.length ? [`${family} daddr != { ${cluster.join(', ')} }`] : []),
        `${family} daddr { ${p.destinations.join(', ')} } tcp dport ${p.port}`,
        `counter redirect to :${target} comment "builtin:egress-filter"`,
      ].join(' ');
    }),
  );
}

/** While filtering: no QUIC (falls back to TCP, where SNI is visible) and no DNS over TLS (would bypass DNS policy). */
function renderEgressDenials(config: NodeNetworkConfig): string[] {
  const filter = config.egressFilter;

  if (!filter || filter.mode === 'monitor') return [];

  return filter.sources.flatMap((s) => {
    const family = isV6(s.address) ? 'ip6' : 'ip';

    return [
      `    ${family} saddr ${s.address} udp dport 443 counter drop comment "builtin:egress-quic"`,
      `    ${family} saddr ${s.address} tcp dport 853 counter drop comment "builtin:egress-dot"`,
    ];
  });
}

/**
 * Pods leaving the cluster get the node's address (egress NAT): traffic to other nodes, pods and service IPs always
 * leaves through a managed interface (WireGuard links, the pod bridge), everything else goes upstream. Whether a
 * pod may leave at all is decided by the forward chain (policies towards `internet`, 3.3).
 */
function renderEgressNat(config: NodeNetworkConfig, managed: string): string[] {
  const subnets = podNetworkSpec(config).subnets;
  const v4 = subnets.filter((s) => !isV6(s));
  const v6 = subnets.filter(isV6);

  return [
    // Egress from own prefixes (3.27): on the gateway, the policy's sources (local or from other nodes over their
    // links) leave with the egress address instead of the node's.
    ...(config.egress?.snat ?? []).map((s) => {
      const family = isV6(s.address) ? 'ip6' : 'ip';

      return `    ${family} saddr { ${s.sources.join(', ')} } oifname != ${managed} counter snat ${family} to ${s.address} comment "builtin:egress-snat"`;
    }),
    // Remote clients leaving the cluster through the active gateway (full tunnel, external destinations, 3.31).
    ...(config.remoteAccess?.active && config.remoteAccess.prefixes.length
      ? [
          `    ip saddr { ${config.remoteAccess.prefixes.filter((p) => !isV6(p)).join(', ')} } oifname != ${managed} counter masquerade comment "builtin:vpn-egress"`,
        ]
      : []),
    ...(v4.length
      ? [`    ip saddr { ${v4.join(', ')} } oifname != ${managed} counter masquerade comment "builtin:egress"`]
      : []),
    ...(v6.length
      ? [`    ip6 saddr { ${v6.join(', ')} } oifname != ${managed} counter masquerade comment "builtin:egress"`]
      : []),
  ];
}

/**
 * Workloads only send with addresses of this node's pod subnets (IPv6 neighbour discovery uses link-local ones):
 * anything else from the bridge is forged.
 */
function renderPodAntiSpoofing(config: NodeNetworkConfig): string[] {
  const subnets = podNetworkSpec(config).subnets;
  const v4 = subnets.filter((s) => !isV6(s));
  const v6 = subnets.filter(isV6);

  return [
    ...(v4.length
      ? [
          `    iifname "lwbr0" meta nfproto ipv4 ip saddr != { ${v4.join(', ')} } counter drop comment "builtin:anti-spoofing"`,
        ]
      : []),
    ...(v6.length
      ? [
          `    iifname "lwbr0" meta nfproto ipv6 ip6 saddr != { ${[...v6, 'fe80::/10', '::/128'].join(', ')} } counter drop comment "builtin:anti-spoofing"`,
        ]
      : []),
  ];
}

/**
 * Renders one nftables script that atomically replaces the Loadweaver table: stateful allow rules from the
 * compiled policies, `observe` rules for monitor mode, and a logged default deny for managed interfaces.
 */
export function renderNftables(config: NodeNetworkConfig): string {
  const sets: string[] = [];
  const available = new Set<string>();

  for (const [name, members] of Object.entries(config.firewall.sets).sort(([a], [b]) => a.localeCompare(b))) {
    for (const family of [4, 6] as const) {
      const ofFamily = members.filter((m) => isV6(m) === (family === 6));

      if (ofFamily.length === 0) continue;

      sets.push(renderSet(name, family, ofFamily));
      available.add(`${name}_${family}`);
    }
  }

  const rulesFor = (chain: FirewallRule['chain']) =>
    config.firewall.rules
      .filter((r) => r.chain === chain)
      .flatMap((r) => [renderRule(r, 4, available), renderRule(r, 6, available)])
      .filter((line): line is string => line !== null);

  const managed = `{ ${MANAGED_INTERFACES.map((i) => `"${i}"`).join(', ')} }`;
  const deny = (match: string) =>
    `    ${match} limit rate 10/second log prefix "lwdeny " counter drop\n    ${match} counter drop`;
  const nat = renderServiceNat(config);
  const mesh = [...renderMeshRedirects(config), ...renderEgressRedirects(config)];
  const egress = renderEgressNat(config, managed);

  return [
    `table inet ${NFT_TABLE}`,
    `delete table inet ${NFT_TABLE}`,
    `table inet ${NFT_TABLE} {`,
    ...sets,
    '  chain input {',
    '    type filter hook input priority filter; policy accept;',
    // Before anything else: the node proxy decides identities by source address (3.7).
    ...renderPodAntiSpoofing(config),
    '    ct state established,related accept',
    `    iifname ${managed} ct state invalid drop`,
    // Workloads always reach the node-local, policy-aware resolver (3.4); it filters answers itself.
    '    iifname "lwbr0" meta l4proto { tcp, udp } th dport 53 accept comment "builtin:dns"',
    ...rulesFor('input'),
    deny(`iifname ${managed}`),
    '  }',
    '  chain forward {',
    '    type filter hook forward priority filter; policy accept;',
    ...renderPodAntiSpoofing(config),
    '    ct state established,related accept',
    ...renderEgressDenials(config),
    ...rulesFor('forward'),
    deny(`iifname ${managed}`),
    deny(`oifname ${managed}`),
    '  }',
    '  chain output {',
    '    type filter hook output priority filter; policy accept;',
    '    ct state established,related accept',
    ...rulesFor('output'),
    deny(`oifname ${managed}`),
    '  }',
    ...(nat.length > 0 || mesh.length > 0
      ? [
          '  chain services_prerouting {',
          '    type nat hook prerouting priority dstnat; policy accept;',
          // Meshed service ports go to the node proxy first (before the service DNAT would pick a replica).
          ...mesh,
          ...nat,
          '  }',
          '  chain services_output {',
          '    type nat hook output priority dstnat; policy accept;',
          ...nat,
          '  }',
        ]
      : []),
    ...(egress.length > 0
      ? [
          '  chain egress_postrouting {',
          '    type nat hook postrouting priority srcnat; policy accept;',
          ...egress,
          '  }',
        ]
      : []),
    '}',
    '',
  ].join('\n');
}
