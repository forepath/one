import { OpenSearchService } from '@forepath/shared/backend/util-opensearch';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';

import { ClientEntity } from '@forepath/identity/backend';

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

import { AgenstraSearchIndexService } from './agenstra-search-index.service';

describe('AgenstraSearchIndexService', () => {
  let service: AgenstraSearchIndexService;
  let openSearch: jest.Mocked<
    Pick<
      OpenSearchService,
      'isEnabled' | 'indexName' | 'ensureIndex' | 'indexDocument' | 'deleteDocument' | 'bulkUpsert' | 'search'
    >
  >;

  beforeEach(async () => {
    openSearch = {
      isEnabled: jest.fn().mockReturnValue(true),
      indexName: jest.fn((entity: string) => `agenstra-${entity}`),
      ensureIndex: jest.fn().mockResolvedValue(undefined),
      indexDocument: jest.fn().mockResolvedValue(undefined),
      deleteDocument: jest.fn().mockResolvedValue(undefined),
      bulkUpsert: jest.fn().mockResolvedValue(undefined),
      search: jest.fn().mockResolvedValue({ hits: [{ id: 'doc-1', score: 1, source: {} }], total: 1 }),
    };

    const emptyRepo = {
      find: jest.fn().mockResolvedValue([]),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgenstraSearchIndexService,
        { provide: OpenSearchService, useValue: openSearch },
        { provide: getRepositoryToken(ClientEntity), useValue: emptyRepo },
        { provide: getRepositoryToken(TicketEntity), useValue: emptyRepo },
        { provide: getRepositoryToken(KnowledgeNodeEntity), useValue: emptyRepo },
        { provide: getRepositoryToken(AgentConsoleRegexFilterRuleEntity), useValue: emptyRepo },
        { provide: getRepositoryToken(AtlassianSiteConnectionEntity), useValue: emptyRepo },
        { provide: getRepositoryToken(ExternalImportConfigEntity), useValue: emptyRepo },
        { provide: getRepositoryToken(StatisticsAgentEntity), useValue: emptyRepo },
        { provide: getRepositoryToken(StatisticsClientEntity), useValue: emptyRepo },
        { provide: getRepositoryToken(StatisticsChatIoEntity), useValue: emptyRepo },
        { provide: getRepositoryToken(StatisticsChatFilterDropEntity), useValue: emptyRepo },
        { provide: getRepositoryToken(StatisticsChatFilterFlagEntity), useValue: emptyRepo },
        { provide: getRepositoryToken(StatisticsEntityEventEntity), useValue: emptyRepo },
        { provide: getRepositoryToken(StatisticsUserEntity), useValue: emptyRepo },
        { provide: getRepositoryToken(OpencodeProviderEntity), useValue: emptyRepo },
        { provide: getRepositoryToken(OpencodeMcpServerEntity), useValue: emptyRepo },
      ],
    }).compile();

    service = module.get(AgenstraSearchIndexService);
  });

  it('searchIds_WithoutClientScope_ReturnsEmpty', async () => {
    const result = await service.searchIds({
      entityType: 'tickets',
      query: 'hello',
      clientIds: [],
    });

    expect(result).toEqual({ ids: [], total: 0 });
    expect(openSearch.search).not.toHaveBeenCalled();
  });

  it('searchIds_WithClientId_AppliesClientFilter', async () => {
    const result = await service.searchIds({
      entityType: 'tickets',
      query: 'hello',
      clientIds: 'client-1',
      limit: 10,
      offset: 0,
    });

    expect(result.ids).toEqual(['doc-1']);
    expect(openSearch.ensureIndex).toHaveBeenCalledWith(
      'agenstra-tickets',
      expect.objectContaining({ properties: expect.any(Object) }),
    );
    expect(openSearch.search).toHaveBeenCalledWith(
      expect.objectContaining({
        index: 'agenstra-tickets',
        query: 'hello',
        filters: expect.objectContaining({ clientId: 'client-1' }),
      }),
    );
  });

  it('searchIds_WhenDisabled_ReturnsEmpty', async () => {
    openSearch.isEnabled.mockReturnValue(false);

    const result = await service.searchIds({
      entityType: 'tickets',
      query: 'hello',
      clientIds: 'client-1',
    });

    expect(result).toEqual({ ids: [], total: 0 });
    expect(openSearch.search).not.toHaveBeenCalled();
  });

  it('upsert_IndexesDocumentWithEntityType', async () => {
    await service.upsert('clients', {
      id: 'c1',
      entityType: 'clients',
      clientId: 'c1',
      name: 'Acme',
    });

    expect(openSearch.indexDocument).toHaveBeenCalledWith(
      'agenstra-clients',
      'c1',
      expect.objectContaining({ id: 'c1', entityType: 'clients', name: 'Acme' }),
    );
  });
});
