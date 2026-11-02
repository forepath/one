import { createHash } from 'node:crypto';

import type { RequestWithUser } from '@forepath/identity/backend';
import { enqueueUnitJob } from '@forepath/shared/backend';
import { FileStorageScope, FileStorageService } from '@forepath/shared/backend/util-file-storage';
import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Queue } from 'bullmq';
import { DataSource, In } from 'typeorm';

import { canReadProject, projectRole, type AccessCaller } from '../access/access.utils';
import { projectUsage } from '../access/plan-access.utils';
import { backupBytesByProject, backupReportSection } from '../backups/backup-usage';
import { UsageService } from '../usage/usage.service';
import { ProjectAccessService } from '../access/project-access.service';
import { NodeEntity } from '../entities/node.entity';
import { ResourceEntity } from '../entities/resource.entity';
import { HealthService } from '../health/health.service';
import { SloService } from '../health/slo.service';
import { LOADWEAVER_QUEUE_NAME } from '../notifications/loadweaver-notification.events';
import { actorFromRequest } from '../services/audit-log.service';
import { WorkloadPlannerService } from '../services/workload-planner.service';
import { daysUntil, previousMonth, renderReportHtml, reportKey, type ReportData } from './report.utils';
import { zipBuffer } from './zip.utils';

export const REPORT_COORDINATOR_JOB = 'reports.coordinator';
export const REPORT_UNIT_JOB = 'reports.unit';
const MAX_ARCHIVE_ENTRIES = 500;
const MAX_ARCHIVE_BYTES = 100 * 1024 ** 2;

export interface ReportUnitPayload {
  scope: string;
  year: number;
  month: number;
  triggeredBy: string;
  force?: boolean;
}

interface ReportFile {
  name: string;
  key: string;
  bytes: number;
  sha256: string;
}

interface ReportRow {
  id: string;
  scope: string;
  period_year: number;
  period_month: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  files: ReportFile[];
  error: string | null;
  triggered_by: string | null;
  started_at: Date | null;
  completed_at: Date | null;
}

export interface ReportDto {
  id: string;
  scope: string;
  year: number;
  month: number;
  status: ReportRow['status'];
  files: { name: string; path: string; bytes: number; sha256: string }[];
  error: string | null;
  completedAt: string | null;
}

export interface FileEntry {
  name: string;
  path: string;
  type: 'folder' | 'file';
  bytes?: number;
  updatedAt?: string;
}

function mayRead(caller: AccessCaller, scope: string): boolean {
  return scope === 'cluster' ? !!caller.clusterRole : canReadProject(caller, scope);
}

function mayRun(caller: AccessCaller, scope: string): boolean {
  return scope === 'cluster' ? caller.clusterRole === 'cluster-admin' : projectRole(caller, scope) === 'admin';
}

/** Rejects absolute paths, `..`, NUL bytes; strips surrounding slashes. */
export function normalizeFilePath(path: string): string {
  const p = path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');

  if (p.includes('\0') || p.split('/').some((s) => s === '..' || s === '.'))
    throw new BadRequestException('invalid path');

  return p;
}

/** Folder entries at a path of a virtual tree of file paths (folders first, then by name). */
export function listTree(
  files: readonly { path: string; bytes: number; updatedAt?: string }[],
  path: string,
): FileEntry[] {
  const prefix = path ? `${path}/` : '';
  const entries = new Map<string, FileEntry>();

  for (const f of files.filter((x) => x.path.startsWith(prefix))) {
    const rest = f.path.slice(prefix.length);
    const [head, ...tail] = rest.split('/');
    const entryPath = `${prefix}${head}`;

    if (tail.length) entries.set(entryPath, { name: head, path: entryPath, type: 'folder' });
    else
      entries.set(entryPath, {
        name: head,
        path: entryPath,
        type: 'file',
        bytes: f.bytes,
        ...(f.updatedAt ? { updatedAt: f.updatedAt } : {}),
      });
  }

  return [...entries.values()].sort((a, b) =>
    a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'folder' ? -1 : 1,
  );
}

/**
 * Periodic reports (3.25), the way Decabill runs its exports: a monthly coordinator job enqueues one unit job per
 * scope (cluster, each project) with an idempotent id (`report.<scope>.<yyyy>-<mm>`); each writes an HTML and a JSON
 * file through the shared file storage (Garage on the members by default) and records them. Browsed as a file tree
 * from the database, single files or folders as ZIP, scoped by access.
 */
@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ProjectAccessService,
    private readonly files: FileStorageService,
    private readonly health: HealthService,
    private readonly slos: SloService,
    private readonly planner: WorkloadPlannerService,
    private readonly usage: UsageService,
    @InjectQueue(LOADWEAVER_QUEUE_NAME) private readonly queue: Queue,
  ) {}

  /** Coordinator: last month's reports for the cluster and every project. */
  async coordinate(now = new Date()): Promise<number> {
    const { year, month } = previousMonth(now);
    const projects = (
      await this.dataSource.getRepository(ResourceEntity).find({ where: { kind: 'Project' }, select: { name: true } })
    ).map((p) => p.name);

    for (const scope of ['cluster', ...projects]) await this.enqueue({ scope, year, month, triggeredBy: 'schedule' });

    return projects.length + 1;
  }

  private async enqueue(payload: ReportUnitPayload): Promise<void> {
    await enqueueUnitJob({
      queue: this.queue,
      jobName: REPORT_UNIT_JOB,
      payload,
      jobIdNamespace: 'report',
      jobIdParts: [
        payload.scope === 'cluster' ? 'cluster' : `project.${payload.scope}`,
        `${payload.year}-${String(payload.month).padStart(2, '0')}`,
      ],
    });
  }

  /** On demand (cluster admins for the cluster, project admins for their project); re-runs replace the files. */
  async request(req: RequestWithUser | undefined, dto: { scope: string; year: number; month: number }): Promise<void> {
    const caller = await this.access.caller(req);

    if (!mayRead(caller, dto.scope)) throw new NotFoundException('scope not found');

    if (!mayRun(caller, dto.scope)) throw new ForbiddenException('admin role required');

    const now = new Date();

    if (Date.UTC(dto.year, dto.month - 1, 1) >= Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
      throw new BadRequestException('only finished months');

    const actor = actorFromRequest(req);

    await this.enqueue({ ...dto, triggeredBy: actor.id ?? actor.type, force: true });
  }

  /** The unit job: one scope and month. Skips completed reports unless forced. */
  async generate(payload: ReportUnitPayload, now = new Date()): Promise<ReportRow | null> {
    const [claimed]: ReportRow[] = await this.dataSource.query(
      `INSERT INTO lw_reports (scope, period_year, period_month, status, triggered_by, started_at)
       VALUES ($1, $2, $3, 'running', $4, now())
       ON CONFLICT (scope, period_year, period_month) DO UPDATE
         SET status = 'running', triggered_by = EXCLUDED.triggered_by, started_at = now(), error = NULL
         WHERE (lw_reports.status <> 'running' OR lw_reports.started_at < now() - INTERVAL '1 hour')
           AND (lw_reports.status <> 'completed' OR $5)
       RETURNING *`,
      [payload.scope, payload.year, payload.month, payload.triggeredBy, !!payload.force],
    );

    if (!claimed) return null;

    try {
      const data = await this.collect(payload.scope, payload.year, payload.month, now);
      const json = Buffer.from(JSON.stringify(data, null, 2));
      const html = Buffer.from(renderReportHtml(data));
      const files: ReportFile[] = [];

      for (const [name, content] of [
        ['report.html', html],
        ['report.json', json],
      ] as const) {
        const key = reportKey(payload.scope, payload.year, payload.month, name);

        await this.files.writeFile(FileStorageScope.loadweaverReports, key, content);
        files.push({ name, key, bytes: content.length, sha256: createHash('sha256').update(content).digest('hex') });
      }

      const [row]: [ReportRow[], number] = await this.dataSource.query(
        `UPDATE lw_reports SET status = 'completed', files = $2, completed_at = now() WHERE id = $1 RETURNING *`,
        [claimed.id, JSON.stringify(files)],
      );

      return row[0];
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);

      this.logger.warn(`Report ${payload.scope} ${payload.year}-${payload.month}: ${message}`);
      await this.dataSource.query(
        `UPDATE lw_reports SET status = 'failed', error = $2, completed_at = now() WHERE id = $1`,
        [claimed.id, message],
      );
      throw error;
    }
  }

  /** The report's content (3.25): health, SLOs, incidents, changes, capacity trend, denies, usage. */
  async collect(scope: string, year: number, month: number, now = new Date()): Promise<ReportData> {
    const from = new Date(Date.UTC(year, month - 1, 1));
    const to = new Date(Date.UTC(year, month, 1));
    const span = to.getTime() - from.getTime();
    const project = scope === 'cluster' ? null : scope;
    const durations = await this.health.durationsFor(project ? `project/${project}` : 'cluster', from, to);
    const health = Object.fromEntries(
      Object.entries(durations).map(([state, ms]) => [state, ((ms ?? 0) / span) * 100]),
    );
    const services = (await this.slos.availabilityBetween(from, to))
      .filter((s) => !project || s.project === project)
      .map((s) => ({
        service: `${s.project}/${s.deployment}/${s.service}`,
        availability: s.availability,
        target: s.target,
      }));
    const incidents: { title: string; status: string; created_at: Date; resolved_at: Date | null }[] =
      await this.dataSource.query(
        `SELECT title, status, created_at, resolved_at FROM lw_incidents
       WHERE created_at < $2 AND (resolved_at IS NULL OR resolved_at >= $1) ${project ? 'AND project = $3' : ''}
       ORDER BY created_at LIMIT 500`,
        project ? [from, to, project] : [from, to],
      );
    const [events]: { applies: string; rollbacks: string; failed: string; health: string }[] =
      await this.dataSource.query(
        `SELECT count(*) FILTER (WHERE kind = 'plan' AND message LIKE '% applied%') AS applies,
              count(*) FILTER (WHERE kind = 'plan' AND message LIKE '% rolled-back%') AS rollbacks,
              count(*) FILTER (WHERE kind = 'plan' AND message LIKE '% rollback-failed%') AS failed,
              count(*) FILTER (WHERE kind = 'health') AS health
       FROM lw_events WHERE "time" >= $1 AND "time" < $2 ${project ? 'AND project = $3' : ''}`,
        project ? [from, to, project] : [from, to],
      );
    const data: ReportData = {
      scope,
      period: { year, month, from: from.toISOString(), to: to.toISOString() },
      generatedAt: now.toISOString(),
      health,
      services,
      incidents: incidents.map((i) => ({
        title: i.title,
        status: i.status,
        createdAt: new Date(i.created_at).toISOString(),
        resolvedAt: i.resolved_at ? new Date(i.resolved_at).toISOString() : null,
      })),
      events: {
        applies: Number(events?.applies ?? 0),
        rollbacks: Number(events?.rollbacks ?? 0),
        failedRollbacks: Number(events?.failed ?? 0),
        healthChanges: Number(events?.health ?? 0),
      },
      backups: await backupReportSection(this.dataSource, project, from, to),
      metered: await this.usage.totals(project, from, to),
      notYet: ['upgrades'],
    };

    if (!project) {
      // Memory in use per day (sum over the nodes of their daily average) against today's capacity.
      const days: { day: Date; used: string }[] = await this.dataSource.query(
        `SELECT day, sum(v) AS used FROM (
           SELECT date_trunc('day', bucket) AS day, node, sum(avg * samples) / nullif(sum(samples), 0) AS v
           FROM lw_metrics_1h WHERE metric = 'node.memory_bytes' AND bucket >= $1 AND bucket < $2 GROUP BY 1, 2) t
         GROUP BY day ORDER BY day`,
        [from, to],
      );
      const nodes = await this.dataSource
        .getRepository(NodeEntity)
        .find({ select: { capacity: true, lifecycle: true, witness: true } });
      const capacityBytes = nodes
        .filter((n) => n.lifecycle !== 'left' && !n.witness)
        .reduce((sum, n) => sum + (n.capacity?.memoryBytes ?? 0), 0);
      const points = days.map((d) => ({ day: new Date(d.day).toISOString().slice(0, 10), usedBytes: Number(d.used) }));
      const [denied]: { n: string | null }[] = await this.dataSource.query(
        `SELECT sum(packets) AS n FROM lw_flows_1h WHERE decision = 'denied' AND bucket >= $1 AND bucket < $2`,
        [from, to],
      );

      data.capacity = {
        points,
        capacityBytes,
        daysUntil90Percent:
          capacityBytes > 0
            ? daysUntil(
                points.map((p) => p.usedBytes),
                capacityBytes * 0.9,
              )
            : null,
      };
      data.deniedPackets = Number(denied?.n ?? 0);
    } else {
      const resources = await this.dataSource
        .getRepository(ResourceEntity)
        .find({ where: { kind: In(['Project', 'Deployment', 'Policy']) } });
      const usage = projectUsage(
        this.planner.parse(resources).parsed,
        resources,
        await backupBytesByProject(this.dataSource),
      ).get(project);

      data.usage = usage
        ? { cpuMillis: usage.cpuMillis, memoryBytes: usage.memoryBytes, storageBytes: usage.storageBytes }
        : { cpuMillis: 0, memoryBytes: 0, storageBytes: 0 };
    }

    return data;
  }

  private async visibleRows(caller: AccessCaller): Promise<ReportRow[]> {
    const rows: ReportRow[] = await this.dataSource.query(
      `SELECT * FROM lw_reports ORDER BY period_year DESC, period_month DESC, scope LIMIT 5000`,
    );

    return rows.filter((r) => mayRead(caller, r.scope));
  }

  /** Every visible file as a virtual path (`cluster/2026/09/report.html`, `projects/shop/...`). */
  private async visibleFiles(
    caller: AccessCaller,
  ): Promise<{ path: string; key: string; bytes: number; updatedAt?: string }[]> {
    return (await this.visibleRows(caller)).flatMap((r) =>
      r.status === 'completed'
        ? r.files.map((f) => ({
            path: f.key,
            key: f.key,
            bytes: f.bytes,
            ...(r.completed_at ? { updatedAt: new Date(r.completed_at).toISOString() } : {}),
          }))
        : [],
    );
  }

  async list(req: RequestWithUser | undefined): Promise<ReportDto[]> {
    return (await this.visibleRows(await this.access.caller(req))).map((r) => ({
      id: r.id,
      scope: r.scope,
      year: r.period_year,
      month: r.period_month,
      status: r.status,
      files: r.files.map((f) => ({ name: f.name, path: f.key, bytes: f.bytes, sha256: f.sha256 })),
      error: r.error,
      completedAt: r.completed_at ? new Date(r.completed_at).toISOString() : null,
    }));
  }

  async tree(req: RequestWithUser | undefined, path: string): Promise<FileEntry[]> {
    return listTree(await this.visibleFiles(await this.access.caller(req)), normalizeFilePath(path));
  }

  /** Only paths of recorded reports the caller may read: nothing else in the storage is reachable. */
  async download(req: RequestWithUser | undefined, path: string): Promise<{ name: string; content: Buffer }> {
    const p = normalizeFilePath(path);
    const file = (await this.visibleFiles(await this.access.caller(req))).find((f) => f.path === p);

    if (!file) throw new NotFoundException('file not found');

    return {
      name: p.split('/').at(-1) as string,
      content: await this.files.readFile(FileStorageScope.loadweaverReports, file.key),
    };
  }

  async archive(req: RequestWithUser | undefined, path: string): Promise<{ name: string; content: Buffer }> {
    const p = normalizeFilePath(path);
    const prefix = p ? `${p}/` : '';
    const files = (await this.visibleFiles(await this.access.caller(req))).filter((f) => f.path.startsWith(prefix));

    if (files.length === 0) throw new NotFoundException('folder not found');

    if (files.length > MAX_ARCHIVE_ENTRIES || files.reduce((s, f) => s + f.bytes, 0) > MAX_ARCHIVE_BYTES)
      throw new PayloadTooLargeException('folder too large for one archive');

    const entries = [];

    for (const f of files)
      entries.push({
        name: f.path.slice(prefix.length),
        content: await this.files.readFile(FileStorageScope.loadweaverReports, f.key),
      });

    return { name: `${p.split('/').at(-1) || 'reports'}.zip`, content: zipBuffer(entries) };
  }
}
