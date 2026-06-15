import { KnowledgeNodeType } from '../../entities/knowledge-node.enums';

import { KnowledgeEmbeddingIndexService } from './knowledge-embedding-index.service';

describe('KnowledgeEmbeddingIndexService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.EMBEDDING_CHUNK_MAX_CHARS = '50';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('reindexPage deletes existing rows then saves embeddings for chunks', async () => {
    const knowledgeNodeRepo = {} as never;
    const embeddingRepo: any = {
      delete: jest.fn().mockResolvedValue(undefined),
      create: jest.fn((row) => row),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const localEmbeddingProvider: any = {
      embedMany: jest.fn().mockResolvedValue([{ vector: [1, 0] }, { vector: [0, 1] }]),
      getModelName: jest.fn().mockReturnValue('m'),
      getProviderName: jest.fn().mockReturnValue('local'),
    };
    const service = new KnowledgeEmbeddingIndexService(knowledgeNodeRepo, embeddingRepo, localEmbeddingProvider);

    await service.reindexPage('client-1', 'node-1', 'Title', 'Line one\n\nLine two');

    expect(embeddingRepo.delete).toHaveBeenCalledWith({ knowledgeNodeId: 'node-1' });
    expect(localEmbeddingProvider.embedMany).toHaveBeenCalled();
    expect(embeddingRepo.save).toHaveBeenCalledTimes(1);
    const saved = embeddingRepo.save.mock.calls[0][0] as Array<Record<string, unknown>>;

    expect(saved.length).toBeGreaterThanOrEqual(1);
    expect(saved[0].clientId).toBe('client-1');
    expect(saved[0].knowledgeNodeId).toBe('node-1');
    expect(typeof saved[0].contentHash).toBe('string');
  });

  it('reindexPage returns early when there is no textual content after chunking', async () => {
    const embeddingRepo: any = {
      delete: jest.fn().mockResolvedValue(undefined),
      create: jest.fn(),
      save: jest.fn(),
    };
    const localEmbeddingProvider: any = {
      embedMany: jest.fn(),
    };
    const service = new KnowledgeEmbeddingIndexService({} as never, embeddingRepo, localEmbeddingProvider);

    await service.reindexPage('c', 'n', '   ', '');

    expect(localEmbeddingProvider.embedMany).not.toHaveBeenCalled();
    expect(embeddingRepo.save).not.toHaveBeenCalled();
  });

  it('reindexPage logs and swallows embedding provider errors', async () => {
    const embeddingRepo: any = {
      delete: jest.fn().mockResolvedValue(undefined),
      create: jest.fn((row) => row),
      save: jest.fn(),
    };
    const localEmbeddingProvider: any = {
      embedMany: jest.fn().mockRejectedValue(new Error('embed down')),
      getModelName: jest.fn().mockReturnValue('m'),
      getProviderName: jest.fn().mockReturnValue('local'),
    };
    const service = new KnowledgeEmbeddingIndexService({} as never, embeddingRepo, localEmbeddingProvider);
    const warn = jest.spyOn(service['logger'], 'warn').mockImplementation();

    await expect(service.reindexPage('c', 'n', 'T', 'body')).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('deleteForNode deletes by knowledge node id', async () => {
    const embeddingRepo: any = {
      delete: jest.fn().mockResolvedValue(undefined),
    };
    const service = new KnowledgeEmbeddingIndexService({} as never, embeddingRepo, {} as never);

    await service.deleteForNode('nid');

    expect(embeddingRepo.delete).toHaveBeenCalledWith({ knowledgeNodeId: 'nid' });
  });

  it('reindexAllPages loads pages and reindexes each', async () => {
    const pages = [
      { id: 'p1', clientId: 'c1', title: 'A', content: 'one' },
      { id: 'p2', clientId: 'c2', title: 'B', content: 'two' },
    ];
    const knowledgeNodeRepo: any = {
      find: jest.fn().mockResolvedValue(pages),
    };
    const embeddingRepo: any = {
      delete: jest.fn().mockResolvedValue(undefined),
      create: jest.fn((row) => row),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const localEmbeddingProvider: any = {
      embedMany: jest.fn().mockResolvedValue([{ vector: [1] }]),
      getModelName: jest.fn().mockReturnValue('m'),
      getProviderName: jest.fn().mockReturnValue('local'),
    };
    const service = new KnowledgeEmbeddingIndexService(knowledgeNodeRepo, embeddingRepo, localEmbeddingProvider);
    const reindexSpy = jest.spyOn(service, 'reindexPage').mockResolvedValue(undefined);
    const result = await service.reindexAllPages();

    expect(result.processed).toBe(2);
    expect(reindexSpy).toHaveBeenCalledWith('c1', 'p1', 'A', 'one');
    expect(reindexSpy).toHaveBeenCalledWith('c2', 'p2', 'B', 'two');

    await service.reindexAllPages('c1');

    expect(knowledgeNodeRepo.find).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { clientId: 'c1', nodeType: KnowledgeNodeType.PAGE },
      }),
    );

    reindexSpy.mockRestore();
  });

  it('findPageIdsBatch maps pages with empty content fallback', async () => {
    const pages = [
      { id: 'p1', clientId: 'c1', title: 'A', content: 'one' },
      { id: 'p2', clientId: 'c2', title: 'B', content: null },
    ];
    const knowledgeNodeRepo: any = {
      find: jest.fn().mockResolvedValue(pages),
    };
    const service = new KnowledgeEmbeddingIndexService(knowledgeNodeRepo, {} as never, {} as never);

    await expect(service.findPageIdsBatch(5, 10)).resolves.toEqual([
      { clientId: 'c1', nodeId: 'p1', title: 'A', content: 'one' },
      { clientId: 'c2', nodeId: 'p2', title: 'B', content: '' },
    ]);

    expect(knowledgeNodeRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { nodeType: KnowledgeNodeType.PAGE },
        skip: 5,
        take: 10,
      }),
    );

    await service.findPageIdsBatch(0, 5, 'c1');

    expect(knowledgeNodeRepo.find).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { clientId: 'c1', nodeType: KnowledgeNodeType.PAGE },
      }),
    );
  });

  it('splits long lines into multiple chunks when line exceeds chunk max', async () => {
    process.env.EMBEDDING_CHUNK_MAX_CHARS = '10';
    const embeddingRepo: any = {
      delete: jest.fn().mockResolvedValue(undefined),
      create: jest.fn((row) => row),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const localEmbeddingProvider: any = {
      embedMany: jest.fn().mockImplementation((texts: string[]) => texts.map(() => ({ vector: [1] }))),
      getModelName: jest.fn().mockReturnValue('m'),
      getProviderName: jest.fn().mockReturnValue('local'),
    };
    const service = new KnowledgeEmbeddingIndexService({} as never, embeddingRepo, localEmbeddingProvider);
    const longLine = 'abcdefghijklmnop';

    await service.reindexPage('c', 'n', 't', longLine);

    const texts = localEmbeddingProvider.embedMany.mock.calls[0][0] as string[];

    expect(texts.length).toBeGreaterThanOrEqual(2);
  });
});
