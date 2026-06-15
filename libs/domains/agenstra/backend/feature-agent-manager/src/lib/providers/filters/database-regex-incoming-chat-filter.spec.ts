import { Test, TestingModule } from '@nestjs/testing';

import { RegexFilterRulesEvaluateService } from '../../services/regex-filter-rules-evaluate.service';
import { FilterDirection, FilterResult } from '../chat-filter.interface';

import { DatabaseRegexIncomingChatFilter } from './database-regex-incoming-chat-filter';

describe('DatabaseRegexIncomingChatFilter', () => {
  let filter: DatabaseRegexIncomingChatFilter;
  let evaluateService: jest.Mocked<Pick<RegexFilterRulesEvaluateService, 'evaluate'>>;

  beforeEach(async () => {
    jest.clearAllMocks();
    evaluateService = { evaluate: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DatabaseRegexIncomingChatFilter,
        { provide: RegexFilterRulesEvaluateService, useValue: evaluateService },
      ],
    }).compile();

    filter = module.get(DatabaseRegexIncomingChatFilter);
  });

  describe('getType', () => {
    it('returns database-regex-incoming', () => {
      expect(filter.getType()).toBe('database-regex-incoming');
    });
  });

  describe('getDisplayName', () => {
    it('returns a stable label', () => {
      expect(filter.getDisplayName()).toBe('Database regex rules (incoming)');
    });
  });

  describe('getDirection', () => {
    it('returns INCOMING', () => {
      expect(filter.getDirection()).toBe(FilterDirection.INCOMING);
    });
  });

  describe('filter', () => {
    it('delegates to evaluateService with INCOMING direction', async () => {
      const result: FilterResult = { filtered: true, action: 'flag', reason: 'db-rule' };

      evaluateService.evaluate.mockResolvedValue(result);

      const ctx = { agentId: 'agent-1', actor: 'user' as const };
      const out = await filter.filter('hello world', ctx);

      expect(out).toBe(result);
      expect(evaluateService.evaluate).toHaveBeenCalledTimes(1);
      expect(evaluateService.evaluate).toHaveBeenCalledWith('hello world', FilterDirection.INCOMING);
    });

    it('works without context', async () => {
      const result: FilterResult = { filtered: false };

      evaluateService.evaluate.mockResolvedValue(result);

      const out = await filter.filter('plain');

      expect(out).toEqual(result);
      expect(evaluateService.evaluate).toHaveBeenCalledWith('plain', FilterDirection.INCOMING);
    });
  });
});
