import { Test, TestingModule } from '@nestjs/testing';

import { RegexFilterRuleEntity } from '../entities/regex-filter-rule.entity';
import { RegexFilterRulesRepository } from '../repositories/regex-filter-rules.repository';

import { RegexFilterRulesCacheService } from './regex-filter-rules-cache.service';

describe('RegexFilterRulesCacheService', () => {
  let cache: RegexFilterRulesCacheService;
  const repository = { findAllOrdered: jest.fn() };
  const sampleRows: RegexFilterRuleEntity[] = [
    Object.assign(new RegexFilterRuleEntity(), {
      id: 'a',
      pattern: 'a',
      regexFlags: 'g',
      direction: 'incoming',
      filterType: 'none',
      priority: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  ];

  beforeEach(async () => {
    jest.clearAllMocks();
    repository.findAllOrdered.mockResolvedValue(sampleRows);
    const module: TestingModule = await Test.createTestingModule({
      providers: [RegexFilterRulesCacheService, { provide: RegexFilterRulesRepository, useValue: repository }],
    }).compile();

    cache = module.get(RegexFilterRulesCacheService);
  });

  it('loads from repository when cache is empty', async () => {
    const first = await cache.getAllOrdered();

    expect(first).toEqual(sampleRows);
    expect(repository.findAllOrdered).toHaveBeenCalledTimes(1);
  });

  it('returns cached rows without hitting repository again', async () => {
    await cache.getAllOrdered();
    await cache.getAllOrdered();
    expect(repository.findAllOrdered).toHaveBeenCalledTimes(1);
  });

  it('invalidate clears cache so the next read refetches', async () => {
    await cache.getAllOrdered();
    cache.invalidate();
    await cache.getAllOrdered();
    expect(repository.findAllOrdered).toHaveBeenCalledTimes(2);
  });
});
