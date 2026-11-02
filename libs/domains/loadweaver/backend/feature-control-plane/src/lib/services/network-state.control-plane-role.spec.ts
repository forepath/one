import type { NodeEntity } from '../entities/node.entity';
import { apiIngressEndpoints, controlPlaneRole, etcdVoters } from './network-state.service';

const node = (name: string, lifecycle: NodeEntity['lifecycle'], address: string) =>
  ({ name, lifecycle, overlayV4: address, overlayV6: null, witness: false }) as unknown as NodeEntity;

describe('controlPlaneRole (draining members, 2026-10-26)', () => {
  it('keeps a draining member in the member list, flagged, so its agent hands over and streams prefer the others', () => {
    const nodes = [node('n1', 'active', '10.93.0.1'), node('n2', 'draining', '10.93.0.2')];
    const membership = { members: ['n1', 'n2'], votingWitnesses: [], automaticFailover: false, warnings: [] };
    const role = controlPlaneRole(nodes[1], nodes, membership, 'lw-test');

    expect(role.role).toBe('member');
    expect(role.members).toEqual([
      { name: 'n1', address: '10.93.0.1', witness: false },
      { name: 'n2', address: '10.93.0.2', witness: false, draining: true },
    ]);
  });
});

describe('controlPlaneRole / etcdVoters (etcd bootstrap, 3.43)', () => {
  const now = Date.parse('2026-10-30T12:00:00Z');
  const voter = (name: string, state: Partial<NodeEntity>) =>
    ({
      ...node(name, 'active', `10.93.0.${name.slice(1)}`),
      connected: true,
      lastSeenAt: new Date(now - 5_000),
      etcdMemberSince: null,
      etcdReportedAt: new Date(now - 5_000),
      ...state,
    }) as NodeEntity;
  const membership = { members: ['n1', 'n2', 'n3'], votingWitnesses: [], automaticFailover: true, warnings: [] };

  it('derives the voters: up = an open stream with a fresh heartbeat; non-voters are left out', () => {
    const nodes = [
      voter('n1', { connected: false }),
      voter('n2', { lastSeenAt: new Date(now - 120_000) }),
      voter('n3', { etcdReportedAt: null, etcdMemberSince: new Date(now) }),
      voter('n4', {}),
    ];

    expect(etcdVoters(nodes, membership, now)).toEqual([
      { name: 'n1', witness: false, connected: false, reported: true, holdsData: false, assigned: false },
      { name: 'n2', witness: false, connected: false, reported: true, holdsData: false, assigned: false },
      { name: 'n3', witness: false, connected: true, reported: false, holdsData: true, assigned: false },
    ]);
  });

  it('tells the picked member to bootstrap and the others whom to join through; non-voters get no block', () => {
    const nodes = [voter('n1', {}), voter('n2', {}), voter('n3', {}), voter('n4', {})];
    const etcd = { bootstrapper: 'n1', peers: [] };

    expect(controlPlaneRole(nodes[0], nodes, membership, 'lw-test', etcd).etcd).toEqual({ bootstrap: true, peers: [] });
    expect(controlPlaneRole(nodes[1], nodes, membership, 'lw-test', etcd).etcd).toEqual({
      bootstrap: false,
      peers: [],
    });
    expect(controlPlaneRole(nodes[3], nodes, membership, 'lw-test', etcd)).not.toHaveProperty('etcd');
    expect(controlPlaneRole(nodes[0], nodes, membership, 'lw-test')).not.toHaveProperty('etcd');
  });
});

describe('apiIngressEndpoints (status pages through the ingress)', () => {
  it('leaves a draining member out unless no other member is left', () => {
    const nodes = [
      node('n1', 'active', '10.93.0.1'),
      node('n2', 'draining', '10.93.0.2'),
      node('w', 'active', '10.93.0.9'),
    ];

    expect(apiIngressEndpoints(nodes, ['n1', 'n2'])).toEqual(['10.93.0.1']);
    expect(apiIngressEndpoints(nodes, ['n2'])).toEqual(['10.93.0.2']);
  });
});
