import {
  nextObjectStoreStep,
  objectStorePorts,
  objectStoreSecrets,
  targetReplicationFactor,
  type GenerationView,
} from './object-store.utils';

const T0 = new Date('2026-07-01T00:00:00Z');
const gen = (extra: Partial<GenerationView>): GenerationView => ({
  generation: 1,
  replicationFactor: 1,
  state: 'active',
  holders: ['n1'],
  observedMembers: ['n1'],
  observedSince: T0,
  stateChangedAt: T0,
  ...extra,
});

describe('object store', () => {
  it('alternates ports per generation and caps the replication factor at three', () => {
    expect(objectStorePorts(1)).toEqual({ s3: 3910, rpc: 3911, admin: 3913 });
    expect(objectStorePorts(2)).toEqual({ s3: 3900, rpc: 3901, admin: 3903 });
    expect([0, 1, 2, 3, 5].map(targetReplicationFactor)).toEqual([1, 1, 2, 3, 3]);
  });

  it('derives stable, distinct secrets per generation', () => {
    const a = objectStoreSecrets('k'.repeat(32), 1);

    expect(objectStoreSecrets('k'.repeat(32), 1)).toEqual(a);
    expect(objectStoreSecrets('k'.repeat(32), 2).rpcSecret).not.toBe(a.rpcSecret);
    expect(a.accessKeyId).toMatch(/^GK[0-9a-f]{24}$/);
    expect(new Set(Object.values(a)).size).toBe(5);
  });

  it('creates the first generation for the members', () => {
    expect(nextObjectStoreStep([], ['n2', 'n1'], T0.getTime())).toEqual({
      kind: 'create',
      generation: 1,
      replicationFactor: 2,
      holders: ['n1', 'n2'],
    });
    expect(nextObjectStoreStep([], [], T0.getTime())).toEqual({ kind: 'idle' });
  });

  it('changes the replication factor only through a new generation after the membership was stable', () => {
    const members = ['n1', 'n2', 'n3'];

    expect(nextObjectStoreStep([gen({})], members, T0.getTime())).toEqual({ kind: 'observe', generation: 1, members });

    const observed = gen({ observedMembers: members, observedSince: T0 });

    expect(nextObjectStoreStep([observed], members, T0.getTime() + 60_000)).toEqual({ kind: 'idle' });
    expect(nextObjectStoreStep([observed], members, T0.getTime() + 5 * 60_000)).toEqual({
      kind: 'create',
      generation: 2,
      replicationFactor: 3,
      holders: members,
    });
    expect(
      nextObjectStoreStep(
        [observed, gen({ generation: 2, state: 'provisioning', holders: members })],
        members,
        T0.getTime(),
      ),
    ).toEqual({ kind: 'provision', generation: 2 });
    expect(
      nextObjectStoreStep(
        [observed, gen({ generation: 2, state: 'copying', holders: members })],
        members,
        T0.getTime(),
      ),
    ).toEqual({ kind: 'copy', from: 1, to: 2 });
  });

  it('rebalances in place when the replication factor stays', () => {
    const three = gen({ replicationFactor: 3, holders: ['n1', 'n2', 'n3'], observedMembers: ['n1', 'n2', 'n4'] });

    expect(nextObjectStoreStep([three], ['n1', 'n2', 'n4'], T0.getTime())).toEqual({
      kind: 'rebalance',
      generation: 1,
      members: ['n1', 'n2', 'n4'],
    });
  });

  it('retires the old generation after a grace period', () => {
    const old = gen({ state: 'retiring', stateChangedAt: T0 });
    const current = gen({
      generation: 2,
      replicationFactor: 3,
      holders: ['n1', 'n2', 'n3'],
      observedMembers: ['n1', 'n2', 'n3'],
    });

    expect(nextObjectStoreStep([old, current], ['n1', 'n2', 'n3'], T0.getTime() + 1000)).toEqual({ kind: 'idle' });
    expect(nextObjectStoreStep([old, current], ['n1', 'n2', 'n3'], T0.getTime() + 2 * 60_000)).toEqual({
      kind: 'retire',
      generation: 1,
    });
  });

  it('abandons a generation that can no longer form because a holder left', () => {
    const pending = gen({ generation: 2, replicationFactor: 3, state: 'provisioning', holders: ['n1', 'n2', 'n3'] });

    expect(nextObjectStoreStep([gen({}), pending], ['n1', 'n2'], T0.getTime())).toEqual({
      kind: 'abandon',
      generation: 2,
    });
    expect(nextObjectStoreStep([gen({}), { ...pending, state: 'retired' }], ['n1', 'n2'], T0.getTime())).toMatchObject({
      kind: 'observe',
    });
  });
});
