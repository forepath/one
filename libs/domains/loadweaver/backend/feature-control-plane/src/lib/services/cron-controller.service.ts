import { previousRun } from '@forepath/loadweaver/shared/util-scheduler';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull, Not } from 'typeorm';

import { ADVISORY_LOCK_PLACEMENT_ALLOCATION } from '../constants/control-plane.constants';
import { CronRunEntity, CronScheduleEntity, type CronRunState } from '../entities/cron-run.entity';
import { NodeEntity } from '../entities/node.entity';
import { ResourceEntity } from '../entities/resource.entity';
import { VolumePlacementEntity } from '../entities/volume-placement.entity';
import { WorkloadPlacementEntity } from '../entities/workload-placement.entity';
import {
  cronDefinitions,
  cronRunOutcome,
  pickCronNode,
  RETRYABLE_CRON_STATES,
  type CronDefinition,
} from '../utils/cron-planning.utils';
import { allocateWorkloadAddresses, toSchedulerNodes } from '../utils/workload-planning.utils';
import { AuditLogService } from './audit-log.service';
import { NetworkStateService } from './network-state.service';
import { FAILOVER_AFTER_MS } from './workload-controller.service';
import { plannerNodes, reservedAddresses, WorkloadPlannerService } from './workload-planner.service';
import { writesPaused } from '../database-handover/database-target.runtime';

const TICK_MS = 10_000;
const ADVISORY_LOCK_CRON_CONTROLLER = 0x4c570007;
/** Runs kept per cron job as history. */
export const CRON_RUN_HISTORY = 50;
const CRON_SEQUENCE_WRAP = 100_000_000;

/**
 * Cron jobs (3.23), leader-elected across control-plane replicas: every due time fires exactly once cluster-wide.
 * The leader is whoever holds the advisory lock for a tick, and the due time is advanced in the same transaction
 * that creates the run, so a failover between replicas can neither skip nor repeat a run. Missed due times are not
 * replayed one by one; only the latest one fires.
 *
 * A run is a placement owned by this controller (`cronRun`), so it gets addresses, policies and secrets exactly like
 * any replica. The last finished run stays on its node (for logs and exit code) until the next run starts.
 */
@Injectable()
export class CronControllerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CronControllerService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly planner: WorkloadPlannerService,
    private readonly network: NetworkStateService,
    private readonly audit: AuditLogService,
  ) {}

  onApplicationBootstrap(): void {
    if ((process.env.LOADWEAVER_WORKLOAD_CONTROLLER ?? 'on') === 'off') return;

    this.timer = setInterval(() => void this.safeTick(), TICK_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async safeTick(): Promise<void> {
    if (writesPaused('Cron controller', this.logger)) return;

    if (this.running) return;

    this.running = true;

    try {
      await this.tick();
    } catch (error) {
      this.logger.warn(`Cron controller: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }

  /** One pass; returns true if runs started or stopped. */
  async tick(now = Date.now()): Promise<boolean> {
    const changed = await this.dataSource.transaction(async (manager) => {
      const [{ locked }] = await manager.query('SELECT pg_try_advisory_xact_lock($1) AS locked', [
        ADVISORY_LOCK_CRON_CONTROLLER,
      ]);

      if (!locked) return false;

      const resources = await manager
        .getRepository(ResourceEntity)
        .find({ where: [{ kind: 'Project' }, { kind: 'Deployment' }] });
      const definitions = new Map(cronDefinitions(this.planner.parse(resources).parsed).map((d) => [d.id, d]));
      const progressed = await this.progress(manager, definitions, now);
      const started = await this.startDue(manager, definitions, now);
      const cleaned = await this.cleanUp(manager, definitions);

      return progressed || started || cleaned;
    });

    if (changed) this.network.requestRecompile('cron controller');

    return changed;
  }

  /** Finishes runs from agent reports, timeouts and lost nodes; failed runs are retried while attempts remain. */
  private async progress(
    manager: EntityManager,
    definitions: ReadonlyMap<string, CronDefinition>,
    now: number,
  ): Promise<boolean> {
    const runs = await manager.getRepository(CronRunEntity).find({ where: { state: 'running' } });

    if (runs.length === 0) return false;

    const placements = await manager
      .getRepository(WorkloadPlacementEntity)
      .find({ where: { cronRun: In(runs.map((r) => r.id)) } });
    const nodes = await manager.getRepository(NodeEntity).find({ where: { lifecycle: Not('left') } });
    let changed = false;

    for (const run of runs) {
      const definition = definitions.get(run.cron);
      const placement = placements.find((p) => p.cronRun === run.id);
      const node = nodes.find((n) => n.name === run.node);

      if (!definition || !placement) {
        await this.finish(
          manager,
          run,
          { state: 'cancelled', message: definition ? 'run placement vanished' : 'cron job removed' },
          true,
        );
        changed = true;
        continue;
      }

      const outcome = cronRunOutcome(
        {
          startedAt: run.startedAt as Date,
          node: run.node as string,
          timeoutSeconds: definition.cron.timeoutSeconds,
          status: placement.status?.[run.node as string],
          nodeReachable: !!node && now - (node.lastSeenAt ?? node.joinedAt).getTime() <= FAILOVER_AFTER_MS,
        },
        now,
      );

      if (!outcome) continue;

      // A timed-out or orphaned container is stopped; a finished one stays for its logs.
      await this.finish(manager, run, outcome, outcome.state === 'timed-out' || outcome.state === 'node-lost');
      changed = true;

      if (RETRYABLE_CRON_STATES.has(outcome.state) && run.attempt < definition.cron.retries) {
        const newer = await manager
          .getRepository(CronRunEntity)
          .exists({ where: { cron: run.cron, scheduledAt: Not(run.scheduledAt), state: 'running' } });

        if (!newer) await this.startSafely(manager, definition, run.scheduledAt, run.attempt + 1, now);
      }
    }

    return changed;
  }

  private async startDue(
    manager: EntityManager,
    definitions: ReadonlyMap<string, CronDefinition>,
    now: number,
  ): Promise<boolean> {
    const scheduleRepo = manager.getRepository(CronScheduleEntity);
    const schedules = new Map((await scheduleRepo.find()).map((s) => [s.id, s]));
    let changed = false;

    for (const definition of definitions.values()) {
      const state = schedules.get(definition.id);

      if (!state) {
        // A new cron job starts with the next due time, not with one that passed before it existed.
        await scheduleRepo.save(
          scheduleRepo.create({
            id: definition.id,
            lastScheduledAt: new Date(Math.floor(now / 60_000) * 60_000),
            sequence: 0,
          }),
        );
        continue;
      }

      const due = previousRun(definition.cron.schedule, definition.cron.timezone, new Date(now), state.lastScheduledAt);

      if (!due) continue;

      await scheduleRepo.update({ id: definition.id }, { lastScheduledAt: due });

      const active = await manager
        .getRepository(CronRunEntity)
        .find({ where: { cron: definition.id, state: 'running' } });

      if (active.length > 0 && definition.cron.concurrency === 'forbid') {
        await this.record(manager, definition, due, {
          state: 'skipped',
          message: 'the previous run is still running (concurrency: forbid)',
        });
        continue;
      }

      if (definition.cron.concurrency === 'replace') {
        for (const run of active)
          await this.finish(
            manager,
            run,
            { state: 'cancelled', message: 'replaced by the next run (concurrency: replace)' },
            true,
          );
      }

      changed = (await this.startSafely(manager, definition, due, 0, now)) || changed;
    }

    return changed;
  }

  /**
   * Starts a run in its own savepoint: if placing it fails (e.g. a full pod subnet), the run is recorded as failed
   * and the tick goes on, so one broken job never stops the others or replays its due time forever.
   */
  private async startSafely(
    manager: EntityManager,
    definition: CronDefinition,
    scheduledAt: Date,
    attempt: number,
    now: number,
  ): Promise<boolean> {
    await manager.query('SAVEPOINT lw_cron_start');

    try {
      await this.start(manager, definition, scheduledAt, attempt, now);
      await manager.query('RELEASE SAVEPOINT lw_cron_start');

      return true;
    } catch (error) {
      await manager.query('ROLLBACK TO SAVEPOINT lw_cron_start');

      const message = error instanceof Error ? error.message : String(error);

      this.logger.warn(`Cron job ${definition.id} could not start: ${message}`);
      await this.record(
        manager,
        definition,
        scheduledAt,
        { state: 'failed', message: `could not start: ${message}` },
        attempt,
      );

      return false;
    }
  }

  /** Places one run; without an eligible node the run is recorded as failed (and alerts, 3.18). */
  private async start(
    manager: EntityManager,
    definition: CronDefinition,
    scheduledAt: Date,
    attempt: number,
    now: number,
  ): Promise<void> {
    const placementRepo = manager.getRepository(WorkloadPlacementEntity);

    await manager.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK_PLACEMENT_ALLOCATION]);

    const placements = await placementRepo.find();
    const nodes = await manager
      .getRepository(NodeEntity)
      .find({ where: { lifecycle: Not('left') }, order: { name: 'ASC' } });
    const volumes = await manager.getRepository(VolumePlacementEntity).find();
    const perNode = new Map<string, number>();

    placements.forEach((p) => perNode.set(p.node, (perNode.get(p.node) ?? 0) + 1));

    const target = pickCronNode(
      definition.scheduler,
      toSchedulerNodes(plannerNodes(nodes, now)),
      perNode,
      new Map(volumes.map((v) => [v.id, v.primaryNode])),
    );

    if ('error' in target) {
      await this.record(manager, definition, scheduledAt, { state: 'failed', message: target.error }, attempt);
      this.logger.warn(`Cron job ${definition.id}: ${target.error}`);

      return;
    }

    const scheduleRepo = manager.getRepository(CronScheduleEntity);
    const schedule = await scheduleRepo.findOneOrFail({ where: { id: definition.id } });
    // Wraps long before the protocol's 9 digits; old runs with the same index are long gone by then.
    const sequence = (schedule.sequence % CRON_SEQUENCE_WRAP) + 1;
    const workload = `${definition.id}/${sequence}`;
    const podSubnets = new Map(
      nodes.map((n) => [n.name, [n.podSubnetV4, n.podSubnetV6].filter((s): s is string => !!s)]),
    );
    const addresses =
      allocateWorkloadAddresses(
        [{ service: definition.id, replica: workload, node: target.node }],
        podSubnets,
        new Map(),
        reservedAddresses(placements),
      ).get(workload) ?? [];

    await scheduleRepo.update({ id: definition.id }, { sequence });

    // Earlier finished runs of this job leave their nodes now; the history stays in `lw_cron_runs`.
    const finished = placements.filter((p) => p.cronRun && p.id.startsWith(`${definition.id}/`));
    const stillRunning = new Set(
      (await manager.getRepository(CronRunEntity).find({ where: { cron: definition.id, state: 'running' } })).map(
        (r) => r.id,
      ),
    );

    for (const p of finished.filter((x) => !stillRunning.has(x.cronRun as string)))
      await placementRepo.delete({ id: p.id });

    const run = await this.record(manager, definition, scheduledAt, { state: 'running' }, attempt, {
      workload,
      node: target.node,
      startedAt: new Date(now),
    });

    await placementRepo.save(
      placementRepo.create({
        id: workload,
        project: definition.project,
        deployment: definition.deployment,
        service: definition.service,
        node: target.node,
        addresses,
        targetNode: null,
        targetAddresses: [],
        migration: null,
        gate: null,
        releasedSpec: null,
        cronRun: run.id,
        specHash: null,
        status: null,
      }),
    );
  }

  private async record(
    manager: EntityManager,
    definition: CronDefinition,
    scheduledAt: Date,
    outcome: { state: CronRunState; message?: string },
    attempt = 0,
    extra: Partial<Pick<CronRunEntity, 'workload' | 'node' | 'startedAt'>> = {},
  ): Promise<CronRunEntity> {
    const repo = manager.getRepository(CronRunEntity);
    const done = outcome.state !== 'running';
    const run = await repo.save(
      repo.create({
        cron: definition.id,
        project: definition.project,
        scheduledAt,
        attempt,
        workload: extra.workload ?? null,
        node: extra.node ?? null,
        state: outcome.state,
        exitCode: null,
        message: outcome.message?.slice(0, 500) ?? null,
        startedAt: extra.startedAt ?? null,
        finishedAt: done ? new Date() : null,
      }),
    );

    if (outcome.state === 'failed') await this.recordFailure(manager, run);

    return run;
  }

  private async finish(
    manager: EntityManager,
    run: CronRunEntity,
    outcome: { state: CronRunState; exitCode?: number; message?: string },
    stop: boolean,
  ): Promise<void> {
    Object.assign(run, {
      state: outcome.state,
      exitCode: outcome.exitCode ?? null,
      message: outcome.message?.slice(0, 500) ?? null,
      finishedAt: new Date(),
    });
    await manager.getRepository(CronRunEntity).save(run);

    if (stop) await manager.getRepository(WorkloadPlacementEntity).delete({ cronRun: run.id });

    if (outcome.state !== 'succeeded' && outcome.state !== 'cancelled') await this.recordFailure(manager, run);
  }

  /** Failed runs are audited, which feeds alerting (3.18). */
  private async recordFailure(manager: EntityManager, run: CronRunEntity): Promise<void> {
    await this.audit.record(manager, {
      actor: { type: 'system' },
      action: 'cron.run-failed',
      target: `cron/${run.cron}`,
      project: run.project,
      details: {
        run: run.id,
        state: run.state,
        attempt: run.attempt,
        scheduledAt: run.scheduledAt.toISOString(),
        node: run.node,
        exitCode: run.exitCode,
        message: run.message,
      },
    });
  }

  /** Drops state of removed cron jobs, finished runs on nodes that stop taking work, and old history. */
  private async cleanUp(manager: EntityManager, definitions: ReadonlyMap<string, CronDefinition>): Promise<boolean> {
    const scheduleRepo = manager.getRepository(CronScheduleEntity);
    const placementRepo = manager.getRepository(WorkloadPlacementEntity);
    let changed = false;

    for (const stale of (await scheduleRepo.find()).filter((s) => !definitions.has(s.id)))
      await scheduleRepo.delete({ id: stale.id });

    const cronPlacements = await placementRepo.find({ where: { cronRun: Not(IsNull()) } });

    if (cronPlacements.length > 0) {
      const runs = await manager
        .getRepository(CronRunEntity)
        .find({ where: { id: In(cronPlacements.map((p) => p.cronRun as string)) } });
      const active = new Set(
        (await manager.getRepository(NodeEntity).find({ where: { lifecycle: 'active' } })).map((n) => n.name),
      );

      for (const p of cronPlacements) {
        const run = runs.find((r) => r.id === p.cronRun);
        const finished = !run || run.state !== 'running';

        // Finished runs must not block a drain or leave, nor outlive their cron job.
        if (finished && (!active.has(p.node) || !definitions.has(`${p.project}/${p.deployment}/${p.service}`))) {
          await placementRepo.delete({ id: p.id });
          changed = true;
        }
      }
    }

    await manager.query(
      `DELETE FROM lw_cron_runs r USING (
         SELECT id, row_number() OVER (PARTITION BY cron ORDER BY created_at DESC) AS n FROM lw_cron_runs WHERE state <> 'running'
       ) old WHERE r.id = old.id AND old.n > $1`,
      [CRON_RUN_HISTORY],
    );

    return changed;
  }

  /** Run history of one project's cron jobs, newest first. */
  async runs(project: string, cron?: string, limit = 100): Promise<CronRunEntity[]> {
    return await this.dataSource.getRepository(CronRunEntity).find({
      where: cron ? { project, cron } : { project },
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 500),
    });
  }
}
