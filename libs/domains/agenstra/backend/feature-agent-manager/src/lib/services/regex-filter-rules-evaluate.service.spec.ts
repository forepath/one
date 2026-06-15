import { Test } from '@nestjs/testing';

import type { RegexFilterRuleEntity } from '../entities/regex-filter-rule.entity';
import { FilterDirection } from '../providers/chat-filter.interface';
import { RegexFilterRulesRepository } from '../repositories/regex-filter-rules.repository';

import { RegexFilterRulesCacheService } from './regex-filter-rules-cache.service';
import { RegexFilterRulesEvaluateService } from './regex-filter-rules-evaluate.service';

describe('RegexFilterRulesEvaluateService', () => {
  let service: RegexFilterRulesEvaluateService;
  let cache: RegexFilterRulesCacheService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        RegexFilterRulesEvaluateService,
        RegexFilterRulesCacheService,
        {
          provide: RegexFilterRulesRepository,
          useValue: {
            findAllOrdered: jest.fn(),
            findAll: jest.fn(),
            count: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
            findByIdOrThrow: jest.fn(),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(RegexFilterRulesEvaluateService);
    cache = moduleRef.get(RegexFilterRulesCacheService);
  });

  it('returns drop on first matching rule', async () => {
    jest.spyOn(cache, 'getAllOrdered').mockResolvedValue([
      {
        id: 'r1',
        pattern: 'secret',
        regexFlags: 'g',
        direction: 'incoming',
        filterType: 'drop',
        replaceContent: null,
        priority: 0,
      } as RegexFilterRuleEntity,
    ]);
    const r = await service.evaluate('has secret word', FilterDirection.INCOMING);

    expect(r).toEqual(expect.objectContaining({ filtered: true, action: 'drop' }));
  });

  it('skips outgoing-only rule on incoming evaluation', async () => {
    jest.spyOn(cache, 'getAllOrdered').mockResolvedValue([
      {
        id: 'r1',
        pattern: 'x',
        regexFlags: 'g',
        direction: 'outgoing',
        filterType: 'drop',
        replaceContent: null,
        priority: 0,
      } as RegexFilterRuleEntity,
    ]);
    const r = await service.evaluate('x', FilterDirection.INCOMING);

    expect(r).toEqual({ filtered: false });
  });
});
