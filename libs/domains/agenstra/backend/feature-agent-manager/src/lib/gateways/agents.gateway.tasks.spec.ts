import { AGENT_TASK_REQUEST_EVENT } from '@forepath/agenstra/shared/util-opencode-config';
import type { Socket } from 'socket.io';

import { ContainerType } from '../entities/agent.entity';
import type { AgentProviderFactory } from '../providers/agent-provider.factory';
import type { ChatFilterFactory } from '../providers/chat-filter.factory';
import type { OpenCodePtyService } from '../providers/opencode/opencode-pty.service';
import type { AgentsRepository } from '../repositories/agents.repository';
import type { AgentChatSessionsService } from '../services/agent-chat-sessions.service';
import type { AgentGitStateBroadcastService } from '../services/agent-git-state-broadcast.service';
import type { AgentMessageEventsService } from '../services/agent-message-events.service';
import type { AgentMessagesService } from '../services/agent-messages.service';
import type { AgentSessionHydrationService } from '../services/agent-session-hydration.service';
import { AgentTasksApiService } from '../services/agent-tasks-api.service';
import type { AgentsService } from '../services/agents.service';
import type { DockerService } from '../services/docker.service';
import { PromptContextComposerService } from '../services/prompt-context-composer.service';
import type { WorkspaceChangeNotifierService } from '../services/workspace-change-notifier.service';

import { AgentsGateway } from './agents.gateway';

/* eslint-disable @typescript-eslint/no-explicit-any -- private gateway helpers are exercised directly */

describe('AgentsGateway agent tasks bridge', () => {
  const agentId = '11111111-1111-4111-8111-111111111111';
  const otherAgentId = '22222222-2222-4222-8222-222222222222';
  const agent = {
    id: agentId,
    name: 'Agent',
    containerId: 'container-1',
    agentType: 'opencode',
    containerType: ContainerType.GENERIC,
  };
  let gateway: AgentsGateway;
  let tasksApi: AgentTasksApiService;
  let provider: { sendMessage: jest.Mock; getCapabilities: jest.Mock; toParseableStrings: jest.Mock };

  const socket = (id: string, ack: jest.Mock = jest.fn()): Socket & { emitWithAckMock: jest.Mock } => {
    const timeout = jest.fn().mockReturnValue({ emitWithAck: ack });

    return { id, connected: true, emit: jest.fn(), timeout, emitWithAckMock: ack } as unknown as Socket & {
      emitWithAckMock: jest.Mock;
    };
  };

  const login = (s: Socket, id = agentId) => {
    (gateway as any).socketById.set(s.id, s);
    (gateway as any).authenticatedClients.set(s.id, id);
  };

  beforeEach(() => {
    tasksApi = new AgentTasksApiService();
    provider = {
      sendMessage: jest.fn().mockResolvedValue(''),
      getCapabilities: jest.fn().mockReturnValue({ supportsStreaming: false }),
      toParseableStrings: jest.fn().mockReturnValue([]),
    };
    gateway = new AgentsGateway(
      { findOne: jest.fn().mockResolvedValue(agent) } as unknown as AgentsService,
      { findById: jest.fn().mockResolvedValue(agent) } as unknown as AgentsRepository,
      {} as DockerService,
      { closeAll: jest.fn() } as unknown as OpenCodePtyService,
      {
        getChatHistory: jest.fn().mockResolvedValue([{ id: 'existing' }]),
        createUserMessage: jest.fn().mockResolvedValue({ id: 'u1' }),
        createAgentMessage: jest.fn().mockResolvedValue({ id: 'a1' }),
      } as unknown as AgentMessagesService,
      { persistEvent: jest.fn() } as unknown as AgentMessageEventsService,
      {
        resolveSessionForChat: jest.fn().mockResolvedValue({ id: 'chat-1', resumeSessionSuffix: '' }),
      } as unknown as AgentChatSessionsService,
      { getProvider: jest.fn().mockReturnValue(provider) } as unknown as AgentProviderFactory,
      { getFiltersByDirection: jest.fn().mockReturnValue([]) } as unknown as ChatFilterFactory,
      new PromptContextComposerService(),
      { consumePendingSummary: jest.fn() } as unknown as AgentSessionHydrationService,
      {
        registerBroadcaster: jest.fn(),
        notifyGitStateMayHaveChanged: jest.fn(),
      } as unknown as AgentGitStateBroadcastService,
      {
        registerIndexBroadcaster: jest.fn(),
        registerFileUpdateBroadcaster: jest.fn(),
        notifyRebuildRequired: jest.fn(),
      } as unknown as WorkspaceChangeNotifierService,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      tasksApi,
    );
    gateway.onModuleInit();
  });

  it('forwards task requests only to sockets logged into the calling agent', async () => {
    const foreign = socket('foreign', jest.fn().mockResolvedValue({ ok: true, tasks: [{ id: 'x' }] }));
    const own = socket('own', jest.fn().mockResolvedValue({ ok: true, tasks: [] }));

    login(foreign, otherAgentId);
    login(own);

    await expect(tasksApi.list(agentId)).resolves.toEqual({ tasks: [] });
    expect(foreign.emitWithAckMock).not.toHaveBeenCalled();
    expect(own.emitWithAckMock).toHaveBeenCalledWith(AGENT_TASK_REQUEST_EVENT, { op: 'list', agentId });
  });

  it('falls through to the next socket for reads', async () => {
    const broken = socket('broken', jest.fn().mockRejectedValue(new Error('timeout')));
    const healthy = socket('healthy', jest.fn().mockResolvedValue({ ok: true, tasks: [] }));

    login(broken);
    login(healthy);

    await expect(tasksApi.list(agentId)).resolves.toEqual({ tasks: [] });
    expect(healthy.emitWithAckMock).toHaveBeenCalled();
  });

  it('sends mutations to a single socket so a slow ack cannot apply twice', async () => {
    const slow = socket('slow', jest.fn().mockRejectedValue(new Error('timeout')));
    const second = socket('second', jest.fn().mockResolvedValue({ ok: true, deleted: true }));

    login(slow);
    login(second);

    await expect(tasksApi.delete(agentId, 'task-1')).rejects.toMatchObject({ status: 503 });
    expect(second.emitWithAckMock).not.toHaveBeenCalled();
  });

  it('reports a missing controller connection as unavailable', async () => {
    await expect(tasksApi.list(agentId)).rejects.toMatchObject({ status: 503 });
  });

  it('remembers the model of visible chats as default for agent-created tasks', async () => {
    const s = socket('chat-socket', jest.fn().mockResolvedValue({ ok: true, task: { id: 'task-1' } }));

    login(s);
    await gateway.handleChat(
      { message: 'hello', model: 'openai/gpt-5', responseMode: 'single', correlationId: 'c1' },
      s as unknown as Socket,
    );
    await tasksApi.create(agentId, { title: 't', prompt: 'p', cronExpression: '0 9 * * *' });

    expect(s.emitWithAckMock).toHaveBeenCalledWith(
      AGENT_TASK_REQUEST_EVENT,
      expect.objectContaining({ op: 'create', input: expect.objectContaining({ model: 'openai/gpt-5' }) }),
    );
  });
});
