import {
  EMBEDDING_PROVIDER_REGISTRY,
  EmbeddingProvider,
  ProviderRegistry,
} from '@forepath/agenstra/backend/util-plugin-host';

import { KnowledgeNodeType } from '../../entities/knowledge-node.enums';

import { KnowledgeEmbeddingIndexService } from './knowledge-embedding-index.service';

function createEmbeddingRegistry(provider: Partial<EmbeddingProvider>): ProviderRegistry<EmbeddingProvider> {
  const registry = {
    getProvider: jest.fn().mockReturnValue({
      getType: jest.fn().mockReturnValue('local'),
      getModelName: jest.fn().mockReturnValue('m'),
      embedMany: jest.fn().mockResolvedValue([{ vector: [1, 0] }, { vector: [0, 1] }]),
      ...provider,
    }),
  } as unknown as ProviderRegistry<EmbeddingProvider>;

  return registry;
}

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
    const embeddingProviderRegistry = createEmbeddingRegistry({});
    const service = new KnowledgeEmbeddingIndexService(knowledgeNodeRepo, embeddingRepo, embeddingProviderRegistry);

    await service.reindexPage('client-1', 'node-1', 'Title', 'Line one\n\nLine two');

    expect(embeddingRepo.delete).toHaveBeenCalledWith({ knowledgeNodeId: 'node-1' });
    expect(embeddingProviderRegistry.getProvider('local').embedMany).toHaveBeenCalled();
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
    const embeddingProviderRegistry = createEmbeddingRegistry({
      embedMany: jest.fn(),
    });
    const service = new KnowledgeEmbeddingIndexService({} as never, embeddingRepo, embeddingProviderRegistry);

    await service.reindexPage('client-1', 'node-1', '   ', '   ');

    expect(embeddingProviderRegistry.getProvider('local').embedMany).not.toHaveBeenCalled();
    expect(embeddingRepo.save).not.toHaveBeenCalled();
  });

  it('reindexPage logs and swallows embedding failures', async () => {
    const embeddingRepo: any = {
      delete: jest.fn().mockResolvedValue(undefined),
      create: jest.fn((row) => row),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const embeddingProviderRegistry = createEmbeddingRegistry({
      embedMany: jest.fn().mockRejectedValue(new Error('embed failed')),
    });
    const service = new KnowledgeEmbeddingIndexService({} as never, embeddingRepo, embeddingProviderRegistry);

    await expect(service.reindexPage('client-1', 'node-1', 'Title', 'Body')).resolves.toBeUndefined();
    expect(embeddingRepo.save).not.toHaveBeenCalled();
  });

  it('findPageIdsBatch returns mapped page rows', async () => {
    const knowledgeNodeRepo: any = {
      find: jest.fn().mockResolvedValue([{ id: 'n1', clientId: 'c1', title: 'T', content: 'C' }]),
    };
    const service = new KnowledgeEmbeddingIndexService(knowledgeNodeRepo, {} as never, createEmbeddingRegistry({}));

    const rows = await service.findPageIdsBatch(0, 10, 'c1');

    expect(rows).toEqual([{ clientId: 'c1', nodeId: 'n1', title: 'T', content: 'C' }]);
    expect(knowledgeNodeRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clientId: 'c1', nodeType: KnowledgeNodeType.PAGE },
      }),
    );
  });

  it('reindexAllPages iterates pages and returns processed count', async () => {
    const knowledgeNodeRepo: any = {
      find: jest.fn().mockResolvedValue([
        { id: 'n1', clientId: 'c1', title: 'T1', content: 'C1' },
        { id: 'n2', clientId: 'c1', title: 'T2', content: 'C2' },
      ]),
    };
    const embeddingRepo: any = {
      delete: jest.fn().mockResolvedValue(undefined),
      create: jest.fn((row) => row),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const service = new KnowledgeEmbeddingIndexService(knowledgeNodeRepo, embeddingRepo, createEmbeddingRegistry({}));

    const result = await service.reindexAllPages('c1');

    expect(result).toEqual({ processed: 2 });
    expect(embeddingRepo.delete).toHaveBeenCalledTimes(2);
  });

  it('chunks long lines into multiple rows', async () => {
    const embeddingRepo: any = {
      delete: jest.fn().mockResolvedValue(undefined),
      create: jest.fn((row) => row),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const embedMany = jest.fn().mockImplementation(async (texts: string[]) => texts.map(() => ({ vector: [1] })));
    const service = new KnowledgeEmbeddingIndexService(
      {} as never,
      embeddingRepo,
      createEmbeddingRegistry({ embedMany }),
    );

    const longLine = 'x'.repeat(120);
    await service.reindexPage('client-1', 'node-1', 'Title', longLine);

    const texts = embedMany.mock.calls[0][0] as string[];

    expect(texts.length).toBeGreaterThan(1);
  });
});
