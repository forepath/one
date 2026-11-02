import { APP_BACKUP_BEFORE_UPDATE_ANNOTATION, appAnnotations } from '@forepath/loadweaver/shared/util-model';
import { BadRequestException, ConflictException } from '@nestjs/common';

import { BackupEntity } from '../backups/backup.entities';
import { ClusterEntity } from '../entities/cluster.entity';
import { NodeEntity } from '../entities/node.entity';
import { PlanEntity, type PlanProgress } from '../entities/plan.entity';
import { ResourceEntity } from '../entities/resource.entity';
import { VolumePlacementEntity } from '../entities/volume-placement.entity';
import { PlansService } from './plans.service';

/**
 * App store (P1) in plans: an app update with the backup-first marker and an uninstall with a final backup (listed
 * `backup-volume` changes) back up before anything is applied (phase `backup`, applied once the backups succeeded,
 * failed — nothing applied — otherwise); volume deletions come only with their deployment and need a confirm at apply.
 */
describe('PlansService: app store (P1)', () => {
  const app = (version: string) =>
    appAnnotations({ catalog: 'acme', name: 'wiki', version, channel: 'stable', digest: `sha256:${'a'.repeat(64)}` });
  const updateChange = {
    action: 'update' as const,
    kind: 'Deployment',
    name: 'wiki',
    project: 'shop',
    baseGeneration: 3,
    before: { labels: {}, annotations: app('1.0.0'), spec: {} },
    after: {
      labels: {},
      annotations: {
        ...app('1.2.0'),
        [APP_BACKUP_BEFORE_UPDATE_ANNOTATION]: JSON.stringify({ version: '1.2.0', volumes: ['pgdata'] }),
      },
      spec: {},
    },
  };

  function setup(stored: Partial<PlanEntity>, rows: { backups?: Record<string, unknown>[] } = {}) {
    const plan = Object.assign(new PlanEntity(), {
      id: 'p1',
      status: 'pending',
      changes: [updateChange],
      warnings: [],
      workloadChanges: [],
      deploymentStates: {},
      createdBy: 'u1',
      resolves: null,
      ...stored,
    });
    const saved: PlanEntity[] = [];
    const planUpdates: Record<string, unknown>[] = [];
    const repo = (entity: unknown) => {
      if (entity === PlanEntity)
        return {
          findOne: jest.fn(async () => plan),
          save: jest.fn(async (p: PlanEntity) => {
            saved.push({ ...p } as PlanEntity);

            return p;
          }),
          update: jest.fn(async (_w: unknown, patch: Record<string, unknown>) => planUpdates.push(patch)),
        };

      if (entity === VolumePlacementEntity)
        return { find: jest.fn(async () => [{ id: 'shop/wiki/pgdata' }, { id: 'shop/wiki/data' }]) };

      if (entity === ClusterEntity) return { findOneOrFail: jest.fn(async () => ({ desiredRevision: 7 })) };

      if (entity === BackupEntity)
        return {
          find: jest.fn(async () => rows.backups ?? []),
          findOne: jest.fn(async () => null),
        };

      if (entity === ResourceEntity) return { findOne: jest.fn(async () => ({ labels: { tier: 'web' } })) };

      if (entity === NodeEntity) return { find: jest.fn(async () => []) };

      throw new Error('unexpected repository');
    };
    const manager = { query: jest.fn(async () => []), getRepository: repo };
    const operations = {
      owner: 'replica-1',
      start: jest.fn(),
      waitFor: jest.fn(async () => plan),
      failBeforeApply: jest.fn(async () => undefined),
    };
    const backupScheduler = { startBackup: jest.fn(async () => ({ id: 'b-new' })) };
    const service = Object.create(PlansService.prototype) as PlansService;

    Object.assign(service, {
      dataSource: {
        transaction: async (...args: unknown[]) => await (args.at(-1) as (m: unknown) => unknown)(manager),
        getRepository: repo,
      },
      resources: {
        findForUpdate: jest.fn(async () => [{ kind: 'Deployment', projectKey: 'shop', name: 'wiki', generation: 3 }]),
        findOne: jest.fn(async () => ({ generation: 3 })),
      },
      operations,
      backupScheduler,
      audit: { record: jest.fn(async () => undefined), recordStandalone: jest.fn(async () => undefined) },
      events: { planStatus: jest.fn() },
      assertMayChange: jest.fn(async () => ({})),
      applyBlockers: jest.fn(async () => []),
      respond: jest.fn(async (p: PlanEntity) => ({ id: p.id, status: p.status })),
      approvals: jest.fn(async () => []),
      applyChanges: jest.fn(async () => undefined),
    });

    const step = (p: PlanEntity) =>
      (service as unknown as { backupPhaseStep: (p: PlanEntity) => Promise<boolean> }).backupPhaseStep(p);

    return { service, plan, saved, planUpdates, operations, backupScheduler, step };
  }

  const backupProgress = (backups: Record<string, string | null>): PlanProgress => ({
    phase: 'backup',
    baseRevision: 7,
    targets: null,
    step: '',
    percent: 0,
    startedAt: new Date().toISOString(),
    nodes: {},
    backups,
    by: 'u1',
  });

  it('apply backs up first: the plan waits in phase backup, nothing is applied yet', async () => {
    const { service, saved, operations } = setup({});

    await service.apply('p1');

    expect(saved[0]).toMatchObject({
      status: 'applying',
      progress: { phase: 'backup', baseRevision: 7, backups: { 'shop/wiki/pgdata': null } },
    });
    expect((service as unknown as { applyChanges: jest.Mock }).applyChanges).not.toHaveBeenCalled();
    expect(operations.start).toHaveBeenCalledWith('p1');
  });

  it('an uninstall with a final backup backs up the listed volumes first; the Deployment is deleted only after', async () => {
    const { service, saved } = setup({
      changes: [{ ...updateChange, action: 'delete', after: null }],
      workloadChanges: [{ action: 'backup-volume', volume: 'shop/wiki/pgdata', nodes: ['n1'], sizeBytes: 1 }],
    });

    await service.apply('p1');

    expect(saved[0]).toMatchObject({
      status: 'applying',
      progress: {
        phase: 'backup',
        step: 'Backing up before applying: 0 / 1 volume(s)',
        backups: { 'shop/wiki/pgdata': null },
      },
    });
    expect((service as unknown as { applyChanges: jest.Mock }).applyChanges).not.toHaveBeenCalled();
  });

  it('refuses listed backups of volumes whose deployment the plan doesn’t delete', async () => {
    const { service } = setup({});
    const build = (
      service as unknown as {
        build: (s: unknown[], d: unknown[], r: unknown[], a: Record<string, unknown>) => Promise<unknown>;
      }
    ).build.bind(service);

    await expect(
      build([], [], [], {
        createdBy: 'u1',
        roles: async () => ({}),
        source: { kind: 'api' },
        volumeBackups: ['shop/wiki/pgdata'],
      }),
    ).rejects.toMatchObject({ response: { message: 'Volumes cannot be backed up before applying' } });
  });

  it('applies right away without the marker (apps without declared backups, backup: skip)', async () => {
    const { service, saved } = setup({
      changes: [{ ...updateChange, after: { ...updateChange.after, annotations: app('1.2.0') } }],
    });

    await service.apply('p1');

    expect(saved).toEqual([]);
    expect((service as unknown as { applyChanges: jest.Mock }).applyChanges).toHaveBeenCalledTimes(1);
  });

  it('starts the backups, follows them and applies once they succeeded', async () => {
    const starting = setup({ status: 'applying', progress: backupProgress({ 'shop/wiki/pgdata': null }) });

    expect(await starting.step(starting.plan)).toBe(false);
    expect(starting.backupScheduler.startBackup).toHaveBeenCalledWith(
      {
        id: 'shop/wiki/pgdata',
        project: 'shop',
        deployment: 'wiki',
        volume: 'pgdata',
        deploymentLabels: { tier: 'web' },
      },
      { key: null, hooks: true },
    );
    expect(starting.planUpdates[0]).toMatchObject({ progress: { backups: { 'shop/wiki/pgdata': 'b-new' } } });

    const running = setup(
      { status: 'applying', progress: backupProgress({ 'shop/wiki/pgdata': 'b1' }) },
      { backups: [{ id: 'b1', status: 'running', error: null }] },
    );

    expect(await running.step(running.plan)).toBe(false);
    expect(running.planUpdates[0]).toMatchObject({
      progress: { step: 'Backing up before applying: 0 / 1 volume(s)' },
    });

    const done = setup(
      { status: 'applying', progress: backupProgress({ 'shop/wiki/pgdata': 'b1' }) },
      { backups: [{ id: 'b1', status: 'succeeded', error: null }] },
    );

    expect(await done.step(done.plan)).toBe(false);
    expect((done.service as unknown as { applyChanges: jest.Mock }).applyChanges).toHaveBeenCalledWith(
      expect.anything(),
      done.plan,
      'u1',
    );
    expect(done.operations.failBeforeApply).not.toHaveBeenCalled();
  });

  it('fails the plan without applying when a backup fails, can’t start or the apply is cancelled', async () => {
    const failed = setup(
      { status: 'applying', progress: backupProgress({ 'shop/wiki/pgdata': 'b1' }) },
      { backups: [{ id: 'b1', status: 'failed', error: 'pre hook failed' }] },
    );

    expect(await failed.step(failed.plan)).toBe(true);
    expect(failed.operations.failBeforeApply).toHaveBeenCalledWith(
      failed.plan,
      expect.stringContaining(
        'the backup before applying failed (shop/wiki/pgdata: pre hook failed); nothing was applied',
      ),
    );
    expect((failed.service as unknown as { applyChanges: jest.Mock }).applyChanges).not.toHaveBeenCalled();

    const unstartable = setup({ status: 'applying', progress: backupProgress({ 'shop/wiki/pgdata': null }) });

    unstartable.backupScheduler.startBackup.mockRejectedValueOnce(new Error('no backup key'));
    expect(await unstartable.step(unstartable.plan)).toBe(true);
    expect(unstartable.operations.failBeforeApply).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('could not be started (shop/wiki/pgdata: no backup key)'),
    );

    const cancelled = setup({
      status: 'applying',
      cancelRequested: true,
      progress: backupProgress({ 'shop/wiki/pgdata': 'b1' }),
    });

    expect(await cancelled.step(cancelled.plan)).toBe(true);
    expect(cancelled.operations.failBeforeApply).toHaveBeenCalledWith(
      cancelled.plan,
      expect.stringContaining('cancelled'),
    );
  });

  it('needs confirm: true to apply a plan that deletes volume data', async () => {
    const { service } = setup({
      changes: [{ ...updateChange, action: 'delete', after: null }],
      warnings: [{ level: 'warning', path: 'volumes', destructive: true, message: 'deletes volume shop/wiki/pgdata' }],
    });

    await expect(service.apply('p1')).rejects.toThrow(
      new ConflictException('the plan deletes volume data; apply with confirm: true'),
    );
  });

  it('refuses volume deletions without their deployment’s deletion in the same plan', async () => {
    const { service } = setup({});
    const build = (
      service as unknown as {
        build: (s: unknown[], d: unknown[], r: unknown[], a: Record<string, unknown>) => Promise<unknown>;
      }
    ).build.bind(service);

    await expect(
      build([], [], [], {
        createdBy: 'u1',
        roles: async () => ({}),
        source: { kind: 'api' },
        volumeDeletions: ['shop/wiki/pgdata'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
