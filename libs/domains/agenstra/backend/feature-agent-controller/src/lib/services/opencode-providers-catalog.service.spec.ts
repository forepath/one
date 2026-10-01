import { Repository } from 'typeorm';

import { OpencodeProviderEntity } from '../entities/opencode-provider.entity';
import type { AgenstraSearchIndexService } from '../search/agenstra-search-index.service';
import { OpencodeProvidersCatalogService } from './opencode-providers-catalog.service';

describe('OpencodeProvidersCatalogService', () => {
  let service: OpencodeProvidersCatalogService;
  let repository: {
    count: jest.Mock;
    find: jest.Mock;
    findBy: jest.Mock;
    findOne: jest.Mock;
    findAndCount: jest.Mock;
    create: jest.Mock;
    upsert: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let deleteExecute: jest.Mock;
  let searchIndex: {
    isEnabled: jest.Mock;
    searchIds: jest.Mock;
    bulkUpsertSafe: jest.Mock;
    deleteSafe: jest.Mock;
  };

  beforeEach(() => {
    deleteExecute = jest.fn().mockResolvedValue({ affected: 1 });
    repository = {
      count: jest.fn(),
      find: jest.fn(),
      findBy: jest.fn(),
      findOne: jest.fn(),
      findAndCount: jest.fn(),
      create: jest.fn((value: unknown) => value),
      upsert: jest.fn().mockResolvedValue(undefined),
      createQueryBuilder: jest.fn(() => ({
        delete: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        execute: deleteExecute,
        getMany: jest.fn().mockResolvedValue([{ id: 'stale' }]),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      })),
    };
    searchIndex = {
      isEnabled: jest.fn().mockReturnValue(false),
      searchIds: jest.fn(),
      bulkUpsertSafe: jest.fn().mockResolvedValue(undefined),
      deleteSafe: jest.fn().mockResolvedValue(undefined),
    };

    service = new OpencodeProvidersCatalogService(
      repository as unknown as Repository<OpencodeProviderEntity>,
      searchIndex as unknown as AgenstraSearchIndexService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('isEmpty_returnsTrueWhenCountZero', async () => {
    repository.count.mockResolvedValue(0);

    await expect(service.isEmpty()).resolves.toBe(true);
  });

  it('listProviders_returnsPagedDtoWithoutSearch', async () => {
    repository.findAndCount.mockResolvedValue([
      [
        {
          id: 'anthropic',
          name: 'Anthropic',
          env: ['ANTHROPIC_API_KEY'],
          models: [{ id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' }],
          npm: '@ai-sdk/anthropic',
          api: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      1,
    ]);

    await expect(service.listProviders({ limit: 20, offset: 0 })).resolves.toEqual({
      providers: [
        {
          id: 'anthropic',
          name: 'Anthropic',
          env: ['ANTHROPIC_API_KEY'],
          models: [{ id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' }],
          npm: '@ai-sdk/anthropic',
        },
      ],
      total: 1,
      limit: 20,
      offset: 0,
    });
    expect(repository.findAndCount).toHaveBeenCalledWith({
      order: { name: 'ASC', id: 'ASC' },
      take: 20,
      skip: 0,
    });
  });

  it('listProviders_hydratesOpenSearchHitsInOrder', async () => {
    searchIndex.isEnabled.mockReturnValue(true);
    searchIndex.searchIds.mockResolvedValue({ ids: ['openai', 'anthropic'], total: 2 });
    repository.findBy.mockResolvedValue([
      {
        id: 'anthropic',
        name: 'Anthropic',
        env: [],
        models: [],
        npm: null,
        api: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'openai',
        name: 'OpenAI',
        env: [],
        models: [],
        npm: null,
        api: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const result = await service.listProviders({ search: 'ai', limit: 20, offset: 0 });

    expect(result.total).toBe(2);
    expect(result.providers.map((p) => p.id)).toEqual(['openai', 'anthropic']);
    expect(searchIndex.searchIds).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'opencode-providers',
        query: 'ai',
        instanceScoped: true,
        limit: 20,
        offset: 0,
      }),
    );
  });

  it('refreshFromModelsDev_upsertsAndRemovesStale', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        anthropic: {
          id: 'anthropic',
          name: 'Anthropic',
          env: ['ANTHROPIC_API_KEY'],
          npm: '@ai-sdk/anthropic',
          models: {
            'claude-haiku-4-5': { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' },
          },
        },
        openai: {
          id: 'openai',
          name: 'OpenAI',
          env: ['OPENAI_API_KEY'],
        },
      }),
    } as Response);

    const result = await service.refreshFromModelsDev();

    expect(result).toEqual({ upserted: 2, removed: 1 });
    expect(repository.upsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'anthropic',
          name: 'Anthropic',
          models: [{ id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' }],
        }),
        expect.objectContaining({ id: 'openai', name: 'OpenAI', models: [] }),
      ]),
      { conflictPaths: ['id'], skipUpdateIfNoValuesChanged: false },
    );
    expect(deleteExecute).toHaveBeenCalled();
    expect(searchIndex.bulkUpsertSafe).toHaveBeenCalledWith('opencode-providers', expect.any(Array));
    expect(searchIndex.deleteSafe).toHaveBeenCalledWith('opencode-providers', 'stale');
  });

  it('refreshFromModelsDev_throwsWhenFetchFails', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Unavailable',
    } as Response);

    await expect(service.refreshFromModelsDev()).rejects.toThrow(/503/);
    expect(repository.upsert).not.toHaveBeenCalled();
  });
});
