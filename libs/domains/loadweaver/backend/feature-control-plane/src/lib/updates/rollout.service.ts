import { randomUUID } from 'node:crypto';

import { clusterSpecSchema } from '@forepath/loadweaver/shared/util-model';
import { compareVersions, updateKind, type ReleaseManifest } from '@forepath/loadweaver/shared/util-release';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, Not, type EntityManager } from 'typeorm';

import { NodeEntity } from '../entities/node.entity';
import { ResourceEntity } from '../entities/resource.entity';
import { VolumePlacementEntity } from '../entities/volume-placement.entity';
import { WorkloadPlacementEntity } from '../entities/workload-placement.entity';
import { LoadweaverNotificationPublisher } from '../notifications/loadweaver-notifications.module';
import { AuditLogService, type AuditActor } from '../services/audit-log.service';
import { AptSnapshotService } from './apt-snapshot.service';
import { ReleaseEntity } from './release.entity';
import { ReleasesService } from './releases.service';
import {
  ACTIVE_ROLLOUT_STATUSES,
  RolloutEntity,
  RolloutStepEntity,
  type RolloutOptions,
  type RolloutStatus,
  type StepTarget,
} from './rollout.entity';
import { componentDiff, drbdSpaasAllowed, planSteps, waveRisks } from './rollout-planner.utils';
import { IN_FLIGHT_STEP_STATES } from './rollout-state.utils';

export interface CreateRolloutInput {
  /** Target release; omitted: the cluster's current release (host updates only). */
  version?: string;
  /** Include host updates (OS packages, kernel, gVisor, DRBD module) with drain → reboot where needed. */
  host?: boolean;
  /** Upgrade every OS package to the snapshot, not only the release's pins (default: with host updates). */
  osUpgrade?: boolean;
}

export interface RolloutStepDto {
  index: number;
  wave: number;
  phase: string;
  node: string;
  site: string;
  kind: string;
  state: string;
  from: string | null;
  to: string | null;
  error: string | null;
  gates: { name: string; ok: boolean; message: string }[];
  startedAt: string | null;
  finishedAt: string | null;
}

export interface RolloutDto {
  id: string;
  status: RolloutStatus;
  kind: string;
  fromVersion: string | null;
  toVersion: string;
  options: RolloutOptions;
  diff: RolloutEntity['diff'];
  notes: string[];
  warnings: string[];
  failureAnalysis: RolloutEntity['failureAnalysis'];
  createdBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  pauseReason: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  progress: { done: number; total: number; currentWave: number | null };
  steps: RolloutStepDto[];
}

export function toRolloutDto(r: RolloutEntity, steps: RolloutStepEntity[]): RolloutDto {
  const sorted = [...steps].sort((a, b) => a.index - b.index);
  const done = sorted.filter((s) => s.state === 'done' || s.state === 'skipped').length;
  const open = sorted.filter((s) => !['done', 'skipped'].includes(s.state));

  return {
    id: r.id,
    status: r.status,
    kind: r.kind,
    fromVersion: r.fromVersion,
    toVersion: r.toVersion,
    options: r.options,
    diff: r.diff,
    notes: r.notes,
    warnings: r.warnings,
    failureAnalysis: r.failureAnalysis,
    createdBy: r.createdBy,
    approvedBy: r.approvedBy,
    approvedAt: r.approvedAt?.toISOString() ?? null,
    pauseReason: r.pauseReason,
    startedAt: r.startedAt?.toISOString() ?? null,
    finishedAt: r.finishedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    progress: { done, total: sorted.length, currentWave: open.length ? Math.min(...open.map((s) => s.wave)) : null },
    steps: sorted.map((s) => ({
      index: s.index,
      wave: s.wave,
      phase: s.phase,
      node: s.node,
      site: s.site,
      kind: s.kind,
      state: s.state,
      from: s.before?.release ?? null,
      to: s.target.release,
      error: s.error,
      gates: s.data.gates ?? [],
      startedAt: s.startedAt?.toISOString() ?? null,
      finishedAt: s.finishedAt?.toISOString() ?? null,
    })),
  };
}

function actorId(actor: AuditActor): string {
  return actor.id ?? actor.type;
}

/**
 * Update plans (3.26): create (the per-node / per-component diff, notes, warnings and failure analysis of every wave),
 * approve, pause, resume, roll back, cancel. The rollout controller runs approved plans.
 */
@Injectable()
export class RolloutService {
  private readonly logger = new Logger(RolloutService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly releases: ReleasesService,
    private readonly apt: AptSnapshotService,
    private readonly audit: AuditLogService,
    @Optional() private readonly notifications?: LoadweaverNotificationPublisher,
  ) {}

  async list(limit = 50): Promise<RolloutDto[]> {
    const rows = await this.dataSource
      .getRepository(RolloutEntity)
      .find({ order: { createdAt: 'DESC' }, take: Math.min(Math.max(limit, 1), 200) });
    const steps = rows.length
      ? await this.dataSource.getRepository(RolloutStepEntity).find({ where: { rolloutId: In(rows.map((r) => r.id)) } })
      : [];

    return rows.map((r) =>
      toRolloutDto(
        r,
        steps.filter((s) => s.rolloutId === r.id),
      ),
    );
  }

  async get(id: string): Promise<RolloutDto> {
    const row = await this.dataSource.getRepository(RolloutEntity).findOne({ where: { id } });

    if (!row) throw new NotFoundException('update plan not found');

    return toRolloutDto(row, await this.dataSource.getRepository(RolloutStepEntity).find({ where: { rolloutId: id } }));
  }

  /** Creates an update plan. `automatic`: by the update policy (approved by it, windows always respected). */
  async create(input: CreateRolloutInput, actor: AuditActor, automatic = false): Promise<RolloutDto> {
    const current = await this.releases.clusterVersion();
    const version = input.version ?? current;

    if (!version) throw new BadRequestException('no release given and the cluster version is unknown');

    const release = await this.dataSource.getRepository(ReleaseEntity).findOne({ where: { version } });

    if (!release || release.status !== 'available' || !release.manifest)
      throw new ConflictException(`release ${version} is not imported (download or upload its bundle first)`);

    const manifest = release.manifest as unknown as ReleaseManifest;
    const host = input.host ?? !input.version;
    let kind: RolloutEntity['kind'];

    if (!input.version || version === current) kind = 'os';
    else if (!current) kind = 'minor';
    else {
      const k = updateKind(current, version);

      if (k === 'none') throw new BadRequestException(`the cluster already runs ${version}`);

      kind = k;
    }

    if (kind === 'os' && !host) throw new BadRequestException(`the cluster already runs ${version}; nothing to update`);

    if (current && manifest.minimumVersion && compareVersions(current, manifest.minimumVersion) < 0)
      throw new ConflictException(
        `${version} needs at least ${manifest.minimumVersion}; update to an intermediate release first (N-1)`,
      );

    const cluster = await this.dataSource
      .getRepository(ResourceEntity)
      .findOneOrFail({ where: { kind: 'Cluster', projectKey: '' } });
    const spec = clusterSpecSchema.parse(cluster.spec);
    const nodes = await this.dataSource
      .getRepository(NodeEntity)
      .find({ where: { lifecycle: Not('left') }, order: { name: 'ASC' } });
    const placements = await this.dataSource.getRepository(WorkloadPlacementEntity).find();
    const volumes = await this.dataSource.getRepository(VolumePlacementEntity).find();
    const plan = planSteps({
      nodes: nodes.map((n) => ({
        name: n.name,
        site: n.site,
        controlPlane: n.controlPlane,
        witness: n.witness,
        lifecycle: n.lifecycle,
        replicas: placements.filter((p) => p.node === n.name).length,
        postgres: n.componentVersions?.postgres,
        components: n.protocolFeatures.includes('components'),
      })),
      failureDomain: spec.failureDomain,
      host,
    });

    if (plan.steps.length === 0)
      throw new ConflictException(
        `no node can take release components (${plan.skipped.map((s) => s.reason).join('; ') || 'no nodes'})`,
      );

    const warnings = [
      ...plan.skipped.map((s) => s.reason),
      ...(release.signature ? [] : [`release ${version} is an unsigned development bundle`]),
      ...nodes.flatMap((n) =>
        (n.componentVersions?.overrides ?? []).map(
          (c) =>
            `${n.name} overrides ${c} with a development image (LOADWEAVER_*_IMAGE): the release's image isn't used there`,
        ),
      ),
      ...(kind === 'downgrade' ? [`${version} is older than the cluster's ${current}: a downgrade`] : []),
    ];
    let snapshot: string | undefined;
    let snapshotOrigin: 'plan' | 'bundle' | undefined;

    if (host) {
      try {
        snapshot = (await this.apt.createSnapshot()).id;
        snapshotOrigin = 'plan';
      } catch (error) {
        snapshot = release.imported?.aptSnapshot;

        if (!snapshot)
          throw new ConflictException(
            `the OS package snapshot could not be taken (${error instanceof Error ? error.message : String(error)}) and the bundle ships none`,
          );

        snapshotOrigin = 'bundle';
        warnings.push(`the upstream archives are unreachable; host updates use the bundle's snapshot ${snapshot}`);
      }
    }

    const drbdSpaas = host && drbdSpaasAllowed(spec.updates, snapshotOrigin);

    const options: RolloutOptions = {
      windows: 'respect',
      host,
      osUpgrade: host && (input.osUpgrade ?? true),
      ...(snapshot ? { snapshot } : {}),
      ...(drbdSpaas ? { drbdSpaas } : {}),
      automatic,
      emergency: false,
    };
    const diff = componentDiff(
      nodes
        .filter((n) => plan.steps.some((s) => s.node === n.name))
        .map((n) => ({
          name: n.name,
          controlPlane: n.controlPlane,
          os: n.os ? `${n.os.id}:${n.os.versionId}` : null,
          arch: n.os?.arch ?? null,
          agentVersion: n.agentVersion,
          images: n.componentVersions?.images ?? {},
          packages: n.componentVersions?.packages ?? {},
          gvisor: n.componentVersions?.gvisor ?? null,
          drbd: n.componentVersions?.drbd ?? null,
        })),
      manifest,
      host,
    );

    if (host && options.osUpgrade)
      for (const s of plan.steps)
        diff.push({
          node: s.node,
          component: 'os',
          from: null,
          to: `snapshot ${snapshot}`,
          method: 'cluster-local apt source, reboot if needed',
        });

    const failureAnalysis = waveRisks(
      plan.steps,
      placements.map((p) => ({
        id: p.id,
        node: p.node,
        project: p.project,
        deployment: p.deployment,
        service: p.service,
      })),
      volumes.map((v) => ({ id: v.id, nodes: [v.primaryNode, ...v.syncReplicas, ...v.remoteReplicas] })),
      host,
    );

    const saved = await this.dataSource.transaction(async (manager) => {
      // A new plan replaces older pending plans and resolves a failed rollback (fix-forward, 3.19).
      await manager
        .getRepository(RolloutEntity)
        .update({ status: In(['planned', 'rollback-failed']) }, { status: 'superseded', finishedAt: new Date() });

      const rollout = await manager.getRepository(RolloutEntity).save(
        manager.getRepository(RolloutEntity).create({
          status: 'planned',
          fromVersion: current,
          toVersion: version,
          kind,
          options,
          diff,
          notes: manifest.notes ?? [],
          warnings,
          failureAnalysis,
          createdBy: automatic ? 'policy' : actorId(actor),
        }),
      );
      const byNode = new Map(nodes.map((n) => [n.name, n]));

      await manager.getRepository(RolloutStepEntity).save(
        plan.steps.map((s) => {
          const node = byNode.get(s.node) as NodeEntity;
          const before: StepTarget = {
            release: node.componentTarget?.release ?? node.componentVersions?.release ?? null,
          };

          return manager.getRepository(RolloutStepEntity).create({
            rolloutId: rollout.id,
            index: s.index,
            wave: s.wave,
            phase: s.phase,
            node: s.node,
            site: s.site,
            kind: s.kind,
            state: 'pending',
            before,
            target: {
              release: version,
              ...(s.kind === 'host' && snapshot
                ? {
                    host: {
                      id: randomUUID(),
                      snapshot,
                      upgrade: options.osUpgrade,
                      ...(options.drbdSpaas ? { spaas: true } : {}),
                    },
                  }
                : {}),
            },
            data: {},
          });
        }),
      );
      await this.audit.record(manager, {
        actor,
        action: 'update.planned',
        target: `rollout/${rollout.id}`,
        details: { from: current, to: version, kind, host, automatic, steps: plan.steps.length },
      });

      return rollout;
    });

    void this.notifications
      ?.publish('update.planned', { id: saved.id, from: current, to: version, kind, automatic })
      .catch(() => undefined);

    if (automatic) return await this.approve(saved.id, { type: 'system', id: 'policy' }, {});

    return await this.get(saved.id);
  }

  private async transition(
    id: string,
    actor: AuditActor,
    action: string,
    from: readonly RolloutStatus[],
    change: (row: RolloutEntity) => Partial<RolloutEntity>,
    details: Record<string, unknown> = {},
    guard?: (row: RolloutEntity, manager: EntityManager) => Promise<void>,
  ): Promise<RolloutDto> {
    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(RolloutEntity);
      const row = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });

      if (!row) throw new NotFoundException('update plan not found');

      if (!from.includes(row.status)) throw new ConflictException(`the update plan is ${row.status}`);

      await guard?.(row, manager);

      if (action === 'update.approve') {
        const active = await repo.findOne({ where: { status: In([...ACTIVE_ROLLOUT_STATUSES]), id: Not(id) } });

        if (active) throw new ConflictException(`update ${active.id} is ${active.status}; one update runs at a time`);
      }

      await repo.update({ id }, change(row));
      await this.audit.record(manager, { actor, action, target: `rollout/${id}`, details });
    });

    return await this.get(id);
  }

  /**
   * Approves a plan; the controller starts it in the next maintenance window. `emergency` (an explicit approval) lets it
   * run outside windows (3.26: emergency security fixes).
   */
  async approve(id: string, actor: AuditActor, input: { emergency?: boolean }): Promise<RolloutDto> {
    return await this.transition(
      id,
      actor,
      'update.approve',
      ['planned'],
      (row) => ({
        status: 'approved',
        approvedBy: actorId(actor),
        approvedAt: new Date(),
        options: input.emergency ? { ...row.options, windows: 'ignore', emergency: true } : row.options,
      }),
      { emergency: !!input.emergency },
    );
  }

  async pause(id: string, actor: AuditActor): Promise<RolloutDto> {
    return await this.transition(id, actor, 'update.pause', ['approved', 'running'], () => ({
      status: 'paused',
      pauseRequested: true,
      pauseReason: `paused by ${actorId(actor)}`,
    }));
  }

  /** Continues a paused rollout; a step that failed and was rolled back is tried again. */
  async resume(id: string, actor: AuditActor): Promise<RolloutDto> {
    const dto = await this.transition(id, actor, 'update.resume', ['paused'], () => ({
      status: 'running',
      pauseRequested: false,
      pauseReason: null,
    }));

    await this.dataSource
      .getRepository(RolloutStepEntity)
      .update(
        { rolloutId: id, state: In(['rolled-back']) },
        { state: 'pending', error: null, data: {}, stateChangedAt: new Date() },
      );

    return dto;
  }

  /** Rolls back every updated node, in reverse order (nodes first, control-plane members last). */
  async rollback(id: string, actor: AuditActor): Promise<RolloutDto> {
    return await this.transition(id, actor, 'update.rollback', ['running', 'paused', 'approved'], () => ({
      status: 'rolling-back',
      pauseReason: `rollback requested by ${actorId(actor)}`,
    }));
  }

  /**
   * Cancels a plan that hasn't run, or stops a paused one where it is (nodes keep what they run). Refused while steps
   * are in flight: their nodes may be drained and their alerts silenced, which only the controller gives back — wait
   * for them to finish (they keep moving while paused) or roll the update back (M6 review L1).
   */
  async cancel(id: string, actor: AuditActor): Promise<RolloutDto> {
    return await this.transition(
      id,
      actor,
      'update.cancel',
      ['planned', 'approved', 'paused'],
      () => ({ status: 'cancelled', finishedAt: new Date() }),
      {},
      async (_row, manager) => {
        const inFlight = await manager
          .getRepository(RolloutStepEntity)
          .find({ where: { rolloutId: id, state: In([...IN_FLIGHT_STEP_STATES]) }, order: { index: 'ASC' } });

        if (inFlight.length)
          throw new ConflictException(
            `steps are still in flight on ${inFlight.map((s) => `${s.node} (${s.state})`).join(', ')}: wait until they finished or roll the update back instead of cancelling`,
          );
      },
    );
  }
}
