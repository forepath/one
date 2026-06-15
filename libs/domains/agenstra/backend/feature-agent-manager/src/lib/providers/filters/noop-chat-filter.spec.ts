import { Test, TestingModule } from '@nestjs/testing';

import { FilterDirection } from '../chat-filter.interface';

import { NoopChatFilter } from './noop-chat-filter';

describe('NoopChatFilter', () => {
  let filter: NoopChatFilter;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [NoopChatFilter],
    }).compile();

    filter = module.get<NoopChatFilter>(NoopChatFilter);
  });

  describe('getType', () => {
    it('should return "noop"', () => {
      expect(filter.getType()).toBe('noop');
    });
  });

  describe('getDisplayName', () => {
    it('should return "No-op Filter"', () => {
      expect(filter.getDisplayName()).toBe('No-op Filter');
    });
  });

  describe('getDirection', () => {
    it('should return BIDIRECTIONAL', () => {
      expect(filter.getDirection()).toBe(FilterDirection.BIDIRECTIONAL);
    });
  });

  describe('filter', () => {
    it('should never filter messages', async () => {
      const result = await filter.filter('test message');

      expect(result.filtered).toBe(false);
      // When filtered is false, action should not be present
      expect('action' in result).toBe(false);
    });

    it('should not filter messages with context', async () => {
      const result = await filter.filter('test message', {
        agentId: 'test-agent-id',
        actor: 'user',
      });

      expect(result.filtered).toBe(false);
    });

    it('should not filter any message content', async () => {
      const messages = ['normal message', 'sensitive content', 'profanity', 'PII data'];

      for (const message of messages) {
        const result = await filter.filter(message);

        expect(result.filtered).toBe(false);
      }
    });
  });
});
