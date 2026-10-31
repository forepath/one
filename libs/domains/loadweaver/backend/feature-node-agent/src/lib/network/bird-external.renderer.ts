import type { ExternalBgp } from '@forepath/loadweaver/shared/util-agent-protocol';

/** Never accepted from outside (RFC 6890 / Team Cymru style), plus anything too specific to route globally. */
const BOGONS4 = [
  '0.0.0.0/8+',
  '10.0.0.0/8+',
  '100.64.0.0/10+',
  '127.0.0.0/8+',
  '169.254.0.0/16+',
  '172.16.0.0/12+',
  '192.0.0.0/24+',
  '192.0.2.0/24+',
  '192.168.0.0/16+',
  '198.18.0.0/15+',
  '198.51.100.0/24+',
  '203.0.113.0/24+',
  '224.0.0.0/4+',
  '240.0.0.0/4+',
  '0.0.0.0/0{25,32}',
];
const BOGONS6 = [
  '::/8+',
  '0100::/64+',
  '2001:2::/48+',
  '2001:10::/28+',
  '2001:db8::/32+',
  '3ffe::/16+',
  'fc00::/7+',
  'fe80::/10+',
  'fec0::/10+',
  'ff00::/8+',
  '::/0{49,128}',
];
const GRACEFUL_SHUTDOWN = '(65535,0)';

function family(prefix: string): 4 | 6 {
  return prefix.includes(':') ? 6 : 4;
}

function symbol(value: string): string {
  return value.replace(/[^A-Za-z0-9_]/g, '_');
}

function community(value: string): string {
  const [a, b] = value.split(':');

  return `(${a},${b})`;
}

/**
 * External BGP (3.27) as BIRD 2 configuration, added to the node's iBGP config: own prefixes from a static protocol
 * (never installed into the kernel), one eBGP session per peer with strict import filters (bogons, own prefixes,
 * RPKI-invalid when validators are configured, max-prefix) and exports of exactly the announcements for that peer.
 */
export function renderExternalBgp(ext: ExternalBgp): string {
  const lines: string[] = [];
  const announced = (fam: 4 | 6) => [
    ...new Set(ext.announcements.filter((a) => family(a.prefix) === fam).map((a) => a.prefix)),
  ];
  const rpki = ext.rtrServers.length > 0;

  lines.push(`define LW_BOGONS4 = [ ${BOGONS4.join(', ')} ];`, `define LW_BOGONS6 = [ ${BOGONS6.join(', ')} ];`, '');

  for (const fam of [4, 6] as const) {
    const routes = announced(fam).map((p) => `  route ${p} blackhole;`);

    lines.push(`protocol static lw_announce${fam} {\n  ipv${fam};\n${routes.join('\n')}\n}`);
  }

  if (rpki) {
    lines.push('roa4 table lw_roa4;', 'roa6 table lw_roa6;');
    ext.rtrServers.forEach((s, i) =>
      lines.push(
        `protocol rpki lw_rpki_${i} {\n  roa4 { table lw_roa4; };\n  roa6 { table lw_roa6; };\n  remote ${s.address} port ${s.port};\n  retry keep 90;\n  refresh keep 900;\n  expire keep 172800;\n}`,
      ),
    );
  }

  if (ext.peers.some((p) => p.bfd)) lines.push('protocol bfd lw_bfd {\n}');

  for (const peer of ext.peers) {
    const fam = family(peer.address);
    const name = symbol(`lw_ext_${peer.name}`);
    const own = announced(fam);
    const mine = ext.announcements.filter((a) => family(a.prefix) === fam && a.peers.includes(peer.name));
    const accept =
      peer.import === 'none'
        ? '  reject;'
        : peer.import === 'default'
          ? `  if net = ${fam === 4 ? '0.0.0.0/0' : '::/0'} then {${peer.localPref !== undefined ? ` bgp_local_pref = ${peer.localPref};` : ''} accept; }\n  reject;`
          : [
              ...(rpki
                ? [`  if roa_check(lw_roa${fam}, net, bgp_path.last_nonaggregated) = ROA_INVALID then reject;`]
                : []),
              ...(peer.localPref !== undefined ? [`  bgp_local_pref = ${peer.localPref};`] : []),
              '  accept;',
            ].join('\n');

    lines.push(
      [
        `filter ${name}_in {`,
        `  if net ~ LW_BOGONS${fam} then reject;`,
        ...(own.length ? [`  if net ~ [ ${own.map((p) => `${p}+`).join(', ')} ] then reject;`] : []),
        accept,
        '}',
      ].join('\n'),
      [
        `filter ${name}_out {`,
        `  if proto != "lw_announce${fam}" then reject;`,
        ...mine.map((a) =>
          [
            `  if net = ${a.prefix} then {`,
            ...Array.from({ length: a.prepend }, () => `    bgp_path.prepend(${ext.asn});`),
            ...a.communities.map((c) => `    bgp_community.add(${community(c)});`),
            ...(a.med !== undefined ? [`    bgp_med = ${a.med};`] : []),
            ...(ext.gracefulShutdown ? [`    bgp_community.add(${GRACEFUL_SHUTDOWN});`] : []),
            '    accept;',
            '  }',
          ].join('\n'),
        ),
        '  reject;',
        '}',
      ].join('\n'),
      [
        `protocol bgp ${name} {`,
        `  description "${peer.name} AS${peer.asn}";`,
        `  local as ${ext.asn};`,
        `  neighbor ${peer.address} as ${peer.asn};`,
        ...(peer.multihop ? [`  multihop ${peer.multihop};`] : []),
        ...(peer.password ? [`  password "${peer.password}";`] : []),
        ...(peer.bfd ? ['  bfd on;'] : []),
        '  graceful restart on;',
        `  ipv${fam} {`,
        `    import filter ${name}_in;`,
        `    export filter ${name}_out;`,
        `    import limit ${peer.maxPrefixes} action restart;`,
        '    next hop self;',
        '  };',
        '}',
      ].join('\n'),
      '',
    );
  }

  return lines.join('\n');
}
