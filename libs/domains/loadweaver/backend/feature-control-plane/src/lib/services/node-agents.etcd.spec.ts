import type { Heartbeat } from '@forepath/loadweaver/shared/util-agent-protocol';

import { NodeAgentsService } from './node-agents.service';

/** Agents report whether they hold etcd data (3.43); the voters' bootstrap decision follows it. */
function setup(row: Record<string, unknown> | null) {
  const repo = { findOne: jest.fn(async () => row), update: jest.fn(async () => ({ affected: 1 })) };
  const network = { requestRecompile: jest.fn() };
  const service = new NodeAgentsService(
    { getRepository: () => repo } as never,
    {} as never,
    network as never,
    {} as never,
  );

  return { repo, network, service };
}

const heartbeat = (etcd?: Heartbeat['etcd']): Heartbeat => ({
  appliedRevision: 3,
  usage: { cpuMillis: 0, memoryBytes: 0, diskBytes: 0 },
  at: new Date().toISOString(),
  ...(etcd ? { etcd } : {}),
});
const member = (state: Record<string, unknown>) => ({
  id: 'id-1',
  controlPlane: true,
  witness: false,
  etcdMemberSince: null,
  etcdReportedAt: null,
  ...state,
});

describe('NodeAgentsService: etcd state from heartbeats (3.43)', () => {
  it('records the first data and recompiles', async () => {
    const { repo, network, service } = setup(member({ etcdReportedAt: new Date() }));

    await service.handleHeartbeat('n1', heartbeat({ hasData: true }));

    expect(repo.update).toHaveBeenCalledWith(
      { id: 'id-1' },
      { etcdReportedAt: expect.any(Date), etcdMemberSince: expect.any(Date), etcdBootstrapAt: null },
    );
    expect(network.requestRecompile).toHaveBeenCalledTimes(1);
  });

  it("clears it when the data is gone, and recompiles on a voter's first report since it connected", async () => {
    const gone = setup(member({ etcdReportedAt: new Date(), etcdMemberSince: new Date() }));

    await gone.service.handleHeartbeat('n1', heartbeat({ hasData: false }));
    expect(gone.repo.update).toHaveBeenCalledWith(
      { id: 'id-1' },
      { etcdReportedAt: expect.any(Date), etcdMemberSince: null },
    );
    expect(gone.network.requestRecompile).toHaveBeenCalledTimes(1);

    const first = setup(member({}));

    await first.service.handleHeartbeat('n1', heartbeat({ hasData: false }));
    expect(first.repo.update).toHaveBeenCalledWith({ id: 'id-1' }, { etcdReportedAt: expect.any(Date) });
    expect(first.network.requestRecompile).toHaveBeenCalledTimes(1);
  });

  it('does not recompile on unchanged reports, for non-voters, or without a report', async () => {
    const steady = setup(member({ etcdReportedAt: new Date(), etcdMemberSince: new Date() }));

    await steady.service.handleHeartbeat('n1', heartbeat({ hasData: true }));
    expect(steady.network.requestRecompile).not.toHaveBeenCalled();

    const worker = setup(member({ controlPlane: false }));

    await worker.service.handleHeartbeat('n1', heartbeat({ hasData: false }));
    expect(worker.network.requestRecompile).not.toHaveBeenCalled();

    const legacy = setup(member({}));

    await legacy.service.handleHeartbeat('n1', heartbeat());
    expect(legacy.repo.findOne).not.toHaveBeenCalled();
    expect(legacy.repo.update).toHaveBeenCalledTimes(1);
  });
});

describe('NodeAgentsService: heartbeats of a node that left (3.43)', () => {
  it('records nothing (no connected flag, no etcd data) and says so', async () => {
    const { repo, network, service } = setup(member({ etcdReportedAt: new Date() }));

    repo.update.mockResolvedValueOnce({ affected: 0 });

    await expect(service.handleHeartbeat('n1', heartbeat({ hasData: true }))).resolves.toBe(false);
    expect(repo.update).toHaveBeenCalledTimes(1);
    expect(repo.update).toHaveBeenCalledWith({ name: 'n1', lifecycle: expect.anything() }, expect.anything());
    expect(repo.findOne).not.toHaveBeenCalled();
    expect(network.requestRecompile).not.toHaveBeenCalled();
  });

  it('records a member that is still in the cluster', async () => {
    const { service } = setup(member({}));

    await expect(service.handleHeartbeat('n1', heartbeat({ hasData: true }))).resolves.toBe(true);
  });
});
