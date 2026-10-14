import { BadRequestException, Injectable } from '@nestjs/common';

import {
  StatisticsChatIoListDto,
  StatisticsChatIoDto,
  StatisticsEgressEventDto,
  StatisticsEgressEventListDto,
  StatisticsEntityEventListDto,
  StatisticsEntityEventDto,
  StatisticsFilterDropListDto,
  StatisticsFilterDropDto,
  StatisticsFilterFlagListDto,
  StatisticsFilterFlagDto,
  StatisticsSummaryDto,
} from '../dto/statistics';
import { ChatDirection, StatisticsInteractionKind } from '../entities/statistics-chat-io.entity';
import { StatisticsEntityEventType, StatisticsEntityType } from '../entities/statistics-entity-event.entity';
import type { StatisticsEgressEventEntity } from '../entities/statistics-egress-event.entity';
import { StatisticsSecurityRepository } from '../repositories/statistics-security.repository';
import { StatisticsRepository } from '../repositories/statistics.repository';

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/;
const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function validateIsoDate(value: string | undefined, paramName: string): string | undefined {
  if (!value) return undefined;

  if (!ISO_DATE_REGEX.test(value)) {
    throw new BadRequestException(`${paramName} must be a valid ISO 8601 date string`);
  }

  return value;
}

/** Normalize date-only "to" param to end-of-day so the full day is included. */
function normalizeToEndOfDay(value: string | undefined): string | undefined {
  if (!value) return undefined;

  if (DATE_ONLY_REGEX.test(value)) {
    return `${value}T23:59:59.999Z`;
  }

  return value;
}

const ALLOWED_INTERACTION_KINDS: ReadonlySet<string> = new Set([
  StatisticsInteractionKind.CHAT,
  StatisticsInteractionKind.PROMPT_ENHANCEMENT,
  StatisticsInteractionKind.TICKET_BODY_GENERATION,
  StatisticsInteractionKind.AUTO_CONTEXT_ENRICHMENT,
  StatisticsInteractionKind.AUTONOMOUS_TICKET_RUN,
  StatisticsInteractionKind.AUTONOMOUS_TICKET_RUN_TURN,
  StatisticsInteractionKind.AUTONOMOUS_TICKET_COMMIT_MESSAGE,
]);

function parseStatisticsInteractionKind(value: string | undefined): StatisticsInteractionKind | undefined {
  if (!value) return undefined;

  if (ALLOWED_INTERACTION_KINDS.has(value)) {
    return value as StatisticsInteractionKind;
  }

  throw new BadRequestException(`interactionKind must be one of: ${[...ALLOWED_INTERACTION_KINDS].join(', ')}`);
}

const ALLOWED_EGRESS_KINDS: ReadonlySet<string> = new Set(['web', 'dns', 'network', 'guard']);
const ALLOWED_EGRESS_DECISIONS: ReadonlySet<string> = new Set(['allowed', 'blocked', 'observed', 'error']);

function parseEgressFilter(
  value: string | undefined,
  allowed: ReadonlySet<string>,
  paramName: string,
): string | undefined {
  if (!value) return undefined;

  if (allowed.has(value)) {
    return value;
  }

  throw new BadRequestException(`${paramName} must be one of: ${[...allowed].join(', ')}`);
}

const EMPTY_SECURITY_SUMMARY = {
  egressAllowedCount: 0,
  egressBlockedCount: 0,
  egressObservedCount: 0,
  egressGuardErrorCount: 0,
  egressBreakdown: [] as StatisticsSummaryDto['egressBreakdown'],
  egressTopBlockedHosts: [] as StatisticsSummaryDto['egressTopBlockedHosts'],
  egressRulesBreakdown: [] as StatisticsSummaryDto['egressRulesBreakdown'],
};

@Injectable()
export class StatisticsQueryService {
  constructor(
    private readonly statisticsRepository: StatisticsRepository,
    private readonly securityRepository: StatisticsSecurityRepository,
  ) {}

  /** Egress aggregates + (optional) security time series for summary responses. */
  private async buildSecuritySummary(
    ids: string[],
    from: string | undefined,
    to: string | undefined,
    groupBy: 'day' | 'hour' | undefined,
  ): Promise<
    Pick<
      StatisticsSummaryDto,
      | 'egressAllowedCount'
      | 'egressBlockedCount'
      | 'egressObservedCount'
      | 'egressGuardErrorCount'
      | 'egressBreakdown'
      | 'egressTopBlockedHosts'
      | 'egressRulesBreakdown'
      | 'securitySeries'
    >
  > {
    const [aggregate, securitySeries] = await Promise.all([
      this.securityRepository.queryEgressAggregate({ statisticsClientIds: ids, from, to }),
      groupBy
        ? this.securityRepository.querySecuritySeries({ statisticsClientIds: ids, from, to, groupBy })
        : Promise.resolve(undefined),
    ]);

    return { ...aggregate, ...(securitySeries ? { securitySeries } : {}) };
  }

  private toEgressEventDto(row: StatisticsEgressEventEntity): StatisticsEgressEventDto {
    return {
      id: row.id,
      clientId: row.statisticsClient?.originalClientId ?? row.statisticsClientId,
      agentId: row.statisticsAgent?.originalAgentId,
      clientName: row.statisticsClient?.name,
      agentName: row.statisticsAgent?.name,
      kind: row.kind,
      decision: row.decision,
      host: row.host ?? null,
      rule: row.rule ?? null,
      matchedEntry: row.matchedEntry ?? null,
      matchedSource: row.matchedSource ?? null,
      method: row.method ?? null,
      httpStatus: row.httpStatus ?? null,
      sampleUrl: row.sampleUrl ?? null,
      count: row.count,
      bytesIn: Number(row.bytesIn ?? 0),
      bytesOut: Number(row.bytesOut ?? 0),
      mode: row.mode ?? null,
      policyRevision: row.policyRevision ?? null,
      message: row.message ?? null,
      firstSeenAt: row.firstSeenAt,
      occurredAt: row.occurredAt,
    };
  }

  async getClientEgressEvents(
    clientId: string,
    params: {
      agentId?: string;
      kind?: string;
      decision?: string;
      from?: string;
      to?: string;
      search?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<StatisticsEgressEventListDto> {
    return await this.getEgressEvents([clientId], params);
  }

  async getEgressEvents(
    accessibleClientIds: string[],
    params: {
      agentId?: string;
      kind?: string;
      decision?: string;
      from?: string;
      to?: string;
      search?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<StatisticsEgressEventListDto> {
    const from = validateIsoDate(params.from, 'from');
    const to = normalizeToEndOfDay(validateIsoDate(params.to, 'to'));
    const kind = parseEgressFilter(params.kind, ALLOWED_EGRESS_KINDS, 'kind');
    const decision = parseEgressFilter(params.decision, ALLOWED_EGRESS_DECISIONS, 'decision');
    const limit = params.limit ?? 10;
    const offset = params.offset ?? 0;
    const ids = await this.resolveStatisticsClientIds(accessibleClientIds);

    if (ids.length === 0) {
      return { data: [], total: 0, limit, offset };
    }

    const { rows, total } = await this.securityRepository.queryEgressEvents({
      statisticsClientIds: ids,
      agentId: params.agentId,
      kind,
      decision,
      from,
      to,
      search: params.search,
      limit,
      offset,
    });

    return { data: rows.map((row) => this.toEgressEventDto(row)), total, limit, offset };
  }

  private async resolveStatisticsClientIds(originalClientIds: string[]): Promise<string[]> {
    if (originalClientIds.length === 0) return [];

    return await this.statisticsRepository.findStatisticsClientIdsByOriginalIds(originalClientIds);
  }

  async getClientSummary(
    clientId: string,
    params: { from?: string; to?: string; groupBy?: 'day' | 'hour' },
  ): Promise<StatisticsSummaryDto> {
    const from = validateIsoDate(params.from, 'from');
    const to = normalizeToEndOfDay(validateIsoDate(params.to, 'to'));
    const ids = await this.resolveStatisticsClientIds([clientId]);

    if (ids.length === 0) {
      return {
        totalMessages: 0,
        totalWords: 0,
        totalChars: 0,
        avgWordsPerMessage: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
        totalCostUsd: 0,
        autoEnrichmentRuns: 0,
        autoEnrichmentContexts: 0,
        autoEnrichmentChars: 0,
        filterDropCount: 0,
        filterTypesBreakdown: [],
        filterFlagCount: 0,
        filterFlagsBreakdown: [],
        ...EMPTY_SECURITY_SUMMARY,
      };
    }

    const [chatAgg, autoEnrichmentAgg, filterDropAgg, filterFlagAgg] = await Promise.all([
      this.statisticsRepository.queryChatIoAggregate({
        statisticsClientIds: ids,
        from,
        to,
        groupBy: params.groupBy,
      }),
      this.statisticsRepository.queryChatIoAggregate({
        statisticsClientIds: ids,
        from,
        to,
        interactionKind: StatisticsInteractionKind.AUTO_CONTEXT_ENRICHMENT,
      }),
      this.statisticsRepository.queryFilterDropsAggregate({ statisticsClientIds: ids, from, to }),
      this.statisticsRepository.queryFilterFlagsAggregate({ statisticsClientIds: ids, from, to }),
    ]);
    const security = await this.buildSecuritySummary(ids, from, to, params.groupBy);

    return {
      totalMessages: chatAgg.totalMessages,
      totalWords: chatAgg.totalWords,
      totalChars: chatAgg.totalChars,
      avgWordsPerMessage: chatAgg.avgWordsPerMessage,
      totalInputTokens: chatAgg.totalInputTokens,
      totalOutputTokens: chatAgg.totalOutputTokens,
      totalTokens: chatAgg.totalTokens,
      totalCostUsd: chatAgg.totalCostUsd,
      autoEnrichmentRuns: autoEnrichmentAgg.totalMessages,
      autoEnrichmentContexts: autoEnrichmentAgg.totalWords,
      autoEnrichmentChars: autoEnrichmentAgg.totalChars,
      filterDropCount: filterDropAgg.filterDropCount,
      filterTypesBreakdown: filterDropAgg.filterTypesBreakdown,
      filterFlagCount: filterFlagAgg.filterFlagCount,
      filterFlagsBreakdown: filterFlagAgg.filterTypesBreakdown,
      series: chatAgg.series,
      ...security,
    };
  }

  async getSummary(
    accessibleClientIds: string[],
    params: { from?: string; to?: string; groupBy?: 'day' | 'hour' },
  ): Promise<StatisticsSummaryDto> {
    const from = validateIsoDate(params.from, 'from');
    const to = normalizeToEndOfDay(validateIsoDate(params.to, 'to'));
    const ids = await this.resolveStatisticsClientIds(accessibleClientIds);

    if (ids.length === 0) {
      return {
        totalMessages: 0,
        totalWords: 0,
        totalChars: 0,
        avgWordsPerMessage: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
        totalCostUsd: 0,
        autoEnrichmentRuns: 0,
        autoEnrichmentContexts: 0,
        autoEnrichmentChars: 0,
        filterDropCount: 0,
        filterTypesBreakdown: [],
        filterFlagCount: 0,
        filterFlagsBreakdown: [],
        ...EMPTY_SECURITY_SUMMARY,
      };
    }

    const [chatAgg, autoEnrichmentAgg, filterDropAgg, filterFlagAgg] = await Promise.all([
      this.statisticsRepository.queryChatIoAggregate({
        statisticsClientIds: ids,
        from,
        to,
        groupBy: params.groupBy,
      }),
      this.statisticsRepository.queryChatIoAggregate({
        statisticsClientIds: ids,
        from,
        to,
        interactionKind: StatisticsInteractionKind.AUTO_CONTEXT_ENRICHMENT,
      }),
      this.statisticsRepository.queryFilterDropsAggregate({ statisticsClientIds: ids, from, to }),
      this.statisticsRepository.queryFilterFlagsAggregate({ statisticsClientIds: ids, from, to }),
    ]);
    const security = await this.buildSecuritySummary(ids, from, to, params.groupBy);

    return {
      totalMessages: chatAgg.totalMessages,
      totalWords: chatAgg.totalWords,
      totalChars: chatAgg.totalChars,
      avgWordsPerMessage: chatAgg.avgWordsPerMessage,
      totalInputTokens: chatAgg.totalInputTokens,
      totalOutputTokens: chatAgg.totalOutputTokens,
      totalTokens: chatAgg.totalTokens,
      totalCostUsd: chatAgg.totalCostUsd,
      autoEnrichmentRuns: autoEnrichmentAgg.totalMessages,
      autoEnrichmentContexts: autoEnrichmentAgg.totalWords,
      autoEnrichmentChars: autoEnrichmentAgg.totalChars,
      filterDropCount: filterDropAgg.filterDropCount,
      filterTypesBreakdown: filterDropAgg.filterTypesBreakdown,
      filterFlagCount: filterFlagAgg.filterFlagCount,
      filterFlagsBreakdown: filterFlagAgg.filterTypesBreakdown,
      series: chatAgg.series,
      ...security,
    };
  }

  async getClientChatIo(
    clientId: string,
    params: {
      agentId?: string;
      from?: string;
      to?: string;
      direction?: ChatDirection;
      interactionKind?: string;
      search?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<StatisticsChatIoListDto> {
    const from = validateIsoDate(params.from, 'from');
    const to = normalizeToEndOfDay(validateIsoDate(params.to, 'to'));
    const interactionKind = parseStatisticsInteractionKind(params.interactionKind);
    const ids = await this.resolveStatisticsClientIds([clientId]);

    if (ids.length === 0) {
      return { data: [], total: 0, limit: params.limit ?? 10, offset: params.offset ?? 0 };
    }

    const { rows, total } = await this.statisticsRepository.queryChatIo({
      statisticsClientIds: ids,
      agentId: params.agentId,
      from,
      to,
      direction: params.direction,
      interactionKind,
      search: params.search,
      limit: params.limit ?? 10,
      offset: params.offset ?? 0,
    });
    const data: StatisticsChatIoDto[] = rows.map((r) => ({
      id: r.id,
      clientId: r.statisticsClient?.originalClientId ?? r.statisticsClientId,
      agentId: r.statisticsAgent?.originalAgentId,
      clientName: r.statisticsClient?.name,
      agentName: r.statisticsAgent?.name,
      originalUserId: r.statisticsUser?.originalUserId,
      direction: r.direction,
      interactionKind: r.interactionKind,
      wordCount: r.wordCount,
      charCount: r.charCount,
      inputTokens: r.inputTokens ?? null,
      outputTokens: r.outputTokens ?? null,
      reasoningTokens: r.reasoningTokens ?? null,
      cacheReadTokens: r.cacheReadTokens ?? null,
      cacheWriteTokens: r.cacheWriteTokens ?? null,
      costUsd: r.costUsd != null ? Number(r.costUsd) : null,
      occurredAt: r.occurredAt,
    }));

    return {
      data,
      total,
      limit: params.limit ?? 10,
      offset: params.offset ?? 0,
    };
  }

  async getChatIo(
    accessibleClientIds: string[],
    params: {
      agentId?: string;
      from?: string;
      to?: string;
      direction?: ChatDirection;
      interactionKind?: string;
      search?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<StatisticsChatIoListDto> {
    const from = validateIsoDate(params.from, 'from');
    const to = normalizeToEndOfDay(validateIsoDate(params.to, 'to'));
    const interactionKind = parseStatisticsInteractionKind(params.interactionKind);
    const ids = await this.resolveStatisticsClientIds(accessibleClientIds);

    if (ids.length === 0) {
      return { data: [], total: 0, limit: params.limit ?? 10, offset: params.offset ?? 0 };
    }

    const { rows, total } = await this.statisticsRepository.queryChatIo({
      statisticsClientIds: ids,
      agentId: params.agentId,
      from,
      to,
      direction: params.direction,
      interactionKind,
      search: params.search,
      limit: params.limit ?? 10,
      offset: params.offset ?? 0,
    });
    const data: StatisticsChatIoDto[] = rows.map((r) => ({
      id: r.id,
      clientId: r.statisticsClient?.originalClientId ?? r.statisticsClientId,
      agentId: r.statisticsAgent?.originalAgentId,
      clientName: r.statisticsClient?.name,
      agentName: r.statisticsAgent?.name,
      originalUserId: r.statisticsUser?.originalUserId,
      direction: r.direction,
      interactionKind: r.interactionKind,
      wordCount: r.wordCount,
      charCount: r.charCount,
      inputTokens: r.inputTokens ?? null,
      outputTokens: r.outputTokens ?? null,
      reasoningTokens: r.reasoningTokens ?? null,
      cacheReadTokens: r.cacheReadTokens ?? null,
      cacheWriteTokens: r.cacheWriteTokens ?? null,
      costUsd: r.costUsd != null ? Number(r.costUsd) : null,
      occurredAt: r.occurredAt,
    }));

    return {
      data,
      total,
      limit: params.limit ?? 10,
      offset: params.offset ?? 0,
    };
  }

  async getClientFilterDrops(
    clientId: string,
    params: {
      agentId?: string;
      filterType?: string;
      from?: string;
      to?: string;
      search?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<StatisticsFilterDropListDto> {
    const from = validateIsoDate(params.from, 'from');
    const to = normalizeToEndOfDay(validateIsoDate(params.to, 'to'));
    const ids = await this.resolveStatisticsClientIds([clientId]);

    if (ids.length === 0) {
      return { data: [], total: 0, limit: params.limit ?? 10, offset: params.offset ?? 0 };
    }

    const { rows, total } = await this.statisticsRepository.queryFilterDrops({
      statisticsClientIds: ids,
      agentId: params.agentId,
      filterType: params.filterType,
      from,
      to,
      search: params.search,
      limit: params.limit ?? 10,
      offset: params.offset ?? 0,
    });
    const data: StatisticsFilterDropDto[] = rows.map((r) => ({
      id: r.id,
      clientId: r.statisticsClient?.originalClientId ?? r.statisticsClientId,
      agentId: r.statisticsAgent?.originalAgentId,
      clientName: r.statisticsClient?.name,
      agentName: r.statisticsAgent?.name,
      originalUserId: r.statisticsUser?.originalUserId,
      filterType: r.filterType,
      filterDisplayName: r.filterDisplayName,
      filterReason: r.filterReason,
      direction: r.direction,
      wordCount: r.wordCount,
      charCount: r.charCount,
      occurredAt: r.occurredAt,
    }));

    return {
      data,
      total,
      limit: params.limit ?? 10,
      offset: params.offset ?? 0,
    };
  }

  async getFilterDrops(
    accessibleClientIds: string[],
    params: {
      agentId?: string;
      filterType?: string;
      from?: string;
      to?: string;
      search?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<StatisticsFilterDropListDto> {
    const from = validateIsoDate(params.from, 'from');
    const to = normalizeToEndOfDay(validateIsoDate(params.to, 'to'));
    const ids = await this.resolveStatisticsClientIds(accessibleClientIds);

    if (ids.length === 0) {
      return { data: [], total: 0, limit: params.limit ?? 10, offset: params.offset ?? 0 };
    }

    const { rows, total } = await this.statisticsRepository.queryFilterDrops({
      statisticsClientIds: ids,
      agentId: params.agentId,
      filterType: params.filterType,
      from,
      to,
      search: params.search,
      limit: params.limit ?? 10,
      offset: params.offset ?? 0,
    });
    const data: StatisticsFilterDropDto[] = rows.map((r) => ({
      id: r.id,
      clientId: r.statisticsClient?.originalClientId ?? r.statisticsClientId,
      agentId: r.statisticsAgent?.originalAgentId,
      clientName: r.statisticsClient?.name,
      agentName: r.statisticsAgent?.name,
      originalUserId: r.statisticsUser?.originalUserId,
      filterType: r.filterType,
      filterDisplayName: r.filterDisplayName,
      filterReason: r.filterReason,
      direction: r.direction,
      wordCount: r.wordCount,
      charCount: r.charCount,
      occurredAt: r.occurredAt,
    }));

    return {
      data,
      total,
      limit: params.limit ?? 10,
      offset: params.offset ?? 0,
    };
  }

  async getClientFilterFlags(
    clientId: string,
    params: {
      agentId?: string;
      filterType?: string;
      from?: string;
      to?: string;
      search?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<StatisticsFilterFlagListDto> {
    const from = validateIsoDate(params.from, 'from');
    const to = normalizeToEndOfDay(validateIsoDate(params.to, 'to'));
    const ids = await this.resolveStatisticsClientIds([clientId]);

    if (ids.length === 0) {
      return { data: [], total: 0, limit: params.limit ?? 10, offset: params.offset ?? 0 };
    }

    const { rows, total } = await this.statisticsRepository.queryFilterFlags({
      statisticsClientIds: ids,
      agentId: params.agentId,
      filterType: params.filterType,
      from,
      to,
      search: params.search,
      limit: params.limit ?? 10,
      offset: params.offset ?? 0,
    });
    const data: StatisticsFilterFlagDto[] = rows.map((r) => ({
      id: r.id,
      clientId: r.statisticsClient?.originalClientId ?? r.statisticsClientId,
      agentId: r.statisticsAgent?.originalAgentId,
      clientName: r.statisticsClient?.name,
      agentName: r.statisticsAgent?.name,
      originalUserId: r.statisticsUser?.originalUserId,
      filterType: r.filterType,
      filterDisplayName: r.filterDisplayName,
      filterReason: r.filterReason,
      direction: r.direction,
      wordCount: r.wordCount,
      charCount: r.charCount,
      occurredAt: r.occurredAt,
    }));

    return {
      data,
      total,
      limit: params.limit ?? 10,
      offset: params.offset ?? 0,
    };
  }

  async getFilterFlags(
    accessibleClientIds: string[],
    params: {
      agentId?: string;
      filterType?: string;
      from?: string;
      to?: string;
      search?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<StatisticsFilterFlagListDto> {
    const from = validateIsoDate(params.from, 'from');
    const to = normalizeToEndOfDay(validateIsoDate(params.to, 'to'));
    const ids = await this.resolveStatisticsClientIds(accessibleClientIds);

    if (ids.length === 0) {
      return { data: [], total: 0, limit: params.limit ?? 10, offset: params.offset ?? 0 };
    }

    const { rows, total } = await this.statisticsRepository.queryFilterFlags({
      statisticsClientIds: ids,
      agentId: params.agentId,
      filterType: params.filterType,
      from,
      to,
      search: params.search,
      limit: params.limit ?? 10,
      offset: params.offset ?? 0,
    });
    const data: StatisticsFilterFlagDto[] = rows.map((r) => ({
      id: r.id,
      clientId: r.statisticsClient?.originalClientId ?? r.statisticsClientId,
      agentId: r.statisticsAgent?.originalAgentId,
      clientName: r.statisticsClient?.name,
      agentName: r.statisticsAgent?.name,
      originalUserId: r.statisticsUser?.originalUserId,
      filterType: r.filterType,
      filterDisplayName: r.filterDisplayName,
      filterReason: r.filterReason,
      direction: r.direction,
      wordCount: r.wordCount,
      charCount: r.charCount,
      occurredAt: r.occurredAt,
    }));

    return {
      data,
      total,
      limit: params.limit ?? 10,
      offset: params.offset ?? 0,
    };
  }

  async getClientEntityEvents(
    clientId: string,
    params: {
      entityType?: StatisticsEntityType;
      eventType?: StatisticsEntityEventType;
      from?: string;
      to?: string;
      search?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<StatisticsEntityEventListDto> {
    const from = validateIsoDate(params.from, 'from');
    const to = normalizeToEndOfDay(validateIsoDate(params.to, 'to'));
    const ids = await this.resolveStatisticsClientIds([clientId]);

    if (ids.length === 0) {
      return { data: [], total: 0, limit: params.limit ?? 10, offset: params.offset ?? 0 };
    }

    const { rows, total } = await this.statisticsRepository.queryEntityEvents({
      statisticsClientIds: ids,
      entityType: params.entityType,
      eventType: params.eventType,
      from,
      to,
      search: params.search,
      limit: params.limit ?? 10,
      offset: params.offset ?? 0,
    });
    const data: StatisticsEntityEventDto[] = rows.map((r) => {
      const agent = r.statisticsAgents;

      return {
        id: r.id,
        entityType: r.entityType,
        eventType: r.eventType,
        originalEntityId: r.originalEntityId,
        originalUserId: r.statisticsUser?.originalUserId,
        clientId: agent?.statisticsClient?.originalClientId,
        agentId: agent?.originalAgentId,
        clientName: agent?.statisticsClient?.name,
        agentName: agent?.name,
        occurredAt: r.occurredAt,
      };
    });

    return {
      data,
      total,
      limit: params.limit ?? 10,
      offset: params.offset ?? 0,
    };
  }

  async getEntityEvents(
    accessibleClientIds: string[],
    params: {
      entityType?: StatisticsEntityType;
      eventType?: StatisticsEntityEventType;
      from?: string;
      to?: string;
      search?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<StatisticsEntityEventListDto> {
    const from = validateIsoDate(params.from, 'from');
    const to = normalizeToEndOfDay(validateIsoDate(params.to, 'to'));
    const ids = await this.resolveStatisticsClientIds(accessibleClientIds);

    if (ids.length === 0) {
      return { data: [], total: 0, limit: params.limit ?? 10, offset: params.offset ?? 0 };
    }

    const { rows, total } = await this.statisticsRepository.queryEntityEvents({
      statisticsClientIds: ids,
      entityType: params.entityType,
      eventType: params.eventType,
      from,
      to,
      search: params.search,
      limit: params.limit ?? 10,
      offset: params.offset ?? 0,
    });
    const data: StatisticsEntityEventDto[] = rows.map((r) => {
      const agent = r.statisticsAgents;

      return {
        id: r.id,
        entityType: r.entityType,
        eventType: r.eventType,
        originalEntityId: r.originalEntityId,
        originalUserId: r.statisticsUser?.originalUserId,
        clientId: agent?.statisticsClient?.originalClientId,
        agentId: agent?.originalAgentId,
        clientName: agent?.statisticsClient?.name,
        agentName: agent?.name,
        occurredAt: r.occurredAt,
      };
    });

    return {
      data,
      total,
      limit: params.limit ?? 10,
      offset: params.offset ?? 0,
    };
  }
}
