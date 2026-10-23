import { randomUUID } from 'node:crypto';

import { imageComponents, type BinaryComponent, type ReleaseManifest } from '@forepath/loadweaver/shared/util-release';
import { maintenanceWindowSpecSchema } from '@forepath/loadweaver/shared/util-model';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, Not, Raw } from 'typeorm';

import { NODE_HEARTBEAT_TIMEOUT_MS } from '../constants/control-plane.constants';
import { NodeEntity } from '../entities/node.entity';
import { ResourceEntity } from '../entities/resource.entity';
import { WorkloadPlacementEntity } from '../entities/workload-placement.entity';
import { healthTree } from '../health/health-tree.utils';
import { HealthService } from '../health/health.service';
import { SloService } from '../health/slo.service';
import { LoadweaverNotificationPublisher } from '../notifications/loadweaver-notifications.module';
import { AuditLogService } from '../services/audit-log.service';
import { NetworkStateService } from '../services/network-state.service';
import { NodesService } from '../services/nodes.service';
import { nodeAddress } from '../services/object-store-controller.service';
import { ContractMigrationService } from './contract-migration.service';
import { nodeWindowState, type NamedWindow } from './maintenance-window.utils';
import { ReleaseEntity } from './release.entity';
import { ACTIVE_ROLLOUT_STATUSES, RolloutEntity, RolloutStepEntity, type StepTarget } from './rollout.entity';
import { evaluateGates, gateBaseline, type GateInput } from './rollout-gates.utils';
import { kvmInUse } from './rollout-planner.utils';
import {
  advanceStep,
  startRollback,
  switchoverDecision,
  type StepAdvance,
  type StepEffect,
} from './rollout-state.utils';

const TICK_MS = 5_000;
/** A controller lease lives this long without renewal; a replica that died (or replaced itself) loses it. */
export const ROLLOUT_LEASE_SECONDS = 30;
const DRAIN_TIMEOUT_MS = 30 * 60_000;
const SYSTEM = { type: 'system' as const, id: 'update-rollout' };

function terminal(state: string): boolean {
  return state === 'done' || state === 'skipped';
}

/** Another replica took the rollout's lease over: this pass stops without writing anything more. */
class LeaseLostError extends Error {
  constructor() {
    super('the rollout lease moved to another control-plane replica');
  }
}

interface ReleaseInfo {
  agentVersion: string | null;
  /** Image digests by component. */
  images: Record<string, string>;
}

/**
 * Runs approved update plans (3.26). One replica at a time holds the rollout's lease (renewed every tick, taken over
 * when it expires — also when the leader's own control-plane member was just updated and its process replaced).
 * Every decision is derived from the steps stored in the database (`advanceStep`), so a new leader resumes exactly
 * where the previous one stopped. Waves run in order; a failing step pauses the rollout and rolls that step back.
 */
@Injectable()
export class RolloutControllerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RolloutControllerService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  /** This replica's identity as a lease owner. */
  readonly owner = randomUUID();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly network: NetworkStateService,
    private readonly nodes: NodesService,
    private readonly health: HealthService,
    private readonly slos: SloService,
    private readonly audit: AuditLogService,
    private readonly contracts: ContractMigrationService,
    @Optional() private readonly notifications?: LoadweaverNotificationPublisher,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env['LOADWEAVER_ROLLOUT_CONTROLLER'] === 'off') return;

    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass over the active rollout (if this replica holds or takes its lease); returns its status afterwards. */
  async tick(now = Date.now()): Promise<string | null> {
    if (this.running) return null;

    this.running = true;

    try {
      const active = await this.dataSource
        .getRepository(RolloutEntity)
        .findOne({ where: { status: In([...ACTIVE_ROLLOUT_STATUSES]) } });

      if (!active || !(await this.claim(active.id))) return active?.status ?? null;

      return await this.drive(active.id, now);
    } catch (error) {
      if (error instanceof LeaseLostError) {
        this.logger.warn(`Rollout tick stopped: ${error.message}`);

        return null;
      }

      this.logger.warn(`Rollout tick: ${error instanceof Error ? error.message : String(error)}`);

      return null;
    } finally {
      this.running = false;
    }
  }

  /** Takes or renews the lease; false when another live replica holds it. */
  async claim(id: string): Promise<boolean> {
    const result: unknown = await this.dataSource.query(
      `UPDATE lw_rollouts SET lease_owner = $2, lease_until = now() + interval '${ROLLOUT_LEASE_SECONDS} seconds'
       WHERE id = $1 AND (lease_owner = $2 OR lease_owner IS NULL OR lease_until < now()) RETURNING id`,
      [id, this.owner],
    );
    const rows = Array.isArray(result) && Array.isArray(result[0]) ? (result[0] as unknown[]) : (result as unknown[]);

    return rows.length > 0;
  }

  /** Rollout rows this replica may still write: it holds the lease and the lease is alive (M6 review L3). */
  private leased(id: string) {
    return { id, leaseOwner: this.owner, leaseUntil: Raw((alias) => `${alias} > now()`) };
  }

  /** Renews the lease before the next decision; aborts the pass when another replica holds it now. */
  private async renew(id: string): Promise<void> {
    if (!(await this.claim(id))) throw new LeaseLostError();
  }

  private async drive(id: string, now: number): Promise<string> {
    const repo = this.dataSource.getRepository(RolloutEntity);
    let rollout = await repo.findOneOrFail({ where: { id } });

    if (rollout.status === 'approved') {
      const started = await repo.update(this.leased(id), { status: 'running', startedAt: new Date(now) });

      if (started.affected === 0) throw new LeaseLostError();

      rollout = { ...rollout, status: 'running', startedAt: new Date(now) };
      this.logger.log(`Update ${id} to ${rollout.toVersion} started`);
    }

    const steps = await this.dataSource
      .getRepository(RolloutStepEntity)
      .find({ where: { rolloutId: id }, order: { index: 'ASC' } });
    const ctx = await this.context(now);

    if (rollout.status === 'rolling-back') return await this.driveRollback(rollout, steps, ctx, now);

    // Every step of the lowest unfinished wave; steps already moving keep moving while paused.
    const open = steps.filter((s) => !terminal(s.state));

    if (open.length === 0) return await this.complete(rollout, now);

    if (steps.some((s) => s.state === 'rollback-failed')) return await this.finish(rollout, 'rollback-failed', now);

    const wave = Math.min(...open.map((s) => s.wave));

    for (const step of open.filter((s) => s.wave === wave)) {
      await this.renew(id);

      const fresh = await repo.findOneOrFail({ where: { id } });

      await this.advance(fresh, step, steps, ctx, now);
    }

    const after = await repo.findOneOrFail({ where: { id } });

    return after.status;
  }

  private async context(now: number) {
    const nodes = await this.dataSource.getRepository(NodeEntity).find({ where: { lifecycle: Not('left') } });
    const tree = healthTree(await this.health.snapshot(now));
    const slos = (await this.slos.all(now).catch(() => [])).map((s) => ({
      key: `${s.project}/${s.deployment}/${s.service}`,
      state: s.state,
    }));
    const windows: NamedWindow[] = (
      await this.dataSource.getRepository(ResourceEntity).find({ where: { kind: 'MaintenanceWindow' } })
    ).flatMap((r) => {
      const parsed = maintenanceWindowSpecSchema.safeParse(r.spec);

      return parsed.success ? [{ name: r.name, spec: parsed.data }] : [];
    });
    const busy = new Set(
      (await this.dataSource.getRepository(WorkloadPlacementEntity).find({ select: { node: true, targetNode: true } }))
        .flatMap((p) => [p.node, p.targetNode])
        .filter((n): n is string => !!n),
    );

    // Which revision of each node's desired state carries which release (the apply gate, M6 review H1).
    const desired = new Map(
      (
        (await this.dataSource.query(
          `SELECT node_name AS node, revision, state->'components'->>'release' AS release FROM lw_node_desired_states`,
        )) as { node: string; revision: number; release: string | null }[]
      ).map((r) => [r.node, { revision: Number(r.revision), release: r.release }]),
    );

    return { nodes, tree, slos, windows, busy, desired, releases: new Map<string, ReleaseInfo>() };
  }

  private async releaseInfo(
    release: string | null,
    ctx: Awaited<ReturnType<RolloutControllerService['context']>>,
  ): Promise<ReleaseInfo | null> {
    if (!release) return null;

    const cached = ctx.releases.get(release);

    if (cached) return cached;

    const row = await this.dataSource.getRepository(ReleaseEntity).findOne({ where: { version: release } });
    const manifest = (row?.manifest as unknown as ReleaseManifest | null) ?? null;
    const agent = manifest?.components['node-agent'] as BinaryComponent | undefined;
    const info: ReleaseInfo = {
      agentVersion: agent?.version ?? null,
      images: manifest
        ? Object.fromEntries(Object.entries(imageComponents(manifest)).map(([name, c]) => [name, c.digest]))
        : {},
    };

    ctx.releases.set(release, info);

    return info;
  }

  private gateInput(
    step: RolloutStepEntity,
    node: NodeEntity | undefined,
    ctx: Awaited<ReturnType<RolloutControllerService['context']>>,
    now: number,
    release: string | null,
    info: ReleaseInfo | null,
  ): GateInput {
    const desired = ctx.desired.get(step.node);

    return {
      now,
      heartbeatTimeoutMs: NODE_HEARTBEAT_TIMEOUT_MS,
      step: {
        node: step.node,
        kind: step.kind,
        release,
        agentVersion: info?.agentVersion ?? null,
        // The agent names its actions by step id (host updates, switchovers) or by release (self-update, images).
        actionIds: [
          step.target.host?.id,
          step.data.switchoverId,
          ...(release ? [`self-update:${release}`, `images:${release}`] : []),
        ].filter((x): x is string => !!x),
        ...(step.data.rebootToken && step.data.bootId ? { bootIdBefore: step.data.bootId } : {}),
        baseline: step.data.baseline ?? { unhealthy: [], burning: [] },
        member: !!node?.controlPlane,
        witness: !!node?.witness,
        startedAt: step.startedAt?.getTime() ?? null,
        ...(release ? { revision: desired && desired.release === release ? desired.revision : null } : {}),
        ...(info && Object.keys(info.images).length ? { images: info.images } : {}),
        ...(step.data.kvmBefore ? { kvmBefore: true } : {}),
      },
      node: {
        connected: !!node?.connected,
        lastSeenAt: node?.lastSeenAt?.getTime() ?? null,
        agentVersion: node?.agentVersion ?? null,
        components: node?.componentVersions ?? null,
        appliedRevision: node?.appliedRevision ?? 0,
        reportRevision: node?.lastReportRevision ?? null,
        reportSteps: node?.lastReportSteps ?? null,
        kvmUsable: kvmInUse(node?.capabilities),
      },
      health: ctx.tree,
      slos: ctx.slos,
      replication: ctx.nodes.flatMap((n) =>
        n.componentVersions?.replication
          ? [
              {
                node: n.name,
                syncing: n.componentVersions.replication.syncing,
                degraded: n.componentVersions.replication.degraded,
              },
            ]
          : [],
      ),
      members: ctx.nodes
        .filter((n) => n.controlPlane)
        .map((n) => ({
          name: n.name,
          connected: n.connected && !!n.lastSeenAt && now - n.lastSeenAt.getTime() <= NODE_HEARTBEAT_TIMEOUT_MS,
          witness: n.witness,
          ...(n.componentVersions?.postgres ? { postgres: n.componentVersions.postgres } : {}),
          ...(n.componentVersions?.postgresLag !== undefined ? { postgresLag: n.componentVersions.postgresLag } : {}),
          ...(n.componentVersions?.etcd ? { etcd: n.componentVersions.etcd } : {}),
        })),
    };
  }

  private async advance(
    rollout: RolloutEntity,
    step: RolloutStepEntity,
    all: RolloutStepEntity[],
    ctx: Awaited<ReturnType<RolloutControllerService['context']>>,
    now: number,
  ): Promise<void> {
    const node = ctx.nodes.find((n) => n.name === step.node);

    if (!node) {
      await this.saveStep(
        step,
        { state: 'skipped', data: step.data, effects: [], error: 'the node left the cluster', finished: true },
        now,
      );

      return;
    }

    const updates = await this.clusterUpdates();
    const window = nodeWindowState(
      ctx.windows,
      { name: node.name, site: node.site, labels: node.labels },
      new Date(now),
    );
    const windowOpen =
      rollout.options.windows === 'ignore' || (ctx.windows.length === 0 && !rollout.options.automatic) || window.open;
    // Patroni switchover, decided on the roles now: the current leader hands over to a member this rollout already
    // updated; without one, a not-yet-started replica goes first, or the step waits (never in place, M6 review M2).
    const starting = step.state === 'pending' || step.state === 'waiting-window' || step.state === 'draining';
    const decision =
      starting && node.controlPlane
        ? switchoverDecision(
            node.name,
            ctx.nodes
              .filter((n) => n.controlPlane)
              .map((n) => ({
                name: n.name,
                witness: n.witness,
                ...(n.componentVersions?.postgres ? { postgres: n.componentVersions.postgres } : {}),
                updated: all.some((s) => s.node === n.name && s.state === 'done'),
                order: all.find((s) => s.node === n.name && s.state === 'done')?.index,
              })),
            all
              .filter(
                (s) =>
                  s.id !== step.id &&
                  s.phase === 'control-plane' &&
                  (s.state === 'pending' || s.state === 'waiting-window'),
              )
              .sort((a, b) => a.wave - b.wave)
              .map((s) => s.node),
          )
        : ({ kind: 'none' } as const);

    if (decision.kind === 'reorder' && step.state !== 'draining') {
      await this.reorder(rollout, step, all, decision.node, decision.reason);

      return;
    }

    const candidate = decision.kind === 'switchover' ? ctx.nodes.find((n) => n.name === decision.candidate) : undefined;
    const switchoverHold = decision.kind === 'hold' || decision.kind === 'reorder' ? decision.reason : null;
    const info = await this.releaseInfo(step.target.release, ctx);
    const beforeInfo = await this.releaseInfo(step.before?.release ?? null, ctx);
    const gates = evaluateGates(this.gateInput(step, node, ctx, now, step.target.release, info));
    const rollbackInput = this.gateInput(step, node, ctx, now, step.before?.release ?? null, beforeInfo);
    const rollbackGates = evaluateGates({
      ...rollbackInput,
      // Rolling back can't bring KVM back by itself; it is reported by the forward step's gate.
      step: { ...rollbackInput.step, kvmBefore: undefined },
      health: [],
      slos: [],
      replication: [],
    });
    const hostAction = node.componentVersions?.actions?.find((a) => a.id === step.target.host?.id) ?? null;
    const result = advanceStep(
      {
        state: step.state,
        kind: step.kind,
        target: step.target,
        before: step.before,
        data: step.data,
        stateChangedAt: (step.stateChangedAt ?? step.startedAt ?? new Date(now)).getTime(),
        startedAt: step.startedAt?.getTime() ?? null,
      },
      {
        now,
        windowOpen,
        mayStart: rollout.status === 'running' && !rollout.pauseRequested,
        drained: !ctx.busy.has(node.name),
        lifecycle: node.lifecycle,
        bootId: node.componentVersions?.bootId,
        hostAction: hostAction
          ? { phase: hostAction.phase, ...(hostAction.error ? { error: hostAction.error } : {}) }
          : null,
        rebootRequired: !!node.componentVersions?.rebootRequired,
        switchoverCandidate: candidate ? nodeAddress(candidate) : null,
        switchoverHold,
        gates,
        rollbackGates,
        settleMs: updates.settleSeconds * 1000,
        timeoutMs: updates.stepTimeoutMinutes * 60_000,
        drainTimeoutMs: DRAIN_TIMEOUT_MS,
        newId: () => randomUUID(),
      },
    );

    if (result.started) {
      result.data.baseline = gateBaseline(ctx.tree, ctx.slos);

      // KVM follows the kernel (3.1): remembered before the host update, checked after the reboot.
      if (step.kind === 'host' && kvmInUse(node.capabilities)) result.data.kvmBefore = true;
    }

    await this.apply(rollout, step, node, result.effects);
    await this.saveStep(step, result, now);

    // A failed step is rolled back at once (next decision on the stored state).
    if (result.state === 'failed') {
      const rollback = startRollback(
        {
          state: 'failed',
          kind: step.kind,
          target: step.target,
          before: step.before,
          data: result.data,
          stateChangedAt: now,
          startedAt: null,
        },
        result.data,
      );

      await this.apply(rollout, step, node, rollback.effects);
      await this.saveStep(
        step,
        { ...rollback, error: rollback.error ? `${result.error}; rollback: ${rollback.error}` : result.error },
        now,
      );
      this.logger.warn(
        `Update ${rollout.id}: step ${step.index} on ${step.node} failed (${result.error}); rolling it back`,
      );
    }
  }

  /** Swaps the waves of two member steps (the replica runs before the current leader); decided again next tick. */
  private async reorder(
    rollout: RolloutEntity,
    step: RolloutStepEntity,
    all: RolloutStepEntity[],
    node: string,
    reason: string,
  ): Promise<void> {
    const other = all.find((s) => s.node === node && s.phase === 'control-plane' && s.id !== step.id);

    if (!other) return;

    const [a, b] = [step.wave, other.wave];

    await this.dataSource.transaction(async (manager) => {
      const lease = await manager.getRepository(RolloutEntity).count({ where: this.leased(rollout.id) });

      if (lease === 0) throw new LeaseLostError();

      await manager.getRepository(RolloutStepEntity).update({ id: step.id }, { wave: b });
      await manager.getRepository(RolloutStepEntity).update({ id: other.id }, { wave: a });
    });
    step.wave = b;
    other.wave = a;
    this.logger.log(`Update ${rollout.id}: ${reason}`);
  }

  private async clusterUpdates() {
    const cluster = await this.dataSource
      .getRepository(ResourceEntity)
      .findOne({ where: { kind: 'Cluster', projectKey: '' } });
    const updates = (cluster?.spec as { updates?: { settleSeconds?: number; stepTimeoutMinutes?: number } } | undefined)
      ?.updates;

    return {
      settleSeconds: Number(process.env['LOADWEAVER_UPDATE_SETTLE_SECONDS'] ?? updates?.settleSeconds ?? 60),
      stepTimeoutMinutes: updates?.stepTimeoutMinutes ?? 30,
    };
  }

  private async apply(
    rollout: RolloutEntity,
    step: RolloutStepEntity,
    node: NodeEntity,
    effects: StepEffect[],
  ): Promise<void> {
    for (const effect of effects) {
      switch (effect.kind) {
        case 'set-target':
          await this.setTarget(node.name, effect.target);
          break;
        case 'drain':
          await this.nodes.setLifecycle(node.name, 'draining', SYSTEM);
          break;
        case 'uncordon':
          await this.nodes.setLifecycle(node.name, effect.lifecycle, SYSTEM);
          break;
        case 'pause':
          await this.dataSource
            .getRepository(RolloutEntity)
            .update(
              { ...this.leased(rollout.id), status: 'running' },
              { status: 'paused', pauseReason: `step ${step.index} on ${step.node}: ${effect.reason}` },
            );
          await this.audit.recordStandalone({
            actor: SYSTEM,
            action: 'update.paused',
            target: `rollout/${rollout.id}`,
            details: { step: step.index, node: step.node, reason: effect.reason.slice(0, 500) },
          });
          void this.notifications
            ?.publish('update.paused', { id: rollout.id, node: step.node, reason: effect.reason })
            .catch(() => undefined);
          break;
      }
    }
  }

  /** The node's components follow: its desired state is recompiled with the new target. */
  private async setTarget(node: string, target: StepTarget | null): Promise<void> {
    await this.dataSource.getRepository(NodeEntity).update({ name: node }, { componentTarget: target });
    this.network.requestRecompile(`update target of ${node}: ${target?.release ?? 'none'}`);
  }

  private async saveStep(step: RolloutStepEntity, result: StepAdvance, now: number): Promise<void> {
    const changed = result.state !== step.state;
    // Fenced: only while this replica holds a live lease on the rollout (M6 review L3).
    const saved = await this.dataSource
      .createQueryBuilder()
      .update(RolloutStepEntity)
      .set({
        state: result.state,
        data: result.data,
        ...(result.error !== undefined ? { error: result.error } : {}),
        ...(changed ? { stateChangedAt: new Date(now) } : {}),
        ...(result.started ? { startedAt: new Date(now) } : {}),
        ...(result.finished ? { finishedAt: new Date(now) } : {}),
      })
      .where('id = :id', { id: step.id })
      .andWhere(
        'EXISTS (SELECT 1 FROM lw_rollouts r WHERE r.id = :rollout AND r.lease_owner = :owner AND r.lease_until > now())',
        { rollout: step.rolloutId, owner: this.owner },
      )
      .execute();

    if (saved.affected === 0) throw new LeaseLostError();

    step.state = result.state;
    step.data = result.data;

    if (changed) step.stateChangedAt = new Date(now);

    if (result.started) step.startedAt = new Date(now);
  }

  /** Whole-rollout rollback: updated nodes return to their previous release one by one, members last. */
  private async driveRollback(
    rollout: RolloutEntity,
    steps: RolloutStepEntity[],
    ctx: Awaited<ReturnType<RolloutControllerService['context']>>,
    now: number,
  ): Promise<string> {
    const reverse = [...steps].sort((a, b) => b.index - a.index);
    const inProgress = reverse.find((s) => s.state === 'rolling-back' || s.state === 'failed');
    const next =
      inProgress ??
      reverse.find(
        (s) =>
          s.state === 'done' ||
          s.state === 'verifying' ||
          s.state === 'applying' ||
          s.state === 'rebooting' ||
          s.state === 'draining',
      );

    if (!next) {
      const failed = steps.some((s) => s.state === 'rollback-failed');

      return await this.finish(rollout, failed ? 'rollback-failed' : 'rolled-back', now);
    }

    const node = ctx.nodes.find((n) => n.name === next.node);

    if (!node) {
      await this.saveStep(next, { state: 'skipped', data: next.data, effects: [], finished: true }, now);

      return rollout.status;
    }

    if (next.state !== 'rolling-back') {
      const result = startRollback(
        {
          state: next.state,
          kind: next.kind,
          target: next.target,
          before: next.before,
          data: next.data,
          stateChangedAt: now,
          startedAt: null,
        },
        next.data,
      );

      await this.apply(rollout, next, node, result.effects);
      await this.saveStep(next, result, now);

      return rollout.status;
    }

    await this.advance(rollout, next, steps, ctx, now);

    return rollout.status;
  }

  private async complete(rollout: RolloutEntity, now: number): Promise<string> {
    const status = await this.finish(rollout, 'completed', now);

    // Contract migrations run once every component runs the new version (3.26 expand / contract).
    await this.contracts
      .runIfReady()
      .catch((error: unknown) =>
        this.logger.warn(`Contract migrations deferred: ${error instanceof Error ? error.message : String(error)}`),
      );

    return status;
  }

  private async finish(
    rollout: RolloutEntity,
    status: 'completed' | 'rolled-back' | 'rollback-failed',
    now: number,
  ): Promise<string> {
    await this.dataSource.transaction(async (manager) => {
      const done = await manager
        .getRepository(RolloutEntity)
        .update(this.leased(rollout.id), { status, finishedAt: new Date(now), leaseOwner: null, leaseUntil: null });

      if (done.affected === 0) throw new LeaseLostError();

      await this.audit.record(manager, {
        actor: SYSTEM,
        action: `update.${status}`,
        target: `rollout/${rollout.id}`,
        details: { from: rollout.fromVersion, to: rollout.toVersion },
      });
    });
    this.logger.log(`Update ${rollout.id} to ${rollout.toVersion}: ${status}`);
    void this.notifications
      ?.publish(`update.${status}`, { id: rollout.id, from: rollout.fromVersion, to: rollout.toVersion })
      .catch(() => undefined);

    return status;
  }

  /** Nodes an update is working on right now: alerts about them are silenced (maintenance, 3.18). */
  async nodesUnderMaintenance(): Promise<string[]> {
    const rows: { node: string }[] = await this.dataSource.query(
      `SELECT DISTINCT s.node FROM lw_rollout_steps s JOIN lw_rollouts r ON r.id = s.rollout_id
       WHERE r.status IN ('running', 'paused', 'rolling-back')
         AND s.state IN ('draining', 'applying', 'rebooting', 'verifying', 'rolling-back')`,
    );

    return rows.map((r) => r.node);
  }
}
