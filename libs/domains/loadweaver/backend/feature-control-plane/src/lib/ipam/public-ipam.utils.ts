import { matchesSelector, type IpPoolSpec, type NodeGroupSpec } from '@forepath/loadweaver/shared/util-model';
import type { CompilerEgress } from '@forepath/loadweaver/shared/util-policy-compiler';
import {
  allocateAddress,
  formatIp,
  mustParseCidr,
  mustParseIp,
  type IpAddress,
} from '@forepath/loadweaver/shared/util-network';

export type IpPurpose = IpPoolSpec['purposes'][number];

/** Something that needs a public address, e.g. `ingress/0` (3.27). */
export interface AddressClaim {
  owner: string;
  pool: string;
  purpose: IpPurpose;
}

export interface AddressRow {
  address: string;
  pool: string;
  purpose: IpPurpose;
  owner: string | null;
  state: 'assigned' | 'cooldown';
  releasedAt: Date | null;
  holder: string | null;
  vrid: number | null;
}

export interface AddressPlan {
  rows: AddressRow[];
  /** Freed for good (cooldown over). */
  removed: string[];
  errors: string[];
}

const VRID_MAX = 255;

/**
 * Public IPAM (3.27): claims keep their address while they exist; released addresses go into a cooldown before
 * anyone gets them again; new claims take the lowest free address of their pool. VRRP addresses get a router id
 * unique in the cluster.
 */
export function planPublicAddresses(
  pools: ReadonlyMap<string, IpPoolSpec>,
  current: readonly AddressRow[],
  claims: readonly AddressClaim[],
  now: Date,
): AddressPlan {
  const errors: string[] = [];
  const claimed = new Map(claims.map((c) => [c.owner, c]));
  const rows: AddressRow[] = [];
  const removed: string[] = [];

  for (const row of current) {
    const claim = row.owner ? claimed.get(row.owner) : undefined;
    const pool = pools.get(row.pool);

    if (row.state === 'assigned' && claim && claim.pool === row.pool && pool) {
      rows.push(row);
      continue;
    }

    if (row.state === 'assigned') {
      rows.push({ ...row, owner: null, state: 'cooldown', releasedAt: now, holder: null });
      continue;
    }

    const cooldown = (pool?.cooldownSeconds ?? 0) * 1000;

    if (!pool || now.getTime() - (row.releasedAt?.getTime() ?? 0) >= cooldown) removed.push(row.address);
    else rows.push(row);
  }

  const usedVrids = new Set(rows.map((r) => r.vrid).filter((v): v is number => v !== null));

  for (const claim of claims) {
    if (rows.some((r) => r.owner === claim.owner)) continue;

    const pool = pools.get(claim.pool);

    if (!pool) {
      errors.push(`${claim.owner}: IP pool ${claim.pool} does not exist`);
      continue;
    }

    if (!pool.purposes.includes(claim.purpose)) {
      errors.push(`${claim.owner}: IP pool ${claim.pool} is not for ${claim.purpose}`);
      continue;
    }

    let address: IpAddress | null = null;
    const used = rows.filter((r) => r.pool === claim.pool).map((r) => mustParseIp(r.address));

    for (const cidr of pool.cidrs.map((c) => mustParseCidr(c))) {
      // An on-link prefix (VRRP) can't use its network address; single addresses (/32, /128) are used as they are.
      const leading = pool.failover === 'vrrp' && cidr.family === 4 && cidr.prefixLength < 31 ? BigInt(1) : BigInt(0);

      address = allocateAddress(cidr, used, leading);

      if (address) break;
    }

    if (!address) {
      errors.push(`${claim.owner}: IP pool ${claim.pool} is exhausted`);
      continue;
    }

    let vrid: number | null = null;

    if (pool.failover === 'vrrp') {
      vrid = Array.from({ length: VRID_MAX }, (_, i) => i + 1).find((v) => !usedVrids.has(v)) ?? null;

      if (vrid === null) {
        errors.push(`${claim.owner}: no free VRRP router id`);
        continue;
      }

      usedVrids.add(vrid);
    }

    rows.push({
      address: formatIp(address),
      pool: claim.pool,
      purpose: claim.purpose,
      owner: claim.owner,
      state: 'assigned',
      releasedAt: null,
      holder: null,
      vrid,
    });
  }

  return { rows, removed, errors };
}

export interface HolderNode {
  name: string;
  site: string;
  labels: Record<string, string>;
  lifecycle: string;
  reachable: boolean;
}

/** Nodes allowed to hold a pool's addresses: the pool's node group, active and reachable. */
export function holderCandidates(group: NodeGroupSpec | undefined, nodes: readonly HolderNode[]): string[] {
  if (!group) return [];

  return nodes
    .filter(
      (n) =>
        n.lifecycle === 'active' &&
        n.reachable &&
        matchesSelector(group.selector, {
          name: n.name,
          labels: { ...n.labels, 'loadweaver.com/site': n.site, 'loadweaver.com/node': n.name },
        }),
    )
    .map((n) => n.name)
    .sort();
}

/** Keeps the current holder while it can hold; otherwise the first candidate (stable, no flapping). */
export function chooseHolder(current: string | null, candidates: readonly string[]): string | null {
  return current && candidates.includes(current) ? current : (candidates[0] ?? null);
}

/** Name-server addresses of hosted bind9 providers (3.15), e.g. anycast addresses from a `dns` pool. */
export function dnsClaims(
  providers: ReadonlyMap<string, { type: string; nameServers?: { pool: string; count: number } }>,
): AddressClaim[] {
  return [...providers]
    .filter(([, p]) => p.type === 'bind9' && p.nameServers)
    .flatMap(([name, p]) =>
      Array.from({ length: p.nameServers?.count ?? 0 }, (_, i) => ({
        owner: `dns/${name}/${i}`,
        pool: p.nameServers?.pool as string,
        purpose: 'dns' as const,
      })),
    );
}

/** Cluster claims from the cluster spec: the ingress addresses and the remote access gateway address (3.31). */
export function clusterClaims(
  ingress: { pool: string; addresses: number } | undefined,
  remoteAccess?: { pool: string },
): AddressClaim[] {
  return [
    ...(ingress
      ? Array.from({ length: ingress.addresses }, (_, i) => ({
          owner: `ingress/${i}`,
          pool: ingress.pool,
          purpose: 'ingress' as const,
        }))
      : []),
    ...(remoteAccess ? [{ owner: 'vpn/0', pool: remoteAccess.pool, purpose: 'vpn' as const }] : []),
  ];
}

/** `egress/<policy key>/<i>`: one egress address per pool of a policy (3.27). */
export function egressOwner(policyKey: string, index: number): string {
  return `egress/${policyKey}/${index}`;
}

/** The policy key of an egress owner, or null for other owners. */
export function egressPolicyOf(owner: string | null): string | null {
  const match = owner ? /^egress\/(.+)\/\d+$/.exec(owner) : null;

  return match ? match[1] : null;
}

/** Egress addresses of policies with `egress` (3.27). */
export function egressClaims(
  policies: readonly { project?: string | null; name: string; spec: { egress?: { pools: string[] } } }[],
): AddressClaim[] {
  return policies.flatMap((p) =>
    (p.spec.egress?.pools ?? []).map((pool, i) => ({
      owner: egressOwner(p.project ? `${p.project}/${p.name}` : p.name, i),
      pool,
      purpose: 'egress' as const,
    })),
  );
}

/** Egress gateways for the network compiler: assigned egress addresses and the nodes holding them. */
export function egressGateways(
  rows: readonly { address: string; owner: string | null; state: string; holder: string | null }[],
): CompilerEgress[] {
  return rows.flatMap((r) => {
    const policy = r.state === 'assigned' && r.holder ? egressPolicyOf(r.owner) : null;

    return policy && r.holder ? [{ policy, address: r.address, holder: r.holder }] : [];
  });
}

/**
 * Edge capacity in the failure analysis (3.12, 3.27): addresses only one node can hold, or that can't move at all,
 * are pins.
 */
export function poolWarnings(
  pools: ReadonlyMap<string, IpPoolSpec>,
  groups: ReadonlyMap<string, NodeGroupSpec>,
  nodes: readonly HolderNode[],
  rows: readonly Pick<AddressRow, 'pool' | 'owner' | 'state'>[],
): string[] {
  const warnings: string[] = [];

  for (const [name, pool] of pools) {
    const owners = rows.filter((r) => r.pool === name && r.state === 'assigned' && r.owner).map((r) => r.owner);

    if (owners.length === 0) continue;

    // Structural capacity: every active member counts, reachable right now or not.
    const candidates = holderCandidates(
      groups.get(pool.nodeGroup),
      nodes.map((n) => ({ ...n, reachable: true })),
    );

    if (pool.failover === 'none')
      warnings.push(
        `IpPool ${name}: addresses can't move between nodes; ${owners.join(', ')} are pinned to their holder`,
      );
    else if (candidates.length < 2)
      warnings.push(
        `IpPool ${name}: ${candidates.length === 0 ? 'no node' : `only ${candidates[0]}`} can hold its addresses; a failure takes ${owners.join(', ')} offline`,
      );
  }

  return warnings;
}
