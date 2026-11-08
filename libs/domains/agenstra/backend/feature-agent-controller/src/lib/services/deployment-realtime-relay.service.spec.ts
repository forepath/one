import type { Repository } from 'typeorm';

import type { DeploymentRunEntity } from '../entities/deployment-run.entity';
import type { DeploymentWorkflowEntity } from '../entities/deployment-workflow.entity';

import {
  DeploymentRealtimeRelayService,
  getDeploymentRealtimeRelayIntervalMs,
} from './deployment-realtime-relay.service';
import type { DeploymentRealtimeService } from './deployment-realtime.service';
import type { DeploymentRunsService } from './deployment-runs.service';
import type { DeploymentWorkflowsService } from './deployment-workflows.service';

describe('DeploymentRealtimeRelayService', () => {
  const t0 = new Date('2026-11-08T10:00:00.000Z');
  const t1 = new Date('2026-11-08T10:00:05.000Z');
  const t2 = new Date('2026-11-08T10:00:07.000Z');
  let runRepo: { find: jest.Mock };
  let workflowRepo: { find: jest.Mock };
  let realtime: { emitRunUpsert: jest.Mock; emitWorkflowUpsert: jest.Mock };
  let relay: DeploymentRealtimeRelayService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(t0.getTime());
    runRepo = { find: jest.fn().mockResolvedValue([]) };
    workflowRepo = { find: jest.fn().mockResolvedValue([]) };
    realtime = { emitRunUpsert: jest.fn(), emitWorkflowUpsert: jest.fn() };
    relay = new DeploymentRealtimeRelayService(
      runRepo as unknown as Repository<DeploymentRunEntity>,
      workflowRepo as unknown as Repository<DeploymentWorkflowEntity>,
      {
        toSummary: (row: { id: string; clientId: string }) => ({ id: row.id, clientId: row.clientId }),
      } as unknown as DeploymentRunsService,
      {
        toSummary: (row: { id: string; clientId: string }) => ({ id: row.id, clientId: row.clientId }),
      } as unknown as DeploymentWorkflowsService,
      realtime as unknown as DeploymentRealtimeService,
    );
  });

  afterEach(() => {
    relay.onModuleDestroy();
    jest.useRealTimers();
  });

  it('emits rows changed since the cursor and advances it', async () => {
    relay.start(1000);
    runRepo.find.mockResolvedValueOnce([
      { id: 'r1', clientId: 'c1', updatedAt: t1 },
      { id: 'r2', clientId: 'c2', updatedAt: t2 },
    ]);
    workflowRepo.find.mockResolvedValueOnce([{ id: 'w1', clientId: 'c1', updatedAt: t1 }]);

    await relay.tick();

    expect(runRepo.find.mock.calls[0][0].where.updatedAt.value).toEqual(t0);
    expect(realtime.emitRunUpsert.mock.calls.map(([run]) => run.id)).toEqual(['r1', 'r2']);
    expect(realtime.emitWorkflowUpsert).toHaveBeenCalledWith({ id: 'w1', clientId: 'c1' });

    await relay.tick();

    expect(runRepo.find.mock.calls[1][0].where.updatedAt.value).toEqual(t2);
    expect(workflowRepo.find.mock.calls[1][0].where.updatedAt.value).toEqual(t1);
    expect(realtime.emitRunUpsert).toHaveBeenCalledTimes(2);
  });

  it('does not re-emit the newest row again (Postgres microseconds vs JS milliseconds)', async () => {
    relay.start(1000);
    runRepo.find.mockResolvedValueOnce([{ id: 'r1', clientId: 'c1', updatedAt: t1 }]);
    await relay.tick();
    // `>=` on the millisecond cursor returns the same row again; only a new change (or another row) is emitted.
    runRepo.find.mockResolvedValueOnce([
      { id: 'r1', clientId: 'c1', updatedAt: t1 },
      { id: 'r3', clientId: 'c1', updatedAt: t1 },
    ]);
    await relay.tick();

    expect(realtime.emitRunUpsert.mock.calls.map(([run]) => run.id)).toEqual(['r1', 'r3']);
  });

  it('keeps relaying after a failed pass', async () => {
    runRepo.find.mockRejectedValueOnce(new Error('db down'));

    await expect(relay.tick()).resolves.toBeUndefined();

    runRepo.find.mockResolvedValueOnce([{ id: 'r1', clientId: 'c1', updatedAt: t1 }]);
    await relay.tick();

    expect(realtime.emitRunUpsert).toHaveBeenCalledTimes(1);
  });

  it('reads the interval from the environment; 0 disables the relay', () => {
    expect(getDeploymentRealtimeRelayIntervalMs({})).toBe(5000);
    expect(getDeploymentRealtimeRelayIntervalMs({ DEPLOYMENT_REALTIME_RELAY_INTERVAL_MS: '2000' })).toBe(2000);
    expect(getDeploymentRealtimeRelayIntervalMs({ DEPLOYMENT_REALTIME_RELAY_INTERVAL_MS: 'x' })).toBe(5000);

    relay.start(0);
    jest.advanceTimersByTime(60_000);

    expect(runRepo.find).not.toHaveBeenCalled();
  });
});
