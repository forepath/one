import type { PublicAddress } from '@forepath/loadweaver/shared/util-agent-protocol';

export interface VrrpInstance {
  address: string;
  dev: string;
  vrid: number;
  priority: number;
}

/**
 * keepalived configuration for the node's VRRP addresses (3.6): one instance per address, all BACKUP with
 * `nopreempt`, so the address stays where it is until its holder fails (no flapping when a node comes back).
 * The preferred holder starts with the highest priority. Values are validated by the protocol schema.
 */
export function renderKeepalived(nodeName: string, instances: readonly VrrpInstance[]): string {
  const lines = [
    '# Managed by the Loadweaver node agent. Changes are overwritten.',
    'global_defs {',
    `  router_id lw-${nodeName}`,
    '  enable_script_security',
    '}',
    '',
  ];

  for (const i of [...instances].sort((a, b) => a.vrid - b.vrid)) {
    const v6 = i.address.includes(':');

    lines.push(
      `vrrp_instance lw_${i.vrid} {`,
      '  state BACKUP',
      '  nopreempt',
      `  interface ${i.dev}`,
      `  virtual_router_id ${i.vrid}`,
      `  priority ${i.priority}`,
      '  advert_int 1',
      ...(v6 ? ['  native_ipv6'] : []),
      '  virtual_ipaddress {',
      `    ${i.address}/${v6 ? 128 : 32} dev ${i.dev}`,
      '  }',
      '}',
      '',
    );
  }

  return lines.join('\n');
}

export function vrrpInstances(
  addresses: readonly PublicAddress[],
  uplink: (address: PublicAddress) => string,
): VrrpInstance[] {
  return addresses
    .filter((a) => a.mode === 'vrrp' && a.vrrp)
    .map((a) => ({ address: a.address, dev: uplink(a), vrid: a.vrrp?.vrid ?? 1, priority: a.vrrp?.priority ?? 100 }));
}
