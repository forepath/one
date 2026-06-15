import { AuthenticationType, ClientUserRole } from '@forepath/identity/backend';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { StatisticsAgentEntity } from '../entities/statistics-agent.entity';
import { FilterDropDirection, StatisticsChatFilterDropEntity } from '../entities/statistics-chat-filter-drop.entity';
import { FilterFlagDirection, StatisticsChatFilterFlagEntity } from '../entities/statistics-chat-filter-flag.entity';
import {
  ChatDirection,
  StatisticsChatIoEntity,
  StatisticsInteractionKind,
} from '../entities/statistics-chat-io.entity';
import { StatisticsClientUserEntity } from '../entities/statistics-client-user.entity';
import { StatisticsClientEntity } from '../entities/statistics-client.entity';
import {
  StatisticsEntityEventEntity,
  StatisticsEntityEventType,
  StatisticsEntityType,
} from '../entities/statistics-entity-event.entity';
import { StatisticsProvisioningReferenceEntity } from '../entities/statistics-provisioning-reference.entity';
import { StatisticsUserEntity } from '../entities/statistics-user.entity';

const MAX_SEARCH_LENGTH = 200;

function escapeIlikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function sanitizeSearch(search: string | undefined): string | undefined {
  if (!search || typeof search !== 'string') return undefined;

  const trimmed = search.trim();

  if (trimmed.length === 0) return undefined;

  return trimmed.length > MAX_SEARCH_LENGTH ? trimmed.slice(0, MAX_SEARCH_LENGTH) : trimmed;
}

/**
 * Repository for statistics shadow tables and event tables.
 * Provides methods for upserting shadow entries and recording events.
 */
@Injectable()
export class StatisticsRepository {
  constructor(
    @InjectRepository(StatisticsUserEntity)
    private readonly statisticsUsers: Repository<StatisticsUserEntity>,
    @InjectRepository(StatisticsClientEntity)
    private readonly statisticsClients: Repository<StatisticsClientEntity>,
    @InjectRepository(StatisticsAgentEntity)
    private readonly statisticsAgents: Repository<StatisticsAgentEntity>,
    @InjectRepository(StatisticsProvisioningReferenceEntity)
    private readonly statisticsProvisioningReferences: Repository<StatisticsProvisioningReferenceEntity>,
    @InjectRepository(StatisticsClientUserEntity)
    private readonly statisticsClientUsers: Repository<StatisticsClientUserEntity>,
    @InjectRepository(StatisticsChatIoEntity)
    private readonly statisticsChatIo: Repository<StatisticsChatIoEntity>,
    @InjectRepository(StatisticsChatFilterDropEntity)
    private readonly statisticsChatFilterDrops: Repository<StatisticsChatFilterDropEntity>,
    @InjectRepository(StatisticsChatFilterFlagEntity)
    private readonly statisticsChatFilterFlags: Repository<StatisticsChatFilterFlagEntity>,
    @InjectRepository(StatisticsEntityEventEntity)
    private readonly statisticsEntityEvents: Repository<StatisticsEntityEventEntity>,
  ) {}

  async upsertStatisticsUser(originalUserId: string, role: string): Promise<StatisticsUserEntity> {
    let entity = await this.statisticsUsers.findOne({ where: { originalUserId } });

    if (!entity) {
      entity = this.statisticsUsers.create({ originalUserId, role: role as StatisticsUserEntity['role'] });

      return await this.statisticsUsers.save(entity);
    }

    entity.role = role as StatisticsUserEntity['role'];

    return await this.statisticsUsers.save(entity);
  }

  async findStatisticsUserByOriginalId(originalUserId: string): Promise<StatisticsUserEntity | null> {
    return await this.statisticsUsers.findOne({ where: { originalUserId } });
  }

  async upsertStatisticsClient(
    originalClientId: string,
    data: { name: string; endpoint: string; authenticationType: AuthenticationType },
  ): Promise<StatisticsClientEntity> {
    let entity = await this.statisticsClients.findOne({ where: { originalClientId } });

    if (!entity) {
      entity = this.statisticsClients.create({
        originalClientId,
        name: data.name,
        endpoint: data.endpoint,
        authenticationType: data.authenticationType,
      });

      return await this.statisticsClients.save(entity);
    }

    entity.name = data.name;
    entity.endpoint = data.endpoint;
    entity.authenticationType = data.authenticationType;

    return await this.statisticsClients.save(entity);
  }

  async findStatisticsClientByOriginalId(originalClientId: string): Promise<StatisticsClientEntity | null> {
    return await this.statisticsClients.findOne({ where: { originalClientId } });
  }

  async upsertStatisticsAgent(
    originalAgentId: string,
    statisticsClientId: string,
    data?: { agentType?: string; containerType?: string; name?: string; description?: string },
  ): Promise<StatisticsAgentEntity> {
    let entity = await this.statisticsAgents.findOne({
      where: { originalAgentId, statisticsClientId },
    });

    if (!entity) {
      entity = this.statisticsAgents.create({
        originalAgentId,
        statisticsClientId,
        agentType: data?.agentType ?? 'cursor',
        containerType: data?.containerType ?? 'generic',
        name: data?.name,
        description: data?.description,
      });

      return await this.statisticsAgents.save(entity);
    }

    if (data) {
      if (data.agentType !== undefined) entity.agentType = data.agentType;

      if (data.containerType !== undefined) entity.containerType = data.containerType;

      if (data.name !== undefined) entity.name = data.name;

      if (data.description !== undefined) entity.description = data.description;

      return await this.statisticsAgents.save(entity);
    }

    return entity;
  }

  async findStatisticsAgentByOriginalId(
    originalAgentId: string,
    statisticsClientId: string,
  ): Promise<StatisticsAgentEntity | null> {
    return await this.statisticsAgents.findOne({
      where: { originalAgentId, statisticsClientId },
    });
  }

  async createStatisticsProvisioningReference(data: {
    originalProvisioningReferenceId: string;
    statisticsClientId: string;
    providerType: string;
    serverId: string;
    serverName?: string;
    publicIp?: string;
    privateIp?: string;
    providerMetadata?: string;
  }): Promise<StatisticsProvisioningReferenceEntity> {
    const entity = this.statisticsProvisioningReferences.create(data);

    return await this.statisticsProvisioningReferences.save(entity);
  }

  async createStatisticsClientUser(data: {
    originalClientUserId: string;
    statisticsClientId: string;
    statisticsUserId: string;
    role: ClientUserRole | string;
  }): Promise<StatisticsClientUserEntity> {
    const entity = this.statisticsClientUsers.create({
      originalClientUserId: data.originalClientUserId,
      statisticsClientId: data.statisticsClientId,
      statisticsUserId: data.statisticsUserId,
      role: data.role as ClientUserRole,
    });

    return await this.statisticsClientUsers.save(entity);
  }

  async createStatisticsChatIo(data: {
    statisticsAgentId?: string;
    statisticsClientId: string;
    statisticsUserId?: string;
    direction: ChatDirection;
    interactionKind?: StatisticsInteractionKind;
    wordCount: number;
    charCount: number;
    occurredAt: Date;
  }): Promise<StatisticsChatIoEntity> {
    const entity = this.statisticsChatIo.create({
      ...data,
      interactionKind: data.interactionKind ?? StatisticsInteractionKind.CHAT,
    });

    return await this.statisticsChatIo.save(entity);
  }

  async createStatisticsChatFilterDrop(data: {
    statisticsAgentId?: string;
    statisticsClientId: string;
    statisticsUserId?: string;
    filterType: string;
    filterDisplayName: string;
    filterReason?: string;
    direction: FilterDropDirection;
    wordCount: number;
    charCount: number;
    occurredAt: Date;
  }): Promise<StatisticsChatFilterDropEntity> {
    const entity = this.statisticsChatFilterDrops.create(data);

    return await this.statisticsChatFilterDrops.save(entity);
  }

  async createStatisticsChatFilterFlag(data: {
    statisticsAgentId?: string;
    statisticsClientId: string;
    statisticsUserId?: string;
    filterType: string;
    filterDisplayName: string;
    filterReason?: string;
    direction: FilterFlagDirection;
    wordCount: number;
    charCount: number;
    occurredAt: Date;
  }): Promise<StatisticsChatFilterFlagEntity> {
    const entity = this.statisticsChatFilterFlags.create(data);

    return await this.statisticsChatFilterFlags.save(entity);
  }

  async createStatisticsEntityEvent(data: {
    eventType: StatisticsEntityEventType;
    entityType: StatisticsEntityType;
    originalEntityId: string;
    statisticsUserId?: string;
    statisticsUsersId?: string;
    statisticsClientsId?: string;
    statisticsAgentsId?: string;
    statisticsClientUsersId?: string;
    statisticsProvisioningReferencesId?: string;
    occurredAt: Date;
  }): Promise<StatisticsEntityEventEntity> {
    const entity = this.statisticsEntityEvents.create(data);

    return await this.statisticsEntityEvents.save(entity);
  }

  /**
   * Map original client IDs to statistics_client IDs.
   * @param originalClientIds - Array of original client UUIDs
   * @returns Array of statistics_client UUIDs
   */
  async findStatisticsClientIdsByOriginalIds(originalClientIds: string[]): Promise<string[]> {
    if (originalClientIds.length === 0) return [];

    const rows = await this.statisticsClients
      .createQueryBuilder('sc')
      .select('sc.id')
      .where('sc.original_client_id IN (:...ids)', { ids: originalClientIds })
      .getMany();

    return rows.map((r) => r.id);
  }

  /** Query params for chat I/O */
  async queryChatIo(params: {
    statisticsClientIds: string[];
    agentId?: string;
    from?: string;
    to?: string;
    direction?: ChatDirection;
    interactionKind?: StatisticsInteractionKind;
    search?: string;
    limit: number;
    offset: number;
  }): Promise<{ rows: StatisticsChatIoEntity[]; total: number }> {
    const { statisticsClientIds, agentId, from, to, direction, interactionKind, search, limit, offset } = params;

    if (statisticsClientIds.length === 0) return { rows: [], total: 0 };

    const sanitized = sanitizeSearch(search);
    const searchPattern = sanitized ? `%${escapeIlikePattern(sanitized)}%` : undefined;
    const applyChatIoWhere = (qb: ReturnType<typeof this.statisticsChatIo.createQueryBuilder>) => {
      qb = qb.where('cio.statistics_client_id IN (:...ids)', { ids: statisticsClientIds });

      if (agentId) {
        qb = qb.andWhere(
          'cio.statistics_agent_id IN (SELECT id FROM statistics_agents WHERE original_agent_id = :agentId AND statistics_client_id IN (:...ids))',
          { agentId, ids: statisticsClientIds },
        );
      }

      if (from) qb = qb.andWhere('cio.occurred_at >= :from', { from });

      if (to) qb = qb.andWhere('cio.occurred_at <= :to', { to });

      if (direction) qb = qb.andWhere('cio.direction = :direction', { direction });

      if (interactionKind) qb = qb.andWhere('cio.interaction_kind = :interactionKind', { interactionKind });

      if (searchPattern) {
        qb = qb.andWhere(
          '(cio.id::text ILIKE :search OR cio.direction::text ILIKE :search OR cio.interaction_kind::text ILIKE :search OR cio.word_count::text ILIKE :search OR cio.char_count::text ILIKE :search)',
          { search: searchPattern },
        );
      }

      return qb;
    };
    const countQb = applyChatIoWhere(this.statisticsChatIo.createQueryBuilder('cio'));
    const total = await countQb.getCount();
    const dataQb = applyChatIoWhere(this.statisticsChatIo.createQueryBuilder('cio'));
    const rowsPlain = await dataQb.orderBy('cio.occurred_at', 'DESC').skip(offset).take(limit).getMany();
    const rows = rowsPlain.length === 0 ? [] : await this.loadChatIoWithRelations(rowsPlain.map((r) => r.id));

    return { rows, total };
  }

  private async loadChatIoWithRelations(ids: string[]): Promise<StatisticsChatIoEntity[]> {
    const entities = await this.statisticsChatIo.find({
      where: { id: In(ids) },
      relations: ['statisticsClient', 'statisticsAgent', 'statisticsUser'],
    });
    const byId = new Map(entities.map((e) => [e.id, e]));

    return ids.map((id) => byId.get(id)!).filter(Boolean);
  }

  /** Aggregate chat I/O (sum/avg word_count, char_count, count) */
  async queryChatIoAggregate(params: {
    statisticsClientIds: string[];
    agentId?: string;
    from?: string;
    to?: string;
    direction?: ChatDirection;
    interactionKind?: StatisticsInteractionKind;
    groupBy?: 'day' | 'hour';
  }): Promise<{
    totalMessages: number;
    totalWords: number;
    totalChars: number;
    avgWordsPerMessage: number;
    series?: { period: string; count: number; wordCount: number; charCount: number }[];
  }> {
    const { statisticsClientIds, agentId, from, to, direction, interactionKind, groupBy } = params;

    if (statisticsClientIds.length === 0) {
      return {
        totalMessages: 0,
        totalWords: 0,
        totalChars: 0,
        avgWordsPerMessage: 0,
        series: [],
      };
    }

    let qb = this.statisticsChatIo
      .createQueryBuilder('cio')
      .where('cio.statistics_client_id IN (:...ids)', { ids: statisticsClientIds });

    if (agentId) {
      qb = qb.andWhere(
        'cio.statistics_agent_id IN (SELECT id FROM statistics_agents WHERE original_agent_id = :agentId AND statistics_client_id IN (:...ids))',
        { agentId, ids: statisticsClientIds },
      );
    }

    if (from) qb = qb.andWhere('cio.occurred_at >= :from', { from });

    if (to) qb = qb.andWhere('cio.occurred_at <= :to', { to });

    if (direction) qb = qb.andWhere('cio.direction = :direction', { direction });

    if (interactionKind) qb = qb.andWhere('cio.interaction_kind = :interactionKind', { interactionKind });

    const raw = await qb
      .select([
        'COUNT(cio.id) AS count',
        'COALESCE(SUM(cio.word_count), 0) AS word_count',
        'COALESCE(SUM(cio.char_count), 0) AS char_count',
      ])
      .getRawOne<{ count: string; word_count: string; char_count: string }>();
    const totalMessages = parseInt(raw?.count ?? '0', 10);
    const totalWords = parseInt(raw?.word_count ?? '0', 10);
    const totalChars = parseInt(raw?.char_count ?? '0', 10);
    const avgWordsPerMessage = totalMessages > 0 ? totalWords / totalMessages : 0;
    let series: { period: string; count: number; wordCount: number; charCount: number }[] | undefined;

    if (groupBy) {
      const dateFormat =
        groupBy === 'day' ? "date_trunc('day', cio.occurred_at)" : "date_trunc('hour', cio.occurred_at)";
      const seriesQb = this.statisticsChatIo
        .createQueryBuilder('cio')
        .select([
          `${dateFormat} AS period`,
          'COUNT(cio.id) AS count',
          'COALESCE(SUM(cio.word_count), 0) AS word_count',
          'COALESCE(SUM(cio.char_count), 0) AS char_count',
        ])
        .where('cio.statistics_client_id IN (:...ids)', { ids: statisticsClientIds })
        .groupBy('period')
        .orderBy('period', 'ASC');

      if (agentId) {
        seriesQb.andWhere(
          'cio.statistics_agent_id IN (SELECT id FROM statistics_agents WHERE original_agent_id = :agentId AND statistics_client_id IN (:...ids))',
          { agentId, ids: statisticsClientIds },
        );
      }

      if (from) seriesQb.andWhere('cio.occurred_at >= :from', { from });

      if (to) seriesQb.andWhere('cio.occurred_at <= :to', { to });

      if (direction) seriesQb.andWhere('cio.direction = :direction', { direction });

      if (interactionKind) seriesQb.andWhere('cio.interaction_kind = :interactionKind', { interactionKind });

      const seriesRows = await seriesQb.getRawMany<{
        period: string | Date;
        count: string;
        word_count: string;
        char_count: string;
      }>();

      series = seriesRows.map((r) => ({
        period: r.period instanceof Date ? r.period.toISOString() : String(r.period),
        count: parseInt(r.count ?? '0', 10),
        wordCount: parseInt(r.word_count ?? '0', 10),
        charCount: parseInt(r.char_count ?? '0', 10),
      }));
    }

    return {
      totalMessages,
      totalWords,
      totalChars,
      avgWordsPerMessage,
      series,
    };
  }

  /** Query filter drops */
  async queryFilterDrops(params: {
    statisticsClientIds: string[];
    agentId?: string;
    filterType?: string;
    from?: string;
    to?: string;
    search?: string;
    limit: number;
    offset: number;
  }): Promise<{ rows: StatisticsChatFilterDropEntity[]; total: number }> {
    const { statisticsClientIds, agentId, filterType, from, to, search, limit, offset } = params;

    if (statisticsClientIds.length === 0) return { rows: [], total: 0 };

    const sanitized = sanitizeSearch(search);
    const searchPattern = sanitized ? `%${escapeIlikePattern(sanitized)}%` : undefined;
    const applyFilterDropsWhere = (qb: ReturnType<typeof this.statisticsChatFilterDrops.createQueryBuilder>) => {
      qb = qb.where('fd.statistics_client_id IN (:...ids)', { ids: statisticsClientIds });

      if (agentId) {
        qb = qb.andWhere(
          'fd.statistics_agent_id IN (SELECT id FROM statistics_agents WHERE original_agent_id = :agentId AND statistics_client_id IN (:...ids))',
          { agentId, ids: statisticsClientIds },
        );
      }

      if (filterType) qb = qb.andWhere('fd.filter_type = :filterType', { filterType });

      if (from) qb = qb.andWhere('fd.occurred_at >= :from', { from });

      if (to) qb = qb.andWhere('fd.occurred_at <= :to', { to });

      if (searchPattern) {
        qb = qb.andWhere(
          "(fd.filter_type ILIKE :search OR fd.filter_display_name ILIKE :search OR COALESCE(fd.filter_reason, '') ILIKE :search OR fd.direction::text ILIKE :search)",
          { search: searchPattern },
        );
      }

      return qb;
    };
    const countQb = applyFilterDropsWhere(this.statisticsChatFilterDrops.createQueryBuilder('fd'));
    const total = await countQb.getCount();
    const dataQb = applyFilterDropsWhere(this.statisticsChatFilterDrops.createQueryBuilder('fd'));
    const rowsPlain = await dataQb.orderBy('fd.occurred_at', 'DESC').skip(offset).take(limit).getMany();
    const rows = rowsPlain.length === 0 ? [] : await this.loadFilterDropsWithRelations(rowsPlain.map((r) => r.id));

    return { rows, total };
  }

  private async loadFilterDropsWithRelations(ids: string[]): Promise<StatisticsChatFilterDropEntity[]> {
    const entities = await this.statisticsChatFilterDrops.find({
      where: { id: In(ids) },
      relations: ['statisticsClient', 'statisticsAgent', 'statisticsUser'],
    });
    const byId = new Map(entities.map((e) => [e.id, e]));

    return ids.map((id) => byId.get(id)!).filter(Boolean);
  }

  /** Aggregate filter drops (count by filterType, direction; list unique filter types) */
  async queryFilterDropsAggregate(params: {
    statisticsClientIds: string[];
    agentId?: string;
    from?: string;
    to?: string;
  }): Promise<{
    filterDropCount: number;
    filterTypesBreakdown: { filterType: string; direction: string; count: number }[];
    uniqueFilterTypes: string[];
  }> {
    const { statisticsClientIds, agentId, from, to } = params;

    if (statisticsClientIds.length === 0) {
      return { filterDropCount: 0, filterTypesBreakdown: [], uniqueFilterTypes: [] };
    }

    let qb = this.statisticsChatFilterDrops
      .createQueryBuilder('fd')
      .where('fd.statistics_client_id IN (:...ids)', { ids: statisticsClientIds });

    if (agentId) {
      qb = qb.andWhere(
        'fd.statistics_agent_id IN (SELECT id FROM statistics_agents WHERE original_agent_id = :agentId AND statistics_client_id IN (:...ids))',
        { agentId, ids: statisticsClientIds },
      );
    }

    if (from) qb = qb.andWhere('fd.occurred_at >= :from', { from });

    if (to) qb = qb.andWhere('fd.occurred_at <= :to', { to });

    const filterDropCount = await qb.getCount();
    const breakdownQb = this.statisticsChatFilterDrops
      .createQueryBuilder('fd')
      .select('fd.filter_type', 'filterType')
      .addSelect('fd.direction', 'direction')
      .addSelect('COUNT(fd.id)', 'count')
      .where('fd.statistics_client_id IN (:...ids)', { ids: statisticsClientIds })
      .groupBy('fd.filter_type')
      .addGroupBy('fd.direction');

    if (agentId) {
      breakdownQb.andWhere(
        'fd.statistics_agent_id IN (SELECT id FROM statistics_agents WHERE original_agent_id = :agentId AND statistics_client_id IN (:...ids))',
        { agentId, ids: statisticsClientIds },
      );
    }

    if (from) breakdownQb.andWhere('fd.occurred_at >= :from', { from });

    if (to) breakdownQb.andWhere('fd.occurred_at <= :to', { to });

    const breakdownRows = await breakdownQb.getRawMany<{ filterType: string; direction: string; count: string }>();
    const filterTypesBreakdown = breakdownRows.map((r) => ({
      filterType: r.filterType,
      direction: r.direction,
      count: parseInt(r.count ?? '0', 10),
    }));
    const distinctQb = this.statisticsChatFilterDrops
      .createQueryBuilder('fd')
      .select('DISTINCT fd.filter_type', 'filterType')
      .where('fd.statistics_client_id IN (:...ids)', { ids: statisticsClientIds });

    if (agentId) {
      distinctQb.andWhere(
        'fd.statistics_agent_id IN (SELECT id FROM statistics_agents WHERE original_agent_id = :agentId AND statistics_client_id IN (:...ids))',
        { agentId, ids: statisticsClientIds },
      );
    }

    if (from) distinctQb.andWhere('fd.occurred_at >= :from', { from });

    if (to) distinctQb.andWhere('fd.occurred_at <= :to', { to });

    const distinctRows = await distinctQb.getRawMany<{ filterType: string }>();
    const uniqueFilterTypes = distinctRows.map((r) => r.filterType).filter(Boolean);

    return { filterDropCount, filterTypesBreakdown, uniqueFilterTypes };
  }

  /** Query filter flags (messages flagged/modified but not dropped) */
  async queryFilterFlags(params: {
    statisticsClientIds: string[];
    agentId?: string;
    filterType?: string;
    from?: string;
    to?: string;
    search?: string;
    limit: number;
    offset: number;
  }): Promise<{ rows: StatisticsChatFilterFlagEntity[]; total: number }> {
    const { statisticsClientIds, agentId, filterType, from, to, search, limit, offset } = params;

    if (statisticsClientIds.length === 0) return { rows: [], total: 0 };

    const sanitized = sanitizeSearch(search);
    const searchPattern = sanitized ? `%${escapeIlikePattern(sanitized)}%` : undefined;
    const applyWhere = (qb: ReturnType<typeof this.statisticsChatFilterFlags.createQueryBuilder>) => {
      qb = qb.where('ff.statistics_client_id IN (:...ids)', { ids: statisticsClientIds });

      if (agentId) {
        qb = qb.andWhere(
          'ff.statistics_agent_id IN (SELECT id FROM statistics_agents WHERE original_agent_id = :agentId AND statistics_client_id IN (:...ids))',
          { agentId, ids: statisticsClientIds },
        );
      }

      if (filterType) qb = qb.andWhere('ff.filter_type = :filterType', { filterType });

      if (from) qb = qb.andWhere('ff.occurred_at >= :from', { from });

      if (to) qb = qb.andWhere('ff.occurred_at <= :to', { to });

      if (searchPattern) {
        qb = qb.andWhere(
          "(ff.filter_type ILIKE :search OR ff.filter_display_name ILIKE :search OR COALESCE(ff.filter_reason, '') ILIKE :search OR ff.direction::text ILIKE :search)",
          { search: searchPattern },
        );
      }

      return qb;
    };
    const countQb = applyWhere(this.statisticsChatFilterFlags.createQueryBuilder('ff'));
    const total = await countQb.getCount();
    const dataQb = applyWhere(this.statisticsChatFilterFlags.createQueryBuilder('ff'));
    const rowsPlain = await dataQb.orderBy('ff.occurred_at', 'DESC').skip(offset).take(limit).getMany();
    const rows = rowsPlain.length === 0 ? [] : await this.loadFilterFlagsWithRelations(rowsPlain.map((r) => r.id));

    return { rows, total };
  }

  private async loadFilterFlagsWithRelations(ids: string[]): Promise<StatisticsChatFilterFlagEntity[]> {
    const entities = await this.statisticsChatFilterFlags.find({
      where: { id: In(ids) },
      relations: ['statisticsClient', 'statisticsAgent', 'statisticsUser'],
    });
    const byId = new Map(entities.map((e) => [e.id, e]));

    return ids.map((id) => byId.get(id)!).filter(Boolean);
  }

  /** Aggregate filter flags (count by filterType, direction; list unique filter types) */
  async queryFilterFlagsAggregate(params: {
    statisticsClientIds: string[];
    agentId?: string;
    from?: string;
    to?: string;
  }): Promise<{
    filterFlagCount: number;
    filterTypesBreakdown: { filterType: string; direction: string; count: number }[];
    uniqueFilterTypes: string[];
  }> {
    const { statisticsClientIds, agentId, from, to } = params;

    if (statisticsClientIds.length === 0) {
      return { filterFlagCount: 0, filterTypesBreakdown: [], uniqueFilterTypes: [] };
    }

    let qb = this.statisticsChatFilterFlags
      .createQueryBuilder('ff')
      .where('ff.statistics_client_id IN (:...ids)', { ids: statisticsClientIds });

    if (agentId) {
      qb = qb.andWhere(
        'ff.statistics_agent_id IN (SELECT id FROM statistics_agents WHERE original_agent_id = :agentId AND statistics_client_id IN (:...ids))',
        { agentId, ids: statisticsClientIds },
      );
    }

    if (from) qb = qb.andWhere('ff.occurred_at >= :from', { from });

    if (to) qb = qb.andWhere('ff.occurred_at <= :to', { to });

    const filterFlagCount = await qb.getCount();
    const breakdownQb = this.statisticsChatFilterFlags
      .createQueryBuilder('ff')
      .select('ff.filter_type', 'filter_type')
      .addSelect('ff.direction', 'direction')
      .addSelect('COUNT(ff.id)', 'count')
      .where('ff.statistics_client_id IN (:...ids)', { ids: statisticsClientIds })
      .groupBy('ff.filter_type')
      .addGroupBy('ff.direction');

    if (agentId) {
      breakdownQb.andWhere(
        'ff.statistics_agent_id IN (SELECT id FROM statistics_agents WHERE original_agent_id = :agentId AND statistics_client_id IN (:...ids))',
        { agentId, ids: statisticsClientIds },
      );
    }

    if (from) breakdownQb.andWhere('ff.occurred_at >= :from', { from });

    if (to) breakdownQb.andWhere('ff.occurred_at <= :to', { to });

    const breakdownRows = await breakdownQb.getRawMany<{ filter_type: string; direction: string; count: string }>();
    const filterTypesBreakdown = breakdownRows.map((r) => ({
      filterType: r.filter_type,
      direction: r.direction,
      count: parseInt(r.count ?? '0', 10),
    }));
    const distinctQb = this.statisticsChatFilterFlags
      .createQueryBuilder('ff')
      .select('DISTINCT ff.filter_type', 'filter_type')
      .where('ff.statistics_client_id IN (:...ids)', { ids: statisticsClientIds });

    if (agentId) {
      distinctQb.andWhere(
        'ff.statistics_agent_id IN (SELECT id FROM statistics_agents WHERE original_agent_id = :agentId AND statistics_client_id IN (:...ids))',
        { agentId, ids: statisticsClientIds },
      );
    }

    if (from) distinctQb.andWhere('ff.occurred_at >= :from', { from });

    if (to) distinctQb.andWhere('ff.occurred_at <= :to', { to });

    const distinctRows = await distinctQb.getRawMany<{ filter_type: string }>();
    const uniqueFilterTypes = distinctRows.map((r) => r.filter_type).filter(Boolean);

    return { filterFlagCount, filterTypesBreakdown, uniqueFilterTypes };
  }

  /** Query entity events (filter by client via related entities) */
  async queryEntityEvents(params: {
    statisticsClientIds: string[];
    entityType?: StatisticsEntityType;
    eventType?: StatisticsEntityEventType;
    from?: string;
    to?: string;
    search?: string;
    limit: number;
    offset: number;
  }): Promise<{ rows: StatisticsEntityEventEntity[]; total: number }> {
    const { statisticsClientIds, entityType, eventType, from, to, search, limit, offset } = params;

    if (statisticsClientIds.length === 0) return { rows: [], total: 0 };

    const sanitized = sanitizeSearch(search);
    const searchPattern = sanitized ? `%${escapeIlikePattern(sanitized)}%` : undefined;
    const subQs: string[] = [
      'e.statistics_clients_id IN (:...ids)',
      'e.statistics_agents_id IN (SELECT id FROM statistics_agents WHERE statistics_client_id IN (:...ids))',
      'e.statistics_client_users_id IN (SELECT id FROM statistics_client_users WHERE statistics_client_id IN (:...ids))',
      'e.statistics_provisioning_references_id IN (SELECT id FROM statistics_provisioning_references WHERE statistics_client_id IN (:...ids))',
    ];
    let qb = this.statisticsEntityEvents
      .createQueryBuilder('e')
      .where(`(${subQs.join(' OR ')})`, { ids: statisticsClientIds });

    if (entityType) qb = qb.andWhere('e.entity_type = :entityType', { entityType });

    if (eventType) qb = qb.andWhere('e.event_type = :eventType', { eventType });

    if (from) qb = qb.andWhere('e.occurred_at >= :from', { from });

    if (to) qb = qb.andWhere('e.occurred_at <= :to', { to });

    if (searchPattern) {
      qb = qb.andWhere(
        '(e.entity_type::text ILIKE :search OR e.event_type::text ILIKE :search OR e.original_entity_id::text ILIKE :search)',
        { search: searchPattern },
      );
    }

    const countQb = this.statisticsEntityEvents
      .createQueryBuilder('e')
      .where(`(${subQs.join(' OR ')})`, { ids: statisticsClientIds });

    if (entityType) countQb.andWhere('e.entity_type = :entityType', { entityType });

    if (eventType) countQb.andWhere('e.event_type = :eventType', { eventType });

    if (from) countQb.andWhere('e.occurred_at >= :from', { from });

    if (to) countQb.andWhere('e.occurred_at <= :to', { to });

    if (searchPattern) {
      countQb.andWhere(
        '(e.entity_type::text ILIKE :search OR e.event_type::text ILIKE :search OR e.original_entity_id::text ILIKE :search)',
        { search: searchPattern },
      );
    }

    const total = await countQb.getCount();
    const rowsPlain = await qb.orderBy('e.occurred_at', 'DESC').skip(offset).take(limit).getMany();
    const rows = rowsPlain.length === 0 ? [] : await this.loadEntityEventsWithRelations(rowsPlain.map((r) => r.id));

    return { rows, total };
  }

  private async loadEntityEventsWithRelations(ids: string[]): Promise<StatisticsEntityEventEntity[]> {
    const entities = await this.statisticsEntityEvents.find({
      where: { id: In(ids) },
      relations: ['statisticsUser', 'statisticsAgents', 'statisticsAgents.statisticsClient'],
    });
    const byId = new Map(entities.map((e) => [e.id, e]));

    return ids.map((id) => byId.get(id)!).filter(Boolean);
  }
}
