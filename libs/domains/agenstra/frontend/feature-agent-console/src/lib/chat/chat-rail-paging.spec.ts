import type { AgentResponseDto, EnvironmentProgress } from '@forepath/agenstra/frontend/data-access-agent-console';

import { chatEnvironmentRailRows, chatRailPageQuery } from './chat-rail-paging';

function agent(id: string): AgentResponseDto {
  return {
    id,
    name: `Environment ${id}`,
    agentType: 'opencode',
    chats: [],
    primaryChatId: `chat-${id}`,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
}

function pending(operationId: string): EnvironmentProgress {
  return {
    operationId,
    agentId: null,
    agentName: `New ${operationId}`,
    operation: 'create',
    status: 'running',
    step: 'pullingImage',
    stepIndex: 1,
    stepCount: 6,
    progress: 30,
    startedAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:10Z',
  };
}

describe('chat rail paging', () => {
  describe('chatRailPageQuery', () => {
    it('maps a 1-based page to limit / offset', () => {
      expect(chatRailPageQuery(1, 25, '')).toEqual({ limit: 25, offset: 0 });
      expect(chatRailPageQuery(3, 25, null)).toEqual({ limit: 25, offset: 50 });
    });

    it('trims the search and omits an empty one', () => {
      expect(chatRailPageQuery(2, 10, '  acme ')).toEqual({ limit: 10, offset: 10, search: 'acme' });
      expect(chatRailPageQuery(2, 10, '   ')).toEqual({ limit: 10, offset: 10 });
    });

    it('clamps invalid pages and sizes', () => {
      expect(chatRailPageQuery(0, 0, undefined)).toEqual({ limit: 1, offset: 0 });
    });
  });

  describe('chatEnvironmentRailRows', () => {
    it('shows the loaded page as is (no client-side slicing)', () => {
      expect(chatEnvironmentRailRows(3, [], [agent('a'), agent('b')])).toEqual([
        { id: 'a', name: 'Environment a', agent: agent('a'), pending: null },
        { id: 'b', name: 'Environment b', agent: agent('b'), pending: null },
      ]);
    });

    it('puts environments still being created on top of the first page only', () => {
      const progress = pending('op-1');

      expect(chatEnvironmentRailRows(1, [progress], [agent('a')]).map((row) => row.id)).toEqual(['pending:op-1', 'a']);
      expect(chatEnvironmentRailRows(1, [progress], [])[0]).toEqual({
        id: 'pending:op-1',
        name: 'New op-1',
        agent: null,
        pending: progress,
      });
      expect(chatEnvironmentRailRows(2, [progress], [agent('a')]).map((row) => row.id)).toEqual(['a']);
    });
  });
});
