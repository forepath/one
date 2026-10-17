import {
  clientGroupSpecSchema,
  clusterSpecSchema,
  ipPoolSpecSchema,
  matchesSelector,
  nodeGroupSpecSchema,
  policySpecSchema,
  type ClientGroupSpec,
  type ClusterRemoteAccess,
} from '@forepath/loadweaver/shared/util-model';
import {
  allocateAddress,
  cidrContainsIp,
  cidrLast,
  cidrOverlaps,
  formatIp,
  mustParseCidr,
  mustParseIp,
  parseCidr,
  parseIp,
} from '@forepath/loadweaver/shared/util-network';
import {
  DEFAULT_PLATFORM_PORTS,
  type ClientConfig,
  type CompilerClient,
  type CompilerRemoteAccess,
} from '@forepath/loadweaver/shared/util-policy-compiler';

import type { PostureState, VpnClientEntity } from '../entities/vpn-client.entity';

/** Owner of the gateway address in public IPAM (3.27, 3.31). */
export const VPN_ADDRESS_OWNER = 'vpn/0';
/** Posture reports older than this count as missing (clients report at connect and periodically). */
export const POSTURE_MAX_AGE_MS = 24 * 3_600_000;
export const WIREGUARD_KEY = /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw480]=$/;
/** Amr values identity providers use for a second factor. */
const MFA_METHODS = ['mfa', 'otp', 'totp', 'hwk', 'swk', 'sms', 'webauthn', 'fido'];

export type NamedClientGroups = ReadonlyMap<string, ClientGroupSpec>;

export function clientGroups(
  resources: readonly { kind: string; name: string; spec: unknown }[],
): Map<string, ClientGroupSpec> {
  return new Map(
    resources.filter((r) => r.kind === 'ClientGroup').map((r) => [r.name, clientGroupSpecSchema.parse(r.spec)]),
  );
}

export function remoteAccessSettings(
  resources: readonly { kind: string; spec: unknown }[],
): ClusterRemoteAccess | undefined {
  const cluster = resources.find((r) => r.kind === 'Cluster');

  return cluster ? clusterSpecSchema.parse(cluster.spec).remoteAccess : undefined;
}

/** Client groups a user's identity-provider groups (roles) map to (3.31). */
export function groupsForRoles(roles: readonly string[], groups: NamedClientGroups): string[] {
  return [...groups]
    .filter(([, spec]) => spec.idpGroups.some((g) => roles.includes(g)))
    .map(([name]) => name)
    .sort();
}

export function hasMfa(amr: readonly string[] | undefined): boolean {
  return (amr ?? []).some((m) => MFA_METHODS.includes(m.toLowerCase()));
}

/** Key lifetime of a client: the shortest of its groups'. */
export function keyLifetimeMs(groupNames: readonly string[], groups: NamedClientGroups): number {
  const days = groupNames.map((g) => groups.get(g)?.keyLifetimeDays ?? 30);

  return (days.length > 0 ? Math.min(...days) : 30) * 86_400_000;
}

/** The next free client address: neither the network, the gateway (first host) nor the last address. */
export function allocateClientAddress(clientNetwork: string, used: readonly string[]): string | null {
  const cidr = mustParseCidr(clientNetwork);
  const taken = [...used.map((u) => mustParseIp(u)), { family: cidr.family, value: cidrLast(cidr) }];
  const address = allocateAddress(cidr, taken, BigInt(2));

  return address ? formatIp(address) : null;
}

/** `1.2.10` vs `1.2.9`: numeric per part, missing parts are 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.\-+]/).map((p) => parseInt(p, 10) || 0);
  const pb = b.split(/[.\-+]/).map((p) => parseInt(p, 10) || 0);

  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);

    if (diff !== 0) return Math.sign(diff);
  }

  return 0;
}

const VERDICT_RANK: Record<string, number> = { compliant: 0, 'low-risk': 1 };

/** Why a device fails a group's posture requirements (empty when it passes, 3.31). */
export function postureFailures(
  requirements: ClientGroupSpec['posture'],
  state: PostureState | null,
  now: number,
): string[] {
  if (!requirements) return [];

  const report = state?.report;

  if (!report || !state?.reportedAt) return ['no posture report from this device'];

  if (now - new Date(state.reportedAt).getTime() > POSTURE_MAX_AGE_MS) return ['posture report is older than 24 hours'];

  const reasons: string[] = [];

  if (requirements.diskEncryption && report.diskEncryption !== true) reasons.push('disk encryption is off');

  if (requirements.firewall && report.firewall !== true) reasons.push('the OS firewall is off');

  if (requirements.screenLock && report.screenLock !== true) reasons.push('no screen lock');

  const minOs = requirements.minOsVersion?.[report.platform];

  if (minOs && compareVersions(report.osVersion, minOs) < 0)
    reasons.push(`${report.platform} ${report.osVersion} is older than ${minOs}`);

  if (requirements.minAppVersion && compareVersions(report.appVersion ?? '0', requirements.minAppVersion) < 0)
    reasons.push(`app ${report.appVersion ?? 'unknown'} is older than ${requirements.minAppVersion}`);

  for (const plugin of requirements.plugins ?? []) {
    const verdict = state.plugins[plugin.type]?.verdict ?? 'unknown';

    if ((VERDICT_RANK[verdict] ?? 99) > VERDICT_RANK[plugin.require])
      reasons.push(
        `${plugin.type}: ${verdict}${state.plugins[plugin.type]?.detail ? ` (${state.plugins[plugin.type]?.detail})` : ''}`,
      );
  }

  return reasons;
}

/** Groups a device is in after posture: failing groups are replaced by their restricted group, or dropped (3.31). */
export function effectiveGroups(
  client: Pick<VpnClientEntity, 'groups' | 'posture'>,
  groups: NamedClientGroups,
  now: number,
): string[] {
  const result = new Set<string>();

  for (const name of client.groups) {
    const spec = groups.get(name);

    if (!spec) continue;

    if (postureFailures(spec.posture, client.posture, now).length === 0) result.add(name);
    else if (spec.restrictedGroup && groups.has(spec.restrictedGroup)) result.add(spec.restrictedGroup);
  }

  return [...result].sort();
}

export function clientValid(client: Pick<VpnClientEntity, 'revokedAt' | 'expiresAt'>, now: number): boolean {
  return !client.revokedAt && client.expiresAt.getTime() > now;
}

export function clientLabel(client: Pick<VpnClientEntity, 'ownerLabel' | 'name'>): string {
  return `${client.ownerLabel}/${client.name}`;
}

/**
 * The compiler's view of remote access: gateways (the node group's active members), the active one (holder of the
 * gateway address), and every valid client with its effective groups.
 */
export function remoteAccessInput(
  resources: readonly { kind: string; name: string; spec: unknown }[],
  nodes: readonly { name: string; site: string; labels: Record<string, string>; lifecycle: string }[],
  clients: readonly VpnClientEntity[],
  addressRows: readonly { owner: string | null; state: string; holder: string | null }[],
  now: number,
): CompilerRemoteAccess | undefined {
  const settings = remoteAccessSettings(resources);

  if (!settings) return undefined;

  const groups = clientGroups(resources);
  const nodeGroup = resources.find((r) => r.kind === 'NodeGroup' && r.name === settings.nodeGroup);
  const selector = nodeGroup ? nodeGroupSpecSchema.parse(nodeGroup.spec).selector : undefined;
  const gateways = selector
    ? nodes
        .filter(
          (n) =>
            n.lifecycle === 'active' &&
            matchesSelector(selector, {
              name: n.name,
              labels: { ...n.labels, 'loadweaver.com/site': n.site, 'loadweaver.com/node': n.name },
            }),
        )
        .map((n) => n.name)
        .sort()
    : [];
  const holder = addressRows.find((r) => r.owner === VPN_ADDRESS_OWNER && r.state === 'assigned')?.holder;

  return {
    gateways,
    active: holder && gateways.includes(holder) ? holder : undefined,
    clientNetwork: settings.clientNetwork,
    port: settings.port,
    groups: [...groups.keys()].sort(),
    clients: clients
      .filter((c) => clientValid(c, now))
      .map(
        (c): CompilerClient => ({
          id: c.id,
          label: clientLabel(c),
          publicKey: c.publicKey,
          address: c.address,
          subnets: c.subnets,
          groups: effectiveGroups(c, groups, now),
          fullTunnel: effectiveGroups(c, groups, now).some((g) => groups.get(g)?.fullTunnel),
        }),
      )
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}

/** Office subnets of a machine client: valid networks, overlapping neither cluster ranges nor other clients'. */
export function subnetIssues(
  subnets: readonly string[],
  reserved: readonly string[],
  others: readonly { name: string; subnets: string[] }[],
): string[] {
  const issues: string[] = [];
  const parsed = subnets.map((s) => ({ text: s, cidr: parseCidr(s) }));

  for (const { text, cidr } of parsed) {
    if (!cidr || cidr.family !== 4) {
      issues.push(`${text} is not an IPv4 network`);
      continue;
    }

    for (const range of reserved)
      if (cidrOverlaps(cidr, mustParseCidr(range))) issues.push(`${text} overlaps the cluster range ${range}`);

    for (const other of others)
      for (const theirs of other.subnets)
        if (cidrOverlaps(cidr, mustParseCidr(theirs))) issues.push(`${text} overlaps ${theirs} of ${other.name}`);

    for (const sibling of parsed)
      if (sibling.text !== text && sibling.cidr && cidrOverlaps(cidr, sibling.cidr))
        issues.push(`${text} overlaps ${sibling.text}`);
  }

  return [...new Set(issues)];
}

/** Plan checks for remote access (3.31): rejected setups that would otherwise fail silently or widen access. */
export function remoteAccessIssues(
  resources: readonly { kind: string; name: string; project?: string | null; spec: unknown }[],
  /** Addresses of the currently valid clients: they must stay inside the client network. */
  clientAddresses: readonly string[] = [],
): string[] {
  const issues: string[] = [];
  const settings = remoteAccessSettings(resources);
  const groups = clientGroups(resources);

  if (settings) {
    const pool = resources.find((r) => r.kind === 'IpPool' && r.name === settings.pool);
    const cluster = resources.find((r) => r.kind === 'Cluster');
    const network = cluster ? clusterSpecSchema.parse(cluster.spec).network : undefined;

    if (!resources.some((r) => r.kind === 'NodeGroup' && r.name === settings.nodeGroup))
      issues.push(`remoteAccess.nodeGroup ${settings.nodeGroup} does not exist`);

    if (pool && ipPoolSpecSchema.parse(pool.spec).nodeGroup !== settings.nodeGroup)
      issues.push(`IpPool ${settings.pool} must be held by node group ${settings.nodeGroup} (the gateways)`);

    const clientNetwork = mustParseCidr(settings.clientNetwork);

    if (clientNetwork.family !== 4 || clientNetwork.prefixLength > 29)
      issues.push('remoteAccess.clientNetwork must be an IPv4 network of at least /29');

    const outside = clientAddresses.filter((a) => {
      const ip = parseIp(a);

      return !ip || !cidrContainsIp(clientNetwork, ip);
    });

    // Enrolled devices keep their addresses: moving the network would cut them off silently.
    if (outside.length > 0)
      issues.push(
        `remoteAccess.clientNetwork must contain the addresses of the ${outside.length} enrolled client(s) (revoke them first to move the network)`,
      );

    // Node links take listen ports upwards from the WireGuard base port.
    const base = DEFAULT_PLATFORM_PORTS.wireguardBase;

    if (settings.port >= base && settings.port < base + 1024)
      issues.push(`remoteAccess.port ${settings.port} is in the range of the node links (${base}–${base + 1023})`);

    for (const range of [network?.podPoolV4, network?.servicePoolV4, network?.overlayPoolV4].filter(
      (r): r is string => !!r,
    ))
      if (cidrOverlaps(clientNetwork, mustParseCidr(range)))
        issues.push(`remoteAccess.clientNetwork overlaps the cluster range ${range}`);
  } else if (groups.size > 0) {
    issues.push('ClientGroups need remoteAccess in the Cluster resource');
  }

  for (const [name, spec] of groups) {
    const restricted = spec.restrictedGroup ? groups.get(spec.restrictedGroup) : undefined;

    if (spec.restrictedGroup && !restricted)
      issues.push(`ClientGroup ${name}: restricted group ${spec.restrictedGroup} does not exist`);

    // The fallback must always be reachable, so it can't have posture requirements of its own.
    if (restricted?.posture)
      issues.push(`ClientGroup ${name}: restricted group ${spec.restrictedGroup} can't have posture requirements`);
  }

  // A group name in a project policy is the project's workload group, or else a node group (resolution order).
  const ownWorkloadGroup = (project: string, peer: { group: string; project?: string }) =>
    (!peer.project || peer.project === project) &&
    (peer.group.startsWith('compose:') ||
      resources.some((r) => r.kind === 'WorkloadGroup' && r.project === project && r.name === peer.group));

  for (const policy of resources.filter((r) => r.kind === 'Policy')) {
    const spec = policySpecSchema.parse(policy.spec);
    const key = policy.project ? `${policy.project}/${policy.name}` : policy.name;

    // Clients and offices are cluster-level: a project granting its workloads access to them would reach beyond it.
    if (policy.project && spec.to.some((p) => 'clients' in p))
      issues.push(`Policy ${key}: remote clients can only be destinations of cluster-wide policies`);

    // A project may let clients reach its own workloads, nothing else (no other projects, nodes, sites, the internet).
    if (
      policy.project &&
      spec.from.some((p) => 'clients' in p) &&
      spec.to.some((p) => !('selector' in p) && !('group' in p && ownWorkloadGroup(policy.project as string, p)))
    )
      issues.push(`Policy ${key}: in project policies, remote clients may only reach the project's own workloads`);

    for (const peer of [...spec.from, ...spec.to])
      if ('clients' in peer && !groups.has(peer.clients))
        issues.push(`Policy ${key}: client group ${peer.clients} does not exist`);
  }

  return issues;
}

/** The client's WireGuard configuration (wg-quick format); the private key stays on the device. */
export function renderClientConfig(options: {
  config: ClientConfig;
  gatewayPublicKey: string;
  endpoint: string;
  port: number;
  dnsDomain: string;
}): string {
  return [
    '[Interface]',
    'PrivateKey = <generated on this device>',
    `Address = ${options.config.address}`,
    `DNS = ${options.config.dns}, ${options.dnsDomain}`,
    '',
    '[Peer]',
    `PublicKey = ${options.gatewayPublicKey}`,
    `Endpoint = ${options.endpoint}:${options.port}`,
    `AllowedIPs = ${options.config.routes.join(', ')}`,
    'PersistentKeepalive = 25',
    '',
  ].join('\n');
}
