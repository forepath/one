import {
  blockedMemberPorts,
  computeControlPlaneMembership,
  hasControlPlaneQuorum,
  type MembershipCandidate,
} from './control-plane-membership.utils';

const node = (name: string, extra: Partial<MembershipCandidate> = {}): MembershipCandidate => ({
  name,
  site: 'fra1',
  lifecycle: 'active',
  controlPlane: false,
  witness: false,
  ...extra,
});

describe('computeControlPlaneMembership', () => {
  it('runs on a single node without HA', () => {
    expect(computeControlPlaneMembership([node('n1')], 3)).toEqual({
      members: ['n1'],
      votingWitnesses: [],
      automaticFailover: false,
      warnings: ['single control-plane member: no high availability'],
    });
  });

  it('uses two nodes and needs a witness for automatic failover', () => {
    expect(computeControlPlaneMembership([node('n1'), node('n2')], 3)).toMatchObject({
      members: ['n1', 'n2'],
      automaticFailover: false,
    });
    expect(computeControlPlaneMembership([node('n1'), node('n2'), node('w', { witness: true })], 3)).toMatchObject({
      members: ['n1', 'n2'],
      votingWitnesses: ['w'],
      automaticFailover: true,
      warnings: [],
    });
  });

  it('grows to three and stays odd', () => {
    const four = ['n1', 'n2', 'n3', 'n4'].map((n) => node(n));

    expect(computeControlPlaneMembership(four, 3).members).toEqual(['n1', 'n2', 'n3']);
    expect(computeControlPlaneMembership(four, 5).members).toHaveLength(3);
    expect(computeControlPlaneMembership([...four, node('n5')], 5).members).toHaveLength(5);
  });

  it('never promotes a node whose host services use member ports (import discovery) and says why', () => {
    const postgres = { reservedPorts: { tcp: [22, 5432, 2379], udp: [51820] } };
    const result = computeControlPlaneMembership([node('n1'), node('n2'), node('n3', postgres)], 3);

    expect(result.members).toEqual(['n1', 'n2']);
    expect(result.warnings).toContain(
      'node n3 is not promoted to a control-plane member: host services use member port(s) tcp/2379, tcp/5432; move them off the node and join it again',
    );
    // Other host ports don't block; a node that isn't needed gets no warning; an existing member stays.
    expect(
      computeControlPlaneMembership(
        [node('n1'), node('n2'), node('n3', { reservedPorts: { tcp: [22, 8080], udp: [] } })],
        3,
      ).members,
    ).toEqual(['n1', 'n2', 'n3']);
    expect(computeControlPlaneMembership([node('n1'), node('n2'), node('n3'), node('n4', postgres)], 3)).toMatchObject({
      members: ['n1', 'n2', 'n3'],
      warnings: [],
    });
    expect(
      computeControlPlaneMembership([node('n1', { ...postgres, controlPlane: true }), node('n2')], 3).members,
    ).toEqual(['n1', 'n2']);
    // Sizes above two stay odd: four eligible but one blocked of five → three members.
    expect(
      computeControlPlaneMembership(['n1', 'n2', 'n3', 'n4'].map((n) => node(n)).concat(node('n5', postgres)), 5)
        .members,
    ).toEqual(['n1', 'n2', 'n3']);
    expect(blockedMemberPorts({ reservedPorts: { tcp: [7600, 5005, 80, 5432, 5432], udp: [2379] } })).toEqual([
      5005, 5432, 7600,
    ]);
  });

  it('keeps existing members and spreads new ones across sites', () => {
    const nodes = [
      node('a1', { controlPlane: true }),
      node('a2', { site: 'fra1' }),
      node('b1', { site: 'ams1' }),
      node('c1', { site: 'par1' }),
    ];

    expect(computeControlPlaneMembership(nodes, 3).members).toEqual(['a1', 'b1', 'c1']);
  });

  it('shrinks when members drain or leave and ignores witnesses as members', () => {
    const nodes = [
      node('n1', { controlPlane: true }),
      node('n2', { controlPlane: true, lifecycle: 'draining' }),
      node('n3', { controlPlane: true }),
      node('w', { witness: true }),
    ];

    expect(computeControlPlaneMembership(nodes, 3)).toMatchObject({
      members: ['n1', 'n3'],
      votingWitnesses: ['w'],
      automaticFailover: true,
    });
  });

  it('warns when all members share one site although others exist', () => {
    const nodes = [
      node('a', { controlPlane: true }),
      node('b', { controlPlane: true }),
      node('c', { controlPlane: true }),
      node('d', { site: 'ams1' }),
    ];

    expect(computeControlPlaneMembership(nodes, 3).warnings).toContain(
      'all control-plane members are in one site although other sites exist',
    );
  });
});

describe('hasControlPlaneQuorum', () => {
  const n = (name: string, controlPlane: boolean, witness = false) => ({
    name,
    controlPlane,
    witness,
    lifecycle: 'active' as const,
  });

  it('needs a strict majority of the voters', () => {
    const three = [n('a', true), n('b', true), n('c', true), n('w', false)];

    expect(hasControlPlaneQuorum(three, new Set(['a', 'b']))).toBe(true);
    expect(hasControlPlaneQuorum(three, new Set(['a']))).toBe(false);
    expect(hasControlPlaneQuorum([n('a', true)], new Set(['a']))).toBe(true);
    // Two members: the witness breaks the tie.
    expect(hasControlPlaneQuorum([n('a', true), n('b', true), n('w', false, true)], new Set(['a', 'w']))).toBe(true);
    expect(hasControlPlaneQuorum([n('a', true), n('b', true)], new Set(['a']))).toBe(false);
  });
});
