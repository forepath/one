import type { ClusterNetwork } from '@forepath/loadweaver/shared/util-model';
import {
  allocateAddress,
  allocateSubnet,
  formatCidr,
  formatIp,
  mustParseCidr,
  mustParseIp,
  parseCidr,
} from '@forepath/loadweaver/shared/util-network';

export interface NodeAddressing {
  overlayV4: string | null;
  overlayV6: string | null;
  podSubnetV4: string | null;
  podSubnetV6: string | null;
}

/**
 * Allocates a node's overlay addresses and container subnets from the cluster pools (3.4, 3.23).
 * Deterministic: the lowest free slot, so plans are reproducible. Throws when a pool is exhausted.
 */
export function allocateNodeAddressing(network: ClusterNetwork, existing: readonly NodeAddressing[]): NodeAddressing {
  const used = <K extends keyof NodeAddressing>(key: K) => existing.map((e) => e[key]).filter((v): v is string => !!v);

  const subnet = (pool: string | undefined, prefix: number, key: 'podSubnetV4' | 'podSubnetV6'): string | null => {
    if (!pool) return null;

    const taken = used(key)
      .map((s) => parseCidr(s))
      .filter((c): c is NonNullable<typeof c> => !!c);
    const result = allocateSubnet(mustParseCidr(pool), prefix, taken);

    if (!result) throw new Error(`pod pool ${pool} is exhausted`);

    return formatCidr(result);
  };

  const address = (pool: string | undefined, key: 'overlayV4' | 'overlayV6'): string | null => {
    if (!pool) return null;

    // Offset 0 is the network address; keep it free.
    const result = allocateAddress(mustParseCidr(pool), used(key).map(mustParseIp), BigInt(1));

    if (!result) throw new Error(`overlay pool ${pool} is exhausted`);

    return formatIp(result);
  };

  return {
    overlayV4: address(network.overlayPoolV4, 'overlayV4'),
    overlayV6: address(network.overlayPoolV6, 'overlayV6'),
    podSubnetV4: subnet(network.podPoolV4, network.nodePrefixV4, 'podSubnetV4'),
    podSubnetV6: subnet(network.podPoolV6, network.nodePrefixV6, 'podSubnetV6'),
  };
}

/** Default dual-stack pools for a new cluster; the IPv6 ULA /48 uses a random global id (RFC 4193). */
export function defaultClusterNetwork(randomBytes: (n: number) => Uint8Array): Record<string, string> {
  const g = randomBytes(5);
  const hex = (a: number, b: number) => ((a << 8) | b).toString(16);
  const ula = `fd${g[0].toString(16).padStart(2, '0')}:${hex(g[1], g[2])}:${hex(g[3], g[4])}`;

  return {
    podPoolV4: '10.88.0.0/14',
    servicePoolV4: '10.92.0.0/16',
    overlayPoolV4: '10.93.0.0/16',
    podPoolV6: `${ula}::/56`,
    servicePoolV6: `${ula}:100::/112`,
    overlayPoolV6: `${ula}:200::/112`,
  };
}
