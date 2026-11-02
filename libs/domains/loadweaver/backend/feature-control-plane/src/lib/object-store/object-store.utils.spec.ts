import {
  afterCopyBatch,
  copyBatchStart,
  MEMBERSHIP_STABLE_MS,
  nextObjectStoreStep,
  objectStoreMembers,
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
    // Garage cluster secrets, the registry's / files' / backup repositories' keys: all distinct.
    expect(Object.keys(a).sort()).toEqual([
      'accessKeyId',
      'adminToken',
      'backupsAccessKeyId',
      'backupsSecretAccessKey',
      'filesAccessKeyId',
      'filesSecretAccessKey',
      'registryHttpSecret',
      'rpcSecret',
      'secretAccessKey',
    ]);
    expect(new Set(Object.values(a)).size).toBe(9);
    expect(a.backupsAccessKeyId).toMatch(/^GK[0-9a-f]{24}$/);
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
  describe('any number of members, some offline (user, 2026-10-30)', () => {
    const later = T0.getTime() + MEMBERSHIP_STABLE_MS;

    it('forms with the members that are up (one or two: not highly available), nothing without any', () => {
      expect(nextObjectStoreStep([], ['n1', 'n2', 'n3'], T0.getTime(), ['n1'])).toEqual({
        kind: 'create',
        generation: 1,
        replicationFactor: 1,
        holders: ['n1'],
      });
      expect(nextObjectStoreStep([], ['n1', 'n2', 'n3'], T0.getTime(), ['n1', 'n3'])).toMatchObject({
        replicationFactor: 2,
        holders: ['n1', 'n3'],
      });
      // Members exist but none is up: wait (state / config only).
      expect(nextObjectStoreStep([], ['n1', 'n2'], T0.getTime(), [])).toEqual({ kind: 'idle' });
    });

    it('abandons a forming generation whose holder went offline; the next one takes who is up', () => {
      const pending = gen({ state: 'provisioning', holders: ['n1', 'n2'], replicationFactor: 2 });

      expect(nextObjectStoreStep([pending], ['n1', 'n2'], T0.getTime(), ['n1'])).toEqual({
        kind: 'abandon',
        generation: 1,
      });
    });

    it('grows the replication factor as members come up, but never shrinks it for an outage', () => {
      const members = ['n1', 'n2', 'n3'];
      const one = gen({ observedMembers: members });

      // rf 1 → 2 with two of three up, → 3 once all are.
      expect(nextObjectStoreStep([one], members, later, ['n1', 'n2'])).toEqual({
        kind: 'create',
        generation: 2,
        replicationFactor: 2,
        holders: ['n1', 'n2'],
      });
      expect(nextObjectStoreStep([one], members, later, members)).toMatchObject({ replicationFactor: 3 });

      // rf 3 with one member offline: no new generation, no data moved.
      const three = gen({ replicationFactor: 3, holders: members, observedMembers: members });

      expect(nextObjectStoreStep([three], members, later, ['n1', 'n2'])).toEqual({ kind: 'idle' });
    });

    it('grows only once the members that are up were stable too (one generation when two come up in turn)', () => {
      const members = ['n1', 'n2', 'n3'];
      const one = gen({ observedMembers: members });
      const comeUp = later + 60_000;

      // Registered all along (membership stable), n3 just came up: wait.
      expect(nextObjectStoreStep([one], members, comeUp, ['n1', 'n3'], comeUp)).toEqual({ kind: 'idle' });
      // n2 follows a minute later; 5 min after that, one generation for all three.
      expect(nextObjectStoreStep([one], members, comeUp + 60_000, members, comeUp + 60_000)).toEqual({ kind: 'idle' });
      expect(
        nextObjectStoreStep([one], members, comeUp + 60_000 + MEMBERSHIP_STABLE_MS, members, comeUp + 60_000),
      ).toMatchObject({ kind: 'create', replicationFactor: 3, holders: members });
    });

    it('moves data off a draining member that keeps its seat, so it can leave (live 3.43)', () => {
      const node = (name: string, lifecycle = 'active', extra: object = {}) => ({
        name,
        lifecycle,
        controlPlane: true,
        witness: false,
        ...extra,
      });
      const members = objectStoreMembers([
        node('n1'),
        node('n2'),
        node('n3', 'draining'),
        node('w', 'active', { witness: true }),
        node('n4', 'active', { controlPlane: false }),
      ]).map((n) => n.name);
      const three = gen({ replicationFactor: 3, holders: ['n1', 'n2', 'n3'], observedMembers: ['n1', 'n2', 'n3'] });

      expect(members).toEqual(['n1', 'n2']);
      expect(nextObjectStoreStep([three], members, later, members)).toEqual({
        kind: 'observe',
        generation: 1,
        members: ['n1', 'n2'],
      });
      expect(nextObjectStoreStep([{ ...three, observedMembers: members }], members, later, members)).toMatchObject({
        kind: 'create',
        replicationFactor: 2,
        holders: ['n1', 'n2'],
      });
    });

    it('lets an offline member join the layout only once it is up', () => {
      const members = ['n1', 'n2', 'n3', 'n4'];
      const active = gen({ replicationFactor: 3, holders: ['n1', 'n2', 'n3'], observedMembers: members });

      expect(nextObjectStoreStep([active], members, later, ['n1', 'n2', 'n3'])).toEqual({ kind: 'idle' });
      expect(nextObjectStoreStep([active], members, later, members)).toEqual({
        kind: 'rebalance',
        generation: 1,
        members,
      });
    });
  });
});

describe('generation copy counters (live 3.43: the audit said "copied": 0 after a full copy)', () => {
  it('counts copied objects through the live and final passes and removed ones in the sweep, separately', () => {
    let counts = { copied: 0, removed: 0 };

    counts = afterCopyBatch('live', counts, copyBatchStart('live', counts) + 10);
    counts = afterCopyBatch('final', counts, copyBatchStart('final', counts) + 2);
    expect(copyBatchStart('sweep', counts)).toBe(0);
    counts = afterCopyBatch('sweep', counts, copyBatchStart('sweep', counts) + 1);
    expect(counts).toEqual({ copied: 12, removed: 1 });
  });
});
