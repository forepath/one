import { Test, TestingModule } from '@nestjs/testing';

import { RegexFilterRulesEvaluateService } from '@forepath/agenstra/backend/feature-agent-manager/plugin-deps';
import { FilterDirection, FilterResult } from '@forepath/agenstra/backend/util-plugin-host';

import { ChatFilterDbRegexOutgoingProvider } from './chat-filter-db-regex-outgoing.provider';

describe('ChatFilterDbRegexOutgoingProvider', () => {
  let filter: ChatFilterDbRegexOutgoingProvider;
  let evaluateService: jest.Mocked<Pick<RegexFilterRulesEvaluateService, 'evaluate'>>;

  beforeEach(async () => {
    jest.clearAllMocks();
    evaluateService = { evaluate: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatFilterDbRegexOutgoingProvider,
        { provide: RegexFilterRulesEvaluateService, useValue: evaluateService },
      ],
    }).compile();

    filter = module.get(ChatFilterDbRegexOutgoingProvider);
  });

  describe('getType', () => {
    it('returns database-regex-outgoing', () => {
      expect(filter.getType()).toBe('database-regex-outgoing');
    });
  });

  describe('getDisplayName', () => {
    it('returns a stable label', () => {
      expect(filter.getDisplayName()).toBe('Database regex rules (outgoing)');
    });
  });

  describe('getDirection', () => {
    it('returns OUTGOING', () => {
      expect(filter.getDirection()).toBe(FilterDirection.OUTGOING);
    });
  });

  describe('filter', () => {
    it('delegates to evaluateService with OUTGOING direction', async () => {
      const result: FilterResult = { filtered: true, action: 'drop', reason: 'blocked' };

      evaluateService.evaluate.mockResolvedValue(result);

      const ctx = { agentId: 'agent-1', actor: 'agent' as const };
      const out = await filter.filter('model output', ctx);

      expect(out).toBe(result);
      expect(evaluateService.evaluate).toHaveBeenCalledTimes(1);
      expect(evaluateService.evaluate).toHaveBeenCalledWith('model output', FilterDirection.OUTGOING);
    });

    it('works without context', async () => {
      const result: FilterResult = { filtered: false };

      evaluateService.evaluate.mockResolvedValue(result);

      const out = await filter.filter('plain');

      expect(out).toEqual(result);
      expect(evaluateService.evaluate).toHaveBeenCalledWith('plain', FilterDirection.OUTGOING);
    });
  });
});
