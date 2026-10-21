import type { AgentChatHandoffLink } from './agent-chat-handoff-view';
import { AgentChatHandoffNavigationService } from './agent-chat-handoff-navigation.service';

describe('AgentChatHandoffNavigationService', () => {
  it('emits normalized jump requests and drops requests without an agent', () => {
    const service = new AgentChatHandoffNavigationService();
    const received: AgentChatHandoffLink[] = [];

    service.requests$.subscribe((link) => received.push(link));
    service.open({ agentId: ' agent-b ', chatId: ' chat-b ' });
    service.open({ agentId: 'agent-a', chatId: '' });
    service.open({ agentId: ' ', chatId: 'chat-x' });

    expect(received).toEqual([
      { agentId: 'agent-b', chatId: 'chat-b' },
      { agentId: 'agent-a', chatId: null },
    ]);
  });

  it('keeps task run targets and hands a deferred jump over exactly once', () => {
    const service = new AgentChatHandoffNavigationService();
    const received: AgentChatHandoffLink[] = [];

    service.requests$.subscribe((link) => received.push(link));
    service.open({ agentId: 'agent-a', chatId: null, taskRun: { taskId: ' task-1 ', runId: 'run-1' } });
    service.open({ agentId: 'agent-a', chatId: null, taskRun: { taskId: 'task-1', runId: ' ' } });

    expect(received).toEqual([
      { agentId: 'agent-a', chatId: null, taskRun: { taskId: 'task-1', runId: 'run-1' } },
      { agentId: 'agent-a', chatId: null },
    ]);

    service.defer({ agentId: ' agent-b ', chatId: 'chat-b' });

    expect(service.takeDeferred()).toEqual({ agentId: 'agent-b', chatId: 'chat-b' });
    expect(service.takeDeferred()).toBeNull();

    service.defer({ agentId: ' ', chatId: 'chat-x' });

    expect(service.takeDeferred()).toBeNull();
  });
});
