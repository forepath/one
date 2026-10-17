import { clusterSpecSchema } from '@forepath/loadweaver/shared/util-model';
import type { ScheduleResult } from '@forepath/loadweaver/shared/util-scheduler';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Not } from 'typeorm';

import { DeploymentStateEntity } from '../entities/deployment-state.entity';
import { MigrationEntity } from '../entities/migration.entity';
import { NodeEntity } from '../entities/node.entity';
import { ResourceEntity } from '../entities/resource.entity';
import { VolumePlacementEntity } from '../entities/volume-placement.entity';
import { WorkloadPlacementEntity } from '../entities/workload-placement.entity';
import { hasControlPlaneQuorum } from '../utils/control-plane-membership.utils';
import { toSchedulerServices, type ParsedDeployment } from '../utils/workload-planning.utils';
import {
  DEFAULT_MIGRATION_TIMEOUTS,
  sessionStep,
  waveReady,
  type MigrationTimeouts,
  type SessionPhase,
} from '../utils/migration-state.utils';
import { AuditLogService } from './audit-log.service';
import {
  beginAttempt,
  finishAttempt,
  isCheckpointMethod,
  migrationEvent,
  runningSpec,
  setPhase,
} from './migration-records';
import { NetworkStateService } from './network-state.service';
import { WorkloadPlannerService, type WorkloadPlan } from './workload-planner.service';

export const FAILOVER_AFTER_MS = 60_000;
export const MIGRATION_TIMEOUT_MS = 10 * 60_000;
const TICK_MS = 5_000;
const ADVISORY_LOCK_WORKLOAD_CONTROLLER = 0x4c570006;
const READY_STATES = new Set(['running', 'healthy']);

/** Keeps the current placement for every replica except `moving`; volumes only change where their owner moves. */
export function restrictSchedule(
  plan: WorkloadPlan,
  current: { replicas: { replica: string; node: string }[]; volumes: ScheduleResult['volumes'] },
  moving: ReadonlySet<string>,
): WorkloadPlan {
  const currentReplicas = new Map(current.replicas.map((r) => [r.replica, r.node]));
  const owners = new Map(
    toSchedulerServices(plan.parsed).flatMap((s) => s.volumes.map((v): [string, string] => [v.id, s.id])),
  );
  const movingServices = new Set(plan.schedule.replicas.filter((r) => moving.has(r.replica)).map((r) => r.service));
  const currentVolumes = new Map(current.volumes.map((v) => [v.volume, v]));

  return {
    ...plan,
    schedule: {
      ...plan.schedule,
      replicas: plan.schedule.replicas.map((r) =>
        moving.has(r.replica) || !currentReplicas.has(r.replica)
          ? r
          : { ...r, node: currentReplicas.get(r.replica) as string },
      ),
      volumes: plan.schedule.volumes.map((v) =>
        movingServices.has(owners.get(v.volume) ?? '') || !currentVolumes.has(v.volume)
          ? v
          : (currentVolumes.get(v.volume) as typeof v),
      ),
    },
  };
}

/**
 * Which replicas on lost nodes may move now (3.12): stateless always; stateful only with control-plane quorum or
 * an operator's confirmation, so a partitioned node and the failover target never write the same volume (3.2).
 */
export function failoverCandidates(
  placements: readonly { id: string; node: string }[],
  lost: ReadonlySet<string>,
  statefulServices: ReadonlySet<string>,
  quorum: boolean,
  confirmed: ReadonlySet<string>,
): { moving: Set<string>; waiting: string[] } {
  const moving = new Set<string>();
  const waiting: string[] = [];

  for (const p of placements.filter((x) => lost.has(x.node))) {
    const stateful = statefulServices.has(p.id.split('/').slice(0, 3).join('/'));

    if (!stateful || quorum || confirmed.has(p.node)) moving.add(p.id);
    else waiting.push(p.id);
  }

  return { moving, waiting };
}

/**
 * Runtime workload operations (3.10, 3.12), leader-elected across control-plane replicas:
 * progresses migrations from agent status, evacuates draining nodes and fails over replicas of lost nodes.
 * Stateful failover needs control-plane quorum (or an operator's confirmation) so a partitioned node and the
 * failover target never write the same volume.
 */
@Injectable()
export class WorkloadControllerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(WorkloadControllerService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private again = false;
  /** Per-phase limits of checkpoint attempts (3.10); tests shorten them. */
  timeouts: MigrationTimeouts = DEFAULT_MIGRATION_TIMEOUTS;

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
    if (this.running) {
      // Requested while a tick runs (e.g. migration progress arrived): run once more right after it.
      this.again = true;

      return;
    }

    this.running = true;

    try {
      do {
        this.again = false;
        await this.tick();
      } while (this.again);
    } catch (error) {
      this.logger.warn(`Workload controller: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }

  /** A tick soon, e.g. when an agent reported migration progress (sessions shouldn't wait for the next poll). */
  requestTick(): void {
    if (this.timer) void this.safeTick();
  }

  /** One reconcile pass; returns true if placements changed. */
  async tick(now = Date.now()): Promise<boolean> {
    const changed = await this.dataSource.transaction(async (manager) => {
      const [{ locked }] = await manager.query('SELECT pg_try_advisory_xact_lock($1) AS locked', [
        ADVISORY_LOCK_WORKLOAD_CONTROLLER,
      ]);

      if (!locked) return false;

      const migrated = await this.progressMigrations(manager, now);
      const failedOver = await this.failover(manager, now);
      const evacuated = await this.evacuate(manager);
      const released = await this.releaseGates(manager);

      return migrated || failedOver || evacuated || released;
    });

    if (changed) this.network.requestRecompile('workload controller');

    return changed;
  }

  private async volumesOf(manager: EntityManager, service: string): Promise<VolumePlacementEntity[]> {
    const resources = await manager
      .getRepository(ResourceEntity)
      .find({ where: [{ kind: 'Project' }, { kind: 'Deployment' }] });
    const ids = toSchedulerServices(this.planner.parse(resources).parsed)
      .filter((s) => s.id === service)
      .flatMap((s) => s.volumes.map((v) => v.id));

    return ids.length
      ? await manager.getRepository(VolumePlacementEntity).find({ where: ids.map((id) => ({ id })) })
      : [];
  }

  private async lostNodes(manager: EntityManager, now: number): Promise<Set<string>> {
    const nodes = await manager.getRepository(NodeEntity).find({ where: { lifecycle: Not('left') } });

    return new Set(
      nodes
        .filter((n) => !n.witness && now - (n.lastSeenAt ?? n.joinedAt).getTime() > FAILOVER_AFTER_MS)
        .map((n) => n.name),
    );
  }

  private async progressMigrations(manager: EntityManager, now: number): Promise<boolean> {
    const repo = manager.getRepository(WorkloadPlacementEntity);
    const all = await repo.find();
    const migrating = all.filter((p) => p.migration && p.targetNode);
    const lost = await this.lostNodes(manager, now);
    let parsed: ParsedDeployment[] | null = null;
    const deployments = async () =>
      (parsed ??= this.planner.parse(
        await manager.getRepository(ResourceEntity).find({ where: [{ kind: 'Project' }, { kind: 'Deployment' }] }),
      ).parsed);
    let changed = false;

    for (const p of migrating) {
      const migration = p.migration as NonNullable<WorkloadPlacementEntity['migration']>;

      if (migration.phase === 'queued') {
        changed = (await this.startQueued(manager, p, all, now, deployments)) || changed;
        continue;
      }

      if (isCheckpointMethod(migration.method)) {
        changed = (await this.progressCheckpoint(manager, p, now, lost, deployments)) || changed;
        continue;
      }

      const target = p.targetNode as string;
      const startedAt = Date.parse(migration.startedAt);
      const fresh = (node: string) => {
        const s = p.status?.[node];

        return s && Date.parse(s.at) > startedAt ? s : undefined;
      };
      const service = p.id.split('/').slice(0, 3).join('/');
      let done = false;

      if (migration.method === 'blue-green') done = READY_STATES.has(fresh(target)?.state ?? '');
      else done = fresh(p.node)?.state === 'absent';

      if (done) {
        if (migration.method === 'short-stop') {
          for (const volume of await this.volumesOf(manager, service)) {
            if (!volume.pendingPrimary) continue;

            const oldPrimary = volume.primaryNode;

            volume.primaryNode = volume.pendingPrimary;
            volume.syncReplicas = [
              ...new Set([...volume.syncReplicas.filter((n) => n !== volume.pendingPrimary), oldPrimary]),
            ];
            volume.pendingPrimary = null;
            await manager.getRepository(VolumePlacementEntity).save(volume);
          }
        }

        await this.audit.record(manager, {
          actor: { type: 'system' },
          action: 'workload.migrated',
          target: `workload/${p.id}`,
          project: p.project,
          details: { from: p.node, to: target, method: migration.method, reason: migration.reason },
        });
        await finishAttempt(manager, migration.id, 'done', new Date(now));
        await migrationEvent(manager, p.id, p.project, `${p.id}: moved ${p.node} → ${target} (${migration.method})`, {
          migration: migration.id,
          method: migration.method,
          from: p.node,
          to: target,
        });
        Object.assign(p, {
          node: target,
          addresses: p.targetAddresses,
          targetNode: null,
          targetAddresses: [],
          migration: null,
          restored: null,
          status: p.status?.[target] ? { [target]: p.status[target] } : null,
        });
        await repo.save(p);
        changed = true;
      } else if (now - startedAt > MIGRATION_TIMEOUT_MS) {
        // Give up and keep the replica where it is; nothing was cut over yet (3.19: failures roll back).
        if (migration.method === 'short-stop') {
          for (const volume of await this.volumesOf(manager, service)) {
            if (volume.pendingPrimary) {
              volume.pendingPrimary = null;
              await manager.getRepository(VolumePlacementEntity).save(volume);
            }
          }
        }

        await this.audit.record(manager, {
          actor: { type: 'system' },
          action: 'workload.migration-failed',
          target: `workload/${p.id}`,
          project: p.project,
          details: { from: p.node, to: target, method: migration.method },
        });
        await finishAttempt(manager, migration.id, 'failed', new Date(now), { fallbackReason: 'timed out' });
        Object.assign(p, { targetNode: null, targetAddresses: [], migration: null });
        await repo.save(p);
        changed = true;
      }
    }

    return (await this.progressCutovers(manager, now, lost)) || changed;
  }

  /** Clears a placement's migration: it stays where it runs. */
  private async abandon(manager: EntityManager, p: WorkloadPlacementEntity, details: Record<string, unknown>) {
    await this.audit.record(manager, {
      actor: { type: 'system' },
      action: 'workload.migration-failed',
      target: `workload/${p.id}`,
      project: p.project,
      details: { from: p.node, to: p.targetNode, method: p.migration?.method, ...details },
    });
    Object.assign(p, { targetNode: null, targetAddresses: [], migration: null });
    await manager.getRepository(WorkloadPlacementEntity).save(p);
  }

  /**
   * A migration waiting for its dependency wave (3.10) starts once the replicas it waits for have moved and run;
   * a checkpoint method without a running spec on the source falls back right away.
   */
  private async startQueued(
    manager: EntityManager,
    p: WorkloadPlacementEntity,
    all: readonly WorkloadPlacementEntity[],
    now: number,
    deployments: () => Promise<ParsedDeployment[]>,
  ): Promise<boolean> {
    const migration = p.migration as NonNullable<WorkloadPlacementEntity['migration']>;

    if (now - Date.parse(migration.startedAt) > MIGRATION_TIMEOUT_MS) {
      await this.abandon(manager, p, { reason: 'the previous wave did not finish' });

      return true;
    }

    if (!waveReady(migration.after ?? [], all)) return false;

    const service = p.id.split('/').slice(0, 3).join('/');
    const volumes = this.planner.serviceVolumes(await deployments(), service);
    let spec = null;

    if (isCheckpointMethod(migration.method)) {
      spec = await runningSpec(manager, p.node, p.id);

      if (!spec) {
        const method = volumes.length > 0 ? 'short-stop' : 'blue-green';

        p.migration = {
          ...migration,
          method,
          label: `${method} (nothing running on the source yet)`,
          runtime: undefined,
        };
        p.targetAddresses = await this.planner.allocateOn(manager, p.id, service, p.targetNode as string);
      }
    }

    await beginAttempt(manager, p, { volumes, spec, now: new Date(now) });
    await manager.getRepository(WorkloadPlacementEntity).save(p);

    return true;
  }

  /** Volume roles around a checkpoint (3.10): forward when the target restores, back when the attempt aborts. */
  private async moveVolumePrimary(
    manager: EntityManager,
    ids: readonly string[],
    from: string,
    to: string,
    pending: string | null,
  ) {
    const repo = manager.getRepository(VolumePlacementEntity);

    for (const id of ids) {
      const volume = await repo.findOne({ where: { id } });

      if (!volume) continue;

      volume.primaryNode = to;
      volume.syncReplicas = [...new Set([...volume.syncReplicas.filter((n) => n !== to), from])];
      volume.pendingPrimary = pending;
      await repo.save(volume);
    }
  }

  /**
   * One step of a live / stop-and-copy attempt (3.10): phases advance on the nodes' reports; any failure or timeout
   * aborts (the target discards, the source resumes, never killed before the target runs) and falls back to the
   * short-stop / blue-green path; a restored replica is cut over.
   */
  private async progressCheckpoint(
    manager: EntityManager,
    p: WorkloadPlacementEntity,
    now: number,
    lost: ReadonlySet<string>,
    deployments: () => Promise<ParsedDeployment[]>,
  ): Promise<boolean> {
    const migration = p.migration as NonNullable<WorkloadPlacementEntity['migration']>;
    const row = migration.id
      ? await manager.getRepository(MigrationEntity).findOne({ where: { id: migration.id } })
      : null;
    const at = new Date(now);

    if (!row || row.finishedAt) {
      await this.abandon(manager, p, { reason: 'migration record missing' });

      return true;
    }

    // The source is gone: nothing to resume; the failover takes over the replica.
    if (lost.has(p.node)) {
      await finishAttempt(manager, row.id, 'failed', at, { fallbackReason: 'source node lost', reports: row.reports });
      await this.abandon(manager, p, { reason: 'source node lost', migration: row.id });

      return true;
    }

    const decision = sessionStep(
      {
        method: row.method as 'live' | 'stop-and-copy',
        phase: row.phase as SessionPhase,
        phaseStartedAt: row.phaseStartedAt.getTime(),
        reports: row.reports,
        restoreSent: row.restoreSent,
        targetLost: lost.has(row.toNode),
      },
      now,
      this.timeouts,
    );

    switch (decision.kind) {
      case 'wait':
        return false;
      case 'phase': {
        // The source is frozen, dumped and has demoted its volumes: the target promotes them for the restore.
        if (decision.phase === 'restore') await this.moveVolumePrimary(manager, row.volumes, p.node, row.toNode, null);

        await setPhase(manager, row.id, decision.phase, at, decision.phase === 'restore' ? { restoreSent: true } : {});
        p.migration = { ...migration, phase: decision.phase };
        await manager.getRepository(WorkloadPlacementEntity).save(p);

        return decision.phase === 'restore' && row.volumes.length > 0;
      }
      case 'cutover': {
        const from = p.node;

        await setPhase(manager, row.id, 'cutover', at);
        await this.audit.record(manager, {
          actor: { type: 'system' },
          action: 'workload.migrated',
          target: `workload/${p.id}`,
          project: p.project,
          details: { from, to: row.toNode, method: row.method, reason: migration.reason, migration: row.id },
        });
        await migrationEvent(
          manager,
          p.id,
          p.project,
          `${p.id}: ${row.method} migration ${from} → ${row.toNode} cut over`,
          {
            migration: row.id,
            method: row.method,
            from,
            to: row.toNode,
          },
        );
        // Same addresses (kept), now routed to the target as host routes; agent-managed until its next restart.
        Object.assign(p, {
          node: row.toNode,
          targetNode: null,
          targetAddresses: [],
          migration: null,
          restored: { migration: row.id, runtime: row.runtime ?? 'runc' },
          status: p.status?.[row.toNode] ? { [row.toNode]: p.status[row.toNode] } : null,
        });
        await manager.getRepository(WorkloadPlacementEntity).save(p);

        return true;
      }
      case 'abort':
        await setPhase(manager, row.id, 'aborting', at, { fallbackReason: decision.reason.slice(0, 2048) });
        p.migration = { ...migration, phase: 'aborting' };
        await manager.getRepository(WorkloadPlacementEntity).save(p);
        await this.audit.record(manager, {
          actor: { type: 'system' },
          action: 'workload.migration-aborted',
          target: `workload/${p.id}`,
          project: p.project,
          details: { from: p.node, to: row.toNode, method: row.method, reason: decision.reason, migration: row.id },
        });
        await migrationEvent(manager, p.id, p.project, `${p.id}: ${row.method} migration aborted: ${decision.reason}`, {
          migration: row.id,
          reason: decision.reason,
        });

        return false;
      case 'fallback':
        await this.fallback(manager, p, row, now, decision.resumed, lost, deployments);

        return true;
      default:
        return false;
    }
  }

  /** After an aborted checkpoint attempt: the short-stop (stateful) or blue / green (stateless) path takes over. */
  private async fallback(
    manager: EntityManager,
    p: WorkloadPlacementEntity,
    row: MigrationEntity,
    now: number,
    resumed: boolean,
    lost: ReadonlySet<string>,
    deployments: () => Promise<ParsedDeployment[]>,
  ): Promise<void> {
    const migration = p.migration as NonNullable<WorkloadPlacementEntity['migration']>;
    const service = p.id.split('/').slice(0, 3).join('/');
    const volumes = this.planner.serviceVolumes(await deployments(), service);
    const stateful = volumes.length > 0;
    const reason = row.fallbackReason ?? 'aborted';
    const at = new Date(now);

    await finishAttempt(manager, row.id, 'fallback', at, { fallbackReason: reason, reports: row.reports });

    // The volumes went to the target for the restore: back to the source, pending for the short stop.
    if (row.restoreSent && row.volumes.length > 0)
      await this.moveVolumePrimary(manager, row.volumes, row.toNode, p.node, row.toNode);

    await this.audit.record(manager, {
      actor: { type: 'system' },
      action: 'workload.migration-fallback',
      target: `workload/${p.id}`,
      project: p.project,
      details: { from: p.node, to: row.toNode, method: row.method, reason, resumed, migration: row.id },
    });

    if (lost.has(row.toNode)) {
      await this.abandon(manager, p, { reason: 'target node lost', migration: row.id });

      return;
    }

    const method = stateful ? 'short-stop' : 'blue-green';

    p.targetAddresses = await this.planner.allocateOn(manager, p.id, service, row.toNode);
    p.migration = {
      method,
      phase: stateful ? 'stopping' : 'starting',
      reason: migration.reason,
      startedAt: at.toISOString(),
      label: `${method} (fallback: ${reason})`.slice(0, 512),
      id: row.id,
      attempt: row.attempt,
    };
    await beginAttempt(manager, p, { volumes, spec: null, now: at });
    await manager.getRepository(WorkloadPlacementEntity).save(p);
  }

  /** Cut-over attempts end once both nodes confirmed the commit (or the commit timed out; best effort). */
  private async progressCutovers(manager: EntityManager, now: number, lost: ReadonlySet<string>): Promise<boolean> {
    const rows = await manager
      .getRepository(MigrationEntity)
      .find({ where: { phase: 'cutover', finishedAt: IsNull() } });

    for (const row of rows) {
      const decision = sessionStep(
        {
          method: row.method as 'live' | 'stop-and-copy',
          phase: 'cutover',
          phaseStartedAt: row.phaseStartedAt.getTime(),
          reports: row.reports,
          restoreSent: row.restoreSent,
          targetLost: lost.has(row.toNode),
        },
        now,
        this.timeouts,
      );

      if (decision.kind !== 'done') continue;

      await finishAttempt(manager, row.id, 'done', new Date(now), { reports: row.reports });
      await migrationEvent(manager, row.replica, row.project, `${row.replica}: ${row.method} migration done`, {
        migration: row.id,
        method: row.method,
      });
    }

    return false;
  }

  private async failover(manager: EntityManager, now: number): Promise<boolean> {
    const nodes = await manager.getRepository(NodeEntity).find({ where: { lifecycle: Not('left') } });
    const lost = new Set(
      nodes
        .filter((n) => !n.witness && now - (n.lastSeenAt ?? n.joinedAt).getTime() > FAILOVER_AFTER_MS)
        .map((n) => n.name),
    );

    if (lost.size === 0) return false;

    // Cron runs on lost nodes are handled (and retried) by the cron controller.
    const placements = await manager.getRepository(WorkloadPlacementEntity).find({ where: { cronRun: IsNull() } });
    // Draining replicas are already removed (they stop when their drain ends).
    const affected = placements.filter(
      (p) => !p.drainUntil && (lost.has(p.node) || (p.targetNode && lost.has(p.targetNode))),
    );

    if (affected.length === 0) return false;

    // Migrations towards a lost node are abandoned; the replica stays where it runs. A checkpoint attempt in flight
    // aborts first (its source may be frozen): `progressCheckpoint` resumes the source and ends it.
    for (const p of affected.filter(
      (x) =>
        x.targetNode &&
        lost.has(x.targetNode) &&
        !(isCheckpointMethod(x.migration?.method) && x.migration?.phase !== 'queued'),
    )) {
      await finishAttempt(manager, p.migration?.id, 'cancelled', new Date(now), { fallbackReason: 'target node lost' });
      Object.assign(p, { targetNode: null, targetAddresses: [], migration: null });
      await manager.getRepository(WorkloadPlacementEntity).save(p);
    }

    const resources = await manager.getRepository(ResourceEntity).find();
    const clusterSpec = clusterSpecSchema.parse(resources.find((r) => r.kind === 'Cluster')?.spec);
    // A strict majority of the current voters is still reachable (3.2).
    const quorum = hasControlPlaneQuorum(nodes, new Set(nodes.filter((n) => !lost.has(n.name)).map((n) => n.name)));
    const plan = await this.planner.plan(manager, resources);
    const confirmed = new Set(nodes.filter((n) => n.lostConfirmedAt).map((n) => n.name));
    const { moving, waiting } = failoverCandidates(affected, lost, plan.statefulServices, quorum, confirmed);

    waiting.forEach((id) =>
      this.logger.warn(`Stateful ${id} waits for quorum or an operator confirming that its node is lost`),
    );

    if (moving.size === 0) return false;

    const restricted = restrictSchedule(plan, await this.planner.current(manager), moving);

    await this.planner.persist(manager, restricted, clusterSpec.network, 'failover');
    await this.audit.record(manager, {
      actor: { type: 'system' },
      action: 'workload.failover',
      target: `nodes/${[...lost].join(',')}`,
      details: { replicas: [...moving] },
    });

    return true;
  }

  /**
   * Lifts job gates (3.23): services get their new spec once the `before` jobs of the current generation exited
   * successfully; `after` jobs start once every service of the deployment runs. Failed jobs keep the gates.
   */
  private async releaseGates(manager: EntityManager): Promise<boolean> {
    const repo = manager.getRepository(WorkloadPlacementEntity);
    const gated = await repo.find({ where: [{ gate: 'before-jobs' }, { gate: 'after-services' }] });
    let changed = false;

    const resources = gated.length
      ? await manager.getRepository(ResourceEntity).find({ where: [{ kind: 'Project' }, { kind: 'Deployment' }] })
      : [];
    const parsedById = new Map(this.planner.parse(resources).parsed.map((d) => [`${d.project}/${d.name}`, d]));

    for (const deploymentId of new Set(gated.map((p) => `${p.project}/${p.deployment}`))) {
      const [project, deployment] = deploymentId.split('/');
      const all = await repo.find({ where: { project, deployment } });
      const state = await manager.getRepository(DeploymentStateEntity).findOne({ where: { id: deploymentId } });
      const appliedAt = state?.updatedAt.getTime() ?? 0;
      const current = (p: WorkloadPlacementEntity) => {
        const status = p.status?.[p.node];

        return status && Date.parse(status.at) >= appliedAt ? status : undefined;
      };
      const parsed = parsedById.get(deploymentId);
      const kindOf = (p: WorkloadPlacementEntity) => parsed?.compose.services.find((svc) => svc.name === p.service);
      const jobs = all.filter((p) => kindOf(p)?.kind === 'job' && kindOf(p)?.jobPhase !== 'after');
      const services = all.filter((p) => kindOf(p)?.kind === 'service');

      if (!parsed) continue;

      if (all.some((p) => p.gate === 'before-jobs') && jobs.every((j) => current(j)?.state === 'exited')) {
        for (const p of all.filter((x) => x.gate === 'before-jobs')) await repo.update({ id: p.id }, { gate: null });

        changed = true;
      } else if (
        !all.some((p) => p.gate === 'before-jobs') &&
        all.some((p) => p.gate === 'after-services') &&
        services.every((x) => ['running', 'healthy'].includes(current(x)?.state ?? ''))
      ) {
        for (const p of all.filter((x) => x.gate === 'after-services')) await repo.update({ id: p.id }, { gate: null });

        changed = true;
      }
    }

    return changed;
  }

  private async evacuate(manager: EntityManager): Promise<boolean> {
    const draining = new Set(
      (await manager.getRepository(NodeEntity).find({ where: { lifecycle: 'draining' } })).map((n) => n.name),
    );

    if (draining.size === 0) return false;

    // A running cron run finishes on the draining node; the cron controller places no new runs there.
    const placements = await manager.getRepository(WorkloadPlacementEntity).find({ where: { cronRun: IsNull() } });
    const moving = new Set(
      placements.filter((p) => draining.has(p.node) && !p.migration && !p.drainUntil).map((p) => p.id),
    );
    const volumes = await manager.getRepository(VolumePlacementEntity).find();
    const volumesOnNode = volumes.some(
      (v) => !v.pendingPrimary && [...v.syncReplicas, ...v.remoteReplicas].some((n) => draining.has(n)),
    );

    if (moving.size === 0 && !volumesOnNode) return false;

    const resources = await manager.getRepository(ResourceEntity).find();
    const plan = await this.planner.plan(manager, resources);

    if (plan.schedule.unschedulable.length > 0) {
      // Not enough capacity elsewhere: the operator decides what to keep (3.2); nothing is dropped automatically.
      this.logger.warn(
        `Drain blocked: ${plan.schedule.unschedulable.map((u) => u.replica ?? u.service).join(', ')} cannot be placed elsewhere`,
      );

      return false;
    }

    const clusterSpec = clusterSpecSchema.parse(resources.find((r) => r.kind === 'Cluster')?.spec);
    const current = await this.planner.current(manager);
    const restricted = restrictSchedule(plan, current, moving);
    // Volume replicas move off draining nodes even when their workload stays (re-replication, 3.12).
    restricted.schedule.volumes = plan.schedule.volumes.map((v) =>
      volumes.some((x) => x.id === v.volume && x.pendingPrimary)
        ? (current.volumes.find((c) => c.volume === v.volume) ?? v)
        : v,
    );

    await this.planner.persist(manager, restricted, clusterSpec.network, 'drain');
    await this.audit.record(manager, {
      actor: { type: 'system' },
      action: 'workload.evacuate',
      target: `nodes/${[...draining].join(',')}`,
      details: { replicas: [...moving] },
    });

    return true;
  }
}
