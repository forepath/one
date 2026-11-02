import type { VolumeAssignment } from '@forepath/loadweaver/shared/util-agent-protocol';

export function drbdResourceName(volume: Pick<VolumeAssignment, 'minor'>): string {
  return `lw-${volume.minor}`;
}

export function cryptName(volume: Pick<VolumeAssignment, 'minor'>): string {
  return `lw-${volume.minor}-crypt`;
}

function address(ip: string, port: number): string {
  return ip.includes(':') ? `ipv6 [${ip}]:${port}` : `ipv4 ${ip}:${port}`;
}

/**
 * Name DRBD knows a replica's host by: its kernel node name (`uname -n`, reported in the agent's hello), which DRBD
 * matches its `on` sections against. Control planes / agents without the `drbd-hostnames` feature send none; then
 * the node name is used and has to equal the host name.
 */
export function drbdHost(replica: VolumeAssignment['replicas'][number]): string {
  return replica.host ?? replica.node;
}

/**
 * DRBD 9 resource for one volume (3.5): replicated block device on top of the LUKS mapping (3.22: encrypted at
 * rest), protocol C between replicas in the same site and A across sites. With three or more replicas DRBD's own
 * quorum prevents split brain; promotion is always decided by the control plane (no auto-promote). `verify-alg`
 * enables online verification (`drbdadm verify`).
 */
export function renderDrbdResource(volume: VolumeAssignment): string {
  const name = drbdResourceName(volume);
  const quorum =
    volume.replicas.length >= 3 ? ['    quorum majority;', '    on-no-quorum suspend-io;'] : ['    quorum off;'];
  const hosts = new Map(volume.replicas.map((r) => [r.node, drbdHost(r)]));
  const host = (node: string) => hosts.get(node) ?? node;

  return [
    '# Managed by Loadweaver. Changes are overwritten on the next apply.',
    `resource "${name}" {`,
    `  device minor ${volume.minor};`,
    `  disk "/dev/mapper/${cryptName(volume)}";`,
    '  meta-disk internal;',
    '  options {',
    '    auto-promote no;',
    ...quorum,
    '  }',
    '  net {',
    '    verify-alg sha256;',
    '  }',
    ...volume.replicas.map(
      (r) => `  on "${drbdHost(r)}" { node-id ${r.nodeId}; address ${address(r.address, volume.port)}; }`,
    ),
    ...volume.connections.map(
      (c) => `  connection { host "${host(c.a)}"; host "${host(c.b)}"; net { protocol ${c.protocol}; } }`,
    ),
    '}',
    '',
  ].join('\n');
}

/** Node ids of the `on` sections of a rendered resource file (host → node id), to find peers that were removed. */
export function renderedNodeIds(conf: string): Map<number, string> {
  const ids = new Map<number, string>();

  for (const match of conf.matchAll(/^\s*on "([^"]+)" \{ node-id (\d+);/gm)) ids.set(Number(match[2]), match[1]);

  return ids;
}
