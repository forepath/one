import type { RequestWithUser } from '@forepath/identity/backend';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Not } from 'typeorm';

import { canReadProject, type AccessCaller } from '../access/access.utils';
import { BackupKeyEntity } from '../backups/backup.entities';
import { backupPins } from '../backups/backup.utils';
import { ProjectAccessService } from '../access/project-access.service';
import { NODE_HEARTBEAT_TIMEOUT_MS } from '../constants/control-plane.constants';
import { databaseTarget } from '../database-handover/database-target.runtime';
import { NodeEntity } from '../entities/node.entity';
import { PlanEntity } from '../entities/plan.entity';
import { ResourceEntity } from '../entities/resource.entity';
import { VolumePlacementEntity } from '../entities/volume-placement.entity';
import { WorkloadPlacementEntity } from '../entities/workload-placement.entity';
import { MetricsStore } from '../metrics/metrics.store';
import {
  healthChanges,
  healthTree,
  stateDurations,
  type HealthInput,
  type HealthNode,
  type HealthReason,
  type HealthState,
} from './health-tree.utils';

const TICK_MS = 30_000;
const ADVISORY_LOCK_HEALTH = 0x4c570018;

export interface HealthEntityDto {
  key: string;
  kind: HealthNode['kind'];
  name: string;
  parent: string | null;
  project: string | null;
  state: HealthState;
  reasons: HealthReason[];
  since: string;
}

/** The read-only fallback's in-memory evaluation (one per process; see `HealthService.live`). */
let liveRows: HealthRow[] | null = null;

/**
 * One entity's health as of now while the control plane is read-only (the in-memory evaluation), else `null`. Health
 * states as of now while the control plane is read-only (the in-memory evaluation), else `null` — readers that
 * query `lw_health` inside their own transactions (topology, status pages) prefer this over the frozen rows.
 */
export function liveHealthRow(key: string): HealthRow | null {
  return liveRows && databaseTarget.fallback ? (liveRows.find((r) => r.key === key) ?? null) : null;
}

/** See {@link liveHealthRow}: the states only. */
export function liveHealthStates(): Map<string, HealthState> | null {
  return liveRows && databaseTarget.fallback ? new Map(liveRows.map((r) => [r.key, r.state])) : null;
}

export interface HealthRow {
  key: string;
  kind: HealthNode['kind'];
  name: string;
  parent: string | null;
  project: string | null;
  state: HealthState;
  reasons: HealthReason[];
  since: Date;
}

/** Cluster, site and node health is for cluster roles; project entities for those who may read the project. */
export function mayReadHealth(caller: AccessCaller, entity: { project: string | null }): boolean {
  return entity.project ? canReadProject(caller, entity.project) : !!caller.clusterRole;
}

function toDto(row: HealthRow): HealthEntityDto {
  return { ...row, since: new Date(row.since).toISOString() };
}

/**
 * The explained health tree (3.25): evaluated every 30 s by one replica from the nodes, replicas, volumes and plans,
 * stored with the time each entity entered its state; every change is an event on the timeline (so reports and SLOs
 * can tell how long something was at risk).
 */
@Injectable()
export class HealthService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(HealthService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  /**
   * The tree as evaluated while the control plane serves read-only (3.43 fallback: the members' database is out of
   * reach): nothing can be stored then, so the readers get this in-memory evaluation instead of the frozen rows —
   * otherwise a node that went away kept "healthy" (user, 2026-10-31). `null` while writes work.
   */
  private get live(): HealthRow[] | null {
    return liveRows;
  }

  private set live(rows: HealthRow[] | null) {
    liveRows = rows;
  }

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ProjectAccessService,
    private readonly metrics: MetricsStore,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** The inputs of the health tree, as of now. */
  async snapshot(now = Date.now()): Promise<HealthInput> {
    const nodes = await this.dataSource.getRepository(NodeEntity).find({ where: { lifecycle: Not('left') } });
    // Removed replicas that still drain (M6 gate) are on their way out: their stop isn't a health finding.
    const placements = await this.dataSource
      .getRepository(WorkloadPlacementEntity)
      .find({ where: { drainUntil: IsNull() } });
    const volumes = await this.dataSource.getRepository(VolumePlacementEntity).find();
    const rollbackFailed = await this.dataSource
      .getRepository(PlanEntity)
      .find({ where: { status: 'rollback-failed' }, select: { id: true, changes: true } });
    const projects = await this.dataSource
      .getRepository(ResourceEntity)
      .find({ where: { kind: 'Project' }, select: { name: true } });
    // Backup pins (3.20): a policy without a confirmed recovery kit / external target.
    const backupResources = await this.dataSource
      .getRepository(ResourceEntity)
      .find({ where: { kind: In(['BackupPolicy', 'BackupTarget']) }, select: { kind: true } });
    const backupKey = await this.dataSource.getRepository(BackupKeyEntity).findOne({ where: { active: true } });
    const backupPinList = backupPins(
      {
        generation: backupKey?.generation ?? null,
        kitConfirmed: !!backupKey?.kitConfirmedAt,
        escrowed: !!backupKey?.escrow,
      },
      backupResources.filter((r) => r.kind === 'BackupTarget').length,
      backupResources.filter((r) => r.kind === 'BackupPolicy').length,
    );

    return {
      now,
      heartbeatTimeoutMs: NODE_HEARTBEAT_TIMEOUT_MS,
      nodes: nodes.map((n) => ({
        name: n.name,
        site: n.site,
        lifecycle: n.lifecycle,
        connected: n.connected,
        lastSeenAt: n.lastSeenAt ? n.lastSeenAt.getTime() : null,
        controlPlane: n.controlPlane,
        witness: n.witness,
        capacity: n.capacity,
        usage: n.usage,
      })),
      replicas: placements.map((p) => {
        const status = p.status?.[p.node];

        return {
          id: p.id,
          project: p.project,
          deployment: p.deployment,
          service: p.service,
          node: p.node,
          ...(status
            ? { state: status.state, ...(status.exitCode !== undefined ? { exitCode: status.exitCode } : {}) }
            : {}),
          cron: !!p.cronRun,
        };
      }),
      volumes: volumes.map((v) => ({
        id: v.id,
        primaryNode: v.primaryNode,
        syncReplicas: v.syncReplicas,
        remoteReplicas: v.remoteReplicas,
        crossSite: v.crossSite,
      })),
      rollbackFailed: rollbackFailed.map((p) => ({
        id: p.id,
        projects: [...new Set(p.changes.flatMap((c) => (c.project ? [c.project] : [])))],
      })),
      projects: projects.map((p) => p.name),
      backupPins: backupPinList,
    };
  }

  /** One evaluation by one replica: store states, record changes as events. */
  async tick(now = Date.now()): Promise<boolean> {
    if (this.running) return false;

    this.running = true;

    const runner = this.dataSource.createQueryRunner();

    try {
      await runner.connect();

      const [{ locked }] = await runner.query('SELECT pg_try_advisory_lock($1) AS locked', [ADVISORY_LOCK_HEALTH]);

      if (!locked) return false;

      try {
        await this.evaluate(now);
      } finally {
        await runner.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_HEALTH]);
      }

      return true;
    } catch (error) {
      this.logger.warn(`Health evaluation: ${error instanceof Error ? error.message : String(error)}`);

      return false;
    } finally {
      await runner.release();
      this.running = false;
    }
  }

  private async evaluate(now: number): Promise<void> {
    const tree = healthTree(await this.snapshot(now));

    if (databaseTarget.fallback) {
      this.live = liveHealthRows(tree, this.live ?? (await this.dataSource.query(`SELECT * FROM lw_health`)), now);

      return;
    }

    this.live = null;

    const previous: { key: string; state: HealthState }[] = await this.dataSource.query(
      `SELECT key, state FROM lw_health`,
    );
    const changes = healthChanges(new Map(previous.map((p) => [p.key, p.state])), tree);
    const changed = new Set(changes.map((c) => c.key));
    const at = new Date(now);

    await this.dataSource.transaction(async (manager) => {
      for (const n of tree)
        await manager.query(
          `INSERT INTO lw_health (key, kind, name, parent, project, state, reasons, since, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
           ON CONFLICT (key) DO UPDATE SET kind = EXCLUDED.kind, name = EXCLUDED.name, parent = EXCLUDED.parent,
             project = EXCLUDED.project, state = EXCLUDED.state, reasons = EXCLUDED.reasons, updated_at = EXCLUDED.updated_at,
             since = CASE WHEN $9 THEN EXCLUDED.since ELSE lw_health.since END`,
          [
            n.key,
            n.kind,
            n.name.slice(0, 255),
            n.parent,
            n.project,
            n.state,
            JSON.stringify(n.reasons),
            at,
            changed.has(n.key),
          ],
        );

      await manager.query(`DELETE FROM lw_health WHERE NOT (key = ANY($1))`, [tree.map((n) => n.key)]);
    });

    // New entities that start out healthy aren't news; everything else is an event on the timeline.
    for (const c of changes.filter((x) => !(x.from === null && x.to === 'healthy')))
      await this.metrics.event(
        'health',
        `${c.key}: ${c.from ?? 'new'} → ${c.to}${c.node.reasons[0] ? ` (${c.node.reasons[0].message})` : ''}`,
        {
          entity: c.key,
          ...(c.node.project ? { project: c.node.project } : {}),
          data: { from: c.from, to: c.to, reasons: c.node.reasons },
        },
      );
  }

  /**
   * The current health rows: the stored ones, or — while the control plane is read-only — the latest in-memory
   * evaluation (see {@link live}). Other services read states through this, not `lw_health` directly.
   */
  async currentRows(): Promise<HealthRow[]> {
    if (this.live && databaseTarget.fallback) return this.live;

    return await this.dataSource.query(`SELECT * FROM lw_health ORDER BY key`);
  }

  /** The stored tree, scoped by access (optionally one project, or one entity and its descendants). */
  async tree(
    req: RequestWithUser | undefined,
    q: { project?: string; root?: string } = {},
  ): Promise<HealthEntityDto[]> {
    const caller = await this.access.caller(req);

    if (q.project && !canReadProject(caller, q.project)) throw new NotFoundException('project not found');

    const rows = (await this.currentRows()).filter((r) => !q.project || r.project === q.project);
    const visible = rows.filter((r) => mayReadHealth(caller, r));

    if (!q.root) return visible.map(toDto);

    const children = new Map<string, HealthRow[]>();

    for (const r of visible) if (r.parent) children.set(r.parent, [...(children.get(r.parent) ?? []), r]);

    const root = visible.find((r) => r.key === q.root);

    if (!root) throw new NotFoundException('entity not found');

    const out: HealthRow[] = [];
    const walk = (r: HealthRow) => {
      out.push(r);
      (children.get(r.key) ?? []).forEach(walk);
    };

    walk(root);

    return out.map(toDto);
  }

  /** Changes of one entity in a range, and how long it spent in each state (3.25). */
  async history(
    req: RequestWithUser | undefined,
    key: string,
    range: { from?: string; to?: string },
  ): Promise<{
    key: string;
    changes: { at: string; from: HealthState | null; to: HealthState; message: string }[];
    durations: Partial<Record<HealthState, number>>;
  }> {
    const caller = await this.access.caller(req);
    const entity = (await this.currentRows()).find((r) => r.key === key);
    const project = entity?.project ?? (key.startsWith('project/') ? key.split('/')[1] : null);

    if (!mayReadHealth(caller, { project })) throw new NotFoundException('entity not found');

    const to = range.to ? new Date(range.to) : new Date();
    const from = range.from ? new Date(range.from) : new Date(to.getTime() - 30 * 86_400_000);

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to)
      throw new BadRequestException('invalid time range');

    const { before, inRange } = await this.changes(key, from, to);
    // Without an earlier change, the first change's `from` tells the state at the window's start.
    const initial = before?.data.to ?? inRange[0]?.data.from ?? entity?.state ?? null;

    return {
      key,
      changes: inRange.map((e) => ({
        at: new Date(e.time).toISOString(),
        from: e.data.from,
        to: e.data.to,
        message: e.message,
      })),
      durations: stateDurations(
        initial,
        inRange.map((e) => ({ at: new Date(e.time).getTime(), to: e.data.to })),
        from.getTime(),
        to.getTime(),
      ),
    };
  }

  /** The last change before a window and the changes inside it (oldest first, at most 10,000). */
  private async changes(
    key: string,
    from: Date,
    to: Date,
  ): Promise<{
    before: { time: Date; message: string; data: { from: HealthState | null; to: HealthState } } | undefined;
    inRange: { time: Date; message: string; data: { from: HealthState | null; to: HealthState } }[];
  }> {
    const entity = key.slice(0, 255);
    const [before] = await this.dataSource.query(
      `SELECT "time", message, data FROM lw_events WHERE kind = 'health' AND entity = $1 AND "time" <= $2 ORDER BY "time" DESC LIMIT 1`,
      [entity, from],
    );
    const inRange = await this.dataSource.query(
      `SELECT "time", message, data FROM lw_events WHERE kind = 'health' AND entity = $1 AND "time" > $2 AND "time" < $3
       ORDER BY "time" ASC LIMIT 10000`,
      [entity, from, to],
    );

    return { before, inRange };
  }

  /** Time per state of one entity in a range (reports, 3.25), without an access check. */
  async durationsFor(key: string, from: Date, to: Date): Promise<Partial<Record<HealthState, number>>> {
    const entity = (await this.currentRows()).find((r) => r.key === key);
    const { before, inRange } = await this.changes(key, from, to);
    const initial = before?.data.to ?? inRange[0]?.data.from ?? entity?.state ?? null;

    return stateDurations(
      initial,
      inRange.map((e) => ({ at: new Date(e.time).getTime(), to: e.data.to })),
      from.getTime(),
      to.getTime(),
    );
  }

  /** Entities in the given states (the inbox's at-risk items), scoped by access. */
  async inState(caller: AccessCaller, states: HealthState[], kinds: HealthNode['kind'][]): Promise<HealthEntityDto[]> {
    // Project members: their projects in the query itself, so the limit can't hide them.
    const projects = caller.clusterRole ? null : [...caller.projects.keys()].filter((p) => canReadProject(caller, p));
    const rows = (await this.currentRows())
      .filter(
        (r) =>
          states.includes(r.state) &&
          kinds.includes(r.kind) &&
          (!projects || (r.project !== null && projects.includes(r.project))),
      )
      .sort((a, b) => new Date(a.since).getTime() - new Date(b.since).getTime())
      .slice(0, 500);

    return rows.filter((r) => mayReadHealth(caller, r)).map(toDto);
  }

  /** Cluster for cluster roles (projects too with `withProjects`), the readable projects for everyone else. */
  async roots(caller: AccessCaller, withProjects = false): Promise<HealthEntityDto[]> {
    const rows = (await this.currentRows()).filter((r) => r.kind === 'cluster' || r.kind === 'project');

    return rows
      .filter((r) => mayReadHealth(caller, r) && (r.kind === 'cluster' || withProjects || !caller.clusterRole))
      .map(toDto);
  }
}

/**
 * The evaluated tree as rows without storing it (read-only fallback): an entity keeps its `since` while its state is
 * unchanged, otherwise it changed now.
 */
export function liveHealthRows(
  tree: readonly HealthNode[],
  previous: readonly Pick<HealthRow, 'key' | 'state' | 'since'>[],
  now: number,
): HealthRow[] {
  const before = new Map(previous.map((p) => [p.key, p]));

  return tree.map((n) => {
    const prior = before.get(n.key);

    return { ...n, since: prior && prior.state === n.state ? new Date(prior.since) : new Date(now) };
  });
}
