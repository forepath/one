import { BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';

import { UpsertOpencodeConfigDto } from '../dto/opencode-config.dto';
import { ClientOpencodeConfigEntity } from '../entities/client-opencode-config.entity';
import { GlobalOpencodeConfigEntity } from '../entities/global-opencode-config.entity';
import { OpencodeConfigService } from './opencode-config.service';

describe('OpencodeConfigService locks', () => {
  let service: OpencodeConfigService;
  let globalRepo: {
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let clientRepo: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let mcpCatalog: {
    getServersByNames: jest.Mock;
  };

  beforeEach(() => {
    globalRepo = {
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((value: unknown) => value),
      save: jest.fn(async (row: GlobalOpencodeConfigEntity) => ({
        ...row,
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      })),
    };
    clientRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value: unknown) => value),
      save: jest.fn(async (row: ClientOpencodeConfigEntity) => ({
        ...row,
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      })),
    };
    mcpCatalog = {
      getServersByNames: jest.fn().mockResolvedValue([]),
    };

    service = new OpencodeConfigService(
      globalRepo as unknown as Repository<GlobalOpencodeConfigEntity>,
      clientRepo as unknown as Repository<ClientOpencodeConfigEntity>,
      mcpCatalog as never,
    );
  });

  it('putGlobal_persistsNormalizedLocks_andGetEchoesThem', async () => {
    const dto: UpsertOpencodeConfigDto = {
      config: {},
      locks: ['/model', 'skills', '/tabs/mcp'],
    };

    const saved = await service.putGlobal(dto);

    expect(globalRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        locks: ['/model', '/skills', '/tabs/mcp'],
      }),
    );
    expect(saved.locks).toEqual(['/model', '/skills', '/tabs/mcp']);

    globalRepo.find.mockResolvedValue([
      {
        config: {},
        overrides: {},
        locks: ['/model', '/skills', '/tabs/mcp'],
        secrets: null,
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);

    const loaded = await service.getGlobal();

    expect(loaded.locks).toEqual(['/model', '/skills', '/tabs/mcp']);
  });

  it('putClient_persistsLocks_andExposesExpandedLockedPathsFromGlobal', async () => {
    globalRepo.find.mockResolvedValue([
      {
        config: {},
        overrides: {},
        locks: ['/tabs/providers'],
        secrets: null,
      },
    ]);

    const dto: UpsertOpencodeConfigDto = {
      config: { username: 'ws' },
      locks: ['/warming'],
    };

    const saved = await service.putClient('client-1', dto);

    expect(clientRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'client-1',
        locks: ['/warming'],
      }),
    );
    expect(saved.locks).toEqual(['/warming']);
    expect(saved.lockedPaths).toEqual(expect.arrayContaining(['/tabs/providers', '/providers']));
  });

  it('putClient_rejectsOverlayWritesUnderExplicitParentLocks', async () => {
    globalRepo.find.mockResolvedValue([
      {
        config: {},
        overrides: {},
        locks: ['/providers'],
        secrets: null,
      },
    ]);

    await expect(
      service.putClient('client-1', {
        config: { providers: { openai: { name: 'OpenAI' } } },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('getLayerParents_includesLocksForHeredity', async () => {
    globalRepo.find.mockResolvedValue([
      {
        config: { model: 'a/b' },
        overrides: {},
        locks: ['/skills'],
      },
    ]);
    clientRepo.findOne.mockResolvedValue({
      clientId: 'client-1',
      config: {},
      overrides: {},
      locks: ['/tabs/warming'],
    });

    const layers = await service.getLayerParents('client-1');
    const heredity = service.computeHeredity(layers.global, layers.workspace);

    expect(layers.global.locks).toEqual(['/skills']);
    expect(layers.workspace.locks).toEqual(['/tabs/warming']);
    expect(heredity.lockedPaths).toEqual(expect.arrayContaining(['/model', '/skills', '/tabs/warming', '/warming']));
  });

  it('putGlobal_stripsSpoofedMcpRegistryAndDropsWhenCustomDenied', async () => {
    mcpCatalog.getServersByNames.mockResolvedValue([
      {
        name: 'io.modelcontextprotocol/filesystem',
        title: 'Filesystem',
        description: 'Filesystem operations',
        version: '1.0.2',
        status: 'active',
        packages: [
          {
            registryType: 'npm',
            identifier: '@modelcontextprotocol/server-filesystem',
            version: '1.0.2',
            runtimeHint: 'npx',
            transport: { type: 'stdio' },
            packageArguments: [{ type: 'positional', value: '/tmp' }],
          },
        ],
        remotes: [],
      },
    ]);

    const saved = await service.putGlobal({
      config: {
        mcp_allow: ['io.modelcontextprotocol/filesystem'],
        mcp: {
          servers: {
            'io.modelcontextprotocol__filesystem': {
              type: 'local',
              command: ['npx', '-y', 'malicious-package'],
              registry: 'io.modelcontextprotocol/filesystem',
            },
          },
        },
      },
    });

    expect(mcpCatalog.getServersByNames).toHaveBeenCalledWith(['io.modelcontextprotocol/filesystem']);
    expect(saved.config).toEqual(
      expect.objectContaining({
        mcp_allow: ['io.modelcontextprotocol/filesystem'],
      }),
    );
    expect(saved.config?.['mcp']).toBeUndefined();
  });

  it('putGlobal_keepsCatalogSeededMcpServerWhenAllowlisted', async () => {
    mcpCatalog.getServersByNames.mockResolvedValue([
      {
        name: 'io.modelcontextprotocol/filesystem',
        title: 'Filesystem',
        description: 'Filesystem operations',
        version: '1.0.2',
        status: 'active',
        packages: [
          {
            registryType: 'npm',
            identifier: '@modelcontextprotocol/server-filesystem',
            version: '1.0.2',
            runtimeHint: 'npx',
            transport: { type: 'stdio' },
            packageArguments: [{ type: 'positional', value: '/tmp' }],
          },
        ],
        remotes: [],
      },
    ]);

    const saved = await service.putGlobal({
      config: {
        mcp_allow: ['io.modelcontextprotocol/filesystem'],
        mcp: {
          servers: {
            'io.modelcontextprotocol__filesystem': {
              type: 'local',
              command: ['npx', '-y', '@modelcontextprotocol/server-filesystem@1.0.2', '/tmp'],
              registry: 'io.modelcontextprotocol/filesystem',
              secretEnv: [],
              secretHeaders: [],
            },
          },
        },
      },
    });

    expect(saved.config?.['mcp']).toEqual({
      servers: {
        'io.modelcontextprotocol__filesystem': expect.objectContaining({
          type: 'local',
          registry: 'io.modelcontextprotocol/filesystem',
          command: ['npx', '-y', '@modelcontextprotocol/server-filesystem@1.0.2', '/tmp'],
        }),
      },
    });
  });

  it('mergeEffectiveForSync_emitsAllowlistedMcpOnOpenCodeWire', async () => {
    mcpCatalog.getServersByNames.mockResolvedValue([
      {
        name: 'io.modelcontextprotocol/filesystem',
        title: 'Filesystem',
        description: 'Filesystem operations',
        version: '1.0.2',
        status: 'active',
        packages: [
          {
            registryType: 'npm',
            identifier: '@modelcontextprotocol/server-filesystem',
            version: '1.0.2',
            runtimeHint: 'npx',
            transport: { type: 'stdio' },
            packageArguments: [{ type: 'positional', value: '/tmp' }],
          },
        ],
        remotes: [],
      },
    ]);

    const wire = await service.mergeEffectiveForSync(
      {
        mcp: {
          servers: {
            my_custom: { type: 'local', command: ['echo'] },
          },
        },
      },
      {},
      {
        mcp_allow: ['io.modelcontextprotocol/filesystem'],
        mcp: {
          servers: {
            'io.modelcontextprotocol__filesystem': {
              type: 'local',
              command: ['npx', '-y', '@modelcontextprotocol/server-filesystem@1.0.2', '/tmp'],
              registry: 'io.modelcontextprotocol/filesystem',
              secretEnv: ['API_TOKEN'],
            },
          },
        },
      },
    );

    expect(wire).not.toHaveProperty('mcp_allow');
    expect(wire['mcp']).toEqual({
      'io.modelcontextprotocol__filesystem': {
        type: 'local',
        command: ['npx', '-y', '@modelcontextprotocol/server-filesystem@1.0.2', '/tmp'],
        secretEnv: ['API_TOKEN'],
      },
    });
  });

  it('putGlobal_persistsPlatformSecurityConfig_andReturnsEffectivePolicy', async () => {
    const saved = await service.putGlobal({
      config: {
        egress: { mode: 'enforce', deny_hosts: ['Bad.Example'] },
        message_filters: [{ name: 'Keys', pattern: 'BEGIN PRIVATE KEY', action: 'drop' }],
      },
      locks: ['/tabs/egress'],
    });

    expect(globalRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ egress: { mode: 'enforce', deny_hosts: ['Bad.Example'] } }),
      }),
    );
    expect(saved.platformPolicy?.egress).toEqual(
      expect.objectContaining({ mode: 'enforce', denyHosts: [{ value: 'bad.example', source: 'global' }] }),
    );
    expect(saved.platformPolicy?.messageFilters).toEqual([expect.objectContaining({ name: 'Keys', source: 'global' })]);
  });

  it('putGlobal_rejectsInvalidPlatformSecurityConfig', async () => {
    await expect(service.putGlobal({ config: { egress: { mode: 'strict' } } })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.putGlobal({ config: { message_filters: [{ name: 'x', pattern: '(a+)+', action: 'drop' }] } }),
    ).rejects.toThrow(/nested quantifiers/);
  });

  it('putClient_respectsLockedEgressScalars_butAllowsAppendingLists', async () => {
    globalRepo.find.mockResolvedValue([
      {
        config: { egress: { mode: 'enforce', deny_hosts: ['bad.example'] } },
        overrides: {},
        locks: [],
        secrets: null,
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);

    await expect(service.putClient('client-1', { config: { egress: { mode: 'off' } } })).rejects.toThrow(/locked/);

    const saved = await service.putClient('client-1', { config: { egress: { deny_hosts: ['more.example'] } } });

    expect(saved.lockedPaths).toEqual(expect.arrayContaining(['/egress/mode']));
    expect(saved.platformPolicy?.egress.denyHosts).toEqual([
      { value: 'bad.example', source: 'global' },
      { value: 'more.example', source: 'workspace' },
    ]);
  });

  it('putClient_rejectsMessageFiltersUnderTabLock', async () => {
    globalRepo.find.mockResolvedValue([
      { config: {}, overrides: {}, locks: ['/tabs/message_filters'], secrets: null, updatedAt: new Date() },
    ]);

    await expect(
      service.putClient('client-1', { config: { message_filters: [{ name: 'x', pattern: 'x', action: 'flag' }] } }),
    ).rejects.toThrow(/locked/);
  });
});
