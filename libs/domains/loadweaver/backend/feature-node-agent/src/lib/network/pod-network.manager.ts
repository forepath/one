import type { NodeNetworkConfig } from '@forepath/loadweaver/shared/util-agent-protocol';
import { cidrAddress, formatIp, mustParseCidr } from '@forepath/loadweaver/shared/util-network';
import { Inject, Injectable } from '@nestjs/common';
import type Docker from 'dockerode';

import { DOCKER } from '../host/docker.provider';

export const POD_NETWORK = 'loadweaver';
export const POD_BRIDGE = 'lwbr0';
const MANAGED_LABEL = 'loadweaver.com/managed';

export interface PodNetworkSpec {
  subnets: string[];
  gateways: string[];
}

/** The node's pod subnets come from its originated prefixes (`/24`, `/80` style, not host routes). */
export function podNetworkSpec(config: NodeNetworkConfig): PodNetworkSpec {
  const subnets = config.bgp.originate.filter((p) => {
    const [, len] = p.split('/');

    return p.includes(':') ? Number(len) < 128 : Number(len) < 32;
  });

  return { subnets, gateways: subnets.map((s) => formatIp(cidrAddress(mustParseCidr(s), BigInt(1)))) };
}

/**
 * Ensures the Docker network workloads attach to: a bridge on the node's own pod subnets, routed (no NAT),
 * so container addresses are reachable over the overlay exactly as the policies allow (3.4).
 */
@Injectable()
export class PodNetworkManager {
  constructor(@Inject(DOCKER) private readonly docker: Docker) {}

  async apply(config: NodeNetworkConfig): Promise<{ changed: boolean; spec: PodNetworkSpec }> {
    const spec = podNetworkSpec(config);
    const existing = (await this.docker.listNetworks({ filters: { name: [POD_NETWORK] } })).find(
      (n) => n.Name === POD_NETWORK,
    );
    const current = (existing?.IPAM?.Config ?? [])
      .map((c) => c.Subnet)
      .filter((s): s is string => !!s)
      .sort();

    if (existing && current.join(',') === [...spec.subnets].sort().join(',')) return { changed: false, spec };

    if (existing) {
      const inspect = await this.docker.getNetwork(existing.Id).inspect();

      if (Object.keys(inspect.Containers ?? {}).length > 0) {
        throw new Error(`pod network ${POD_NETWORK} has attached containers; its subnets cannot change in place`);
      }

      await this.docker.getNetwork(existing.Id).remove();
    }

    if (spec.subnets.length === 0) return { changed: !!existing, spec };

    await this.docker.createNetwork({
      Name: POD_NETWORK,
      Driver: 'bridge',
      EnableIPv6: spec.subnets.some((s) => s.includes(':')),
      IPAM: {
        Driver: 'default',
        Config: spec.subnets.map((subnet, i) => ({ Subnet: subnet, Gateway: spec.gateways[i] })),
      },
      Options: {
        'com.docker.network.bridge.name': POD_BRIDGE,
        'com.docker.network.bridge.gateway_mode_ipv4': 'routed',
        'com.docker.network.bridge.gateway_mode_ipv6': 'routed',
        'com.docker.network.bridge.enable_ip_masquerade': 'false',
      },
      Labels: { [MANAGED_LABEL]: 'true' },
    });

    return { changed: true, spec };
  }
}
