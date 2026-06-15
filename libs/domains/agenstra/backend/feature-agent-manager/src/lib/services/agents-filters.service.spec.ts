import { Test } from '@nestjs/testing';

import { RegexFilterRuleEntity } from '../entities/regex-filter-rule.entity';
import { RegexFilterRulesRepository } from '../repositories/regex-filter-rules.repository';

import { AgentsFiltersService } from './agents-filters.service';
import { RegexFilterRulesCacheService } from './regex-filter-rules-cache.service';

describe('AgentsFiltersService', () => {
  let service: AgentsFiltersService;
  let cache: RegexFilterRulesCacheService;
  const repoMock: jest.Mocked<
    Pick<
      RegexFilterRulesRepository,
      'create' | 'update' | 'delete' | 'findByIdOrThrow' | 'findAll' | 'findAllOrdered' | 'count'
    >
  > = {
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findByIdOrThrow: jest.fn(),
    findAll: jest.fn().mockResolvedValue([]),
    findAllOrdered: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentsFiltersService,
        RegexFilterRulesCacheService,
        { provide: RegexFilterRulesRepository, useValue: repoMock },
      ],
    }).compile();

    service = moduleRef.get(AgentsFiltersService);
    cache = moduleRef.get(RegexFilterRulesCacheService);
  });

  it('create invalidates cache', async () => {
    const invalidate = jest.spyOn(cache, 'invalidate');
    const created = { id: '1' } as RegexFilterRuleEntity;

    repoMock.create.mockResolvedValue(created);
    const out = await service.create({
      pattern: 'a',
      direction: 'incoming',
      filterType: 'none',
      priority: 0,
    });

    expect(out).toBe(created);
    expect(invalidate).toHaveBeenCalled();
  });
});
