import { PlanEntity, type PlanProgress } from '../entities/plan.entity';
import { ResourceEntity } from '../entities/resource.entity';
import { VolumePlacementEntity } from '../entities/volume-placement.entity';
import { ApplyOperationService } from './apply-operation.service';

/**
 * App store (P1) parts of the apply tracker: the backup phase before an app update is handed to the plans service,
 * a plan can fail before anything was applied, and an applied plan deletes the volumes it lists.
 */
describe('ApplyOperationService: app store (P1)', () => {
  const progress = (phase: PlanProgress['phase']): PlanProgress => ({
    phase,
    baseRevision: 1,
    targets: {},
    step: '',
    percent: 0,
    startedAt: new Date().toISOString(),
    nodes: {},
  });
  const plan = (patch: Partial<PlanEntity> = {}) =>
    Object.assign(new PlanEntity(), {
      id: 'p1',
      status: 'applying',
      changes: [{ action: 'delete', kind: 'Deployment', name: 'wiki', project: 'shop', baseGeneration: 3 }],
      workloadChanges: [
        { action: 'stop', replica: 'shop/wiki/web/0' },
        { action: 'delete-volume', volume: 'shop/wiki/pgdata', nodes: ['n1', 'n2'], sizeBytes: 1 },
        { action: 'delete-volume', volume: 'shop/wiki/data', nodes: ['n1'], sizeBytes: 1 },
      ],
      deploymentStates: {},
      progress: progress('apply'),
      resolves: null,
      createdBy: 'u1',
      ...patch,
    });

  function setup(options: { owner?: boolean } = {}) {
    const updates: Record<string, unknown>[] = [];
    const deleted: string[] = [];
    const audits: { action: string; target: string }[] = [];
    const manager = {
      query: jest.fn(async () => []),
      getRepository: (entity: unknown) => {
        if (entity === PlanEntity)
          return {
            update: jest.fn(async (_where: unknown, patch: Record<string, unknown>) => updates.push(patch)),
            findOne: jest.fn(async () => null),
          };

        if (entity === ResourceEntity)
          return { findOne: jest.fn(async () => (options.owner ? { kind: 'Deployment', name: 'wiki' } : null)) };

        if (entity === VolumePlacementEntity)
          return {
            delete: jest.fn(async ({ id }: { id: string }) => {
              deleted.push(id);

              return { affected: 1 };
            }),
          };

        throw new Error('unexpected repository');
      },
    };
    const network = { recompile: jest.fn(async () => ({})) };
    const service = Object.create(ApplyOperationService.prototype) as ApplyOperationService;

    Object.assign(service, {
      logger: { warn: jest.fn(), error: jest.fn(), log: jest.fn() },
      dataSource: {
        transaction: async (fn: (m: unknown) => unknown) => await fn(manager),
        getRepository: (entity: unknown) => manager.getRepository(entity),
      },
      network,
      audit: { record: jest.fn(async (_m: unknown, e: { action: string; target: string }) => audits.push(e)) },
      metrics: { event: jest.fn(async () => undefined) },
      logs: { write: jest.fn(async () => undefined) },
      events: { planStatus: jest.fn() },
      notifications: { publish: jest.fn(async () => undefined) },
      onRollbackFailed: null,
    });

    const finish = (p: PlanEntity, status: 'applied' | 'failed') =>
      (service as unknown as { finish: (p: PlanEntity, pr: PlanProgress, s: string) => Promise<void> }).finish(
        p,
        p.progress as PlanProgress,
        status,
      );

    return { service, finish, updates, deleted, audits, network, manager };
  }

  it('deletes the listed volumes once the plan is applied (audited), then recompiles', async () => {
    const { finish, deleted, audits, network } = setup();

    await finish(plan(), 'applied');

    expect(deleted).toEqual(['shop/wiki/pgdata', 'shop/wiki/data']);
    expect(audits.filter((a) => a.action === 'volume.deleted').map((a) => a.target)).toEqual([
      'volume/shop/wiki/pgdata',
      'volume/shop/wiki/data',
    ]);
    expect(network.recompile).toHaveBeenCalledTimes(1);
  });

  it('keeps the volumes when the plan did not apply, or the deployment exists again', async () => {
    const failed = setup();

    await failed.finish(plan(), 'failed');
    expect(failed.deleted).toEqual([]);
    expect(failed.network.recompile).not.toHaveBeenCalled();

    const again = setup({ owner: true });

    await again.finish(plan(), 'applied');
    expect(again.deleted).toEqual([]);
  });

  it('fails a plan before anything was applied: status failed with the reason, locks released, plan.failed', async () => {
    const { service, updates, manager, audits } = setup();

    await service.failBeforeApply(plan({ progress: progress('backup') }), 'the backup before applying failed (x)');

    expect(updates[0]).toMatchObject({
      status: 'failed',
      error: 'the backup before applying failed (x)',
      progress: { step: 'Failed', failure: 'the backup before applying failed (x)' },
    });
    expect(manager.query).toHaveBeenCalledWith('DELETE FROM "lw_resource_locks" WHERE "plan_id" = $1', ['p1']);
    expect(audits.map((a) => a.action)).toContain('plan.failed');
    expect(
      (service as unknown as { notifications: { publish: jest.Mock } }).notifications.publish,
    ).toHaveBeenCalledWith('plan.failed', expect.objectContaining({ id: 'p1', failure: expect.any(String) }));
  });

  it('hands the backup phase to the plans service (nothing is compiled or tracked meanwhile)', async () => {
    const { service, network } = setup();
    const step = jest.fn(async () => false);

    expect(await service.tick(plan({ progress: progress('backup') }))).toBe(false);

    service.onBackupPhase = step;
    expect(await service.tick(plan({ progress: progress('backup') }))).toBe(false);
    expect(step).toHaveBeenCalledTimes(1);
    expect(network.recompile).not.toHaveBeenCalled();
  });
});
