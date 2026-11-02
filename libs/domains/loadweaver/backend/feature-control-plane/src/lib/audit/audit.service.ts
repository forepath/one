import type { RequestWithUser } from '@forepath/identity/backend';
import { OpenSearchService } from '@forepath/shared/backend/util-opensearch';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { projectRole, type AccessCaller } from '../access/access.utils';
import { ProjectAccessService } from '../access/project-access.service';
import { AuditEventEntity } from '../entities/audit-event.entity';
import { emailOf, userEmails, userIdsByEmail } from '../fleet-identity/user-emails';
import { LogsService } from '../logs/logs.service';
import { toCsv } from '../utils/csv.utils';
import { writesPaused } from '../database-handover/database-target.runtime';

const MIRROR_MS = 15_000;
const ANCHOR_MS = 3_600_000;
const ADVISORY_LOCK_AUDIT_MIRROR = 0x4c570016;
const MIRROR_BATCH = 1_000;
export const MAX_AUDIT_PAGE = 500;
export const MAX_AUDIT_EXPORT = 50_000;

export interface AuditFilter {
  from?: string;
  to?: string;
  project?: string;
  /** Exact action, or a prefix ending in `*` (`plan.*`). */
  action?: string;
  actor?: string;
  /** Target prefix (`plan/`, `project/shop`). */
  target?: string;
  /** Full text over action, target and details (the log store's mirror when available). */
  text?: string;
  limit?: number;
  /** The `seq` of the last entry of the previous page (newest first). */
  before?: string;
}

export interface AuditEntryDto {
  seq: string;
  at: string;
  actorType: string;
  actorId: string | null;
  /**
   * The acting user's email for `actorType: 'user'` (`null`: deleted user / other actor types), resolved server-side
   * like Agenstra's ticket activity `actorEmail`. Not in the log-store mirror.
   */
  actorEmail?: string | null;
  action: string;
  target: string;
  project: string | null;
  details: Record<string, unknown>;
  hash: string;
}

export interface AnchorVerification {
  /** Anchors in the log store compared with the chain. */
  checked: number;
  /** Anchored entries whose hash in the database differs: the chain was rewritten after the anchor. */
  mismatched: string[];
  available: boolean;
}

/** Auditors and cluster admins read everything; project admins their project's entries (3.18). */
export function auditScope(caller: AccessCaller): { all: boolean; projects: string[] } {
  const all = caller.clusterRole === 'cluster-admin' || caller.clusterRole === 'auditor';

  return { all, projects: [...caller.projects.keys()].filter((p) => projectRole(caller, p) === 'admin') };
}

function toDto(e: AuditEventEntity): AuditEntryDto {
  return {
    seq: String(e.seq),
    at: new Date(e.at).toISOString(),
    actorType: e.actorType,
    actorId: e.actorId,
    action: e.action,
    target: e.target,
    project: e.project,
    details: e.details,
    hash: e.hash,
  };
}

const like = (prefix: string) => `${prefix.replace(/[%_\\]/g, '\\$&')}%`;

/**
 * The audit log beyond the chain itself (3.18): scoped search and export from Postgres (authoritative), a mirror in
 * the log store for full-text search and merged views, and hourly anchoring of the chain head outside the database
 * (the log store, and the SIEM export picks the anchors up) so a rewritten chain is detected even by someone with
 * database access.
 */
@Injectable()
export class AuditService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AuditService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ProjectAccessService,
    private readonly opensearch: OpenSearchService,
    private readonly logs: LogsService,
  ) {}

  get index(): string {
    return this.opensearch.indexName('audit');
  }

  get anchorIndex(): string {
    return this.opensearch.indexName('audit-anchors');
  }

  onApplicationBootstrap(): void {
    if (!this.opensearch.isEnabled()) return;

    this.timer = setInterval(() => {
      if (!writesPaused('Audit mirror', this.logger)) void this.tick();
    }, MIRROR_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Mirror and anchor, by one replica at a time. */
  async tick(now = new Date()): Promise<boolean> {
    if (this.running || !this.opensearch.isEnabled()) return false;

    this.running = true;

    const runner = this.dataSource.createQueryRunner();

    try {
      await runner.connect();

      const [{ locked }] = await runner.query('SELECT pg_try_advisory_lock($1) AS locked', [
        ADVISORY_LOCK_AUDIT_MIRROR,
      ]);

      if (!locked) return false;

      try {
        await this.mirror();
        await this.anchor(now);
      } finally {
        await runner.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_AUDIT_MIRROR]);
      }

      return true;
    } catch (error) {
      this.logger.warn(`Audit mirror: ${error instanceof Error ? error.message : String(error)}`);

      return false;
    } finally {
      await runner.release();
      this.running = false;
    }
  }

  private async mirror(): Promise<void> {
    await this.opensearch.ensureIndex(this.index, {
      properties: {
        seq: { type: 'long' },
        at: { type: 'date' },
        actorType: { type: 'keyword' },
        actorId: { type: 'keyword' },
        action: { type: 'keyword' },
        target: { type: 'keyword' },
        project: { type: 'keyword' },
        hash: { type: 'keyword' },
        text: { type: 'text' },
        details: { type: 'object', enabled: false },
      },
    });

    for (;;) {
      const [{ mirrored_seq }] = await this.dataSource.query(`SELECT mirrored_seq FROM lw_audit_mirror WHERE id = 1`);
      const batch = await this.dataSource
        .getRepository(AuditEventEntity)
        .createQueryBuilder('a')
        .where('a.seq > :seq', { seq: String(mirrored_seq) })
        .orderBy('a.seq', 'ASC')
        .limit(MIRROR_BATCH)
        .getMany();

      if (batch.length === 0) return;

      await this.opensearch.bulkUpsert(
        this.index,
        batch.map((e) => ({
          id: String(e.seq),
          document: {
            ...toDto(e),
            seq: Number(e.seq),
            text: `${e.action} ${e.target} ${JSON.stringify(e.details)}`.slice(0, 32_000),
          },
        })),
      );
      await this.dataSource.query(`UPDATE lw_audit_mirror SET mirrored_seq = $1 WHERE id = 1`, [batch.at(-1)?.seq]);

      if (batch.length < MIRROR_BATCH) return;
    }
  }

  /** The chain head, hourly (and only when it moved): into the anchor index and as a control-plane log line. */
  private async anchor(now: Date): Promise<void> {
    const [state] = await this.dataSource.query(`SELECT anchored_seq, anchored_at FROM lw_audit_mirror WHERE id = 1`);

    if (state.anchored_at && now.getTime() - new Date(state.anchored_at).getTime() < ANCHOR_MS) return;

    const head = await this.dataSource
      .getRepository(AuditEventEntity)
      .createQueryBuilder('a')
      .orderBy('a.seq', 'DESC')
      .limit(1)
      .getOne();

    if (!head || String(head.seq) === String(state.anchored_seq)) return;

    await this.opensearch.indexDocument(this.anchorIndex, String(head.seq), {
      seq: Number(head.seq),
      hash: head.hash,
      at: now.toISOString(),
    });
    await this.logs.write([
      {
        source: 'control-plane',
        level: 'info',
        message: `audit chain head ${head.seq} ${head.hash}`,
        labels: {},
        fields: { auditAnchor: true, seq: Number(head.seq), hash: head.hash },
      },
    ]);
    await this.dataSource.query(`UPDATE lw_audit_mirror SET anchored_seq = $1, anchored_at = $2 WHERE id = 1`, [
      head.seq,
      now,
    ]);
  }

  /** The anchors in the log store against the chain (part of the verify action). */
  async verifyAnchors(): Promise<AnchorVerification> {
    if (!this.opensearch.isEnabled()) return { checked: 0, mismatched: [], available: false };

    const result = await this.opensearch.searchRaw(this.anchorIndex, {
      size: 1_000,
      sort: [{ seq: 'desc' }],
      query: { match_all: {} },
    });
    const anchors = result.hits.map((h) => ({ seq: String(h.source['seq']), hash: String(h.source['hash']) }));

    if (anchors.length === 0) return { checked: 0, mismatched: [], available: true };

    const rows: { seq: string; hash: string }[] = await this.dataSource.query(
      `SELECT seq::text AS seq, hash FROM lw_audit_events WHERE seq = ANY($1::bigint[])`,
      [anchors.map((a) => a.seq)],
    );
    const stored = new Map(rows.map((r) => [r.seq, r.hash]));

    return {
      checked: anchors.length,
      // A missing entry is as bad as a different one: the chain was truncated or rewritten.
      mismatched: anchors.filter((a) => stored.get(a.seq) !== a.hash).map((a) => a.seq),
      available: true,
    };
  }

  async list(
    req: RequestWithUser | undefined,
    filter: AuditFilter,
    max = MAX_AUDIT_PAGE,
  ): Promise<{ entries: AuditEntryDto[]; before: string | null }> {
    const scope = auditScope(await this.access.caller(req));

    if (filter.project && !scope.all && !scope.projects.includes(filter.project))
      throw new NotFoundException('project not found');

    if (!scope.all && scope.projects.length === 0) throw new NotFoundException('no audit entries visible');

    const limit = Math.min(Math.max(filter.limit ?? 100, 1), max);
    const query = this.dataSource.getRepository(AuditEventEntity).createQueryBuilder('a');
    const to = filter.to ? new Date(filter.to) : null;
    const from = filter.from ? new Date(filter.from) : null;

    if ((to && Number.isNaN(to.getTime())) || (from && Number.isNaN(from.getTime())))
      throw new BadRequestException('invalid time range');

    if (from) query.andWhere('a.at >= :from', { from });

    if (to) query.andWhere('a.at < :to', { to });

    if (filter.project) query.andWhere('a.project = :project', { project: filter.project });

    if (!scope.all) query.andWhere('a.project IN (:...projects)', { projects: scope.projects });

    if (filter.action)
      query.andWhere(filter.action.endsWith('*') ? 'a.action LIKE :action' : 'a.action = :action', {
        action: filter.action.endsWith('*') ? like(filter.action.slice(0, -1)) : filter.action,
      });

    // The console shows users by email: an email narrows to the ids behind it (none → no entries).
    const actors = filter.actor
      ? filter.actor.includes('@')
        ? await userIdsByEmail(this.dataSource, filter.actor)
        : [filter.actor]
      : null;

    if (actors) query.andWhere('a.actorId IN (:...actors)', { actors: actors.length ? actors : [''] });

    if (filter.target) query.andWhere('a.target LIKE :target', { target: like(filter.target) });

    if (filter.before) {
      if (!/^\d{1,19}$/.test(filter.before)) throw new BadRequestException('invalid cursor');

      query.andWhere('a.seq < :before', { before: filter.before });
    }

    if (filter.text) {
      const seqs = await this.textMatches(filter, scope, limit, actors);

      if (seqs) query.andWhere('a.seq IN (:...seqs)', { seqs: seqs.length ? seqs : ['0'] });
      else
        // Not `:text`: TypeORM would also bind the `::text` cast of `details` (→ `details:$1`, a syntax error, 500).
        query.andWhere(`(a.action ILIKE :needle OR a.target ILIKE :needle OR a.details::text ILIKE :needle)`, {
          needle: `%${filter.text.replace(/[%_\\]/g, '\\$&')}%`,
        });
    }

    const rows = await query.orderBy('a.seq', 'DESC').limit(limit).getMany();
    // One batched lookup per page, only for the entries the caller's scope returned.
    const emails = await userEmails(
      this.dataSource,
      rows.filter((e) => e.actorType === 'user').map((e) => e.actorId),
    );

    return {
      entries: rows.map((e) => ({
        ...toDto(e),
        actorEmail: e.actorType === 'user' ? emailOf(emails, e.actorId) : null,
      })),
      before: rows.length === limit ? String(rows.at(-1)?.seq) : null,
    };
  }

  /**
   * Full text through the mirror: the whole page (every filter, newest first, before the cursor) is selected in
   * the log store, then read from Postgres. Null without a log store (ILIKE fallback).
   */
  private async textMatches(
    filter: AuditFilter,
    scope: { all: boolean; projects: string[] },
    limit: number,
    actors: string[] | null = filter.actor ? [filter.actor] : null,
  ): Promise<string[] | null> {
    if (!this.opensearch.isEnabled() || !filter.text) return null;

    const filters: Record<string, unknown>[] = [];
    const range: Record<string, string> = {};

    if (filter.from) range['gte'] = new Date(filter.from).toISOString();

    if (filter.to) range['lt'] = new Date(filter.to).toISOString();

    if (Object.keys(range).length) filters.push({ range: { at: range } });

    if (filter.before) filters.push({ range: { seq: { lt: Number(filter.before) } } });

    if (filter.project) filters.push({ term: { project: filter.project } });

    if (!scope.all) filters.push({ terms: { project: scope.projects } });

    if (filter.action)
      filters.push(
        filter.action.endsWith('*')
          ? { prefix: { action: filter.action.slice(0, -1) } }
          : { term: { action: filter.action } },
      );

    if (actors) filters.push({ terms: { actorId: actors.length ? actors : [''] } });

    if (filter.target) filters.push({ prefix: { target: filter.target } });

    const result = await this.opensearch.searchRaw(this.index, {
      size: limit,
      _source: ['seq'],
      sort: [{ seq: 'desc' }],
      track_total_hits: false,
      query: {
        bool: {
          must: [{ simple_query_string: { query: filter.text.slice(0, 256), fields: ['text'] } }],
          filter: filters,
        },
      },
    });

    return result.hits.map((h) => String(h.source['seq']));
  }

  async export(req: RequestWithUser | undefined, filter: AuditFilter, format: 'csv' | 'ndjson'): Promise<string> {
    const entries: AuditEntryDto[] = [];
    let before = filter.before;

    do {
      const page = await this.list(req, { ...filter, before, limit: MAX_AUDIT_PAGE });

      entries.push(...page.entries);
      before = page.before ?? undefined;
    } while (before && entries.length < MAX_AUDIT_EXPORT);

    const rows = entries.slice(0, MAX_AUDIT_EXPORT);

    if (format === 'ndjson') return rows.map((e) => JSON.stringify(e)).join('\n') + (rows.length ? '\n' : '');

    return toCsv(
      ['seq', 'at', 'actorType', 'actorId', 'actorEmail', 'action', 'target', 'project', 'details', 'hash'],
      rows.map((e) => [
        e.seq,
        e.at,
        e.actorType,
        e.actorId,
        // Resolved per page by `list` (same batched lookup and scope as NDJSON / the console).
        e.actorEmail ?? null,
        e.action,
        e.target,
        e.project,
        JSON.stringify(e.details),
        e.hash,
      ]),
    );
  }
}
