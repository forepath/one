import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AgentConsoleRegexFilterRuleSyncTargetEntity } from '../entities/agent-console-regex-filter-rule-sync-target.entity';
import { AgentConsoleRegexFilterRuleEntity } from '../entities/agent-console-regex-filter-rule.entity';

import { AgentManagerFilterRulesClientService } from './agent-manager-filter-rules-client.service';
import { FilterRulesSyncService } from './filter-rules-sync.service';

describe('FilterRulesSyncService', () => {
  it('processBatch returns 0 when query empty', async () => {
    const qb = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    const targetsRepo = { createQueryBuilder: jest.fn().mockReturnValue(qb) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        FilterRulesSyncService,
        { provide: getRepositoryToken(AgentConsoleRegexFilterRuleSyncTargetEntity), useValue: targetsRepo },
        { provide: getRepositoryToken(AgentConsoleRegexFilterRuleEntity), useValue: {} },
        { provide: AgentManagerFilterRulesClientService, useValue: {} },
      ],
    }).compile();
    const svc = moduleRef.get(FilterRulesSyncService);

    expect(await svc.processBatch(5)).toBe(0);
  });
});
