import { AGENT_HANDOFF_REQUEST_EVENT } from '@forepath/agenstra/shared/util-opencode-config';
import type { Socket } from 'socket.io';

import { ContainerType } from '../entities/agent.entity';
import type { AgentProviderFactory } from '../providers/agent-provider.factory';
import type { ChatFilterFactory } from '../providers/chat-filter.factory';
import type { OpenCodePtyService } from '../providers/opencode/opencode-pty.service';
import type { AgentsRepository } from '../repositories/agents.repository';
import type { AgentChatSessionsService } from '../services/agent-chat-sessions.service';
import type { AgentGitStateBroadcastService } from '../services/agent-git-state-broadcast.service';
import { AgentActiveTurnsService } from '../services/agent-active-turns.service';
import { AgentHandoffsApiService } from '../services/agent-handoffs-api.service';
import type { AgentMessageEventsService } from '../services/agent-message-events.service';
import type { AgentMessagesService } from '../services/agent-messages.service';
import type { AgentSessionHydrationService } from '../services/agent-session-hydration.service';
import type { AgentsService } from '../services/agents.service';
import type { DockerService } from '../services/docker.service';
import { PromptContextComposerService } from '../services/prompt-context-composer.service';
import type { WorkspaceChangeNotifierService } from '../services/workspace-change-notifier.service';

import { AgentsGateway } from './agents.gateway';

/* eslint-disable @typescript-eslint/no-explicit-any -- private gateway helpers are exercised directly */

describe('AgentsGateway agent handoffs bridge', () => {
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
  let handoffsApi: AgentHandoffsApiService;
  let turns: AgentActiveTurnsService;
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
    turns = new AgentActiveTurnsService();
    handoffsApi = new AgentHandoffsApiService(
      turns,
      {
        ensurePrimarySession: jest.fn().mockResolvedValue({ id: 'primary-chat' }),
        getSession: jest.fn(async (_agentId: string, id: string) => ({ id })),
      } as unknown as AgentChatSessionsService,
      { findById: jest.fn().mockResolvedValue(agent), update: jest.fn() } as unknown as AgentsRepository,
      { getProvider: jest.fn(() => provider) } as unknown as AgentProviderFactory,
    );
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
      undefined,
      handoffsApi,
    );
    gateway.onModuleInit();
  });

  const handoffId = '33333333-3333-4333-8333-333333333333';

  it('forwards handoff requests only to sockets logged into the calling agent', async () => {
    const foreign = socket('foreign', jest.fn().mockResolvedValue({ ok: true, agents: [{ id: 'x' }] }));
    const own = socket('own', jest.fn().mockResolvedValue({ ok: true, agents: [] }));

    login(foreign, otherAgentId);
    login(own);

    await expect(handoffsApi.agents(agentId)).resolves.toEqual({
      self: { id: agentId, name: 'Agent' },
      agents: [],
    });
    expect(foreign.emitWithAckMock).not.toHaveBeenCalled();
    expect(own.emitWithAckMock).toHaveBeenCalledWith(AGENT_HANDOFF_REQUEST_EVENT, { op: 'agents', agentId });
  });

  it('sends creations to a single socket so a slow ack cannot create twice', async () => {
    const slow = socket('slow', jest.fn().mockRejectedValue(new Error('timeout')));
    const second = socket('second', jest.fn().mockResolvedValue({ ok: true, handoff: { id: handoffId } }));

    login(slow);
    login(second);
    turns.begin(agentId, '');

    await expect(
      handoffsApi.create(agentId, { targetAgentId: otherAgentId, title: 't', message: 'm' }),
    ).rejects.toMatchObject({ status: 503 });
    expect(second.emitWithAckMock).not.toHaveBeenCalled();
  });

  it('remembers the model of visible chats as default for handoffs to this agent', async () => {
    const s = socket('chat-socket', jest.fn().mockResolvedValue({ ok: true, handoff: { id: handoffId } }));

    login(s);
    await gateway.handleChat(
      { message: 'hello', model: 'openai/gpt-5', responseMode: 'single', correlationId: 'c1' },
      s as unknown as Socket,
    );

    const callerSocket = socket('caller', jest.fn().mockResolvedValue({ ok: true, handoff: { id: handoffId } }));

    login(callerSocket, otherAgentId);
    turns.begin(otherAgentId, '');
    await handoffsApi.create(otherAgentId, { targetAgentId: agentId, title: 't', message: 'm' });

    expect(callerSocket.emitWithAckMock).toHaveBeenCalledWith(
      AGENT_HANDOFF_REQUEST_EVENT,
      expect.objectContaining({ op: 'create', input: expect.objectContaining({ model: 'openai/gpt-5' }) }),
    );
  });
});
