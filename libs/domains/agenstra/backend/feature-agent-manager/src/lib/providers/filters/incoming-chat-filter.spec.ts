import { Test, TestingModule } from '@nestjs/testing';

import { FilterDirection } from '../chat-filter.interface';

import { IncomingChatFilter } from './incoming-chat-filter';

describe('IncomingChatFilter', () => {
  let filter: IncomingChatFilter;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [IncomingChatFilter],
    }).compile();

    filter = module.get<IncomingChatFilter>(IncomingChatFilter);
  });

  describe('getType', () => {
    it('should return "incoming-example"', () => {
      expect(filter.getType()).toBe('incoming-example');
    });
  });

  describe('getDisplayName', () => {
    it('should return "Incoming Filter Example"', () => {
      expect(filter.getDisplayName()).toBe('Incoming Filter Example');
    });
  });

  describe('getDirection', () => {
    it('should return INCOMING', () => {
      expect(filter.getDirection()).toBe(FilterDirection.INCOMING);
    });
  });

  describe('filter', () => {
    it('should filter messages containing "test-filter" keyword', async () => {
      const result = await filter.filter('This message contains test-filter keyword');

      expect(result.filtered).toBe(true);

      if (result.filtered) {
        expect(result.action).toBe('flag');
        expect(result.reason).toBe('Message contains test-filter keyword');
      }
    });

    it('should filter messages containing "test-filter" case-insensitively', async () => {
      const result1 = await filter.filter('TEST-FILTER in uppercase');
      const result2 = await filter.filter('Test-Filter in mixed case');
      const result3 = await filter.filter('test-filter in lowercase');

      expect(result1.filtered).toBe(true);
      expect(result2.filtered).toBe(true);
      expect(result3.filtered).toBe(true);
    });

    it('should not filter messages without "test-filter" keyword', async () => {
      const result = await filter.filter('This is a normal message');

      expect(result.filtered).toBe(false);
      expect('action' in result).toBe(false);
    });

    it('should not filter empty messages', async () => {
      const result = await filter.filter('');

      expect(result.filtered).toBe(false);
    });

    it('should work with context parameter', async () => {
      const result = await filter.filter('test-filter message', {
        agentId: 'test-agent-id',
        actor: 'user',
      });

      expect(result.filtered).toBe(true);
    });

    it('should work without context parameter', async () => {
      const result = await filter.filter('test-filter message');

      expect(result.filtered).toBe(true);
    });
  });
});
