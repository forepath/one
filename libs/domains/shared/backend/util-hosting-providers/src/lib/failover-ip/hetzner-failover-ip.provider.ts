import { BlockList, isIP } from 'node:net';

import axios from 'axios';

import type { FailoverIpProvider, FailoverIpProviderFactory, ServerRef } from './failover-ip-provider.types';

const API = 'https://api.hetzner.cloud/v1';

function contains(network: string, address: string): boolean {
  const [prefix, length] = network.split('/');
  const family = isIP(prefix) === 6 ? 'ipv6' : 'ipv4';

  if (!length || isIP(address) !== isIP(prefix)) return false;

  const list = new BlockList();

  list.addSubnet(prefix, Number(length), family);

  return list.check(address, family);
}

export interface HetznerFailoverIpConfig {
  apiToken: string;
}

/** Hetzner Cloud floating IPs. */
export class HetznerFailoverIpProvider implements FailoverIpProvider {
  readonly id = 'hetzner';

  constructor(private readonly config: HetznerFailoverIpConfig) {
    if (!config.apiToken) throw new Error('Hetzner needs an API token');
  }

  private get headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.config.apiToken}`, 'Content-Type': 'application/json' };
  }

  private async floatingIp(address: string): Promise<{ id: number; server: number | null }> {
    for (let page = 1; ; page++) {
      const res = await axios.get<{
        floating_ips: { id: number; ip: string; server: number | null }[];
        meta?: { pagination?: { next_page: number | null } };
      }>(`${API}/floating_ips`, { headers: this.headers, params: { per_page: 50, page } });
      // IPv6 floating IPs are networks (`2001:db8::/64`); an address inside the network matches.
      const match = (res.data?.floating_ips ?? []).find((f) => f.ip === address || contains(f.ip, address));

      if (match) return { id: match.id, server: match.server };

      if (!res.data?.meta?.pagination?.next_page)
        throw new Error(`floating IP ${address} not found in this Hetzner project`);
    }
  }

  private async serverId(server: ServerRef): Promise<number> {
    if (server.id) return Number(server.id);

    const res = await axios.get<{ servers: { id: number; name: string }[] }>(`${API}/servers`, {
      headers: this.headers,
      params: { name: server.name },
    });
    const found = (res.data?.servers ?? []).find((s) => s.name === server.name);

    if (!found) throw new Error(`server ${server.name} not found in this Hetzner project`);

    return found.id;
  }

  async assign(address: string, server: ServerRef): Promise<void> {
    const [ip, target] = await Promise.all([this.floatingIp(address), this.serverId(server)]);

    if (ip.server === target) return;

    await axios.post(`${API}/floating_ips/${ip.id}/actions/assign`, { server: target }, { headers: this.headers });
  }

  async holder(address: string): Promise<string | null> {
    const ip = await this.floatingIp(address);

    return ip.server === null ? null : String(ip.server);
  }
}

export const hetznerFailoverIpProviderFactory: FailoverIpProviderFactory<HetznerFailoverIpConfig> = {
  id: 'hetzner',
  displayName: 'Hetzner Cloud',
  create: (config) => new HetznerFailoverIpProvider(config),
};
