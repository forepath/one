import { KnowledgeRelationSourceType } from '../entities/knowledge-node.enums';

import { AutoContextResolverService } from './auto-context-resolver.service';

describe('AutoContextResolverService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.AUTO_ENRICH_ENABLED_GLOBAL;
    delete process.env.AUTO_ENRICH_VECTOR_ENABLED;
    delete process.env.AUTO_ENRICH_MAX_SECTIONS;
    delete process.env.AUTO_ENRICH_MAX_CHARS;
    delete process.env.AUTO_ENRICH_VECTOR_TOP_K;
    delete process.env.AUTO_ENRICH_VECTOR_MAX_COSINE_DISTANCE;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  function createQueryBuilderMock(rows: Array<{ knowledgeNodeId: string; chunkText: string }>) {
    return {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      setParameter: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(rows),
    };
  }

  it('uses workspace override when workspaceAutoEnrichEnabledGlobal is provided', async () => {
    process.env.AUTO_ENRICH_ENABLED_GLOBAL = 'true';
    const embeddingRepo: any = { createQueryBuilder: jest.fn() };
    const ticketsService: any = { resolveTicketIdByClientSha: jest.fn() };
    const knowledgeTreeService: any = { findNodeBySha: jest.fn(), collectPromptContextsForSource: jest.fn() };
    const localEmbeddingProvider: any = { embedMany: jest.fn() };
    const statisticsService: any = { recordAutoContextEnrichment: jest.fn() };
    const service = new AutoContextResolverService(
      embeddingRepo,
      ticketsService,
      knowledgeTreeService,
      localEmbeddingProvider,
      statisticsService,
    );

    await service.resolve({
      clientId: 'c1',
      prompt: 'x',
      contextInjection: {},
      workspaceAutoEnrichEnabledGlobal: false,
    });

    expect(localEmbeddingProvider.embedMany).not.toHaveBeenCalled();
  });

  it('returns normalized injection without enrichment when global auto enrich is disabled', async () => {
    process.env.AUTO_ENRICH_ENABLED_GLOBAL = 'false';
    const embeddingRepo: any = { createQueryBuilder: jest.fn() };
    const ticketsService: any = { resolveTicketIdByClientSha: jest.fn() };
    const knowledgeTreeService: any = { findNodeBySha: jest.fn(), collectPromptContextsForSource: jest.fn() };
    const localEmbeddingProvider: any = { embedMany: jest.fn() };
    const statisticsService: any = { recordAutoContextEnrichment: jest.fn() };
    const service = new AutoContextResolverService(
      embeddingRepo,
      ticketsService,
      knowledgeTreeService,
      localEmbeddingProvider,
      statisticsService,
    );
    const result = await service.resolve({
      clientId: 'c1',
      prompt: 'hello',
      contextInjection: { ticketShas: ['  a  ', 'a'], knowledgeShas: [' b '] },
    });

    expect(result.ticketShas).toEqual(['a']);
    expect(result.knowledgeShas).toEqual(['b']);
    expect(localEmbeddingProvider.embedMany).not.toHaveBeenCalled();
  });

  it('returns normalized injection when autoEnrichmentEnabled is false on payload', async () => {
    const embeddingRepo: any = { createQueryBuilder: jest.fn() };
    const ticketsService: any = { resolveTicketIdByClientSha: jest.fn() };
    const knowledgeTreeService: any = { findNodeBySha: jest.fn(), collectPromptContextsForSource: jest.fn() };
    const localEmbeddingProvider: any = { embedMany: jest.fn() };
    const statisticsService: any = { recordAutoContextEnrichment: jest.fn() };
    const service = new AutoContextResolverService(
      embeddingRepo,
      ticketsService,
      knowledgeTreeService,
      localEmbeddingProvider,
      statisticsService,
    );
    const result = await service.resolve({
      clientId: 'c1',
      prompt: 'x',
      contextInjection: { autoEnrichmentEnabled: false, knowledgeContexts: ['keep'] },
    });

    expect(result.knowledgeContexts).toEqual(['keep']);
    expect(localEmbeddingProvider.embedMany).not.toHaveBeenCalled();
  });

  it('merges vector and relation contexts, dedupes vector rows per node, and records statistics', async () => {
    process.env.AUTO_ENRICH_MAX_SECTIONS = '10';
    process.env.AUTO_ENRICH_MAX_CHARS = '50000';
    const qb = createQueryBuilderMock([
      { knowledgeNodeId: 'vec-node', chunkText: 'from vector' },
      { knowledgeNodeId: 'vec-node', chunkText: 'dup ignored' },
    ]);
    const embeddingRepo: any = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    };
    const ticketsService: any = {
      resolveTicketIdByClientSha: jest.fn().mockResolvedValueOnce('ticket-1'),
    };
    const knowledgeTreeService: any = {
      findNodeBySha: jest.fn().mockResolvedValue(null),
      collectPromptContextsForSource: jest.fn().mockResolvedValue({
        promptSections: ['Relation block'],
      }),
    };
    const localEmbeddingProvider: any = {
      embedMany: jest.fn().mockResolvedValue([{ vector: [0.1, 0.2] }]),
    };
    const statisticsService: any = {
      recordAutoContextEnrichment: jest.fn().mockResolvedValue(undefined),
    };
    const service = new AutoContextResolverService(
      embeddingRepo,
      ticketsService,
      knowledgeTreeService,
      localEmbeddingProvider,
      statisticsService,
    );
    const result = await service.resolve({
      clientId: 'c1',
      prompt: 'find docs',
      contextInjection: {
        ticketShas: ['tsha'],
        knowledgeContexts: ['existing'],
        environmentIds: ['11111111-1111-1111-1111-111111111111'],
      },
    });

    expect(ticketsService.resolveTicketIdByClientSha).toHaveBeenCalledWith('c1', 'tsha');
    expect(localEmbeddingProvider.embedMany).toHaveBeenCalledWith(['find docs']);
    expect(result.knowledgeContexts).toEqual(
      expect.arrayContaining(['existing', 'Relation block', 'Knowledge Page Context:\nfrom vector']),
    );
    expect(statisticsService.recordAutoContextEnrichment).toHaveBeenCalledWith(
      'c1',
      '11111111-1111-1111-1111-111111111111',
      expect.any(Number),
      expect.any(Number),
    );
    expect(knowledgeTreeService.collectPromptContextsForSource).toHaveBeenCalledWith(
      'c1',
      KnowledgeRelationSourceType.TICKET,
      'ticket-1',
    );
    expect(qb.andWhere).toHaveBeenCalledWith(
      '(embedding.embedding <=> CAST(:vector AS vector)) <= :maxCosineDistance',
      { maxCosineDistance: 1 },
    );
  });

  it('applies AUTO_ENRICH_VECTOR_MAX_COSINE_DISTANCE from env to vector query', async () => {
    process.env.AUTO_ENRICH_VECTOR_MAX_COSINE_DISTANCE = '0.4';
    const qb = createQueryBuilderMock([]);
    const embeddingRepo: any = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    };
    const ticketsService: any = { resolveTicketIdByClientSha: jest.fn() };
    const knowledgeTreeService: any = { findNodeBySha: jest.fn(), collectPromptContextsForSource: jest.fn() };
    const localEmbeddingProvider: any = {
      embedMany: jest.fn().mockResolvedValue([{ vector: [0.1, 0.2] }]),
    };
    const statisticsService: any = { recordAutoContextEnrichment: jest.fn() };
    const service = new AutoContextResolverService(
      embeddingRepo,
      ticketsService,
      knowledgeTreeService,
      localEmbeddingProvider,
      statisticsService,
    );

    await service.resolve({ clientId: 'c1', prompt: 'q', contextInjection: {} });

    expect(qb.andWhere).toHaveBeenCalledWith(
      '(embedding.embedding <=> CAST(:vector AS vector)) <= :maxCosineDistance',
      { maxCosineDistance: 0.4 },
    );
  });

  it('prefers workspaceAutoEnrichVectorMaxCosineDistance over env for vector query', async () => {
    process.env.AUTO_ENRICH_VECTOR_MAX_COSINE_DISTANCE = '0.9';
    const qb = createQueryBuilderMock([]);
    const embeddingRepo: any = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    };
    const ticketsService: any = { resolveTicketIdByClientSha: jest.fn() };
    const knowledgeTreeService: any = { findNodeBySha: jest.fn(), collectPromptContextsForSource: jest.fn() };
    const localEmbeddingProvider: any = {
      embedMany: jest.fn().mockResolvedValue([{ vector: [0.1, 0.2] }]),
    };
    const statisticsService: any = { recordAutoContextEnrichment: jest.fn() };
    const service = new AutoContextResolverService(
      embeddingRepo,
      ticketsService,
      knowledgeTreeService,
      localEmbeddingProvider,
      statisticsService,
    );

    await service.resolve({
      clientId: 'c1',
      prompt: 'q',
      contextInjection: {},
      workspaceAutoEnrichVectorMaxCosineDistance: 0.25,
    });

    expect(qb.andWhere).toHaveBeenCalledWith(
      '(embedding.embedding <=> CAST(:vector AS vector)) <= :maxCosineDistance',
      { maxCosineDistance: 0.25 },
    );
  });

  it('skips vector search when prompt is empty or whitespace', async () => {
    const embeddingRepo: any = { createQueryBuilder: jest.fn() };
    const ticketsService: any = { resolveTicketIdByClientSha: jest.fn() };
    const knowledgeTreeService: any = { findNodeBySha: jest.fn(), collectPromptContextsForSource: jest.fn() };
    const localEmbeddingProvider: any = { embedMany: jest.fn() };
    const statisticsService: any = { recordAutoContextEnrichment: jest.fn() };
    const service = new AutoContextResolverService(
      embeddingRepo,
      ticketsService,
      knowledgeTreeService,
      localEmbeddingProvider,
      statisticsService,
    );

    await service.resolve({
      clientId: 'c1',
      prompt: '   ',
      contextInjection: {},
    });

    expect(localEmbeddingProvider.embedMany).not.toHaveBeenCalled();
    expect(embeddingRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('skips vector query when embedding vector is empty', async () => {
    const embeddingRepo: any = { createQueryBuilder: jest.fn() };
    const ticketsService: any = { resolveTicketIdByClientSha: jest.fn() };
    const knowledgeTreeService: any = { findNodeBySha: jest.fn(), collectPromptContextsForSource: jest.fn() };
    const localEmbeddingProvider: any = {
      embedMany: jest.fn().mockResolvedValue([{ vector: [] }]),
    };
    const statisticsService: any = { recordAutoContextEnrichment: jest.fn() };
    const service = new AutoContextResolverService(
      embeddingRepo,
      ticketsService,
      knowledgeTreeService,
      localEmbeddingProvider,
      statisticsService,
    );

    await service.resolve({
      clientId: 'c1',
      prompt: 'hi',
      contextInjection: {},
    });

    expect(embeddingRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('returns empty vector contexts and warns when vector query fails', async () => {
    const qb = createQueryBuilderMock([]);

    qb.getMany.mockRejectedValue(new Error('pgvector missing'));
    const embeddingRepo: any = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    };
    const ticketsService: any = { resolveTicketIdByClientSha: jest.fn() };
    const knowledgeTreeService: any = { findNodeBySha: jest.fn(), collectPromptContextsForSource: jest.fn() };
    const localEmbeddingProvider: any = {
      embedMany: jest.fn().mockResolvedValue([{ vector: [1, 0] }]),
    };
    const statisticsService: any = { recordAutoContextEnrichment: jest.fn() };
    const service = new AutoContextResolverService(
      embeddingRepo,
      ticketsService,
      knowledgeTreeService,
      localEmbeddingProvider,
      statisticsService,
    );
    const warn = jest.spyOn(service['logger'], 'warn').mockImplementation();
    const result = await service.resolve({
      clientId: 'c1',
      prompt: 'q',
      contextInjection: {},
    });

    expect(result.knowledgeContexts).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('uses all-zero agent id placeholder when environmentIds missing for metrics', async () => {
    process.env.AUTO_ENRICH_MAX_SECTIONS = '5';
    const qb = createQueryBuilderMock([{ knowledgeNodeId: 'n1', chunkText: 'ctx' }]);
    const embeddingRepo: any = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    };
    const ticketsService: any = { resolveTicketIdByClientSha: jest.fn() };
    const knowledgeTreeService: any = { findNodeBySha: jest.fn(), collectPromptContextsForSource: jest.fn() };
    const localEmbeddingProvider: any = {
      embedMany: jest.fn().mockResolvedValue([{ vector: [1] }]),
    };
    const statisticsService: any = {
      recordAutoContextEnrichment: jest.fn().mockRejectedValue(new Error('db')),
    };
    const service = new AutoContextResolverService(
      embeddingRepo,
      ticketsService,
      knowledgeTreeService,
      localEmbeddingProvider,
      statisticsService,
    );

    await service.resolve({
      clientId: 'c1',
      prompt: 'p',
      contextInjection: {},
    });

    expect(statisticsService.recordAutoContextEnrichment).toHaveBeenCalledWith(
      'c1',
      '00000000-0000-0000-0000-000000000000',
      expect.any(Number),
      expect.any(Number),
    );
  });

  it('does not run vector path when AUTO_ENRICH_VECTOR_ENABLED is false', async () => {
    process.env.AUTO_ENRICH_VECTOR_ENABLED = 'false';
    const embeddingRepo: any = { createQueryBuilder: jest.fn() };
    const ticketsService: any = { resolveTicketIdByClientSha: jest.fn() };
    const knowledgeTreeService: any = { findNodeBySha: jest.fn(), collectPromptContextsForSource: jest.fn() };
    const localEmbeddingProvider: any = { embedMany: jest.fn() };
    const statisticsService: any = { recordAutoContextEnrichment: jest.fn() };
    const service = new AutoContextResolverService(
      embeddingRepo,
      ticketsService,
      knowledgeTreeService,
      localEmbeddingProvider,
      statisticsService,
    );

    await service.resolve({
      clientId: 'c1',
      prompt: 'hello',
      contextInjection: {},
    });

    expect(localEmbeddingProvider.embedMany).not.toHaveBeenCalled();
    expect(embeddingRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('respects section and character budget when combining sections', async () => {
    process.env.AUTO_ENRICH_VECTOR_ENABLED = 'false';
    process.env.AUTO_ENRICH_MAX_SECTIONS = '2';
    process.env.AUTO_ENRICH_MAX_CHARS = '25';
    const embeddingRepo: any = { createQueryBuilder: jest.fn() };
    const ticketsService: any = {
      resolveTicketIdByClientSha: jest.fn().mockResolvedValue('t1'),
    };
    const knowledgeTreeService: any = {
      findNodeBySha: jest.fn(),
      collectPromptContextsForSource: jest.fn().mockResolvedValue({
        promptSections: ['short', 'medium-length-text', 'never-included'],
      }),
    };
    const localEmbeddingProvider: any = { embedMany: jest.fn() };
    const statisticsService: any = {
      recordAutoContextEnrichment: jest.fn().mockResolvedValue(undefined),
    };
    const service = new AutoContextResolverService(
      embeddingRepo,
      ticketsService,
      knowledgeTreeService,
      localEmbeddingProvider,
      statisticsService,
    );
    const result = await service.resolve({
      clientId: 'c1',
      prompt: 'x',
      contextInjection: { ticketShas: ['x'] },
    });

    expect(result.knowledgeContexts?.length).toBeLessThanOrEqual(2);
    expect((result.knowledgeContexts ?? []).join('').length).toBeLessThanOrEqual(25);
  });

  it('skips relation expansion for knowledge sha when node is not a page', async () => {
    const embeddingRepo: any = { createQueryBuilder: jest.fn() };
    const ticketsService: any = { resolveTicketIdByClientSha: jest.fn() };
    const knowledgeTreeService: any = {
      findNodeBySha: jest.fn().mockResolvedValue({ id: 'f1', nodeType: 'folder' }),
      collectPromptContextsForSource: jest.fn(),
    };
    const localEmbeddingProvider: any = { embedMany: jest.fn() };
    const statisticsService: any = { recordAutoContextEnrichment: jest.fn() };
    const service = new AutoContextResolverService(
      embeddingRepo,
      ticketsService,
      knowledgeTreeService,
      localEmbeddingProvider,
      statisticsService,
    );

    await service.resolve({
      clientId: 'c1',
      prompt: ' ',
      contextInjection: { knowledgeShas: ['sha1'] },
    });

    expect(knowledgeTreeService.collectPromptContextsForSource).not.toHaveBeenCalled();
  });
});
