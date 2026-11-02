import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ControlPlaneRole } from '@forepath/loadweaver/shared/util-agent-protocol';

import type { ContainerSpec, MemberContext } from './control-plane-containers';
import { ControlPlaneRoleManager, EtcdJoinPendingError, holdsEtcdData } from './control-plane-role.manager';
import { addMember, listMembers } from './etcd-client';
import { logStoreSpec } from './log-store';

jest.mock('./etcd-client', () => ({
  ...jest.requireActual('./etcd-client'),
  addMember: jest.fn(),
  listMembers: jest.fn(),
  updateMemberPeerUrl: jest.fn(),
}));

const addMemberMock = addMember as jest.MockedFunction<typeof addMember>;
const listMembersMock = listMembers as jest.MockedFunction<typeof listMembers>;

const members: ControlPlaneRole['members'] = [
  { name: 'n1', address: '10.93.0.1', witness: false },
  { name: 'n2', address: '10.93.0.2', witness: false },
  { name: 'n3', address: '10.93.0.3', witness: false },
];
const role = (etcd?: ControlPlaneRole['etcd'], list = members): ControlPlaneRole =>
  ({ role: 'member', members: list, automaticFailover: true, scope: 'lw-test', ...(etcd ? { etcd } : {}) }) as never;

describe('ControlPlaneRoleManager: split-brain-safe etcd bootstrap (3.43)', () => {
  let stateDir: string;
  let ensure: jest.Mock;
  let applyEtcd: (r: ControlPlaneRole) => Promise<boolean>;

  beforeEach(async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'lw-etcd-'));
    ensure = jest.fn(async (spec: ContainerSpec) => !!spec);
    addMemberMock.mockReset();
    listMembersMock.mockReset();

    const m = new ControlPlaneRoleManager({ ensure } as never, {} as never, {} as never, {} as never);
    const ctx = { nodeName: 'n2', address: '10.93.0.2', stateDir, images: { etcd: 'etcd' } } as MemberContext;

    applyEtcd = (r) =>
      (m as unknown as { applyEtcd(c: MemberContext, r: ControlPlaneRole): Promise<boolean> }).applyEtcd(ctx, r);
  });

  afterEach(async () => await rm(stateDir, { recursive: true, force: true }));

  const started = () => ensure.mock.calls[0]?.[0] as ContainerSpec;
  const arg = (spec: ContainerSpec, flag: string) => spec.cmd?.[spec.cmd.indexOf(flag) + 1];

  it('bootstraps a cluster of itself when the control plane picked it, even with other members listed', async () => {
    await applyEtcd(role({ bootstrap: true, peers: [] }));

    expect(addMemberMock).not.toHaveBeenCalled();
    expect(arg(started(), '--initial-cluster-state')).toBe('new');
    expect(arg(started(), '--initial-cluster')).toBe('n2=http://10.93.0.2:2380');
  });

  it('joins only through the members holding etcd data', async () => {
    addMemberMock.mockResolvedValue([
      { ID: '1', name: 'n3', peerURLs: ['http://10.93.0.3:2380'] },
      { ID: '2', name: '', peerURLs: ['http://10.93.0.2:2380'] },
    ] as never);

    await applyEtcd(role({ bootstrap: false, peers: ['n3'] }));

    expect(addMemberMock).toHaveBeenCalledTimes(1);
    expect(addMemberMock).toHaveBeenCalledWith('http://10.93.0.3:2379', 'http://10.93.0.2:2380');
    expect(arg(started(), '--initial-cluster-state')).toBe('existing');
  });

  it('never bootstraps on its own: waits when no peer is reachable or none holds data yet', async () => {
    addMemberMock.mockRejectedValue(new Error('connection refused'));

    await expect(applyEtcd(role({ bootstrap: false, peers: ['n1', 'n3'] }))).rejects.toThrow(
      /no etcd member reachable.*n1, n3.*not bootstrapping/,
    );
    await expect(applyEtcd(role({ bootstrap: false, peers: [] }))).rejects.toBeInstanceOf(EtcdJoinPendingError);
    // Alone, but not picked (e.g. the control plane waits for another member's report).
    await expect(applyEtcd(role({ bootstrap: false, peers: [] }, [members[1]]))).rejects.toThrow(
      /waiting for the etcd bootstrap/,
    );
    expect(ensure).not.toHaveBeenCalled();
  });

  it('keeps the old behaviour for control planes without the etcd block', async () => {
    await applyEtcd(role(undefined, [members[1]]));
    expect(arg(started(), '--initial-cluster-state')).toBe('new');

    ensure.mockClear();
    addMemberMock.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce([] as never);
    await applyEtcd(role());
    expect(addMemberMock.mock.calls.map((c) => c[0])).toEqual(['http://10.93.0.1:2379', 'http://10.93.0.3:2379']);
  });

  it('ignores the bootstrap flag once it holds data, and reports the data', async () => {
    expect(await holdsEtcdData(stateDir)).toBe(false);
    await mkdir(join(stateDir, 'etcd', 'member'), { recursive: true });
    await writeFile(join(stateDir, 'etcd', 'member', 'wal'), '');
    listMembersMock.mockResolvedValue([{ ID: '2', name: 'n2', peerURLs: ['http://10.93.0.2:2380'] }] as never);

    await applyEtcd(role({ bootstrap: true, peers: ['n2'] }));

    expect(await holdsEtcdData(stateDir)).toBe(true);
    expect(arg(started(), '--initial-cluster-state')).toBe('existing');
  });
});

describe('log store formation follows the etcd bootstrap (3.43)', () => {
  const three: ControlPlaneRole = {
    role: 'member',
    members: ['n1', 'n2', 'n3'].map((name, i) => ({ name, address: `10.93.0.${i + 1}`, witness: false })),
    automaticFailover: true,
    scope: 'lw-abc',
    logStore: { clusterName: 'lw-abc', heapMb: 512, httpPort: 9200, transportPort: 9300 },
  };
  const initial = (node: string, role: ControlPlaneRole) =>
    logStoreSpec(node, '10.93.0.1', role, '/d', 'os').env?.['cluster.initial_cluster_manager_nodes'];

  it('forms with the etcd founder alone; the others only join (never bootstrap); old control planes: all members', () => {
    expect(initial('n1', { ...three, etcd: { bootstrap: true, peers: [] } })).toBe('n1');
    // The sole etcd data holder is the founder too (its log store may not have formed in the bootstrap apply).
    expect(initial('n1', { ...three, etcd: { bootstrap: false, peers: ['n1'] } })).toBe('n1');
    expect(initial('n2', { ...three, etcd: { bootstrap: false, peers: ['n1'] } })).toBeUndefined();
    // Live 3.43: joiners named all peers (n2, n3 just connected) and formed a second cluster without n1.
    expect(initial('n2', { ...three, etcd: { bootstrap: false, peers: ['n1', 'n2', 'n3'] } })).toBeUndefined();
    expect(initial('n1', { ...three, etcd: { bootstrap: false, peers: ['n1', 'n2', 'n3'] } })).toBeUndefined();
    expect(initial('n2', three)).toBe('n1,n2,n3');
  });

  it('keeps a running log store when the etcd peers change (live 3.43: every reconnect restarted it)', () => {
    const hash = (role: ControlPlaneRole) => logStoreSpec('n1', '10.93.0.1', role, '/d', 'os').hash;

    expect(hash({ ...three, etcd: { bootstrap: false, peers: ['n1'] } })).toBe(
      hash({ ...three, etcd: { bootstrap: false, peers: ['n1', 'n2', 'n3'] } }),
    );
    expect(hash({ ...three, etcd: { bootstrap: true, peers: [] } })).toBe(hash(three));
    // Members joining / leaving / a new overlay address (seed hosts) neither; single-node ↔ cluster does.
    const four = { ...three, members: [...three.members, { name: 'n4', address: '10.93.0.4', witness: false }] };
    const moved = {
      ...three,
      members: three.members.map((m) => (m.name === 'n3' ? { ...m, address: '10.93.0.7' } : m)),
    };

    expect(hash(four)).toBe(hash(three));
    expect(hash(moved)).toBe(hash(three));
    expect(hash({ ...three, members: three.members.slice(0, 2) })).toBe(hash(three));
    expect(hash({ ...three, members: three.members.slice(0, 1) })).not.toBe(hash(three));
    // Other settings still count.
    expect(
      hash({ ...three, logStore: { clusterName: 'lw-abc', heapMb: 768, httpPort: 9200, transportPort: 9300 } }),
    ).not.toBe(hash(three));
  });
});
