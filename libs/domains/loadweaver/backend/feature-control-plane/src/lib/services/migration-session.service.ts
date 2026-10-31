import {
  controlPlaneMessage,
  messageAllowed,
  type MigrationProgress,
  type WorkloadSpec,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import type { RequestWithUser } from '@forepath/identity/backend';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, IsNull } from 'typeorm';

import { canReadProject } from '../access/access.utils';
import { ProjectAccessService } from '../access/project-access.service';
import { AgentSessionRegistry } from '../agent-stream/agent-session.registry';
import { MigrationEntity } from '../entities/migration.entity';
import { NodeEntity } from '../entities/node.entity';
import {
  sessionCommands,
  sessionOptionsFromEnv,
  type NodeReport,
  type SessionMethod,
  type SessionPhase,
  type SessionRecord,
} from '../utils/migration-state.utils';
import { FAILOVER_AFTER_MS, WorkloadControllerService } from './workload-controller.service';
import { writesPaused } from '../database-handover/database-target.runtime';

/** Commands not yet confirmed by the node are sent again after this long. */
const RESEND_MS = 10_000;
const SEND_INTERVAL_MS = 1_000;

/** One migration attempt as the API returns it (3.10). */
export interface MigrationHistoryDto {
  id: string;
  replica: string;
  project: string;
  deployment: string;
  fromNode: string;
  toNode: string;
  method: string;
  methodLabel: string;
  attempt: number;
  phase: string;
  reason: string;
  fallbackReason: string | null;
  freezeMs: number | null;
  checkpointBytes: number | null;
  precopyRounds: number | null;
  startedAt: string;
  finishedAt: string | null;
}

const REPLICA = /^[a-z0-9-]{1,63}\/[a-z0-9-]{1,63}\/[a-z0-9_.-]{1,63}\/\d{1,9}$/;
const NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Live migration sessions (3.10) on this control-plane replica: sends each active attempt's due commands to the
 * nodes whose stream this replica holds (idempotent, re-sent until reported), records the nodes' progress, and
 * serves the history. The phase transitions themselves are the workload controller's (leader-elected).
 */
@Injectable()
export class MigrationSessionService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly sent = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private sending = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly registry: AgentSessionRegistry,
    private readonly controller: WorkloadControllerService,
    private readonly access: ProjectAccessService,
  ) {}

  onApplicationBootstrap(): void {
    if ((process.env['LOADWEAVER_MIGRATION_SESSIONS'] ?? 'on') === 'off') return;

    this.timer = setInterval(() => {
      if (!writesPaused('Migration sessions')) void this.sendDue().catch(() => undefined);
    }, SEND_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Active checkpoint attempts with everything their commands need. */
  private async activeSessions(): Promise<SessionRecord[]> {
    const rows = await this.dataSource
      .getRepository(MigrationEntity)
      .createQueryBuilder('m')
      .addSelect(['m.spec', 'm.token'])
      .where('m.finished_at IS NULL')
      .andWhere(`m.method IN ('live', 'stop-and-copy', 'vm-live')`)
      .getMany();

    if (rows.length === 0) return [];

    const nodes = await this.dataSource.getRepository(NodeEntity).find();
    const lost = new Set(
      nodes
        .filter((n) => !n.witness && Date.now() - (n.lastSeenAt ?? n.joinedAt).getTime() > FAILOVER_AFTER_MS)
        .map((n) => n.name),
    );

    return rows.map((r) => ({
      id: r.id,
      attempt: r.attempt,
      replica: r.replica,
      fromNode: r.fromNode,
      toNode: r.toNode,
      method: r.method as SessionMethod,
      runtime: r.runtime ?? (r.method === 'vm-live' ? 'qemu' : 'runc'),
      phase: r.phase as SessionPhase,
      phaseStartedAt: r.phaseStartedAt.getTime(),
      token: r.token ?? '',
      addresses: r.addresses,
      volumes: r.volumes,
      spec: (r.spec as WorkloadSpec | null) ?? null,
      reports: r.reports,
      restoreSent: r.restoreSent,
      targetLost: lost.has(r.toNode),
    }));
  }

  /**
   * Sends the due commands of every active session to the nodes connected to this replica. Only nodes that
   * advertised `live-migration` (QEMU sessions: `vm-migration`) ever get one (the session's `send` drops them for
   * others, too).
   */
  async sendDue(now = Date.now()): Promise<number> {
    if (this.sending) return 0;

    this.sending = true;

    try {
      const options = sessionOptionsFromEnv();
      let count = 0;
      const live = new Set<string>();

      for (const record of await this.activeSessions()) {
        for (const command of sessionCommands(record, now, options, this.controller.timeouts)) {
          const key = `${record.id}:${record.attempt}:${command.type}:${command.node}`;
          const session = this.registry.get(command.node);

          live.add(key);

          if (!session || !messageAllowed(command.type, session.protocol)) continue;

          if (now - (this.sent.get(key) ?? 0) < RESEND_MS) continue;

          session.send(controlPlaneMessage(command.type, command.payload as never, { channel: command.channel }));
          this.sent.set(key, now);
          count++;
        }
      }

      for (const key of this.sent.keys()) if (!live.has(key)) this.sent.delete(key);

      return count;
    } finally {
      this.sending = false;
    }
  }

  /**
   * Progress from a node (on the session's channel). Only the attempt's source or target may report, only for the
   * current attempt; the report is merged atomically per role and phase.
   */
  async recordProgress(nodeName: string, progress: MigrationProgress, channel: string | undefined): Promise<boolean> {
    if (channel !== `migration:${progress.migration}`) return false;

    const row = await this.dataSource
      .getRepository(MigrationEntity)
      .findOne({ where: { id: progress.migration, finishedAt: IsNull() } });

    if (!row || row.attempt !== progress.attempt || row.replica !== progress.replica) return false;

    const role = nodeName === row.fromNode ? 'source' : nodeName === row.toNode ? 'target' : null;

    if (!role) return false;

    // The source streams memory (incl. secrets) to this endpoint: only the target's own overlay addresses count.
    if (progress.endpoint) {
      const target = await this.dataSource.getRepository(NodeEntity).findOne({ where: { name: row.toNode } });

      if (role !== 'target' || ![target?.overlayV4, target?.overlayV6].includes(progress.endpoint.address))
        return false;
    }

    const report: NodeReport = {
      status: progress.status,
      at: new Date().toISOString(),
      ...(progress.error ? { error: progress.error } : {}),
      ...(progress.endpoint ? { endpoint: progress.endpoint } : {}),
      ...(progress.resumed !== undefined ? { resumed: progress.resumed } : {}),
      ...(progress.round !== undefined ? { round: progress.round } : {}),
      ...(progress.bytes !== undefined ? { bytes: progress.bytes } : {}),
      ...(progress.totalBytes !== undefined ? { totalBytes: progress.totalBytes } : {}),
      ...(progress.dirtyBytesPerSecond !== undefined ? { dirtyBytesPerSecond: progress.dirtyBytesPerSecond } : {}),
      ...(progress.freezeMs !== undefined ? { freezeMs: progress.freezeMs } : {}),
    };

    // A finished phase stays finished: late `running` reports never overwrite `done` / `failed`.
    await this.dataSource.query(
      `UPDATE lw_migrations
          SET reports = reports || jsonb_build_object(
                CAST($2 AS text),
                COALESCE(reports -> CAST($2 AS text), '{}'::jsonb) || jsonb_build_object(CAST($3 AS text), CAST($4 AS jsonb)))
        WHERE id = $1 AND attempt = $5 AND finished_at IS NULL
          AND COALESCE(reports #>> ARRAY[CAST($2 AS text), CAST($3 AS text), 'status'], 'running') = 'running'`,
      [row.id, role, progress.phase, JSON.stringify(report), row.attempt],
    );
    // Freeze-critical steps (transfer done → restore, restore done → cut-over) shouldn't wait for the next poll.
    this.controller.requestTick();

    return true;
  }

  /** Migration history (3.10), scoped like placements: cluster roles see all, others their projects. */
  async history(
    req: RequestWithUser | undefined,
    filter: { replica?: string; deployment?: string; project?: string; limit?: number },
  ): Promise<MigrationHistoryDto[]> {
    if (filter.replica !== undefined && !REPLICA.test(filter.replica))
      throw new BadRequestException('replica must be <project>/<deployment>/<service>/<index>');

    if (filter.project !== undefined && !NAME.test(filter.project)) throw new BadRequestException('invalid project');

    if (filter.deployment !== undefined && !NAME.test(filter.deployment))
      throw new BadRequestException('invalid deployment');

    if (filter.deployment !== undefined && filter.project === undefined)
      throw new BadRequestException('deployment needs project');

    const caller = await this.access.caller(req);
    const project = filter.project ?? filter.replica?.split('/')[0];

    if (project && !caller.clusterRole && !canReadProject(caller, project))
      throw new NotFoundException('project not found');

    const query = this.dataSource
      .getRepository(MigrationEntity)
      .createQueryBuilder('m')
      .orderBy('m.started_at', 'DESC')
      .addOrderBy('m.attempt', 'DESC')
      .take(Math.min(Math.max(filter.limit ?? 100, 1), 500));

    if (filter.replica) query.andWhere('m.replica = :replica', { replica: filter.replica });

    if (project) query.andWhere('m.project = :project', { project });

    if (filter.deployment) query.andWhere('m.deployment = :deployment', { deployment: filter.deployment });

    if (!caller.clusterRole) {
      const readable = [...caller.projects.keys()].filter((p) => canReadProject(caller, p));

      query.andWhere('m.project IN (:...readable)', { readable: readable.length > 0 ? readable : [''] });
    }

    return (await query.getMany()).map((r) => ({
      id: r.id,
      replica: r.replica,
      project: r.project,
      deployment: r.deployment,
      fromNode: r.fromNode,
      toNode: r.toNode,
      method: r.method,
      methodLabel: r.methodLabel,
      attempt: r.attempt,
      phase: r.phase,
      reason: r.reason,
      fallbackReason: r.fallbackReason,
      freezeMs: r.freezeMs,
      checkpointBytes: r.checkpointBytes === null ? null : Number(r.checkpointBytes),
      precopyRounds: r.precopyRounds,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
    }));
  }
}
