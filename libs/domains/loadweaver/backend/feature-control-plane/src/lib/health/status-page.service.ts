import type { RequestWithUser } from '@forepath/identity/backend';
import { statusPageSpecSchema, type StatusPageSpec } from '@forepath/loadweaver/shared/util-model';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { atLeast, canReadProject, projectRole } from '../access/access.utils';
import { ProjectAccessService } from '../access/project-access.service';
import { ResourceEntity } from '../entities/resource.entity';
import { actorFromRequest, AuditLogService } from '../services/audit-log.service';
import type { HealthState } from './health-tree.utils';
import { liveHealthStates } from './health.service';
import { SloService } from './slo.service';

const CACHE_MS = 30_000;
const RESOLVED_SHOWN_MS = 14 * 86_400_000;

export const INCIDENT_STATUSES = ['investigating', 'identified', 'monitoring', 'resolved'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export interface IncidentDto {
  id: string;
  project: string;
  title: string;
  status: IncidentStatus;
  updates: { at: string; status: IncidentStatus; message: string; by?: string | null }[];
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

/** What a status page shows: no reasons, nodes or internals — only states, uptime and incident notes. */
export interface PublicStatus {
  title: string;
  description?: string;
  status: PublicServiceState;
  services: { name: string; status: PublicServiceState; uptime?: number }[];
  incidents: {
    title: string;
    status: IncidentStatus;
    updates: { at: string; status: IncidentStatus; message: string }[];
    resolvedAt: string | null;
  }[];
  updatedAt: string;
}

export type PublicServiceState = 'operational' | 'degraded' | 'outage' | 'unknown';

/** Internal health → what the public sees: at risk is still operational, degraded is degraded, failed is an outage. */
export function publicState(state: HealthState | undefined): PublicServiceState {
  switch (state) {
    case 'healthy':
    case 'at-risk':
      return 'operational';
    case 'degraded':
      return 'degraded';
    case 'failed':
      return 'outage';
    default:
      return 'unknown';
  }
}

const RANK: Record<PublicServiceState, number> = { operational: 0, unknown: 1, degraded: 2, outage: 3 };

export function overallState(states: readonly PublicServiceState[]): PublicServiceState {
  return states.reduce<PublicServiceState>((worst, s) => (RANK[s] > RANK[worst] ? s : worst), 'operational');
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

const LABEL: Record<PublicServiceState, string> = {
  operational: 'Operational',
  degraded: 'Degraded performance',
  outage: 'Outage',
  unknown: 'Unknown',
};

/** The page itself: static HTML with inline styles only (served with a CSP that allows nothing else). */
export function renderStatusPage(status: PublicStatus): string {
  const services = status.services
    .map(
      (s) =>
        `<li class="${s.status}"><span>${escapeHtml(s.name)}</span><span>${LABEL[s.status]}${s.uptime !== undefined ? ` · ${s.uptime.toFixed(2)} % this month` : ''}</span></li>`,
    )
    .join('');
  const incidents = status.incidents
    .map(
      (i) =>
        `<article><h3>${escapeHtml(i.title)} <small>${escapeHtml(i.status)}</small></h3>${i.updates
          .map((u) => `<p><time>${escapeHtml(u.at)}</time> <b>${escapeHtml(u.status)}</b> ${escapeHtml(u.message)}</p>`)
          .join('')}</article>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="60"><title>${escapeHtml(status.title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:48rem;margin:2rem auto;padding:0 1rem;color:#1f2937}
.banner{padding:1rem;border-radius:.5rem;font-weight:600}.operational{color:#065f46}.degraded{color:#92400e}.outage{color:#991b1b}.unknown{color:#4b5563}
.banner.operational{background:#d1fae5}.banner.degraded{background:#fef3c7}.banner.outage{background:#fee2e2}.banner.unknown{background:#f3f4f6}
ul{list-style:none;padding:0}li{display:flex;justify-content:space-between;padding:.75rem 0;border-bottom:1px solid #e5e7eb}
article{border-left:3px solid #e5e7eb;padding-left:1rem;margin:1rem 0}small{color:#6b7280;font-weight:400}time{color:#6b7280}</style>
</head><body><h1>${escapeHtml(status.title)}</h1>${status.description ? `<p>${escapeHtml(status.description)}</p>` : ''}
<div class="banner ${status.status}">${status.status === 'operational' ? 'All systems operational' : LABEL[status.status]}</div>
<ul>${services}</ul>${incidents ? `<h2>Incidents</h2>${incidents}` : ''}
<p><small>Updated ${escapeHtml(status.updatedAt)}</small></p></body></html>`;
}

interface IncidentRow {
  id: string;
  project: string;
  title: string;
  status: IncidentStatus;
  updates: IncidentDto['updates'];
  created_at: Date;
  updated_at: Date;
  resolved_at: Date | null;
}

function incidentDto(r: IncidentRow): IncidentDto {
  return {
    id: r.id,
    project: r.project,
    title: r.title,
    status: r.status,
    updates: r.updates,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
    resolvedAt: r.resolved_at ? new Date(r.resolved_at).toISOString() : null,
  };
}

/**
 * Public status pages per project (3.25) and their incident notes: served without login through the ingress for
 * the page's hostname, built from the health tree and the SLOs, cached for 30 s.
 */
@Injectable()
export class StatusPageService {
  private readonly cache = new Map<string, { at: number; status: PublicStatus }>();
  private readonly missing = new Map<string, number>();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ProjectAccessService,
    private readonly audit: AuditLogService,
    private readonly slos: SloService,
  ) {}

  /** The status of the page for a hostname (the Host header), or 404. */
  async publicStatus(host: string, now = Date.now()): Promise<PublicStatus> {
    const name = host.toLowerCase().replace(/:\d+$/, '');
    const cached = this.cache.get(name);

    if (cached && now - cached.at < CACHE_MS) return cached.status;

    if (now - (this.missing.get(name) ?? 0) < CACHE_MS) throw new NotFoundException('no status page here');

    if (this.missing.size > 10_000) this.missing.clear();

    const page = (await this.dataSource.getRepository(ResourceEntity).find({ where: { kind: 'StatusPage' } })).find(
      (r) => String(r.spec['host']).toLowerCase() === name,
    );

    if (!page?.project) {
      // Unknown hosts are remembered too, so they don't scan the status pages on every request.
      this.missing.set(name, now);

      throw new NotFoundException('no status page here');
    }

    const spec: StatusPageSpec = statusPageSpecSchema.parse(page.spec);
    const keys = spec.services.map((s) => `service/${page.project}/${s.service}`);
    const states =
      liveHealthStates() ??
      new Map(
        (
          (await this.dataSource.query(`SELECT key, state FROM lw_health WHERE key = ANY($1)`, [keys])) as {
            key: string;
            state: HealthState;
          }[]
        ).map((r) => [r.key, r.state]),
      );
    const uptimes = new Map(
      spec.showUptime
        ? (await this.slos.all(now))
            .filter((s) => s.project === page.project && s.monthlyUptime !== null)
            .map((s) => [`${s.deployment}/${s.service}`, s.monthlyUptime as number])
        : [],
    );
    const services = spec.services.map((s) => ({
      name: s.name,
      status: publicState(states.get(`service/${page.project}/${s.service}`)),
      ...(uptimes.has(s.service) ? { uptime: uptimes.get(s.service) } : {}),
    }));
    const incidents: IncidentRow[] = await this.dataSource.query(
      `SELECT * FROM lw_incidents WHERE project = $1 AND (resolved_at IS NULL OR resolved_at > $2)
       ORDER BY created_at DESC LIMIT 20`,
      [page.project, new Date(now - RESOLVED_SHOWN_MS)],
    );
    const status: PublicStatus = {
      title: spec.title,
      ...(spec.description ? { description: spec.description } : {}),
      status: overallState(services.map((s) => s.status)),
      services,
      incidents: incidents.map((i) => ({
        title: i.title,
        status: i.status,
        updates: i.updates.map(({ at, status: s, message }) => ({ at, status: s, message })),
        resolvedAt: i.resolved_at ? new Date(i.resolved_at).toISOString() : null,
      })),
      updatedAt: new Date(now).toISOString(),
    };

    if (this.cache.size > 1_000) this.cache.clear();

    this.cache.set(name, { at: now, status });

    return status;
  }

  async incidents(req: RequestWithUser | undefined, project: string): Promise<IncidentDto[]> {
    const caller = await this.access.caller(req);

    if (!canReadProject(caller, project)) throw new NotFoundException('project not found');

    const rows: IncidentRow[] = await this.dataSource.query(
      `SELECT * FROM lw_incidents WHERE project = $1 ORDER BY created_at DESC LIMIT 200`,
      [project],
    );

    return rows.map(incidentDto);
  }

  private async assertOperator(req: RequestWithUser | undefined, project: string): Promise<void> {
    const caller = await this.access.caller(req);

    if (!canReadProject(caller, project)) throw new NotFoundException('project not found');

    if (!atLeast(projectRole(caller, project), 'operator')) throw new ForbiddenException('operator role required');
  }

  async createIncident(
    req: RequestWithUser | undefined,
    project: string,
    dto: { title: string; status: IncidentStatus; message: string },
  ): Promise<IncidentDto> {
    await this.assertOperator(req, project);

    const actor = actorFromRequest(req);
    const now = new Date();

    return await this.dataSource.transaction(async (manager) => {
      const [row]: IncidentRow[] = await manager.query(
        `INSERT INTO lw_incidents (project, title, status, updates, created_by, resolved_at)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [
          project,
          dto.title,
          dto.status,
          JSON.stringify([
            { at: now.toISOString(), status: dto.status, message: dto.message, by: actor.id ?? actor.type },
          ]),
          actor.id ?? actor.type,
          dto.status === 'resolved' ? now : null,
        ],
      );

      await this.audit.record(manager, {
        actor,
        action: 'incident.create',
        target: `incident/${row.id}`,
        project,
        details: { title: dto.title, status: dto.status },
      });
      this.cache.clear();
      this.missing.clear();

      return incidentDto(row);
    });
  }

  /** Adds an update (status + note); resolving sets the resolution time. */
  async updateIncident(
    req: RequestWithUser | undefined,
    project: string,
    id: string,
    dto: { status: IncidentStatus; message: string },
  ): Promise<IncidentDto> {
    await this.assertOperator(req, project);

    const actor = actorFromRequest(req);
    const now = new Date();

    return await this.dataSource.transaction(async (manager) => {
      const [current]: IncidentRow[] = await manager.query(
        `SELECT * FROM lw_incidents WHERE id = $1 AND project = $2 FOR UPDATE`,
        [id, project],
      );

      if (!current) throw new NotFoundException('incident not found');

      if (current.updates.length >= 100) throw new BadRequestException('an incident keeps at most 100 updates');

      const [[row]]: [IncidentRow[], number] = await manager.query(
        `UPDATE lw_incidents SET status = $3::varchar, updates = updates || $4::jsonb, updated_at = $5,
           resolved_at = CASE WHEN $3::varchar = 'resolved' THEN coalesce(resolved_at, $5) ELSE NULL END
         WHERE id = $1 AND project = $2 RETURNING *`,
        [
          id,
          project,
          dto.status,
          JSON.stringify([
            { at: now.toISOString(), status: dto.status, message: dto.message, by: actor.id ?? actor.type },
          ]),
          now,
        ],
      );

      await this.audit.record(manager, {
        actor,
        action: 'incident.update',
        target: `incident/${id}`,
        project,
        details: { status: dto.status },
      });
      this.cache.clear();
      this.missing.clear();

      return incidentDto(row);
    });
  }
}
