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

    service = new OpencodeConfigService(
      globalRepo as unknown as Repository<GlobalOpencodeConfigEntity>,
      clientRepo as unknown as Repository<ClientOpencodeConfigEntity>,
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
});
