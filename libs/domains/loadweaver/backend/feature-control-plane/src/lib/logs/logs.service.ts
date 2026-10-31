import { randomUUID } from 'node:crypto';

import type { RequestWithUser } from '@forepath/identity/backend';
import type { LogBatch, LogEntry } from '@forepath/loadweaver/shared/util-agent-protocol';
import {
  clusterSpecSchema,
  DEFAULT_LOG_RETENTION_DAYS,
  LOG_SOURCES,
  type LogSource,
} from '@forepath/loadweaver/shared/util-model';
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

import { canReadProjectSensitive, type AccessCaller } from '../access/access.utils';
import { ProjectAccessService } from '../access/project-access.service';
import { toCsv } from '../utils/csv.utils';
import { ClusterEntity } from '../entities/cluster.entity';
import { NodeEntity } from '../entities/node.entity';
import { ResourceEntity } from '../entities/resource.entity';
import { WorkloadPlacementEntity } from '../entities/workload-placement.entity';

const TEMPLATE_RETRY_MS = 30_000;
const RETENTION_MS = 3_600_000;
const PLACEMENT_CACHE_MS = 10_000;
export const MAX_QUERY_LINES = 1_000;
/** How long stored lines wait before forwarding (see `since`). */
export const SINCE_LAG_MS = 30_000;
export const MAX_EXPORT_LINES = 50_000;

export interface LogFilter {
  /** ISO times; default: the last hour. */
  from?: string;
  to?: string;
  sources?: LogSource[];
  levels?: LogEntry['level'][];
  project?: string;
  deployment?: string;
  service?: string;
  replica?: string;
  node?: string;
  policy?: string;
  /** Full text over the message. */
  text?: string;
  limit?: number;
  /** Opaque cursor from the previous page. */
  cursor?: string;
  /** `desc` (newest first) for browsing, `asc` for tails and exports. */
  order?: 'asc' | 'desc';
  /** Live tails follow the order lines were stored in, so late lines (buffered nodes) aren't skipped. */
  tail?: boolean;
}

export interface LogLine {
  id: string;
  at: string;
  source: LogSource;
  level: LogEntry['level'];
  message: string;
  node: string;
  site: string | null;
  labels: LogEntry['labels'];
  fields: Record<string, string | number | boolean>;
}

/** `loadweaver-logs-<source>-<yyyy>-<mm>-<dd>`: one index per source and day, so retention drops whole indices. */
export function logIndex(prefix: string, source: LogSource, at: Date): string {
  return `${prefix}-${source}-${at.toISOString().slice(0, 10)}`;
}

/** Indices past their source's retention (by the day in the name). */
export function expiredIndices(
  indices: readonly string[],
  prefix: string,
  retention: Record<LogSource, number>,
  now: Date,
): string[] {
  return indices.filter((index) => {
    for (const source of LOG_SOURCES) {
      const match = new RegExp(`^${prefix}-${source}-(\\d{4}-\\d{2}-\\d{2})$`).exec(index);

      if (match) return now.getTime() - Date.parse(`${match[1]}T00:00:00Z`) > (retention[source] + 1) * 86_400_000;
    }

    return false;
  });
}

/** What a caller may read (3.14 / 3.17): projects by membership, platform logs by cluster role. */
export function logScope(caller: AccessCaller): { all: boolean; platform: boolean; projects: string[] } {
  const all = caller.clusterRole === 'cluster-admin' || caller.clusterRole === 'auditor';

  return {
    all,
    platform: all || caller.clusterRole === 'infra-operator',
    projects: [...caller.projects.keys()].filter((p) => canReadProjectSensitive(caller, p)),
  };
}

/** The OpenSearch query for a filter within a scope. */
export function logQuery(filter: LogFilter, scope: ReturnType<typeof logScope>, now: Date): Record<string, unknown> {
  const to = filter.to ? new Date(filter.to) : now;
  const from = filter.from ? new Date(filter.from) : new Date(to.getTime() - 3_600_000);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new BadRequestException('invalid time range');

  const term = (field: string, value: string | undefined) => (value ? [{ term: { [field]: value } }] : []);
  const filters: Record<string, unknown>[] = [
    { range: { [filter.tail ? 'ingested' : 'at']: { gte: from.toISOString(), lte: to.toISOString() } } },
    ...(filter.sources?.length ? [{ terms: { source: filter.sources } }] : []),
    ...(filter.levels?.length ? [{ terms: { level: filter.levels } }] : []),
    ...term('labels.project', filter.project),
    ...term('labels.deployment', filter.deployment),
    ...term('labels.service', filter.service),
    ...term('labels.replica', filter.replica),
    ...term('labels.policy', filter.policy),
    ...term('node', filter.node),
  ];

  if (!scope.all)
    filters.push({
      bool: {
        should: [
          ...(scope.projects.length ? [{ terms: { 'labels.project': scope.projects } }] : []),
          ...(scope.platform ? [{ bool: { must_not: [{ exists: { field: 'labels.project' } }] } }] : []),
        ],
        minimum_should_match: 1,
      },
    });

  return {
    bool: {
      filter: filters,
      ...(filter.text
        ? { must: [{ simple_query_string: { query: filter.text.slice(0, 256), fields: ['message'] } }] }
        : {}),
    },
  };
}

function encodeCursor(sort: unknown[]): string {
  return Buffer.from(JSON.stringify(sort)).toString('base64url');
}

function decodeCursor(cursor: string): unknown[] {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;

    if (Array.isArray(value) && value.length === 2) return value;
  } catch {
    // fall through
  }

  throw new BadRequestException('invalid cursor');
}

/**
 * Logs (3.14): batches from the nodes are checked (a node may only label lines with workloads it runs), enriched
 * with node / site / cluster and appended to OpenSearch per source and day; queries are scoped by access (project
 * logs for project members, platform logs for cluster roles), pages by cursor; indices past their retention go.
 */
@Injectable()
export class LogsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(LogsService.name);
  private readonly timers: NodeJS.Timeout[] = [];
  private templateReady = false;
  private clusterId: string | null = null;
  private readonly placements = new Map<string, { at: number; replicas: Set<string> }>();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly opensearch: OpenSearchService,
    private readonly access: ProjectAccessService,
  ) {}

  get prefix(): string {
    return this.opensearch.indexName('logs');
  }

  onApplicationBootstrap(): void {
    if (!this.opensearch.isEnabled()) return;

    void this.ensureTemplate();
    this.timers.push(setInterval(() => void this.ensureTemplate(), TEMPLATE_RETRY_MS));
    this.timers.push(setInterval(() => void this.retention().catch(() => undefined), RETENTION_MS));
  }

  onModuleDestroy(): void {
    this.timers.forEach((t) => clearInterval(t));
  }

  /** Settings and mappings of every log index (replicas follow the members: `0-1`). */
  async ensureTemplate(): Promise<boolean> {
    if (this.templateReady) return true;

    try {
      await this.opensearch.putIndexTemplate(`${this.prefix}`, {
        index_patterns: [`${this.prefix}-*`],
        template: {
          settings: { number_of_shards: 1, auto_expand_replicas: '0-1', refresh_interval: '1s' },
          mappings: {
            dynamic: false,
            properties: {
              id: { type: 'keyword' },
              ingested: { type: 'date' },
              at: { type: 'date' },
              source: { type: 'keyword' },
              level: { type: 'keyword' },
              message: { type: 'text' },
              node: { type: 'keyword' },
              site: { type: 'keyword' },
              cluster: { type: 'keyword' },
              labels: {
                properties: Object.fromEntries(
                  ['project', 'deployment', 'service', 'replica', 'policy', 'peer', 'component', 'stream'].map((k) => [
                    k,
                    { type: 'keyword' },
                  ]),
                ),
              },
              fields: { type: 'flat_object' },
            },
          },
        },
      });
      this.templateReady = true;
    } catch (error) {
      this.logger.debug(`Log store not ready: ${error instanceof Error ? error.message : String(error)}`);
    }

    return this.templateReady;
  }

  /** Replicas a node may label lines with: what runs (or moves) there. */
  private async replicasOn(node: string): Promise<Set<string>> {
    const cached = this.placements.get(node);

    if (cached && Date.now() - cached.at < PLACEMENT_CACHE_MS) return cached.replicas;

    const rows = await this.dataSource
      .getRepository(WorkloadPlacementEntity)
      .find({ where: [{ node }, { targetNode: node }], select: { id: true } });
    const replicas = new Set(rows.map((r) => r.id));

    this.placements.set(node, { at: Date.now(), replicas });

    return replicas;
  }

  /** A node's batch: verified, enriched, stored. Lines claiming workloads the node doesn't run are dropped. */
  async ingest(nodeName: string, batch: LogBatch): Promise<{ accepted: number; rejected: number; stored: boolean }> {
    if (!this.opensearch.isEnabled()) return { accepted: 0, rejected: 0, stored: true };

    // Not stored: the node keeps the batch and sends it again.
    if (!(await this.ensureTemplate())) return { accepted: 0, rejected: 0, stored: false };

    const node = await this.dataSource
      .getRepository(NodeEntity)
      .findOne({ where: { name: nodeName }, select: { site: true, name: true } });
    const replicas = await this.replicasOn(nodeName);
    const accepted: LogEntry[] = [];
    let rejected = 0;

    for (const entry of batch.entries) {
      const { project, deployment, service, replica } = entry.labels;
      const claimsWorkload = !!(project || deployment || service || replica);
      const consistent =
        !!replica && replicas.has(replica) && replica.startsWith(`${project}/${deployment}/${service}/`);

      if (!claimsWorkload || consistent) accepted.push(entry);
      // Lifecycle events of a replica that just left the node (exit after a migration) stay, as platform lines.
      else if (entry.source === 'runtime')
        accepted.push({ ...entry, labels: { component: entry.labels.component ?? 'platform' } });
      else rejected++;
    }

    if (batch.dropped) {
      accepted.push({
        at: new Date().toISOString(),
        source: 'runtime',
        level: 'warn',
        message: `${batch.dropped} log lines were dropped on ${nodeName} (buffer full while disconnected)`,
        labels: {},
      });
    }

    if (rejected > 0)
      this.logger.warn(`Dropped ${rejected} log lines from ${nodeName} labelled with workloads it doesn't run`);

    await this.store(accepted, nodeName, node?.site ?? null);

    return { accepted: accepted.length, rejected, stored: true };
  }

  /** The control plane's own events (applies, rollbacks, failovers, 3.14). */
  async write(entries: readonly Omit<LogEntry, 'at'>[]): Promise<void> {
    if (!this.opensearch.isEnabled() || !(await this.ensureTemplate())) return;

    await this.store(
      entries.map((e) => ({ ...e, at: new Date().toISOString() })),
      'control-plane',
      null,
    ).catch((error: unknown) => this.logger.debug(`Control-plane log lines not stored: ${String(error)}`));
  }

  private async store(entries: readonly LogEntry[], node: string, site: string | null): Promise<void> {
    if (entries.length === 0) return;

    // The cluster id never changes: read it once, and only it (not the CA key next to it).
    this.clusterId ??=
      (await this.dataSource.getRepository(ClusterEntity).findOne({ where: {}, select: { clusterId: true } }))
        ?.clusterId ?? null;

    const cluster = this.clusterId ?? '';
    const byIndex = new Map<string, Record<string, unknown>[]>();

    for (const e of entries) {
      const at = new Date(e.at);
      const index = logIndex(this.prefix, e.source, Number.isNaN(at.getTime()) ? new Date() : at);
      const docs = byIndex.get(index) ?? [];

      docs.push({
        id: randomUUID(),
        ingested: new Date().toISOString(),
        at: e.at,
        source: e.source,
        level: e.level,
        message: e.message,
        labels: e.labels,
        fields: e.fields ?? {},
        node,
        site,
        cluster,
      });
      byIndex.set(index, docs);
    }

    for (const [index, docs] of byIndex) {
      const failed = await this.opensearch.bulkAppend(index, docs);

      if (failed > 0) this.logger.warn(`${failed} log lines rejected by the log store (${index})`);
    }
  }

  /** One page of log lines the caller may see. */
  async query(
    req: RequestWithUser | undefined,
    filter: LogFilter,
  ): Promise<{ lines: LogLine[]; cursor: string | null; after: string | null }> {
    const caller = await this.access.caller(req);
    const scope = logScope(caller);

    if (filter.project && !scope.all && !scope.projects.includes(filter.project))
      throw new NotFoundException('project not found');

    if (!scope.all && !scope.platform && scope.projects.length === 0) throw new NotFoundException('no logs visible');

    const limit = Math.min(Math.max(filter.limit ?? 200, 1), MAX_QUERY_LINES);
    const order = filter.order ?? 'desc';
    const result = await this.opensearch.searchRaw(`${this.prefix}-*`, {
      size: limit,
      query: logQuery(filter, scope, new Date()),
      sort: [{ [filter.tail ? 'ingested' : 'at']: order }, { id: order }],
      track_total_hits: false,
      ...(filter.cursor ? { search_after: decodeCursor(filter.cursor) } : {}),
    });
    const lines = result.hits.map((h) => h.source as unknown as LogLine);
    const last = result.hits.at(-1);

    // `cursor`: there may be more; `after`: the position after the last line (tails continue from there).
    return {
      lines,
      cursor: last && result.hits.length === limit ? encodeCursor(last.sort) : null,
      after: last ? encodeCursor(last.sort) : null,
    };
  }

  /**
   * Lines in the order they were stored, after a cursor, over every project (SIEM forwarding, 3.18). Lines stored in
   * the last 30 seconds wait for the next call: the stored-at time comes from the ingesting replica before a bulk
   * write, so lines may become searchable a little out of order (indexing, refresh, clock skew between members).
   */
  async since(
    filter: Pick<LogFilter, 'sources' | 'levels'>,
    after: string | null,
    limit: number,
    lagMs = SINCE_LAG_MS,
  ): Promise<{ lines: LogLine[]; after: string | null }> {
    const now = Date.now();
    const result = await this.opensearch.searchRaw(`${this.prefix}-*`, {
      size: limit,
      query: logQuery(
        {
          ...filter,
          tail: true,
          // A new forwarder starts with the last two minutes rather than the whole history; the cursor does the rest.
          from: new Date(after ? 0 : now - 120_000).toISOString(),
          to: new Date(now - lagMs).toISOString(),
        },
        { all: true, platform: true, projects: [] },
        new Date(now),
      ),
      sort: [{ ingested: 'asc' }, { id: 'asc' }],
      track_total_hits: false,
      ...(after ? { search_after: decodeCursor(after) } : {}),
    });
    const last = result.hits.at(-1);

    return {
      lines: result.hits.map((h) => h.source as unknown as LogLine),
      after: last ? encodeCursor(last.sort) : after,
    };
  }

  /** Lines matching a filter (custom alert rules, 3.18): a project rule counts its project's lines only. */
  async count(filter: LogFilter, project: string | null): Promise<number> {
    const scope = project
      ? { all: false, platform: false, projects: [project] }
      : { all: true, platform: true, projects: [] };
    const result = await this.opensearch.searchRaw(`${this.prefix}-*`, {
      size: 0,
      query: logQuery(filter, scope, new Date()),
      track_total_hits: true,
    });

    return result.total;
  }

  /** NDJSON or CSV of everything matching (oldest first), up to the export limit. */
  async export(req: RequestWithUser | undefined, filter: LogFilter, format: 'ndjson' | 'csv'): Promise<string> {
    const lines: LogLine[] = [];
    let cursor: string | undefined;

    do {
      const page = await this.query(req, { ...filter, order: 'asc', limit: MAX_QUERY_LINES, cursor });

      lines.push(...page.lines);
      cursor = page.cursor ?? undefined;
    } while (cursor && lines.length < MAX_EXPORT_LINES);

    const rows = lines.slice(0, MAX_EXPORT_LINES);

    if (format === 'ndjson') return rows.map((l) => JSON.stringify(l)).join('\n') + (rows.length ? '\n' : '');

    return toCsv(
      ['at', 'source', 'level', 'node', 'project', 'deployment', 'service', 'replica', 'policy', 'message'],
      rows.map((l) => [
        l.at,
        l.source,
        l.level,
        l.node,
        l.labels.project,
        l.labels.deployment,
        l.labels.service,
        l.labels.replica,
        l.labels.policy,
        l.message,
      ]),
    );
  }

  /** Drops whole indices past their source's retention (cluster spec `observability.logRetentionDays`). */
  async retention(now = new Date()): Promise<string[]> {
    if (!this.opensearch.isEnabled()) return [];

    const cluster = await this.dataSource.getRepository(ResourceEntity).findOne({ where: { kind: 'Cluster' } });
    const configured = cluster ? clusterSpecSchema.parse(cluster.spec).observability?.logRetentionDays : undefined;
    const retention = { ...DEFAULT_LOG_RETENTION_DAYS, ...(configured ?? {}) };
    const expired = expiredIndices(await this.opensearch.listIndices(`${this.prefix}-*`), this.prefix, retention, now);

    await this.opensearch.deleteIndices(expired);

    return expired;
  }
}
