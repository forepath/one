import { ClientEntity } from '@forepath/identity/backend';
import { OpenSearchService } from '@forepath/shared/backend/util-opensearch';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { AgentConsoleRegexFilterRuleEntity } from '../entities/agent-console-regex-filter-rule.entity';
import { AtlassianSiteConnectionEntity } from '../entities/atlassian-site-connection.entity';
import { ExternalImportConfigEntity } from '../entities/external-import-config.entity';
import { KnowledgeNodeEntity } from '../entities/knowledge-node.entity';
import { OpencodeMcpServerEntity } from '../entities/opencode-mcp-server.entity';
import { OpencodeProviderEntity } from '../entities/opencode-provider.entity';
import { StatisticsAgentEntity } from '../entities/statistics-agent.entity';
import { StatisticsChatFilterDropEntity } from '../entities/statistics-chat-filter-drop.entity';
import { StatisticsChatFilterFlagEntity } from '../entities/statistics-chat-filter-flag.entity';
import { StatisticsChatIoEntity } from '../entities/statistics-chat-io.entity';
import { StatisticsClientEntity } from '../entities/statistics-client.entity';
import { StatisticsEntityEventEntity } from '../entities/statistics-entity-event.entity';
import { StatisticsUserEntity } from '../entities/statistics-user.entity';
import { TicketEntity } from '../entities/ticket.entity';

import {
  isAgenstraSearchEntityType,
  mapAgentToSearchDocument,
  mapAtlassianConnectionToSearchDocument,
  mapChatIoToSearchDocument,
  mapClientToSearchDocument,
  mapEntityEventToSearchDocument,
  mapFilterDropToSearchDocument,
  mapFilterFlagToSearchDocument,
  mapFilterRuleToSearchDocument,
  mapImportConfigToSearchDocument,
  mapKnowledgeNodeToSearchDocument,
  mapOpencodeMcpServerToSearchDocument,
  mapOpencodeProviderToSearchDocument,
  mapTicketToSearchDocument,
  mapUserToSearchDocument,
} from './agenstra-search-document.mapper';
import {
  AGENSTRA_SEARCH_ENTITY_TYPES,
  AGENSTRA_SEARCH_INDEX_MAPPINGS,
  AGENSTRA_SEARCH_TEXT_FIELDS,
  type AgenstraReindexBatchResult,
  type AgenstraSearchDocument,
  type AgenstraSearchEntityType,
  type AgenstraSearchIdsParams,
  type AgenstraSearchIdsResult,
} from './agenstra-search.types';

@Injectable()
export class AgenstraSearchIndexService {
  private readonly logger = new Logger(AgenstraSearchIndexService.name);
  private readonly ensuredIndexes = new Set<string>();

  constructor(
    private readonly openSearch: OpenSearchService,
    @InjectRepository(ClientEntity)
    private readonly clientsRepo: Repository<ClientEntity>,
    @InjectRepository(TicketEntity)
    private readonly ticketsRepo: Repository<TicketEntity>,
    @InjectRepository(KnowledgeNodeEntity)
    private readonly knowledgeNodesRepo: Repository<KnowledgeNodeEntity>,
    @InjectRepository(AgentConsoleRegexFilterRuleEntity)
    private readonly filterRulesRepo: Repository<AgentConsoleRegexFilterRuleEntity>,
    @InjectRepository(AtlassianSiteConnectionEntity)
    private readonly atlassianConnectionsRepo: Repository<AtlassianSiteConnectionEntity>,
    @InjectRepository(ExternalImportConfigEntity)
    private readonly importConfigsRepo: Repository<ExternalImportConfigEntity>,
    @InjectRepository(StatisticsAgentEntity)
    private readonly statisticsAgentsRepo: Repository<StatisticsAgentEntity>,
    @InjectRepository(StatisticsClientEntity)
    private readonly statisticsClientsRepo: Repository<StatisticsClientEntity>,
    @InjectRepository(StatisticsChatIoEntity)
    private readonly chatIoRepo: Repository<StatisticsChatIoEntity>,
    @InjectRepository(StatisticsChatFilterDropEntity)
    private readonly filterDropsRepo: Repository<StatisticsChatFilterDropEntity>,
    @InjectRepository(StatisticsChatFilterFlagEntity)
    private readonly filterFlagsRepo: Repository<StatisticsChatFilterFlagEntity>,
    @InjectRepository(StatisticsEntityEventEntity)
    private readonly entityEventsRepo: Repository<StatisticsEntityEventEntity>,
    @InjectRepository(StatisticsUserEntity)
    private readonly statisticsUsersRepo: Repository<StatisticsUserEntity>,
    @InjectRepository(OpencodeProviderEntity)
    private readonly opencodeProvidersRepo: Repository<OpencodeProviderEntity>,
    @InjectRepository(OpencodeMcpServerEntity)
    private readonly opencodeMcpServersRepo: Repository<OpencodeMcpServerEntity>,
  ) {}

  isEnabled(): boolean {
    return this.openSearch.isEnabled();
  }

  listEntityTypes(): readonly AgenstraSearchEntityType[] {
    return AGENSTRA_SEARCH_ENTITY_TYPES;
  }

  async upsert(entityType: AgenstraSearchEntityType, document: AgenstraSearchDocument): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    const index = await this.ensureEntityIndex(entityType);

    await this.openSearch.indexDocument(index, document.id, {
      ...document,
      entityType,
    });
  }

  async delete(entityType: AgenstraSearchEntityType, id: string): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    const index = await this.ensureEntityIndex(entityType);

    await this.openSearch.deleteDocument(index, id);
  }

  async upsertSafe(entityType: AgenstraSearchEntityType, document: AgenstraSearchDocument): Promise<void> {
    try {
      await this.upsert(entityType, document);
    } catch (error) {
      this.logger.warn(`Search upsert failed for ${entityType}/${document.id}: ${(error as Error).message}`);
    }
  }

  async deleteSafe(entityType: AgenstraSearchEntityType, id: string): Promise<void> {
    try {
      await this.delete(entityType, id);
    } catch (error) {
      this.logger.warn(`Search delete failed for ${entityType}/${id}: ${(error as Error).message}`);
    }
  }

  /** Bulk upsert documents; chunks to keep OpenSearch payloads bounded. */
  async bulkUpsertSafe(entityType: AgenstraSearchEntityType, documents: AgenstraSearchDocument[]): Promise<void> {
    if (!this.isEnabled() || documents.length === 0) {
      return;
    }

    const chunkSize = 500;

    try {
      for (let offset = 0; offset < documents.length; offset += chunkSize) {
        await this.bulkIndex(entityType, documents.slice(offset, offset + chunkSize));
      }
    } catch (error) {
      this.logger.warn(`Search bulk upsert failed for ${entityType}: ${(error as Error).message}`);
    }
  }

  async searchIds(params: AgenstraSearchIdsParams): Promise<AgenstraSearchIdsResult> {
    if (!this.isEnabled()) {
      return { ids: [], total: 0 };
    }

    const clientIds = this.normalizeClientIds(params.clientIds);

    if (!params.instanceScoped && clientIds.length === 0) {
      return { ids: [], total: 0 };
    }

    const index = await this.ensureEntityIndex(params.entityType);
    const filters: Record<string, string | string[] | number | boolean | null | undefined> = {
      ...(params.additionalFilters ?? {}),
    };

    if (params.instanceScoped) {
      filters.instanceScoped = true;
    } else if (clientIds.length === 1) {
      filters.clientId = clientIds[0];
    } else {
      filters.clientId = clientIds;
    }

    try {
      const result = await this.openSearch.search({
        index,
        query: params.query,
        fields: [...AGENSTRA_SEARCH_TEXT_FIELDS],
        filters,
        from: params.offset,
        size: params.limit,
      });

      return {
        ids: result.hits.map((hit) => hit.id).filter((id) => id.length > 0),
        total: result.total,
      };
    } catch (error) {
      this.logger.warn(`Search query failed for ${params.entityType}: ${(error as Error).message}`);
      throw error;
    }
  }

  async reindexBatch(
    entityType: AgenstraSearchEntityType | string,
    offset: number,
    limit: number,
  ): Promise<AgenstraReindexBatchResult> {
    if (!isAgenstraSearchEntityType(entityType)) {
      return { indexed: 0, hasMore: false };
    }

    if (!this.isEnabled()) {
      return { indexed: 0, hasMore: false };
    }

    await this.ensureEntityIndex(entityType);

    switch (entityType) {
      case 'clients':
        return await this.reindexClients(offset, limit);
      case 'agents':
        return await this.reindexAgents(offset, limit);
      case 'tickets':
        return await this.reindexTickets(offset, limit);
      case 'knowledge-nodes':
        return await this.reindexKnowledgeNodes(offset, limit);
      case 'filter-rules':
        return await this.reindexFilterRules(offset, limit);
      case 'chat-io':
        return await this.reindexChatIo(offset, limit);
      case 'filter-drops':
        return await this.reindexFilterDrops(offset, limit);
      case 'filter-flags':
        return await this.reindexFilterFlags(offset, limit);
      case 'entity-events':
        return await this.reindexEntityEvents(offset, limit);
      case 'atlassian-connections':
        return await this.reindexAtlassianConnections(offset, limit);
      case 'import-configs':
        return await this.reindexImportConfigs(offset, limit);
      case 'users':
        return await this.reindexUsers(offset, limit);
      case 'opencode-providers':
        return await this.reindexOpencodeProviders(offset, limit);
      case 'opencode-mcp-servers':
        return await this.reindexOpencodeMcpServers(offset, limit);
      case 'deployment-runs':
      case 'environments':
        // Proxied to agent-manager; live hooks index when available.
        return { indexed: 0, hasMore: false };
      default:
        return { indexed: 0, hasMore: false };
    }
  }

  private async ensureEntityIndex(entityType: AgenstraSearchEntityType): Promise<string> {
    const index = this.openSearch.indexName(entityType);

    if (!this.ensuredIndexes.has(index)) {
      await this.openSearch.ensureIndex(index, AGENSTRA_SEARCH_INDEX_MAPPINGS);
      this.ensuredIndexes.add(index);
    }

    return index;
  }

  private normalizeClientIds(clientIds?: string | string[] | null): string[] {
    if (!clientIds) {
      return [];
    }

    const values = Array.isArray(clientIds) ? clientIds : [clientIds];

    return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
  }

  private async bulkIndex(entityType: AgenstraSearchEntityType, documents: AgenstraSearchDocument[]): Promise<void> {
    if (documents.length === 0) {
      return;
    }

    const index = await this.ensureEntityIndex(entityType);

    await this.openSearch.bulkUpsert(
      index,
      documents.map((document) => ({
        id: document.id,
        document: { ...document, entityType },
      })),
    );
  }

  private async originalClientIdMap(statisticsClientIds: string[]): Promise<Map<string, string>> {
    if (statisticsClientIds.length === 0) {
      return new Map();
    }

    const rows = await this.statisticsClientsRepo.find({
      where: { id: In(statisticsClientIds) },
      select: ['id', 'originalClientId'],
    });

    return new Map(rows.map((row) => [row.id, row.originalClientId]));
  }

  private async reindexClients(offset: number, limit: number): Promise<AgenstraReindexBatchResult> {
    const rows = await this.clientsRepo.find({
      order: { createdAt: 'ASC' },
      skip: offset,
      take: limit,
    });

    await this.bulkIndex(
      'clients',
      rows.map((row) => mapClientToSearchDocument(row)),
    );

    return { indexed: rows.length, hasMore: rows.length === limit };
  }

  private async reindexAgents(offset: number, limit: number): Promise<AgenstraReindexBatchResult> {
    const rows = await this.statisticsAgentsRepo.find({
      order: { createdAt: 'ASC' },
      skip: offset,
      take: limit,
    });
    const clientMap = await this.originalClientIdMap(rows.map((row) => row.statisticsClientId));
    const documents = rows
      .map((row) => {
        const originalClientId = clientMap.get(row.statisticsClientId);

        return originalClientId ? mapAgentToSearchDocument(row, originalClientId) : null;
      })
      .filter((document): document is AgenstraSearchDocument => document !== null);

    await this.bulkIndex('agents', documents);

    return { indexed: rows.length, hasMore: rows.length === limit };
  }

  private async reindexTickets(offset: number, limit: number): Promise<AgenstraReindexBatchResult> {
    const rows = await this.ticketsRepo.find({
      order: { createdAt: 'ASC' },
      skip: offset,
      take: limit,
    });

    await this.bulkIndex(
      'tickets',
      rows.map((row) => mapTicketToSearchDocument(row)),
    );

    return { indexed: rows.length, hasMore: rows.length === limit };
  }

  private async reindexKnowledgeNodes(offset: number, limit: number): Promise<AgenstraReindexBatchResult> {
    const rows = await this.knowledgeNodesRepo.find({
      order: { createdAt: 'ASC' },
      skip: offset,
      take: limit,
    });

    await this.bulkIndex(
      'knowledge-nodes',
      rows.map((row) => mapKnowledgeNodeToSearchDocument(row)),
    );

    return { indexed: rows.length, hasMore: rows.length === limit };
  }

  private async reindexFilterRules(offset: number, limit: number): Promise<AgenstraReindexBatchResult> {
    const rows = await this.filterRulesRepo.find({
      order: { createdAt: 'ASC' },
      skip: offset,
      take: limit,
      relations: { clientLinks: true },
    });
    const documents = rows.map((row) =>
      mapFilterRuleToSearchDocument(
        row,
        (row.clientLinks ?? []).map((link) => link.clientId),
      ),
    );

    await this.bulkIndex('filter-rules', documents);

    return { indexed: rows.length, hasMore: rows.length === limit };
  }

  private async reindexChatIo(offset: number, limit: number): Promise<AgenstraReindexBatchResult> {
    const rows = await this.chatIoRepo.find({
      order: { occurredAt: 'ASC' },
      skip: offset,
      take: limit,
    });
    const clientMap = await this.originalClientIdMap(rows.map((row) => row.statisticsClientId));
    const documents = rows
      .map((row) => {
        const originalClientId = clientMap.get(row.statisticsClientId);

        return originalClientId ? mapChatIoToSearchDocument(row, originalClientId) : null;
      })
      .filter((document): document is AgenstraSearchDocument => document !== null);

    await this.bulkIndex('chat-io', documents);

    return { indexed: rows.length, hasMore: rows.length === limit };
  }

  private async reindexFilterDrops(offset: number, limit: number): Promise<AgenstraReindexBatchResult> {
    const rows = await this.filterDropsRepo.find({
      order: { occurredAt: 'ASC' },
      skip: offset,
      take: limit,
    });
    const clientMap = await this.originalClientIdMap(rows.map((row) => row.statisticsClientId));
    const documents = rows
      .map((row) => {
        const originalClientId = clientMap.get(row.statisticsClientId);

        return originalClientId ? mapFilterDropToSearchDocument(row, originalClientId) : null;
      })
      .filter((document): document is AgenstraSearchDocument => document !== null);

    await this.bulkIndex('filter-drops', documents);

    return { indexed: rows.length, hasMore: rows.length === limit };
  }

  private async reindexFilterFlags(offset: number, limit: number): Promise<AgenstraReindexBatchResult> {
    const rows = await this.filterFlagsRepo.find({
      order: { occurredAt: 'ASC' },
      skip: offset,
      take: limit,
    });
    const clientMap = await this.originalClientIdMap(rows.map((row) => row.statisticsClientId));
    const documents = rows
      .map((row) => {
        const originalClientId = clientMap.get(row.statisticsClientId);

        return originalClientId ? mapFilterFlagToSearchDocument(row, originalClientId) : null;
      })
      .filter((document): document is AgenstraSearchDocument => document !== null);

    await this.bulkIndex('filter-flags', documents);

    return { indexed: rows.length, hasMore: rows.length === limit };
  }

  private async reindexEntityEvents(offset: number, limit: number): Promise<AgenstraReindexBatchResult> {
    const rows = await this.entityEventsRepo.find({
      order: { occurredAt: 'ASC' },
      skip: offset,
      take: limit,
    });
    const statisticsClientIds = rows.map((row) => row.statisticsClientsId).filter((id): id is string => Boolean(id));
    const clientMap = await this.originalClientIdMap(statisticsClientIds);
    const documents = rows.map((row) =>
      mapEntityEventToSearchDocument(
        row,
        row.statisticsClientsId ? (clientMap.get(row.statisticsClientsId) ?? null) : null,
      ),
    );

    await this.bulkIndex('entity-events', documents);

    return { indexed: rows.length, hasMore: rows.length === limit };
  }

  private async reindexAtlassianConnections(offset: number, limit: number): Promise<AgenstraReindexBatchResult> {
    const rows = await this.atlassianConnectionsRepo.find({
      order: { createdAt: 'ASC' },
      skip: offset,
      take: limit,
    });

    await this.bulkIndex(
      'atlassian-connections',
      rows.map((row) => mapAtlassianConnectionToSearchDocument(row)),
    );

    return { indexed: rows.length, hasMore: rows.length === limit };
  }

  private async reindexImportConfigs(offset: number, limit: number): Promise<AgenstraReindexBatchResult> {
    const rows = await this.importConfigsRepo.find({
      order: { createdAt: 'ASC' },
      skip: offset,
      take: limit,
    });

    await this.bulkIndex(
      'import-configs',
      rows.map((row) => mapImportConfigToSearchDocument(row)),
    );

    return { indexed: rows.length, hasMore: rows.length === limit };
  }

  private async reindexUsers(offset: number, limit: number): Promise<AgenstraReindexBatchResult> {
    const rows = await this.statisticsUsersRepo.find({
      order: { createdAt: 'ASC' },
      skip: offset,
      take: limit,
    });

    await this.bulkIndex(
      'users',
      rows.map((row) => mapUserToSearchDocument(row)),
    );

    return { indexed: rows.length, hasMore: rows.length === limit };
  }

  private async reindexOpencodeProviders(offset: number, limit: number): Promise<AgenstraReindexBatchResult> {
    const rows = await this.opencodeProvidersRepo.find({
      order: { id: 'ASC' },
      skip: offset,
      take: limit,
    });

    await this.bulkIndex(
      'opencode-providers',
      rows.map((row) => mapOpencodeProviderToSearchDocument(row)),
    );

    return { indexed: rows.length, hasMore: rows.length === limit };
  }

  private async reindexOpencodeMcpServers(offset: number, limit: number): Promise<AgenstraReindexBatchResult> {
    const rows = await this.opencodeMcpServersRepo.find({
      order: { name: 'ASC' },
      skip: offset,
      take: limit,
    });

    await this.bulkIndex(
      'opencode-mcp-servers',
      rows.map((row) => mapOpencodeMcpServerToSearchDocument(row)),
    );

    return { indexed: rows.length, hasMore: rows.length === limit };
  }
}
