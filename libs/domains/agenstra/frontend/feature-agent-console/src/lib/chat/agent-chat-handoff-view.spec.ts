import {
  buildAgentHandoffRequestMessage,
  buildAgentHandoffResponseMessage,
} from '@forepath/agenstra/shared/util-opencode-config';

import { buildAgentChatHandoffCard } from './agent-chat-handoff-view';

describe('buildAgentChatHandoffCard', () => {
  it('links an incoming handoff to the chat it was made in', () => {
    const text = buildAgentHandoffRequestMessage(
      { id: 'h1', title: 'Review', sourceAgentId: 'agent-a', sourceAgentName: 'Backend', sourceChatId: 'chat-a' },
      'Please review.',
      'Respond with agenstra_handoff_respond.',
    );

    expect(buildAgentChatHandoffCard(text)).toEqual({
      kind: 'request',
      handoffId: 'h1',
      title: 'Review',
      agentName: 'Backend',
      body: 'Please review.',
      link: { agentId: 'agent-a', chatId: 'chat-a' },
    });
  });

  it('links a handoff made by a scheduled task run to that run', () => {
    const text = buildAgentHandoffRequestMessage(
      {
        id: 'h2',
        title: 'Nightly check',
        sourceAgentId: 'agent-a',
        sourceAgentName: 'Backend',
        sourceChatId: null,
        sourceTaskId: 'task-1',
        sourceTaskRunId: 'run-1',
      },
      'Check the logs.',
      'Respond with agenstra_handoff_respond.',
    );

    expect(buildAgentChatHandoffCard(text)?.link).toEqual({
      agentId: 'agent-a',
      chatId: null,
      taskRun: { taskId: 'task-1', runId: 'run-1' },
    });
  });

  it('links a response to the handoff chat of the target agent', () => {
    const text = buildAgentHandoffResponseMessage(
      {
        id: 'h1',
        title: 'Review',
        status: 'failed',
        targetAgentId: 'agent-b',
        targetAgentName: 'Reviewer',
        targetChatId: 'chat-b',
      },
      'No access to the repository.',
      'Continue.',
    );

    expect(buildAgentChatHandoffCard(text)).toEqual({
      kind: 'response',
      handoffId: 'h1',
      title: 'Review',
      agentName: 'Reviewer',
      body: 'No access to the repository.',
      status: 'failed',
      link: { agentId: 'agent-b', chatId: 'chat-b' },
    });
  });

  it('ignores ordinary messages', () => {
    expect(buildAgentChatHandoffCard('Hello')).toBeNull();
    expect(buildAgentChatHandoffCard(null)).toBeNull();
  });
});
