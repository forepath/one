import { Repository } from 'typeorm';

import { OpencodeMcpServerEntity } from '../entities/opencode-mcp-server.entity';
import type { AgenstraSearchIndexService } from '../search/agenstra-search-index.service';
import { OpencodeMcpServersCatalogService } from './opencode-mcp-servers-catalog.service';

function pageResponse(servers: unknown[], nextCursor?: string): Response {
  return {
    ok: true,
    json: async () => ({
      servers,
      metadata: nextCursor ? { nextCursor, count: servers.length } : { count: servers.length },
    }),
  } as Response;
}

describe('OpencodeMcpServersCatalogService', () => {
  let service: OpencodeMcpServersCatalogService;
  let repository: {
    count: jest.Mock;
    find: jest.Mock;
    findBy: jest.Mock;
    findAndCount: jest.Mock;
    create: jest.Mock;
    upsert: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let deleteExecute: jest.Mock;
  let deleteWhere: jest.Mock;
  let searchIndex: {
    isEnabled: jest.Mock;
    searchIds: jest.Mock;
    bulkUpsertSafe: jest.Mock;
    deleteSafe: jest.Mock;
  };

  beforeEach(() => {
    deleteExecute = jest.fn().mockResolvedValue({ affected: 1 });
    deleteWhere = jest.fn().mockReturnValue({ execute: deleteExecute });
    repository = {
      count: jest.fn(),
      find: jest.fn(),
      findBy: jest.fn(),
      findAndCount: jest.fn(),
      create: jest.fn((value: unknown) => value),
      upsert: jest.fn().mockResolvedValue(undefined),
      createQueryBuilder: jest.fn(() => ({
        delete: jest.fn().mockReturnValue({
          where: deleteWhere,
        }),
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

    service = new OpencodeMcpServersCatalogService(
      repository as unknown as Repository<OpencodeMcpServerEntity>,
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

  it('listServers_returnsPagedDtoWithoutSearch', async () => {
    repository.findAndCount.mockResolvedValue([
      [
        {
          name: 'io.example/fs',
          title: 'Filesystem',
          description: 'FS ops',
          version: '1.0.0',
          status: 'active',
          websiteUrl: null,
          packages: [{ registryType: 'npm', identifier: '@ex/fs' }],
          remotes: [],
          repository: null,
          publishedAt: null,
          registryUpdatedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      1,
    ]);

    await expect(service.listServers({ limit: 20, offset: 0 })).resolves.toEqual({
      servers: [
        {
          name: 'io.example/fs',
          title: 'Filesystem',
          description: 'FS ops',
          version: '1.0.0',
          status: 'active',
          packages: [{ registryType: 'npm', identifier: '@ex/fs' }],
          remotes: [],
        },
      ],
      total: 1,
      limit: 20,
      offset: 0,
    });
    expect(repository.findAndCount).toHaveBeenCalledWith({
      order: { title: 'ASC', name: 'ASC' },
      take: 20,
      skip: 0,
    });
  });

  it('listServers_hydratesOpenSearchHitsByName', async () => {
    searchIndex.isEnabled.mockReturnValue(true);
    searchIndex.searchIds.mockResolvedValue({ ids: ['io.example/b', 'io.example/a'], total: 2 });
    repository.findBy.mockResolvedValue([
      {
        name: 'io.example/a',
        title: 'A',
        description: 'A',
        version: '1.0.0',
        status: 'active',
        websiteUrl: null,
        packages: [],
        remotes: [],
        repository: null,
        publishedAt: null,
        registryUpdatedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        name: 'io.example/b',
        title: 'B',
        description: 'B',
        version: '2.0.0',
        status: 'active',
        websiteUrl: null,
        packages: [],
        remotes: [],
        repository: null,
        publishedAt: null,
        registryUpdatedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const result = await service.listServers({ search: 'example', limit: 20, offset: 0 });

    expect(result.total).toBe(2);
    expect(result.servers.map((s) => s.name)).toEqual(['io.example/b', 'io.example/a']);
    expect(searchIndex.searchIds).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'opencode-mcp-servers',
        query: 'example',
        instanceScoped: true,
      }),
    );
  });

  it('refreshFromOfficialRegistry_walksAllCursorPagesThenDeletesStale', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        pageResponse(
          [
            {
              server: {
                name: 'io.example/a',
                title: 'A',
                description: 'Server A',
                version: '1.0.0',
                packages: [],
                remotes: [],
              },
              _meta: {
                'io.modelcontextprotocol.registry/official': { status: 'active' },
              },
            },
          ],
          'cursor-page-2',
        ),
      )
      .mockResolvedValueOnce(
        pageResponse([
          {
            server: {
              name: 'io.example/b',
              title: 'B',
              description: 'Server B',
              version: '2.0.0',
              packages: [],
              remotes: [{ type: 'sse', url: 'https://example.com/sse' }],
            },
            _meta: {
              'io.modelcontextprotocol.registry/official': { status: 'deprecated' },
            },
          },
          {
            server: {
              name: 'io.example/deleted',
              title: 'Deleted',
              description: 'Gone',
              version: '0.0.1',
              packages: [],
              remotes: [],
            },
            _meta: {
              'io.modelcontextprotocol.registry/official': { status: 'deleted' },
            },
          },
        ]),
      );

    repository.find.mockResolvedValue([{ name: 'io.example/stale' }, { name: 'io.example/a' }]);

    const result = await service.refreshFromOfficialRegistry();

    expect(result).toEqual({ upserted: 2, removed: 1, pages: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('version=latest');
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('cursor=');
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('cursor=cursor-page-2');
    expect(repository.upsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ name: 'io.example/a', status: 'active' }),
        expect.objectContaining({ name: 'io.example/b', status: 'deprecated' }),
      ]),
      { conflictPaths: ['name'], skipUpdateIfNoValuesChanged: false },
    );
    expect(repository.find).toHaveBeenCalledWith({ select: ['name'] });
    expect(deleteWhere).toHaveBeenCalledWith('name IN (:...names)', {
      names: ['io.example/stale'],
    });
    expect(deleteExecute).toHaveBeenCalled();
    expect(searchIndex.bulkUpsertSafe).toHaveBeenCalledWith('opencode-mcp-servers', expect.any(Array));
    expect(searchIndex.deleteSafe).toHaveBeenCalledWith('opencode-mcp-servers', 'io.example/stale');
  });

  it('refreshFromOfficialRegistry_doesNotUpsertWhenMidWalkFails', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        pageResponse(
          [
            {
              server: {
                name: 'io.example/a',
                title: 'A',
                description: 'A',
                version: '1.0.0',
                packages: [],
                remotes: [],
              },
            },
          ],
          'cursor-2',
        ),
      )
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Unavailable',
      } as Response);

    await expect(service.refreshFromOfficialRegistry()).rejects.toThrow(/503/);
    expect(repository.upsert).not.toHaveBeenCalled();
    expect(deleteExecute).not.toHaveBeenCalled();
  });
});
