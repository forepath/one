import { cidrAddress, formatIp, mustParseCidr } from '@forepath/loadweaver/shared/util-network';

import { uniqueSorted } from './hash';
import { clientAddresses, policyKey } from './resolve';
import type {
  ClientConfig,
  CompilerDiagnostic,
  CompilerInput,
  FirewallRule,
  Flow,
  NodeNetworkConfig,
  RemoteAccessConfig,
} from './types';

/** The gateways' WireGuard interface for clients; outside the `lw-<hash>` link names. */
export const VPN_INTERFACE = 'lw-vpn';
const FULL_TUNNEL = ['0.0.0.0/0', '::/0'];

/** The gateway's address in the client network: its first host, with the network's prefix length. */
export function vpnGatewayAddress(clientNetwork: string): string {
  const cidr = mustParseCidr(clientNetwork);

  return `${formatIp(cidrAddress(cidr, BigInt(1)))}/${cidr.prefixLength}`;
}

/** All client prefixes the active gateway routes into the tunnel: the client network and the office subnets. */
export function clientPrefixes(input: CompilerInput): string[] {
  const access = input.remoteAccess;

  return access ? uniqueSorted([access.clientNetwork, ...access.clients.flatMap((c) => c.subnets)]) : [];
}

const hostPrefix = (address: string) =>
  address.includes('/') ? address : `${address}/${address.includes(':') ? 128 : 32}`;

/**
 * Remote access gateways (3.31): every gateway gets `lw-vpn` with all valid clients as peers (AllowedIPs = their
 * address and office subnets), the active one routes and filters their traffic. Clients get exactly the routes their
 * policies allow (or everything with a full tunnel) and their DNS view.
 */
export function compileRemoteAccess(
  input: CompilerInput,
  flows: readonly Flow[],
  result: Record<string, NodeNetworkConfig>,
  names: ReadonlyMap<string, { names: string[]; serviceIps: string[] }>,
  rule: (node: string, rule: Omit<FirewallRule, 'id' | 'srcSet' | 'dstSet'>, src: string[], dst: string[]) => void,
  diagnostics: CompilerDiagnostic[],
): Record<string, ClientConfig> {
  const access = input.remoteAccess;
  const clients: Record<string, ClientConfig> = {};

  if (!access) return clients;

  for (const policy of input.policies) {
    if (policy.spec.action === 'deny' && policy.spec.from.some((p) => 'clients' in p))
      diagnostics.push({
        level: 'warning',
        policy: policyKey(policy),
        message: 'L7 denies are not enforced for remote clients; only allow policies decide what they reach',
      });
  }

  // Hostname destinations are decided by the gateway's proxy, which only sees what the client sends into the tunnel.
  for (const policy of input.policies) {
    if (!policy.spec.to.some((p) => 'host' in p) || policy.spec.action !== 'allow') continue;

    const groups = policy.spec.from.flatMap((p) => ('clients' in p ? [p.clients] : []));

    if (access.clients.some((c) => !c.fullTunnel && c.groups.some((g) => groups.includes(g))))
      diagnostics.push({
        level: 'warning',
        policy: policyKey(policy),
        message: 'hostname destinations only reach remote clients with fullTunnel (split tunnels route by address)',
      });
  }

  const address = vpnGatewayAddress(access.clientNetwork);
  const dns = address.split('/')[0];
  const prefixes = clientPrefixes(input);
  const peers = [...access.clients]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((c) => ({ id: c.id, label: c.label, publicKey: c.publicKey, allowedIps: clientAddresses(c).map(hostPrefix) }));

  for (const gateway of access.gateways) {
    const config = result[gateway];

    if (!config) continue;

    const active = gateway === access.active;

    config.remoteAccess = {
      active,
      listenPort: access.port,
      address,
      peers,
      prefixes: active ? prefixes : [],
    } satisfies RemoteAccessConfig;

    // Clients reach the policy-aware resolver on the gateway (split DNS); it answers per client address.
    if (active && access.clients.length > 0) {
      const sources = access.clients.flatMap(clientAddresses);

      for (const protocol of ['udp', 'tcp'] as const)
        rule(
          gateway,
          { policy: 'builtin:vpn-dns', chain: 'input', protocol, ports: ['53'], action: 'accept' },
          sources,
          [dns],
        );
    }
  }

  for (const client of access.clients) {
    const own = new Set(clientAddresses(client));
    const routes = new Set<string>([hostPrefix(dns)]);

    for (const flow of flows) {
      // Where the client may connect to, and who may connect to it (answers must pass the client's AllowedIPs).
      if (flow.srcKind === 'client' && flow.src.some((a) => own.has(a))) flow.dst.forEach((d) => routes.add(d));

      if (flow.dstKind === 'client' && flow.dst.some((a) => own.has(a))) flow.src.forEach((s) => routes.add(s));
    }

    const view = names.get(client.address);

    view?.serviceIps.forEach((ip) => routes.add(ip));

    clients[client.id] = {
      address: hostPrefix(client.address),
      dns,
      routes: client.fullTunnel
        ? FULL_TUNNEL
        : uniqueSorted([...routes].filter((r) => !r.includes(':')).map(hostPrefix)),
      names: view?.names ?? [],
    };
  }

  return clients;
}
