import type { RequestWithUser } from '@forepath/identity/backend';
import { durationMs, type AlertRuleSpec, type Resource } from '@forepath/loadweaver/shared/util-model';
import { OpenSearchService } from '@forepath/shared/backend/util-opensearch';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, LessThan, MoreThan, Not } from 'typeorm';

import { atLeast, canReadProject, projectRole, type AccessCaller } from '../access/access.utils';
import { ProjectAccessService } from '../access/project-access.service';
import { AuditService } from '../audit/audit.service';
import { CertificateEntity } from '../entities/certificate.entity';
import { DnsFailoverStateEntity } from '../entities/dns-failover.entity';
import { DnsZoneStatusEntity } from '../entities/dns-zone-status.entity';
import { NodeEntity } from '../entities/node.entity';
import { PlanEntity } from '../entities/plan.entity';
import { ResourceEntity } from '../entities/resource.entity';
import { WorkloadPlacementEntity } from '../entities/workload-placement.entity';
import { WorkloadPlannerService } from '../services/workload-planner.service';
import { SloService } from '../health/slo.service';
import { BackupsService } from '../backups/backups.service';
import { PostureIntegrationsService } from '../posture/posture-integrations.service';
import { backupBytesByProject } from '../backups/backup-usage';
import { projectUsage, quotaShares } from '../access/plan-access.utils';
import { LogsService } from '../logs/logs.service';
import { LoadweaverNotificationPublisher } from '../notifications/loadweaver-notifications.module';
import { actorFromRequest, AuditLogService, type AuditVerification } from '../services/audit-log.service';
import { ResourceStoreService } from '../services/resource-store.service';
import {
  compare,
  deniesSpiking,
  seriesChange,
  shouldEscalate,
  silenced,
  transition,
  type AlertFinding,
  type Silence,
} from './alert-rules.utils';

const TICK_MS = 30_000;
const ADVISORY_LOCK_ALERTS = 0x4c570014;
const AUDIT_VERIFY_MS = 3_600_000;
const NODE_STALE_MS = 60_000;
const MAX_WINDOW_MS = 86_400_000;
const MAX_SERIES_PER_RULE = 200;
const MAX_SILENCE_MS = 30 * 86_400_000;
const BUILTIN_REPEAT_MS = 4 * 3_600_000;

export type AlertState = 'pending' | 'firing' | 'resolved';

export interface AlertDto {
  id: string;
  rule: string;
  key: string;
  project: string | null;
  severity: AlertFinding['severity'];
  state: AlertState;
  title: string;
  message: string;
  value: number | null;
  startedAt: string;
  firedAt: string | null;
  resolvedAt: string | null;
  silenced: boolean;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
}

export interface SilenceDto {
  id: string;
  rule: string | null;
  project: string | null;
  key: string | null;
  reason: string;
  createdBy: string | null;
  startsAt: string;
  endsAt: string;
}

interface AlertRow {
  id: string;
  rule: string;
  key: string;
  project: string | null;
  severity: AlertFinding['severity'];
  state: AlertState;
  title: string;
  message: string;
  value: number | null;
  started_at: Date;
  fired_at: Date | null;
  resolved_at: Date | null;
  notified_at: Date | null;
  escalated_at: Date | null;
  silenced: boolean;
  acknowledged_by: string | null;
  acknowledged_at: Date | null;
}

interface SilenceRow {
  id: string;
  rule: string | null;
  project: string | null;
  key: string | null;
  reason: string;
  created_by: string | null;
  starts_at: Date;
  ends_at: Date;
}

function toDto(row: AlertRow): AlertDto {
  const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

  return {
    id: row.id,
    rule: row.rule,
    key: row.key,
    project: row.project,
    severity: row.severity,
    state: row.state,
    title: row.title,
    message: row.message,
    value: row.value === null ? null : Number(row.value),
    startedAt: new Date(row.started_at).toISOString(),
    firedAt: iso(row.fired_at),
    resolvedAt: iso(row.resolved_at),
    silenced: row.silenced,
    acknowledgedBy: row.acknowledged_by,
    acknowledgedAt: iso(row.acknowledged_at),
  };
}

function silenceDto(row: SilenceRow): SilenceDto {
  return {
    id: row.id,
    rule: row.rule,
    project: row.project,
    key: row.key,
    reason: row.reason,
    createdBy: row.created_by,
    startsAt: new Date(row.starts_at).toISOString(),
    endsAt: new Date(row.ends_at).toISOString(),
  };
}

/** The rule name of a custom `AlertRule` resource. */
export function customRuleName(resource: { metadata: { name: string; project?: string } }): string {
  return `rule:${resource.metadata.project ?? '_'}/${resource.metadata.name}`;
}

/** Cluster alerts are for cluster roles; project alerts also for those who may read the project. */
function mayRead(caller: AccessCaller, project: string | null): boolean {
  return project ? canReadProject(caller, project) : !!caller.clusterRole;
}

/** Acknowledge / silence: project operators for project alerts, cluster admins and infra operators for the rest. */
function mayManage(caller: AccessCaller, project: string | null): boolean {
  if (caller.clusterRole === 'cluster-admin' || caller.clusterRole === 'infra-operator') return true;

  return !!project && atLeast(projectRole(caller, project), 'operator');
}

/**
 * Alerting (3.18): every 30 s one control-plane replica (advisory lock) evaluates the built-in alerts and the
 * custom `AlertRule` policies, moves alerts pending → firing → resolved, applies silences and maintenance (nodes
 * being drained), and delivers through the notifications feature (webhooks, email) with repeats and escalation.
 * A source that fails to evaluate leaves its alerts as they are rather than resolving them.
 */
@Injectable()
export class AlertService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AlertService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private audit: { at: number; result: AuditVerification | null } = { at: 0, result: null };
  private prunedAt = 0;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly resources: ResourceStoreService,
    private readonly access: ProjectAccessService,
    private readonly auditLog: AuditLogService,
    private readonly auditMirror: AuditService,
    private readonly logs: LogsService,
    private readonly opensearch: OpenSearchService,
    private readonly notifications: LoadweaverNotificationPublisher,
    private readonly planner: WorkloadPlannerService,
    private readonly slos: SloService,
    private readonly backups: BackupsService,
    private readonly posture: PostureIntegrationsService,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One evaluation, by one replica at a time. */
  async tick(now = new Date()): Promise<boolean> {
    if (this.running) return false;

    this.running = true;

    const runner = this.dataSource.createQueryRunner();

    try {
      await runner.connect();

      const [{ locked }] = await runner.query('SELECT pg_try_advisory_lock($1) AS locked', [ADVISORY_LOCK_ALERTS]);

      if (!locked) return false;

      try {
        await this.evaluate(now);
      } finally {
        await runner.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_ALERTS]);
      }

      return true;
    } catch (error) {
      this.logger.warn(`Alert evaluation: ${error instanceof Error ? error.message : String(error)}`);

      return false;
    } finally {
      await runner.release();
      this.running = false;
    }
  }

  private async evaluate(now: Date): Promise<void> {
    // History (3.18 retention): resolved alerts 13 months, ended silences 90 days; hourly.
    if (now.getTime() - this.prunedAt >= AUDIT_VERIFY_MS) {
      this.prunedAt = now.getTime();
      await this.dataSource.query(
        `DELETE FROM lw_alerts WHERE state = 'resolved' AND resolved_at < now() - INTERVAL '395 days'`,
      );
      await this.dataSource.query(`DELETE FROM lw_alert_silences WHERE ends_at < now() - INTERVAL '90 days'`);
    }

    const builtinEmails = await this.builtinEmails();
    const findings: AlertFinding[] = [];
    // Rules whose evaluation succeeded: only their open alerts may resolve.
    const evaluated = new Set<string>();
    const sources: [string, () => Promise<AlertFinding[]>][] = [
      ['builtin:node-down', () => this.nodeDown(now)],
      ['builtin:replica-lost', () => this.replicaLost()],
      ['builtin:failover', () => this.failovers(now)],
      ['builtin:capacity', () => this.capacity()],
      ['builtin:certificate-expiring', () => this.certificates(now)],
      ['builtin:dns-drift', () => this.dnsDrift()],
      ['builtin:rollback-failed', () => this.rollbackFailed()],
      ['builtin:audit-chain-broken', () => this.auditChain(now)],
      ['builtin:denies-spiking', () => this.denies()],
      ['builtin:cluster-at-risk', () => this.clusterAtRisk()],
      ['builtin:quota-near-limit', () => this.quotas()],
      ['builtin:slo-burn', () => this.sloBurn()],
      ['builtin:autoscale-blocked', () => this.autoscaleBlocked()],
      // Device posture (3.31).
      ['builtin:device-restricted', () => this.devicesRestricted()],
      ['builtin:posture-integration-failing', () => this.postureIntegrationsFailing()],
      // Backups (3.20).
      ['builtin:backup-failed', () => this.backups.alertFindings('builtin:backup-failed', now)],
      ['builtin:restore-test-failed', () => this.backups.alertFindings('builtin:restore-test-failed', now)],
      ['builtin:backup-kit-unconfirmed', () => this.backups.alertFindings('builtin:backup-kit-unconfirmed', now)],
      ['builtin:backup-deletion-requested', () => this.backups.alertFindings('builtin:backup-deletion-requested', now)],
    ];

    for (const [rule, source] of sources) {
      try {
        findings.push(
          ...(await source()).map((f) => ({
            ...f,
            notify: { webhooks: true, emails: builtinEmails },
            repeatMs: BUILTIN_REPEAT_MS,
          })),
        );
        evaluated.add(rule);
      } catch (error) {
        this.logger.warn(`Built-in alert ${rule}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const rules = await this.resources.list('AlertRule');
    const existing = new Set(rules.map(customRuleName));

    for (const rule of rules) {
      try {
        findings.push(...(await this.custom(rule)));
        evaluated.add(customRuleName(rule));
      } catch (error) {
        this.logger.warn(
          `Alert rule ${customRuleName(rule)}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const open: AlertRow[] = await this.dataSource.query(`SELECT * FROM lw_alerts WHERE state <> 'resolved'`);
    const silences = (
      (await this.dataSource.query(`SELECT * FROM lw_alert_silences WHERE starts_at <= $1 AND ends_at > $1`, [
        now,
      ])) as SilenceRow[]
    ).map((s): Silence => ({ rule: s.rule, project: s.project, key: s.key, startsAt: s.starts_at, endsAt: s.ends_at }));
    const maintenance = new Set(
      (
        await this.dataSource
          .getRepository(NodeEntity)
          .find({ where: { lifecycle: In(['draining', 'leaving']) }, select: { name: true } })
      ).map((n) => n.name),
    );

    // Nodes an update rollout is restarting, rebooting or verifying right now are in maintenance too (3.26).
    for (const row of (await this.dataSource
      .query(
        `SELECT DISTINCT s.node FROM lw_rollout_steps s JOIN lw_rollouts r ON r.id = s.rollout_id
         WHERE r.status IN ('running', 'paused', 'rolling-back')
           AND s.state IN ('draining', 'applying', 'rebooting', 'verifying', 'rolling-back')`,
      )
      .catch(() => [])) as { node: string }[])
      maintenance.add(row.node);

    const byKey = new Map(findings.map((f) => [`${f.rule}\u0000${f.key}`, f]));
    const openByKey = new Map(open.map((a) => [`${a.rule}\u0000${a.key}`, a]));

    for (const [id, alert] of openByKey) {
      // Gone findings resolve, as do alerts of removed rules; a rule that failed this tick keeps its alerts.
      const removed = alert.rule.startsWith('rule:') && !existing.has(alert.rule);

      if (!byKey.has(id) && (evaluated.has(alert.rule) || removed)) await this.resolve(alert, now);
    }

    for (const [id, finding] of byKey) {
      const row = openByKey.get(id);
      const quiet = silenced(silences, finding, now.getTime()) || (!!finding.node && maintenance.has(finding.node));
      const current = row
        ? {
            state: row.state as 'pending' | 'firing',
            startedAt: new Date(row.started_at),
            notifiedAt: row.notified_at ? new Date(row.notified_at) : null,
            acknowledgedAt: row.acknowledged_at ? new Date(row.acknowledged_at) : null,
            firedAt: row.fired_at ? new Date(row.fired_at) : null,
            escalatedAt: row.escalated_at ? new Date(row.escalated_at) : null,
            silenced: quiet,
          }
        : undefined;
      const action = transition(current, finding, now.getTime());

      if (action === 'pend' || (action === 'fire' && !row)) {
        const [inserted]: AlertRow[] = await this.dataSource.query(
          `INSERT INTO lw_alerts (rule, key, project, severity, state, title, message, value, started_at, fired_at, silenced)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (rule, key) WHERE state <> 'resolved' DO NOTHING RETURNING *`,
          [
            finding.rule,
            finding.key,
            finding.project ?? null,
            finding.severity,
            action === 'pend' ? 'pending' : 'firing',
            finding.title.slice(0, 512),
            finding.message.slice(0, 4000),
            finding.value ?? null,
            now,
            action === 'fire' ? now : null,
            quiet,
          ],
        );

        if (inserted && action === 'fire' && !quiet) await this.deliver(inserted, finding, 'firing', now);

        continue;
      }

      if (!row) continue;

      await this.dataSource.query(
        `UPDATE lw_alerts SET severity = $2, title = $3, message = $4, value = $5, silenced = $6,
           state = CASE WHEN $7 THEN 'firing' ELSE state END, fired_at = CASE WHEN $7 THEN $8 ELSE fired_at END
         WHERE id = $1`,
        [
          row.id,
          finding.severity,
          finding.title.slice(0, 512),
          finding.message.slice(0, 4000),
          finding.value ?? null,
          quiet,
          action === 'fire',
          now,
        ],
      );

      const updated = { ...row, title: finding.title, message: finding.message, value: finding.value ?? null };

      if ((action === 'fire' && !quiet) || action === 'notify') await this.deliver(updated, finding, 'firing', now);

      if (current && action !== 'fire' && shouldEscalate(current, finding, now.getTime()) && finding.escalate) {
        await this.notifications.email(
          'alert.firing',
          'alert-firing',
          finding.escalate.emails,
          this.emailContext(updated, true),
          `alert:${row.id}:escalated`,
        );
        await this.dataSource.query(`UPDATE lw_alerts SET escalated_at = $2 WHERE id = $1`, [row.id, now]);
      }
    }
  }

  private emailContext(alert: AlertRow | (AlertRow & Record<string, unknown>), escalated = false) {
    return {
      title: alert.title,
      message: alert.message,
      severity: alert.severity,
      rule: alert.rule,
      entity: alert.key,
      project: alert.project ?? '',
      value: alert.value ?? '',
      since: new Date(alert.started_at).toISOString(),
      escalated,
    };
  }

  private payload(alert: AlertRow) {
    return {
      id: alert.id,
      rule: alert.rule,
      key: alert.key,
      project: alert.project,
      severity: alert.severity,
      title: alert.title,
      message: alert.message,
      value: alert.value,
      startedAt: new Date(alert.started_at).toISOString(),
    };
  }

  /** Webhooks and emails for a firing alert; it counts as notified only when the queue took it. */
  private async deliver(alert: AlertRow, finding: AlertFinding, kind: 'firing', now: Date): Promise<void> {
    try {
      if (finding.notify.webhooks) await this.notifications.publish(`alert.${kind}`, this.payload(alert));

      await this.notifications.email(
        'alert.firing',
        'alert-firing',
        finding.notify.emails,
        this.emailContext(alert),
        `alert:${alert.id}:${now.getTime()}`,
      );
      await this.dataSource.query(`UPDATE lw_alerts SET notified_at = $2 WHERE id = $1`, [alert.id, now]);
    } catch (error) {
      this.logger.warn(`Alert ${alert.id} not delivered: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Resolves; only alerts that were sent announce their resolution (to the same recipients). */
  private async resolve(alert: AlertRow, now: Date): Promise<void> {
    await this.dataSource.query(`UPDATE lw_alerts SET state = 'resolved', resolved_at = $2 WHERE id = $1`, [
      alert.id,
      now,
    ]);

    if (alert.state !== 'firing' || !alert.notified_at) return;

    const notify = await this.recipients(alert.rule);

    try {
      if (notify.webhooks)
        await this.notifications.publish('alert.resolved', { ...this.payload(alert), resolvedAt: now.toISOString() });

      await this.notifications.email(
        'alert.resolved',
        'alert-resolved',
        notify.emails,
        { ...this.emailContext(alert), resolvedAt: now.toISOString() },
        `alert:${alert.id}:resolved`,
      );
    } catch (error) {
      this.logger.warn(`Resolution of ${alert.id} not delivered: ${String(error)}`);
    }
  }

  private async recipients(rule: string): Promise<{ emails: string[]; webhooks: boolean }> {
    if (rule.startsWith('rule:')) {
      const [project, name] = rule.slice('rule:'.length).split('/');
      const resource = await this.resources.get('AlertRule', name, project === '_' ? null : project).catch(() => null);

      return resource ? resource.spec.notify : { emails: [], webhooks: true };
    }

    return { webhooks: true, emails: await this.builtinEmails() };
  }

  private async builtinEmails(): Promise<string[]> {
    const spec = await this.resources.clusterSpec().catch(() => null);

    return spec?.observability?.alertEmails ?? [];
  }

  // Built-in alerts (3.18). `notify` / `repeatMs` are filled in by the caller.

  private async nodeDown(now: Date): Promise<AlertFinding[]> {
    const nodes = await this.dataSource.getRepository(NodeEntity).find({ where: { lifecycle: Not('left') } });

    return nodes
      .filter((n) => !n.connected || !n.lastSeenAt || now.getTime() - n.lastSeenAt.getTime() > NODE_STALE_MS)
      .map((n) => ({
        rule: 'builtin:node-down',
        key: n.name,
        node: n.name,
        severity: 'critical' as const,
        title: `Node ${n.name} is down`,
        message: `Node ${n.name} (site ${n.site}) has not reported since ${n.lastSeenAt?.toISOString() ?? 'it joined'}.`,
        forMs: 60_000,
        repeatMs: 0,
        notify: { emails: [], webhooks: true },
      }));
  }

  /** Replicas that died or failed (jobs that exited cleanly and cron runs are fine) on nodes that are up. */
  private async replicaLost(): Promise<AlertFinding[]> {
    const placements = await this.dataSource.getRepository(WorkloadPlacementEntity).find();
    const up = new Set(
      (
        await this.dataSource.getRepository(NodeEntity).find({ where: { connected: true }, select: { name: true } })
      ).map((n) => n.name),
    );
    const findings: AlertFinding[] = [];

    for (const p of placements) {
      const status = p.status?.[p.node];

      // Replicas on nodes that are down are covered by the node-down alert.
      if (p.cronRun || p.migration || !status || !up.has(p.node)) continue;

      const lost = status.state === 'dead' || (status.state === 'exited' && (status.exitCode ?? 0) !== 0);

      if (lost)
        findings.push({
          rule: 'builtin:replica-lost',
          key: p.id,
          project: p.project,
          node: p.node,
          severity: 'warning',
          title: `Replica ${p.id} is ${status.state}`,
          message: `Replica ${p.id} on ${p.node} is ${status.state}${status.exitCode !== undefined ? ` (exit code ${status.exitCode})` : ''}${status.message ? `: ${status.message}` : ''}.`,
          forMs: 120_000,
          repeatMs: 0,
          notify: { emails: [], webhooks: true },
        });
    }

    return findings.slice(0, 1_000);
  }

  /** A DNS failover switched in the last 15 minutes (3.27): an event, so it fires once and resolves by itself. */
  private async failovers(now: Date): Promise<AlertFinding[]> {
    const switched = await this.dataSource
      .getRepository(DnsFailoverStateEntity)
      .find({ where: { switchedAt: MoreThan(new Date(now.getTime() - 15 * 60_000)) } });

    return switched.map((s) => ({
      rule: 'builtin:failover',
      key: s.name,
      severity: 'info' as const,
      title: `Failover ${s.name} switched`,
      message: `DNS failover ${s.name} switched at ${s.switchedAt?.toISOString()}.`,
      forMs: 0,
      repeatMs: 0,
      notify: { emails: [], webhooks: true },
    }));
  }

  /** Memory or disk at 90 %, CPU at 95 % of a node's capacity for 5 minutes. */
  private async capacity(): Promise<AlertFinding[]> {
    const nodes = await this.dataSource.getRepository(NodeEntity).find({ where: { lifecycle: Not('left') } });
    const findings: AlertFinding[] = [];

    for (const n of nodes) {
      if (!n.capacity || !n.usage) continue;

      for (const [resource, used, total, limit] of [
        ['cpu', n.usage.cpuMillis, n.capacity.cpuMillis, 0.95],
        ['memory', n.usage.memoryBytes, n.capacity.memoryBytes, 0.9],
        ['disk', n.usage.diskBytes, n.capacity.diskBytes, 0.9],
      ] as const) {
        const share = total > 0 ? used / total : 0;

        if (share >= limit)
          findings.push({
            rule: 'builtin:capacity',
            key: `${n.name}/${resource}`,
            node: n.name,
            severity: share >= 0.98 ? 'critical' : 'warning',
            title: `Node ${n.name} ${resource} at ${Math.round(share * 100)} %`,
            message: `Node ${n.name} uses ${Math.round(share * 100)} % of its ${resource}.`,
            value: share,
            forMs: 300_000,
            repeatMs: 0,
            notify: { emails: [], webhooks: true },
          });
      }
    }

    return findings;
  }

  /** TLS certificates within 14 days of expiry (renewal normally happens at 30), node certificates within 7. */
  private async certificates(now: Date): Promise<AlertFinding[]> {
    const day = 86_400_000;
    const certificates = await this.dataSource
      .getRepository(CertificateEntity)
      .find({ where: { notAfter: LessThan(new Date(now.getTime() + 14 * day)) } });
    const nodes = await this.dataSource.getRepository(NodeEntity).find({
      where: { lifecycle: Not('left'), certificateNotAfter: LessThan(new Date(now.getTime() + 7 * day)) },
    });
    const finding = (
      key: string,
      names: string,
      notAfter: Date,
      error: string | null,
      node?: string,
    ): AlertFinding => ({
      rule: 'builtin:certificate-expiring',
      key,
      ...(node ? { node } : {}),
      severity: notAfter.getTime() - now.getTime() < 3 * day ? 'critical' : 'warning',
      title: `Certificate for ${names} expires ${notAfter.toISOString().slice(0, 10)}`,
      message: `The certificate for ${names} expires at ${notAfter.toISOString()}${error ? `; last renewal error: ${error}` : ''}.`,
      value: Math.floor((notAfter.getTime() - now.getTime()) / day),
      forMs: 0,
      repeatMs: 0,
      notify: { emails: [], webhooks: true },
    });

    return [
      ...certificates
        .filter((c) => c.notAfter)
        .map((c) => finding(c.id, c.names.slice(0, 3).join(', '), c.notAfter as Date, c.lastError)),
      ...nodes.map((n) => finding(`node/${n.name}`, `node ${n.name}`, n.certificateNotAfter as Date, null, n.name)),
    ];
  }

  /** A DNS provider (or secondary) out of sync with the zone for 10 minutes (3.15). */
  private async dnsDrift(): Promise<AlertFinding[]> {
    const rows = await this.dataSource.getRepository(DnsZoneStatusEntity).find();

    return rows
      .filter((r) => r.drift || r.error)
      .map((r) => ({
        rule: 'builtin:dns-drift',
        key: `${r.zone}/${r.provider}`,
        severity: 'warning' as const,
        title: `DNS zone ${r.zone} drifted at ${r.provider}`,
        message: `Zone ${r.zone} at ${r.provider}: ${r.drift ?? r.error}.`,
        forMs: 600_000,
        repeatMs: 0,
        notify: { emails: [], webhooks: true },
      }));
  }

  /** A failed rollback (3.19): the real state is inconsistent until a fix-forward applies. */
  private async rollbackFailed(): Promise<AlertFinding[]> {
    const plans = await this.dataSource.getRepository(PlanEntity).find({ where: { status: 'rollback-failed' } });

    return plans.map((p) => {
      const projects = [...new Set(p.changes.flatMap((c) => (c.project ? [c.project] : [])))];

      return {
        rule: 'builtin:rollback-failed',
        key: p.id,
        ...(projects.length === 1 ? { project: projects[0] } : {}),
        severity: 'critical' as const,
        title: `Rollback of plan ${p.id} failed`,
        message: `Plan ${p.id} failed and its rollback failed too${p.error ? `: ${p.error}` : ''}. Its resources are inconsistent until a fix-forward plan applies.`,
        forMs: 0,
        repeatMs: 0,
        notify: { emails: [], webhooks: true },
      };
    });
  }

  /** The audit chain recomputed hourly (3.18). */
  private async auditChain(now: Date): Promise<AlertFinding[]> {
    if (!this.audit.result || now.getTime() - this.audit.at >= AUDIT_VERIFY_MS) {
      const [chain, anchors] = await Promise.all([this.auditLog.verify(), this.auditMirror.verifyAnchors()]);

      this.audit = {
        at: now.getTime(),
        result: anchors.mismatched.length
          ? { ...chain, ok: false, brokenAt: chain.brokenAt ?? `anchor ${anchors.mismatched.at(-1)}` }
          : chain,
      };
    }

    const result = this.audit.result;

    return result && !result.ok
      ? [
          {
            rule: 'builtin:audit-chain-broken',
            key: 'chain',
            severity: 'critical',
            title: 'Audit chain broken',
            message: `The audit log's hash chain does not verify from entry ${result.brokenAt ?? '?'} (checked ${result.checked}).`,
            forMs: 0,
            repeatMs: 0,
            notify: { emails: [], webhooks: true },
          },
        ]
      : [];
  }

  private async denies(): Promise<AlertFinding[]> {
    const [row]: { recent: string | null; baseline: string | null }[] = await this.dataSource.query(
      `SELECT
         (SELECT sum(packets) FROM lw_flows WHERE decision = 'denied' AND "time" >= now() - INTERVAL '5 minutes') AS recent,
         (SELECT sum(packets) / 288.0 FROM lw_flows WHERE decision = 'denied' AND "time" >= now() - INTERVAL '1 day' AND "time" < now() - INTERVAL '5 minutes') AS baseline`,
    );
    const recent = Number(row?.recent ?? 0);
    const baseline = Number(row?.baseline ?? 0);

    return deniesSpiking(recent, baseline)
      ? [
          {
            rule: 'builtin:denies-spiking',
            key: 'cluster',
            severity: 'warning',
            title: 'Policy denies spiking',
            message: `${recent} denied packets in the last 5 minutes (usually about ${Math.round(baseline)}).`,
            value: recent,
            forMs: 0,
            repeatMs: 0,
            notify: { emails: [], webhooks: true },
          },
        ]
      : [];
  }

  /** The health tree's verdict on the cluster (3.25): at risk or failed for 2 minutes. */
  private async clusterAtRisk(): Promise<AlertFinding[]> {
    const [row]: { state: string; reasons: { code: string; message: string }[] }[] = await this.dataSource.query(
      `SELECT state, reasons FROM lw_health WHERE key = 'cluster'`,
    );

    if (!row || (row.state !== 'at-risk' && row.state !== 'failed')) return [];

    return [
      {
        rule: 'builtin:cluster-at-risk',
        key: 'cluster',
        severity: row.state === 'failed' ? 'critical' : 'warning',
        title: `Cluster ${row.state === 'failed' ? 'failed' : 'at risk'}: ${row.reasons[0]?.message ?? ''}`.trim(),
        message: row.reasons.map((r) => r.message).join('; ') || row.state,
        forMs: 120_000,
        repeatMs: 0,
        notify: { emails: [], webhooks: true },
      },
    ];
  }

  /** An SLO burning its error budget fast (2 % of a month's budget per hour) or with the budget used up (3.25). */
  private async sloBurn(): Promise<AlertFinding[]> {
    return (await this.slos.all())
      .filter((s) => s.state === 'burning' || s.state === 'exhausted')
      .map((s) => ({
        rule: 'builtin:slo-burn',
        key: `${s.project}/${s.deployment}/${s.service}`,
        project: s.project,
        severity: s.state === 'burning' ? ('critical' as const) : ('warning' as const),
        title:
          s.state === 'burning'
            ? `SLO of ${s.project}/${s.deployment}/${s.service} burning its error budget fast`
            : `Error budget of ${s.project}/${s.deployment}/${s.service} used up`,
        message: [s.availability, s.latency]
          .filter((o): o is NonNullable<typeof o> => !!o)
          .map(
            (o) =>
              `target ${o.target} %, SLI ${o.sli?.toFixed(3) ?? '–'} %, budget used ${Math.round(o.consumed * 100)} %, burn rate ${o.burnRate1h?.toFixed(1) ?? '–'}`,
          )
          .join('; '),
        forMs: s.state === 'burning' ? 300_000 : 0,
        repeatMs: 0,
        notify: { emails: [], webhooks: true },
      }));
  }

  /**
   * An autoscaled service that wants more replicas than it may run (3.23): at `max`, or limited by the project quota,
   * the cluster capacity or the N+1 reserve, for 5 minutes.
   */
  private async autoscaleBlocked(): Promise<AlertFinding[]> {
    const rows: { service_key: string; project: string; status: { blocked: string | null; reason: string } }[] =
      await this.dataSource.query(
        `SELECT service_key, project, status FROM lw_autoscale_state WHERE status ->> 'blocked' IS NOT NULL`,
      );

    return rows.map((r) => ({
      rule: 'builtin:autoscale-blocked',
      key: r.service_key,
      project: r.project,
      severity: 'warning' as const,
      title: `Autoscaling of ${r.service_key} blocked: ${r.status.blocked}`,
      message: `${r.service_key} wants more replicas than it may run (${r.status.blocked}); last evaluation: ${r.status.reason}`,
      forMs: 300_000,
      repeatMs: 0,
      notify: { emails: [], webhooks: true },
    }));
  }

  /** A remote access device moved into a restricted group by its posture (3.31), with the reasons. */
  private async devicesRestricted(): Promise<AlertFinding[]> {
    return (await this.posture.restrictedDevices()).map((d) => ({
      rule: 'builtin:device-restricted',
      key: `vpn/${d.id}`,
      severity: 'info' as const,
      title: `Device ${d.label} restricted by posture`,
      message: `${d.label} fails posture checks and is in its restricted group: ${d.reasons.slice(0, 5).join('; ')}`,
      forMs: 0,
      repeatMs: 0,
      notify: { emails: [], webhooks: true },
    }));
  }

  /** A posture integration (MDM / EDR) failing three syncs in a row: its results go stale, devices fail closed. */
  private async postureIntegrationsFailing(): Promise<AlertFinding[]> {
    return (await this.posture.failingIntegrations()).map((i) => ({
      rule: 'builtin:posture-integration-failing',
      key: `posture/${i.name}`,
      severity: 'warning' as const,
      title: `Posture integration ${i.name} failing`,
      message: `The posture integration ${i.name} failed ${i.failures} syncs in a row${i.lastError ? ` (${i.lastError})` : ''}; its results count as unknown after ${i.maxAgeMinutes} minutes.`,
      value: i.failures,
      forMs: 0,
      repeatMs: 0,
      notify: { emails: [], webhooks: true },
    }));
  }

  /** A project using 90 % or more of a quota (3.17). */
  private async quotas(): Promise<AlertFinding[]> {
    const resources = await this.dataSource
      .getRepository(ResourceEntity)
      .find({ where: { kind: In(['Project', 'Deployment', 'Policy']) } });

    if (!resources.some((r) => r.kind === 'Project' && (r.spec as { quota?: unknown }).quota)) return [];

    const usage = projectUsage(
      // Autoscaled services count with what they run now (3.23).
      (await this.planner.parseAutoscaled(this.dataSource.manager, resources)).parsed,
      resources,
      await backupBytesByProject(this.dataSource),
      'current',
    );

    return quotaShares(usage, resources)
      .filter((q) => q.share >= 0.9)
      .map((q) => ({
        rule: 'builtin:quota-near-limit',
        key: `${q.project}/${q.resource}`,
        project: q.project,
        severity: q.share >= 1 ? ('critical' as const) : ('warning' as const),
        title: `Project ${q.project} uses ${Math.round(q.share * 100)} % of its ${q.resource} quota`,
        message: `Project ${q.project} uses ${Math.round(q.share * 100)} % of its ${q.resource} quota; new plans that need more are rejected.`,
        value: q.share,
        forMs: 0,
        repeatMs: 0,
        notify: { emails: [], webhooks: true },
      }));
  }

  // Custom rules (3.18): a project rule sees its project's data only.

  private async custom(resource: Resource<'AlertRule'>): Promise<AlertFinding[]> {
    const spec: AlertRuleSpec = resource.spec;
    const project = resource.metadata.project ?? null;
    const rule = customRuleName(resource);
    const base = {
      rule,
      ...(project ? { project } : {}),
      severity: spec.severity,
      forMs: durationMs(spec.for),
      repeatMs: Math.max(durationMs(spec.repeatEvery), 60_000),
      notify: spec.notify,
      ...(spec.escalate
        ? { escalate: { afterMs: durationMs(spec.escalate.after), emails: spec.escalate.emails } }
        : {}),
    };
    const label = spec.description ?? resource.metadata.name;
    const condition = spec.condition;

    if ('metric' in condition) {
      const m = condition.metric;
      const window = Math.min(durationMs(m.over), MAX_WINDOW_MS);
      const params: unknown[] = [m.name, window];
      const where = [`metric = $1`, `"time" >= now() - $2 * INTERVAL '1 millisecond'`];

      if (m.entity) {
        params.push(m.entity.endsWith('*') ? `${m.entity.slice(0, -1).replace(/[%_\\]/g, '\\$&')}%` : m.entity);
        where.push(m.entity.endsWith('*') ? `entity LIKE $${params.length}` : `entity = $${params.length}`);
      }

      if (m.node) {
        params.push(m.node);
        where.push(`node = $${params.length}`);
      }

      if (project) {
        params.push(project);
        where.push(`project = $${params.length}`);
      }

      const key = m.groupBy === 'none' ? `''` : m.groupBy;
      const values = new Map<string, number>();

      if (m.mode === 'change') {
        const rows: { key: string; v: number }[] = await this.dataSource.query(
          `SELECT ${key} AS key, date_bin('1 minute', "time", TIMESTAMPTZ '2000-01-01') AS t, avg(value) AS v
           FROM lw_metrics WHERE ${where.join(' AND ')} GROUP BY 1, 2 ORDER BY 1, 2 LIMIT 100000`,
          params,
        );
        const series = new Map<string, number[]>();

        for (const r of rows) series.set(r.key, [...(series.get(r.key) ?? []), Number(r.v)]);

        for (const [k, points] of series) {
          const change = seriesChange(points);

          if (change !== null) values.set(k, change);
        }
      } else {
        // The threshold is applied before the limit, so breaching series are never cut off.
        params.push(m.threshold);

        const rows: { key: string; v: number }[] = await this.dataSource.query(
          `SELECT ${key} AS key, ${m.aggregation}(value) AS v FROM lw_metrics WHERE ${where.join(' AND ')}
           GROUP BY 1 HAVING ${m.aggregation}(value) ${m.op} $${params.length} ORDER BY 2 DESC LIMIT ${MAX_SERIES_PER_RULE}`,
          params,
        );

        for (const r of rows) values.set(r.key, Number(r.v));
      }

      return [...values]
        .filter(([, v]) => compare(m.op, v, m.threshold))
        .slice(0, MAX_SERIES_PER_RULE)
        .map(([k, v]) => ({
          ...base,
          key: k,
          ...(m.groupBy === 'node' ? { node: k } : {}),
          title: `${label}${k ? ` (${k})` : ''}`,
          message: `${m.name}${m.mode === 'change' ? ' change' : ` ${m.aggregation}`} over ${m.over} is ${v} (${m.op} ${m.threshold})${k ? ` for ${k}` : ''}.`,
          value: v,
        }));
    }

    if ('absence' in condition) {
      const a = condition.absence;
      const params: unknown[] = [a.metric, Math.min(durationMs(a.for), MAX_WINDOW_MS)];
      const where = [`metric = $1`, `"time" >= now() - $2 * INTERVAL '1 millisecond'`];

      if (a.entity) {
        params.push(a.entity);
        where.push(`entity = $${params.length}`);
      }

      if (project) {
        params.push(project);
        where.push(`project = $${params.length}`);
      }

      const rows: unknown[] = await this.dataSource.query(
        `SELECT 1 FROM lw_metrics WHERE ${where.join(' AND ')} LIMIT 1`,
        params,
      );

      return rows.length > 0
        ? []
        : [
            {
              ...base,
              key: '',
              forMs: 0,
              title: label,
              message: `No ${a.metric}${a.entity ? ` for ${a.entity}` : ''} in the last ${a.for}.`,
            },
          ];
    }

    const l = condition.logs;

    if (!this.opensearch.isEnabled()) throw new Error('log store not configured');

    const count = await this.logs.count(
      {
        from: new Date(Date.now() - Math.min(durationMs(l.over), MAX_WINDOW_MS)).toISOString(),
        ...(l.sources ? { sources: l.sources } : {}),
        ...(l.levels ? { levels: l.levels } : {}),
        ...(l.text ? { text: l.text } : {}),
        ...(l.service ? { service: l.service } : {}),
      },
      project,
    );

    return compare(l.op, count, l.threshold)
      ? [
          {
            ...base,
            key: '',
            title: label,
            message: `${count} matching log lines in the last ${l.over} (${l.op} ${l.threshold}).`,
            value: count,
          },
        ]
      : [];
  }

  // API

  async list(
    req: RequestWithUser | undefined,
    q: { state?: 'open' | 'resolved' | 'all'; project?: string; limit?: number },
  ): Promise<AlertDto[]> {
    return await this.listFor(await this.access.caller(req), q);
  }

  /** The alert list for an already resolved caller (overview, wallboard tokens). */
  async listFor(
    caller: AccessCaller,
    q: { state?: 'open' | 'resolved' | 'all'; project?: string; limit?: number },
  ): Promise<AlertDto[]> {
    if (q.project && !mayRead(caller, q.project)) throw new NotFoundException('project not found');

    const params: unknown[] = [];
    const where: string[] = [];

    if ((q.state ?? 'open') === 'open') where.push(`state <> 'resolved'`);
    else if (q.state === 'resolved') where.push(`state = 'resolved'`);

    if (q.project) {
      params.push(q.project);
      where.push(`project = $${params.length}`);
    }

    if (!caller.clusterRole) {
      params.push([...caller.projects.keys()].filter((p) => canReadProject(caller, p)));
      where.push(`project = ANY($${params.length})`);
    }

    params.push(Math.min(Math.max(q.limit ?? 200, 1), 1_000));

    const rows: AlertRow[] = await this.dataSource.query(
      `SELECT * FROM lw_alerts ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY started_at DESC LIMIT $${params.length}`,
      params,
    );

    return rows.filter((r) => mayRead(caller, r.project)).map(toDto);
  }

  /** One alert, if the caller may read it. */
  async get(req: RequestWithUser | undefined, id: string): Promise<AlertDto> {
    const caller = await this.access.caller(req);
    const [row]: AlertRow[] = await this.dataSource.query(`SELECT * FROM lw_alerts WHERE id = $1`, [id]);

    if (!row || !mayRead(caller, row.project)) throw new NotFoundException('alert not found');

    return toDto(row);
  }

  async acknowledge(req: RequestWithUser | undefined, id: string): Promise<AlertDto> {
    const caller = await this.access.caller(req);
    const actor = actorFromRequest(req);

    return await this.dataSource.transaction(async (manager) => {
      const [row]: AlertRow[] = await manager.query(`SELECT * FROM lw_alerts WHERE id = $1 FOR UPDATE`, [id]);

      if (!row || !mayRead(caller, row.project)) throw new NotFoundException('alert not found');

      if (!mayManage(caller, row.project)) throw new ForbiddenException('operator role required');

      if (row.state !== 'firing') throw new BadRequestException('only firing alerts can be acknowledged');

      if (row.acknowledged_at) return toDto(row);

      const [updated]: [AlertRow[], number] = await manager.query(
        `UPDATE lw_alerts SET acknowledged_by = $2, acknowledged_at = now() WHERE id = $1 RETURNING *`,
        [id, actor.id ?? actor.type],
      );
      const result = updated[0];

      await this.auditLog.record(manager, {
        actor,
        action: 'alert.acknowledge',
        target: `alert/${id}`,
        project: row.project,
        details: { rule: row.rule, key: row.key },
      });
      void this.notifications
        .publish('alert.acknowledged', { ...this.payload(result), acknowledgedBy: result.acknowledged_by })
        .catch(() => undefined);

      return toDto(result);
    });
  }

  async silences(req: RequestWithUser | undefined, includeExpired = false): Promise<SilenceDto[]> {
    const caller = await this.access.caller(req);
    const projects = caller.clusterRole ? null : [...caller.projects.keys()].filter((p) => canReadProject(caller, p));
    const where = [...(includeExpired ? [] : ['ends_at > now()']), ...(projects ? ['project = ANY($1)'] : [])];
    const rows: SilenceRow[] = await this.dataSource.query(
      `SELECT * FROM lw_alert_silences ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY starts_at DESC LIMIT 1000`,
      projects ? [projects] : [],
    );

    return rows.filter((r) => mayRead(caller, r.project)).map(silenceDto);
  }

  async createSilence(
    req: RequestWithUser | undefined,
    dto: { rule?: string; project?: string; key?: string; reason: string; startsAt?: string; endsAt: string },
  ): Promise<SilenceDto> {
    const caller = await this.access.caller(req);
    const project = dto.project ?? null;

    if (!dto.rule && !project && !dto.key) throw new BadRequestException('a silence needs a rule, project or key');

    if (project && !mayRead(caller, project)) throw new NotFoundException('project not found');

    if (!mayManage(caller, project)) throw new ForbiddenException('operator role required');

    const now = Date.now();
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : new Date(now);
    const endsAt = new Date(dto.endsAt);

    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt)
      throw new BadRequestException('invalid time range');

    if (endsAt.getTime() - Math.max(now, startsAt.getTime()) > MAX_SILENCE_MS)
      throw new BadRequestException('silences last at most 30 days');

    const actor = actorFromRequest(req);

    return await this.dataSource.transaction(async (manager) => {
      const [row]: SilenceRow[] = await manager.query(
        `INSERT INTO lw_alert_silences (rule, project, key, reason, created_by, starts_at, ends_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [dto.rule ?? null, project, dto.key ?? null, dto.reason, actor.id ?? actor.type, startsAt, endsAt],
      );

      await this.auditLog.record(manager, {
        actor,
        action: 'alert.silence.create',
        target: `alert-silence/${row.id}`,
        project,
        details: { rule: row.rule, key: row.key, reason: row.reason, endsAt: endsAt.toISOString() },
      });

      return silenceDto(row);
    });
  }

  /** Ends a silence now (kept as history). */
  async endSilence(req: RequestWithUser | undefined, id: string): Promise<void> {
    const caller = await this.access.caller(req);
    const actor = actorFromRequest(req);

    await this.dataSource.transaction(async (manager) => {
      const [row]: SilenceRow[] = await manager.query(`SELECT * FROM lw_alert_silences WHERE id = $1 FOR UPDATE`, [id]);

      if (!row || !mayRead(caller, row.project)) throw new NotFoundException('silence not found');

      if (!mayManage(caller, row.project)) throw new ForbiddenException('operator role required');

      await manager.query(`UPDATE lw_alert_silences SET ends_at = LEAST(ends_at, now()) WHERE id = $1`, [id]);
      await this.auditLog.record(manager, {
        actor,
        action: 'alert.silence.end',
        target: `alert-silence/${id}`,
        project: row.project,
      });
    });
  }
}
