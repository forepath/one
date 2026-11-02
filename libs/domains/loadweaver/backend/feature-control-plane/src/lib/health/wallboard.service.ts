import { createHash, randomBytes } from 'node:crypto';

import type { RequestWithUser } from '@forepath/identity/backend';
import { ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { canReadProject, projectRole, type AccessCaller } from '../access/access.utils';
import { ProjectAccessService } from '../access/project-access.service';
import { databaseTarget } from '../database-handover/database-target.runtime';
import { emailOf, userEmails } from '../fleet-identity/user-emails';
import { actorFromRequest, AuditLogService } from '../services/audit-log.service';
import { OverviewService, type KioskSection } from './overview.service';

const PREFIX = 'lw_wb_';
const KIOSK_CACHE_MS = 30_000;

export interface WallboardTokenDto {
  id: string;
  name: string;
  projects: string[] | null;
  createdBy: string | null;
  /** The creator's email (`null`: deleted user / API key), like Agenstra's `createdByEmail`. */
  createdByEmail: string | null;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
}

interface TokenRow {
  id: string;
  name: string;
  token_hash: string;
  projects: string[] | null;
  created_by: string | null;
  created_at: Date;
  expires_at: Date | null;
  last_used_at: Date | null;
  revoked_at: Date | null;
  creator_basis?: string | null;
  project_ids?: string[] | null;
}

export function hashWallboardToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** The caller a wallboard token stands for: read-only, cluster-wide (auditor) or viewer of its projects. */
export function wallboardCaller(projects: string[] | null): AccessCaller {
  return projects
    ? { isApiKey: false, projects: new Map(projects.map((p) => [p, 'viewer' as const])) }
    : { isApiKey: false, clusterRole: 'auditor', projects: new Map() };
}

function toDto(r: TokenRow, emails: ReadonlyMap<string, string | null> = new Map()): WallboardTokenDto {
  const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

  return {
    id: r.id,
    name: r.name,
    projects: r.projects,
    createdBy: r.created_by,
    createdByEmail: emailOf(emails, r.created_by),
    createdAt: new Date(r.created_at).toISOString(),
    expiresAt: iso(r.expires_at),
    lastUsedAt: iso(r.last_used_at),
  };
}

/**
 * Wallboard tokens (3.25): a dedicated read-only token that can only open the kiosk view. Cluster admins create
 * cluster-wide ones; project admins ones for their projects. Shown once, stored as SHA-256, revocable.
 */
@Injectable()
export class WallboardService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ProjectAccessService,
    private readonly audit: AuditLogService,
    private readonly overview: OverviewService,
  ) {}

  private readonly kioskCache = new Map<string, { at: number; view: { name: string; sections: KioskSection[] } }>();

  private mayManage(caller: AccessCaller, projects: string[] | null): boolean {
    if (caller.clusterRole === 'cluster-admin') return true;

    return !!projects?.length && projects.every((p) => projectRole(caller, p) === 'admin');
  }

  async create(
    req: RequestWithUser | undefined,
    dto: { name: string; projects?: string[]; expiresInDays?: number },
  ): Promise<WallboardTokenDto & { token: string }> {
    const caller = await this.access.caller(req);
    const projects = dto.projects?.length ? [...new Set(dto.projects)].sort() : null;

    if (projects?.some((p) => !canReadProject(caller, p))) throw new NotFoundException('project not found');

    if (!this.mayManage(caller, projects))
      throw new ForbiddenException(projects ? 'project admin role required' : 'cluster admin role required');

    const basis = await this.basis(caller, projects);
    const projectIds = projects ? await this.projectIds(projects) : null;
    const token = `${PREFIX}${randomBytes(32).toString('base64url')}`;
    const actor = actorFromRequest(req);
    const expiresAt = dto.expiresInDays ? new Date(Date.now() + dto.expiresInDays * 86_400_000) : null;

    return await this.dataSource.transaction(async (manager) => {
      const [row]: TokenRow[] = await manager.query(
        `INSERT INTO lw_wallboard_tokens (name, token_hash, projects, created_by, expires_at, creator_basis, project_ids)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [
          dto.name,
          hashWallboardToken(token),
          projects ? JSON.stringify(projects) : null,
          actor.id ?? actor.type,
          expiresAt,
          basis,
          projectIds ? JSON.stringify(projectIds) : null,
        ],
      );

      await this.audit.record(manager, {
        actor,
        action: 'wallboard.token.create',
        target: `wallboard-token/${row.id}`,
        project: projects?.length === 1 ? projects[0] : null,
        details: { name: dto.name, projects, expiresAt: expiresAt?.toISOString() ?? null },
      });

      return { ...toDto(row, await userEmails(manager, [row.created_by])), token };
    });
  }

  async list(req: RequestWithUser | undefined): Promise<WallboardTokenDto[]> {
    const caller = await this.access.caller(req);
    const rows: TokenRow[] = await this.dataSource.query(
      `SELECT * FROM lw_wallboard_tokens WHERE revoked_at IS NULL ORDER BY created_at DESC LIMIT 500`,
    );

    const visible = rows.filter((r) => this.mayManage(caller, r.projects));
    const emails = await userEmails(
      this.dataSource,
      visible.map((r) => r.created_by),
    );

    return visible.map((r) => toDto(r, emails));
  }

  async revoke(req: RequestWithUser | undefined, id: string): Promise<void> {
    const caller = await this.access.caller(req);
    const actor = actorFromRequest(req);

    await this.dataSource.transaction(async (manager) => {
      const [row]: TokenRow[] = await manager.query(
        `SELECT * FROM lw_wallboard_tokens WHERE id = $1 AND revoked_at IS NULL FOR UPDATE`,
        [id],
      );

      if (!row || !this.mayManage(caller, row.projects)) throw new NotFoundException('token not found');

      await manager.query(`UPDATE lw_wallboard_tokens SET revoked_at = now() WHERE id = $1`, [id]);
      await this.audit.record(manager, {
        actor,
        action: 'wallboard.token.revoke',
        target: `wallboard-token/${id}`,
        project: row.projects?.length === 1 ? row.projects[0] : null,
      });
    });
  }

  /** The kiosk view for a token (`Authorization: Wallboard <token>`). */
  async kiosk(authorization: string | undefined): Promise<{ name: string; sections: KioskSection[] }> {
    const match = /^Wallboard\s+(lw_wb_[A-Za-z0-9_-]{43})$/.exec(authorization ?? '');

    if (!match) throw new UnauthorizedException('wallboard token required');

    const [row]: TokenRow[] = await this.dataSource.query(
      `SELECT * FROM lw_wallboard_tokens WHERE token_hash = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`,
      [hashWallboardToken(match[1])],
    );

    if (!row) throw new UnauthorizedException('wallboard token required');

    // The creator must still be allowed, and the projects must be the ones the token was made for.
    if (!(await this.stillValid(row))) throw new UnauthorizedException('wallboard token no longer valid');

    const cached = this.kioskCache.get(row.id);

    if (cached && Date.now() - cached.at < KIOSK_CACHE_MS) return cached.view;

    // Usage is recorded at most once a minute per token; not during the read-only fallback (3.43), where the write
    // failed the whole kiosk view (2026-10-31).
    if (!databaseTarget.fallback)
      await this.dataSource.query(
        `UPDATE lw_wallboard_tokens SET last_used_at = now() WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - INTERVAL '1 minute')`,
        [row.id],
      );

    const view = { name: row.name, sections: await this.overview.kiosk(wallboardCaller(row.projects), row.projects) };

    if (this.kioskCache.size > 1_000) this.kioskCache.clear();

    this.kioskCache.set(row.id, { at: Date.now(), view });

    return view;
  }

  /** Why the creator may create the token, as far as the database can confirm it later. */
  private async basis(caller: AccessCaller, projects: string[] | null): Promise<string> {
    if (caller.isApiKey) return 'api-key';

    if (projects && projects.every((p) => caller.projects.get(p) === 'admin')) return 'project-admin';

    const [member]: { role: string }[] = await this.dataSource.query(
      `SELECT role FROM lw_cluster_members WHERE user_id::text = $1`,
      [caller.userId],
    );

    return member?.role === 'cluster-admin' ? 'cluster-member' : 'global-admin';
  }

  private async projectIds(projects: string[]): Promise<string[]> {
    const rows: { id: string }[] = await this.dataSource.query(
      `SELECT id FROM lw_resources WHERE kind = 'Project' AND name = ANY($1) ORDER BY name`,
      [projects],
    );

    return rows.map((r) => r.id);
  }

  private async stillValid(row: TokenRow): Promise<boolean> {
    if (row.projects && JSON.stringify(await this.projectIds(row.projects)) !== JSON.stringify(row.project_ids ?? []))
      return false;

    if (row.creator_basis === 'api-key') return true;

    if (row.creator_basis === 'project-admin') {
      const [{ n }]: { n: number }[] = await this.dataSource.query(
        `SELECT count(*)::int AS n FROM lw_project_members WHERE user_id = $1 AND role = 'admin' AND project = ANY($2)`,
        [row.created_by, row.projects ?? []],
      );

      if (n === (row.projects ?? []).length) return true;
    }

    return await this.isAdmin(row.created_by);
  }

  /** Cluster admin by membership, or a global admin whose user record says so (identity-provider admins have none). */
  private async isAdmin(userId: string | null): Promise<boolean> {
    if (!userId) return false;

    const [member]: { role: string }[] = await this.dataSource.query(
      `SELECT role FROM lw_cluster_members WHERE user_id::text = $1`,
      [userId],
    );

    if (member?.role === 'cluster-admin') return true;

    const [user]: { role: string }[] = await this.dataSource
      .query(`SELECT role FROM users WHERE id::text = $1`, [userId])
      .catch(() => []);

    // Without a local user record (identity-provider admins) the token stands until revoked or expired.
    return !user || user.role === 'admin';
  }
}
