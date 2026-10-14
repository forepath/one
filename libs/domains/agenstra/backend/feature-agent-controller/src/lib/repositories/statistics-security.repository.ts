import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository, type SelectQueryBuilder } from 'typeorm';

import { StatisticsChatFilterDropEntity } from '../entities/statistics-chat-filter-drop.entity';
import { StatisticsChatFilterFlagEntity } from '../entities/statistics-chat-filter-flag.entity';
import { StatisticsClientEntity } from '../entities/statistics-client.entity';
import { StatisticsEgressEventEntity } from '../entities/statistics-egress-event.entity';
import { AgenstraSearchIndexService } from '../search/agenstra-search-index.service';

const MAX_SEARCH_LENGTH = 200;
const TOP_HOSTS_LIMIT = 10;

function escapeIlikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function sanitizeSearch(search: string | undefined): string | undefined {
  if (!search || typeof search !== 'string') return undefined;

  const trimmed = search.trim();

  if (trimmed.length === 0) return undefined;

  return trimmed.length > MAX_SEARCH_LENGTH ? trimmed.slice(0, MAX_SEARCH_LENGTH) : trimmed;
}

function toInt(value: string | number | null | undefined): number {
  const parsed = typeof value === 'number' ? value : parseInt(value ?? '0', 10);

  return Number.isFinite(parsed) ? parsed : 0;
}

export type NewStatisticsEgressEvent = Omit<StatisticsEgressEventEntity, 'id' | 'statisticsAgent' | 'statisticsClient'>;

export interface EgressEventsQueryParams {
  statisticsClientIds: string[];
  agentId?: string;
  kind?: string;
  decision?: string;
  from?: string;
  to?: string;
  search?: string;
  limit: number;
  offset: number;
}

export interface EgressAggregate {
  egressAllowedCount: number;
  egressBlockedCount: number;
  egressObservedCount: number;
  egressGuardErrorCount: number;
  egressBreakdown: { kind: string; decision: string; count: number }[];
  egressTopBlockedHosts: { host: string; count: number }[];
  egressRulesBreakdown: { rule: string; count: number }[];
}

export interface SecuritySeriesPoint {
  period: string;
  filterDrops: number;
  filterFlags: number;
  egressAllowed: number;
  egressBlocked: number;
  egressObserved: number;
}

/**
 * Statistics queries for security signals: egress guard decisions plus message filter time series.
 */
@Injectable()
export class StatisticsSecurityRepository {
  private readonly logger = new Logger(StatisticsSecurityRepository.name);

  constructor(
    @InjectRepository(StatisticsEgressEventEntity)
    private readonly egressEvents: Repository<StatisticsEgressEventEntity>,
    @InjectRepository(StatisticsChatFilterDropEntity)
    private readonly filterDrops: Repository<StatisticsChatFilterDropEntity>,
    @InjectRepository(StatisticsChatFilterFlagEntity)
    private readonly filterFlags: Repository<StatisticsChatFilterFlagEntity>,
    @InjectRepository(StatisticsClientEntity)
    private readonly statisticsClients: Repository<StatisticsClientEntity>,
    @Optional() private readonly searchIndex?: AgenstraSearchIndexService,
  ) {}

  /** Insert ingested events; rows already ingested (same workspace + manager seq) are skipped. */
  async insertEgressEvents(rows: readonly NewStatisticsEgressEvent[]): Promise<StatisticsEgressEventEntity[]> {
    if (rows.length === 0) {
      return [];
    }

    const result = await this.egressEvents
      .createQueryBuilder()
      .insert()
      .into(StatisticsEgressEventEntity)
      .values(rows.map((row) => ({ ...row })))
      .orIgnore()
      .returning('*')
      .execute();
    const inserted = (result.raw ?? []) as Array<Record<string, unknown>>;

    return inserted.map((raw) =>
      this.egressEvents.create({
        id: raw['id'] as string,
        statisticsAgentId: (raw['statistics_agent_id'] as string | null) ?? undefined,
        statisticsClientId: raw['statistics_client_id'] as string,
        sourceSeq: String(raw['source_seq']),
        kind: raw['kind'] as string,
        decision: raw['decision'] as string,
        host: (raw['host'] as string | null) ?? null,
        rule: (raw['rule'] as string | null) ?? null,
        matchedEntry: (raw['matched_entry'] as string | null) ?? null,
        matchedSource: (raw['matched_source'] as string | null) ?? null,
        method: (raw['method'] as string | null) ?? null,
        httpStatus: (raw['http_status'] as number | null) ?? null,
        sampleUrl: (raw['sample_url'] as string | null) ?? null,
        count: toInt(raw['count'] as number),
        bytesIn: String(raw['bytes_in'] ?? 0),
        bytesOut: String(raw['bytes_out'] ?? 0),
        mode: (raw['mode'] as string | null) ?? null,
        policyRevision: (raw['policy_revision'] as string | null) ?? null,
        message: (raw['message'] as string | null) ?? null,
        firstSeenAt: new Date(raw['first_seen_at'] as string),
        occurredAt: new Date(raw['occurred_at'] as string),
      }),
    );
  }

  private applyScope(
    qb: SelectQueryBuilder<StatisticsEgressEventEntity>,
    params: Omit<EgressEventsQueryParams, 'limit' | 'offset' | 'search'>,
  ): SelectQueryBuilder<StatisticsEgressEventEntity> {
    qb = qb.where('ee.statistics_client_id IN (:...ids)', { ids: params.statisticsClientIds });

    if (params.agentId) {
      qb = qb.andWhere(
        'ee.statistics_agent_id IN (SELECT id FROM statistics_agents WHERE original_agent_id = :agentId AND statistics_client_id IN (:...ids))',
        { agentId: params.agentId, ids: params.statisticsClientIds },
      );
    }

    if (params.kind) qb = qb.andWhere('ee.kind = :kind', { kind: params.kind });

    if (params.decision) qb = qb.andWhere('ee.decision = :decision', { decision: params.decision });

    if (params.from) qb = qb.andWhere('ee.occurred_at >= :from', { from: params.from });

    if (params.to) qb = qb.andWhere('ee.occurred_at <= :to', { to: params.to });

    return qb;
  }

  private async trySearchIds(
    search: string,
    statisticsClientIds: string[],
    limit: number,
    offset: number,
  ): Promise<{ ids: string[]; total: number } | null> {
    if (!this.searchIndex?.isEnabled()) {
      return null;
    }

    try {
      const rows = await this.statisticsClients.find({
        where: { id: In(statisticsClientIds) },
        select: ['originalClientId'],
      });
      const clientIds = rows.map((row) => row.originalClientId);

      if (clientIds.length === 0) {
        return { ids: [], total: 0 };
      }

      return await this.searchIndex.searchIds({ entityType: 'egress-events', query: search, clientIds, limit, offset });
    } catch (error) {
      this.logger.warn(`OpenSearch egress-events lookup failed, falling back to ILIKE: ${(error as Error).message}`);

      return null;
    }
  }

  async queryEgressEvents(
    params: EgressEventsQueryParams,
  ): Promise<{ rows: StatisticsEgressEventEntity[]; total: number }> {
    if (params.statisticsClientIds.length === 0) return { rows: [], total: 0 };

    const sanitized = sanitizeSearch(params.search);

    if (sanitized) {
      const openSearchIds = await this.trySearchIds(sanitized, params.statisticsClientIds, params.limit, params.offset);

      if (openSearchIds) {
        if (openSearchIds.ids.length === 0) {
          return { rows: [], total: 0 };
        }

        const scoped = () =>
          this.applyScope(this.egressEvents.createQueryBuilder('ee'), params).andWhere('ee.id IN (:...searchIds)', {
            searchIds: openSearchIds.ids,
          });
        const total = await scoped().getCount();
        const plain = await scoped().getMany();
        const byId = new Map(plain.map((row) => [row.id, row]));
        const orderedIds = openSearchIds.ids.filter((id) => byId.has(id));

        return { rows: await this.loadWithRelations(orderedIds), total: total || openSearchIds.total };
      }
    }

    const pattern = sanitized ? `%${escapeIlikePattern(sanitized)}%` : undefined;
    const scoped = () => {
      const qb = this.applyScope(this.egressEvents.createQueryBuilder('ee'), params);

      if (pattern) {
        qb.andWhere(
          "(COALESCE(ee.host, '') ILIKE :search OR ee.kind ILIKE :search OR ee.decision ILIKE :search OR COALESCE(ee.rule, '') ILIKE :search OR COALESCE(ee.matched_entry, '') ILIKE :search OR COALESCE(ee.method, '') ILIKE :search OR COALESCE(ee.message, '') ILIKE :search)",
          { search: pattern },
        );
      }

      return qb;
    };
    const total = await scoped().getCount();
    const plain = await scoped().orderBy('ee.occurred_at', 'DESC').skip(params.offset).take(params.limit).getMany();

    return { rows: plain.length === 0 ? [] : await this.loadWithRelations(plain.map((row) => row.id)), total };
  }

  private async loadWithRelations(ids: string[]): Promise<StatisticsEgressEventEntity[]> {
    if (ids.length === 0) {
      return [];
    }

    const entities = await this.egressEvents.find({
      where: { id: In(ids) },
      relations: ['statisticsClient', 'statisticsAgent'],
    });
    const byId = new Map(entities.map((entity) => [entity.id, entity]));

    return ids.map((id) => byId.get(id)).filter((entity): entity is StatisticsEgressEventEntity => Boolean(entity));
  }

  async queryEgressAggregate(params: {
    statisticsClientIds: string[];
    agentId?: string;
    from?: string;
    to?: string;
  }): Promise<EgressAggregate> {
    const empty: EgressAggregate = {
      egressAllowedCount: 0,
      egressBlockedCount: 0,
      egressObservedCount: 0,
      egressGuardErrorCount: 0,
      egressBreakdown: [],
      egressTopBlockedHosts: [],
      egressRulesBreakdown: [],
    };

    if (params.statisticsClientIds.length === 0) {
      return empty;
    }

    const breakdownRows = await this.applyScope(this.egressEvents.createQueryBuilder('ee'), params)
      .select('ee.kind', 'kind')
      .addSelect('ee.decision', 'decision')
      .addSelect('COALESCE(SUM(ee.count), 0)', 'count')
      .groupBy('ee.kind')
      .addGroupBy('ee.decision')
      .getRawMany<{ kind: string; decision: string; count: string }>();
    const hostRows = await this.applyScope(this.egressEvents.createQueryBuilder('ee'), params)
      .select('ee.host', 'host')
      .addSelect('COALESCE(SUM(ee.count), 0)', 'count')
      .andWhere("ee.decision IN ('blocked', 'observed')")
      .andWhere('ee.host IS NOT NULL')
      .groupBy('ee.host')
      .orderBy('count', 'DESC')
      .limit(TOP_HOSTS_LIMIT)
      .getRawMany<{ host: string; count: string }>();
    const ruleRows = await this.applyScope(this.egressEvents.createQueryBuilder('ee'), params)
      .select('ee.rule', 'rule')
      .addSelect('COALESCE(SUM(ee.count), 0)', 'count')
      .andWhere("ee.decision IN ('blocked', 'observed')")
      .andWhere('ee.rule IS NOT NULL')
      .groupBy('ee.rule')
      .orderBy('count', 'DESC')
      .getRawMany<{ rule: string; count: string }>();
    const egressBreakdown = breakdownRows.map((row) => ({
      kind: row.kind,
      decision: row.decision,
      count: toInt(row.count),
    }));
    const sumDecision = (decision: string) =>
      egressBreakdown.filter((row) => row.decision === decision).reduce((sum, row) => sum + row.count, 0);

    return {
      egressAllowedCount: sumDecision('allowed'),
      egressBlockedCount: sumDecision('blocked'),
      egressObservedCount: sumDecision('observed'),
      egressGuardErrorCount: sumDecision('error'),
      egressBreakdown,
      egressTopBlockedHosts: hostRows.map((row) => ({ host: row.host, count: toInt(row.count) })),
      egressRulesBreakdown: ruleRows.map((row) => ({ rule: row.rule, count: toInt(row.count) })),
    };
  }

  /** Message filter drops / flags and egress decisions bucketed by day or hour. */
  async querySecuritySeries(params: {
    statisticsClientIds: string[];
    agentId?: string;
    from?: string;
    to?: string;
    groupBy: 'day' | 'hour';
  }): Promise<SecuritySeriesPoint[]> {
    if (params.statisticsClientIds.length === 0) {
      return [];
    }

    const unit = params.groupBy === 'day' ? 'day' : 'hour';
    const agentClause = (alias: string) =>
      `${alias}.statistics_agent_id IN (SELECT id FROM statistics_agents WHERE original_agent_id = :agentId AND statistics_client_id IN (:...ids))`;
    const scopeFilters = <T extends object>(qb: SelectQueryBuilder<T>, alias: string): SelectQueryBuilder<T> => {
      qb = qb.where(`${alias}.statistics_client_id IN (:...ids)`, { ids: params.statisticsClientIds });

      if (params.agentId)
        qb = qb.andWhere(agentClause(alias), { agentId: params.agentId, ids: params.statisticsClientIds });

      if (params.from) qb = qb.andWhere(`${alias}.occurred_at >= :from`, { from: params.from });

      if (params.to) qb = qb.andWhere(`${alias}.occurred_at <= :to`, { to: params.to });

      return qb;
    };
    const [dropRows, flagRows, egressRows] = await Promise.all([
      scopeFilters(this.filterDrops.createQueryBuilder('fd'), 'fd')
        .select(`date_trunc('${unit}', fd.occurred_at)`, 'period')
        .addSelect('COUNT(fd.id)', 'count')
        .groupBy('period')
        .getRawMany<{ period: string | Date; count: string }>(),
      scopeFilters(this.filterFlags.createQueryBuilder('ff'), 'ff')
        .select(`date_trunc('${unit}', ff.occurred_at)`, 'period')
        .addSelect('COUNT(ff.id)', 'count')
        .groupBy('period')
        .getRawMany<{ period: string | Date; count: string }>(),
      scopeFilters(this.egressEvents.createQueryBuilder('ee'), 'ee')
        .select(`date_trunc('${unit}', ee.occurred_at)`, 'period')
        .addSelect('ee.decision', 'decision')
        .addSelect('COALESCE(SUM(ee.count), 0)', 'count')
        .andWhere("ee.decision IN ('allowed', 'blocked', 'observed')")
        .groupBy('period')
        .addGroupBy('ee.decision')
        .getRawMany<{ period: string | Date; decision: string; count: string }>(),
    ]);
    const points = new Map<string, SecuritySeriesPoint>();
    const point = (raw: string | Date): SecuritySeriesPoint => {
      const period = raw instanceof Date ? raw.toISOString() : new Date(raw).toISOString();
      let existing = points.get(period);

      if (!existing) {
        existing = { period, filterDrops: 0, filterFlags: 0, egressAllowed: 0, egressBlocked: 0, egressObserved: 0 };
        points.set(period, existing);
      }

      return existing;
    };

    for (const row of dropRows) point(row.period).filterDrops += toInt(row.count);

    for (const row of flagRows) point(row.period).filterFlags += toInt(row.count);

    for (const row of egressRows) {
      const target = point(row.period);

      if (row.decision === 'allowed') target.egressAllowed += toInt(row.count);
      else if (row.decision === 'blocked') target.egressBlocked += toInt(row.count);
      else if (row.decision === 'observed') target.egressObserved += toInt(row.count);
    }

    return [...points.values()].sort((left, right) => left.period.localeCompare(right.period));
  }

  /** Totals per original client / kind / decision for OTEL gauges. */
  async countEgressEventsGroupedForMetrics(): Promise<
    Array<{ clientId: string; kind: string; decision: string; count: number }>
  > {
    const rows = await this.egressEvents
      .createQueryBuilder('ee')
      .innerJoin('ee.statisticsClient', 'sc')
      .select('sc.original_client_id', 'clientId')
      .addSelect('ee.kind', 'kind')
      .addSelect('ee.decision', 'decision')
      .addSelect('COALESCE(SUM(ee.count), 0)', 'count')
      .groupBy('sc.original_client_id')
      .addGroupBy('ee.kind')
      .addGroupBy('ee.decision')
      .getRawMany<{ clientId: string; kind: string; decision: string; count: string }>();

    return rows.map((row) => ({
      clientId: row.clientId,
      kind: row.kind,
      decision: row.decision,
      count: toInt(row.count),
    }));
  }
}
