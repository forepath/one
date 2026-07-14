import {
  ClientAgentCredentialsRepository,
  ClientUsersRepository,
  SocketAuthService,
  UserRole,
} from '@forepath/identity/backend';
import { Test, TestingModule } from '@nestjs/testing';

import { StatisticsInteractionKind } from '../entities/statistics-chat-io.entity';
import { ClientsRepository } from '../repositories/clients.repository';
import { AgenstraNotificationPublisher } from '../notifications/agenstra-notification.publisher';
import { AgentConsoleStatusService } from '../services/agent-console-status.service';
import { AutoContextResolverService } from '../services/auto-context-resolver.service';
import { ClientAutomationChatRealtimeService } from '../services/client-automation-chat-realtime.service';
import { ClientWorkspaceConfigurationOverridesProxyService } from '../services/client-workspace-configuration-overrides-proxy.service';
import { ClientsService } from '../services/clients.service';
import { KnowledgeTreeService } from '../services/knowledge-tree.service';
import { StatisticsService } from '../services/statistics.service';
import { TicketAutomationChatSyncService } from '../services/ticket-automation-chat-sync.service';
import { TicketsService } from '../services/tickets.service';

import { ClientsGateway } from './clients.gateway';

jest.mock(
  'socket.io-client',
  () => {
    const emit = jest.fn();
    const onAny = jest.fn();
    const handlers: Map<string, Array<(...args: unknown[]) => void>> = new Map();
    const onceHandlers: Map<string, Array<(...args: unknown[]) => void>> = new Map();
    const on = jest.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!handlers.has(event)) {
        handlers.set(event, []);
      }

      handlers.get(event)!.push(handler);
    });
    const once = jest.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!onceHandlers.has(event)) {
        onceHandlers.set(event, []);
      }

      onceHandlers.get(event)!.push(handler);
    });
    const off = jest.fn((event: string, handler?: (...args: unknown[]) => void) => {
      if (handler) {
        const eventHandlers = handlers.get(event);

        if (eventHandlers) {
          const index = eventHandlers.indexOf(handler);

          if (index > -1) {
            eventHandlers.splice(index, 1);
          }
        }

        const eventOnceHandlers = onceHandlers.get(event);

        if (eventOnceHandlers) {
          const index = eventOnceHandlers.indexOf(handler);

          if (index > -1) {
            eventOnceHandlers.splice(index, 1);
          }
        }
      } else {
        handlers.delete(event);
        onceHandlers.delete(event);
      }
    });
    const disconnect = jest.fn();
    const removeAllListeners = jest.fn(() => {
      handlers.clear();
      onceHandlers.clear();
    });
    const triggerEvent = (event: string, ...args: unknown[]) => {
      // Trigger once handlers first (they're removed after first call)
      const onceHandlersForEvent = onceHandlers.get(event);

      if (onceHandlersForEvent) {
        onceHandlersForEvent.forEach((handler) => handler(...args));
        onceHandlers.delete(event);
      }

      // Trigger regular handlers
      const handlersForEvent = handlers.get(event);

      if (handlersForEvent) {
        handlersForEvent.forEach((handler) => handler(...args));
      }
    };
    const remote = {
      id: 'remote-1',
      emit,
      onAny,
      on,
      once,
      off,
      disconnect,
      removeAllListeners,
      disconnected: false,
      connected: true, // Default to connected so setClientSuccess emits immediately
      triggerEvent, // Helper to trigger events in tests
    };

    return { io: jest.fn(() => remote) };
  },
  { virtual: true },
);

describe('ClientsGateway', () => {
  let gateway: ClientsGateway;
  let clientsRepository: jest.Mocked<ClientsRepository>;
  let statisticsService: jest.Mocked<StatisticsService>;

  beforeAll(() => {
    process.env.CLIENT_ENDPOINT_ALLOW_INTERNAL_HOST = 'true';
  });

  afterAll(() => {
    delete process.env.CLIENT_ENDPOINT_ALLOW_INTERNAL_HOST;
  });
  const mockClientsService = {
    findOne: jest.fn(),
  };
  const mockClientsRepository = {
    findById: jest.fn(),
    findByIdOrThrow: jest.fn(),
  };
  const mockCredentialsRepo = {
    findByClientAndAgent: jest.fn(),
  };
  const mockClientUsersRepository = {
    findUserClientAccess: jest.fn(),
  };
  const mockSocketAuthService = {
    validateAndGetUser: jest
      .fn()
      .mockResolvedValue({ isApiKeyAuth: true, user: { id: 'api-key-user', roles: ['admin'] } }),
  };
  const mockStatisticsService = {
    recordChatInput: jest.fn().mockResolvedValue(undefined),
    recordChatOutput: jest.fn().mockResolvedValue(undefined),
    recordChatFilterDrop: jest.fn().mockResolvedValue(undefined),
    recordChatFilterFlag: jest.fn().mockResolvedValue(undefined),
  };
  const mockClientAutomationChatRealtime = {
    attachServer: jest.fn(),
  };
  const mockTicketAutomationChatSync = {
    hydrateForAgentClient: jest.fn().mockResolvedValue(undefined),
  };
  const mockTicketsService = {
    getPrototypePromptByClientSha: jest.fn().mockResolvedValue(null),
    resolveTicketIdByClientSha: jest.fn().mockResolvedValue(null),
  };
  const mockKnowledgeTreeService = {
    collectPromptContextsByHashes: jest.fn().mockResolvedValue({ promptSections: [] }),
    collectPromptContextsForSource: jest.fn().mockResolvedValue({ promptSections: [] }),
    findNodeBySha: jest.fn().mockResolvedValue(null),
  };
  const mockAutoContextResolverService = {
    resolve: jest.fn().mockImplementation(async ({ contextInjection }) => contextInjection),
  };
  const mockWorkspaceConfigurationOverridesProxy = {
    getConfigurationOverrides: jest.fn().mockResolvedValue([]),
  };
  const mockAgentConsoleStatusService = {
    onAgentChatActivity: jest.fn().mockResolvedValue(undefined),
    notifyVcsStateChanged: jest.fn().mockResolvedValue(undefined),
  };
  const mockNotificationPublisher = {
    publishChatMessage: jest.fn(),
    publishFilterRuleTriggered: jest.fn(),
  };
  const createMockSocket = (id = 'socket-1', withUserInfo = true) => {
    const emitted: Record<string, unknown>[] = [];
    const socket = {
      id,
      emit: jest.fn((event: string, payload: unknown) => emitted.push({ event, payload })),
      join: jest.fn().mockResolvedValue(undefined),
      leave: jest.fn().mockResolvedValue(undefined),
      getEmitted: () => emitted,
      connected: true, // Required for event forwarding in gateway
      data: withUserInfo ? { userInfo: { isApiKeyAuth: true, user: { id: 'api-key-user', roles: ['admin'] } } } : {},
    } as any;

    return socket;
  };

  beforeEach(async () => {
    mockClientUsersRepository.findUserClientAccess.mockResolvedValue(null);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientsGateway,
        { provide: ClientsService, useValue: mockClientsService },
        { provide: ClientsRepository, useValue: mockClientsRepository },
        { provide: ClientUsersRepository, useValue: mockClientUsersRepository },
        { provide: ClientAgentCredentialsRepository, useValue: mockCredentialsRepo },
        { provide: SocketAuthService, useValue: mockSocketAuthService },
        { provide: StatisticsService, useValue: mockStatisticsService },
        { provide: ClientAutomationChatRealtimeService, useValue: mockClientAutomationChatRealtime },
        { provide: TicketAutomationChatSyncService, useValue: mockTicketAutomationChatSync },
        { provide: TicketsService, useValue: mockTicketsService },
        { provide: KnowledgeTreeService, useValue: mockKnowledgeTreeService },
        { provide: AutoContextResolverService, useValue: mockAutoContextResolverService },
        { provide: AgentConsoleStatusService, useValue: mockAgentConsoleStatusService },
        {
          provide: ClientWorkspaceConfigurationOverridesProxyService,
          useValue: mockWorkspaceConfigurationOverridesProxy,
        },
        {
          provide: AgenstraNotificationPublisher,
          useValue: mockNotificationPublisher,
        },
      ],
    }).compile();

    gateway = module.get(ClientsGateway);
    clientsRepository = module.get(ClientsRepository);
    statisticsService = module.get(StatisticsService);
  });

  afterEach(async () => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(gateway).toBeInstanceOf(ClientsGateway);
  });

  it('should set client on setClient and emit success', async () => {
    const socket = createMockSocket();

    mockClientsRepository.findByIdOrThrow.mockResolvedValue({
      id: 'client-uuid',
      endpoint: 'http://localhost:3100/api',
      authenticationType: 'api_key',
      apiKey: 'x',
      agentWsPort: 8099,
    } as any);
    await gateway.handleSetClient({ clientId: 'client-uuid' }, socket);
    expect(clientsRepository.findByIdOrThrow).toHaveBeenCalledWith('client-uuid');
    expect(socket.emit).toHaveBeenCalledWith('setClientSuccess', expect.objectContaining({ clientId: 'client-uuid' }));
    const { io } = jest.requireMock('socket.io-client') as { io: jest.Mock };

    expect(io).toHaveBeenCalledWith(
      'http://localhost:8099/agents',
      expect.objectContaining({
        extraHeaders: expect.objectContaining({ Authorization: expect.stringMatching(/^Bearer /) }),
      }),
    );
  });

  it('should enrich forwarded chat context with ticket prompt trees by sha', async () => {
    const socket = createMockSocket();
    const { io } = jest.requireMock('socket.io-client') as { io: jest.Mock };
    const remote = io() as any;

    mockClientsRepository.findByIdOrThrow.mockResolvedValue({
      id: 'client-uuid',
      endpoint: 'http://localhost:3100/api',
      authenticationType: 'api_key',
      apiKey: 'x',
      agentWsPort: 8099,
    } as any);
    mockCredentialsRepo.findByClientAndAgent.mockResolvedValue({ password: 'pw' });
    mockTicketsService.getPrototypePromptByClientSha.mockResolvedValue({
      prompt: 'Parent tickets...\nThis ticket and its subtasks:\n...',
    });

    await gateway.handleSetClient({ clientId: 'client-uuid' }, socket);
    const forwardPromise = gateway.handleForward(
      {
        event: 'chat',
        agentId: 'agent-uuid',
        payload: {
          message: 'hello',
          contextInjection: { includeWorkspace: true, ticketShas: ['329ec4f'] },
        },
      },
      socket,
    );

    await new Promise((resolve) => setImmediate(resolve));
    remote.triggerEvent('loginSuccess');
    await forwardPromise;

    expect(mockTicketsService.getPrototypePromptByClientSha).toHaveBeenCalledWith('client-uuid', '329ec4f');
    expect(mockWorkspaceConfigurationOverridesProxy.getConfigurationOverrides).toHaveBeenCalledWith('client-uuid');
    expect(mockAutoContextResolverService.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'client-uuid',
        workspaceAutoEnrichEnabledGlobal: undefined,
        workspaceAutoEnrichVectorMaxCosineDistance: undefined,
      }),
    );
    expect(remote.emit).toHaveBeenCalledWith(
      'chat',
      expect.objectContaining({
        contextInjection: expect.objectContaining({
          ticketShas: ['329ec4f'],
          ticketContexts: ['Parent tickets...\nThis ticket and its subtasks:\n...'],
        }),
      }),
    );
  });

  it('should emit error on setClient when missing clientId', async () => {
    const socket = createMockSocket();

    await gateway.handleSetClient({} as any, socket);
    expect(socket.emit).toHaveBeenCalledWith('error', expect.objectContaining({ message: expect.any(String) }));
  });

  it('should emit Unauthorized when socket has no userInfo', async () => {
    const socket = createMockSocket('socket-1', false);

    mockClientsRepository.findByIdOrThrow.mockResolvedValue({
      id: 'client-uuid',
      endpoint: 'http://localhost:3100/api',
      authenticationType: 'api_key',
      apiKey: 'x',
      agentWsPort: 8099,
    } as any);
    await gateway.handleSetClient({ clientId: 'client-uuid' }, socket);
    expect(socket.emit).toHaveBeenCalledWith('error', { message: 'Unauthorized' });
  });

  it('should emit error when user lacks access to client (403)', async () => {
    const socket = createMockSocket();

    (socket as any).data = {
      userInfo: {
        userId: 'user-without-access',
        userRole: UserRole.USER,
        isApiKeyAuth: false,
        user: { id: 'user-without-access', roles: ['user'] },
      },
    };
    mockClientsRepository.findById.mockResolvedValue({
      id: 'client-uuid',
      userId: 'other-owner',
    } as any);
    mockClientUsersRepository.findUserClientAccess.mockResolvedValue(null);
    await gateway.handleSetClient({ clientId: 'client-uuid' }, socket);
    expect(socket.emit).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({ message: 'You do not have access to this client' }),
    );
  });

  it('should emit error on setClient when findOne throws', async () => {
    const socket = createMockSocket();

    mockClientsRepository.findByIdOrThrow.mockRejectedValue(new Error('not found'));
    await gateway.handleSetClient({ clientId: 'bad' }, socket);
    expect(socket.emit).toHaveBeenCalledWith('error', expect.objectContaining({ message: 'not found' }));
  });

  it('should emit error on forward without setClient', async () => {
    const socket = createMockSocket();

    await gateway.handleForward({ event: 'chat', payload: {} }, socket);
    expect(socket.emit).toHaveBeenCalledWith('error', expect.objectContaining({ message: expect.any(String) }));
  });

  it('should ack forward when client is set', async () => {
    const socket = createMockSocket();

    mockClientsRepository.findByIdOrThrow.mockResolvedValue({
      id: 'client-uuid',
      endpoint: 'http://localhost:3100/api',
      authenticationType: 'api_key',
      apiKey: 'x',
      agentWsPort: 8099,
    } as any);
    await gateway.handleSetClient({ clientId: 'client-uuid' }, socket);
    const { io } = jest.requireMock('socket.io-client') as { io: jest.Mock };
    const remote = io();

    await gateway.handleForward({ event: 'chat', payload: { text: 'hi' } }, socket);
    expect(remote.emit).toHaveBeenCalledWith('chat', { text: 'hi' });
    expect(socket.emit).toHaveBeenCalledWith('forwardAck', expect.objectContaining({ received: true, event: 'chat' }));
  });

  it('should wait for login success before forwarding when agentId provided', async () => {
    const socket = createMockSocket();
    const { io } = jest.requireMock('socket.io-client') as { io: jest.Mock };
    const remote = io() as any;

    mockClientsRepository.findByIdOrThrow.mockResolvedValue({
      id: 'client-uuid',
      endpoint: 'http://localhost:3100/api',
      authenticationType: 'api_key',
      apiKey: 'x',
      agentWsPort: 8099,
    } as any);
    mockCredentialsRepo.findByClientAndAgent.mockResolvedValue({
      id: 'cred-1',
      clientId: 'client-uuid',
      agentId: 'agent-uuid',
      password: 'password123',
    } as any);
    await gateway.handleSetClient({ clientId: 'client-uuid' }, socket);
    // Start forward (will trigger login)
    const forwardPromise = gateway.handleForward(
      { event: 'chat', payload: { message: 'hi' }, agentId: 'agent-uuid' },
      socket,
    );

    // Wait for handlers to be registered (handlers are registered in Promise constructor)
    // Use setImmediate to ensure the Promise constructor has executed
    await new Promise((resolve) => setImmediate(resolve));
    // Simulate loginSuccess event being emitted from remote
    // This should trigger the once('loginSuccess') handler
    remote.triggerEvent('loginSuccess');
    await forwardPromise;
    expect(remote.emit).toHaveBeenCalledWith('login', { agentId: 'agent-uuid', password: 'password123' });
    expect(remote.emit).toHaveBeenCalledWith('chat', { message: 'hi' });
    expect(socket.emit).toHaveBeenCalledWith('forwardAck', expect.objectContaining({ received: true, event: 'chat' }));
  });

  it('should record chat input statistics when forwarding chat with agentId', async () => {
    const socket = createMockSocket();

    mockClientsRepository.findByIdOrThrow.mockResolvedValue({
      id: 'client-uuid',
      endpoint: 'http://localhost:3100/api',
      authenticationType: 'api_key',
      apiKey: 'x',
      agentWsPort: 8099,
    } as any);
    await gateway.handleSetClient({ clientId: 'client-uuid' }, socket);
    const { io } = jest.requireMock('socket.io-client') as { io: jest.Mock };
    const remote = io() as any;

    mockCredentialsRepo.findByClientAndAgent.mockResolvedValue({
      id: 'cred-1',
      clientId: 'client-uuid',
      agentId: 'agent-uuid',
      password: 'password123',
    } as any);

    const forwardPromise = gateway.handleForward(
      { event: 'chat', payload: { message: 'Hello world' }, agentId: 'agent-uuid' },
      socket,
    );

    await new Promise((resolve) => setImmediate(resolve));
    remote.triggerEvent('loginSuccess');
    await forwardPromise;

    expect(statisticsService.recordChatInput).toHaveBeenCalledWith(
      'client-uuid',
      'agent-uuid',
      2, // word count for "Hello world"
      11, // char count
      undefined, // userId (api-key auth)
    );
  });

  it('should record prompt enhancement input when forwarding enhanceChat with agentId', async () => {
    const socket = createMockSocket();

    mockClientsRepository.findByIdOrThrow.mockResolvedValue({
      id: 'client-uuid',
      endpoint: 'http://localhost:3100/api',
      authenticationType: 'api_key',
      apiKey: 'x',
      agentWsPort: 8099,
    } as any);
    await gateway.handleSetClient({ clientId: 'client-uuid' }, socket);
    const { io } = jest.requireMock('socket.io-client') as { io: jest.Mock };
    const remote = io() as any;

    mockCredentialsRepo.findByClientAndAgent.mockResolvedValue({
      id: 'cred-1',
      clientId: 'client-uuid',
      agentId: 'agent-uuid',
      password: 'password123',
    } as any);

    const forwardPromise = gateway.handleForward(
      {
        event: 'enhanceChat',
        payload: { message: 'draft', correlationId: 'corr-1' },
        agentId: 'agent-uuid',
      },
      socket,
    );

    await new Promise((resolve) => setImmediate(resolve));
    remote.triggerEvent('loginSuccess');
    await forwardPromise;

    expect(remote.emit).toHaveBeenCalledWith('enhanceChat', { message: 'draft', correlationId: 'corr-1' });
    expect(statisticsService.recordChatInput).toHaveBeenCalledWith(
      'client-uuid',
      'agent-uuid',
      1,
      5,
      undefined,
      StatisticsInteractionKind.PROMPT_ENHANCEMENT,
    );
  });

  it('should record ticket body generation input when forwarding generateTicketBody with agentId', async () => {
    const socket = createMockSocket();

    mockClientsRepository.findByIdOrThrow.mockResolvedValue({
      id: 'client-uuid',
      endpoint: 'http://localhost:3100/api',
      authenticationType: 'api_key',
      apiKey: 'x',
      agentWsPort: 8099,
    } as any);
    await gateway.handleSetClient({ clientId: 'client-uuid' }, socket);
    const { io } = jest.requireMock('socket.io-client') as { io: jest.Mock };
    const remote = io() as any;

    mockCredentialsRepo.findByClientAndAgent.mockResolvedValue({
      id: 'cred-1',
      clientId: 'client-uuid',
      agentId: 'agent-uuid',
      password: 'password123',
    } as any);

    const forwardPromise = gateway.handleForward(
      {
        event: 'generateTicketBody',
        payload: { title: 'Fix login', correlationId: 'corr-tb' },
        agentId: 'agent-uuid',
      },
      socket,
    );

    await new Promise((resolve) => setImmediate(resolve));
    remote.triggerEvent('loginSuccess');
    await forwardPromise;

    expect(remote.emit).toHaveBeenCalledWith('generateTicketBody', {
      title: 'Fix login',
      correlationId: 'corr-tb',
    });
    expect(statisticsService.recordChatInput).toHaveBeenCalledWith(
      'client-uuid',
      'agent-uuid',
      2,
      9,
      undefined,
      StatisticsInteractionKind.TICKET_BODY_GENERATION,
    );
  });

  it('should forward chat payload with model indicator unchanged', async () => {
    const socket = createMockSocket();
    const { io } = jest.requireMock('socket.io-client') as { io: jest.Mock };
    const remote = io() as any;

    mockClientsRepository.findByIdOrThrow.mockResolvedValue({
      id: 'client-uuid',
      endpoint: 'http://localhost:3100/api',
      authenticationType: 'api_key',
      apiKey: 'x',
      agentWsPort: 8099,
    } as any);
    mockCredentialsRepo.findByClientAndAgent.mockResolvedValue({
      id: 'cred-1',
      clientId: 'client-uuid',
      agentId: 'agent-uuid',
      password: 'password123',
    } as any);
    await gateway.handleSetClient({ clientId: 'client-uuid' }, socket);
    const chatPayload = { message: 'hi there', model: 'gpt-4.1-mini' };
    const forwardPromise = gateway.handleForward(
      { event: 'chat', payload: chatPayload, agentId: 'agent-uuid' },
      socket,
    );

    await new Promise((resolve) => setImmediate(resolve));
    remote.triggerEvent('loginSuccess');
    await forwardPromise;

    expect(remote.emit).toHaveBeenCalledWith('login', { agentId: 'agent-uuid', password: 'password123' });
    expect(remote.emit).toHaveBeenCalledWith('chat', chatPayload);
    expect(socket.emit).toHaveBeenCalledWith('forwardAck', expect.objectContaining({ event: 'chat' }));
  });

  it('should override login payload with credentials from database when event is login', async () => {
    const socket = createMockSocket();
    const { io } = jest.requireMock('socket.io-client') as { io: jest.Mock };
    const remote = io() as any;

    mockClientsRepository.findByIdOrThrow.mockResolvedValue({
      id: 'client-uuid',
      endpoint: 'http://localhost:3100/api',
      authenticationType: 'api_key',
      apiKey: 'x',
      agentWsPort: 8099,
    } as any);
    mockCredentialsRepo.findByClientAndAgent.mockResolvedValue({
      id: 'cred-1',
      clientId: 'client-uuid',
      agentId: 'agent-uuid',
      password: 'password123',
    } as any);
    await gateway.handleSetClient({ clientId: 'client-uuid' }, socket);
    // Forward login event with agentId (payload will be overridden)
    const forwardPromise = gateway.handleForward({ event: 'login', payload: {}, agentId: 'agent-uuid' }, socket);

    // Wait for handlers to be registered
    await new Promise((resolve) => setImmediate(resolve));
    // Simulate loginSuccess event
    remote.triggerEvent('loginSuccess');
    await forwardPromise;
    // Should use credentials from database, not user-provided payload
    expect(remote.emit).toHaveBeenCalledWith('login', { agentId: 'agent-uuid', password: 'password123' });
    // Should not forward login event again (already emitted)
    expect(remote.emit).toHaveBeenCalledTimes(1);
    expect(socket.emit).toHaveBeenCalledWith('forwardAck', expect.objectContaining({ received: true, event: 'login' }));
  });

  it('should always use credentials from database for login event even if agent is already logged in', async () => {
    const socket = createMockSocket();
    const { io } = jest.requireMock('socket.io-client') as { io: jest.Mock };
    const remote = io() as any;

    mockClientsRepository.findByIdOrThrow.mockResolvedValue({
      id: 'client-uuid',
      endpoint: 'http://localhost:3100/api',
      authenticationType: 'api_key',
      apiKey: 'x',
      agentWsPort: 8099,
    } as any);
    mockCredentialsRepo.findByClientAndAgent.mockResolvedValue({
      id: 'cred-1',
      clientId: 'client-uuid',
      agentId: 'agent-uuid',
      password: 'password123',
    } as any);
    await gateway.handleSetClient({ clientId: 'client-uuid' }, socket);
    // First login to mark agent as logged in
    const firstLoginPromise = gateway.handleForward({ event: 'login', payload: {}, agentId: 'agent-uuid' }, socket);

    await new Promise((resolve) => setImmediate(resolve));
    remote.triggerEvent('loginSuccess');
    await firstLoginPromise;
    // Clear mock calls
    remote.emit.mockClear();
    // Now send login again with a different payload - should still use credentials from database
    const secondLoginPromise = gateway.handleForward(
      { event: 'login', payload: { agentId: 'wrong', password: 'wrong' }, agentId: 'agent-uuid' },
      socket,
    );

    await new Promise((resolve) => setImmediate(resolve));
    remote.triggerEvent('loginSuccess');
    await secondLoginPromise;
    // Should still use credentials from database, not user-provided payload
    expect(remote.emit).toHaveBeenCalledWith('login', { agentId: 'agent-uuid', password: 'password123' });
    expect(remote.emit).toHaveBeenCalledTimes(1);
    expect(socket.emit).toHaveBeenCalledWith('forwardAck', expect.objectContaining({ received: true, event: 'login' }));
  });

  it('should forward fileUpdate event to remote agent-manager gateway', async () => {
    const socket = createMockSocket();
    const { io } = jest.requireMock('socket.io-client') as { io: jest.Mock };
    const remote = io() as any;

    mockClientsRepository.findByIdOrThrow.mockResolvedValue({
      id: 'client-uuid',
      endpoint: 'http://localhost:3100/api',
      authenticationType: 'api_key',
      apiKey: 'x',
      agentWsPort: 8099,
    } as any);
    mockCredentialsRepo.findByClientAndAgent.mockResolvedValue({
      id: 'cred-1',
      clientId: 'client-uuid',
      agentId: 'agent-uuid',
      password: 'password123',
    } as any);
    await gateway.handleSetClient({ clientId: 'client-uuid' }, socket);
    // Forward fileUpdate event with agentId (will auto-login)
    const forwardPromise = gateway.handleForward(
      {
        event: 'fileUpdate',
        payload: { filePath: '/path/to/file.ts' },
        agentId: 'agent-uuid',
      },
      socket,
    );

    // Wait for handlers to be registered
    await new Promise((resolve) => setImmediate(resolve));
    // Simulate loginSuccess event
    remote.triggerEvent('loginSuccess');
    await forwardPromise;
    // Should auto-login first
    expect(remote.emit).toHaveBeenCalledWith('login', { agentId: 'agent-uuid', password: 'password123' });
    // Should forward fileUpdate event
    expect(remote.emit).toHaveBeenCalledWith('fileUpdate', { filePath: '/path/to/file.ts' });
    expect(socket.emit).toHaveBeenCalledWith(
      'forwardAck',
      expect.objectContaining({ received: true, event: 'fileUpdate' }),
    );
  });

  it('should forward fileUpdateNotification event from remote to local socket', async () => {
    const socket = createMockSocket();
    const { io } = jest.requireMock('socket.io-client') as { io: jest.Mock };
    const remote = io() as any;

    mockClientsRepository.findByIdOrThrow.mockResolvedValue({
      id: 'client-uuid',
      endpoint: 'http://localhost:3100/api',
      authenticationType: 'api_key',
      apiKey: 'x',
      agentWsPort: 8099,
    } as any);
    await gateway.handleSetClient({ clientId: 'client-uuid' }, socket);
    // Wait for remote connection to be established and onAny handler to be registered
    await new Promise((resolve) => setImmediate(resolve));
    // Simulate remote connection being established (triggers connect event handlers)
    remote.triggerEvent('connect');
    // Wait for setClientSuccess to be processed
    await new Promise((resolve) => setImmediate(resolve));
    // Clear previous emit calls to isolate this test
    (socket.emit as jest.Mock).mockClear();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (gateway as any).lastAgentIdBySocket.set(socket.id, 'agent-uuid');
    // Simulate fileUpdateNotification event from remote agent-manager gateway
    const fileUpdateNotification = {
      success: true,
      data: {
        socketId: 'remote-socket-id',
        filePath: '/path/to/file.ts',
        timestamp: new Date().toISOString(),
      },
      timestamp: new Date().toISOString(),
    };
    // Trigger the onAny handler manually (simulating remote event)
    const onAnyHandler = remote.onAny.mock.calls[0]?.[0];

    if (onAnyHandler) {
      onAnyHandler('fileUpdateNotification', fileUpdateNotification);
    }

    // Wait for event to be processed
    await new Promise((resolve) => setImmediate(resolve));
    // Should forward fileUpdateNotification to local socket
    expect(socket.emit).toHaveBeenCalledWith('fileUpdateNotification', fileUpdateNotification);
    expect(mockAgentConsoleStatusService.notifyVcsStateChanged).toHaveBeenCalledWith('client-uuid', 'agent-uuid');
  });

  it('pushes status patch when remote emits gitStateChanged', async () => {
    const socket = createMockSocket();
    const { io } = jest.requireMock('socket.io-client') as { io: jest.Mock };
    const remote = io() as any;

    mockClientsRepository.findByIdOrThrow.mockResolvedValue({
      id: 'client-uuid',
      endpoint: 'http://localhost:3100/api',
      authenticationType: 'api_key',
      apiKey: 'x',
      agentWsPort: 8099,
    } as any);
    await gateway.handleSetClient({ clientId: 'client-uuid' }, socket);
    await new Promise((resolve) => setImmediate(resolve));
    remote.triggerEvent('connect');
    await new Promise((resolve) => setImmediate(resolve));
    mockAgentConsoleStatusService.notifyVcsStateChanged.mockClear();
    (socket.emit as jest.Mock).mockClear();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (gateway as any).lastAgentIdBySocket.set(socket.id, 'agent-uuid');

    const onAnyHandler = remote.onAny.mock.calls[0]?.[0];

    if (onAnyHandler) {
      onAnyHandler('gitStateChanged', {
        success: true,
        data: { agentId: 'agent-uuid', timestamp: new Date().toISOString() },
        timestamp: new Date().toISOString(),
      });
    }

    await new Promise((resolve) => setImmediate(resolve));
    expect(mockAgentConsoleStatusService.notifyVcsStateChanged).toHaveBeenCalledWith('client-uuid', 'agent-uuid');
  });

  it('pushes status patch for gitStateChanged using agentId from payload when lastAgentId is unset', async () => {
    const socket = createMockSocket();
    const { io } = jest.requireMock('socket.io-client') as { io: jest.Mock };
    const remote = io() as any;

    mockClientsRepository.findByIdOrThrow.mockResolvedValue({
      id: 'client-uuid',
      endpoint: 'http://localhost:3100/api',
      authenticationType: 'api_key',
      apiKey: 'x',
      agentWsPort: 8099,
    } as any);
    await gateway.handleSetClient({ clientId: 'client-uuid' }, socket);
    await new Promise((resolve) => setImmediate(resolve));
    remote.triggerEvent('connect');
    await new Promise((resolve) => setImmediate(resolve));
    mockAgentConsoleStatusService.notifyVcsStateChanged.mockClear();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (gateway as any).lastAgentIdBySocket.delete(socket.id);

    const onAnyHandler = remote.onAny.mock.calls[0]?.[0];

    if (onAnyHandler) {
      onAnyHandler('gitStateChanged', {
        success: true,
        data: { agentId: 'agent-from-payload', timestamp: new Date().toISOString() },
        timestamp: new Date().toISOString(),
      });
    }

    await new Promise((resolve) => setImmediate(resolve));
    expect(mockAgentConsoleStatusService.notifyVcsStateChanged).toHaveBeenCalledWith(
      'client-uuid',
      'agent-from-payload',
    );
  });

  describe('Remote Socket Reconnection', () => {
    it('should emit remoteReconnecting event with clientId when remote socket attempts reconnection', async () => {
      const socket = createMockSocket();
      const { io } = jest.requireMock('socket.io-client') as { io: jest.Mock };
      const remote = io() as any;

      mockClientsRepository.findByIdOrThrow.mockResolvedValue({
        id: 'client-uuid',
        endpoint: 'http://localhost:3100/api',
        authenticationType: 'api_key',
        apiKey: 'x',
        agentWsPort: 8099,
      } as any);

      await gateway.handleSetClient({ clientId: 'client-uuid' }, socket);
      await new Promise((resolve) => setImmediate(resolve));

      // Simulate reconnect_attempt event
      const reconnectAttemptHandler = remote.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'reconnect_attempt',
      )?.[1];

      if (reconnectAttemptHandler) {
        reconnectAttemptHandler(2); // attempt number 2
      }

      await new Promise((resolve) => setImmediate(resolve));

      expect(socket.emit).toHaveBeenCalledWith('remoteReconnecting', { clientId: 'client-uuid', attempt: 2 });
    });

    it('should emit remoteReconnected event with clientId when remote socket reconnects', async () => {
      const socket = createMockSocket();
      const { io } = jest.requireMock('socket.io-client') as { io: jest.Mock };
      const remote = io() as any;

      mockClientsRepository.findByIdOrThrow.mockResolvedValue({
        id: 'client-uuid',
        endpoint: 'http://localhost:3100/api',
        authenticationType: 'api_key',
        apiKey: 'x',
        agentWsPort: 8099,
      } as any);

      await gateway.handleSetClient({ clientId: 'client-uuid' }, socket);
      await new Promise((resolve) => setImmediate(resolve));

      // Simulate reconnect event
      const reconnectHandler = remote.on.mock.calls.find((call: unknown[]) => call[0] === 'reconnect')?.[1];

      if (reconnectHandler) {
        reconnectHandler();
      }

      await new Promise((resolve) => setImmediate(resolve));

      expect(socket.emit).toHaveBeenCalledWith('remoteReconnected', { clientId: 'client-uuid' });
    });

    it('should emit remoteReconnectError event with clientId when remote socket reconnection fails', async () => {
      const socket = createMockSocket();
      const { io } = jest.requireMock('socket.io-client') as { io: jest.Mock };
      const remote = io() as any;

      mockClientsRepository.findByIdOrThrow.mockResolvedValue({
        id: 'client-uuid',
        endpoint: 'http://localhost:3100/api',
        authenticationType: 'api_key',
        apiKey: 'x',
        agentWsPort: 8099,
      } as any);

      await gateway.handleSetClient({ clientId: 'client-uuid' }, socket);
      await new Promise((resolve) => setImmediate(resolve));

      // Simulate reconnect_error event
      const reconnectErrorHandler = remote.on.mock.calls.find((call: unknown[]) => call[0] === 'reconnect_error')?.[1];

      if (reconnectErrorHandler) {
        reconnectErrorHandler(new Error('Connection timeout'));
      }

      await new Promise((resolve) => setImmediate(resolve));

      expect(socket.emit).toHaveBeenCalledWith('remoteReconnectError', {
        clientId: 'client-uuid',
        error: 'Connection timeout',
      });
    });

    it('should emit remoteReconnectFailed event with clientId when all reconnection attempts fail', async () => {
      const socket = createMockSocket();
      const { io } = jest.requireMock('socket.io-client') as { io: jest.Mock };
      const remote = io() as any;

      mockClientsRepository.findByIdOrThrow.mockResolvedValue({
        id: 'client-uuid',
        endpoint: 'http://localhost:3100/api',
        authenticationType: 'api_key',
        apiKey: 'x',
        agentWsPort: 8099,
      } as any);

      await gateway.handleSetClient({ clientId: 'client-uuid' }, socket);
      await new Promise((resolve) => setImmediate(resolve));

      // Simulate reconnect_failed event
      const reconnectFailedHandler = remote.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'reconnect_failed',
      )?.[1];

      if (reconnectFailedHandler) {
        reconnectFailedHandler();
      }

      await new Promise((resolve) => setImmediate(resolve));

      expect(socket.emit).toHaveBeenCalledWith('remoteReconnectFailed', {
        clientId: 'client-uuid',
        error: expect.any(String),
      });
    });

    it('should track reconnection state independently per socket', async () => {
      const socket1 = createMockSocket('socket-1');
      const socket2 = createMockSocket('socket-2');
      const { io } = jest.requireMock('socket.io-client') as { io: jest.Mock };
      const remote1 = io() as any;

      mockClientsRepository.findByIdOrThrow.mockResolvedValue({
        id: 'client-uuid',
        endpoint: 'http://localhost:3100/api',
        authenticationType: 'api_key',
        apiKey: 'x',
        agentWsPort: 8099,
      } as any);

      // Set client for both sockets
      await gateway.handleSetClient({ clientId: 'client-uuid' }, socket1);
      await gateway.handleSetClient({ clientId: 'client-uuid' }, socket2);
      await new Promise((resolve) => setImmediate(resolve));

      // Clear previous emits
      (socket1.emit as jest.Mock).mockClear();
      (socket2.emit as jest.Mock).mockClear();

      // Simulate reconnection attempt for socket1 only
      const reconnectAttemptHandler1 = remote1.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'reconnect_attempt',
      )?.[1];

      if (reconnectAttemptHandler1) {
        reconnectAttemptHandler1(1);
      }

      await new Promise((resolve) => setImmediate(resolve));

      // Only socket1 should receive the reconnecting event
      expect(socket1.emit).toHaveBeenCalledWith('remoteReconnecting', { clientId: 'client-uuid', attempt: 1 });
      expect(socket2.emit).not.toHaveBeenCalledWith('remoteReconnecting', expect.any(Object));
    });

    it('should emit remoteDisconnected event when remote socket disconnects', async () => {
      const socket = createMockSocket();
      const { io } = jest.requireMock('socket.io-client') as { io: jest.Mock };
      const remote = io() as any;

      mockClientsRepository.findByIdOrThrow.mockResolvedValue({
        id: 'client-uuid',
        endpoint: 'http://localhost:3100/api',
        authenticationType: 'api_key',
        apiKey: 'x',
        agentWsPort: 8099,
      } as any);

      await gateway.handleSetClient({ clientId: 'client-uuid' }, socket);
      await new Promise((resolve) => setImmediate(resolve));

      // Clear previous emits
      (socket.emit as jest.Mock).mockClear();

      // Simulate disconnect event
      const disconnectHandler = remote.on.mock.calls.find((call: unknown[]) => call[0] === 'disconnect')?.[1];

      if (disconnectHandler) {
        disconnectHandler('io server disconnect');
      }

      await new Promise((resolve) => setImmediate(resolve));

      expect(socket.emit).toHaveBeenCalledWith('remoteDisconnected', { clientId: 'client-uuid' });
    });

    it('should wait for remote socket to be connected before forwarding events', async () => {
      const socket = createMockSocket();
      const { io } = jest.requireMock('socket.io-client') as { io: jest.Mock };
      const remote = io() as any;

      mockClientsRepository.findByIdOrThrow.mockResolvedValue({
        id: 'client-uuid',
        endpoint: 'http://localhost:3100/api',
        authenticationType: 'api_key',
        apiKey: 'x',
        agentWsPort: 8099,
      } as any);

      // Set remote socket to disconnected initially
      remote.disconnected = true;
      remote.connected = false;

      await gateway.handleSetClient({ clientId: 'client-uuid' }, socket);
      await new Promise((resolve) => setImmediate(resolve));

      // Try to forward an event while remote is disconnected
      const forwardPromise = gateway.handleForward({ event: 'chat', payload: { message: 'test' } }, socket);

      // Wait a bit to ensure the wait logic is triggered
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Now connect the remote socket
      remote.disconnected = false;
      remote.connected = true;

      // Wait for forward to complete
      await forwardPromise;

      // Should have waited and then forwarded the event
      expect(remote.emit).toHaveBeenCalledWith('chat', { message: 'test' });
    });

    it('should return error if remote socket does not connect within timeout', async () => {
      const socket = createMockSocket();
      const { io } = jest.requireMock('socket.io-client') as { io: jest.Mock };
      const remote = io() as any;

      mockClientsRepository.findByIdOrThrow.mockResolvedValue({
        id: 'client-uuid',
        endpoint: 'http://localhost:3100/api',
        authenticationType: 'api_key',
        apiKey: 'x',
        agentWsPort: 8099,
      } as any);

      // Set remote socket to disconnected
      remote.disconnected = true;
      remote.connected = false;

      await gateway.handleSetClient({ clientId: 'client-uuid' }, socket);
      await new Promise((resolve) => setImmediate(resolve));

      // Mock Date.now to simulate timeout
      const originalNow = Date.now;
      let currentTime = 0;

      Date.now = jest.fn(() => currentTime);

      // Try to forward an event
      const forwardPromise = gateway.handleForward({ event: 'chat', payload: { message: 'test' } }, socket);

      // Advance time past the 5-second timeout
      currentTime = 6000;
      // Trigger the wait loop to check timeout
      await new Promise((resolve) => setTimeout(resolve, 100));

      await forwardPromise;

      // Restore Date.now
      Date.now = originalNow;

      // Should have emitted error
      expect(socket.emit).toHaveBeenCalledWith('error', {
        message: 'Remote connection not established',
      });
      // Should not have forwarded the event
      expect(remote.emit).not.toHaveBeenCalledWith('chat', expect.any(Object));
    });

    it('should attempt fallback reconnection when native reconnect fails', async () => {
      const socket = createMockSocket();
      const { io } = jest.requireMock('socket.io-client') as { io: jest.Mock };
      const remote = io() as any;

      mockClientsRepository.findByIdOrThrow.mockResolvedValue({
        id: 'client-uuid',
        endpoint: 'http://localhost:3100/api',
        authenticationType: 'api_key',
        apiKey: 'x',
        agentWsPort: 8099,
      } as any);

      await gateway.handleSetClient({ clientId: 'client-uuid' }, socket);
      await new Promise((resolve) => setImmediate(resolve));

      // Clear previous emits
      (socket.emit as jest.Mock).mockClear();
      (remote.emit as jest.Mock).mockClear();

      // Simulate reconnect_failed event (native reconnection failed)
      const reconnectFailedHandler = remote.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'reconnect_failed',
      )?.[1];

      if (reconnectFailedHandler) {
        reconnectFailedHandler();
      }

      await new Promise((resolve) => setImmediate(resolve));

      // Should have attempted to create a new socket connection (fallback)
      // The io() function should be called again
      expect(io).toHaveBeenCalledTimes(2); // Once for initial connection, once for fallback

      // Wait for fallback connection attempt
      await new Promise((resolve) => setTimeout(resolve, 100));

      // If fallback connection succeeds, should emit remoteReconnected
      // If it fails, should emit remoteReconnectFailed
      const remoteReconnectedCalls = (socket.emit as jest.Mock).mock.calls.filter(
        (call: unknown[]) => call[0] === 'remoteReconnected',
      );
      const remoteReconnectFailedCalls = (socket.emit as jest.Mock).mock.calls.filter(
        (call: unknown[]) => call[0] === 'remoteReconnectFailed',
      );

      // Either remoteReconnected or remoteReconnectFailed should be called
      expect(remoteReconnectedCalls.length + remoteReconnectFailedCalls.length).toBeGreaterThan(0);
    });

    it('should automatically restore agent logins when remote socket reconnects', async () => {
      const socket = createMockSocket();
      const { io } = jest.requireMock('socket.io-client') as { io: jest.Mock };
      const remote = io() as any;

      mockClientsRepository.findByIdOrThrow.mockResolvedValue({
        id: 'client-uuid',
        endpoint: 'http://localhost:3100/api',
        authenticationType: 'api_key',
        apiKey: 'x',
        agentWsPort: 8099,
      } as any);

      // Mock credentials for agent
      mockCredentialsRepo.findByClientAndAgent.mockResolvedValue({
        clientId: 'client-uuid',
        agentId: 'agent-1',
        password: 'password123',
      } as any);

      // Set up client and remote socket
      await gateway.handleSetClient({ clientId: 'client-uuid' }, socket);
      await new Promise((resolve) => setImmediate(resolve));

      // Simulate initial connection
      remote.connected = true;
      remote.disconnected = false;
      const connectHandler = remote.on.mock.calls.find((call: unknown[]) => call[0] === 'connect')?.[1];

      if (connectHandler) {
        connectHandler();
      }

      await new Promise((resolve) => setImmediate(resolve));

      // Track login success handlers
      const loginSuccessHandlers: Array<() => void> = [];

      remote.once.mockImplementation((event: string, handler: unknown) => {
        if (event === 'loginSuccess' && typeof handler === 'function') {
          loginSuccessHandlers.push(handler as () => void);
          // Auto-trigger login success after a short delay
          setTimeout(() => {
            const handlerToCall = loginSuccessHandlers[loginSuccessHandlers.length - 1];

            if (handlerToCall) {
              handlerToCall();
            }
          }, 10);
        }

        return remote;
      });

      // Forward a login event to add agent to loggedInAgentsBySocket
      await gateway.handleForward({ event: 'login', payload: {}, agentId: 'agent-1' }, socket);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify login was sent
      expect(remote.emit).toHaveBeenCalledWith('login', { agentId: 'agent-1', password: 'password123' });

      // Clear mocks
      (remote.emit as jest.Mock).mockClear();
      loginSuccessHandlers.length = 0; // Clear handlers

      // Simulate remote disconnection
      remote.connected = false;
      remote.disconnected = true;
      const disconnectHandler = remote.on.mock.calls.find((call: unknown[]) => call[0] === 'disconnect')?.[1];

      if (disconnectHandler) {
        disconnectHandler('io server disconnect');
      }

      await new Promise((resolve) => setImmediate(resolve));

      // Trigger reconnect_attempt to set reconnecting state
      const reconnectAttemptHandler = remote.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'reconnect_attempt',
      )?.[1];

      if (reconnectAttemptHandler) {
        reconnectAttemptHandler(1);
      }

      await new Promise((resolve) => setImmediate(resolve));

      // Now simulate successful reconnection
      remote.connected = true;
      remote.disconnected = false;

      // Set up login success handlers for restoration
      remote.once.mockImplementation((event: string, handler: unknown) => {
        if (event === 'loginSuccess' && typeof handler === 'function') {
          loginSuccessHandlers.push(handler as () => void);
          // Auto-trigger login success
          setTimeout(() => {
            const handlerToCall = loginSuccessHandlers[loginSuccessHandlers.length - 1];

            if (handlerToCall) {
              handlerToCall();
            }
          }, 10);
        }

        return remote;
      });

      // Trigger connect event (this should trigger login restoration)
      const connectHandlerForReconnect = remote.on.mock.calls.find((call: unknown[]) => call[0] === 'connect')?.[1];

      if (connectHandlerForReconnect) {
        connectHandlerForReconnect();
      }

      // Wait for async operations (restoreAgentLogins is async)
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify that login was automatically sent for the logged-in agent
      expect(remote.emit).toHaveBeenCalledWith('login', { agentId: 'agent-1', password: 'password123' });
    }, 10000);

    it('should handle multiple logged-in agents when restoring after reconnection', async () => {
      const socket = createMockSocket();
      const { io } = jest.requireMock('socket.io-client') as { io: jest.Mock };
      const remote = io() as any;

      mockClientsRepository.findByIdOrThrow.mockResolvedValue({
        id: 'client-uuid',
        endpoint: 'http://localhost:3100/api',
        authenticationType: 'api_key',
        apiKey: 'x',
        agentWsPort: 8099,
      } as any);

      // Mock credentials for multiple agents
      mockCredentialsRepo.findByClientAndAgent.mockImplementation(async (clientId: string, agentId: string) => {
        if (agentId === 'agent-1' || agentId === 'agent-2') {
          return {
            clientId,
            agentId,
            password: `password-${agentId}`,
          } as any;
        }

        return null;
      });

      // Set up client and remote socket
      await gateway.handleSetClient({ clientId: 'client-uuid' }, socket);
      await new Promise((resolve) => setImmediate(resolve));

      // Simulate connect to establish connection
      remote.connected = true;
      remote.disconnected = false;
      const connectHandler = remote.on.mock.calls.find((call: unknown[]) => call[0] === 'connect')?.[1];

      if (connectHandler) {
        connectHandler();
      }

      await new Promise((resolve) => setImmediate(resolve));

      // Mock login success responses - auto-trigger on registration
      const loginSuccessHandlers: Array<() => void> = [];

      remote.once.mockImplementation((event: string, handler: unknown) => {
        if (event === 'loginSuccess' && typeof handler === 'function') {
          loginSuccessHandlers.push(handler as () => void);
          // Auto-trigger login success after a short delay
          setTimeout(() => {
            const handlerToCall = loginSuccessHandlers[loginSuccessHandlers.length - 1];

            if (handlerToCall) {
              handlerToCall();
            }
          }, 10);
        }

        return remote;
      });

      // Login agent-1
      await gateway.handleForward({ event: 'login', payload: {}, agentId: 'agent-1' }, socket);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Login agent-2
      await gateway.handleForward({ event: 'login', payload: {}, agentId: 'agent-2' }, socket);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Clear mocks
      (remote.emit as jest.Mock).mockClear();
      loginSuccessHandlers.length = 0; // Clear handlers

      // Simulate remote disconnection and reconnection
      remote.connected = false;
      remote.disconnected = true;
      const disconnectHandler = remote.on.mock.calls.find((call: unknown[]) => call[0] === 'disconnect')?.[1];

      if (disconnectHandler) {
        disconnectHandler('io server disconnect');
      }

      await new Promise((resolve) => setImmediate(resolve));

      // Trigger reconnect_attempt to set reconnecting state
      const reconnectAttemptHandler = remote.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'reconnect_attempt',
      )?.[1];

      if (reconnectAttemptHandler) {
        reconnectAttemptHandler(1);
      }

      await new Promise((resolve) => setImmediate(resolve));

      // Reset login success handlers for restoration - auto-trigger
      remote.once.mockImplementation((event: string, handler: unknown) => {
        if (event === 'loginSuccess' && typeof handler === 'function') {
          loginSuccessHandlers.push(handler as () => void);
          // Auto-trigger login success
          setTimeout(() => {
            const handlerToCall = loginSuccessHandlers[loginSuccessHandlers.length - 1];

            if (handlerToCall) {
              handlerToCall();
            }
          }, 10);
        }

        return remote;
      });

      // Simulate successful reconnection
      remote.connected = true;
      remote.disconnected = false;
      const connectHandlerForReconnect = remote.on.mock.calls.find((call: unknown[]) => call[0] === 'connect')?.[1];

      if (connectHandlerForReconnect) {
        connectHandlerForReconnect();
      }

      // Wait for async operations (restoreAgentLogins processes agents sequentially)
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Verify that login was automatically sent for both logged-in agents
      expect(remote.emit).toHaveBeenCalledWith('login', { agentId: 'agent-1', password: 'password-agent-1' });
      expect(remote.emit).toHaveBeenCalledWith('login', { agentId: 'agent-2', password: 'password-agent-2' });
    }, 10000);
  });
});
