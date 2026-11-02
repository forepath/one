import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, IsNull, LessThanOrEqual, Not } from 'typeorm';

import { ADVISORY_LOCK_PLACEMENT_ALLOCATION } from '../constants/control-plane.constants';
import { WorkloadPlacementEntity } from '../entities/workload-placement.entity';
import { drainFinished } from '../utils/replica-drain.utils';
import { NetworkStateService } from './network-state.service';
import { writesPaused } from '../database-handover/database-target.runtime';

const TICK_MS = 2_000;
const ADVISORY_LOCK_REPLICA_DRAIN = 0x4c570045;

/**
 * Second phase of a replica's removal (M6 gate): placements whose drain ended are deleted and the network is
 * recompiled, so the agent stops the container (its normal stop with the service's grace period). Leader-elected
 * per tick (advisory lock); the deadline lives in the placement, so drains continue across restarts. Runs whatever
 * `LOADWEAVER_WORKLOAD_CONTROLLER` says — removed replicas must not run forever.
 */
@Injectable()
export class ReplicaDrainService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ReplicaDrainService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly network: NetworkStateService,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.safeTick(), TICK_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async safeTick(): Promise<void> {
    if (writesPaused('Replica drain', this.logger)) return;

    if (this.running) return;

    this.running = true;

    try {
      await this.tick();
    } catch (error) {
      this.logger.warn(`Replica drain: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }

  /** Deletes the placements whose drain ended; returns their ids. */
  async tick(now: Date = new Date()): Promise<string[]> {
    const finished = await this.dataSource.transaction(async (manager) => {
      const [{ locked }] = await manager.query('SELECT pg_try_advisory_xact_lock($1) AS locked', [
        ADVISORY_LOCK_REPLICA_DRAIN,
      ]);

      if (!locked) return [];

      const repo = manager.getRepository(WorkloadPlacementEntity);
      const candidates = await repo.find({
        select: { id: true, drainUntil: true },
        where: { drainUntil: LessThanOrEqual(now), cronRun: IsNull() },
      });

      if (candidates.length === 0) return [];

      // Placements change one writer at a time (plans, failover, drains, cron runs, the autoscaler).
      await manager.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK_PLACEMENT_ALLOCATION]);

      // Re-read under the lock: a plan may have kept a replica (drain ended) meanwhile.
      const due = (
        await repo.find({ select: { id: true, drainUntil: true }, where: { drainUntil: Not(IsNull()) } })
      ).filter((p) => drainFinished(p, now));

      for (const p of due) await repo.delete({ id: p.id, drainUntil: Not(IsNull()) });

      return due.map((p) => p.id);
    });

    if (finished.length > 0) {
      this.logger.log(`Drained replicas stopped: ${finished.join(', ')}`);
      this.network.requestRecompile('replicas drained');
    }

    return finished;
  }
}
