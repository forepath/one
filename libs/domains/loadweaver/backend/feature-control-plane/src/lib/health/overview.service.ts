import type { RequestWithUser } from '@forepath/identity/backend';
import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, LessThan, Not } from 'typeorm';

import {
  approvalNeeded,
  atLeast,
  canReadProject,
  planVisibleTo,
  projectRole,
  type AccessCaller,
} from '../access/access.utils';
import { ProjectAccessService } from '../access/project-access.service';
import { AlertService } from '../alerts/alert.service';
import { CertificateEntity } from '../entities/certificate.entity';
import { databaseTarget } from '../database-handover/database-target.runtime';
import { NodeEntity } from '../entities/node.entity';
import { nodeConnectedInCluster } from '../services/nodes.service';
import { PlanEntity } from '../entities/plan.entity';
import {
  PlanApprovalEntity,
  ProjectSettingsEntity,
  type ApprovalMode,
  type ProjectRole,
} from '../entities/project-access.entity';
import { ResourceEntity } from '../entities/resource.entity';
import { MetricsStore } from '../metrics/metrics.store';
import { frozenMetricsAsOf, liveTraffic } from '../metrics/read-only-metrics';
import { DriftService } from '../plans/drift.service';
import { GitConnectionEntity } from '../entities/git.entity';
import { GitScopeService } from '../git/git-scope.service';
import { headline, type HealthNode, type HealthState } from './health-tree.utils';
import { HealthService, type HealthEntityDto } from './health.service';
import { BackupsService } from '../backups/backups.service';
import { BuiltinMemberService, type BuiltinMemberStatus } from '../builtin-member/builtin-member.service';
import { MasterKeyService, type BuiltinKeyRole } from '../services/master-key.service';
import { SloService } from './slo.service';
import { DatabaseHandoverService } from '../database-handover/database-handover.service';
import { databaseInboxItems } from '../database-handover/database-inbox';

export interface InboxItem {
  kind:
    | 'rollback-failed'
    | 'health'
    | 'approval'
    | 'pins'
    | 'drift'
    | 'alert'
    | 'certificate'
    | 'cross-project-request'
    | 'git-ahead'
    | 'git-push-rejected'
    | 'git-error'
    | 'backups'
    | 'master-key'
    | 'database';
  severity: 'critical' | 'warning' | 'info';
  title: string;
  /** Where it is resolved (console route). */
  link: string;
  project?: string;
  since?: string;
}

export interface OverviewDto {
  headline: { state: HealthState; message: string; key: string | null };
  inbox: InboxItem[];
  summary: {
    sites: number;
    nodes: { total: number; up: number };
    deployments: number;
    capacity: {
      cpuMillis: { used: number; total: number };
      memoryBytes: { used: number; total: number; reserve: number };
    } | null;
    requestsPerSecond: number | null;
    deniedPackets5m: number | null;
    alertsFiring: number;
    slos: { total: number; ok: number; burning: number; exhausted: number };
    /**
     * Only while the control plane is read-only (3.43 fallback): health, alerts, nodes, capacity and traffic are live,
     * the SLOs reach until `metricsAsOf` (the last stored metric sample; null without any).
     */
    readOnly?: { metricsAsOf: string | null };
  };
  activity: { time: string; kind: string; entity: string; project: string | null; message: string }[];
}

export interface KioskSection {
  scope: string;
  headline: OverviewDto['headline'];
  inbox: InboxItem[];
  summary: OverviewDto['summary'];
}

const SEVERITY_RANK = { critical: 0, warning: 1, info: 2 } as const;

/** Inbox order: critical first, then oldest first (what has waited longest). */
export function sortInbox(items: InboxItem[]): InboxItem[] {
  return [...items].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || (a.since ?? '').localeCompare(b.since ?? ''),
  );
}

/** Health entities worth an inbox item: failed / at-risk ones that aren't just the effect of another listed one. */
export function healthItems(entities: readonly HealthEntityDto[]): InboxItem[] {
  const listed = new Set(entities.map((e) => e.key));

  return entities
    .filter((e) => !e.parent || !listed.has(e.parent) || e.kind === 'volume')
    .map((e) => ({
      kind: 'health' as const,
      severity: e.state === 'failed' ? ('critical' as const) : ('warning' as const),
      title: `${e.kind} ${e.name}: ${e.reasons[0]?.message ?? e.state}`,
      link: `/observe/health/${e.key}`,
      ...(e.project ? { project: e.project } : {}),
      since: e.since,
    }));
}

/** Where the built-in control-plane member is shown (the cluster page, its Nodes list). */
const BUILTIN_MEMBER_LINK = '/resources/cluster';

/**
 * Master-key items about the built-in control-plane member (3.39, user decisions 2026-10-29): critical when its key
 * doesn't match / is missing, a warning while it is the only key holder, and a quiet but permanent info item while it
 * keeps the standby copy (the security trade-off: a DB dump plus the control-plane state volume can rebuild the key).
 */
export function masterKeyInboxItems(
  status: Pick<BuiltinMemberStatus, 'state'>,
  role: BuiltinKeyRole,
  kms: boolean,
): InboxItem[] {
  const items: InboxItem[] = [];

  if (status.state === 'key-mismatch')
    items.push({
      kind: 'master-key',
      severity: 'critical',
      title:
        "the built-in control-plane member's seal key does not match the registered one: mount the original control-plane state volume",
      link: BUILTIN_MEMBER_LINK,
    });
  else if (status.state === 'missing-key' || status.state === 'error')
    items.push({
      kind: 'master-key',
      severity: role.holder || role.standby ? 'critical' : 'warning',
      title: "the built-in control-plane member can't read its seal key",
      link: BUILTIN_MEMBER_LINK,
    });

  if (kms) return items;

  if (role.holder && role.realMembers === 0)
    items.push({
      kind: 'master-key',
      severity: 'warning',
      title:
        'only one key holder: the built-in control-plane member holds the master key alone — add a node or a KMS, back up the recovery kit',
      link: BUILTIN_MEMBER_LINK,
    });
  else if (role.standby)
    items.push({
      kind: 'master-key',
      severity: 'info',
      title:
        'the built-in control-plane member keeps a standby copy of the master key: a database dump together with the control-plane state volume can rebuild it',
      link: BUILTIN_MEMBER_LINK,
    });

  return items;
}

/**
 * The cluster overview (3.25): health headline with its reason, the needs-attention inbox (each item links to where
 * it is resolved), the summary bar and recent activity — the same layout for everyone, scoped to what the caller
 * may see (project members get their projects).
 */

/** How far back the overview's "Recent activity" reaches (newest 20 events within it). */
const ACTIVITY_WINDOW_MS = 30 * 86_400_000;
@Injectable()
export class OverviewService {
  private readonly logger = new Logger(OverviewService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ProjectAccessService,
    private readonly health: HealthService,
    private readonly alerts: AlertService,
    private readonly drift: DriftService,
    private readonly metrics: MetricsStore,
    private readonly slos: SloService,
    private readonly git: GitScopeService,
    private readonly backups: BackupsService,
    private readonly masterKey: MasterKeyService,
    private readonly builtin: BuiltinMemberService,
    @Optional() private readonly database?: DatabaseHandoverService,
  ) {}

  async overview(req: RequestWithUser | undefined, project?: string): Promise<OverviewDto> {
    const caller = await this.access.caller(req);

    if (project && !canReadProject(caller, project)) throw new NotFoundException('project not found');

    if (!caller.clusterRole && caller.projects.size === 0) throw new NotFoundException('nothing to show');

    const roots = (await this.health.roots(caller)).filter((r) => !project || r.project === project);
    const inScope = (p: string | null | undefined) => (project ? p === project : true);
    const inbox = (await this.inbox(req, caller)).filter((i) => !project || i.project === project);

    return {
      headline: headline(roots as HealthNode[]),
      inbox: sortInbox(inbox).slice(0, 100),
      summary: await this.summary(caller, project),
      // The last 20 events of the past 30 days (LW-03 round 2): the events API defaults to the last 24 h, which left
      // "Recent activity" empty after a quiet day although plans had been applied the day before.
      activity: (
        await this.metrics
          .events(req, {
            from: new Date(Date.now() - ACTIVITY_WINDOW_MS).toISOString(),
            ...(project ? { project } : {}),
            limit: 20,
          })
          .catch(() => [])
      ).filter((e) => inScope(e.project) || (!project && !e.project)),
    };
  }

  /**
   * The kiosk view (3.25 wallboard): read-only, for a wallboard token's synthetic caller — headline, the
   * not-user-specific part of the inbox (failed rollbacks, failed / at-risk entities, firing alerts) and the summary,
   * once for the scope and once per project for the rotation.
   */
  async kiosk(caller: AccessCaller, projects: string[] | null): Promise<KioskSection[]> {
    const sections: KioskSection[] = [];
    const roots = await this.health.roots(caller, true);
    const items: InboxItem[] = [];

    for (const p of (
      await this.dataSource.getRepository(PlanEntity).find({ where: { status: 'rollback-failed' } })
    ).filter((x) => planVisibleTo(caller, x.changes)))
      items.push({
        kind: 'rollback-failed',
        severity: 'critical',
        title: `Rollback of plan ${p.id} failed`,
        link: `/activity/plans/${p.id}`,
        ...this.projectOf(p),
      });

    items.push(
      ...healthItems(
        await this.health.inState(
          caller,
          ['failed', 'at-risk'],
          ['cluster', 'site', 'node', 'project', 'deployment', 'service', 'volume'],
        ),
      ),
    );

    for (const a of (await this.alerts.listFor(caller, { state: 'open' })).filter(
      (x) => x.state === 'firing' && !x.silenced,
    ))
      items.push({
        kind: 'alert',
        severity: a.severity === 'critical' ? 'critical' : a.severity === 'warning' ? 'warning' : 'info',
        title: a.title,
        link: `/observe/alerts/${a.id}`,
        ...(a.project ? { project: a.project } : {}),
        since: a.firedAt ?? a.startedAt,
      });

    const scopes: (string | null)[] = projects
      ? projects
      : [null, ...roots.filter((r) => r.kind === 'project').map((r) => r.name)];

    for (const project of scopes) {
      const sectionRoots = roots.filter((r) => (project ? r.key === `project/${project}` : r.kind === 'cluster'));

      sections.push({
        scope: project ?? 'cluster',
        headline: headline(sectionRoots as HealthNode[]),
        inbox: sortInbox(items.filter((i) => !project || i.project === project)).slice(0, 20),
        summary: await this.summary(caller, project ?? undefined),
      });
    }

    return sections;
  }

  private async inbox(req: RequestWithUser | undefined, caller: AccessCaller): Promise<InboxItem[]> {
    const items: InboxItem[] = [];
    const guard = async (what: string, fn: () => Promise<void>) =>
      await fn().catch((error: unknown) => this.logger.debug(`Inbox ${what}: ${String(error)}`));

    // Failed rollbacks (3.19).
    await guard('rollbacks', async () => {
      const plans = await this.dataSource.getRepository(PlanEntity).find({ where: { status: 'rollback-failed' } });

      for (const p of plans.filter((x) => planVisibleTo(caller, x.changes)))
        items.push({
          kind: 'rollback-failed',
          severity: 'critical',
          title: `Rollback of plan ${p.id} failed — apply its fix-forward plan`,
          link: `/activity/plans/${p.id}`,
          ...this.projectOf(p),
          since: p.updatedAt.toISOString(),
        });
    });

    // At-risk / failed entities (3.12 / 3.25).
    await guard('health', async () => {
      items.push(
        ...healthItems(
          await this.health.inState(
            caller,
            ['failed', 'at-risk'],
            ['cluster', 'site', 'node', 'project', 'deployment', 'service', 'volume'],
          ),
        ),
      );
    });

    // Pending approvals the caller can give, and unacknowledged pins (3.17).
    await guard('approvals', async () => {
      const pending = await this.dataSource.getRepository(PlanEntity).find({ where: { status: 'pending' } });
      const settings = new Map(
        (await this.dataSource.getRepository(ProjectSettingsEntity).find()).map((s) => [s.project, s.approvalMode]),
      );
      const approvals = pending.length
        ? await this.dataSource
            .getRepository(PlanApprovalEntity)
            .createQueryBuilder('a')
            .where('a.plan_id IN (:...ids)', { ids: pending.map((p) => p.id) })
            .getMany()
        : [];

      for (const p of pending) {
        for (const [project, role] of Object.entries(p.creatorRoles ?? {})) {
          const risky = (p.risk?.[project] ?? []).length > 0;
          const mode: ApprovalMode = settings.get(project) ?? 'developers';
          const approved = approvals.some((a) => a.planId === p.id && a.project === project);
          const mayApprove = atLeast(projectRole(caller, project), 'operator') && p.createdBy !== caller.userId;

          if (!approved && mayApprove && approvalNeeded(mode, role as ProjectRole, risky))
            items.push({
              kind: 'approval',
              severity: 'info',
              title: `Plan ${p.id} waits for your approval in ${project}`,
              link: `/activity/plans/${p.id}`,
              project,
              since: p.createdAt.toISOString(),
            });

          if ((p.risk?.[project] ?? []).includes('unacknowledged pins') && canReadProject(caller, project))
            items.push({
              kind: 'pins',
              severity: 'warning',
              title: `Plan ${p.id} has unacknowledged pins in ${project}`,
              link: `/activity/plans/${p.id}`,
              project,
              since: p.createdAt.toISOString(),
            });
        }
      }
    });

    // Drift (3.8): cluster roles.
    if (caller.clusterRole)
      await guard('drift', async () => {
        const report = await this.drift.report(req);

        if (report.containers.length)
          items.push({
            kind: 'drift',
            severity: 'warning',
            title: `${report.containers.length} container(s) on the nodes aren't managed by Loadweaver`,
            link: '/delivery/drift',
          });
      });

    // Firing alerts (3.18).
    await guard('alerts', async () => {
      for (const a of (await this.alerts.list(req, { state: 'open' })).filter(
        (x) => x.state === 'firing' && !x.acknowledgedAt && !x.silenced,
      ))
        items.push({
          kind: 'alert',
          severity: a.severity === 'critical' ? 'critical' : a.severity === 'warning' ? 'warning' : 'info',
          title: a.title,
          link: `/observe/alerts/${a.id}`,
          ...(a.project ? { project: a.project } : {}),
          since: a.firedAt ?? a.startedAt,
        });
    });

    // Certificates expiring within 21 days (renewal starts at 30): cluster roles.
    if (caller.clusterRole)
      await guard('certificates', async () => {
        const soon = await this.dataSource
          .getRepository(CertificateEntity)
          .find({ where: { notAfter: LessThan(new Date(Date.now() + 21 * 86_400_000)) } });

        for (const c of soon)
          items.push({
            kind: 'certificate',
            severity: 'warning',
            title: `Certificate for ${c.names.slice(0, 3).join(', ')} expires ${c.notAfter?.toISOString().slice(0, 10)}${c.lastError ? ` (renewal: ${c.lastError})` : ''}`,
            link: `/delivery/certificates/${c.id}`,
          });
      });

    // Master key (3.39): the built-in control-plane member as sole holder / standby / with a broken key; cluster roles.
    if (caller.clusterRole)
      await guard('master-key', async () => {
        const [status, role, key] = await Promise.all([
          this.builtin.status(),
          this.masterKey.builtinRole(),
          this.masterKey.describe(),
        ]);

        items.push(...masterKeyInboxItems(status, role, !!key?.kms));
      });

    // The cluster's database (3.43 takeover): taken over by the built-in control plane, read-only without a takeover,
    // fenced members' moved-aside data / exported rows.
    if (caller.clusterRole && this.database)
      await guard('database', async () => {
        items.push(...databaseInboxItems(await (this.database as DatabaseHandoverService).inboxState(), Date.now()));
      });

    // Backups (3.20): unconfirmed recovery kit, deletions waiting for a second admin.
    await guard('backups', async () => {
      for (const item of await this.backups.inboxItems(caller)) items.push({ kind: 'backups', ...item });
    });

    // Pending cross-project requests (3.17) for projects where the caller may accept.
    await guard('requests', async () => {
      const projects =
        caller.clusterRole === 'cluster-admin'
          ? (
              await this.dataSource
                .getRepository(ResourceEntity)
                .find({ where: { kind: 'Project' }, select: { name: true } })
            ).map((r) => r.name)
          : [...caller.projects.keys()].filter((p) => atLeast(projectRole(caller, p), 'operator'));

      for (const project of projects) {
        const open = (await this.access.requests(req, project)).filter((r) => !r.accepted);

        if (open.length)
          items.push({
            kind: 'cross-project-request',
            severity: 'info',
            title:
              open.length === 1
                ? `1 policy request from another project waits for ${project}`
                : `${open.length} policy requests from other projects wait for ${project}`,
            link: `/access/requests/${project}`,
            project,
          });
      }
    });

    // Git (3.29 / 3.30): default branch ahead of the cluster, rejected pushes, broken connections.
    await guard('git', async () => {
      const visible = (scope: string | null) => (scope === null ? !!caller.clusterRole : canReadProject(caller, scope));

      for (const entry of await this.git.ahead()) {
        const scope = entry.scope === 'cluster' ? null : entry.scope;

        if (!visible(scope)) continue;

        const where = scope ? `project ${scope}` : 'the cluster scope';
        const commit = entry.commit.slice(0, 12);

        items.push(
          entry.state === 'rejected'
            ? {
                kind: 'git-push-rejected',
                severity: 'critical',
                title: `Push ${commit} to ${where} was rejected: ${entry.reason ?? 'plaintext secrets'}`.slice(0, 300),
                link: `/delivery/git/${entry.connection}`,
                ...(scope ? { project: scope } : {}),
                since: entry.since,
              }
            : {
                kind: 'git-ahead',
                severity: 'warning',
                title:
                  `Default branch of ${where} is ahead of the cluster: commit ${commit} is ${entry.state}${entry.reason ? ` (${entry.reason})` : ''}`.slice(
                    0,
                    300,
                  ),
                link: entry.planId ? `/activity/plans/${entry.planId}` : `/delivery/git/${entry.connection}`,
                ...(scope ? { project: scope } : {}),
                since: entry.since,
              },
        );
      }

      for (const c of await this.dataSource.getRepository(GitConnectionEntity).find())
        if (c.lastError && visible(c.project))
          items.push({
            kind: 'git-error',
            severity: 'warning',
            title:
              `Git connection of ${c.project ? `project ${c.project}` : 'the cluster scope'}: ${c.lastError}`.slice(
                0,
                300,
              ),
            link: `/delivery/git/${c.id}`,
            ...(c.project ? { project: c.project } : {}),
            since: c.updatedAt.toISOString(),
          });
    });

    return items;
  }

  private projectOf(plan: PlanEntity): { project?: string } {
    const projects = [...new Set(plan.changes.flatMap((c) => (c.project ? [c.project] : [])))];

    return projects.length === 1 ? { project: projects[0] } : {};
  }

  private async summary(caller: AccessCaller, project?: string): Promise<OverviewDto['summary']> {
    const nodes = await this.dataSource.getRepository(NodeEntity).find({ where: { lifecycle: Not('left') } });
    const healthRows = (await this.health.currentRows()).filter((r) => r.kind === 'node');
    const nodeState = new Map(healthRows.map((r) => [r.key, r.state]));
    const deployments = (
      await this.dataSource
        .getRepository(ResourceEntity)
        .find({ where: { kind: 'Deployment' }, select: { project: true } })
    ).filter((d) => d.project && canReadProject(caller, d.project) && (!project || d.project === project));
    const infra = !!caller.clusterRole && !project;
    // Capacity of the nodes that are up (2026-10-31): an offline node's last report says nothing about now, so neither
    // its usage nor its capacity counts; without any connected worker the summary has no capacity.
    const now = Date.now();
    const workers = nodes.filter((n) => !n.witness && n.capacity && nodeConnectedInCluster(n, now));
    const sum = (f: (n: NodeEntity) => number) => workers.reduce((a, n) => a + f(n), 0);
    let requestsPerSecond: number | null = null;
    let deniedPackets5m: number | null = null;

    if (infra && databaseTarget.fallback) {
      // Read-only fallback (3.43): nothing new is stored; the traffic numbers come from the reports in memory.
      requestsPerSecond = liveTraffic.requestsPerSecond(now);
      deniedPackets5m = liveTraffic.deniedPackets5m(now);
    } else if (infra) {
      const [traffic]: { rps: string | null }[] = await this.dataSource.query(
        `SELECT sum(v) AS rps FROM (SELECT DISTINCT ON (node, entity) value AS v FROM lw_metrics
         WHERE metric = 'ingress.requests_per_s' AND "time" >= now() - INTERVAL '1 minute' ORDER BY node, entity, "time" DESC) t`,
      );
      const [denied]: { n: string | null }[] = await this.dataSource.query(
        `SELECT sum(packets) AS n FROM lw_flows WHERE decision = 'denied' AND "time" >= now() - INTERVAL '5 minutes'`,
      );

      requestsPerSecond = Number(traffic?.rps ?? 0);
      deniedPackets5m = Number(denied?.n ?? 0);
    }

    const alerts = await this.alerts
      .listFor(caller, { state: 'open', ...(project ? { project } : {}) })
      .catch(() => []);
    const slos = await this.slos.listFor(caller, project).catch(() => []);
    const metricsAsOf = databaseTarget.fallback ? await frozenMetricsAsOf(this.dataSource) : null;

    return {
      sites: infra ? new Set(nodes.map((n) => n.site)).size : 0,
      nodes: infra
        ? {
            total: nodes.length,
            up: nodes.filter((n) => !['failed', 'unknown', undefined].includes(nodeState.get(`node/${n.name}`))).length,
          }
        : { total: 0, up: 0 },
      deployments: deployments.length,
      capacity:
        infra && workers.length > 0
          ? {
              cpuMillis: { used: sum((n) => n.usage?.cpuMillis ?? 0), total: sum((n) => n.capacity?.cpuMillis ?? 0) },
              memoryBytes: {
                used: sum((n) => n.usage?.memoryBytes ?? 0),
                total: sum((n) => n.capacity?.memoryBytes ?? 0),
                // N+1: what must stay free to absorb the largest node.
                reserve: Math.max(0, ...workers.map((n) => n.capacity?.memoryBytes ?? 0)),
              },
            }
          : null,
      requestsPerSecond,
      deniedPackets5m,
      alertsFiring: alerts.filter((a) => a.state === 'firing').length,
      slos: {
        total: slos.length,
        ok: slos.filter((x) => x.state === 'ok').length,
        burning: slos.filter((x) => x.state === 'burning').length,
        exhausted: slos.filter((x) => x.state === 'exhausted').length,
      },
      ...(databaseTarget.fallback ? { readOnly: { metricsAsOf: metricsAsOf?.toISOString() ?? null } } : {}),
    };
  }
}
