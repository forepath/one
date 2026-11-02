import type { NodeNetworkConfig } from '@forepath/loadweaver/shared/util-agent-protocol';
import { cidrAddress, formatIp, mustParseCidr } from '@forepath/loadweaver/shared/util-network';
import { MICROVM_TAP_GATEWAY_V4, MICROVM_TAP_GATEWAY_V6 } from '@forepath/shared/backend/util-microvm-bridge';
import { Inject, Injectable, Optional } from '@nestjs/common';
import type Docker from 'dockerode';

import { CommandRunner } from '../host/command-runner';
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
 * Commands that give the pod bridge the uniform link-local gateways of microVM / VM guests (3.35): guests address
 * themselves `<v4>/32 via 169.254.1.1 onlink` and `<v6>/128 via fe80::1`, so the bridge must own both (the kept
 * veths already do). ICMP redirects are off: guest-to-container traffic on the node hairpins through the bridge.
 */
export function podGatewayCommands(
  current: readonly { ifname?: string; addr_info?: { local?: string }[] }[],
  ipv6: boolean,
  bridge: string = POD_BRIDGE,
): string[][] {
  const has = (address: string) =>
    current.some((l) => l.ifname === bridge && (l.addr_info ?? []).some((a) => a.local === address));

  return [
    ...(has(MICROVM_TAP_GATEWAY_V4) ? [] : [['ip', 'addr', 'add', `${MICROVM_TAP_GATEWAY_V4}/32`, 'dev', bridge]]),
    ...(ipv6 && !has(MICROVM_TAP_GATEWAY_V6)
      ? [['ip', '-6', 'addr', 'add', `${MICROVM_TAP_GATEWAY_V6}/64`, 'dev', bridge, 'nodad']]
      : []),
    ['sysctl', '-q', '-w', `net.ipv4.conf.${bridge}.send_redirects=0`],
  ];
}

/**
 * Ensures the Docker network workloads attach to: a bridge on the node's own pod subnets, routed (no NAT),
 * so container addresses are reachable over the overlay exactly as the policies allow (3.4).
 */
@Injectable()
export class PodNetworkManager {
  constructor(
    @Inject(DOCKER) private readonly docker: Docker,
    @Optional() private readonly commands?: CommandRunner,
  ) {}

  /** The link-local guest gateways on the bridge (idempotent; Docker doesn't manage extra bridge addresses). */
  private async ensureGuestGateways(spec: PodNetworkSpec): Promise<boolean> {
    if (!this.commands || spec.subnets.length === 0) return false;

    const current = await this.commands
      .json<{ ifname?: string; addr_info?: { local?: string }[] }[]>('ip', ['-j', 'addr', 'show', 'dev', POD_BRIDGE])
      .catch(() => null);

    // No bridge yet (Docker creates it with the first endpoint on some versions): next apply.
    if (!current) return false;

    const commands = podGatewayCommands(
      current ?? [],
      spec.subnets.some((s) => s.includes(':')),
    );

    for (const [command, ...args] of commands) await this.commands.run(command, args);

    return commands.length > 1;
  }

  async apply(config: NodeNetworkConfig): Promise<{ changed: boolean; spec: PodNetworkSpec }> {
    const spec = podNetworkSpec(config);
    const existing = (await this.docker.listNetworks({ filters: { name: [POD_NETWORK] } })).find(
      (n) => n.Name === POD_NETWORK,
    );
    const current = (existing?.IPAM?.Config ?? [])
      .map((c) => c.Subnet)
      .filter((s): s is string => !!s)
      .sort();

    if (existing && current.join(',') === [...spec.subnets].sort().join(','))
      return { changed: await this.ensureGuestGateways(spec), spec };

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
    await this.ensureGuestGateways(spec);

    return { changed: true, spec };
  }
}
