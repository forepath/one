import { isMemberPort } from '@forepath/loadweaver/shared/util-import';

import type { NodeLifecycle } from '../entities/node.entity';

export interface MembershipCandidate {
  name: string;
  site: string;
  lifecycle: NodeLifecycle;
  controlPlane: boolean;
  witness: boolean;
  /** Host ports the import discovery found in use (3.21); a member port among them blocks the promotion. */
  reservedPorts?: { tcp: number[]; udp: number[] } | null;
}

export interface ControlPlaneMembership {
  members: string[];
  /** Witnesses that vote (only used as tie-breaker for two members, 3.2). */
  votingWitnesses: string[];
  /** False for one node, and for two members without a witness (failover needs a manual confirm). */
  automaticFailover: boolean;
  warnings: string[];
}

const ELIGIBLE: readonly NodeLifecycle[] = ['active', 'cordoned'];

/** Members for this many eligible nodes: up to the desired size, odd above two. */
function memberCount(eligible: number, desiredSize: 3 | 5): number {
  const target = Math.min(desiredSize, eligible);

  return target > 2 && target % 2 === 0 ? target - 1 : target;
}

/** Member ports a host service of the node uses (import discovery, 3.21), sorted. */
export function blockedMemberPorts(candidate: Pick<MembershipCandidate, 'reservedPorts'>): number[] {
  return [...new Set((candidate.reservedPorts?.tcp ?? []).filter(isMemberPort))].sort((a, b) => a - b);
}

/**
 * Control-plane membership (3.2): grows 1 → 2 → 3 (→ 5) as nodes join and shrinks as they leave.
 * Existing members are kept while eligible; new members are spread across sites; sizes above two stay odd.
 * A node whose host services use member ports (found by its import discovery, 3.21) is never promoted: etcd,
 * Postgres and the other member services couldn't bind them (the reason is a warning).
 */
export function computeControlPlaneMembership(
  candidates: readonly MembershipCandidate[],
  desiredSize: 3 | 5,
): ControlPlaneMembership {
  const eligible = candidates
    .filter((c) => !c.witness && ELIGIBLE.includes(c.lifecycle))
    .sort((a, b) => a.name.localeCompare(b.name));
  const blocked = eligible.filter((c) => !c.controlPlane && blockedMemberPorts(c).length > 0);
  const promotable = eligible.filter((c) => !blocked.includes(c));
  const target = memberCount(promotable.length, desiredSize);
  const members: MembershipCandidate[] = promotable.filter((c) => c.controlPlane).slice(0, target);

  while (members.length < target) {
    const perSite = new Map<string, number>();

    members.forEach((m) => perSite.set(m.site, (perSite.get(m.site) ?? 0) + 1));

    const next = promotable
      .filter((c) => !members.includes(c))
      .sort((a, b) => (perSite.get(a.site) ?? 0) - (perSite.get(b.site) ?? 0) || a.name.localeCompare(b.name))[0];

    if (!next) break;

    members.push(next);
  }

  const witnesses = candidates
    .filter((c) => c.witness && ELIGIBLE.includes(c.lifecycle))
    .sort((a, b) => a.name.localeCompare(b.name));
  const votingWitnesses = members.length === 2 && witnesses.length > 0 ? [witnesses[0].name] : [];
  const voters = members.length + votingWitnesses.length;
  const warnings: string[] = [];

  // Only when the blocked nodes cost members (the cluster would be larger without their port use).
  if (members.length < memberCount(eligible.length, desiredSize))
    for (const c of blocked)
      warnings.push(
        `node ${c.name} is not promoted to a control-plane member: host services use member port(s) ${blockedMemberPorts(
          c,
        )
          .map((p) => `tcp/${p}`)
          .join(', ')}; move them off the node and join it again`,
      );

  if (members.length === 2 && votingWitnesses.length === 0) {
    warnings.push(
      'two control-plane members without a witness: data is replicated, but failover needs a manual confirm',
    );
  }

  if (members.length === 1 && eligible.length === 1) {
    warnings.push('single control-plane member: no high availability');
  }

  const sites = new Set(members.map((m) => m.site));

  if (members.length >= 3 && sites.size === 1 && new Set(eligible.map((e) => e.site)).size > 1) {
    warnings.push('all control-plane members are in one site although other sites exist');
  }

  return { members: members.map((m) => m.name).sort(), votingWitnesses, automaticFailover: voters >= 3, warnings };
}

/**
 * Whether the reachable part of the cluster holds control-plane quorum (3.2): a strict majority of the current
 * voters (members, plus the witness while there are exactly two members). A single member is its own majority.
 */
export function hasControlPlaneQuorum(
  nodes: readonly Pick<MembershipCandidate, 'name' | 'controlPlane' | 'witness' | 'lifecycle'>[],
  reachable: ReadonlySet<string>,
): boolean {
  const members = nodes.filter((n) => n.controlPlane && !n.witness && n.lifecycle !== 'left');
  const witnesses = members.length === 2 ? nodes.filter((n) => n.witness && n.lifecycle !== 'left').slice(0, 1) : [];
  const voters = [...members, ...witnesses];

  return voters.length > 0 && voters.filter((v) => reachable.has(v.name)).length * 2 > voters.length;
}
