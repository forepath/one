import { enqueueUnitJob } from '@forepath/shared/backend';
import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Queue } from 'bullmq';
import { LessThan, Repository } from 'typeorm';

import { FLEET_OPERATION_STEP_JOB, FLEET_QUEUE_NAME, fleetTransferTimeoutMs } from '../constants/fleet.constants';
import type { CreateRestoreOperationDto } from '../dto/fleet.dto';
import { FleetClusterEntity } from '../entities/fleet-cluster.entity';
import {
  FleetOperationEntity,
  type FleetOperationKind,
  type FleetOperationStep,
  type FleetStepStatus,
} from '../entities/fleet-operation.entity';
import { roleAtLeast, roleFor, type FleetCaller } from '../utils/fleet-access.utils';
import {
  cloneDeploymentDocument,
  currentStep,
  initialSteps,
  operationStatus,
  planBundle,
  planOutcome,
  restoreDocuments,
  restoreOutcome,
  restoreResourceName,
  updateStep,
  validateRestoreParams,
  type RestoreOperationParams,
} from '../utils/fleet-operation-steps';
import { FleetAccessService } from './fleet-access.service';
import { FleetAuditService } from './fleet-audit.service';
import { FleetClusterClient, FleetClusterError } from './fleet-cluster-client.service';

export interface FleetOperationDto {
  id: string;
  kind: FleetOperationKind;
  status: string;
  sourceClusterId: string | null;
  targetClusterId: string;
  params: Record<string, unknown>;
  steps: FleetOperationStep[];
  error: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toOperationDto(op: FleetOperationEntity): FleetOperationDto {
  return {
    id: op.id,
    kind: op.kind,
    status: op.status,
    sourceClusterId: op.sourceClusterId,
    targetClusterId: op.targetClusterId,
    params: op.params,
    steps: op.steps,
    error: op.error,
    createdBy: op.createdBy,
    createdAt: op.createdAt.toISOString(),
    updatedAt: op.updatedAt.toISOString(),
  };
}

/** Outcome of one step run. */
export interface StepResult {
  status: Extract<FleetStepStatus, 'succeeded' | 'waiting' | 'skipped' | 'failed'>;
  detail?: Record<string, unknown>;
  error?: string;
}

/** A waiting step gives up after this many polls (the coordinator polls every minute). */
const MAX_WAIT_ATTEMPTS = 6 * 60;

interface BackupLike {
  id?: string;
  project?: string | null;
  resource?: string;
  status?: string;
  deletedAt?: string | null;
  bytes?: number;
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 1000);

/**
 * Cross-cluster operations through the fleet (3.20 restore / clone into another cluster, section 4 final backup):
 * a step plan per operation, each step a queue unit job with an idempotent id, every step audited at the fleet; the
 * clusters audit their side (export, import, plans) with the acting user as on-behalf-of.
 */
@Injectable()
export class FleetOperationsService {
  private readonly logger = new Logger(FleetOperationsService.name);

  constructor(
    @InjectRepository(FleetOperationEntity) private readonly operations: Repository<FleetOperationEntity>,
    @InjectRepository(FleetClusterEntity) private readonly clusters: Repository<FleetClusterEntity>,
    private readonly access: FleetAccessService,
    private readonly client: FleetClusterClient,
    private readonly audit: FleetAuditService,
    @Optional() @InjectQueue(FLEET_QUEUE_NAME) private readonly queue?: Queue,
  ) {}

  // ---------------------------------------------------------------------------------------------- create

  /**
   * Starts a cross-cluster restore / clone. Access is checked now, with the caller's grants: operator of every
   * source backup's project on the source cluster and of the target project on the target cluster.
   */
  async createRestore(caller: FleetCaller, dto: CreateRestoreOperationDto): Promise<FleetOperationDto> {
    if (dto.sourceClusterId === dto.targetClusterId && dto.kind === 'cross-cluster-restore')
      throw new BadRequestException('restore within one cluster is done in the cluster itself');

    const params: RestoreOperationParams = {
      backups: dto.backups.map((b) => ({ backupId: b.backupId, volume: b.volume })),
      target: { project: dto.target.project, deployment: dto.target.deployment },
      mode: dto.mode ?? 'replace',
      apply: dto.apply === true,
      ...(dto.clone ? { clone: { project: dto.clone.project, deployment: dto.clone.deployment } } : {}),
    };
    const errors = validateRestoreParams(dto.kind, params);

    if (errors.length) throw new BadRequestException(errors.join('; '));

    const source = await this.access.visibleCluster(caller, dto.sourceClusterId);
    const target = await this.access.visibleCluster(caller, dto.targetClusterId);

    if (!roleAtLeast(roleFor(target.access, params.target.project), 'operator'))
      throw new ForbiddenException('operators of the target project restore into it');

    if (params.clone && !roleAtLeast(roleFor(source.access, params.clone.project), 'operator'))
      throw new ForbiddenException('operators of the source project clone it');

    for (const b of params.backups) {
      const backup = await this.fetchBackup(source.cluster, b.backupId, caller.label);

      if (!backup.project || !roleAtLeast(roleFor(source.access, backup.project), 'operator'))
        throw new ForbiddenException('operators of the backup project export it');
    }

    const op = await this.operations.save(
      this.operations.create({
        kind: dto.kind,
        status: 'running',
        sourceClusterId: source.cluster.id,
        targetClusterId: target.cluster.id,
        params: params as unknown as Record<string, unknown>,
        steps: initialSteps(dto.kind),
        error: null,
        createdBy: caller.userId,
        onBehalfOf: caller.label,
      }),
    );

    await this.audit.record(
      caller,
      `operation.${dto.kind}.started`,
      `operation/${op.id}`,
      {
        source: source.cluster.name,
        target: target.cluster.name,
        backups: params.backups,
        targetDeployment: params.target,
      },
      target.cluster.id,
    );
    await this.enqueue(op);

    return toOperationDto(op);
  }

  /**
   * Final backup of a cluster (Loadweaver Cloud teardown, section 4). Idempotent: the operation started since `since`
   * (the teardown's start) is returned instead of starting another one — whatever its outcome. A failed or cancelled
   * final backup is not retried on every teardown call (Decabill repeats it every sync interval for the whole grace
   * period, which would start dozens of operations against a cluster whose platform backups fail); it stays visible in
   * the operation and the Cloud status, and a new teardown (after a resume) starts a new one.
   */
  async startFinalBackup(
    caller: FleetCaller | null,
    cluster: FleetClusterEntity,
    since: Date,
    label = 'fleet:loadweaver-cloud',
  ): Promise<FleetOperationDto> {
    const existing = await this.operations.findOne({
      where: { kind: 'final-backup', targetClusterId: cluster.id },
      order: { createdAt: 'DESC' },
    });

    if (existing && existing.createdAt.getTime() >= since.getTime()) return toOperationDto(existing);

    const op = await this.operations.save(
      this.operations.create({
        kind: 'final-backup',
        status: 'running',
        sourceClusterId: null,
        targetClusterId: cluster.id,
        params: {},
        steps: initialSteps('final-backup'),
        error: null,
        createdBy: caller?.userId ?? null,
        onBehalfOf: caller?.label ?? label,
      }),
    );

    await this.audit.record(
      caller,
      'operation.final-backup.started',
      `operation/${op.id}`,
      { cluster: cluster.name },
      cluster.id,
    );
    await this.enqueue(op);

    return toOperationDto(op);
  }

  async list(caller: FleetCaller, filter: { cluster?: string; limit?: number }): Promise<FleetOperationDto[]> {
    const visible = new Set((await this.access.visibleClusters(caller)).map((v) => v.cluster.id));
    const rows = await this.operations.find({
      order: { createdAt: 'DESC' },
      take: Math.min(filter.limit ?? 50, 200) * 4,
    });

    return rows
      .filter((op) => visible.has(op.targetClusterId) && (!op.sourceClusterId || visible.has(op.sourceClusterId)))
      .filter((op) => !filter.cluster || op.targetClusterId === filter.cluster || op.sourceClusterId === filter.cluster)
      .slice(0, Math.min(filter.limit ?? 50, 200))
      .map(toOperationDto);
  }

  async get(caller: FleetCaller, id: string): Promise<FleetOperationDto> {
    const op = await this.operations.findOne({ where: { id } });

    if (!op) throw new NotFoundException('operation not found');

    await this.access.visibleCluster(caller, op.targetClusterId);

    if (op.sourceClusterId) await this.access.visibleCluster(caller, op.sourceClusterId);

    return toOperationDto(op);
  }

  /** Stops an operation at the fleet; what clusters already did (imports, plans) stays and is visible there. */
  async cancel(caller: FleetCaller, id: string): Promise<FleetOperationDto> {
    const op = await this.operations.findOne({ where: { id } });

    if (!op) throw new NotFoundException('operation not found');

    const { access } = await this.access.visibleCluster(caller, op.targetClusterId);

    if (!caller.isAdmin && op.createdBy !== caller.userId && !roleAtLeast(access.clusterRole, 'admin'))
      throw new ForbiddenException('only the creator or an admin cancels an operation');

    if (['succeeded', 'failed', 'cancelled'].includes(op.status))
      throw new ConflictException('operation already ended');

    op.status = 'cancelled';
    await this.operations.save(op);
    await this.audit.record(caller, 'operation.cancelled', `operation/${op.id}`, { kind: op.kind }, op.targetClusterId);

    return toOperationDto(op);
  }

  // ------------------------------------------------------------------------------------------------- queue

  private async enqueue(op: FleetOperationEntity): Promise<void> {
    const step = currentStep(op.steps);

    if (!this.queue || !step) return;

    await enqueueUnitJob({
      queue: this.queue,
      jobName: FLEET_OPERATION_STEP_JOB,
      payload: { operationId: op.id },
      jobIdNamespace: 'fleet-op',
      jobIdParts: [op.id, step.key, step.attempts],
      opts: { attempts: 1 },
    });
  }

  /** Coordinator: re-enqueues waiting operations and running ones that stalled (worker restart). */
  async coordinate(now = new Date()): Promise<number> {
    const waiting = await this.operations.find({ where: { status: 'waiting' } });
    const stalled = await this.operations.find({
      where: { status: 'running', updatedAt: LessThan(new Date(now.getTime() - 10 * 60_000)) },
    });

    for (const op of [...waiting, ...stalled]) await this.enqueue(op);

    return waiting.length + stalled.length;
  }

  /** Unit job: runs the current step, stores the result, enqueues the next step. */
  async runStep(operationId: string): Promise<FleetOperationDto | null> {
    const op = await this.operations.findOne({ where: { id: operationId } });

    if (!op || ['succeeded', 'failed', 'cancelled'].includes(op.status)) return op ? toOperationDto(op) : null;

    const step = currentStep(op.steps);

    if (!step) return toOperationDto(op);

    op.steps = updateStep(op.steps, step.key, { status: 'running', attempts: step.attempts + 1 });

    let result: StepResult;

    try {
      result = await this.execute(op, step.key, step);
    } catch (error) {
      result = { status: 'failed', error: errorText(error) };
    }

    if (result.status === 'waiting' && step.attempts + 1 >= MAX_WAIT_ATTEMPTS)
      result = { status: 'failed', detail: result.detail, error: 'timed out waiting for the cluster' };

    op.steps = updateStep(op.steps, step.key, {
      status: result.status,
      detail: result.detail ?? {},
      error: result.error ?? null,
    });
    op.status = operationStatus(op.kind, op.steps);
    op.error = op.status === 'failed' ? (op.steps.find((s) => s.status === 'failed')?.error ?? 'failed') : null;

    // A cancel while the step ran wins.
    const fresh = await this.operations.findOne({ where: { id: op.id }, select: { id: true, status: true } });

    if (fresh?.status === 'cancelled') return toOperationDto({ ...op, status: 'cancelled' });

    await this.operations.save(op);

    if (result.status !== 'waiting')
      await this.audit.recordQuietly(
        null,
        'operation.step',
        `operation/${op.id}/${step.key}`,
        { kind: op.kind, status: result.status, error: result.error ?? null, by: op.onBehalfOf },
        op.targetClusterId,
      );

    if (op.status === 'running') await this.enqueue(op);
    else if (op.status !== 'waiting')
      await this.audit.recordQuietly(
        null,
        `operation.${op.kind}.${op.status}`,
        `operation/${op.id}`,
        { error: op.error, by: op.onBehalfOf },
        op.targetClusterId,
      );

    return toOperationDto(op);
  }

  // ------------------------------------------------------------------------------------------------- steps

  private async cluster(id: string | null): Promise<FleetClusterEntity> {
    const cluster = id ? await this.clusters.findOne({ where: { id } }) : null;

    if (!cluster) throw new Error('cluster connection was removed');

    if (cluster.state === 'retired') throw new Error(`cluster ${cluster.name} is retired`);

    return cluster;
  }

  private async fetchBackup(cluster: FleetClusterEntity, id: string, onBehalfOf: string): Promise<BackupLike> {
    try {
      return (await this.client.json<BackupLike>(cluster, { method: 'GET', path: `backups/${id}`, onBehalfOf })).data;
    } catch (error) {
      if (error instanceof FleetClusterError && error.status === 404)
        throw new NotFoundException(`backup ${id} not found`);

      throw error;
    }
  }

  /** Dispatches one step (exposed for tests). */
  async execute(op: FleetOperationEntity, key: string, step: FleetOperationStep): Promise<StepResult> {
    if (op.kind === 'final-backup') return await this.finalBackupStep(op, key, step);

    const params = op.params as unknown as RestoreOperationParams;
    const by = op.onBehalfOf ?? '';

    switch (key) {
      case 'validate':
        return await this.validateStep(op, params);
      case 'deployment-plan': {
        if (step.detail['planId']) return { status: 'succeeded' };

        const source = await this.cluster(op.sourceClusterId);
        const target = await this.cluster(op.targetClusterId);
        const clone = params.clone as NonNullable<RestoreOperationParams['clone']>;
        const { data: resource } = await this.client.json<Record<string, unknown>>(source, {
          method: 'GET',
          path: `resources/Deployment/${clone.deployment}`,
          query: { project: clone.project },
          onBehalfOf: by,
        });
        const plan = await this.createPlan(target, [cloneDeploymentDocument(resource, params.target)], by);

        return { status: 'succeeded', detail: { planId: plan.id, planStatus: plan.status } };
      }
      case 'deployment-apply':
        return await this.applyStep(op, params, step, this.stepDetail(op, 'deployment-plan', 'planId'));
      case 'transfer':
        return await this.transferStep(op, params, step);
      case 'restore-plan': {
        if (step.detail['planId']) return { status: 'succeeded' };

        const target = await this.cluster(op.targetClusterId);
        const imported = (this.stepDetail(op, 'transfer', 'imported') ?? {}) as Record<string, string>;
        const plan = await this.createPlan(target, restoreDocuments(op.id, params, imported), by);

        return { status: 'succeeded', detail: { planId: plan.id, planStatus: plan.status } };
      }
      case 'restore-apply':
        return await this.applyStep(op, params, step, this.stepDetail(op, 'restore-plan', 'planId'));
      case 'restore-wait':
        return await this.restoreWaitStep(op, params);
      default:
        return { status: 'failed', error: `unknown step ${key}` };
    }
  }

  private stepDetail(op: FleetOperationEntity, key: string, field: string): unknown {
    return op.steps.find((s) => s.key === key)?.detail[field];
  }

  private async validateStep(op: FleetOperationEntity, params: RestoreOperationParams): Promise<StepResult> {
    const source = await this.cluster(op.sourceClusterId);
    const target = await this.cluster(op.targetClusterId);
    const by = op.onBehalfOf ?? '';
    const backups: Record<string, unknown>[] = [];

    for (const b of params.backups) {
      const backup = await this.fetchBackup(source, b.backupId, by);

      if (backup.status !== 'succeeded' || backup.deletedAt)
        return { status: 'failed', error: `backup ${b.backupId} is not available` };

      backups.push({ id: b.backupId, project: backup.project, resource: backup.resource, bytes: backup.bytes ?? null });
    }

    const exists = async (cluster: FleetClusterEntity, project: string, name: string) => {
      try {
        await this.client.json(cluster, {
          method: 'GET',
          path: `resources/Deployment/${name}`,
          query: { project },
          onBehalfOf: by,
        });

        return true;
      } catch (error) {
        if (error instanceof FleetClusterError && error.status === 404) return false;

        throw error;
      }
    };

    if (params.clone) {
      if (!(await exists(source, params.clone.project, params.clone.deployment)))
        return { status: 'failed', error: 'the source deployment does not exist' };

      if (await exists(target, params.target.project, params.target.deployment))
        return { status: 'failed', error: 'the target deployment exists already (clone creates it)' };
    } else if (!(await exists(target, params.target.project, params.target.deployment))) {
      return { status: 'failed', error: 'the target deployment does not exist' };
    }

    return { status: 'succeeded', detail: { backups } };
  }

  private async createPlan(
    cluster: FleetClusterEntity,
    documents: Record<string, unknown>[],
    by: string,
  ): Promise<{ id: string; status: string }> {
    const { data } = await this.client.json<{ id: string; status: string }>(cluster, {
      method: 'POST',
      path: 'plans',
      body: { documents: planBundle(documents) },
      onBehalfOf: by,
    });

    if (!data?.id) throw new Error('the cluster returned no plan');

    return data;
  }

  /**
   * Applies a plan (when the operation was started with `apply`) and waits until it is applied — approvals of the
   * target cluster still hold it; without `apply` the plan waits for someone to apply it there.
   */
  private async applyStep(
    op: FleetOperationEntity,
    params: RestoreOperationParams,
    step: FleetOperationStep,
    planId: unknown,
  ): Promise<StepResult> {
    if (typeof planId !== 'string') return { status: 'failed', error: 'no plan to apply' };

    const target = await this.cluster(op.targetClusterId);
    const by = op.onBehalfOf ?? '';

    if (params.apply && !step.detail['applyRequested']) {
      try {
        const { data } = await this.client.json<{ status?: string }>(target, {
          method: 'POST',
          path: `plans/${planId}/apply`,
          body: {},
          onBehalfOf: by,
        });
        const outcome = planOutcome(data?.status);

        if (outcome === 'applied')
          return { status: 'succeeded', detail: { applyRequested: true, planStatus: data?.status } };

        if (outcome === 'failed') return { status: 'failed', error: `plan ${data?.status}` };

        return { status: 'waiting', detail: { applyRequested: true, planStatus: data?.status } };
      } catch (error) {
        // Approvals missing / pins to confirm: the plan waits in the target cluster.
        if (error instanceof FleetClusterError && error.status !== null && error.status < 500)
          return { status: 'waiting', detail: { applyRequested: true, applyMessage: error.message.slice(0, 300) } };

        throw error;
      }
    }

    const { data } = await this.client.json<{ status?: string }>(target, {
      method: 'GET',
      path: `plans/${planId}`,
      onBehalfOf: by,
    });
    const outcome = planOutcome(data?.status);

    if (outcome === 'applied') return { status: 'succeeded', detail: { planStatus: data?.status } };

    if (outcome === 'failed') return { status: 'failed', error: `plan ${data?.status}` };

    return { status: 'waiting', detail: { planStatus: data?.status } };
  }

  /** Streams each backup archive from the source into the target's catalog (resumes after the last import). */
  private async transferStep(
    op: FleetOperationEntity,
    params: RestoreOperationParams,
    step: FleetOperationStep,
  ): Promise<StepResult> {
    const source = await this.cluster(op.sourceClusterId);
    const target = await this.cluster(op.targetClusterId);
    const by = op.onBehalfOf ?? '';
    const imported = { ...((step.detail['imported'] as Record<string, string> | undefined) ?? {}) };

    for (const b of params.backups) {
      if (imported[b.backupId]) continue;

      const archive = await this.client.stream(source, {
        method: 'GET',
        path: `backups/${b.backupId}/archive`,
        onBehalfOf: by,
        timeoutMs: fleetTransferTimeoutMs(),
      });

      if (archive.status !== 200) {
        archive.data.destroy();

        return { status: 'failed', detail: { imported }, error: `export of ${b.backupId}: HTTP ${archive.status}` };
      }

      try {
        const { data } = await this.client.json<{ id: string }>(target, {
          method: 'POST',
          path: 'backups/imports',
          query: {
            volume: `${params.target.project}/${params.target.deployment}/${b.volume}`,
            sourceCluster: source.name,
            sourceBackup: b.backupId,
          },
          headers: {
            'content-type': 'application/x-tar',
            ...(archive.headers['content-length']
              ? { 'content-length': String(archive.headers['content-length']) }
              : {}),
          },
          body: archive.data,
          onBehalfOf: by,
          timeoutMs: fleetTransferTimeoutMs(),
        });

        imported[b.backupId] = data.id;
      } catch (error) {
        archive.data.destroy();

        // A cloned deployment's volumes appear once its workloads are placed.
        if (op.kind === 'clone' && error instanceof FleetClusterError && error.status === 404)
          return { status: 'waiting', detail: { imported, waitingFor: `volume ${b.volume}` } };

        throw error;
      }
    }

    return { status: 'succeeded', detail: { imported } };
  }

  private async restoreWaitStep(op: FleetOperationEntity, params: RestoreOperationParams): Promise<StepResult> {
    const target = await this.cluster(op.targetClusterId);
    const { data } = await this.client.json<{ name?: string; status?: string; error?: string | null }[]>(target, {
      method: 'GET',
      path: 'backups/restores',
      query: { project: params.target.project },
      onBehalfOf: op.onBehalfOf ?? '',
    });
    const names = params.backups.map((b) => restoreResourceName(op.id, b.volume));
    const rows = names.map((n) => (Array.isArray(data) ? data : []).find((r) => r.name === n));
    const outcomes = rows.map((r) => restoreOutcome(r?.status));
    const failed = rows.find((r, i) => outcomes[i] === 'failed');

    if (failed) return { status: 'failed', error: `restore ${failed.name}: ${failed.error ?? 'failed'}` };

    if (outcomes.every((o) => o === 'succeeded')) return { status: 'succeeded', detail: { restores: names } };

    return { status: 'waiting', detail: { restores: names } };
  }

  /** Final backup: platform backups, every volume, wait for them, then the copies to external targets. */
  private async finalBackupStep(op: FleetOperationEntity, key: string, step: FleetOperationStep): Promise<StepResult> {
    const cluster = await this.cluster(op.targetClusterId);
    const by = op.onBehalfOf ?? '';
    const post = async (path: string) =>
      (await this.client.json<unknown>(cluster, { method: 'POST', path, body: {}, onBehalfOf: by })).data;
    const optional = async (path: string): Promise<StepResult> => {
      try {
        return { status: 'succeeded', detail: { result: await post(path) } };
      } catch (error) {
        // A component that is not enabled on the cluster (4xx) is skipped, not a failure.
        if (error instanceof FleetClusterError && error.status !== null && error.status < 500)
          return { status: 'skipped', error: error.message.slice(0, 300) };

        throw error;
      }
    };

    switch (key) {
      case 'platform-postgres':
      case 'platform-opensearch':
      case 'platform-etcd':
        return await optional(`backups/platform/${key.slice('platform-'.length)}/run`);
      case 'volumes': {
        const result = (await post('backups/now/all')) as { started?: string[]; skipped?: string[] };

        return { status: 'succeeded', detail: { started: result?.started ?? [], skipped: result?.skipped ?? [] } };
      }
      case 'volumes-wait': {
        const started = (this.stepDetail(op, 'volumes', 'started') as string[] | undefined) ?? [];

        if (!started.length) return { status: 'skipped' };

        const { data } = await this.client.json<BackupLike[]>(cluster, {
          method: 'GET',
          path: 'backups',
          query: { limit: 2000 },
          onBehalfOf: by,
        });
        const since = new Date(op.createdAt).getTime();
        const latest = new Map<string, BackupLike & { startedAt?: string }>();

        for (const b of (Array.isArray(data) ? data : []) as (BackupLike & { startedAt?: string })[]) {
          if (!b.resource || !started.includes(b.resource) || new Date(b.startedAt ?? 0).getTime() < since) continue;

          if (!latest.has(b.resource)) latest.set(b.resource, b);
        }

        if ([...latest.values()].some((b) => b.status === 'running') || latest.size < started.length)
          return {
            status: 'waiting',
            detail: { done: [...latest.values()].filter((b) => b.status !== 'running').length },
          };

        const failed = [...latest.values()].filter((b) => b.status !== 'succeeded').map((b) => b.resource);

        return failed.length
          ? { status: 'failed', detail: { failed }, error: `backups failed: ${failed.join(', ')}` }
          : { status: 'succeeded', detail: { done: latest.size, attempts: step.attempts } };
      }
      case 'copies':
        return await optional('backups/platform/copies/run');
      default:
        return { status: 'failed', error: `unknown step ${key}` };
    }
  }
}
