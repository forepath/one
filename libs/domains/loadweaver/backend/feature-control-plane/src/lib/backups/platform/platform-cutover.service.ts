import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Client as PgClient } from 'pg';
import { DataSource, In, Not } from 'typeorm';

import { NodeEntity } from '../../entities/node.entity';
import { AuditLogService, type AuditActor } from '../../services/audit-log.service';
import { NetworkStateService } from '../../services/network-state.service';
import { nodeAddress } from '../../services/object-store-controller.service';
import { PlatformRestoreEntity } from './platform-backups.entities';
import { PlatformBackupsService } from './platform-backups.service';
import { CLONE_PORTS } from './platform-backups.utils';
import { PlatformCutoverEntity, type PlatformCutoverPlan } from './platform-dr.entities';
import { cutoverPlan, cutoverRefusal } from './platform-dr.utils';

const TICK_MS = 10_000;
/** A switch that hasn't converged after this long is failed (manual recovery, see the docs). */
const SWITCH_TIMEOUT_MS = Number(process.env['LOADWEAVER_PLATFORM_CUTOVER_TIMEOUT_MS'] ?? 30 * 60_000);
const PATRONI_PORT = 8008;

/**
 * Definition of `lw_platform_cutovers` as migration 037 creates it: the control plane also creates it in the clone's
 * database before the switch, so a clone of a time before the migration knows the cut-over too.
 */
export const CUTOVER_TABLE_DDL = [
  `CREATE TABLE IF NOT EXISTS "lw_platform_cutovers" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "restore_id" uuid NOT NULL,
    "state" varchar(16) NOT NULL,
    "node" varchar(63) NOT NULL,
    "scope" varchar(63) NOT NULL,
    "previous_scope" varchar(63) NOT NULL,
    "target_time" TIMESTAMPTZ,
    "plan" jsonb NOT NULL,
    "requested_by" varchar(255) NOT NULL,
    "approved_by" varchar(255),
    "approved_at" TIMESTAMPTZ,
    "final_backup" varchar(128),
    "error" text,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "switched_at" TIMESTAMPTZ,
    "finished_at" TIMESTAMPTZ
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_lw_platform_cutovers_active" ON "lw_platform_cutovers" ((true))
    WHERE "state" IN ('planned', 'approved', 'switching')`,
];

export interface PlatformCutoverDto {
  id: string;
  restoreId: string;
  state: string;
  node: string;
  scope: string;
  previousScope: string;
  targetTime: string | null;
  plan: PlatformCutoverPlan;
  requestedBy: string;
  approvedBy: string | null;
  approvedAt: string | null;
  finalBackup: string | null;
  error: string | null;
  createdAt: string;
  switchedAt: string | null;
  finishedAt: string | null;
}

function toDto(r: PlatformCutoverEntity): PlatformCutoverDto {
  return {
    id: r.id,
    restoreId: r.restoreId,
    state: r.state,
    node: r.node,
    scope: r.scope,
    previousScope: r.previousScope,
    targetTime: r.targetTime?.toISOString() ?? null,
    plan: r.plan,
    requestedBy: r.requestedBy,
    approvedBy: r.approvedBy,
    approvedAt: r.approvedAt?.toISOString() ?? null,
    finalBackup: r.finalBackup,
    error: r.error,
    createdAt: r.createdAt.toISOString(),
    switchedAt: r.switchedAt?.toISOString() ?? null,
    finishedAt: r.finishedAt?.toISOString() ?? null,
  };
}

function actorId(actor: AuditActor): string {
  return actor.id ? `${actor.type}:${actor.id}` : actor.type;
}

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2000);
}

export interface PatroniView {
  state?: string;
  role?: string;
  patroni?: { scope?: string; name?: string };
}

/**
 * Cut-over of the control-plane database to a ready point-in-time clone (3.20): a plan (steps, warnings: data after the
 * target time is lost) requested by a cluster admin and approved by a second one; then a final base backup of the
 * current timeline, the cut-over written into the clone's database, and the members switch through their desired
 * state (`postgresCutover`): the clone's member adopts it as `lw-postgres`, the others start again as its replicas.
 * The control plane continues on the clone and finishes the cut-over from the row it wrote there.
 */
@Injectable()
export class PlatformCutoverService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PlatformCutoverService.name);
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly backups: PlatformBackupsService,
    private readonly audit: AuditLogService,
    @Optional() private readonly network?: NetworkStateService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.backups.enabled()) return;

    this.timer = setInterval(() => void this.safeTick(), TICK_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async safeTick(): Promise<void> {
    if (this.ticking) return;

    this.ticking = true;

    try {
      await this.tick();
    } catch (error) {
      this.logger.warn(`Cut-over: ${message(error)}`);
    } finally {
      this.ticking = false;
    }
  }

  async list(): Promise<PlatformCutoverDto[]> {
    return (
      await this.dataSource.getRepository(PlatformCutoverEntity).find({ order: { createdAt: 'DESC' }, take: 20 })
    ).map(toDto);
  }

  private async members(): Promise<NodeEntity[]> {
    return await this.dataSource
      .getRepository(NodeEntity)
      .find({ where: { controlPlane: true, witness: false, lifecycle: Not('left') }, order: { name: 'ASC' } });
  }

  /** Plans the cut-over to a ready clone (cluster admins); nothing changes before a second admin approves. */
  async request(restoreId: string, actor: AuditActor, now = new Date()): Promise<PlatformCutoverDto> {
    const restore = await this.dataSource.getRepository(PlatformRestoreEntity).findOne({ where: { id: restoreId } });
    const members = await this.members();
    const active = await this.dataSource
      .getRepository(PlatformCutoverEntity)
      .exists({ where: { state: In(['planned', 'approved', 'switching']) } });
    const refusal = cutoverRefusal(
      restore,
      members.map((m) => ({ name: m.name, connected: m.connected, features: m.protocolFeatures })),
      active,
    );

    if (!restore) throw new NotFoundException('restore not found');

    if (refusal) throw new ConflictException(refusal);

    const row = await this.dataSource.transaction(async (manager) => {
      const saved = await manager.getRepository(PlatformCutoverEntity).save(
        manager.getRepository(PlatformCutoverEntity).create({
          restoreId: restore.id,
          state: 'planned',
          node: restore.node,
          scope: restore.scope,
          previousScope: restore.sourceScope,
          targetTime: restore.targetTime,
          plan: cutoverPlan({
            restoreId: restore.id,
            node: restore.node,
            scope: restore.scope,
            previousScope: restore.sourceScope,
            targetTime: restore.targetTime,
            readyAt: restore.readyAt,
            members: members.map((m) => m.name),
            now,
          }),
          requestedBy: actorId(actor),
          approvedBy: null,
          approvedAt: null,
          finalBackup: null,
          error: null,
          switchedAt: null,
          finishedAt: null,
        }),
      );

      await this.audit.record(manager, {
        actor,
        action: 'backup.platform-cutover-planned',
        target: `platform/postgres/cutover/${saved.id}`,
        details: { restore: restore.id, scope: restore.scope, dataLossAfter: saved.plan.dataLossAfter },
      });

      return saved;
    });

    return toDto(row);
  }

  /** A second cluster admin approves (never the requester); the switch starts with the next tick. */
  async approve(id: string, actor: AuditActor): Promise<PlatformCutoverDto> {
    const row = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(PlatformCutoverEntity);
      const current = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });

      if (!current) throw new NotFoundException('cut-over not found');

      if (current.state !== 'planned') throw new ConflictException(`the cut-over is ${current.state}`);

      if (actorId(actor) === current.requestedBy)
        throw new ForbiddenException('a second cluster admin has to approve the cut-over (not the requester)');

      await repo.update({ id }, { state: 'approved', approvedBy: actorId(actor), approvedAt: new Date() });
      await this.audit.record(manager, {
        actor,
        action: 'backup.platform-cutover-approved',
        target: `platform/postgres/cutover/${id}`,
        details: { restore: current.restoreId, scope: current.scope },
      });

      return (await repo.findOne({ where: { id } })) as PlatformCutoverEntity;
    });

    void this.safeTick();

    return toDto(row);
  }

  async cancel(id: string, actor: AuditActor): Promise<PlatformCutoverDto> {
    const row = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(PlatformCutoverEntity);
      const current = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });

      if (!current) throw new NotFoundException('cut-over not found');

      if (current.state !== 'planned' && current.state !== 'approved')
        throw new BadRequestException(`the cut-over is ${current.state} and can't be cancelled`);

      await repo.update({ id }, { state: 'cancelled', finishedAt: new Date() });
      await this.audit.record(manager, {
        actor,
        action: 'backup.platform-cutover-cancelled',
        target: `platform/postgres/cutover/${id}`,
      });

      return (await repo.findOne({ where: { id } })) as PlatformCutoverEntity;
    });

    return toDto(row);
  }

  /** Advances the active cut-over: approved → switching (final backup, clone written), switching → done. */
  async tick(now = new Date()): Promise<void> {
    // One step at a time on this replica (the timer, an approval and callers may overlap).
    while (this.step) await this.step;

    this.step = this.advance(now).finally(() => (this.step = null));

    await this.step;
  }

  private step: Promise<void> | null = null;

  private async advance(now: Date): Promise<void> {
    const repo = this.dataSource.getRepository(PlatformCutoverEntity);
    const row = await repo.findOne({ where: { state: In(['approved', 'switching']) } });

    if (!row) return;

    if (row.state === 'approved') await this.switchOver(row);
    else await this.watch(row, now);
  }

  /** Where the clone's database is reached (the member's overlay address; overridable for tests). */
  protected cloneDatabase(node: NodeEntity): { host: string; port: number } | null {
    const address = nodeAddress(node);

    return address ? { host: address, port: CLONE_PORTS.pg } : null;
  }

  /** A member's Patroni REST API (overridable for tests). */
  protected patroniUrl(node: NodeEntity): string | null {
    const address = nodeAddress(node);

    return address ? `http://${address.includes(':') ? `[${address}]` : address}:${PATRONI_PORT}/patroni` : null;
  }

  private async fail(row: PlatformCutoverEntity, error: string): Promise<void> {
    await this.dataSource
      .getRepository(PlatformCutoverEntity)
      .update({ id: row.id }, { state: 'failed', error, finishedAt: new Date() });
    await this.audit.recordStandalone({
      actor: { type: 'system' },
      action: 'backup.platform-cutover-failed',
      target: `platform/postgres/cutover/${row.id}`,
      details: { error },
    });
    this.network?.requestRecompile('platform cut-over failed');
  }

  private async switchOver(row: PlatformCutoverEntity): Promise<void> {
    const restore = await this.dataSource
      .getRepository(PlatformRestoreEntity)
      .findOne({ where: { id: row.restoreId } });
    const members = await this.members();
    const refusal = cutoverRefusal(
      restore,
      members.map((m) => ({ name: m.name, connected: m.connected, features: m.protocolFeatures })),
      false,
    );

    if (refusal) return await this.fail(row, refusal);

    // 1. A final base backup of the current timeline (kept under the previous scope; retention moves to the new one).
    const final = await this.backups.run('postgres', { type: 'system' });

    if (final.status === 'busy') return; // a scheduled run is in progress: next tick

    if (final.status !== 'succeeded') return await this.fail(row, `final base backup failed: ${final.error}`);

    const switchedAt = new Date();
    const switching = { ...row, state: 'switching' as const, finalBackup: final.backup, switchedAt };

    // 2. The cut-over into the clone's database: the control plane continues there and needs to know.
    const node = members.find((m) => m.name === row.node) as NodeEntity;

    try {
      await this.writeIntoClone(node, switching);
    } catch (error) {
      return await this.fail(row, `writing the cut-over into the clone failed: ${message(error)}`);
    }

    // 3. Switch: members get `postgresCutover` with the next desired state.
    await this.dataSource.transaction(async (manager) => {
      await manager
        .getRepository(PlatformCutoverEntity)
        .update({ id: row.id }, { state: 'switching', finalBackup: final.backup, switchedAt });
      await manager.getRepository(PlatformRestoreEntity).update({ id: row.restoreId }, { state: 'adopted' });
      await this.audit.record(manager, {
        actor: { type: 'system' },
        action: 'backup.platform-cutover-started',
        target: `platform/postgres/cutover/${row.id}`,
        details: { scope: row.scope, previousScope: row.previousScope, finalBackup: final.backup },
      });
    });
    this.logger.warn(`Cut-over ${row.id}: switching the control-plane database to scope ${row.scope}`);
    this.network?.requestRecompile('platform cut-over');
  }

  /** Writes the cut-over (switching) and the adopted restore into the clone's database (one transaction). */
  private async writeIntoClone(node: NodeEntity, row: PlatformCutoverEntity): Promise<void> {
    const target = this.cloneDatabase(node);

    if (!target) throw new Error(`${node.name} has no overlay address`);

    const sslMode = process.env['LOADWEAVER_PLATFORM_CLONE_SSL'] ?? 'require';
    const client = new PgClient({
      host: target.host,
      port: target.port,
      user: process.env['DB_USERNAME'] || 'postgres',
      password: process.env['DB_PASSWORD'] ?? '',
      database: process.env['DB_DATABASE'] || 'postgres',
      // The clone serves Spilo's certificate; the connection runs over the member overlay (WireGuard).
      ssl: sslMode === 'disable' ? false : { rejectUnauthorized: false },
      connectionTimeoutMillis: 15_000,
      statement_timeout: 60_000,
    });

    await client.connect();

    try {
      await client.query('BEGIN');

      for (const ddl of CUTOVER_TABLE_DDL) await client.query(ddl);

      // Cut-overs that were open at the clone's time never happened afterwards.
      await client.query(
        `UPDATE lw_platform_cutovers SET state = 'cancelled', finished_at = now()
         WHERE state IN ('planned', 'approved', 'switching') AND id <> $1`,
        [row.id],
      );
      await client.query(
        `INSERT INTO lw_platform_cutovers (id, restore_id, state, node, scope, previous_scope, target_time, plan,
           requested_by, approved_by, approved_at, final_backup, error, created_at, switched_at, finished_at)
         VALUES ($1, $2, 'switching', $3, $4, $5, $6, $7, $8, $9, $10, $11, NULL, $12, $13, NULL)
         ON CONFLICT (id) DO UPDATE SET state = 'switching', final_backup = EXCLUDED.final_backup,
           switched_at = EXCLUDED.switched_at`,
        [
          row.id,
          row.restoreId,
          row.node,
          row.scope,
          row.previousScope,
          row.targetTime,
          JSON.stringify(row.plan),
          row.requestedBy,
          row.approvedBy,
          row.approvedAt,
          row.finalBackup,
          row.createdAt,
          row.switchedAt,
        ],
      );

      const [{ exists }] = (await client.query(`SELECT to_regclass('lw_platform_restores') IS NOT NULL AS exists`))
        .rows as { exists: boolean }[];

      if (exists) {
        await client.query(
          `UPDATE lw_platform_restores SET state = 'discarded', finished_at = now()
           WHERE state IN ('requested', 'restoring', 'ready') AND id <> $1`,
          [row.restoreId],
        );
        await client.query(
          `INSERT INTO lw_platform_restores (id, kind, state, node, scope, source_scope, target_time, requested_by,
             created_at, ready_at)
           SELECT $1, 'postgres', 'adopted', $2, $3, $4, $5, $6, now(), now()
           ON CONFLICT (id) DO UPDATE SET state = 'adopted'`,
          [row.restoreId, row.node, row.scope, row.previousScope, row.targetTime, row.requestedBy],
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  private async patroni(node: NodeEntity): Promise<PatroniView | null> {
    const url = this.patroniUrl(node);

    if (!url) return null;

    return await fetch(url, { signal: AbortSignal.timeout(5_000), redirect: 'error' })
      .then(async (res) => (await res.json()) as PatroniView)
      .catch(() => null);
  }

  /** Done once every member's Patroni runs in the new scope and the adopting member leads. */
  private async watch(row: PlatformCutoverEntity, now: Date): Promise<void> {
    const members = await this.members();
    const views = await Promise.all(members.map(async (m) => ({ node: m.name, view: await this.patroni(m) })));
    const converged =
      views.length > 0 &&
      views.every((v) => v.view?.state === 'running' && v.view.patroni?.scope === row.scope) &&
      views.some((v) => v.node === row.node && (v.view?.role === 'master' || v.view?.role === 'primary'));

    if (!converged) {
      if (row.switchedAt && now.getTime() - row.switchedAt.getTime() > SWITCH_TIMEOUT_MS)
        await this.fail(
          row,
          `the members did not converge on scope ${row.scope}: ${views
            .map((v) => `${v.node}=${v.view?.patroni?.scope ?? 'unreachable'}/${v.view?.state ?? '-'}`)
            .join(', ')}`,
        );

      return;
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(PlatformCutoverEntity).update({ id: row.id }, { state: 'done', finishedAt: now });
      await manager.getRepository(PlatformRestoreEntity).update({ id: row.restoreId }, { state: 'adopted' });
      await this.audit.record(manager, {
        actor: { type: 'system' },
        action: 'backup.platform-cutover-completed',
        target: `platform/postgres/cutover/${row.id}`,
        details: { scope: row.scope, previousScope: row.previousScope, finalBackup: row.finalBackup },
      });
    });
    this.logger.log(`Cut-over ${row.id} done: the control-plane database runs in scope ${row.scope}`);
    this.network?.requestRecompile('platform cut-over done');
    // Point-in-time recovery under the new scope needs a base backup there.
    void this.backups
      .run('postgres', { type: 'system' })
      .catch((error: unknown) => this.logger.warn(`Base backup after the cut-over: ${message(error)}`));
  }
}
