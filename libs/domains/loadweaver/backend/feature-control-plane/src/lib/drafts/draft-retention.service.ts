import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, LessThan } from 'typeorm';

import { AuditLogService } from '../services/audit-log.service';
import { DraftEntity } from './draft.entity';
import { writesPaused } from '../database-handover/database-target.runtime';

/** Workspace draft retention (3.36, decided 2026-10-27). */
export const DRAFT_IDLE_DAYS = 30;
export const DRAFT_KEEP_DAYS = 90;
const TICK_MS = 60 * 60_000;
/** One replica runs the pass (transaction-scoped advisory lock). */
export const ADVISORY_LOCK_DRAFT_RETENTION = 0x4c570047;
const DAY_MS = 86_400_000;

/**
 * Open drafts nobody touched for 30 days are discarded (audited `draft.expire`, the owner sees it in the draft list);
 * submitted / discarded drafts are kept 90 days for the audit trail, then purged. Hourly, on one replica.
 */
@Injectable()
export class DraftRetentionService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DraftRetentionService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditLogService,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      if (writesPaused('Draft retention', this.logger)) return;

      this.tick().catch((error) =>
        this.logger.warn(`Draft retention: ${error instanceof Error ? error.message : String(error)}`),
      );
    }, TICK_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass: expired open drafts → discarded, old closed drafts → purged. Returns the counts. */
  async tick(now = Date.now()): Promise<{ expired: number; purged: number }> {
    return await this.dataSource.transaction(async (manager) => {
      const [{ locked }] = await manager.query('SELECT pg_try_advisory_xact_lock($1) AS locked', [
        ADVISORY_LOCK_DRAFT_RETENTION,
      ]);

      if (!locked) return { expired: 0, purged: 0 };

      const repo = manager.getRepository(DraftEntity);
      const idle = await repo.find({
        where: { status: 'open', updatedAt: LessThan(new Date(now - DRAFT_IDLE_DAYS * DAY_MS)) },
        take: 500,
      });

      let expired = 0;

      for (const draft of idle) {
        // Version-guarded: an edit in the meantime keeps the draft open.
        const result = await repo.update(
          { id: draft.id, version: draft.version, status: 'open' },
          { status: 'discarded', version: draft.version + 1 },
        );

        if (!result.affected) continue;

        expired += 1;
        await this.audit.record(manager, {
          actor: { type: 'system', id: null },
          action: 'draft.expire',
          target: `draft/${draft.id}`,
          project: draft.projects.length === 1 ? draft.projects[0] : null,
          details: { owner: draft.owner, title: draft.title, ops: draft.ops.length, idleDays: DRAFT_IDLE_DAYS },
        });
      }

      const purged = await repo.delete({
        status: In(['submitted', 'discarded']),
        updatedAt: LessThan(new Date(now - DRAFT_KEEP_DAYS * DAY_MS)),
      });

      return { expired, purged: purged.affected ?? 0 };
    });
  }
}
