import { ClientUsersRepository } from '@forepath/identity/backend';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ClientAgentAutonomyEntity } from '../entities/client-agent-autonomy.entity';
import { ClientsRepository } from '../repositories/clients.repository';

import { ClientAgentAutonomyService } from './client-agent-autonomy.service';

jest.mock('@forepath/identity/backend', () => {
  const actual = jest.requireActual('@forepath/identity/backend');

  return {
    ...actual,
    ensureClientAccess: jest.fn().mockResolvedValue(undefined),
    ensureWorkspaceManagementAccess: jest.fn().mockResolvedValue(undefined),
    getUserFromRequest: jest.fn().mockReturnValue({ userId: 'user-1', userRole: 'admin', isApiKeyAuth: false }),
  };
});

describe('ClientAgentAutonomyService', () => {
  it('upsert persists autonomy fields', async () => {
    const repo = {
      create: jest.fn((row: unknown) => row),
      save: jest.fn((row: unknown) => Promise.resolve(row)),
      findOne: jest.fn(),
      find: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientAgentAutonomyService,
        { provide: getRepositoryToken(ClientAgentAutonomyEntity), useValue: repo },
        { provide: ClientsRepository, useValue: {} },
        { provide: ClientUsersRepository, useValue: {} },
      ],
    }).compile();
    const service = module.get(ClientAgentAutonomyService);
    const clientId = '00000000-0000-4000-8000-000000000010';
    const agentId = '00000000-0000-4000-8000-000000000020';

    await service.upsert(clientId, agentId, {
      enabled: true,
      preImproveTicket: false,
      maxRuntimeMs: 120_000,
      maxIterations: 5,
    });
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId,
        agentId,
        enabled: true,
        preImproveTicket: false,
        maxRuntimeMs: 120_000,
        maxIterations: 5,
      }),
    );
    await module.close();
  });

  it('listEnabledAgentIds returns enabled agent ids', async () => {
    const repo = {
      save: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([{ agentId: 'a1' }, { agentId: 'a2' }]),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientAgentAutonomyService,
        { provide: getRepositoryToken(ClientAgentAutonomyEntity), useValue: repo },
        { provide: ClientsRepository, useValue: {} },
        { provide: ClientUsersRepository, useValue: {} },
      ],
    }).compile();
    const service = module.get(ClientAgentAutonomyService);
    const res = await service.listEnabledAgentIds('00000000-0000-4000-8000-000000000010', undefined);

    expect(res).toEqual({ agentIds: ['a1', 'a2'] });
    expect(repo.find).toHaveBeenCalledWith({
      where: { clientId: '00000000-0000-4000-8000-000000000010', enabled: true },
      select: ['agentId'],
      order: { agentId: 'ASC' },
    });
    await module.close();
  });
});
