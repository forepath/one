import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindManyOptions, MoreThanOrEqual, Repository } from 'typeorm';

import { DeploymentRunEntity } from '../entities/deployment-run.entity';
import { DeploymentWorkflowEntity } from '../entities/deployment-workflow.entity';

import { DeploymentRealtimeService } from './deployment-realtime.service';
import { DeploymentRunsService } from './deployment-runs.service';
import { DeploymentWorkflowsService } from './deployment-workflows.service';

const DEFAULT_RELAY_INTERVAL_MS = 5_000;

/**
 * Millisecond cursor plus the ids already relayed at that millisecond: Postgres keeps microseconds while JS dates
 * keep milliseconds, so a strict `>` on the truncated value would re-emit the newest row on every pass.
 */
interface RelayCursor {
  at: Date;
  seen: Set<string>;
}
const RELAY_BATCH = 200;

export function getDeploymentRealtimeRelayIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number.parseInt(env['DEPLOYMENT_REALTIME_RELAY_INTERVAL_MS'] ?? '', 10);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_RELAY_INTERVAL_MS;
}

/**
 * Relays deployment changes made outside the socket-serving process to the browser. The run poller and the history
 * sync run in the queue worker (`QUEUE_ROLE=worker`), which has no Socket.IO server, so their direct emits are no-ops
 * there. Every API process (the only ones that start the relay, from the clients gateway) picks up run / workflow rows
 * changed since its cursor and emits them to the workspace rooms of its own sockets. Upserts are idempotent for the
 * console, so rows that the API process already emitted directly are harmless duplicates.
 */
@Injectable()
export class DeploymentRealtimeRelayService implements OnModuleDestroy {
  private readonly logger = new Logger(DeploymentRealtimeRelayService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private runCursor: RelayCursor | null = null;
  private workflowCursor: RelayCursor | null = null;

  constructor(
    @InjectRepository(DeploymentRunEntity)
    private readonly runRepo: Repository<DeploymentRunEntity>,
    @InjectRepository(DeploymentWorkflowEntity)
    private readonly workflowRepo: Repository<DeploymentWorkflowEntity>,
    private readonly runs: DeploymentRunsService,
    private readonly workflows: DeploymentWorkflowsService,
    private readonly realtime: DeploymentRealtimeService,
  ) {}

  /** Starts relaying (idempotent); `0` disables it. */
  start(intervalMs = getDeploymentRealtimeRelayIntervalMs()): void {
    if (this.timer || intervalMs <= 0) {
      return;
    }

    this.runCursor = { at: new Date(), seen: new Set() };
    this.workflowCursor = { at: new Date(), seen: new Set() };
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** One relay pass (exposed for tests). */
  async tick(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;

    try {
      this.runCursor = await this.relay(this.runRepo, this.runCursor, { workflowEntity: true }, (row) =>
        this.realtime.emitRunUpsert(this.runs.toSummary(row as DeploymentRunEntity)),
      );
      this.workflowCursor = await this.relay(this.workflowRepo, this.workflowCursor, { connection: true }, (row) =>
        this.realtime.emitWorkflowUpsert(this.workflows.toSummary(row as DeploymentWorkflowEntity)),
      );
    } catch (error) {
      this.logger.warn(`Deployment realtime relay failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async relay<T extends { id: string; updatedAt: Date }>(
    repo: Repository<T>,
    cursor: RelayCursor | null,
    relations: Record<string, boolean>,
    emit: (row: T) => void,
  ): Promise<RelayCursor> {
    const current = cursor ?? { at: new Date(), seen: new Set<string>() };
    // Generic over both entities: TypeORM cannot type `where` / `order` on an unconstrained `T`.
    const options = {
      where: { updatedAt: MoreThanOrEqual(current.at) },
      relations,
      order: { updatedAt: 'ASC', id: 'ASC' },
      take: RELAY_BATCH,
    } as unknown as FindManyOptions<T>;
    const rows = await repo.find(options);
    let at = current.at;
    let seen = current.seen;

    for (const row of rows) {
      const rowMs = row.updatedAt.getTime();

      if (rowMs === at.getTime() && seen.has(row.id)) {
        continue;
      }

      emit(row);

      if (rowMs !== at.getTime()) {
        at = new Date(rowMs);
        seen = new Set();
      }

      seen.add(row.id);
    }

    return { at, seen };
  }
}
