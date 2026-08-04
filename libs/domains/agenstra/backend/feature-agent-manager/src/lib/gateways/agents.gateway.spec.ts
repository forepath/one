import { Test, TestingModule } from '@nestjs/testing';
import { Server, Socket } from 'socket.io';

import { AgentEntity, ContainerType } from '../entities/agent.entity';
import type { AgentEventEnvelope } from '../providers/agent-events.types';
import { AgentProviderFactory } from '../providers/agent-provider.factory';
import { AgentProvider, AgentResponseObject } from '../providers/agent-provider.interface';
import { ChatFilterFactory } from '../providers/chat-filter.factory';
import { ChatFilter, FilterDirection } from '../providers/chat-filter.interface';
import { AgentsRepository } from '../repositories/agents.repository';
import { AgentGitStateBroadcastService } from '../services/agent-git-state-broadcast.service';
import { AgentMessageEventsService } from '../services/agent-message-events.service';
import { AgentMessagesService } from '../services/agent-messages.service';
import { AgentSessionHydrationService } from '../services/agent-session-hydration.service';
import { AgentsService } from '../services/agents.service';
import { BrowserPreviewService } from '../services/browser-preview.service';
import { DockerService } from '../services/docker.service';
import { PromptContextComposerService } from '../services/prompt-context-composer.service';

import { AgentsGateway } from './agents.gateway';

interface ChatPayload {
  message: string;
  model?: string;
  responseMode?: 'stream' | 'sync' | 'single';
  ephemeral?: boolean;
  correlationId?: string;
}

describe('AgentsGateway', () => {
  let gateway: AgentsGateway;
  let agentsService: jest.Mocked<AgentsService>;
  let agentsRepository: jest.Mocked<AgentsRepository>;
  let dockerService: jest.Mocked<DockerService>;
  let agentMessagesService: jest.Mocked<AgentMessagesService>;
  let agentProviderFactory: jest.Mocked<AgentProviderFactory>;
  let chatFilterFactory: jest.Mocked<ChatFilterFactory>;
  let mockServer: Partial<Server>;
  let mockSocket: Partial<Socket>;
  const mockAgent: AgentEntity = {
    id: 'test-uuid-123',
    name: 'Test Agent',
    description: 'Test Description',
    hashedPassword: 'hashed-password',
    containerId: 'container-123',
    agentType: 'cursor',
    containerType: ContainerType.GENERIC,
    browserPreviewEnabled: false,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };
  const mockAgentResponse = {
    id: mockAgent.id,
    name: mockAgent.name,
    description: mockAgent.description,
    agentType: mockAgent.agentType,
    containerType: mockAgent.containerType,
    createdAt: mockAgent.createdAt,
    updatedAt: mockAgent.updatedAt,
  };
  const mockAgentsService = {
    verifyCredentials: jest.fn(),
    findOne: jest.fn(),
  };
  const mockAgentsRepository = {
    findById: jest.fn(),
    findByName: jest.fn(),
  };
  const mockDockerService = {
    sendCommandToContainer: jest.fn(),
  } as unknown as jest.Mocked<DockerService>;
  const mockAgentMessagesService = {
    createUserMessage: jest.fn(),
    createAgentMessage: jest.fn(),
    getChatHistory: jest.fn(),
    countMessages: jest.fn(),
  };
  const mockAgentMessageEventsService = {
    persistEvent: jest.fn(),
    listRecentEvents: jest.fn().mockResolvedValue([]),
  };
  const mockAgentProvider: jest.Mocked<AgentProvider> = {
    getType: jest.fn().mockReturnValue('cursor'),
    getDisplayName: jest.fn().mockReturnValue('Cursor'),
    getCapabilities: jest.fn().mockReturnValue({
      supportsChat: true,
      supportsStreaming: false,
      supportsToolEvents: false,
      supportsQuestions: false,
    }),
    getDockerImage: jest.fn().mockReturnValue('ghcr.io/forepath/agenstra-manager-worker:latest'),
    getVirtualWorkspaceDockerImage: jest.fn().mockReturnValue('ghcr.io/forepath/agenstra-manager-vnc:latest'),
    getSshConnectionDockerImage: jest.fn().mockReturnValue('ghcr.io/forepath/agenstra-manager-ssh:latest'),
    sendMessage: jest.fn(),
    sendInitialization: jest.fn(),
    toParseableStrings: jest.fn(),
    toUnifiedResponse: jest.fn(),
    getModelsListCommand: jest.fn().mockReturnValue('cursor-agent --list-models'),
    toModelsList: jest.fn().mockReturnValue({}),
  };
  const mockAgentProviderFactory = {
    getProvider: jest.fn().mockReturnValue(mockAgentProvider),
    registerProvider: jest.fn(),
    hasProvider: jest.fn(),
    getRegisteredTypes: jest.fn(),
  } as unknown as jest.Mocked<AgentProviderFactory>;
  const mockChatFilterFactory = {
    getFiltersByDirection: jest.fn().mockReturnValue([]),
    getAllFilters: jest.fn().mockReturnValue([]),
    getFilter: jest.fn(),
    hasFilter: jest.fn(),
    getRegisteredTypes: jest.fn(),
    registerFilter: jest.fn(),
  } as unknown as jest.Mocked<ChatFilterFactory>;
  const mockPromptContextComposerService = {
    composeChatMessage: jest.fn((message: string) => message),
    composeEnhanceMessage: jest.fn((message: string) => message),
    composeTicketBodyMessage: jest.fn((title: string) => title),
  };
  const mockAgentSessionHydrationService = {
    consumePendingSummary: jest.fn().mockReturnValue(undefined),
  };
  let gitStateBroadcaster: ((agentId: string) => void) | undefined;
  const mockGitStateBroadcast = {
    registerBroadcaster: jest.fn((broadcaster: (agentId: string) => void) => {
      gitStateBroadcaster = broadcaster;
    }),
    notifyGitStateMayHaveChanged: jest.fn((agentId: string) => {
      gitStateBroadcaster?.(agentId);
    }),
  };
  const mockBrowserPreviewService = {
    startSession: jest.fn(),
    stopSession: jest.fn(),
    stopSessionsForSocket: jest.fn(),
    hasSession: jest.fn().mockReturnValue(false),
    dispatchInput: jest.fn(),
  };

  beforeEach(async () => {
    gitStateBroadcaster = undefined;
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentsGateway,
        {
          provide: AgentsService,
          useValue: mockAgentsService,
        },
        {
          provide: AgentsRepository,
          useValue: mockAgentsRepository,
        },
        {
          provide: DockerService,
          useValue: mockDockerService,
        },
        {
          provide: AgentMessagesService,
          useValue: mockAgentMessagesService,
        },
        {
          provide: AgentMessageEventsService,
          useValue: mockAgentMessageEventsService,
        },
        {
          provide: AgentProviderFactory,
          useValue: mockAgentProviderFactory,
        },
        {
          provide: ChatFilterFactory,
          useValue: mockChatFilterFactory,
        },
        {
          provide: PromptContextComposerService,
          useValue: mockPromptContextComposerService,
        },
        {
          provide: AgentSessionHydrationService,
          useValue: mockAgentSessionHydrationService,
        },
        {
          provide: AgentGitStateBroadcastService,
          useValue: mockGitStateBroadcast,
        },
        {
          provide: BrowserPreviewService,
          useValue: mockBrowserPreviewService,
        },
      ],
    }).compile();

    gateway = module.get<AgentsGateway>(AgentsGateway);
    gateway.onModuleInit();
    agentsService = module.get(AgentsService);
    agentsRepository = module.get(AgentsRepository);
    dockerService = module.get(DockerService);
    agentMessagesService = module.get(AgentMessagesService);
    agentProviderFactory = module.get(AgentProviderFactory);
    chatFilterFactory = module.get(ChatFilterFactory);

    // Setup mock server
    mockServer = {
      emit: jest.fn(),
    };
    gateway.server = mockServer as Server;

    // Setup mock socket
    mockSocket = {
      id: 'test-socket-id',
      emit: jest.fn(),
      connected: true,
    };

    // Setup default mocks
    agentMessagesService.getChatHistory.mockResolvedValue([]);
    agentMessagesService.countMessages.mockResolvedValue(0);
    // Mock getContainerStats and getContainerStatus
    dockerService.getContainerStats = jest.fn();
    dockerService.getContainerStatus = jest.fn().mockResolvedValue({ running: true });
  });

  afterEach(() => {
    jest.clearAllMocks();
    // Clear authenticated clients map and socket references
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (gateway as any).authenticatedClients.clear();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (gateway as any).socketById.clear();
    // Clear agents with first message sent tracking
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (gateway as any).agentsWithFirstMessageSent.clear();
    // Clear stats intervals
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const statsIntervals = (gateway as any).statsIntervalsByAgent;

    if (statsIntervals) {
      for (const interval of statsIntervals.values()) {
        clearInterval(interval);
      }

      statsIntervals.clear();
    }

    // Reset default mocks
    agentMessagesService.getChatHistory.mockResolvedValue([]);
    agentMessagesService.countMessages.mockResolvedValue(0);
  });

  describe('handleConnection', () => {
    it('should log connection and store socket reference', () => {
      const loggerSpy = jest.spyOn(gateway['logger'], 'log').mockImplementation();

      gateway.handleConnection(mockSocket as Socket);
      expect(loggerSpy).toHaveBeenCalledWith(`Client connected: ${mockSocket.id}`);
      // Verify socket is stored
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((gateway as any).socketById.get(mockSocket.id)).toBe(mockSocket);
      loggerSpy.mockRestore();
    });
  });

  describe('handleDisconnect', () => {
    it('should log disconnection and clean up authenticated session and socket reference', () => {
      const loggerSpy = jest.spyOn(gateway['logger'], 'log').mockImplementation();
      // Add authenticated session and socket reference
      const socketId = mockSocket.id || 'test-socket-id';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).authenticatedClients.set(socketId, mockAgent.id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).socketById.set(socketId, mockSocket);
      gateway.handleDisconnect(mockSocket as Socket);
      expect(loggerSpy).toHaveBeenCalledWith(`Client disconnected: ${socketId}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((gateway as any).authenticatedClients.has(socketId)).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((gateway as any).socketById.has(socketId)).toBe(false);
      loggerSpy.mockRestore();
    });

    it('should clean up session even if not authenticated', () => {
      const loggerSpy = jest.spyOn(gateway['logger'], 'log').mockImplementation();
      // Store socket reference
      const socketId = mockSocket.id || 'test-socket-id';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).socketById.set(socketId, mockSocket);
      gateway.handleDisconnect(mockSocket as Socket);
      expect(loggerSpy).toHaveBeenCalledWith(`Client disconnected: ${socketId}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((gateway as any).authenticatedClients.has(socketId)).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((gateway as any).socketById.has(socketId)).toBe(false);
      loggerSpy.mockRestore();
    });
  });

  describe('handleLogin', () => {
    it('should authenticate successfully with UUID', async () => {
      agentsRepository.findById.mockResolvedValue(mockAgent);
      agentsService.verifyCredentials.mockResolvedValue(true);
      agentsService.findOne.mockResolvedValue(mockAgentResponse);
      const socketId = mockSocket.id || 'test-socket-id';

      await gateway.handleLogin({ agentId: mockAgent.id, password: 'password123' }, mockSocket as Socket);

      expect(agentsRepository.findById).toHaveBeenCalledWith(mockAgent.id);
      expect(agentsService.verifyCredentials).toHaveBeenCalledWith(mockAgent.id, 'password123');
      expect(agentsService.findOne).toHaveBeenCalledWith(mockAgent.id);
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'loginSuccess',
        expect.objectContaining({
          success: true,
          data: {
            message: `Welcome, ${mockAgent.name}!`,
            agentId: mockAgent.id,
            agentName: mockAgent.name,
          },
          timestamp: expect.any(String),
        }),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((gateway as any).authenticatedClients.get(socketId)).toBe(mockAgent.id);
    });

    it('should restore chat history after successful login', async () => {
      agentsRepository.findById.mockResolvedValue(mockAgent);
      agentsService.verifyCredentials.mockResolvedValue(true);
      agentsService.findOne.mockResolvedValue(mockAgentResponse);

      const mockMessages = [
        {
          id: 'msg-1',
          agentId: mockAgent.id,
          agent: mockAgent,
          actor: 'user',
          message: 'Hello',
          createdAt: new Date('2024-01-01T10:00:00Z'),
          updatedAt: new Date('2024-01-01T10:00:00Z'),
        },
        {
          id: 'msg-2',
          agentId: mockAgent.id,
          agent: mockAgent,
          actor: 'agent',
          message: '{"type":"response","result":"Hi there!"}',
          createdAt: new Date('2024-01-01T10:00:01Z'),
          updatedAt: new Date('2024-01-01T10:00:01Z'),
        },
        {
          id: 'msg-3',
          agentId: mockAgent.id,
          agent: mockAgent,
          actor: 'user',
          message: 'How are you?',
          createdAt: new Date('2024-01-01T10:00:02Z'),
          updatedAt: new Date('2024-01-01T10:00:02Z'),
        },
      ];

      agentMessagesService.countMessages.mockResolvedValue(mockMessages.length);
      agentMessagesService.getChatHistory.mockResolvedValue(mockMessages as any);

      await gateway.handleLogin({ agentId: mockAgent.id, password: 'password123' }, mockSocket as Socket);

      // Verify chat history was fetched
      // With 3 messages, offset = max(0, 3 - 20) = 0
      expect(agentMessagesService.countMessages).toHaveBeenCalledWith(mockAgent.id);
      expect(agentMessagesService.getChatHistory).toHaveBeenCalledWith(mockAgent.id, 20, 0);

      // Verify messages were emitted in chronological order
      expect(mockSocket.emit).toHaveBeenCalledTimes(4); // loginSuccess + 3 chat messages

      // Check first message (user)
      expect(mockSocket.emit).toHaveBeenNthCalledWith(
        2,
        'chatMessage',
        expect.objectContaining({
          success: true,
          data: {
            from: 'user',
            text: 'Hello',
            timestamp: '2024-01-01T10:00:00.000Z',
          },
        }),
      );

      // Check second message (agent with JSON)
      expect(mockSocket.emit).toHaveBeenNthCalledWith(
        3,
        'chatMessage',
        expect.objectContaining({
          success: true,
          data: {
            from: 'agent',
            response: { type: 'response', result: 'Hi there!' },
            timestamp: '2024-01-01T10:00:01.000Z',
          },
        }),
      );

      // Check third message (user)
      expect(mockSocket.emit).toHaveBeenNthCalledWith(
        4,
        'chatMessage',
        expect.objectContaining({
          success: true,
          data: {
            from: 'user',
            text: 'How are you?',
            timestamp: '2024-01-01T10:00:02.000Z',
          },
        }),
      );
    });

    it('should handle agent messages with non-JSON strings (applies cleaning logic)', async () => {
      agentsRepository.findById.mockResolvedValue(mockAgent);
      agentsService.verifyCredentials.mockResolvedValue(true);
      agentsService.findOne.mockResolvedValue(mockAgentResponse);

      // Simulate a stored message that's already cleaned (from failed parse)
      // This would be stored as 'toParse' - a cleaned string without surrounding text
      const mockMessages = [
        {
          id: 'msg-1',
          agentId: mockAgent.id,
          agent: mockAgent,
          actor: 'agent',
          message: 'Plain text response', // Already cleaned (no { or } to clean)
          createdAt: new Date('2024-01-01T10:00:00Z'),
          updatedAt: new Date('2024-01-01T10:00:00Z'),
        },
      ];

      agentMessagesService.countMessages.mockResolvedValue(mockMessages.length);
      agentMessagesService.getChatHistory.mockResolvedValue(mockMessages as any);

      await gateway.handleLogin({ agentId: mockAgent.id, password: 'password123' }, mockSocket as Socket);

      // Verify message was emitted with string response (after cleaning logic is applied)
      // Since there's no { or }, cleaning won't change it, and parsing will fail, so it uses the cleaned string
      expect(mockSocket.emit).toHaveBeenNthCalledWith(
        2,
        'chatMessage',
        expect.objectContaining({
          success: true,
          data: {
            from: 'agent',
            response: 'Plain text response', // Cleaned string (same as input since no { or })
            timestamp: expect.any(String),
          },
        }),
      );
    });

    it('should apply cleaning logic to agent messages during restoration (same as live)', async () => {
      agentsRepository.findById.mockResolvedValue(mockAgent);
      agentsService.verifyCredentials.mockResolvedValue(true);
      agentsService.findOne.mockResolvedValue(mockAgentResponse);

      // Simulate a stored message that might have extra text (though this shouldn't happen in practice)
      // This tests that cleaning logic is applied consistently
      const mockMessages = [
        {
          id: 'msg-1',
          agentId: mockAgent.id,
          agent: mockAgent,
          actor: 'agent',
          message: 'Some prefix text {"type":"response","result":"Success"} some suffix',
          createdAt: new Date('2024-01-01T10:00:00Z'),
          updatedAt: new Date('2024-01-01T10:00:00Z'),
        },
      ];

      agentMessagesService.countMessages.mockResolvedValue(mockMessages.length);
      agentMessagesService.getChatHistory.mockResolvedValue(mockMessages as any);

      await gateway.handleLogin({ agentId: mockAgent.id, password: 'password123' }, mockSocket as Socket);

      // Verify cleaning logic was applied and JSON was parsed (same as live communication)
      expect(mockSocket.emit).toHaveBeenNthCalledWith(
        2,
        'chatMessage',
        expect.objectContaining({
          success: true,
          data: {
            from: 'agent',
            response: { type: 'response', result: 'Success' }, // Parsed JSON object
            timestamp: expect.any(String),
          },
        }),
      );
    });

    it('should handle empty chat history gracefully', async () => {
      agentsRepository.findById.mockResolvedValue(mockAgent);
      agentsService.verifyCredentials.mockResolvedValue(true);
      agentsService.findOne.mockResolvedValue(mockAgentResponse);
      agentMessagesService.countMessages.mockResolvedValue(0);
      agentMessagesService.getChatHistory.mockResolvedValue([]);

      await gateway.handleLogin({ agentId: mockAgent.id, password: 'password123' }, mockSocket as Socket);

      // Verify chat history was fetched
      // With 0 messages, offset = max(0, 0 - 20) = 0
      expect(agentMessagesService.countMessages).toHaveBeenCalledWith(mockAgent.id);
      expect(agentMessagesService.getChatHistory).toHaveBeenCalledWith(mockAgent.id, 20, 0);

      // Only loginSuccess should be emitted
      expect(mockSocket.emit).toHaveBeenCalledTimes(1);
      expect(mockSocket.emit).toHaveBeenCalledWith('loginSuccess', expect.any(Object));
    });

    it('should continue login even if chat history restoration fails', async () => {
      agentsRepository.findById.mockResolvedValue(mockAgent);
      agentsService.verifyCredentials.mockResolvedValue(true);
      agentsService.findOne.mockResolvedValue(mockAgentResponse);
      agentMessagesService.countMessages.mockResolvedValue(0);
      agentMessagesService.getChatHistory.mockRejectedValue(new Error('Database error'));

      const loggerWarnSpy = jest.spyOn(gateway['logger'], 'warn').mockImplementation();

      await gateway.handleLogin({ agentId: mockAgent.id, password: 'password123' }, mockSocket as Socket);

      // Login should still succeed
      expect(mockSocket.emit).toHaveBeenCalledWith('loginSuccess', expect.any(Object));
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to restore chat history'),
        expect.any(String),
      );

      loggerWarnSpy.mockRestore();
    });

    it('should send messageFilterResult for filtered user messages during restoration', async () => {
      agentsRepository.findById.mockResolvedValue(mockAgent);
      agentsService.verifyCredentials.mockResolvedValue(true);
      agentsService.findOne.mockResolvedValue(mockAgentResponse);

      const mockMessages = [
        {
          id: 'msg-1',
          agentId: mockAgent.id,
          agent: mockAgent,
          actor: 'user',
          message: 'Filtered message',
          filtered: true,
          createdAt: new Date('2024-01-01T10:00:00Z'),
          updatedAt: new Date('2024-01-01T10:00:00Z'),
        },
        {
          id: 'msg-2',
          agentId: mockAgent.id,
          agent: mockAgent,
          actor: 'user',
          message: 'Normal message',
          filtered: false,
          createdAt: new Date('2024-01-01T10:00:01Z'),
          updatedAt: new Date('2024-01-01T10:00:01Z'),
        },
      ];

      agentMessagesService.countMessages.mockResolvedValue(mockMessages.length);
      agentMessagesService.getChatHistory.mockResolvedValue(mockMessages as any);

      await gateway.handleLogin({ agentId: mockAgent.id, password: 'password123' }, mockSocket as Socket);

      // Verify filter result was sent before the filtered message
      expect(mockSocket.emit).toHaveBeenNthCalledWith(
        2,
        'messageFilterResult',
        expect.objectContaining({
          success: true,
          data: {
            direction: 'incoming',
            status: 'filtered',
            message: 'Filtered message',
            appliedFilters: [],
            matchedFilter: undefined,
            action: 'flag',
            timestamp: '2024-01-01T10:00:00.000Z',
          },
        }),
      );

      // Verify filtered message was sent after filter result
      expect(mockSocket.emit).toHaveBeenNthCalledWith(
        3,
        'chatMessage',
        expect.objectContaining({
          success: true,
          data: {
            from: 'user',
            text: 'Filtered message',
            timestamp: '2024-01-01T10:00:00.000Z',
          },
        }),
      );

      // Verify normal message was sent without filter result
      expect(mockSocket.emit).toHaveBeenNthCalledWith(
        4,
        'chatMessage',
        expect.objectContaining({
          success: true,
          data: {
            from: 'user',
            text: 'Normal message',
            timestamp: '2024-01-01T10:00:01.000Z',
          },
        }),
      );

      // Should not send filter result for non-filtered message
      const filterResultCalls = (mockSocket.emit as jest.Mock).mock.calls.filter(
        (call) => call[0] === 'messageFilterResult',
      );

      expect(filterResultCalls).toHaveLength(1); // Only one filter result for the filtered message
    });

    it('should send messageFilterResult for filtered agent messages during restoration', async () => {
      agentsRepository.findById.mockResolvedValue(mockAgent);
      agentsService.verifyCredentials.mockResolvedValue(true);
      agentsService.findOne.mockResolvedValue(mockAgentResponse);

      const mockMessages = [
        {
          id: 'msg-1',
          agentId: mockAgent.id,
          agent: mockAgent,
          actor: 'agent',
          message: '{"type":"response","result":"Filtered response"}',
          filtered: true,
          createdAt: new Date('2024-01-01T10:00:00Z'),
          updatedAt: new Date('2024-01-01T10:00:00Z'),
        },
        {
          id: 'msg-2',
          agentId: mockAgent.id,
          agent: mockAgent,
          actor: 'agent',
          message: '{"type":"response","result":"Normal response"}',
          filtered: false,
          createdAt: new Date('2024-01-01T10:00:01Z'),
          updatedAt: new Date('2024-01-01T10:00:01Z'),
        },
      ];

      agentMessagesService.countMessages.mockResolvedValue(mockMessages.length);
      agentMessagesService.getChatHistory.mockResolvedValue(mockMessages as any);

      await gateway.handleLogin({ agentId: mockAgent.id, password: 'password123' }, mockSocket as Socket);

      // Verify filter result was sent before the filtered agent message
      expect(mockSocket.emit).toHaveBeenNthCalledWith(
        2,
        'messageFilterResult',
        expect.objectContaining({
          success: true,
          data: {
            direction: 'outgoing',
            status: 'filtered',
            message: '{"type":"response","result":"Filtered response"}',
            appliedFilters: [],
            matchedFilter: undefined,
            action: 'flag',
            timestamp: '2024-01-01T10:00:00.000Z',
          },
        }),
      );

      // Verify filtered agent message was sent after filter result
      expect(mockSocket.emit).toHaveBeenNthCalledWith(
        3,
        'chatMessage',
        expect.objectContaining({
          success: true,
          data: {
            from: 'agent',
            response: { type: 'response', result: 'Filtered response' },
            timestamp: '2024-01-01T10:00:00.000Z',
          },
        }),
      );

      // Verify normal agent message was sent without filter result
      expect(mockSocket.emit).toHaveBeenNthCalledWith(
        4,
        'chatMessage',
        expect.objectContaining({
          success: true,
          data: {
            from: 'agent',
            response: { type: 'response', result: 'Normal response' },
            timestamp: '2024-01-01T10:00:01.000Z',
          },
        }),
      );

      // Should not send filter result for non-filtered message
      const filterResultCalls = (mockSocket.emit as jest.Mock).mock.calls.filter(
        (call) => call[0] === 'messageFilterResult',
      );

      expect(filterResultCalls).toHaveLength(1); // Only one filter result for the filtered message
    });

    it('should send messageFilterResult events in correct chronological order during restoration', async () => {
      agentsRepository.findById.mockResolvedValue(mockAgent);
      agentsService.verifyCredentials.mockResolvedValue(true);
      agentsService.findOne.mockResolvedValue(mockAgentResponse);

      const mockMessages = [
        {
          id: 'msg-1',
          agentId: mockAgent.id,
          agent: mockAgent,
          actor: 'user',
          message: 'First message',
          filtered: false,
          createdAt: new Date('2024-01-01T10:00:00Z'),
          updatedAt: new Date('2024-01-01T10:00:00Z'),
        },
        {
          id: 'msg-2',
          agentId: mockAgent.id,
          agent: mockAgent,
          actor: 'user',
          message: 'Filtered message',
          filtered: true,
          createdAt: new Date('2024-01-01T10:00:01Z'),
          updatedAt: new Date('2024-01-01T10:00:01Z'),
        },
        {
          id: 'msg-3',
          agentId: mockAgent.id,
          agent: mockAgent,
          actor: 'agent',
          message: '{"type":"response","result":"Agent response"}',
          filtered: true,
          createdAt: new Date('2024-01-01T10:00:02Z'),
          updatedAt: new Date('2024-01-01T10:00:02Z'),
        },
        {
          id: 'msg-4',
          agentId: mockAgent.id,
          agent: mockAgent,
          actor: 'user',
          message: 'Last message',
          filtered: false,
          createdAt: new Date('2024-01-01T10:00:03Z'),
          updatedAt: new Date('2024-01-01T10:00:03Z'),
        },
      ];

      agentMessagesService.countMessages.mockResolvedValue(mockMessages.length);
      agentMessagesService.getChatHistory.mockResolvedValue(mockMessages as any);

      await gateway.handleLogin({ agentId: mockAgent.id, password: 'password123' }, mockSocket as Socket);

      // Get all emit calls
      const emitCalls = (mockSocket.emit as jest.Mock).mock.calls;

      // Verify loginSuccess was called first
      expect(emitCalls[0][0]).toBe('loginSuccess');

      // Find positions of filter results and messages
      const filterResultIndices: number[] = [];
      const chatMessageIndices: number[] = [];

      emitCalls.forEach((call, index) => {
        if (call[0] === 'messageFilterResult') {
          filterResultIndices.push(index);
        } else if (call[0] === 'chatMessage') {
          chatMessageIndices.push(index);
        }
      });

      // Verify we have 2 filter results (for msg-2 and msg-3)
      expect(filterResultIndices).toHaveLength(2);
      // Verify we have 4 chat messages
      expect(chatMessageIndices).toHaveLength(4);

      // Verify filter result for "Filtered message" comes before its chat message
      const filteredUserMessageIndex = emitCalls.findIndex(
        (call) => call[0] === 'chatMessage' && call[1]?.data?.text === 'Filtered message',
      );
      const incomingFilterResultIndex = emitCalls.findIndex(
        (call) => call[0] === 'messageFilterResult' && call[1]?.data?.direction === 'incoming',
      );

      expect(incomingFilterResultIndex).toBeLessThan(filteredUserMessageIndex);

      // Verify filter result for agent message comes before its chat message
      const filteredAgentMessageIndex = emitCalls.findIndex(
        (call) =>
          call[0] === 'chatMessage' &&
          call[1]?.data?.from === 'agent' &&
          call[1]?.data?.response?.result === 'Agent response',
      );
      const outgoingFilterResultIndex = emitCalls.findIndex(
        (call) => call[0] === 'messageFilterResult' && call[1]?.data?.direction === 'outgoing',
      );

      expect(outgoingFilterResultIndex).toBeLessThan(filteredAgentMessageIndex);

      // Verify total calls: 1 loginSuccess + 4 messages + 2 filter results = 7
      expect(emitCalls).toHaveLength(7);
    });

    it('should authenticate successfully with agent name', async () => {
      agentsRepository.findById.mockResolvedValue(null);
      agentsRepository.findByName.mockResolvedValue(mockAgent);
      agentsService.verifyCredentials.mockResolvedValue(true);
      agentsService.findOne.mockResolvedValue(mockAgentResponse);

      await gateway.handleLogin({ agentId: mockAgent.name, password: 'password123' }, mockSocket as Socket);

      expect(agentsRepository.findById).toHaveBeenCalledWith(mockAgent.name);
      expect(agentsRepository.findByName).toHaveBeenCalledWith(mockAgent.name);
      expect(agentsService.verifyCredentials).toHaveBeenCalledWith(mockAgent.id, 'password123');
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'loginSuccess',
        expect.objectContaining({
          success: true,
          data: {
            message: `Welcome, ${mockAgent.name}!`,
            agentId: mockAgent.id,
            agentName: mockAgent.name,
          },
          timestamp: expect.any(String),
        }),
      );
    });

    it('should reject login with invalid UUID/name', async () => {
      agentsRepository.findById.mockResolvedValue(null);
      agentsRepository.findByName.mockResolvedValue(null);
      const loggerWarnSpy = jest.spyOn(gateway['logger'], 'warn').mockImplementation();
      const socketId = mockSocket.id || 'test-socket-id';

      await gateway.handleLogin({ agentId: 'non-existent', password: 'password123' }, mockSocket as Socket);

      expect(mockSocket.emit).toHaveBeenCalledWith(
        'loginError',
        expect.objectContaining({
          success: false,
          error: {
            message: 'Invalid credentials',
            code: 'INVALID_CREDENTIALS',
          },
          timestamp: expect.any(String),
        }),
      );
      expect(loggerWarnSpy).toHaveBeenCalledWith(`Failed login attempt: agent not found (non-existent)`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((gateway as any).authenticatedClients.has(socketId)).toBe(false);
      loggerWarnSpy.mockRestore();
    });

    it('should reject login with wrong password', async () => {
      agentsRepository.findById.mockResolvedValue(mockAgent);
      agentsService.verifyCredentials.mockResolvedValue(false);
      const loggerWarnSpy = jest.spyOn(gateway['logger'], 'warn').mockImplementation();
      const socketId = mockSocket.id || 'test-socket-id';

      await gateway.handleLogin({ agentId: mockAgent.id, password: 'wrong-password' }, mockSocket as Socket);

      expect(agentsService.verifyCredentials).toHaveBeenCalledWith(mockAgent.id, 'wrong-password');
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'loginError',
        expect.objectContaining({
          success: false,
          error: {
            message: 'Invalid credentials',
            code: 'INVALID_CREDENTIALS',
          },
          timestamp: expect.any(String),
        }),
      );
      expect(loggerWarnSpy).toHaveBeenCalledWith(`Failed login attempt: invalid password for agent ${mockAgent.id}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((gateway as any).authenticatedClients.has(socketId)).toBe(false);
      loggerWarnSpy.mockRestore();
    });

    it('should handle errors gracefully', async () => {
      agentsRepository.findById.mockRejectedValue(new Error('Database error'));
      const loggerErrorSpy = jest.spyOn(gateway['logger'], 'error').mockImplementation();

      await gateway.handleLogin({ agentId: mockAgent.id, password: 'password123' }, mockSocket as Socket);

      expect(mockSocket.emit).toHaveBeenCalledWith(
        'loginError',
        expect.objectContaining({
          success: false,
          error: {
            message: 'Invalid credentials',
            code: 'LOGIN_ERROR',
          },
          timestamp: expect.any(String),
        }),
      );
      expect(loggerErrorSpy).toHaveBeenCalled();
      loggerErrorSpy.mockRestore();
    });
  });

  describe('handleChat', () => {
    it('injects hidden hydration summary once when pending summary exists', async () => {
      const socketId = mockSocket.id || 'test-socket-id';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).authenticatedClients.set(socketId, mockAgent.id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).socketById.set(socketId, mockSocket);
      agentsService.findOne.mockResolvedValue(mockAgentResponse);
      agentsRepository.findById.mockResolvedValue(mockAgent);
      agentMessagesService.getChatHistory.mockResolvedValue([
        {
          id: 'msg-1',
          agentId: mockAgent.id,
          agent: mockAgent,
          actor: 'user',
          message: 'Previous message',
          filtered: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      mockAgentSessionHydrationService.consumePendingSummary
        .mockReturnValueOnce('- preserve decision history')
        .mockReturnValue(undefined);
      mockAgentProvider.sendMessage.mockResolvedValue('');

      await gateway.handleChat({ message: 'Hello, world!' }, mockSocket as Socket);
      await gateway.handleChat({ message: 'Follow up' }, mockSocket as Socket);

      expect(mockAgentProvider.sendMessage).toHaveBeenNthCalledWith(
        1,
        mockAgent.id,
        'container-123',
        expect.stringContaining('[SYSTEM INTERNAL - HIDDEN HYDRATION CONTEXT]'),
        {},
      );
      expect(mockAgentProvider.sendMessage).toHaveBeenNthCalledWith(
        1,
        mockAgent.id,
        'container-123',
        expect.stringContaining('- preserve decision history'),
        {},
      );
      expect(mockAgentProvider.sendMessage).toHaveBeenNthCalledWith(2, mockAgent.id, 'container-123', 'Follow up', {});
    });

    it('should broadcast chat message for authenticated user and emit agent response', async () => {
      const socketId = mockSocket.id || 'test-socket-id';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).authenticatedClients.set(socketId, mockAgent.id);
      // Store socket reference for broadcasting
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).socketById.set(socketId, mockSocket);
      agentsService.findOne.mockResolvedValue(mockAgentResponse);
      agentsRepository.findById.mockResolvedValue(mockAgent);
      // Mock chat history to return existing messages (so initialization is skipped)
      agentMessagesService.getChatHistory.mockResolvedValue([
        {
          id: 'msg-1',
          agentId: mockAgent.id,
          agent: mockAgent,
          actor: 'user',
          message: 'Previous message',
          filtered: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      const mockAgentResponseJson = JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'Hello from agent!',
      });
      const mockParsedResponse = {
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'Hello from agent!',
      };

      mockAgentProvider.sendMessage.mockResolvedValue(mockAgentResponseJson);
      mockAgentProvider.toParseableStrings.mockReturnValue([mockAgentResponseJson]);
      mockAgentProvider.toUnifiedResponse.mockReturnValue(mockParsedResponse);
      const loggerLogSpy = jest.spyOn(gateway['logger'], 'log').mockImplementation();

      await gateway.handleChat({ message: 'Hello, world!' }, mockSocket as Socket);

      expect(agentsService.findOne).toHaveBeenCalledWith(mockAgent.id);
      expect(loggerLogSpy).toHaveBeenCalledWith(`Agent ${mockAgent.name} (${mockAgent.id}) says: Hello, world!`);
      // Check user message emission - now uses socket.emit via broadcastToAgent
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'chatMessage',
        expect.objectContaining({
          success: true,
          data: {
            from: 'user',
            text: 'Hello, world!',
            timestamp: expect.any(String),
          },
          timestamp: expect.any(String),
        }),
      );
      expect(agentProviderFactory.getProvider).toHaveBeenCalledWith('cursor');
      expect(mockAgentProvider.sendMessage).toHaveBeenCalledWith(mockAgent.id, 'container-123', 'Hello, world!', {});
      // Check agent response emission with parsed JSON - now uses socket.emit via broadcastToAgent
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'chatMessage',
        expect.objectContaining({
          success: true,
          data: {
            from: 'agent',
            response: {
              type: 'result',
              subtype: 'success',
              is_error: false,
              result: 'Hello from agent!',
            },
            timestamp: expect.any(String),
          },
          timestamp: expect.any(String),
        }),
      );
      loggerLogSpy.mockRestore();
    });

    it('should include model flag in container command when provided', async () => {
      const socketId = mockSocket.id || 'test-socket-id';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).authenticatedClients.set(socketId, mockAgent.id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).socketById.set(socketId, mockSocket);
      agentsService.findOne.mockResolvedValue(mockAgentResponse);
      agentsRepository.findById.mockResolvedValue(mockAgent);
      // Mock chat history to return existing messages (so initialization is skipped)
      agentMessagesService.getChatHistory.mockResolvedValue([
        {
          id: 'msg-1',
          agentId: mockAgent.id,
          agent: mockAgent,
          actor: 'user',
          message: 'Previous message',
          filtered: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      mockAgentProvider.sendMessage.mockResolvedValue('');

      await gateway.handleChat({ message: 'Use custom model', model: 'gpt-4.1' }, mockSocket as Socket);

      expect(mockAgentProvider.sendMessage).toHaveBeenCalledWith(
        mockAgent.id,
        mockAgent.containerId,
        'Use custom model',
        { model: 'gpt-4.1' },
      );
    });

    it('should reject chat message from unauthenticated user', async () => {
      await gateway.handleChat({ message: 'Hello, world!' }, mockSocket as Socket);

      expect(mockSocket.emit).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({
          success: false,
          error: {
            message: 'Unauthorized. Please login first.',
            code: 'UNAUTHORIZED',
          },
          timestamp: expect.any(String),
        }),
      );
      expect(mockServer.emit).not.toHaveBeenCalled();
    });

    it('should ignore empty messages', async () => {
      const socketId = mockSocket.id || 'test-socket-id';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).authenticatedClients.set(socketId, mockAgent.id);

      await gateway.handleChat({ message: '   ' }, mockSocket as Socket);

      expect(agentsService.findOne).not.toHaveBeenCalled();
      expect(mockServer.emit).not.toHaveBeenCalled();
    });

    it('should ignore messages with only whitespace', async () => {
      const socketId = mockSocket.id || 'test-socket-id';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).authenticatedClients.set(socketId, mockAgent.id);

      await gateway.handleChat({ message: '\n\t  \n' }, mockSocket as Socket);

      expect(agentsService.findOne).not.toHaveBeenCalled();
      expect(mockServer.emit).not.toHaveBeenCalled();
    });

    it('should handle missing message property', async () => {
      const socketId = mockSocket.id || 'test-socket-id';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).authenticatedClients.set(socketId, mockAgent.id);

      await gateway.handleChat({} as ChatPayload, mockSocket as Socket);

      expect(agentsService.findOne).not.toHaveBeenCalled();
      expect(mockServer.emit).not.toHaveBeenCalled();
    });

    it('should handle errors when fetching agent details', async () => {
      const socketId = mockSocket.id || 'test-socket-id';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).authenticatedClients.set(socketId, mockAgent.id);
      agentsService.findOne.mockRejectedValue(new Error('Database error'));
      const loggerErrorSpy = jest.spyOn(gateway['logger'], 'error').mockImplementation();

      await gateway.handleChat({ message: 'Hello!' }, mockSocket as Socket);

      expect(mockSocket.emit).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({
          success: false,
          error: {
            message: 'Error processing chat message',
            code: 'CHAT_ERROR',
          },
          timestamp: expect.any(String),
        }),
      );
      expect(loggerErrorSpy).toHaveBeenCalled();
      loggerErrorSpy.mockRestore();
    });

    it('should not emit agent response if response is empty', async () => {
      const socketId = mockSocket.id || 'test-socket-id';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).authenticatedClients.set(socketId, mockAgent.id);
      // Store socket reference for broadcasting
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).socketById.set(socketId, mockSocket);
      agentsService.findOne.mockResolvedValue(mockAgentResponse);
      agentsRepository.findById.mockResolvedValue(mockAgent);
      // Mock chat history to return existing messages (so initialization is skipped)
      agentMessagesService.getChatHistory.mockResolvedValue([
        {
          id: 'msg-1',
          agentId: mockAgent.id,
          agent: mockAgent,
          actor: 'user',
          message: 'Previous message',
          filtered: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      mockAgentProvider.sendMessage.mockResolvedValue('');
      const loggerLogSpy = jest.spyOn(gateway['logger'], 'log').mockImplementation();

      await gateway.handleChat({ message: 'Hello!' }, mockSocket as Socket);

      // Should emit user message - now uses socket.emit via broadcastToAgent
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'chatMessage',
        expect.objectContaining({
          success: true,
          data: {
            from: 'user',
            text: 'Hello!',
            timestamp: expect.any(String),
          },
          timestamp: expect.any(String),
        }),
      );
      // Should not emit agent response (empty)
      const agentResponseCalls = (mockSocket.emit as jest.Mock).mock.calls.filter(
        (call) => call[0] === 'chatMessage' && call[1].data?.from === 'agent',
      );

      expect(agentResponseCalls.length).toBe(0);
      loggerLogSpy.mockRestore();
    });

    it('should drop incoming message when filter returns drop action', async () => {
      const socketId = mockSocket.id || 'test-socket-id';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).authenticatedClients.set(socketId, mockAgent.id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).socketById.set(socketId, mockSocket);

      const mockFilter: jest.Mocked<ChatFilter> = {
        getType: jest.fn().mockReturnValue('test-filter'),
        getDisplayName: jest.fn().mockReturnValue('Test Filter'),
        getDirection: jest.fn().mockReturnValue(FilterDirection.INCOMING),
        filter: jest.fn().mockResolvedValue({
          filtered: true,
          action: 'drop',
          reason: 'Test filter matched',
        }),
      };

      chatFilterFactory.getFiltersByDirection.mockReturnValue([mockFilter]);
      agentMessagesService.createUserMessage.mockResolvedValue({
        id: 'dropped-msg',
        agentId: mockAgent.id,
        agent: mockAgent,
        actor: 'user',
        message: 'Message was dropped by filter: Test filter matched',
        filtered: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await gateway.handleChat({ message: 'test-filter' }, mockSocket as Socket);

      // Filter result should be broadcast (not persisted)
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'messageFilterResult',
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            direction: 'incoming',
            status: 'dropped',
          }),
        }),
      );

      // Fake user message with MESSAGE_DROPPED should be created and persisted (not agent message)
      expect(agentMessagesService.createUserMessage).toHaveBeenCalledWith(
        mockAgent.id,
        expect.stringContaining('Message was dropped by filter: Test filter matched'),
        false,
      );

      // Should NOT create agent message for dropped user messages
      expect(agentMessagesService.createAgentMessage).not.toHaveBeenCalled();

      // Fake user message should be broadcast (appears on user side, not agent side)
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'chatMessage',
        expect.objectContaining({
          success: true,
          data: {
            from: 'user',
            text: expect.stringContaining('Message was dropped by filter: Test filter matched'),
            timestamp: expect.any(String),
          },
        }),
      );

      // Original user message should not be persisted (only the fake dropped message is persisted)
      // The fake dropped message is already persisted via createUserMessage above
      expect(mockAgentProvider.sendMessage).not.toHaveBeenCalled();
      expect(mockFilter.filter).toHaveBeenCalledWith('test-filter', {
        agentId: mockAgent.id,
        actor: 'user',
      });
    });

    it('should flag incoming message when filter returns flag action', async () => {
      const socketId = mockSocket.id || 'test-socket-id';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).authenticatedClients.set(socketId, mockAgent.id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).socketById.set(socketId, mockSocket);
      agentsService.findOne.mockResolvedValue(mockAgentResponse);
      agentsRepository.findById.mockResolvedValue(mockAgent);
      agentMessagesService.getChatHistory.mockResolvedValue([
        {
          id: 'msg-1',
          agentId: mockAgent.id,
          agent: mockAgent,
          actor: 'user',
          message: 'Previous message',
          filtered: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      mockAgentProvider.sendMessage.mockResolvedValue('{}');

      const mockFilter: jest.Mocked<ChatFilter> = {
        getType: jest.fn().mockReturnValue('test-filter'),
        getDisplayName: jest.fn().mockReturnValue('Test Filter'),
        getDirection: jest.fn().mockReturnValue(FilterDirection.INCOMING),
        filter: jest.fn().mockResolvedValue({
          filtered: true,
          action: 'flag',
          reason: 'Test filter matched',
        }),
      };

      chatFilterFactory.getFiltersByDirection.mockReturnValue([mockFilter]);
      agentMessagesService.createUserMessage.mockResolvedValue({
        id: 'msg-2',
        agentId: mockAgent.id,
        agent: mockAgent,
        actor: 'user',
        message: 'test-filter',
        filtered: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      agentMessagesService.createAgentMessage.mockResolvedValue({
        id: 'filter-result-1',
        agentId: mockAgent.id,
        agent: mockAgent,
        actor: 'agent',
        message: JSON.stringify({ type: 'filter-result', direction: 'incoming', status: 'filtered' }),
        filtered: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await gateway.handleChat({ message: 'test-filter' }, mockSocket as Socket);

      // Filter result should be broadcast (not persisted)
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'messageFilterResult',
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            direction: 'incoming',
            status: 'filtered',
          }),
        }),
      );

      // Message should be processed but flagged
      expect(agentMessagesService.createUserMessage).toHaveBeenCalledWith(mockAgent.id, 'test-filter', true);
      expect(mockFilter.filter).toHaveBeenCalledWith('test-filter', {
        agentId: mockAgent.id,
        actor: 'user',
      });
    });

    it('should modify incoming message when filter returns modifiedMessage', async () => {
      const socketId = mockSocket.id || 'test-socket-id';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).authenticatedClients.set(socketId, mockAgent.id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).socketById.set(socketId, mockSocket);
      agentsService.findOne.mockResolvedValue(mockAgentResponse);
      agentsRepository.findById.mockResolvedValue(mockAgent);
      agentMessagesService.getChatHistory.mockResolvedValue([
        {
          id: 'msg-1',
          agentId: mockAgent.id,
          agent: mockAgent,
          actor: 'user',
          message: 'Previous message',
          filtered: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      mockAgentProvider.sendMessage.mockResolvedValue('{}');

      const modifiedMessage = 'Modified message content';
      const mockFilter: jest.Mocked<ChatFilter> = {
        getType: jest.fn().mockReturnValue('modify-filter'),
        getDisplayName: jest.fn().mockReturnValue('Modify Filter'),
        getDirection: jest.fn().mockReturnValue(FilterDirection.INCOMING),
        filter: jest.fn().mockResolvedValue({
          filtered: true,
          action: 'flag',
          reason: 'Message was modified',
          modifiedMessage,
        }),
      };

      chatFilterFactory.getFiltersByDirection.mockReturnValue([mockFilter]);
      agentMessagesService.createUserMessage.mockResolvedValue({
        id: 'msg-2',
        agentId: mockAgent.id,
        agent: mockAgent,
        actor: 'user',
        message: modifiedMessage,
        filtered: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await gateway.handleChat({ message: 'original message' }, mockSocket as Socket);

      // Filter result should include modified message
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'messageFilterResult',
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            direction: 'incoming',
            status: 'filtered',
            message: 'original message',
            modifiedMessage,
          }),
        }),
      );

      // Modified message should be used for broadcasting
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'chatMessage',
        expect.objectContaining({
          success: true,
          data: {
            from: 'user',
            text: modifiedMessage, // Modified message, not original
            timestamp: expect.any(String),
          },
        }),
      );

      // Modified message should be persisted
      expect(agentMessagesService.createUserMessage).toHaveBeenCalledWith(mockAgent.id, modifiedMessage, true);

      // Modified message should be sent to agent
      expect(mockAgentProvider.sendMessage).toHaveBeenCalledWith(
        mockAgent.id,
        mockAgent.containerId,
        modifiedMessage,
        {},
      );
    });

    it('should modify outgoing message when filter returns modifiedMessage', async () => {
      const socketId = mockSocket.id || 'test-socket-id';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).authenticatedClients.set(socketId, mockAgent.id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).socketById.set(socketId, mockSocket);
      agentsService.findOne.mockResolvedValue(mockAgentResponse);
      agentsRepository.findById.mockResolvedValue(mockAgent);
      agentMessagesService.getChatHistory.mockResolvedValue([
        {
          id: 'msg-1',
          agentId: mockAgent.id,
          agent: mockAgent,
          actor: 'user',
          message: 'Previous message',
          filtered: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const originalResponse = { type: 'response', result: 'Original response' };
      const modifiedResponseString = JSON.stringify({ type: 'response', result: 'Modified response' });
      const originalResponseString = JSON.stringify(originalResponse);

      mockAgentProvider.sendMessage.mockResolvedValue(originalResponseString);
      mockAgentProvider.toParseableStrings.mockReturnValue([originalResponseString]);
      mockAgentProvider.toUnifiedResponse.mockReturnValue(originalResponse);

      const mockIncomingFilter: jest.Mocked<ChatFilter> = {
        getType: jest.fn().mockReturnValue('incoming-filter'),
        getDisplayName: jest.fn().mockReturnValue('Incoming Filter'),
        getDirection: jest.fn().mockReturnValue(FilterDirection.INCOMING),
        filter: jest.fn().mockResolvedValue({ filtered: false }),
      };
      const mockOutgoingFilter: jest.Mocked<ChatFilter> = {
        getType: jest.fn().mockReturnValue('modify-filter'),
        getDisplayName: jest.fn().mockReturnValue('Modify Filter'),
        getDirection: jest.fn().mockReturnValue(FilterDirection.OUTGOING),
        filter: jest.fn().mockResolvedValue({
          filtered: true,
          action: 'flag',
          reason: 'Response was modified',
          modifiedMessage: modifiedResponseString,
        }),
      };

      chatFilterFactory.getFiltersByDirection
        .mockReturnValueOnce([mockIncomingFilter]) // For incoming
        .mockReturnValueOnce([mockOutgoingFilter]); // For outgoing

      agentMessagesService.createUserMessage.mockResolvedValue({
        id: 'msg-2',
        agentId: mockAgent.id,
        agent: mockAgent,
        actor: 'user',
        message: 'Hello',
        filtered: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      agentMessagesService.createAgentMessage.mockResolvedValue({
        id: 'msg-3',
        agentId: mockAgent.id,
        agent: mockAgent,
        actor: 'agent',
        message: modifiedResponseString,
        filtered: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await gateway.handleChat({ message: 'Hello' }, mockSocket as Socket);

      // Filter result should include modified message
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'messageFilterResult',
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            direction: 'outgoing',
            status: 'filtered',
            message: JSON.stringify(originalResponse),
            modifiedMessage: modifiedResponseString,
          }),
        }),
      );

      // Modified response should be broadcast
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'chatMessage',
        expect.objectContaining({
          success: true,
          data: {
            from: 'agent',
            response: { type: 'response', result: 'Modified response' }, // Modified response, not original
            timestamp: expect.any(String),
          },
        }),
      );

      // Modified response should be persisted
      expect(agentMessagesService.createAgentMessage).toHaveBeenCalledWith(
        mockAgent.id,
        { type: 'response', result: 'Modified response' },
        true,
      );
    });

    it('should not allow modifiedMessage when action is drop', async () => {
      const socketId = mockSocket.id || 'test-socket-id';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).authenticatedClients.set(socketId, mockAgent.id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).socketById.set(socketId, mockSocket);

      const mockFilter: jest.Mocked<ChatFilter> = {
        getType: jest.fn().mockReturnValue('drop-filter'),
        getDisplayName: jest.fn().mockReturnValue('Drop Filter'),
        getDirection: jest.fn().mockReturnValue(FilterDirection.INCOMING),
        filter: jest.fn().mockResolvedValue({
          filtered: true,
          action: 'drop',
          reason: 'Message should be dropped',
          modifiedMessage: 'This should be ignored', // Should be ignored for drop action
        }),
      };

      chatFilterFactory.getFiltersByDirection.mockReturnValue([mockFilter]);
      agentMessagesService.createUserMessage.mockResolvedValue({
        id: 'dropped-msg',
        agentId: mockAgent.id,
        agent: mockAgent,
        actor: 'user',
        message: 'Message was dropped by filter: Message should be dropped',
        filtered: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await gateway.handleChat({ message: 'test' }, mockSocket as Socket);

      // Message should be dropped (fake user message created)
      // The modifiedMessage from the filter should be ignored for drop action
      expect(agentMessagesService.createUserMessage).toHaveBeenCalledWith(
        mockAgent.id,
        'Message was dropped by filter: Message should be dropped',
        false,
      );

      // createAgentMessage should not be called for incoming dropped messages
      expect(agentMessagesService.createAgentMessage).not.toHaveBeenCalled();
    });

    it('should allow multiple filters to modify message sequentially', async () => {
      const socketId = mockSocket.id || 'test-socket-id';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).authenticatedClients.set(socketId, mockAgent.id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).socketById.set(socketId, mockSocket);
      agentsService.findOne.mockResolvedValue(mockAgentResponse);
      agentsRepository.findById.mockResolvedValue(mockAgent);
      agentMessagesService.getChatHistory.mockResolvedValue([
        {
          id: 'msg-1',
          agentId: mockAgent.id,
          agent: mockAgent,
          actor: 'user',
          message: 'Previous message',
          filtered: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      mockAgentProvider.sendMessage.mockResolvedValue('{}');

      // First filter: modifies "bad" to "***"
      const mockFilter1: jest.Mocked<ChatFilter> = {
        getType: jest.fn().mockReturnValue('filter1'),
        getDisplayName: jest.fn().mockReturnValue('Filter 1'),
        getDirection: jest.fn().mockReturnValue(FilterDirection.INCOMING),
        filter: jest.fn().mockResolvedValue({
          filtered: true,
          action: 'flag',
          reason: 'First modification',
          modifiedMessage: 'This is a *** word',
        }),
      };
      // Second filter: modifies "word" to "term" (receives already modified message)
      const mockFilter2: jest.Mocked<ChatFilter> = {
        getType: jest.fn().mockReturnValue('filter2'),
        getDisplayName: jest.fn().mockReturnValue('Filter 2'),
        getDirection: jest.fn().mockReturnValue(FilterDirection.INCOMING),
        filter: jest.fn().mockResolvedValue({
          filtered: true,
          action: 'flag',
          reason: 'Second modification',
          modifiedMessage: 'This is a *** term',
        }),
      };

      chatFilterFactory.getFiltersByDirection.mockReturnValue([mockFilter1, mockFilter2]);
      agentMessagesService.createUserMessage.mockResolvedValue({
        id: 'msg-2',
        agentId: mockAgent.id,
        agent: mockAgent,
        actor: 'user',
        message: 'This is a *** term',
        filtered: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await gateway.handleChat({ message: 'This is a bad word' }, mockSocket as Socket);

      // Verify first filter received original message
      expect(mockFilter1.filter).toHaveBeenCalledWith('This is a bad word', {
        agentId: mockAgent.id,
        actor: 'user',
      });

      // Verify second filter received modified message from first filter
      expect(mockFilter2.filter).toHaveBeenCalledWith('This is a *** word', {
        agentId: mockAgent.id,
        actor: 'user',
      });

      // Verify final modified message (from second filter) is used
      expect(agentMessagesService.createUserMessage).toHaveBeenCalledWith(
        mockAgent.id,
        'This is a *** term', // Final modified message
        true,
      );

      expect(mockAgentProvider.sendMessage).toHaveBeenCalledWith(
        mockAgent.id,
        mockAgent.containerId,
        'This is a *** term', // Final modified message
        {},
      );

      // Verify filter result contains final modified message
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'messageFilterResult',
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            direction: 'incoming',
            status: 'filtered',
            message: 'This is a bad word', // Original message
            modifiedMessage: 'This is a *** term', // Final modified message
          }),
        }),
      );
    });

    it('should drop outgoing message when filter returns drop action', async () => {
      const socketId = mockSocket.id || 'test-socket-id';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).authenticatedClients.set(socketId, mockAgent.id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).socketById.set(socketId, mockSocket);
      agentsService.findOne.mockResolvedValue(mockAgentResponse);
      agentsRepository.findById.mockResolvedValue(mockAgent);
      agentMessagesService.getChatHistory.mockResolvedValue([
        {
          id: 'msg-1',
          agentId: mockAgent.id,
          agent: mockAgent,
          actor: 'user',
          message: 'Previous message',
          filtered: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const mockIncomingFilter: jest.Mocked<ChatFilter> = {
        getType: jest.fn().mockReturnValue('incoming-filter'),
        getDisplayName: jest.fn().mockReturnValue('Incoming Filter'),
        getDirection: jest.fn().mockReturnValue(FilterDirection.INCOMING),
        filter: jest.fn().mockResolvedValue({ filtered: false }),
      };
      const mockOutgoingFilter: jest.Mocked<ChatFilter> = {
        getType: jest.fn().mockReturnValue('outgoing-filter'),
        getDisplayName: jest.fn().mockReturnValue('Outgoing Filter'),
        getDirection: jest.fn().mockReturnValue(FilterDirection.OUTGOING),
        filter: jest.fn().mockResolvedValue({
          filtered: true,
          action: 'drop',
          reason: 'Outgoing filter matched',
        }),
      };

      chatFilterFactory.getFiltersByDirection.mockImplementation((direction) => {
        if (direction === FilterDirection.INCOMING) {
          return [mockIncomingFilter];
        }

        return [mockOutgoingFilter];
      });

      const agentResponseJson = JSON.stringify({ type: 'result', result: 'test-filter response' });
      const agentResponseParsed = { type: 'result', result: 'test-filter response' };

      mockAgentProvider.sendMessage.mockResolvedValue(agentResponseJson);
      mockAgentProvider.toParseableStrings.mockReturnValue([agentResponseJson]);
      mockAgentProvider.toUnifiedResponse.mockReturnValue(agentResponseParsed);
      agentMessagesService.createUserMessage.mockResolvedValue({
        id: 'msg-2',
        agentId: mockAgent.id,
        agent: mockAgent,
        actor: 'user',
        message: 'Hello',
        filtered: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      agentMessagesService.createAgentMessage.mockResolvedValue({
        id: 'filter-result-1',
        agentId: mockAgent.id,
        agent: mockAgent,
        actor: 'agent',
        message: JSON.stringify({ type: 'filter-result', direction: 'outgoing', status: 'dropped' }),
        filtered: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await gateway.handleChat({ message: 'Hello' }, mockSocket as Socket);

      // Filter result should be broadcast (not persisted)
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'messageFilterResult',
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            direction: 'outgoing',
            status: 'dropped',
          }),
        }),
      );

      // Fake agent response with MESSAGE_DROPPED should be created and persisted
      expect(agentMessagesService.createAgentMessage).toHaveBeenCalledWith(
        mockAgent.id,
        expect.objectContaining({
          type: 'error',
          is_error: true,
          result: 'MESSAGE_DROPPED',
          message: expect.stringContaining('Message was dropped by filter'),
        }),
        false,
      );

      // Fake agent response should be broadcast
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'chatMessage',
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            from: 'agent',
            response: expect.objectContaining({
              type: 'error',
              is_error: true,
              result: 'MESSAGE_DROPPED',
            }),
          }),
        }),
      );

      // Should not persist the actual agent message, only the fake response
      const createAgentMessageCalls = (agentMessagesService.createAgentMessage as jest.Mock).mock.calls;
      const actualMessageCalls = createAgentMessageCalls.filter((call) => call[1]?.result !== 'MESSAGE_DROPPED');

      expect(actualMessageCalls.length).toBe(0);
      expect(mockOutgoingFilter.filter).toHaveBeenCalledWith(
        agentResponseJson,
        expect.objectContaining({ agentId: mockAgent.id, actor: 'agent' }),
      );
    });

    it('should flag outgoing message when filter returns flag action', async () => {
      const socketId = mockSocket.id || 'test-socket-id';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).authenticatedClients.set(socketId, mockAgent.id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).socketById.set(socketId, mockSocket);
      agentsService.findOne.mockResolvedValue(mockAgentResponse);
      agentsRepository.findById.mockResolvedValue(mockAgent);
      agentMessagesService.getChatHistory.mockResolvedValue([
        {
          id: 'msg-1',
          agentId: mockAgent.id,
          agent: mockAgent,
          actor: 'user',
          message: 'Previous message',
          filtered: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const mockOutgoingFilter: jest.Mocked<ChatFilter> = {
        getType: jest.fn().mockReturnValue('outgoing-filter'),
        getDisplayName: jest.fn().mockReturnValue('Outgoing Filter'),
        getDirection: jest.fn().mockReturnValue(FilterDirection.OUTGOING),
        filter: jest.fn().mockResolvedValue({
          filtered: true,
          action: 'flag',
          reason: 'Outgoing filter matched',
        }),
      };

      chatFilterFactory.getFiltersByDirection.mockImplementation((direction) => {
        if (direction === FilterDirection.INCOMING) {
          return [];
        }

        return [mockOutgoingFilter];
      });

      const agentResponseJson = JSON.stringify({ type: 'result', result: 'test-filter response' });
      const agentResponseParsed = { type: 'result', result: 'test-filter response' };

      mockAgentProvider.sendMessage.mockResolvedValue(agentResponseJson);
      mockAgentProvider.toParseableStrings.mockReturnValue([agentResponseJson]);
      mockAgentProvider.toUnifiedResponse.mockReturnValue(agentResponseParsed);
      agentMessagesService.createUserMessage.mockResolvedValue({
        id: 'msg-2',
        agentId: mockAgent.id,
        agent: mockAgent,
        actor: 'user',
        message: 'Hello',
        filtered: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      // Mock filter factory to return empty array for incoming (no filters)
      chatFilterFactory.getFiltersByDirection.mockImplementation((direction) => {
        if (direction === FilterDirection.INCOMING) {
          return [];
        }

        return [mockOutgoingFilter];
      });

      agentMessagesService.createAgentMessage
        .mockResolvedValueOnce({
          id: 'filter-result-incoming',
          agentId: mockAgent.id,
          agent: mockAgent,
          actor: 'agent',
          message: JSON.stringify({ type: 'filter-result', direction: 'incoming', status: 'allowed' }),
          filtered: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .mockResolvedValueOnce({
          id: 'filter-result-outgoing',
          agentId: mockAgent.id,
          agent: mockAgent,
          actor: 'agent',
          message: JSON.stringify({ type: 'filter-result', direction: 'outgoing', status: 'filtered' }),
          filtered: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .mockResolvedValueOnce({
          id: 'msg-3',
          agentId: mockAgent.id,
          agent: mockAgent,
          actor: 'agent',
          message: agentResponseJson,
          filtered: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

      await gateway.handleChat({ message: 'Hello' }, mockSocket as Socket);

      // Incoming filter result should be broadcast (not persisted)
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'messageFilterResult',
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            direction: 'incoming',
            status: 'allowed',
          }),
        }),
      );

      // Outgoing filter result should be broadcast (not persisted)
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'messageFilterResult',
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            direction: 'outgoing',
            status: 'filtered',
          }),
        }),
      );

      // Outgoing message should be processed but flagged
      expect(agentMessagesService.createAgentMessage).toHaveBeenCalledWith(
        mockAgent.id,
        expect.objectContaining({ type: 'result' }),
        true,
      );
      expect(mockOutgoingFilter.filter).toHaveBeenCalledWith(
        agentResponseJson,
        expect.objectContaining({ agentId: mockAgent.id, actor: 'agent' }),
      );
    });

    it('should fall back to text if JSON parsing fails', async () => {
      const socketId = mockSocket.id || 'test-socket-id';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).authenticatedClients.set(socketId, mockAgent.id);
      // Store socket reference for broadcasting
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).socketById.set(socketId, mockSocket);
      agentsService.findOne.mockResolvedValue(mockAgentResponse);
      agentsRepository.findById.mockResolvedValue(mockAgent);
      // Mock chat history to return existing messages (so initialization is skipped)
      agentMessagesService.getChatHistory.mockResolvedValue([
        {
          id: 'msg-1',
          agentId: mockAgent.id,
          agent: mockAgent,
          actor: 'user',
          message: 'Previous message',
          filtered: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      const invalidJsonResponse = 'Invalid JSON response';

      mockAgentProvider.sendMessage.mockResolvedValue(invalidJsonResponse);
      mockAgentProvider.toParseableStrings.mockReturnValue([invalidJsonResponse]);
      mockAgentProvider.toUnifiedResponse.mockImplementation(() => {
        throw new Error('Invalid JSON');
      });
      const loggerWarnSpy = jest.spyOn(gateway['logger'], 'warn').mockImplementation();
      const loggerLogSpy = jest.spyOn(gateway['logger'], 'log').mockImplementation();

      await gateway.handleChat({ message: 'Hello!' }, mockSocket as Socket);

      // Should emit user message - now uses socket.emit via broadcastToAgent
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'chatMessage',
        expect.objectContaining({
          success: true,
          data: {
            from: 'user',
            text: 'Hello!',
            timestamp: expect.any(String),
          },
          timestamp: expect.any(String),
        }),
      );
      // Should emit agent response with response field (fallback) since JSON parsing failed - now uses socket.emit via broadcastToAgent
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'chatMessage',
        expect.objectContaining({
          success: true,
          data: {
            from: 'agent',
            response: 'Invalid JSON response',
            timestamp: expect.any(String),
          },
          timestamp: expect.any(String),
        }),
      );
      // Should log warning about JSON parsing failure
      expect(loggerWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to parse agent response as JSON'));
      loggerWarnSpy.mockRestore();
      loggerLogSpy.mockRestore();
    });

    it('should handle errors when getting agent response gracefully', async () => {
      const socketId = mockSocket.id || 'test-socket-id';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).authenticatedClients.set(socketId, mockAgent.id);
      // Store socket reference for broadcasting
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).socketById.set(socketId, mockSocket);
      agentsService.findOne.mockResolvedValue(mockAgentResponse);
      agentsRepository.findById.mockResolvedValue(mockAgent);
      // Mock chat history to return existing messages (so initialization is skipped)
      agentMessagesService.getChatHistory.mockResolvedValue([
        {
          id: 'msg-1',
          agentId: mockAgent.id,
          agent: mockAgent,
          actor: 'user',
          message: 'Previous message',
          filtered: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      mockAgentProvider.sendMessage.mockRejectedValue(new Error('Container error'));
      const loggerErrorSpy = jest.spyOn(gateway['logger'], 'error').mockImplementation();
      const loggerLogSpy = jest.spyOn(gateway['logger'], 'log').mockImplementation();

      await gateway.handleChat({ message: 'Hello!' }, mockSocket as Socket);

      // Should still emit user message - now uses socket.emit via broadcastToAgent
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'chatMessage',
        expect.objectContaining({
          success: true,
          data: {
            from: 'user',
            text: 'Hello!',
            timestamp: expect.any(String),
          },
          timestamp: expect.any(String),
        }),
      );
      // Should log the error but not fail the chat
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error getting agent response'),
        expect.any(String),
      );
      loggerErrorSpy.mockRestore();
      loggerLogSpy.mockRestore();
    });

    it('should trim message whitespace', async () => {
      const socketId = mockSocket.id || 'test-socket-id';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).authenticatedClients.set(socketId, mockAgent.id);
      // Store socket reference for broadcasting
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).socketById.set(socketId, mockSocket);
      agentsService.findOne.mockResolvedValue(mockAgentResponse);
      agentsRepository.findById.mockResolvedValue(mockAgent);
      // Mock chat history to return existing messages (so initialization is skipped)
      agentMessagesService.getChatHistory.mockResolvedValue([
        {
          id: 'msg-1',
          agentId: mockAgent.id,
          agent: mockAgent,
          actor: 'user',
          message: 'Previous message',
          filtered: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      const loggerLogSpy = jest.spyOn(gateway['logger'], 'log').mockImplementation();

      await gateway.handleChat({ message: '  Hello, world!  ' }, mockSocket as Socket);

      // Now uses socket.emit via broadcastToAgent
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'chatMessage',
        expect.objectContaining({
          success: true,
          data: {
            from: 'user',
            text: 'Hello, world!',
            timestamp: expect.any(String),
          },
          timestamp: expect.any(String),
        }),
      );
      loggerLogSpy.mockRestore();
    });

    describe('ephemeral chat (unicast to requesting socket)', () => {
      it('should emit chat traffic only to the requesting socket when ephemeral is true', async () => {
        const requesterSocketId = mockSocket.id || 'test-socket-id';
        const otherSocketId = 'other-viewer-socket-id';
        const otherViewerSocket: Partial<Socket> = {
          id: otherSocketId,
          emit: jest.fn(),
          connected: true,
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (gateway as any).authenticatedClients.set(requesterSocketId, mockAgent.id);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (gateway as any).socketById.set(requesterSocketId, mockSocket);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (gateway as any).authenticatedClients.set(otherSocketId, mockAgent.id);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (gateway as any).socketById.set(otherSocketId, otherViewerSocket);

        agentsService.findOne.mockResolvedValue(mockAgentResponse);
        agentsRepository.findById.mockResolvedValue(mockAgent);

        agentMessagesService.getChatHistory.mockResolvedValue([
          {
            id: 'msg-1',
            agentId: mockAgent.id,
            agent: mockAgent,
            actor: 'user',
            message: 'Previous message',
            filtered: false,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]);

        const mockAgentResponseJson = JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'Automation reply',
        });
        const mockParsedResponse = {
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'Automation reply',
        };

        mockAgentProvider.sendMessage.mockResolvedValue(mockAgentResponseJson);
        mockAgentProvider.toParseableStrings.mockReturnValue([mockAgentResponseJson]);
        mockAgentProvider.toUnifiedResponse.mockReturnValue(mockParsedResponse);

        await gateway.handleChat(
          {
            message: 'Ephemeral user prompt',
            ephemeral: true,
            responseMode: 'sync',
            correlationId: 'auto-run-corr-1',
          },
          mockSocket as Socket,
        );

        expect(mockSocket.emit).toHaveBeenCalledWith(
          'chatMessage',
          expect.objectContaining({
            success: true,
            data: expect.objectContaining({ from: 'user', text: 'Ephemeral user prompt' }),
          }),
        );
        expect(mockSocket.emit).toHaveBeenCalledWith(
          'chatMessage',
          expect.objectContaining({
            success: true,
            data: expect.objectContaining({ from: 'agent' }),
          }),
        );

        const otherEmits = (otherViewerSocket.emit as jest.Mock).mock.calls;

        expect(otherEmits.filter(([event]) => event === 'chatMessage')).toHaveLength(0);
        expect(otherEmits.filter(([event]) => event === 'chatEvent')).toHaveLength(0);
        expect(otherEmits.filter(([event]) => event === 'messageFilterResult')).toHaveLength(0);

        expect(agentMessagesService.createUserMessage).not.toHaveBeenCalled();
        expect(agentMessagesService.createAgentMessage).not.toHaveBeenCalled();
        expect(mockAgentMessageEventsService.persistEvent).not.toHaveBeenCalled();
      });

      it('should broadcast chat traffic to all authenticated sockets when ephemeral is false', async () => {
        const requesterSocketId = mockSocket.id || 'test-socket-id';
        const otherSocketId = 'other-viewer-socket-id';
        const otherViewerSocket: Partial<Socket> = {
          id: otherSocketId,
          emit: jest.fn(),
          connected: true,
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (gateway as any).authenticatedClients.set(requesterSocketId, mockAgent.id);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (gateway as any).socketById.set(requesterSocketId, mockSocket);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (gateway as any).authenticatedClients.set(otherSocketId, mockAgent.id);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (gateway as any).socketById.set(otherSocketId, otherViewerSocket);

        agentsService.findOne.mockResolvedValue(mockAgentResponse);
        agentsRepository.findById.mockResolvedValue(mockAgent);

        agentMessagesService.getChatHistory.mockResolvedValue([
          {
            id: 'msg-1',
            agentId: mockAgent.id,
            agent: mockAgent,
            actor: 'user',
            message: 'Previous message',
            filtered: false,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]);

        const mockAgentResponseJson = JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'Hello from agent!',
        });
        const mockParsedResponse = {
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'Hello from agent!',
        };

        mockAgentProvider.sendMessage.mockResolvedValue(mockAgentResponseJson);
        mockAgentProvider.toParseableStrings.mockReturnValue([mockAgentResponseJson]);
        mockAgentProvider.toUnifiedResponse.mockReturnValue(mockParsedResponse);

        await gateway.handleChat({ message: 'Hello, world!' }, mockSocket as Socket);

        const requesterChatMessages = (mockSocket.emit as jest.Mock).mock.calls.filter(([e]) => e === 'chatMessage');
        const otherChatMessages = (otherViewerSocket.emit as jest.Mock).mock.calls.filter(([e]) => e === 'chatMessage');

        expect(requesterChatMessages.length).toBeGreaterThanOrEqual(2);
        expect(otherChatMessages.length).toBe(requesterChatMessages.length);

        expect(mockAgentMessageEventsService.persistEvent).toHaveBeenCalled();
      });
    });

    describe('streaming mode', () => {
      afterEach(() => {
        mockAgentProvider.getCapabilities.mockReturnValue({
          supportsChat: true,
          supportsStreaming: false,
          supportsToolEvents: false,
          supportsQuestions: false,
        });
        (mockAgentProvider as { sendMessageStream?: unknown }).sendMessageStream = undefined;
        mockAgentProvider.toParseableStrings.mockReset();
        mockAgentProvider.toUnifiedResponse.mockReset();
      });

      it('buildFinalStreamingResponse collapses repeated Cursor result NDJSON into one agenstra_turn result part', () => {
        const essay = 'v'.repeat(40);
        const streamedUnified = [
          { type: 'tool_call', toolCallId: 'tc', name: 'read', args: { path: '/p' }, status: 'started' },
          { type: 'result', subtype: 'success', result: essay + essay },
          { type: 'result', subtype: 'success', result: essay, duration_ms: 42 },
          { type: 'result', subtype: 'success', result: essay, usage: { outputTokens: 7 } },
        ];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const built = (gateway as any).buildFinalStreamingResponse(streamedUnified, '') as {
          type: string;
          subtype?: string;
          parts: Array<Record<string, unknown>>;
        };

        expect(built).not.toBeNull();
        expect(built.type).toBe('agenstra_turn');
        expect(built.subtype).toBe('success');
        const resultParts = built.parts.filter((p) => p.type === 'result');

        expect(resultParts).toHaveLength(1);
        expect(resultParts[0].result).toBe(essay);
        expect(resultParts[0].duration_ms).toBe(42);
        expect(resultParts[0].usage).toEqual({ outputTokens: 7 });
      });

      it('buildFinalStreamingResponse removes trailing stream result that repeats materialized delta prose', () => {
        const streamedUnified = [
          { type: 'delta', delta: 'Hello ' },
          { type: 'tool_call', id: 't', name: 'x', args: {}, status: 'started' },
          { type: 'delta', delta: 'world' },
          { type: 'result', subtype: 'success', result: 'Hello world' },
        ];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const built = (gateway as any).buildFinalStreamingResponse(streamedUnified, '') as {
          type: string;
          parts: Array<Record<string, unknown>>;
        };

        expect(built.type).toBe('agenstra_turn');
        expect(built.parts.filter((p) => p.type === 'result')).toEqual([
          { type: 'result', subtype: 'success', result: 'Hello ' },
          { type: 'result', subtype: 'success', result: 'world' },
        ]);
        expect(built.parts.some((p) => p.type === 'tool_call')).toBe(true);
      });

      it('agentResponseToChatEvents maps interaction_query to interactionQuery envelope with payload', () => {
        const events = (gateway as any).agentResponseToChatEvents(mockAgent.id, 'corr-iq', 2, {
          type: 'interaction_query',
          query: 'Which option?',
        }) as AgentEventEnvelope[];

        expect(events).toHaveLength(1);
        expect(events[0]?.kind).toBe('interactionQuery');
        expect(events[0]?.payload).toEqual(
          expect.objectContaining({ type: 'interaction_query', query: 'Which option?' }),
        );
        expect(events[0]?.correlationId).toBe('corr-iq');
        expect(events[0]?.sequence).toBe(2);
      });

      it('agentResponseToChatEvents maps interactionQuery camelCase type to interactionQuery envelope', () => {
        const events = (gateway as any).agentResponseToChatEvents(mockAgent.id, 'corr-iq2', 0, {
          type: 'interactionQuery',
          prompt: 'Pick one',
        }) as AgentEventEnvelope[];

        expect(events).toHaveLength(1);
        expect(events[0]?.kind).toBe('interactionQuery');
        expect(events[0]?.payload).toEqual(expect.objectContaining({ type: 'interactionQuery', prompt: 'Pick one' }));
      });

      it('buildFinalStreamingResponse keeps interaction_query in agenstra_turn when paired with result', () => {
        const streamedUnified = [
          { type: 'interaction_query', query: 'Confirm?' },
          { type: 'result', subtype: 'success', result: 'Yes.' },
        ];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const built = (gateway as any).buildFinalStreamingResponse(streamedUnified, '') as {
          type: string;
          parts: Array<{ type?: string; query?: string }>;
        };

        expect(built).not.toBeNull();
        expect(built.type).toBe('agenstra_turn');
        expect(built.parts.some((p) => p.type === 'interaction_query')).toBe(true);
        expect(built.parts.filter((p) => p.type === 'result')).toEqual([
          { type: 'result', subtype: 'success', result: 'Yes.' },
        ]);
      });

      it('persists deduped agenstra_turn when handleChat uses sendMessageStream with doubled Cursor result text', async () => {
        const socketId = mockSocket.id || 'test-socket-id';

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (gateway as any).authenticatedClients.set(socketId, mockAgent.id);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (gateway as any).socketById.set(socketId, mockSocket);
        agentsService.findOne.mockResolvedValue(mockAgentResponse);
        agentsRepository.findById.mockResolvedValue(mockAgent);
        agentMessagesService.getChatHistory.mockResolvedValue([
          {
            id: 'msg-1',
            agentId: mockAgent.id,
            agent: mockAgent,
            actor: 'user',
            message: 'Previous',
            filtered: false,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]);

        mockAgentProvider.getCapabilities.mockReturnValue({
          supportsChat: true,
          supportsStreaming: true,
          supportsToolEvents: false,
          supportsQuestions: false,
        });

        const essay = 'q'.repeat(40);
        const toolLine = JSON.stringify({
          type: 'tool_call',
          toolCallId: 't-read',
          name: 'read',
          args: { path: '/x' },
          status: 'started',
        });
        const doubledResultLine = JSON.stringify({
          type: 'result',
          subtype: 'success',
          result: essay + essay,
        });

        mockAgentProvider.sendMessageStream = jest.fn().mockImplementation(async function* () {
          yield `${toolLine}\n${doubledResultLine}\n`;
        });

        mockAgentProvider.toParseableStrings.mockImplementation((line: string) => [line.trim()]);
        mockAgentProvider.toUnifiedResponse.mockImplementation((s: string) => JSON.parse(s) as AgentResponseObject);

        await gateway.handleChat({ message: 'Stream me', responseMode: 'stream' }, mockSocket as Socket);

        expect(mockAgentProvider.sendMessageStream).toHaveBeenCalledWith(
          mockAgent.id,
          mockAgent.containerId,
          'Stream me',
          expect.any(Object),
        );
        expect(mockAgentProvider.sendMessage).not.toHaveBeenCalled();

        const createCalls = agentMessagesService.createAgentMessage.mock.calls;
        const payload = createCalls.find(
          (c) => typeof c[1] === 'object' && c[1] !== null && (c[1] as { type?: string }).type === 'agenstra_turn',
        )?.[1] as { type: string; parts: Array<{ type?: string; result?: unknown }> } | undefined;

        expect(payload).toBeDefined();
        const results = payload!.parts.filter((p) => p.type === 'result');

        expect(results).toHaveLength(1);
        expect(results[0].result).toBe(essay);
      });

      it('streaming persist does not triple assistant prose when deltas plus repeated result NDJSON lines', async () => {
        const socketId = mockSocket.id || 'test-socket-id';

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (gateway as any).authenticatedClients.set(socketId, mockAgent.id);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (gateway as any).socketById.set(socketId, mockSocket);
        agentsService.findOne.mockResolvedValue(mockAgentResponse);
        agentsRepository.findById.mockResolvedValue(mockAgent);
        agentMessagesService.getChatHistory.mockResolvedValue([
          {
            id: 'msg-1',
            agentId: mockAgent.id,
            agent: mockAgent,
            actor: 'user',
            message: 'Say hi',
            filtered: false,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]);

        mockAgentProvider.getCapabilities.mockReturnValue({
          supportsChat: true,
          supportsStreaming: true,
          supportsToolEvents: false,
          supportsQuestions: false,
        });

        const prose = 'Hello — nice to hear from you.';
        const line = (obj: unknown) => `${JSON.stringify(obj)}\n`;

        mockAgentProvider.sendMessageStream = jest.fn().mockImplementation(async function* () {
          yield `${line({ type: 'delta', delta: prose.slice(0, 6) })}${line({ type: 'delta', delta: prose.slice(6) })}`;
          yield line({ type: 'result', subtype: 'success', result: prose });
          yield line({ type: 'result', subtype: 'success', result: prose });
        });

        mockAgentProvider.toParseableStrings.mockImplementation((raw: string) =>
          raw.split('\n').filter((s) => s.trim()),
        );
        mockAgentProvider.toUnifiedResponse.mockImplementation((s: string) => JSON.parse(s) as AgentResponseObject);

        await gateway.handleChat({ message: 'Say hello', responseMode: 'stream' }, mockSocket as Socket);

        const agentCalls = agentMessagesService.createAgentMessage.mock.calls.filter(
          (c) => c[0] === mockAgent.id && typeof c[1] === 'object' && c[1] !== null,
        );

        expect(agentCalls.length).toBeGreaterThanOrEqual(1);
        const payload = agentCalls[agentCalls.length - 1][1] as Record<string, unknown>;
        const asJson = JSON.stringify(payload);

        expect(asJson.split(prose).length - 1).toBe(1);
      });
    });

    describe('initialization message', () => {
      it('should send initialization message on first user message when no chat history exists', async () => {
        const socketId = mockSocket.id || 'test-socket-id';

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (gateway as any).authenticatedClients.set(socketId, mockAgent.id);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (gateway as any).socketById.set(socketId, mockSocket);
        agentsService.findOne.mockResolvedValue(mockAgentResponse);
        agentsRepository.findById.mockResolvedValue(mockAgent);
        // Mock empty chat history (first message)
        agentMessagesService.getChatHistory.mockResolvedValue([]);
        mockAgentProvider.sendInitialization.mockResolvedValue();
        mockAgentProvider.sendMessage.mockResolvedValue('');
        const loggerDebugSpy = jest.spyOn(gateway['logger'], 'debug').mockImplementation();
        const loggerLogSpy = jest.spyOn(gateway['logger'], 'log').mockImplementation();

        await gateway.handleChat({ message: 'Hello, world!' }, mockSocket as Socket);

        // Should send initialization message first
        expect(mockAgentProvider.sendInitialization).toHaveBeenCalledWith(mockAgent.id, mockAgent.containerId, {});
        expect(loggerDebugSpy).toHaveBeenCalledWith(expect.stringContaining('Sent initialization message to agent'));
        // Should mark agent as having received first message
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((gateway as any).agentsWithFirstMessageSent.has(mockAgent.id)).toBe(true);
        // Should still process the user message normally
        expect(mockSocket.emit).toHaveBeenCalledWith(
          'chatMessage',
          expect.objectContaining({
            success: true,
            data: {
              from: 'user',
              text: 'Hello, world!',
              timestamp: expect.any(String),
            },
          }),
        );
        loggerDebugSpy.mockRestore();
        loggerLogSpy.mockRestore();
      });

      it('should not send initialization message if chat history exists', async () => {
        const socketId = mockSocket.id || 'test-socket-id';

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (gateway as any).authenticatedClients.set(socketId, mockAgent.id);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (gateway as any).socketById.set(socketId, mockSocket);
        agentsService.findOne.mockResolvedValue(mockAgentResponse);
        agentsRepository.findById.mockResolvedValue(mockAgent);
        // Mock existing chat history
        agentMessagesService.getChatHistory.mockResolvedValue([
          {
            id: 'msg-1',
            agentId: mockAgent.id,
            agent: mockAgent,
            actor: 'user',
            message: 'Previous message',
            filtered: false,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]);
        mockAgentProvider.sendMessage.mockResolvedValue('');
        const loggerDebugSpy = jest.spyOn(gateway['logger'], 'debug').mockImplementation();

        await gateway.handleChat({ message: 'Hello, world!' }, mockSocket as Socket);

        // Should not send initialization message (only the user message)
        expect(mockAgentProvider.sendInitialization).not.toHaveBeenCalled();
        expect(mockAgentProvider.sendMessage).toHaveBeenCalledTimes(1);
        expect(mockAgentProvider.sendMessage).toHaveBeenCalledWith(
          mockAgent.id,
          mockAgent.containerId,
          'Hello, world!',
          {},
        );
        expect(loggerDebugSpy).not.toHaveBeenCalledWith(expect.stringContaining('Sent initialization message'));
        // Should mark agent as initialized
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((gateway as any).agentsWithFirstMessageSent.has(mockAgent.id)).toBe(true);
        loggerDebugSpy.mockRestore();
      });

      it('should not send initialization message if already sent for this agent', async () => {
        const socketId = mockSocket.id || 'test-socket-id';

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (gateway as any).authenticatedClients.set(socketId, mockAgent.id);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (gateway as any).socketById.set(socketId, mockSocket);
        // Mark agent as already initialized
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (gateway as any).agentsWithFirstMessageSent.add(mockAgent.id);
        agentsService.findOne.mockResolvedValue(mockAgentResponse);
        agentsRepository.findById.mockResolvedValue(mockAgent);
        // Mock empty chat history (but agent already initialized)
        agentMessagesService.getChatHistory.mockResolvedValue([]);
        mockAgentProvider.sendMessage.mockResolvedValue('');
        const loggerDebugSpy = jest.spyOn(gateway['logger'], 'debug').mockImplementation();

        await gateway.handleChat({ message: 'Hello, world!' }, mockSocket as Socket);

        // Should not send initialization message (only the user message)
        expect(mockAgentProvider.sendInitialization).not.toHaveBeenCalled();
        expect(mockAgentProvider.sendMessage).toHaveBeenCalledTimes(1);
        expect(mockAgentProvider.sendMessage).toHaveBeenCalledWith(
          mockAgent.id,
          mockAgent.containerId,
          'Hello, world!',
          {},
        );
        expect(loggerDebugSpy).not.toHaveBeenCalledWith(expect.stringContaining('Sent initialization message'));
        loggerDebugSpy.mockRestore();
      });

      it('should handle initialization message send failure gracefully', async () => {
        const socketId = mockSocket.id || 'test-socket-id';

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (gateway as any).authenticatedClients.set(socketId, mockAgent.id);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (gateway as any).socketById.set(socketId, mockSocket);
        agentsService.findOne.mockResolvedValue(mockAgentResponse);
        agentsRepository.findById.mockResolvedValue(mockAgent);
        // Mock empty chat history (first message)
        agentMessagesService.getChatHistory.mockResolvedValue([]);
        // First call fails (initialization), second call succeeds (user message)
        mockAgentProvider.sendInitialization.mockRejectedValueOnce(new Error('Initialization failed'));
        mockAgentProvider.sendMessage.mockResolvedValueOnce('');
        const loggerWarnSpy = jest.spyOn(gateway['logger'], 'warn').mockImplementation();
        const loggerLogSpy = jest.spyOn(gateway['logger'], 'log').mockImplementation();

        await gateway.handleChat({ message: 'Hello, world!' }, mockSocket as Socket);

        // Should log warning about initialization failure
        expect(loggerWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining('Failed to send initialization message'),
          expect.any(String),
        );
        // Should still process the user message normally
        expect(mockSocket.emit).toHaveBeenCalledWith(
          'chatMessage',
          expect.objectContaining({
            success: true,
            data: {
              from: 'user',
              text: 'Hello, world!',
              timestamp: expect.any(String),
            },
          }),
        );
        // Should mark agent as initialized even if initialization message failed
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((gateway as any).agentsWithFirstMessageSent.has(mockAgent.id)).toBe(true);
        loggerWarnSpy.mockRestore();
        loggerLogSpy.mockRestore();
      });

      it('should include model flag in initialization message when provided', async () => {
        const socketId = mockSocket.id || 'test-socket-id';

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (gateway as any).authenticatedClients.set(socketId, mockAgent.id);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (gateway as any).socketById.set(socketId, mockSocket);
        agentsService.findOne.mockResolvedValue(mockAgentResponse);
        agentsRepository.findById.mockResolvedValue(mockAgent);
        // Mock empty chat history (first message)
        agentMessagesService.getChatHistory.mockResolvedValue([]);
        mockAgentProvider.sendInitialization.mockResolvedValue();
        mockAgentProvider.sendMessage.mockResolvedValue('');

        await gateway.handleChat({ message: 'Hello, world!', model: 'gpt-4.1' }, mockSocket as Socket);

        // Should send initialization message with model flag
        expect(mockAgentProvider.sendInitialization).toHaveBeenCalledWith(mockAgent.id, mockAgent.containerId, {
          model: 'gpt-4.1',
        });
      });
    });
  });

  describe('git state changed broadcasts', () => {
    it('emits gitStateChanged after workspace tool results', () => {
      const socketId = mockSocket.id || 'test-socket-id';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).authenticatedClients.set(socketId, mockAgent.id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).socketById.set(socketId, mockSocket);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).broadcastChatEvent(mockAgent.id, {
        eventId: 'event-1',
        kind: 'toolResult',
        agentId: mockAgent.id,
        correlationId: 'corr-1',
        sequence: 2,
        timestamp: new Date().toISOString(),
        payload: {
          toolCallId: 'tool-1',
          name: 'write_file',
          result: { ok: true },
          isError: false,
        },
      } as AgentEventEnvelope);

      expect(mockSocket.emit).toHaveBeenCalledWith(
        'gitStateChanged',
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({ agentId: mockAgent.id }),
        }),
      );
    });
  });

  describe('handleFileUpdate', () => {
    it('should broadcast file update notification for authenticated user', async () => {
      const socketId = mockSocket.id || 'test-socket-id';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).authenticatedClients.set(socketId, mockAgent.id);
      // Store socket reference for broadcasting
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).socketById.set(socketId, mockSocket);
      agentsService.findOne.mockResolvedValue(mockAgentResponse);
      const loggerLogSpy = jest.spyOn(gateway['logger'], 'log').mockImplementation();
      const filePath = '/path/to/file.ts';

      await gateway.handleFileUpdate({ filePath }, mockSocket as Socket);

      expect(agentsService.findOne).toHaveBeenCalledWith(mockAgent.id);
      expect(loggerLogSpy).toHaveBeenCalledWith(
        `Agent ${mockAgent.name} (${mockAgent.id}) updated file ${filePath} on socket ${socketId}`,
      );
      // Check file update notification emission - now uses socket.emit via broadcastToAgent
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'fileUpdateNotification',
        expect.objectContaining({
          success: true,
          data: {
            socketId,
            filePath,
            timestamp: expect.any(String),
          },
          timestamp: expect.any(String),
        }),
      );
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'gitStateChanged',
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            agentId: mockAgent.id,
            timestamp: expect.any(String),
          }),
        }),
      );
      loggerLogSpy.mockRestore();
    });

    it('should reject file update from unauthenticated user', async () => {
      await gateway.handleFileUpdate({ filePath: '/path/to/file.ts' }, mockSocket as Socket);

      expect(mockSocket.emit).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({
          success: false,
          error: {
            message: 'Unauthorized. Please login first.',
            code: 'UNAUTHORIZED',
          },
          timestamp: expect.any(String),
        }),
      );
      expect(agentsService.findOne).not.toHaveBeenCalled();
      expect(mockSocket.emit).not.toHaveBeenCalledWith('fileUpdateNotification', expect.any(Object));
    });

    it('should reject file update with missing filePath', async () => {
      const socketId = mockSocket.id || 'test-socket-id';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).authenticatedClients.set(socketId, mockAgent.id);

      await gateway.handleFileUpdate({ filePath: '' }, mockSocket as Socket);

      expect(mockSocket.emit).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({
          success: false,
          error: {
            message: 'filePath is required',
            code: 'INVALID_PAYLOAD',
          },
          timestamp: expect.any(String),
        }),
      );
      expect(agentsService.findOne).not.toHaveBeenCalled();
      expect(mockSocket.emit).not.toHaveBeenCalledWith('fileUpdateNotification', expect.any(Object));
    });

    it('should trim filePath whitespace', async () => {
      const socketId = mockSocket.id || 'test-socket-id';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).authenticatedClients.set(socketId, mockAgent.id);
      // Store socket reference for broadcasting
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).socketById.set(socketId, mockSocket);
      agentsService.findOne.mockResolvedValue(mockAgentResponse);
      const loggerLogSpy = jest.spyOn(gateway['logger'], 'log').mockImplementation();
      const filePath = '  /path/to/file.ts  ';
      const trimmedPath = '/path/to/file.ts';

      await gateway.handleFileUpdate({ filePath }, mockSocket as Socket);

      expect(loggerLogSpy).toHaveBeenCalledWith(
        `Agent ${mockAgent.name} (${mockAgent.id}) updated file ${trimmedPath} on socket ${socketId}`,
      );
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'fileUpdateNotification',
        expect.objectContaining({
          success: true,
          data: {
            socketId,
            filePath: trimmedPath,
            timestamp: expect.any(String),
          },
          timestamp: expect.any(String),
        }),
      );
      loggerLogSpy.mockRestore();
    });

    it('should handle errors when fetching agent details gracefully', async () => {
      const socketId = mockSocket.id || 'test-socket-id';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).authenticatedClients.set(socketId, mockAgent.id);
      // Store socket reference for broadcasting
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).socketById.set(socketId, mockSocket);
      agentsService.findOne.mockRejectedValue(new Error('Database error'));
      const loggerErrorSpy = jest.spyOn(gateway['logger'], 'error').mockImplementation();

      await gateway.handleFileUpdate({ filePath: '/path/to/file.ts' }, mockSocket as Socket);

      expect(mockSocket.emit).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({
          success: false,
          error: {
            message: 'Error processing file update',
            code: 'FILE_UPDATE_ERROR',
          },
          timestamp: expect.any(String),
        }),
      );
      expect(loggerErrorSpy).toHaveBeenCalled();
      loggerErrorSpy.mockRestore();
    });

    it('should broadcast to multiple clients authenticated to the same agent', async () => {
      const socketId1 = 'socket-1';
      const socketId2 = 'socket-2';
      const mockSocket1 = { id: socketId1, emit: jest.fn(), connected: true } as unknown as Socket;
      const mockSocket2 = { id: socketId2, emit: jest.fn(), connected: true } as unknown as Socket;

      // Authenticate both sockets to the same agent
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).authenticatedClients.set(socketId1, mockAgent.id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).authenticatedClients.set(socketId2, mockAgent.id);
      // Store socket references for broadcasting
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).socketById.set(socketId1, mockSocket1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).socketById.set(socketId2, mockSocket2);

      agentsService.findOne.mockResolvedValue(mockAgentResponse);
      const loggerLogSpy = jest.spyOn(gateway['logger'], 'log').mockImplementation();
      const filePath = '/path/to/file.ts';

      await gateway.handleFileUpdate({ filePath }, mockSocket1);

      // Both sockets should receive the notification
      expect(mockSocket1.emit).toHaveBeenCalledWith(
        'fileUpdateNotification',
        expect.objectContaining({
          success: true,
          data: {
            socketId: socketId1, // The socket ID of the sender
            filePath,
            timestamp: expect.any(String),
          },
        }),
      );
      expect(mockSocket2.emit).toHaveBeenCalledWith(
        'fileUpdateNotification',
        expect.objectContaining({
          success: true,
          data: {
            socketId: socketId1, // The socket ID of the sender (not socket-2)
            filePath,
            timestamp: expect.any(String),
          },
        }),
      );
      loggerLogSpy.mockRestore();
    });
  });

  describe('handleLogout', () => {
    it('should logout authenticated user successfully', async () => {
      const socketId = mockSocket.id || 'test-socket-id';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).authenticatedClients.set(socketId, mockAgent.id);
      agentsService.findOne.mockResolvedValue(mockAgentResponse);
      const loggerLogSpy = jest.spyOn(gateway['logger'], 'log').mockImplementation();

      await gateway.handleLogout(mockSocket as Socket);

      expect(agentsService.findOne).toHaveBeenCalledWith(mockAgent.id);
      expect(loggerLogSpy).toHaveBeenCalledWith(
        `Agent ${mockAgent.name} (${mockAgent.id}) logged out from socket ${socketId}`,
      );
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'logoutSuccess',
        expect.objectContaining({
          success: true,
          data: {
            message: 'Logged out successfully',
            agentId: mockAgent.id,
            agentName: mockAgent.name,
          },
          timestamp: expect.any(String),
        }),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((gateway as any).authenticatedClients.has(socketId)).toBe(false);
      loggerLogSpy.mockRestore();
    });

    it('should handle logout gracefully when agent details fetch fails', async () => {
      const socketId = mockSocket.id || 'test-socket-id';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).authenticatedClients.set(socketId, mockAgent.id);
      agentsService.findOne.mockRejectedValue(new Error('Database error'));
      const loggerWarnSpy = jest.spyOn(gateway['logger'], 'warn').mockImplementation();

      await gateway.handleLogout(mockSocket as Socket);

      // Session should still be cleared
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((gateway as any).authenticatedClients.has(socketId)).toBe(false);
      // Should still emit success
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'logoutSuccess',
        expect.objectContaining({
          success: true,
          data: {
            message: 'Logged out successfully',
            agentId: mockAgent.id,
            agentName: 'Unknown',
          },
          timestamp: expect.any(String),
        }),
      );
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to get agent details during logout'),
        expect.any(String),
      );
      loggerWarnSpy.mockRestore();
    });

    it('should handle logout for unauthenticated user (idempotent)', async () => {
      const loggerDebugSpy = jest.spyOn(gateway['logger'], 'debug').mockImplementation();

      await gateway.handleLogout(mockSocket as Socket);

      expect(agentsService.findOne).not.toHaveBeenCalled();
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'logoutSuccess',
        expect.objectContaining({
          success: true,
          data: {
            message: 'Logged out successfully',
            agentId: null,
            agentName: null,
          },
          timestamp: expect.any(String),
        }),
      );
      expect(loggerDebugSpy).toHaveBeenCalledWith(`Logout requested for unauthenticated socket ${mockSocket.id}`);
      loggerDebugSpy.mockRestore();
    });
  });

  describe('findAgentIdByIdentifier', () => {
    it('should find agent by UUID', async () => {
      agentsRepository.findById.mockResolvedValue(mockAgent);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (gateway as any).findAgentIdByIdentifier(mockAgent.id);

      expect(result).toBe(mockAgent.id);
      expect(agentsRepository.findById).toHaveBeenCalledWith(mockAgent.id);
      expect(agentsRepository.findByName).not.toHaveBeenCalled();
    });

    it('should find agent by name when UUID lookup fails', async () => {
      agentsRepository.findById.mockResolvedValue(null);
      agentsRepository.findByName.mockResolvedValue(mockAgent);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (gateway as any).findAgentIdByIdentifier(mockAgent.name);

      expect(result).toBe(mockAgent.id);
      expect(agentsRepository.findById).toHaveBeenCalledWith(mockAgent.name);
      expect(agentsRepository.findByName).toHaveBeenCalledWith(mockAgent.name);
    });

    it('should return null when agent not found', async () => {
      agentsRepository.findById.mockResolvedValue(null);
      agentsRepository.findByName.mockResolvedValue(null);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (gateway as any).findAgentIdByIdentifier('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('container stats broadcasting', () => {
    const mockStats = {
      read: '2024-01-01T00:00:00.000000000Z',
      preread: '2024-01-01T00:00:00.000000000Z',
      pids_stats: { current: 1 },
      blkio_stats: {
        io_service_bytes_recursive: [],
        io_serviced_recursive: [],
        io_queue_recursive: [],
        io_service_time_recursive: [],
        io_wait_time_recursive: [],
        io_merged_recursive: [],
        io_time_recursive: [],
        sectors_recursive: [],
      },
      num_procs: 0,
      storage_stats: {},
      cpu_stats: {
        cpu_usage: {
          total_usage: 1000000000,
          percpu_usage: [1000000000],
          usage_in_kernelmode: 100000000,
          usage_in_usermode: 900000000,
        },
        system_cpu_usage: 2000000000,
        online_cpus: 1,
        throttling_data: {
          periods: 0,
          throttled_periods: 0,
          throttled_time: 0,
        },
      },
      precpu_stats: {
        cpu_usage: {
          total_usage: 0,
          percpu_usage: [],
          usage_in_kernelmode: 0,
          usage_in_usermode: 0,
        },
        system_cpu_usage: 0,
        online_cpus: 1,
        throttling_data: {
          periods: 0,
          throttled_periods: 0,
          throttled_time: 0,
        },
      },
      memory_stats: {
        usage: 1000000,
        max_usage: 2000000,
        stats: {
          total_pgmajfault: 0,
          cache: 0,
          mapped_file: 0,
          total_inactive_file: 0,
          pgpgout: 0,
          rss: 0,
          total_mapped_file: 0,
          writeback: 0,
          unevictable: 0,
          pgpgin: 0,
          total_active_file: 0,
          active_anon: 0,
          total_active_anon: 0,
          total_inactive_anon: 0,
          inactive_anon: 0,
          active_file: 0,
          inactive_file: 0,
          total_unevictable: 0,
          total_rss: 0,
          total_rss_huge: 0,
          total_writeback: 0,
          total_cache: 0,
          rss_huge: 0,
          total_pgpgin: 0,
          total_pgpgout: 0,
          total_pgfault: 0,
          pgfault: 0,
          pgmajfault: 0,
          hierarchical_memory_limit: 0,
        },
      },
      networks: {},
    };

    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should start stats broadcasting after successful login and send first stats immediately', async () => {
      agentsRepository.findById.mockResolvedValue(mockAgent);
      agentsService.verifyCredentials.mockResolvedValue(true);
      agentsService.findOne.mockResolvedValue(mockAgentResponse);
      (dockerService.getContainerStatus as jest.Mock).mockResolvedValue({ running: true });
      (dockerService.getContainerStats as jest.Mock).mockResolvedValue(mockStats);

      const socketId = mockSocket.id || 'test-socket-id';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).socketById.set(socketId, mockSocket);

      await gateway.handleLogin({ agentId: mockAgent.id, password: 'password123' }, mockSocket as Socket);

      expect(dockerService.getContainerStatus).toHaveBeenCalledWith(mockAgent.containerId);
      expect(dockerService.getContainerStats).toHaveBeenCalledWith(mockAgent.containerId);
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'containerStats',
        expect.objectContaining({
          success: true,
          data: {
            status: { running: true },
            stats: mockStats,
            timestamp: expect.any(String),
          },
          timestamp: expect.any(String),
        }),
      );
    });

    it('should send stats periodically after login', async () => {
      agentsRepository.findById.mockResolvedValue(mockAgent);
      agentsService.verifyCredentials.mockResolvedValue(true);
      agentsService.findOne.mockResolvedValue(mockAgentResponse);
      (dockerService.getContainerStatus as jest.Mock).mockResolvedValue({ running: true });
      (dockerService.getContainerStats as jest.Mock).mockResolvedValue(mockStats);

      const socketId = mockSocket.id || 'test-socket-id';

      // Ensure socket is connected and in the maps
      mockSocket.connected = true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).socketById.set(socketId, mockSocket);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).authenticatedClients.set(socketId, mockAgent.id);

      await gateway.handleLogin({ agentId: mockAgent.id, password: 'password123' }, mockSocket as Socket);

      // Clear initial calls
      (dockerService.getContainerStatus as jest.Mock).mockClear();
      (dockerService.getContainerStats as jest.Mock).mockClear();
      const emitSpy = jest.fn();

      mockSocket.emit = emitSpy;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).socketById.set(socketId, mockSocket);
      mockSocket.connected = true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).authenticatedClients.set(socketId, mockAgent.id);

      jest.advanceTimersByTime(15000);

      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(dockerService.getContainerStatus).toHaveBeenCalledWith(mockAgent.containerId);
      expect(dockerService.getContainerStats).toHaveBeenCalledWith(mockAgent.containerId);
      expect(emitSpy).toHaveBeenCalledWith(
        'containerStats',
        expect.objectContaining({
          success: true,
          data: {
            status: { running: true },
            stats: mockStats,
            timestamp: expect.any(String),
          },
        }),
      );
    }, 10000);

    it('should not start stats broadcasting if agent has no container', async () => {
      const agentWithoutContainer = { ...mockAgent, containerId: null };

      agentsRepository.findById.mockResolvedValue(agentWithoutContainer);
      agentsService.verifyCredentials.mockResolvedValue(true);
      agentsService.findOne.mockResolvedValue(mockAgentResponse);

      const socketId = mockSocket.id || 'test-socket-id';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).socketById.set(socketId, mockSocket);

      await gateway.handleLogin({ agentId: agentWithoutContainer.id, password: 'password123' }, mockSocket as Socket);

      expect(dockerService.getContainerStatus).not.toHaveBeenCalled();
      expect(dockerService.getContainerStats).not.toHaveBeenCalled();
    });

    it('should clean up stats interval on disconnect when no more authenticated clients', async () => {
      agentsRepository.findById.mockResolvedValue(mockAgent);
      agentsService.verifyCredentials.mockResolvedValue(true);
      agentsService.findOne.mockResolvedValue(mockAgentResponse);
      (dockerService.getContainerStatus as jest.Mock).mockResolvedValue({ running: true });
      (dockerService.getContainerStats as jest.Mock).mockResolvedValue(mockStats);

      const socketId = mockSocket.id || 'test-socket-id';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).socketById.set(socketId, mockSocket);

      await gateway.handleLogin({ agentId: mockAgent.id, password: 'password123' }, mockSocket as Socket);

      // Verify interval exists
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const statsIntervals = (gateway as any).statsIntervalsByAgent;

      expect(statsIntervals.has(mockAgent.id)).toBe(true);

      // Disconnect
      gateway.handleDisconnect(mockSocket as Socket);

      // Verify interval was cleaned up
      expect(statsIntervals.has(mockAgent.id)).toBe(false);
    });

    it('should clean up stats interval on logout when no more authenticated clients', async () => {
      agentsRepository.findById.mockResolvedValue(mockAgent);
      agentsService.verifyCredentials.mockResolvedValue(true);
      agentsService.findOne.mockResolvedValue(mockAgentResponse);
      (dockerService.getContainerStatus as jest.Mock).mockResolvedValue({ running: true });
      (dockerService.getContainerStats as jest.Mock).mockResolvedValue(mockStats);

      const socketId = mockSocket.id || 'test-socket-id';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).socketById.set(socketId, mockSocket);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).authenticatedClients.set(socketId, mockAgent.id);

      await gateway.handleLogin({ agentId: mockAgent.id, password: 'password123' }, mockSocket as Socket);

      // Verify interval exists
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const statsIntervals = (gateway as any).statsIntervalsByAgent;

      expect(statsIntervals.has(mockAgent.id)).toBe(true);

      // Logout
      await gateway.handleLogout(mockSocket as Socket);

      // Verify interval was cleaned up
      expect(statsIntervals.has(mockAgent.id)).toBe(false);
    });

    it('should continue broadcasting even if stats fetch fails', async () => {
      agentsRepository.findById.mockResolvedValue(mockAgent);
      agentsService.verifyCredentials.mockResolvedValue(true);
      agentsService.findOne.mockResolvedValue(mockAgentResponse);
      (dockerService.getContainerStatus as jest.Mock).mockResolvedValue({ running: true });
      (dockerService.getContainerStats as jest.Mock).mockRejectedValue(new Error('Stats error'));

      const socketId = mockSocket.id || 'test-socket-id';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).socketById.set(socketId, mockSocket);

      await gateway.handleLogin({ agentId: mockAgent.id, password: 'password123' }, mockSocket as Socket);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const statsIntervals = (gateway as any).statsIntervalsByAgent;

      expect(statsIntervals.has(mockAgent.id)).toBe(true);

      jest.advanceTimersByTime(15000);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(dockerService.getContainerStatus).toHaveBeenCalledTimes(2);
      expect(dockerService.getContainerStats).toHaveBeenCalledTimes(2);
    });

    it('should broadcast container status and null stats when container is stopped', async () => {
      agentsRepository.findById.mockResolvedValue(mockAgent);
      agentsService.verifyCredentials.mockResolvedValue(true);
      agentsService.findOne.mockResolvedValue(mockAgentResponse);
      (dockerService.getContainerStatus as jest.Mock).mockResolvedValue({ running: false });
      (dockerService.getContainerStats as jest.Mock).mockResolvedValue(mockStats);

      const socketId = mockSocket.id || 'test-socket-id';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).socketById.set(socketId, mockSocket);

      await gateway.handleLogin({ agentId: mockAgent.id, password: 'password123' }, mockSocket as Socket);

      expect(dockerService.getContainerStatus).toHaveBeenCalledWith(mockAgent.containerId);
      expect(dockerService.getContainerStats).not.toHaveBeenCalled();
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'containerStats',
        expect.objectContaining({
          success: true,
          data: {
            status: { running: false },
            stats: null,
            timestamp: expect.any(String),
          },
          timestamp: expect.any(String),
        }),
      );
    });

    it('should not create duplicate intervals for the same agent', async () => {
      agentsRepository.findById.mockResolvedValue(mockAgent);
      agentsService.verifyCredentials.mockResolvedValue(true);
      agentsService.findOne.mockResolvedValue(mockAgentResponse);
      (dockerService.getContainerStatus as jest.Mock).mockResolvedValue({ running: true });
      (dockerService.getContainerStats as jest.Mock).mockResolvedValue(mockStats);

      const socketId = mockSocket.id || 'test-socket-id';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).socketById.set(socketId, mockSocket);

      await gateway.handleLogin({ agentId: mockAgent.id, password: 'password123' }, mockSocket as Socket);

      // Verify interval exists
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const statsIntervals = (gateway as any).statsIntervalsByAgent;

      expect(statsIntervals.has(mockAgent.id)).toBe(true);
      const firstInterval = statsIntervals.get(mockAgent.id);

      // Login again (simulate second socket for same agent)
      await gateway.handleLogin({ agentId: mockAgent.id, password: 'password123' }, mockSocket as Socket);

      // Verify same interval is used (not duplicated)
      expect(statsIntervals.has(mockAgent.id)).toBe(true);
      expect(statsIntervals.get(mockAgent.id)).toBe(firstInterval);
    });
  });

  describe('Connection State Recovery', () => {
    it('should skip chat history restoration when socket is recovered', async () => {
      agentsRepository.findById.mockResolvedValue(mockAgent);
      agentsService.verifyCredentials.mockResolvedValue(true);
      agentsService.findOne.mockResolvedValue(mockAgentResponse);

      const mockMessages = [
        {
          id: 'msg-1',
          agentId: mockAgent.id,
          agent: mockAgent,
          actor: 'user',
          message: 'Hello',
          createdAt: new Date('2024-01-01T10:00:00Z'),
          updatedAt: new Date('2024-01-01T10:00:00Z'),
        },
      ];

      agentMessagesService.getChatHistory.mockResolvedValue(mockMessages as any);

      // Set socket.recovered to true (simulating Socket.IO connection state recovery)
      const recoveredSocket = { ...mockSocket, recovered: true } as Socket;

      await gateway.handleLogin({ agentId: mockAgent.id, password: 'password123' }, recoveredSocket);

      // Verify loginSuccess was emitted
      expect(recoveredSocket.emit).toHaveBeenCalledWith(
        'loginSuccess',
        expect.objectContaining({
          success: true,
          data: {
            message: `Welcome, ${mockAgent.name}!`,
            agentId: mockAgent.id,
            agentName: mockAgent.name,
          },
        }),
      );

      // Verify chat history was NOT fetched (should be skipped for recovered sockets)
      expect(agentMessagesService.getChatHistory).not.toHaveBeenCalled();

      // Verify only loginSuccess was emitted, no chat messages
      const chatMessageCalls = (recoveredSocket.emit as jest.Mock).mock.calls.filter(
        (call: unknown[]) => call[0] === 'chatMessage',
      );

      expect(chatMessageCalls.length).toBe(0);
    });

    it('should skip chat history restoration when agent is already authenticated', async () => {
      agentsRepository.findById.mockResolvedValue(mockAgent);
      agentsService.verifyCredentials.mockResolvedValue(true);
      agentsService.findOne.mockResolvedValue(mockAgentResponse);

      const socketId = mockSocket.id || 'test-socket-id';

      // Mark agent as already authenticated (simulating reconnection scenario)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).authenticatedClients.set(socketId, mockAgent.id);

      const mockMessages = [
        {
          id: 'msg-1',
          agentId: mockAgent.id,
          agent: mockAgent,
          actor: 'user',
          message: 'Hello',
          createdAt: new Date('2024-01-01T10:00:00Z'),
          updatedAt: new Date('2024-01-01T10:00:00Z'),
        },
      ];

      agentMessagesService.getChatHistory.mockResolvedValue(mockMessages as any);

      await gateway.handleLogin({ agentId: mockAgent.id, password: 'password123' }, mockSocket as Socket);

      // Verify loginSuccess was emitted
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'loginSuccess',
        expect.objectContaining({
          success: true,
          data: {
            message: `Welcome, ${mockAgent.name}!`,
            agentId: mockAgent.id,
            agentName: mockAgent.name,
          },
        }),
      );

      // Verify chat history was NOT fetched (should be skipped for already authenticated agents)
      expect(agentMessagesService.getChatHistory).not.toHaveBeenCalled();

      // Verify only loginSuccess was emitted, no chat messages
      const chatMessageCalls = (mockSocket.emit as jest.Mock).mock.calls.filter(
        (call: unknown[]) => call[0] === 'chatMessage',
      );

      expect(chatMessageCalls.length).toBe(0);
    });

    it('should restore chat history for new login (not recovered, not already authenticated)', async () => {
      agentsRepository.findById.mockResolvedValue(mockAgent);
      agentsService.verifyCredentials.mockResolvedValue(true);
      agentsService.findOne.mockResolvedValue(mockAgentResponse);

      const mockMessages = [
        {
          id: 'msg-1',
          agentId: mockAgent.id,
          agent: mockAgent,
          actor: 'user',
          message: 'Hello',
          createdAt: new Date('2024-01-01T10:00:00Z'),
          updatedAt: new Date('2024-01-01T10:00:00Z'),
        },
      ];

      agentMessagesService.countMessages.mockResolvedValue(mockMessages.length);
      agentMessagesService.getChatHistory.mockResolvedValue(mockMessages as any);

      // Ensure socket is not recovered and agent is not already authenticated
      const newSocket = { ...mockSocket, recovered: false } as Socket;
      const socketId = newSocket.id || 'test-socket-id';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gateway as any).authenticatedClients.delete(socketId);

      await gateway.handleLogin({ agentId: mockAgent.id, password: 'password123' }, newSocket);

      // Verify chat history WAS fetched (normal login scenario)
      // With 1 message, offset = max(0, 1 - 20) = 0
      expect(agentMessagesService.countMessages).toHaveBeenCalledWith(mockAgent.id);
      expect(agentMessagesService.getChatHistory).toHaveBeenCalledWith(mockAgent.id, 20, 0);

      // Verify chat message was emitted
      const chatMessageCalls = (newSocket.emit as jest.Mock).mock.calls.filter(
        (call: unknown[]) => call[0] === 'chatMessage',
      );

      expect(chatMessageCalls.length).toBe(1);
    });
  });

  describe('Context injection normalization (auto enrichment)', () => {
    it('returns undefined when nothing meaningful is requested', async () => {
      const result = await (gateway as any).normalizeContextInjection(mockAgent.id, {
        includeWorkspace: false,
        autoEnrichmentEnabled: false,
      });

      expect(result).toBeUndefined();
    });

    it('returns payload when only autoEnrichmentEnabled is true', async () => {
      const result = await (gateway as any).normalizeContextInjection(mockAgent.id, {
        includeWorkspace: false,
        autoEnrichmentEnabled: true,
      });

      expect(result).toEqual({
        includeWorkspace: false,
        autoEnrichmentEnabled: true,
        environmentIds: [],
        ticketShas: [],
        ticketContexts: [],
        knowledgeShas: [],
        knowledgeContexts: [],
        environmentContainerTypes: [],
      });
    });

    it('enriches workspaceContainerType when workspace is included and agent is non-generic', async () => {
      const dockerAgent = { ...mockAgent, containerType: ContainerType.DOCKER };

      agentsRepository.findById.mockResolvedValueOnce(dockerAgent);

      const result = await (gateway as any).normalizeContextInjection(mockAgent.id, {
        includeWorkspace: true,
        autoEnrichmentEnabled: false,
      });

      expect(agentsRepository.findById).toHaveBeenCalledWith(mockAgent.id);
      expect(result?.workspaceContainerType).toBe(ContainerType.DOCKER);
      expect(result?.environmentContainerTypes).toEqual([]);
    });

    it('omits workspaceContainerType when workspace agent is generic', async () => {
      agentsRepository.findById.mockResolvedValueOnce(mockAgent);

      const result = await (gateway as any).normalizeContextInjection(mockAgent.id, {
        includeWorkspace: true,
        autoEnrichmentEnabled: false,
      });

      expect(result?.workspaceContainerType).toBeUndefined();
      expect(result?.environmentContainerTypes).toEqual([]);
    });

    it('enriches environmentContainerTypes for non-generic environment agents', async () => {
      const envAgent = {
        ...mockAgent,
        id: 'env-terraform',
        containerType: ContainerType.TERRAFORM,
      };

      agentsRepository.findById.mockImplementation(async (id: string) => {
        if (id === mockAgent.id) {
          return mockAgent;
        }

        if (id === 'env-terraform') {
          return envAgent;
        }

        return null;
      });

      const result = await (gateway as any).normalizeContextInjection(mockAgent.id, {
        includeWorkspace: false,
        autoEnrichmentEnabled: true,
        environmentIds: ['env-terraform'],
      });

      expect(result?.environmentIds).toEqual(['env-terraform']);
      expect(result?.environmentContainerTypes).toEqual([
        { id: 'env-terraform', containerType: ContainerType.TERRAFORM },
      ]);
    });

    it('includes self environment id type without extra repository lookup for other ids', async () => {
      const kubernetesAgent = { ...mockAgent, containerType: ContainerType.KUBERNETES };

      agentsRepository.findById.mockClear();
      agentsRepository.findById.mockResolvedValueOnce(kubernetesAgent);

      const result = await (gateway as any).normalizeContextInjection(mockAgent.id, {
        includeWorkspace: false,
        autoEnrichmentEnabled: true,
        environmentIds: [`  ${mockAgent.id}  `],
      });

      expect(result?.environmentIds).toEqual([mockAgent.id]);
      expect(result?.environmentContainerTypes).toEqual([
        { id: mockAgent.id, containerType: ContainerType.KUBERNETES },
      ]);
      expect(agentsRepository.findById).toHaveBeenCalledTimes(1);
      expect(agentsRepository.findById).toHaveBeenCalledWith(mockAgent.id);
    });

    it('keeps generic environment ids without environmentContainerTypes entry', async () => {
      const genericEnvAgent = { ...mockAgent, id: 'env-generic', containerType: ContainerType.GENERIC };

      agentsRepository.findById.mockImplementation(async (id: string) => {
        if (id === mockAgent.id) {
          return mockAgent;
        }

        if (id === 'env-generic') {
          return genericEnvAgent;
        }

        return null;
      });

      const result = await (gateway as any).normalizeContextInjection(mockAgent.id, {
        includeWorkspace: false,
        autoEnrichmentEnabled: true,
        environmentIds: ['env-generic'],
      });

      expect(result?.environmentIds).toEqual(['env-generic']);
      expect(result?.environmentContainerTypes).toEqual([]);
    });

    it('filters unknown environment ids', async () => {
      agentsRepository.findById.mockImplementation(async (id: string) => {
        if (id === mockAgent.id) {
          return mockAgent;
        }

        return null;
      });

      const result = await (gateway as any).normalizeContextInjection(mockAgent.id, {
        includeWorkspace: false,
        autoEnrichmentEnabled: true,
        environmentIds: ['missing-env'],
      });

      expect(result?.environmentIds).toEqual([]);
      expect(result?.environmentContainerTypes).toEqual([]);
    });

    it('includes autoEnrichmentEnabled false in enrichment transcript parts when disabled', () => {
      const parts = (gateway as any).buildEnrichmentTranscriptParts(
        {
          includeWorkspace: false,
          autoEnrichmentEnabled: false,
          environmentIds: [],
          ticketShas: [],
          knowledgeShas: [],
        },
        'corr-test',
      );

      expect(parts[0].args).toMatchObject({ autoEnrichmentEnabled: false });
      expect(parts[1].result).toMatchObject({ autoEnrichmentEnabled: false });
    });

    it('defaults autoEnrichmentEnabled to true in enrichment transcript when omitted', () => {
      const parts = (gateway as any).buildEnrichmentTranscriptParts(
        {
          includeWorkspace: true,
          environmentIds: [],
          ticketShas: [],
          knowledgeShas: [],
        },
        'corr-test-2',
      );

      expect(parts[0].args).toMatchObject({ autoEnrichmentEnabled: true });
      expect(parts[1].result).toMatchObject({ autoEnrichmentEnabled: true });
    });
  });

  describe('browser preview', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockBrowserPreviewService.hasSession.mockReturnValue(false);
    });

    it('should reject startBrowserPreview when unauthorized', async () => {
      await gateway.handleStartBrowserPreview({}, mockSocket as Socket);

      expect(mockSocket.emit).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({ code: 'UNAUTHORIZED' }),
        }),
      );
    });

    it('should reject startBrowserPreview when preview is disabled', async () => {
      (gateway as any).authenticatedClients.set(mockSocket.id, 'agent-1');
      agentsRepository.findById.mockResolvedValue({
        id: 'agent-1',
        browserPreviewEnabled: false,
        vncContainerId: 'vnc-1',
      } as any);

      await gateway.handleStartBrowserPreview({}, mockSocket as Socket);

      expect(mockSocket.emit).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({
          error: expect.objectContaining({ code: 'PREVIEW_DISABLED' }),
        }),
      );
    });

    it('should start browser preview when enabled', async () => {
      (gateway as any).authenticatedClients.set(mockSocket.id, 'agent-1');
      agentsRepository.findById.mockResolvedValue({
        id: 'agent-1',
        browserPreviewEnabled: true,
        vncContainerId: 'vnc-1',
        vncNetworkId: 'net-1',
      } as any);
      mockBrowserPreviewService.startSession.mockResolvedValue(undefined);

      await gateway.handleStartBrowserPreview({ sessionId: 'preview-1' }, mockSocket as Socket);

      expect(mockBrowserPreviewService.startSession).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'preview-1',
          agentId: 'agent-1',
          vncContainerId: 'vnc-1',
          networkId: 'net-1',
        }),
      );
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'browserPreviewStarted',
        expect.objectContaining({
          success: true,
          data: { sessionId: 'preview-1' },
        }),
      );
    });

    it('should reject browserPreviewInput for foreign session', async () => {
      (gateway as any).authenticatedClients.set(mockSocket.id, 'agent-1');
      mockBrowserPreviewService.hasSession.mockReturnValue(false);

      await gateway.handleBrowserPreviewInput(
        { sessionId: 'preview-1', kind: 'mouse', event: { type: 'mouseMoved', x: 1, y: 2 } },
        mockSocket as Socket,
      );

      expect(mockSocket.emit).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({
          error: expect.objectContaining({ code: 'PREVIEW_ERROR' }),
        }),
      );
    });
  });
});
