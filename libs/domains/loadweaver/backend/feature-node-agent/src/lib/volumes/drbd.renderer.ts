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
 * DRBD 9 resource for one volume (3.5): replicated block device on top of the LUKS mapping (3.22: encrypted at
 * rest), protocol C between replicas in the same site and A across sites. With three or more replicas DRBD's own
 * quorum prevents split brain; promotion is always decided by the control plane (no auto-promote).
 */
export function renderDrbdResource(volume: VolumeAssignment): string {
  const name = drbdResourceName(volume);
  const quorum =
    volume.replicas.length >= 3 ? ['    quorum majority;', '    on-no-quorum suspend-io;'] : ['    quorum off;'];

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
    ...volume.replicas.map(
      (r) => `  on "${r.node}" { node-id ${r.nodeId}; address ${address(r.address, volume.port)}; }`,
    ),
    ...volume.connections.map((c) => `  connection { host "${c.a}"; host "${c.b}"; net { protocol ${c.protocol}; } }`),
    '}',
    '',
  ].join('\n');
}
