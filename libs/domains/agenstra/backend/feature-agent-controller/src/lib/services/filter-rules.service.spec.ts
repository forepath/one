import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AgentConsoleRegexFilterRuleClientEntity } from '../entities/agent-console-regex-filter-rule-client.entity';
import { AgentConsoleRegexFilterRuleSyncTargetEntity } from '../entities/agent-console-regex-filter-rule-sync-target.entity';
import { AgentConsoleRegexFilterRuleEntity } from '../entities/agent-console-regex-filter-rule.entity';
import { ClientsRepository } from '../repositories/clients.repository';

import { AgentManagerFilterRulesClientService } from './agent-manager-filter-rules-client.service';
import { FilterRulesService } from './filter-rules.service';

describe('FilterRulesService', () => {
  const rulesRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
  };
  const linksRepo = { save: jest.fn(), delete: jest.fn() };
  const targetsRepo = {
    find: jest.fn().mockResolvedValue([]),
    save: jest.fn(),
    createQueryBuilder: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    }),
  };
  const clientsRepository = { findAllIds: jest.fn().mockResolvedValue(['c1']), findByIdOrThrow: jest.fn() };
  const amClient = { deleteRule: jest.fn().mockResolvedValue(undefined) };
  let service: FilterRulesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const m = await Test.createTestingModule({
      providers: [
        FilterRulesService,
        { provide: getRepositoryToken(AgentConsoleRegexFilterRuleEntity), useValue: rulesRepo },
        { provide: getRepositoryToken(AgentConsoleRegexFilterRuleClientEntity), useValue: linksRepo },
        { provide: getRepositoryToken(AgentConsoleRegexFilterRuleSyncTargetEntity), useValue: targetsRepo },
        { provide: ClientsRepository, useValue: clientsRepository },
        { provide: AgentManagerFilterRulesClientService, useValue: amClient },
      ],
    }).compile();

    service = m.get(FilterRulesService);
  });

  it('create rejects non-global without workspaceIds', async () => {
    await expect(
      service.create({
        pattern: 'a',
        direction: 'incoming',
        filterType: 'none',
        isGlobal: false,
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('findAll requests pagination from the repository', async () => {
    rulesRepo.find.mockResolvedValue([]);
    await service.findAll(25, 5);
    expect(rulesRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 25,
        skip: 5,
      }),
    );
  });
});
