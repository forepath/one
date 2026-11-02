import {
  controlPlaneMessage,
  importChannel,
  messageAllowed,
  volumeDockerName,
  type DesiredState,
  type ImportAction,
  type ImportProgress,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import type { NodeImportStep } from '@forepath/loadweaver/shared/util-model';
import { getQueueRole, shouldRunApiHttp } from '@forepath/shared/backend';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, IsNull, type EntityManager } from 'typeorm';

import { AgentSessionRegistry } from '../agent-stream/agent-session.registry';
import { NodeDesiredStateEntity } from '../entities/node-desired-state.entity';
import { NodeEntity } from '../entities/node.entity';
import { WorkloadPlacementEntity } from '../entities/workload-placement.entity';
import { AuditLogService } from '../services/audit-log.service';
import { NetworkStateService } from '../services/network-state.service';
import { buildComponentsScript } from '../utils/install-script.utils';
import { ImportSelectionEntity, type ImportStepState } from './import.entities';
import { writesPaused } from '../database-handover/database-target.runtime';

const TICK_MS = 5_000;
/** A command without a report is sent again after this long (the agent answers re-sent steps idempotently). */
const RESEND_MS = 60_000;
const ROLLBACK_STEP = 'rollback';

/** How long a step may take before the import fails (and rolls back what it stopped). */
export const STEP_TIMEOUTS_MS: Record<NodeImportStep['kind'], number> = {
  components: 45 * 60_000,
  'wipe-identity': 5 * 60_000,
  'reuse-replicas': 60_000,
  activate: 15 * 60_000,
  precopy: 12 * 3_600_000,
  stop: 10 * 60_000,
  'final-sync': 12 * 3_600_000,
  release: 60_000,
  verify: 10 * 60_000,
  handover: 10 * 60_000,
};

const AGENT_STEPS = new Set<NodeImportStep['kind']>([
  'components',
  'wipe-identity',
  'precopy',
  'stop',
  'final-sync',
  'handover',
]);

function finished(state: ImportStepState | undefined): boolean {
  return state?.status === 'done' || state?.status === 'skipped';
}

/**
 * Runs approved join plans (3.21), on every control-plane replica: each tick takes the running imports nobody else
 * holds (`FOR UPDATE SKIP LOCKED`) and advances their next step — agent steps are sent to the node when its stream is
 * connected here (re-sent until reported), control-plane steps happen in place: `activate` (the node gets its
 * desired state; the agent's stream switches to its own tunnel make-before-break), `release` (the imported
 * deployment runs under Loadweaver and gets its ingress routes), `verify` (every replica reports running). A failed
 * step after a stop rolls back: the imported deployment is held again and the source containers start again with
 * their restart policies (make-before-break: the source is kept until the target runs).
 */
@Injectable()
export class ImportControllerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ImportControllerService.name);
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: AgentSessionRegistry,
    private readonly network: NetworkStateService,
    private readonly audit: AuditLogService,
  ) {}

  onApplicationBootstrap(): void {
    if ((process.env['LOADWEAVER_IMPORT_CONTROLLER'] ?? 'on') === 'off' || !shouldRunApiHttp(getQueueRole())) return;

    this.timer = setInterval(() => void this.safeTick(), TICK_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async safeTick(): Promise<void> {
    if (writesPaused('Import controller', this.logger)) return;

    if (this.ticking) return;

    this.ticking = true;

    try {
      await this.tick();
    } catch (error) {
      this.logger.warn(`Import controller: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.ticking = false;
    }
  }

  async tick(now = Date.now()): Promise<void> {
    const ids: { id: string }[] = await this.dataSource.query(
      `SELECT id FROM lw_import_selections WHERE status = 'running' ORDER BY created_at`,
    );

    for (const { id } of ids) {
      let recompile: string | null = null;

      await this.dataSource.transaction(async (manager) => {
        const [row] = await manager
          .getRepository(ImportSelectionEntity)
          .createQueryBuilder('s')
          .setLock('pessimistic_write')
          .setOnLocked('skip_locked')
          .where('s.id = :id AND s.status = :status', { id, status: 'running' })
          .getMany();

        if (row) recompile = await this.drive(manager, row, now);
      });

      if (recompile) this.network.requestRecompile(recompile);
    }
  }

  /** Advances one import by at most one step transition; returns a recompile reason when the cluster changed. */
  private async drive(manager: EntityManager, selection: ImportSelectionEntity, now: number): Promise<string | null> {
    const repo = manager.getRepository(ImportSelectionEntity);
    const states = { ...(selection.steps ?? {}) };
    const save = async (patch: Partial<ImportSelectionEntity> = {}) =>
      await repo.save(Object.assign(selection, { steps: states }, patch));

    if (states[ROLLBACK_STEP]) return await this.driveRollback(manager, selection, states, now);

    const steps = selection.joinPlan.steps;
    const step = steps.find((s) => !finished(states[s.id]));

    if (!step) {
      await save({ status: 'done', error: null });
      await this.record(manager, selection, 'node.import-done', {});

      return null;
    }

    const state: ImportStepState = states[step.id] ?? { status: 'pending' };

    if (state.status === 'failed') return await this.fail(manager, selection, states, step, state.message ?? 'failed');

    const started = state.startedAt ? Date.parse(state.startedAt) : now;

    if (state.status === 'running' && now - started > STEP_TIMEOUTS_MS[step.kind]) {
      states[step.id] = {
        ...state,
        status: 'failed',
        message: `${step.kind} timed out`,
        finishedAt: new Date(now).toISOString(),
      };

      return await this.fail(manager, selection, states, step, `${step.id}: timed out`);
    }

    const node = await manager.getRepository(NodeEntity).findOne({ where: { name: selection.node } });

    if (!node) {
      states[step.id] = { ...state, status: 'failed', message: 'the node is gone' };

      return await this.fail(manager, selection, states, step, 'the node is gone');
    }

    const begin = (message?: string): ImportStepState => ({
      ...state,
      status: 'running',
      startedAt: state.startedAt ?? new Date(now).toISOString(),
      ...(message ? { message } : {}),
    });
    const done = (message?: string): ImportStepState => ({
      ...state,
      status: 'done',
      startedAt: state.startedAt ?? new Date(now).toISOString(),
      finishedAt: new Date(now).toISOString(),
      ...(message ? { message } : {}),
    });

    switch (step.kind) {
      case 'reuse-replicas':
        states[step.id] = done(`${step.volumes?.length ?? 0} replica(s) kept for resync`);
        await save();

        return null;
      case 'activate': {
        if (node.lifecycle === 'importing') {
          node.lifecycle = 'active';
          await manager.getRepository(NodeEntity).save(node);
          states[step.id] = begin('waiting for the node to apply its desired state');
          await save();

          return `node ${node.name} activated by its join plan`;
        }

        const desired = await manager.getRepository(NodeDesiredStateEntity).findOne({ where: { nodeName: node.name } });

        if (desired && node.appliedRevision >= desired.revision && node.applyStatus === 'applied')
          states[step.id] = done(`desired state ${desired.revision} applied`);
        else if (node.applyStatus === 'failed' || node.applyStatus === 'rolled-back')
          states[step.id] = { ...begin(), status: 'failed', message: node.applyError ?? `apply ${node.applyStatus}` };
        else states[step.id] = begin(state.message);

        await save();

        return null;
      }
      case 'release': {
        const released = [...new Set([...(selection.released ?? []), step.deployment as string])];

        states[step.id] = done();
        await save({ released });

        return `imported deployment ${step.deployment} released`;
      }
      case 'verify': {
        const [project, deployment] = (step.deployment as string).split('/');
        const placements = await manager
          .getRepository(WorkloadPlacementEntity)
          .find({ where: { project, deployment, cronRun: IsNull() } });
        const running = placements.filter((p) => ['running', 'healthy'].includes(p.status?.[p.node]?.state ?? ''));

        states[step.id] =
          placements.length > 0 && running.length === placements.length
            ? done(`${running.length} replica(s) running`)
            : begin(`${running.length} of ${placements.length} replica(s) running`);
        await save();

        return null;
      }
    }

    if (!AGENT_STEPS.has(step.kind)) return null;

    // Copies go into the node's replicated volumes: wait until the node created them (applied desired state).
    if (step.copies?.length) {
      const desired = await manager.getRepository(NodeDesiredStateEntity).findOne({ where: { nodeName: node.name } });
      const names = new Set(((desired?.state as DesiredState | undefined)?.volumes ?? []).map((v) => v.dockerName));
      const missing = step.copies.filter((c) => !names.has(volumeDockerName(c.volume)));

      if (missing.length || !desired || node.appliedRevision < desired.revision) {
        states[step.id] = begin(
          `waiting for the volume(s) ${missing.map((c) => c.volume).join(', ') || 'to be applied'}`,
        );
        await save();

        return null;
      }
    }

    if (state.sentAt && now - Date.parse(state.sentAt) < RESEND_MS) return null;

    const session = this.sessions.get(node.name);

    if (!session) return null;

    if (!messageAllowed('importStep', session.protocol)) {
      states[step.id] = {
        ...begin(),
        status: 'failed',
        message: 'the agent does not support imports (feature node-import)',
      };
      await save();

      return null;
    }

    session.send(
      controlPlaneMessage(
        'importStep',
        { import: selection.id, step: step.id, action: this.action(step, selection) },
        { channel: importChannel(selection.id) },
      ),
    );
    states[step.id] = { ...begin(state.message), sentAt: new Date(now).toISOString() };
    await save();

    return null;
  }

  private action(step: NodeImportStep, selection: ImportSelectionEntity): ImportAction {
    const copies = (step.copies ?? []).map((c) => ({ source: c.source, volume: volumeDockerName(c.volume) }));

    switch (step.kind) {
      case 'components':
        return { kind: 'components', script: buildComponentsScript() };
      case 'wipe-identity':
        return { kind: 'wipe-identity', clusterId: selection.joinPlan.former?.clusterId ?? '' };
      case 'precopy':
        return { kind: 'precopy', copies };
      case 'final-sync':
        return { kind: 'final-sync', copies };
      case 'stop':
        return { kind: 'stop', containers: step.containers ?? [] };
      default:
        return { kind: 'handover', containers: step.containers ?? [], ports: step.ports ?? [] };
    }
  }

  /** Source containers stopped by steps whose deployment isn't verified yet (they come back on a rollback). */
  private stoppedSources(selection: ImportSelectionEntity, states: Record<string, ImportStepState>): string[] {
    const verified = new Set(
      selection.joinPlan.steps.filter((s) => s.kind === 'verify' && finished(states[s.id])).map((s) => s.deployment),
    );

    return selection.joinPlan.steps
      .filter((s) => s.kind === 'stop' && finished(states[s.id]) && !verified.has(s.deployment))
      .flatMap((s) => s.containers ?? []);
  }

  private async fail(
    manager: EntityManager,
    selection: ImportSelectionEntity,
    states: Record<string, ImportStepState>,
    step: NodeImportStep,
    message: string,
  ): Promise<string | null> {
    const repo = manager.getRepository(ImportSelectionEntity);
    const stopped = this.stoppedSources(selection, states);
    const error = `${step.id}: ${message}`.slice(0, 4096);

    if (!stopped.length) {
      await repo.save(Object.assign(selection, { steps: states, status: 'failed', error }));
      await this.record(manager, selection, 'node.import-failed', { step: step.id, error });

      return null;
    }

    // Make-before-break: hold the imported copies again (they free the ports) and start the source.
    const verified = new Set(
      selection.joinPlan.steps.filter((s) => s.kind === 'verify' && finished(states[s.id])).map((s) => s.deployment),
    );

    states[ROLLBACK_STEP] = { status: 'pending', message: `rolling back after ${error}` };
    await repo.save(
      Object.assign(selection, {
        steps: states,
        error,
        released: (selection.released ?? []).filter((d) => verified.has(d)),
      }),
    );

    return `import of ${selection.node} rolls back`;
  }

  private async driveRollback(
    manager: EntityManager,
    selection: ImportSelectionEntity,
    states: Record<string, ImportStepState>,
    now: number,
  ): Promise<string | null> {
    const repo = manager.getRepository(ImportSelectionEntity);
    const state = states[ROLLBACK_STEP];

    if (state.status === 'done' || state.status === 'failed') {
      const status = state.status === 'done' ? 'rolled-back' : 'failed';
      const error = state.status === 'done' ? selection.error : `${selection.error}; rollback failed: ${state.message}`;

      await repo.save(Object.assign(selection, { steps: states, status, error }));
      await this.record(manager, selection, `node.import-${status}`, { error });

      return null;
    }

    if (state.sentAt && now - Date.parse(state.sentAt) < RESEND_MS) return null;

    const session = this.sessions.get(selection.node);

    if (!session) return null;

    const containers = this.stoppedSources(selection, states);

    session.send(
      controlPlaneMessage(
        'importStep',
        {
          import: selection.id,
          step: ROLLBACK_STEP,
          action: { kind: 'restart-source', containers, restartPolicies: selection.restartPolicies ?? {} },
        },
        { channel: importChannel(selection.id) },
      ),
    );
    states[ROLLBACK_STEP] = {
      ...state,
      status: 'running',
      startedAt: state.startedAt ?? new Date(now).toISOString(),
      sentAt: new Date(now).toISOString(),
    };
    await repo.save(Object.assign(selection, { steps: states }));

    return null;
  }

  /** Step progress from the node: only on the import's channel, only from the node it imports. */
  async recordProgress(node: string, progress: ImportProgress, channel: string | undefined): Promise<boolean> {
    if (channel !== importChannel(progress.import)) return false;

    return await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(ImportSelectionEntity);
      const selection = await repo.findOne({ where: { id: progress.import }, lock: { mode: 'pessimistic_write' } });

      if (!selection || selection.node !== node || selection.status !== 'running') return false;

      const known = progress.step === ROLLBACK_STEP || selection.joinPlan.steps.some((s) => s.id === progress.step);

      if (!known) return false;

      const current = selection.steps?.[progress.step] ?? { status: 'pending' };

      // A late "running" never overwrites a result.
      if (progress.status === 'running' && (current.status === 'done' || current.status === 'failed')) return true;

      const next: ImportStepState = {
        ...current,
        status: progress.status,
        startedAt: current.startedAt ?? new Date().toISOString(),
        ...(progress.message ? { message: progress.message } : {}),
        ...(progress.bytes !== undefined ? { bytes: progress.bytes } : {}),
        ...(progress.status !== 'running' ? { finishedAt: new Date().toISOString() } : {}),
      };

      await repo.save(
        Object.assign(selection, {
          steps: { ...(selection.steps ?? {}), [progress.step]: next },
          restartPolicies: { ...(selection.restartPolicies ?? {}), ...(progress.restartPolicies ?? {}) },
        }),
      );

      return true;
    });
  }

  private async record(
    manager: EntityManager,
    selection: ImportSelectionEntity,
    action: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record(manager, {
      actor: { type: 'system', id: 'import-controller' },
      action,
      target: `node/${selection.node}`,
      details: { selection: selection.id, planId: selection.planId, ...details },
    });
  }
}
