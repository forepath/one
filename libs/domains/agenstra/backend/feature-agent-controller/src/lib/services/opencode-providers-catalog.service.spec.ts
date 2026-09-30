import { Repository } from 'typeorm';

import { OpencodeProviderEntity } from '../entities/opencode-provider.entity';
import { OpencodeProvidersCatalogService } from './opencode-providers-catalog.service';

describe('OpencodeProvidersCatalogService', () => {
  let service: OpencodeProvidersCatalogService;
  let repository: {
    count: jest.Mock;
    find: jest.Mock;
    create: jest.Mock;
    upsert: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let deleteExecute: jest.Mock;

  beforeEach(() => {
    deleteExecute = jest.fn().mockResolvedValue({ affected: 1 });
    repository = {
      count: jest.fn(),
      find: jest.fn(),
      create: jest.fn((value: unknown) => value),
      upsert: jest.fn().mockResolvedValue(undefined),
      createQueryBuilder: jest.fn(() => ({
        delete: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: deleteExecute,
      })),
    };

    service = new OpencodeProvidersCatalogService(repository as unknown as Repository<OpencodeProviderEntity>);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('isEmpty_returnsTrueWhenCountZero', async () => {
    repository.count.mockResolvedValue(0);

    await expect(service.isEmpty()).resolves.toBe(true);
  });

  it('listProviders_mapsRowsOrdered', async () => {
    repository.find.mockResolvedValue([
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
    ]);

    await expect(service.listProviders()).resolves.toEqual([
      {
        id: 'anthropic',
        name: 'Anthropic',
        env: ['ANTHROPIC_API_KEY'],
        models: [{ id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' }],
        npm: '@ai-sdk/anthropic',
      },
    ]);
    expect(repository.find).toHaveBeenCalledWith({ order: { name: 'ASC', id: 'ASC' } });
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
