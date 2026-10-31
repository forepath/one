import { etcdBootstrap, type EtcdVoterState } from './etcd-bootstrap.utils';

const voter = (name: string, state: Partial<EtcdVoterState> = {}): EtcdVoterState => ({
  name,
  witness: false,
  connected: true,
  reported: true,
  holdsData: false,
  ...state,
});

describe('etcdBootstrap (3.43: members with any number of nodes up)', () => {
  it('lets exactly one connected member bootstrap while no voter holds data, the first by name', () => {
    expect(etcdBootstrap([voter('n3'), voter('n2'), voter('n1', { connected: false })])).toEqual({
      bootstrapper: 'n2',
      peers: [],
    });
    // One of three up: it bootstraps alone; the offline ones join it later.
    expect(etcdBootstrap([voter('n1'), voter('n2', { connected: false }), voter('n3', { connected: false })])).toEqual({
      bootstrapper: 'n1',
      peers: [],
    });
  });

  it('never picks a witness, and nobody while no member is up', () => {
    expect(
      etcdBootstrap([voter('a-witness', { witness: true }), voter('n1'), voter('n2', { connected: false })]),
    ).toEqual({ bootstrapper: 'n1', peers: [] });
    expect(etcdBootstrap([voter('w', { witness: true }), voter('n1', { connected: false })])).toEqual({
      bootstrapper: null,
      peers: [],
    });
    expect(etcdBootstrap([])).toEqual({ bootstrapper: null, peers: [] });
  });

  it('keeps an earlier bootstrapper until it holds data, also while it is offline (no second cluster)', () => {
    // n2 was told to bootstrap, then went offline before reporting: n1 must not start another cluster.
    expect(etcdBootstrap([voter('n1'), voter('n2', { connected: false, assigned: true })])).toEqual({
      bootstrapper: 'n2',
      peers: ['n2'],
    });
    // Once it holds data it is an ordinary holder.
    expect(etcdBootstrap([voter('n1'), voter('n2', { holdsData: true, assigned: true })])).toEqual({
      bootstrapper: null,
      peers: ['n2'],
    });
    // A voter whose state is still unknown blocks it too.
    expect(etcdBootstrap([voter('n1', { reported: false }), voter('n2', { assigned: true })])).toEqual({
      bootstrapper: null,
      peers: ['n1', 'n2'],
    });
  });

  it('lets nobody bootstrap once a voter holds data, also while it is offline; the others join through it', () => {
    expect(
      etcdBootstrap([voter('n1'), voter('n2', { holdsData: true }), voter('w', { witness: true, holdsData: true })]),
    ).toEqual({ bootstrapper: null, peers: ['n2', 'w'] });
    expect(etcdBootstrap([voter('n1'), voter('n2', { connected: false, holdsData: true })])).toEqual({
      bootstrapper: null,
      peers: ['n2'],
    });
  });

  it('waits for connected voters that have not reported since they connected (they may hold data)', () => {
    expect(etcdBootstrap([voter('n1'), voter('n2', { reported: false })])).toEqual({
      bootstrapper: null,
      peers: ['n2'],
    });
    // Offline without a report: counts as empty (it never held data as far as the control plane knows).
    expect(etcdBootstrap([voter('n1'), voter('n2', { connected: false, reported: false })])).toEqual({
      bootstrapper: 'n1',
      peers: [],
    });
  });
});
