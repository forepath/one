import type { ExternalBgp, NodeNetworkConfig } from '@forepath/loadweaver/shared/util-agent-protocol';

import { renderExternalBgp } from './bird-external.renderer';

type Session = NodeNetworkConfig['bgp']['sessions'][number];

function family(address: string): 4 | 6 {
  return address.includes(':') ? 6 : 4;
}

function hostPrefix(address: string): string {
  return address.includes('/') ? address : `${address}/${family(address) === 6 ? 128 : 32}`;
}

/** BIRD symbol names allow letters, digits and underscores. */
function symbol(value: string): string {
  return value.replace(/[^A-Za-z0-9_]/g, '_');
}

function prefixFilter(name: string, prefixes: string[]): string {
  if (prefixes.length === 0) return `filter ${name} { reject; }`;

  return `filter ${name} {\n  if net ~ [ ${prefixes.join(', ')} ] then accept;\n  reject;\n}`;
}

function ofFamily(prefixes: string[], fam: 4 | 6): string[] {
  return prefixes.filter((p) => family(p) === fam);
}

function sessionBlocks(config: NodeNetworkConfig, session: Session): string[] {
  const blocks: string[] = [];
  const own = config.addresses;

  for (const fam of [4, 6] as const) {
    const local = own.find((a) => family(a) === fam);
    const neighbor = session.peerAddresses.find((a) => family(a) === fam);

    if (!local || !neighbor) continue;

    const name = symbol(`lw_${session.peer}_${fam}`);
    const channel = fam === 4 ? 'ipv4' : 'ipv6';
    const importName = `${name}_import`;
    const exportName = `${name}_export`;

    blocks.push(prefixFilter(importName, ofFamily(session.imports, fam)));
    blocks.push(prefixFilter(exportName, ofFamily(session.exports, fam)));
    blocks.push(
      [
        `protocol bgp ${name} {`,
        `  description "${session.peer} (${session.role})";`,
        `  local ${local} as ${config.bgp.asn};`,
        `  neighbor ${neighbor} as ${config.bgp.asn};`,
        // Overlay addresses are /32 and /128 host addresses; the neighbor is reached through the link's device
        // route (lw_links), so the session is multihop iBGP rather than "directly connected".
        '  multihop;',
        '  hold time 9;',
        '  keepalive time 3;',
        '  graceful restart on;',
        ...(session.role === 'route-reflector-client' ? ['  rr client;'] : []),
        `  ${channel} {`,
        `    import filter ${importName};`,
        `    export filter ${exportName};`,
        // Reflected routes keep the originator as next hop: traffic never flows through a reflector (3.3).
        '    gateway recursive;',
        '  };',
        '}',
      ].join('\n'),
    );
  }

  return blocks;
}

/**
 * Renders the complete BIRD 2 configuration of a node (3.4): iBGP over the WireGuard links, exact prefix
 * filters generated from policies (nothing is transitive), originated pod subnets and overlay addresses,
 * device routes to link peers (the IGP for recursive next hops), and kernel export of only what BIRD learned.
 */
export function renderBird(config: NodeNetworkConfig, external?: ExternalBgp): string {
  const lines: string[] = [
    '# Managed by Loadweaver. Changes are overwritten on the next apply.',
    'log syslog all;',
    `router id ${config.bgp.routerId};`,
    '',
    'protocol device { scan time 10; }',
    '',
  ];

  for (const fam of [4, 6] as const) {
    const channel = fam === 4 ? 'ipv4' : 'ipv6';
    const peerRoutes = config.wireguard.flatMap((link) =>
      link.peerAddresses
        .filter((a) => family(a) === fam)
        .map((a) => `  route ${hostPrefix(a)} via "${link.interface}";`),
    );
    const originate = ofFamily(config.bgp.originate, fam).map((p) => `  route ${p} blackhole;`);

    lines.push(`protocol static lw_links${fam} {\n  ${channel};\n${peerRoutes.join('\n')}\n}`);
    lines.push(`protocol static lw_originate${fam} {\n  ${channel};\n${originate.join('\n')}\n}`);
    lines.push(
      [
        `protocol kernel lw_kernel${fam} {`,
        `  ${channel} {`,
        '    import none;',
        `    export filter { if proto = "lw_links${fam}" then accept; if source = RTS_BGP then accept; reject; };`,
        '  };',
        '  merge paths on;',
        '}',
      ].join('\n'),
    );
    lines.push('');
  }

  for (const session of config.bgp.sessions) {
    lines.push(...sessionBlocks(config, session), '');
  }

  if (external) lines.push(renderExternalBgp(external), '');

  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}
