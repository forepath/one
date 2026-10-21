import type { Socket } from 'socket.io';

import { ContainerType } from '../entities/agent.entity';
import type { AgentProviderFactory } from '../providers/agent-provider.factory';
import type { ChatFilterFactory } from '../providers/chat-filter.factory';
import type { OpenCodePtyService } from '../providers/opencode/opencode-pty.service';
import type { AgentsRepository } from '../repositories/agents.repository';
import { AgentContextAccessService } from '../services/agent-context-access.service';
import { AgentContextApiService } from '../services/agent-context-api.service';
import type { AgentContextMcpService } from '../services/agent-context-mcp.service';
import { AgentContextTicketsService } from '../services/agent-context-tickets.service';
import type { AgentChatSessionsService } from '../services/agent-chat-sessions.service';
import type { AgentGitStateBroadcastService } from '../services/agent-git-state-broadcast.service';
import type { AgentMessageEventsService } from '../services/agent-message-events.service';
import type { AgentMessagesService } from '../services/agent-messages.service';
import type { AgentSessionHydrationService } from '../services/agent-session-hydration.service';
import type { AgentsService } from '../services/agents.service';
import type { DockerService } from '../services/docker.service';
import { PromptContextComposerService } from '../services/prompt-context-composer.service';
import type { WorkspaceChangeNotifierService } from '../services/workspace-change-notifier.service';
import type { AgentContextTicketRecord } from '../types/agent-context.types';

import { AgentsGateway } from './agents.gateway';

/* eslint-disable @typescript-eslint/no-explicit-any -- private gateway helpers are exercised directly */

describe('AgentsGateway context MCP integration', () => {
  const agentId = '11111111-1111-4111-8111-111111111111';
  const agent = {
    id: agentId,
    name: 'Agent',
    containerId: 'container-1',
    agentType: 'opencode',
    containerType: ContainerType.GENERIC,
  };
  let gateway: AgentsGateway;
  let tickets: AgentContextTicketsService;
  let contextApi: AgentContextApiService;
  let contextMcp: { isConfigured: jest.Mock; isAvailable: jest.Mock };
  let provider: {
    sendMessage: jest.Mock;
    getCapabilities: jest.Mock;
    toParseableStrings: jest.Mock;
    toUnifiedResponse: jest.Mock;
    sendInitialization: jest.Mock;
  };
  let persistEvent: jest.Mock;
  let composer: PromptContextComposerService;

  const socket = (id: string, ack?: jest.Mock): Socket & { emit: jest.Mock } => {
    const timeout = jest.fn().mockReturnValue({ emitWithAck: ack ?? jest.fn() });

    return { id, connected: true, emit: jest.fn(), timeout } as unknown as Socket & { emit: jest.Mock };
  };

  const login = (s: Socket) => {
    (gateway as any).socketById.set(s.id, s);
    (gateway as any).authenticatedClients.set(s.id, agentId);
  };

  beforeEach(() => {
    tickets = new AgentContextTicketsService();
    contextApi = new AgentContextApiService(tickets, new AgentContextAccessService());
    contextMcp = { isConfigured: jest.fn().mockReturnValue(true), isAvailable: jest.fn().mockResolvedValue(true) };
    provider = {
      sendMessage: jest.fn().mockResolvedValue(''),
      getCapabilities: jest.fn().mockReturnValue({ supportsStreaming: false }),
      toParseableStrings: jest.fn().mockReturnValue([]),
      toUnifiedResponse: jest.fn(),
      sendInitialization: jest.fn().mockResolvedValue(undefined),
    };
    persistEvent = jest.fn();
    composer = new PromptContextComposerService();

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
      { persistEvent } as unknown as AgentMessageEventsService,
      {
        resolveSessionForChat: jest.fn().mockResolvedValue({ id: 'chat-1', resumeSessionSuffix: '' }),
      } as unknown as AgentChatSessionsService,
      { getProvider: jest.fn().mockReturnValue(provider) } as unknown as AgentProviderFactory,
      { getFiltersByDirection: jest.fn().mockReturnValue([]) } as unknown as ChatFilterFactory,
      composer,
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
      contextApi,
    );
    gateway.onModuleInit();
  });

  describe('chat composition', () => {
    const contextInjection = {
      includeWorkspace: true,
      ticketShas: ['329ec4f'],
      ticketContexts: ['TICKET BODY'],
      ticketContextRefs: [{ sha: '329ec4f443e9', title: 'Fix login' }],
      knowledgeContexts: ['Knowledge Page: Auth\nKNOWLEDGE BODY'],
    };

    it('sends hints plus a context ticket instead of bodies when the worker MCP is available', async () => {
      const s = socket('socket-1');

      login(s);
      await gateway.handleChat({ message: 'Implement it', contextInjection } as any, s);

      const sent = provider.sendMessage.mock.calls[0][2] as string;

      expect(sent).toMatch(/Context ticket: ctx-/);
      expect(sent).toContain('item:1 [ticket 329ec4f4] "Fix login"');
      expect(sent).toContain('item:2 [knowledge] "Auth"');
      expect(sent).not.toContain('TICKET BODY');
      expect(sent).not.toContain('KNOWLEDGE BODY');

      const ticket = /Context ticket: (ctx-[A-Za-z0-9_-]+)/.exec(sent)?.[1] as string;
      const record = tickets.resolve(agentId, ticket);

      expect(record).toMatchObject({
        sessionKey: 'chat-1',
        socketId: 'socket-1',
        chatId: 'chat-1',
        ephemeral: false,
        accessMode: 'ask',
        workspace: { mountPath: '/opt/workspace' },
      });
      expect(record.items.map((item) => item.content)).toEqual(['TICKET BODY', 'Knowledge Page: Auth\nKNOWLEDGE BODY']);
    });

    it('keeps the legacy inline composition when the worker MCP is unavailable', async () => {
      const s = socket('socket-1');

      contextMcp.isAvailable.mockResolvedValue(false);
      login(s);
      await gateway.handleChat({ message: 'Implement it', contextInjection } as any, s);

      const sent = provider.sendMessage.mock.calls[0][2] as string;

      expect(sent).toBe(
        composer.composeChatMessage('Implement it', { ...contextInjection, environmentIds: [] } as any),
      );
      expect(sent).toContain('TICKET BODY');
      expect(sent).not.toContain('Context ticket:');
    });

    it('does not mint tickets for chats without context injection', async () => {
      const s = socket('socket-1');

      login(s);
      await gateway.handleChat({ message: 'Hello' } as any, s);

      expect(provider.sendMessage.mock.calls[0][2]).toBe('Hello');
      expect(contextMcp.isAvailable).not.toHaveBeenCalled();
    });
  });

  describe('access mode', () => {
    const mode = (hidden: boolean, suffix: string | undefined, unattended?: boolean) =>
      (gateway as any).resolveContextAccessMode(hidden, suffix, { unattendedAutomation: unattended });

    it('skips asking in auto-approval sessions and asks in visible chats', () => {
      expect(mode(true, '-ticket-auto-loop', true)).toBe('auto');
      expect(mode(true, '-plan-123')).toBe('auto');
      expect(mode(false, undefined)).toBe('ask');
      expect(mode(true, '-enhance')).toBe('deny');
      expect(mode(true, '-ticket-auto-loop', false)).toBe('deny');
    });
  });

  describe('controller round trip', () => {
    const record = (socketId?: string): AgentContextTicketRecord =>
      tickets.mint({
        agentId,
        sessionKey: 'chat-1',
        socketId,
        ephemeral: false,
        correlationId: 'corr',
        accessMode: 'ask',
        items: [],
      });

    it('prefers the originating socket', async () => {
      const ackOrigin = jest.fn().mockResolvedValue({ ok: true, items: [] });
      const ackOther = jest.fn();
      const origin = socket('origin', ackOrigin);
      const other = socket('other', ackOther);

      login(other);
      login(origin);

      const request = { op: 'search', agentId } as const;

      await expect((gateway as any).requestControllerContext(record('origin'), request)).resolves.toEqual({
        ok: true,
        items: [],
      });
      expect(ackOrigin).toHaveBeenCalledWith('agentContextRequest', request);
      expect(ackOther).not.toHaveBeenCalled();
    });

    it('falls back to other sockets of the agent when the origin is gone or times out', async () => {
      const ackOrigin = jest.fn().mockRejectedValue(new Error('operation has timed out'));
      const ackOther = jest.fn().mockResolvedValue({ ok: true, contents: [] });
      const foreign = socket('foreign', jest.fn());

      login(socket('origin', ackOrigin));
      login(socket('other', ackOther));
      (gateway as any).socketById.set(foreign.id, foreign);
      (gateway as any).authenticatedClients.set(foreign.id, 'another-agent');

      await expect(
        (gateway as any).requestControllerContext(record('origin'), { op: 'content', agentId, refs: [] }),
      ).resolves.toEqual({ ok: true, contents: [] });
      expect(foreign.timeout).not.toHaveBeenCalled();
    });

    it('reports when no controller connection is available', async () => {
      await expect(
        (gateway as any).requestControllerContext(record('gone'), { op: 'search', agentId }),
      ).resolves.toEqual({ ok: false, error: expect.stringContaining('No controller connection') });
    });
  });

  describe('access questions', () => {
    it('broadcasts and persists permission-style prompts in visible chats', () => {
      const viewer = socket('viewer');
      const rec = tickets.mint({
        agentId,
        sessionKey: 'chat-1',
        chatSessionId: 'chat-1',
        chatId: 'chat-1',
        ephemeral: false,
        correlationId: 'corr',
        accessMode: 'ask',
        items: [],
      });

      login(viewer);
      (gateway as any).publishContextAccessQuestion(rec, 'ctx_1', 'May I?');

      const [, envelope] = viewer.emit.mock.calls.find(([event]) => event === 'chatEvent') as [string, any];

      expect(envelope.data).toMatchObject({
        kind: 'question',
        chatId: 'chat-1',
        payload: {
          questionId: 'ctx_1',
          prompt: 'May I?',
          subtype: 'context_access',
          options: [
            { id: 'once', label: 'Allow once' },
            { id: 'always', label: 'Allow for this chat' },
            { id: 'reject', label: 'Deny' },
          ],
        },
      });
      expect(persistEvent).toHaveBeenCalledWith(agentId, expect.objectContaining({ kind: 'question' }), 'chat-1');
    });

    it('only notifies the requesting socket for ephemeral turns', () => {
      const origin = socket('origin');
      const viewer = socket('viewer');
      const rec = tickets.mint({
        agentId,
        sessionKey: 'ephemeral:corr',
        socketId: 'origin',
        ephemeral: true,
        correlationId: 'corr',
        accessMode: 'ask',
        items: [],
      });

      login(origin);
      login(viewer);
      (gateway as any).publishContextAccessQuestion(rec, 'ctx_2', 'May I?');

      expect(origin.emit).toHaveBeenCalledWith('chatEvent', expect.anything());
      expect(viewer.emit).not.toHaveBeenCalled();
      expect(persistEvent).not.toHaveBeenCalled();
    });
  });
});
