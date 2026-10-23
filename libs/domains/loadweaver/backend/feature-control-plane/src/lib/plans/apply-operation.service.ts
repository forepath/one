import { clusterSpecSchema, type Resource, type ResourceKind } from '@forepath/loadweaver/shared/util-model';
import { randomUUID } from 'node:crypto';

import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, LessThan, IsNull } from 'typeorm';

import { NODE_HEARTBEAT_TIMEOUT_MS } from '../constants/control-plane.constants';
import { ClusterEntity } from '../entities/cluster.entity';
import { DeploymentStateEntity } from '../entities/deployment-state.entity';
import { NodeDesiredStateEntity } from '../entities/node-desired-state.entity';
import { NodeEntity } from '../entities/node.entity';
import { PlanEntity, type PlanProgress } from '../entities/plan.entity';
import { ResourceEntity } from '../entities/resource.entity';
import { PublicAddressService } from '../ipam/public-address.service';
import { AuditLogService } from '../services/audit-log.service';
import { NetworkStateService } from '../services/network-state.service';
import { ResourceStoreService } from '../services/resource-store.service';
import { WorkloadPlannerService } from '../services/workload-planner.service';
import { ProjectAccessService } from '../access/project-access.service';
import { LogsService } from '../logs/logs.service';
import { MetricsStore } from '../metrics/metrics.store';
import { LoadweaverNotificationPublisher } from '../notifications/loadweaver-notifications.module';
import { ChangeEventsService } from '../services/change-events.service';
import { nodeStates, summarize } from './apply-tracking.utils';
import { syncNode } from './node-sync';
import { ADDRESS_KINDS, NETWORK_KINDS, WORKLOAD_KINDS } from './plan-kinds';

const TICK_MS = 1_000;
const SWEEP_MS = 5_000;
/** A tracker that hasn't refreshed its heartbeat for this long is taken over by another replica. */
const TRACKER_STALE_MS = 30_000;
const ADVISORY_LOCK_PLAN_LOCKS = 0x4c570012;

function applyTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env['LOADWEAVER_APPLY_TIMEOUT_MS']);

  return Number.isFinite(raw) && raw >= 10_000 ? raw : 10 * 60_000;
}

export function initialProgress(phase: PlanProgress['phase'], baseRevision: number): PlanProgress {
  return {
    phase,
    baseRevision,
    targets: null,
    step: phase === 'apply' ? 'Applying: compiling' : 'Rolling back: compiling',
    percent: 0,
    startedAt: new Date().toISOString(),
    nodes: {},
  };
}

/** Locks are released when an apply or rollback finished; a failed rollback keeps them (3.19). */
export async function releaseLocks(manager: EntityManager, planId: string): Promise<void> {
  await manager.query('DELETE FROM "lw_resource_locks" WHERE "plan_id" = $1', [planId]);
}

/** Serializes lock changes across replicas. */
export async function lockTable(manager: EntityManager): Promise<void> {
  await manager.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK_PLAN_LOCKS]);
}

/**
 * Applies as tracked operations (3.8, 3.19): after the desired state is written, the network is compiled and every
 * connected node whose desired state moved has to report that revision; progress (step + %) is kept on the plan.
 * A failure, a timeout or a cancel rolls back to the previous resource versions the same way; if that fails too,
 * the plan stays `rollback-failed` with its locks, and a fix-forward plan is proposed. Any replica can continue a
 * tracker whose replica died.
 */
@Injectable()
export class ApplyOperationService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ApplyOperationService.name);
  private readonly running = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  /** This replica's identity as a tracker owner. */
  readonly owner = randomUUID();
  /** Set by the plans service: proposes the fix-forward plan for a failed rollback. */
  onRollbackFailed: ((plan: PlanEntity) => Promise<void>) | null = null;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly network: NetworkStateService,
    private readonly store: ResourceStoreService,
    private readonly planner: WorkloadPlannerService,
    private readonly publicAddresses: PublicAddressService,
    private readonly audit: AuditLogService,
    private readonly projectAccess: ProjectAccessService,
    private readonly logs: LogsService,
    private readonly metrics: MetricsStore,
    @Optional() private readonly notifications?: LoadweaverNotificationPublisher,
    @Optional() private readonly events?: ChangeEventsService,
  ) {}

  /** Apply events in the logs (3.14 control plane), labelled with the touched projects. */
  private event(plan: PlanEntity, level: 'info' | 'warn' | 'error', message: string): void {
    const projects = [...new Set(plan.changes.flatMap((c) => (c.project ? [c.project] : [])))];

    // A marker on every graph of the touched projects (3.18).
    for (const project of projects.length ? projects : [undefined])
      void this.metrics.event('plan', message, { entity: plan.id, ...(project ? { project } : {}) });

    void this.logs.write(
      (projects.length ? projects : [undefined]).map((project) => ({
        source: 'control-plane' as const,
        level,
        message,
        labels: { component: 'plans', ...(project ? { project } : {}) },
        fields: { plan: plan.id },
      })),
    );
  }

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.sweep().catch(() => undefined), SWEEP_MS);
  }

  onModuleDestroy(): void {
    this.stopped = true;

    if (this.timer) clearInterval(this.timer);
  }

  /** Continues trackers whose replica stopped refreshing them. */
  async sweep(): Promise<void> {
    const stale = await this.dataSource.getRepository(PlanEntity).find({
      where: [
        {
          status: In(['applying', 'rolling-back']),
          trackerHeartbeatAt: LessThan(new Date(Date.now() - TRACKER_STALE_MS)),
        },
        { status: In(['applying', 'rolling-back']), trackerHeartbeatAt: IsNull() },
      ],
    });

    for (const plan of stale) this.start(plan.id);
  }

  start(planId: string): void {
    if (this.running.has(planId)) return;

    this.running.add(planId);
    void this.track(planId)
      .catch((error: unknown) =>
        this.logger.error(`Tracking plan ${planId} failed: ${error instanceof Error ? error.message : String(error)}`),
      )
      .finally(() => this.running.delete(planId));
  }

  /** The plan once it settled, or as it is after `ms` (callers show the rest live). */
  async waitFor(planId: string, ms: number): Promise<PlanEntity> {
    const repo = this.dataSource.getRepository(PlanEntity);

    for (const end = Date.now() + ms; ; await new Promise((r) => setTimeout(r, 100))) {
      const plan = await repo.findOneOrFail({ where: { id: planId } });

      if (!['applying', 'rolling-back'].includes(plan.status) || Date.now() >= end) return plan;
    }
  }

  private async track(planId: string): Promise<void> {
    const repo = this.dataSource.getRepository(PlanEntity);

    while (!this.stopped) {
      const plan = await repo.findOne({ where: { id: planId } });

      if (!plan || !plan.progress || !['applying', 'rolling-back'].includes(plan.status)) return;

      // Claim (or keep) the tracker atomically: one replica at a time, a stale owner is replaced.
      const result: unknown = await this.dataSource.query(
        `UPDATE "lw_plans" SET "tracker_heartbeat_at" = now(), "tracker_owner" = $2
         WHERE "id" = $1 AND ("tracker_owner" = $2 OR "tracker_heartbeat_at" IS NULL
           OR "tracker_heartbeat_at" < now() - interval '${TRACKER_STALE_MS / 1000} seconds')
         RETURNING "id"`,
        [planId, this.owner],
      );
      const rows = Array.isArray(result) && Array.isArray(result[0]) ? (result[0] as unknown[]) : (result as unknown[]);

      if (rows.length === 0) return;

      if (await this.tick(plan)) return;

      await new Promise((r) => setTimeout(r, TICK_MS));
    }
  }

  /** One step; true when the plan reached a final state. */
  async tick(plan: PlanEntity): Promise<boolean> {
    const repo = this.dataSource.getRepository(PlanEntity);
    const progress = { ...(plan.progress as PlanProgress) };
    const touched = plan.changes.filter((c) => c.action !== 'unchanged');

    if (progress.targets === null) {
      if (touched.some((c) => NETWORK_KINDS.has(c.kind)) || Object.keys(plan.deploymentStates ?? {}).length > 0)
        await this.network.recompile();

      const moved = await this.dataSource
        .getRepository(NodeDesiredStateEntity)
        .createQueryBuilder('s')
        .where('s.revision > :base', { base: progress.baseRevision })
        .getMany();

      progress.targets = Object.fromEntries(moved.map((s) => [s.nodeName, s.revision]));
    }

    const now = Date.now();
    const names = Object.keys(progress.targets);
    const nodes =
      names.length > 0 ? await this.dataSource.getRepository(NodeEntity).find({ where: { name: In(names) } }) : [];

    progress.nodes = nodeStates(nodes, progress.targets, progress.nodes, now, NODE_HEARTBEAT_TIMEOUT_MS);

    // A cancel stops at the next safe point: here, between node reports (never inside an apply on a node).
    if (progress.phase === 'apply' && plan.cancelRequested && !progress.failure) progress.failure = 'cancelled';

    if (!progress.failure && now - new Date(progress.startedAt).getTime() > applyTimeoutMs())
      for (const [name, n] of Object.entries(progress.nodes))
        if (n.state === 'pending')
          progress.nodes[name] = { ...n, state: 'failed', error: 'no report within the apply timeout' };

    const summary = summarize(progress.phase, progress.nodes);
    const failure = progress.failure ?? summary.failure;

    progress.step = progress.failure === 'cancelled' ? 'Cancelled: rolling back' : summary.step;
    progress.percent = summary.percent;

    if (!summary.done && !progress.failure) {
      await repo.update({ id: plan.id }, { progress });

      return false;
    }

    progress.failure = failure;

    if (progress.phase === 'apply' && !failure) {
      await this.finish(plan, progress, 'applied');

      return true;
    }

    if (progress.phase === 'apply') {
      try {
        await this.rollBack(plan, progress, failure as string);
      } catch (error) {
        // Restoring the previous versions failed: the state is inconsistent, shown as such (3.19).
        const reason = `rollback could not be started: ${error instanceof Error ? error.message : String(error)}`;

        await this.finish(plan, { ...progress, phase: 'rollback', cause: failure, failure: reason }, 'rollback-failed');

        return true;
      }

      return false;
    }

    await this.finish(plan, progress, failure ? 'rollback-failed' : 'rolled-back');

    return true;
  }

  private async finish(
    plan: PlanEntity,
    progress: PlanProgress,
    status: 'applied' | 'rolled-back' | 'rollback-failed',
  ): Promise<void> {
    // A fix-forward that didn't get through: the original plan needs a new one.
    if (plan.resolves && status !== 'applied') {
      const original = await this.dataSource.getRepository(PlanEntity).findOne({ where: { id: plan.resolves } });

      if (original) await this.onRollbackFailed?.(original).catch(() => undefined);
    }

    // The fix-forward exists before anyone sees the plan as failed (3.19).
    if (status === 'rollback-failed' && !plan.resolves) {
      this.logger.error(`Plan ${plan.id}: rollback failed (${progress.failure}); resources stay locked`);
      await this.onRollbackFailed?.({ ...plan, status, progress }).catch((error: unknown) =>
        this.logger.error(
          `Fix-forward plan for ${plan.id} not created: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(PlanEntity).update(
        { id: plan.id },
        {
          status,
          progress: {
            ...progress,
            percent: 100,
            step: status === 'applied' ? 'Applied' : status === 'rolled-back' ? 'Rolled back' : 'Rollback failed',
          },
          ...(status === 'applied' ? { appliedAt: new Date() } : {}),
        },
      );

      await lockTable(manager);

      if (plan.resolves && status !== 'applied') {
        // A fix-forward that didn't get through: the original stays unresolved and gets its locks back.
        await manager.query('UPDATE "lw_resource_locks" SET "plan_id" = $1 WHERE "plan_id" = $2', [
          plan.resolves,
          plan.id,
        ]);
      } else if (status !== 'rollback-failed') {
        // A failed rollback keeps its locks: nothing may build on the inconsistent state until a fix-forward resolves it.
        await releaseLocks(manager, plan.id);
      }

      // The plan this one fixes forward is resolved now.
      if (status === 'applied' && plan.resolves)
        await manager
          .getRepository(PlanEntity)
          .update({ id: plan.resolves, status: 'rollback-failed' }, { status: 'failed' });

      this.event(
        plan,
        status === 'applied' ? 'info' : status === 'rolled-back' ? 'warn' : 'error',
        `plan ${plan.id} ${status}${progress.failure ? `: ${progress.failure}` : ''}`,
      );
      await this.audit.record(manager, {
        actor: { type: 'system', id: null },
        action: `plan.${status}`,
        target: `plan/${plan.id}`,
        details: {
          ...(progress.failure ? { failure: progress.failure } : {}),
          nodes: Object.fromEntries(Object.entries(progress.nodes).map(([n, s]) => [n, s.state])),
        },
      });
    });

    // Git commit statuses, write-back (3.29).
    this.events?.planStatus(plan.id, status);

    // Webhooks subscribed to plan outcomes (3.18 notifications).
    void this.notifications
      ?.publish(`plan.${status}`, {
        id: plan.id,
        status,
        projects: [...new Set(plan.changes.flatMap((c) => (c.project ? [c.project] : [])))],
        createdBy: plan.createdBy,
        ...(progress.failure ? { failure: progress.failure } : {}),
        ...(plan.resolves ? { resolves: plan.resolves } : {}),
      })
      .catch((error: unknown) => this.logger.warn(`Plan event not published: ${String(error)}`));
  }

  /** Restores the previous version of every touched resource (and the deployments' pinned images / secrets). */
  private async rollBack(plan: PlanEntity, progress: PlanProgress, failure: string): Promise<void> {
    const touched = plan.changes.filter((c) => c.action !== 'unchanged');

    await this.dataSource.transaction(async (manager) => {
      for (const change of touched) {
        if (!change.before) {
          await this.store.remove(manager, { kind: change.kind, name: change.name, project: change.project });

          if (change.kind === 'Project') await this.projectAccess.projectDeleted(manager, change.name);

          continue;
        }

        if (change.kind === 'Project' && change.action === 'delete')
          await this.projectAccess.projectCreated(manager, change.name, plan.createdBy);

        const body = change.before as {
          labels: Record<string, string>;
          annotations: Record<string, string>;
          spec: Record<string, unknown>;
        };

        await this.store.upsert(
          manager,
          {
            apiVersion: 'loadweaver.com/v1',
            kind: change.kind as ResourceKind,
            metadata: {
              name: change.name,
              ...(change.project ? { project: change.project } : {}),
              ...(Object.keys(body.labels ?? {}).length ? { labels: body.labels } : {}),
              ...(Object.keys(body.annotations ?? {}).length ? { annotations: body.annotations } : {}),
            },
            spec: body.spec,
          } as Resource,
          `rollback:${plan.id}`,
        );

        if (change.kind === 'Node') {
          const node = await this.store.get('Node', change.name, null);

          if (node) await syncNode(manager, node);
        }
      }

      const states = manager.getRepository(DeploymentStateEntity);

      for (const [id, previous] of Object.entries(plan.rollback?.deploymentStates ?? {})) {
        if (!previous) {
          await states.delete({ id });
          continue;
        }

        const current = await states.findOne({ where: { id } });

        // The inspections belong to the pinned images: restored with them (3.35).
        await states.save(
          states.create({
            id,
            ...previous,
            imageConfigs: previous.imageConfigs ?? {},
            generation: (current?.generation ?? 0) + 1,
          }),
        );
      }

      const resources = await manager.getRepository(ResourceEntity).find();

      if (
        touched.some((c) => WORKLOAD_KINDS.has(c.kind)) ||
        Object.keys(plan.rollback?.deploymentStates ?? {}).length > 0
      ) {
        const workload = await this.planner.plan(manager, resources);

        await this.planner.persist(
          manager,
          workload,
          clusterSpecSchema.parse(resources.find((r) => r.kind === 'Cluster')?.spec).network,
        );
      }

      if (touched.some((c) => ADDRESS_KINDS.has(c.kind))) await this.publicAddresses.persist(manager, resources);

      const cluster = await manager.getRepository(ClusterEntity).findOneOrFail({ where: {} });

      await manager.getRepository(PlanEntity).update(
        { id: plan.id },
        {
          status: 'rolling-back',
          error: failure.slice(0, 2000),
          progress: { ...initialProgress('rollback', cluster.desiredRevision), cause: failure },
        },
      );
      this.event(plan, 'warn', `plan ${plan.id} rolling back: ${failure}`);
      await this.audit.record(manager, {
        actor: { type: 'system', id: null },
        action: 'plan.rollback',
        target: `plan/${plan.id}`,
        details: { failure, nodes: Object.fromEntries(Object.entries(progress.nodes).map(([n, s]) => [n, s.state])) },
      });
    });
  }
}
