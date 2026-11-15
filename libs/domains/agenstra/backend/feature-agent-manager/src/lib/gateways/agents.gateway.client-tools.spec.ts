import { AGENT_CLIENT_TOOL_REQUEST_EVENT, CLIENT_TOOL_LIMITS } from '@forepath/agenstra/shared/util-opencode-config';
import { HttpException, NotFoundException } from '@nestjs/common';
import type { Socket } from 'socket.io';

import type { AgentProviderFactory } from '../providers/agent-provider.factory';
import type { ChatFilterFactory } from '../providers/chat-filter.factory';
import type { OpenCodePtyService } from '../providers/opencode/opencode-pty.service';
import type { AgentsRepository } from '../repositories/agents.repository';
import type { AgentChatSessionsService } from '../services/agent-chat-sessions.service';
import { AgentClientToolsApiService } from '../services/agent-client-tools-api.service';
import type { AgentContextMcpService } from '../services/agent-context-mcp.service';
import { AgentContextTicketsService } from '../services/agent-context-tickets.service';
import type { AgentGitStateBroadcastService } from '../services/agent-git-state-broadcast.service';
import type { AgentMessageEventsService } from '../services/agent-message-events.service';
import type { AgentMessagesService } from '../services/agent-messages.service';
import type { AgentSessionHydrationService } from '../services/agent-session-hydration.service';
import type { AgentsService } from '../services/agents.service';
import type { DockerService } from '../services/docker.service';
import { PromptContextComposerService } from '../services/prompt-context-composer.service';
import type { WorkspaceChangeNotifierService } from '../services/workspace-change-notifier.service';

import { AgentsGateway } from './agents.gateway';

/* eslint-disable @typescript-eslint/no-explicit-any -- private gateway state is exercised directly */

describe('AgentsGateway client tools', () => {
  const agentId = '11111111-1111-4111-8111-111111111111';
  const agent = { id: agentId, name: 'Agent', containerId: 'container-1', agentType: 'opencode' };
  const tools = [{ name: 'get_weather', description: 'Weather', parameters: { type: 'object' } }];
  let gateway: AgentsGateway;
  let tickets: AgentContextTicketsService;
  let clientToolsApi: AgentClientToolsApiService;
  let contextMcp: { isConfigured: jest.Mock; isAvailable: jest.Mock; supportsFeature: jest.Mock };
  let messages: { getChatHistory: jest.Mock; createUserMessage: jest.Mock; createAgentMessage: jest.Mock };
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
    tickets = new AgentContextTicketsService();
    clientToolsApi = new AgentClientToolsApiService();
    contextMcp = {
      isConfigured: jest.fn().mockReturnValue(true),
      isAvailable: jest.fn().mockResolvedValue(true),
      supportsFeature: jest.fn().mockReturnValue(true),
    };
    messages = {
      getChatHistory: jest.fn().mockResolvedValue([{ id: 'existing' }]),
      createUserMessage: jest.fn().mockResolvedValue({ id: 'u1' }),
      createAgentMessage: jest.fn().mockResolvedValue({ id: 'a1' }),
    };
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
      messages as unknown as AgentMessagesService,
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
      tickets,
      contextMcp as unknown as AgentContextMcpService,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      clientToolsApi,
    );
    gateway.onModuleInit();
  });

  const chat = (s: Socket, extra: Record<string, unknown>) =>
    gateway.handleChat(
      { message: 'Weather in Berlin?', responseMode: 'single', correlationId: 'c1', ...extra } as any,
      s,
    );

  describe('turns with client tools', () => {
    it('mints a ticket with the tools and describes them in the prompt', async () => {
      const s = socket('api-socket');
      const mint = jest.spyOn(tickets, 'mint');

      login(s);
      await chat(s, { clientTools: tools, clientToolChoice: 'required', parallelToolCalls: false });

      expect(mint).toHaveBeenCalledWith(expect.objectContaining({ socketId: 'api-socket', clientTools: tools }));
      const record = mint.mock.results[0].value;
      const prompt = provider.sendMessage.mock.calls[0][2] as string;

      expect(prompt).toContain('<client_tools>');
      expect(prompt).toContain(`ticket: "${record.ticket}"`);
      expect(prompt).toContain('agenstra_client_tools_call');
      expect(prompt).toContain('- get_weather: Weather');
      expect(prompt).toContain('You must call at least one client tool before you answer.');
      expect(prompt).toContain('Call at most one client tool at a time.');
      expect(prompt.endsWith('Weather in Berlin?')).toBe(true);
      // The turn's ticket only lives for the turn.
      expect(() => tickets.resolve(agentId, record.ticket)).toThrow(NotFoundException);
    });

    it.each([
      ['invalid tools', { clientTools: [{ name: 'bad name' }] }, 'CLIENT_TOOLS_INVALID'],
      ['an unknown tool choice', { clientTools: tools, clientToolChoice: { name: 'nope' } }, 'CLIENT_TOOLS_INVALID'],
      ['ephemeral turns', { clientTools: tools, ephemeral: true }, 'CLIENT_TOOLS_INVALID'],
      ['hidden sessions', { clientTools: tools, resumeSessionSuffix: '-prompt-enhance' }, 'CLIENT_TOOLS_INVALID'],
    ])('rejects %s before anything is persisted', async (_label, extra, code) => {
      const s = socket('api-socket');

      login(s);
      await chat(s, extra);

      expect(s.emit).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({ error: expect.objectContaining({ code }) }),
      );
      expect(messages.createUserMessage).not.toHaveBeenCalled();
      expect(provider.sendMessage).not.toHaveBeenCalled();
    });

    it('rejects client tools when the worker does not serve the platform MCP server', async () => {
      const s = socket('api-socket');

      contextMcp.isAvailable.mockResolvedValue(false);
      login(s);
      await chat(s, { clientTools: tools });

      expect(s.emit).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({ error: expect.objectContaining({ code: 'CLIENT_TOOLS_UNAVAILABLE' }) }),
      );
      expect(provider.sendMessage).not.toHaveBeenCalled();
    });

    it('rejects client tools on workers whose MCP server does not announce them (older images)', async () => {
      const s = socket('api-socket');

      contextMcp.supportsFeature.mockReturnValue(false);
      login(s);
      await chat(s, { clientTools: tools });

      expect(contextMcp.supportsFeature).toHaveBeenCalledWith(agentId, 'client-tools');
      expect(s.emit).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'CLIENT_TOOLS_UNAVAILABLE',
            message: expect.stringContaining('worker image'),
          }),
        }),
      );
      expect(messages.createUserMessage).not.toHaveBeenCalled();
    });

    it('leaves turns without client tools unchanged', async () => {
      const s = socket('console-socket');
      const mint = jest.spyOn(tickets, 'mint');

      login(s);
      await chat(s, {});

      expect(mint).not.toHaveBeenCalled();
      expect(provider.sendMessage.mock.calls[0][2]).toBe('Weather in Berlin?');
    });
  });

  describe('client tool bridge', () => {
    const mint = (socketId = 'api-socket') =>
      tickets.mint({
        agentId,
        sessionKey: 'chat-1',
        socketId,
        chatId: 'chat-1',
        ephemeral: false,
        correlationId: 'c1',
        accessMode: 'ask',
        items: [],
        clientTools: tools,
      });

    it('hands calls only to the socket that started the turn', async () => {
      const own = socket('api-socket', jest.fn().mockResolvedValue({ ok: true, status: 'completed', output: 'sunny' }));
      const viewer = socket(
        'console-viewer',
        jest.fn().mockResolvedValue({ ok: true, status: 'completed', output: 'forged' }),
      );

      login(viewer);
      login(own);
      const record = mint();

      await expect(clientToolsApi.call(record, 'get_weather', { city: 'Berlin' })).resolves.toEqual({
        callId: expect.stringMatching(/^call_[0-9a-f]{36}$/),
        status: 'completed',
        output: 'sunny',
      });
      expect(own.emitWithAckMock).toHaveBeenCalledWith(AGENT_CLIENT_TOOL_REQUEST_EVENT, {
        op: 'call',
        agentId,
        chatId: 'chat-1',
        correlationId: 'c1',
        callId: expect.any(String),
        name: 'get_weather',
        arguments: '{"city":"Berlin"}',
      });
      expect(viewer.emitWithAckMock).not.toHaveBeenCalled();
    });

    it('answers pending when the API client does not answer in time, and failed when it is gone', async () => {
      const slow = socket('api-socket', jest.fn().mockRejectedValue(new Error('operation has timed out')));

      login(slow);
      const record = mint();
      const pending = await clientToolsApi.call(record, 'get_weather', {});

      expect(pending).toEqual({ callId: expect.any(String), status: 'pending' });

      slow.emitWithAckMock.mockResolvedValue({ ok: true, status: 'completed', output: 'later' });
      await expect(clientToolsApi.wait(record, pending.callId)).resolves.toEqual(
        expect.objectContaining({ status: 'completed', output: 'later' }),
      );

      (gateway as any).socketById.delete('api-socket');
      await expect(clientToolsApi.wait(record, pending.callId)).resolves.toEqual(
        expect.objectContaining({ status: 'failed', error: 'The API client of this turn is no longer connected' }),
      );
    });

    it('never uses a socket of another agent that took over the socket id', async () => {
      const s = socket('api-socket', jest.fn().mockResolvedValue({ ok: true, status: 'completed', output: 'x' }));

      login(s, '99999999-9999-4999-8999-999999999999');
      const record = mint();

      await expect(clientToolsApi.call(record, 'get_weather', {})).resolves.toEqual(
        expect.objectContaining({ status: 'failed' }),
      );
      expect(s.emitWithAckMock).not.toHaveBeenCalled();
    });

    it('truncates long client output and bounds calls per turn', async () => {
      const s = socket(
        'api-socket',
        jest.fn().mockResolvedValue({
          ok: true,
          status: 'completed',
          output: 'x'.repeat(CLIENT_TOOL_LIMITS.outputMaxChars + 10),
        }),
      );

      login(s);
      const record = mint();
      const result = await clientToolsApi.call(record, 'get_weather', {});

      expect(result.output).toContain('[truncated 10 characters]');

      record.clientToolCallIds = Array.from({ length: CLIENT_TOOL_LIMITS.maxCallsPerTurn }, (_, i) => `call_${i}`);
      await expect(clientToolsApi.call(record, 'get_weather', {})).rejects.toBeInstanceOf(HttpException);
    });

    it('rejects unknown tools, invalid arguments and calls of other turns', async () => {
      login(socket('api-socket'));
      const record = mint();

      await expect(clientToolsApi.call(record, 'other_tool', {})).rejects.toBeInstanceOf(NotFoundException);
      await expect(clientToolsApi.call(record, 'get_weather', '[1,2]')).rejects.toMatchObject({ status: 400 });
      await expect(clientToolsApi.wait(record, 'call_abcdefabcdefabcdefabcdefabcdef')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(clientToolsApi.wait(record, '../x')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
