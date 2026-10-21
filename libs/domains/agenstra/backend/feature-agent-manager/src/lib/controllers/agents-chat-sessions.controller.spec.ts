import { Test, TestingModule } from '@nestjs/testing';

import { CreateChatSessionDto } from '../dto/create-chat-session.dto';
import { ChatSessionResponseDto } from '../dto/chat-session-response.dto';
import { UpdateChatSessionDto } from '../dto/update-chat-session.dto';
import { AgentChatSessionEntity } from '../entities/agent-chat-session.entity';
import { AgentChatSessionsService } from '../services/agent-chat-sessions.service';

import { AgentsChatSessionsController } from './agents-chat-sessions.controller';

describe('AgentsChatSessionsController', () => {
  let controller: AgentsChatSessionsController;
  let service: jest.Mocked<AgentChatSessionsService>;
  const mockAgentId = 'test-agent-uuid';
  const mockChatId = 'test-chat-uuid';
  const mockChatSessionEntity: AgentChatSessionEntity = {
    id: mockChatId,
    agentId: mockAgentId,
    title: 'Chat',
    kind: 'user',
    resumeSessionSuffix: `-chat-${mockChatId}`,
    lastMessageAt: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  } as AgentChatSessionEntity;
  const mockChatSessionResponse: ChatSessionResponseDto = {
    id: mockChatId,
    agentId: mockAgentId,
    title: 'Chat',
    kind: 'user',
    lastMessageAt: undefined,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };
  const mockService = {
    listSessions: jest.fn(),
    countSessions: jest.fn(),
    createUserSession: jest.fn(),
    getSession: jest.fn(),
    updateSessionTitle: jest.fn(),
    deleteSession: jest.fn(),
    getMessagesForSession: jest.fn(),
    mapToResponseDto: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AgentsChatSessionsController],
      providers: [
        {
          provide: AgentChatSessionsService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<AgentsChatSessionsController>(AgentsChatSessionsController);
    service = module.get(AgentChatSessionsService);
    mockService.mapToResponseDto.mockImplementation((entity: AgentChatSessionEntity) => ({
      id: entity.id,
      agentId: entity.agentId,
      title: entity.title ?? undefined,
      kind: entity.kind,
      lastMessageAt: entity.lastMessageAt ?? undefined,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    }));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('listChatSessions', () => {
    it('should return array of chat sessions', async () => {
      service.listSessions.mockResolvedValue([mockChatSessionEntity]);

      const result = await controller.listChatSessions(mockAgentId, 50, 0);

      expect(result).toEqual([mockChatSessionResponse]);
      expect(service.listSessions).toHaveBeenCalledWith(mockAgentId, 50, 0);
    });

    it('should use default pagination values', async () => {
      service.listSessions.mockResolvedValue([mockChatSessionEntity]);

      const result = await controller.listChatSessions(mockAgentId);

      expect(result).toEqual([mockChatSessionResponse]);
      expect(service.listSessions).toHaveBeenCalledWith(mockAgentId, 50, 0);
    });

    it('should use custom pagination parameters', async () => {
      service.listSessions.mockResolvedValue([mockChatSessionEntity]);

      const result = await controller.listChatSessions(mockAgentId, 100, 10);

      expect(result).toEqual([mockChatSessionResponse]);
      expect(service.listSessions).toHaveBeenCalledWith(mockAgentId, 100, 10);
    });
  });

  describe('countChatSessions', () => {
    it('should return count of chat sessions', async () => {
      service.countSessions.mockResolvedValue(5);

      const result = await controller.countChatSessions(mockAgentId);

      expect(result).toEqual({ count: 5 });
      expect(service.countSessions).toHaveBeenCalledWith(mockAgentId);
    });

    it('should return zero when no chat sessions exist', async () => {
      service.countSessions.mockResolvedValue(0);

      const result = await controller.countChatSessions(mockAgentId);

      expect(result).toEqual({ count: 0 });
    });
  });

  describe('createChatSession', () => {
    it('should create new chat session', async () => {
      const createDto: CreateChatSessionDto = {
        title: 'New Chat',
      };

      service.createUserSession.mockResolvedValue(mockChatSessionEntity);

      const result = await controller.createChatSession(mockAgentId, createDto);

      expect(result).toEqual(mockChatSessionResponse);
      expect(service.createUserSession).toHaveBeenCalledWith(mockAgentId, createDto.title, 'user');
    });

    it('passes the handoff kind through', async () => {
      service.createUserSession.mockResolvedValue(mockChatSessionEntity);

      await controller.createChatSession(mockAgentId, { title: 'Review', kind: 'handoff' });

      expect(service.createUserSession).toHaveBeenCalledWith(mockAgentId, 'Review', 'handoff');
    });
  });

  describe('getChatSession', () => {
    it('should return chat session', async () => {
      service.getSession.mockResolvedValue(mockChatSessionEntity);

      const result = await controller.getChatSession(mockAgentId, mockChatId);

      expect(result).toEqual(mockChatSessionResponse);
      expect(service.getSession).toHaveBeenCalledWith(mockAgentId, mockChatId);
    });
  });

  describe('updateChatSession', () => {
    it('should update chat session title', async () => {
      const updateDto: UpdateChatSessionDto = {
        title: 'Renamed Chat',
      };
      const updatedEntity = {
        ...mockChatSessionEntity,
        title: 'Renamed Chat',
      };

      service.updateSessionTitle.mockResolvedValue(updatedEntity);

      const result = await controller.updateChatSession(mockAgentId, mockChatId, updateDto);

      expect(result.title).toBe('Renamed Chat');
      expect(service.updateSessionTitle).toHaveBeenCalledWith(mockAgentId, mockChatId, updateDto.title);
    });
  });

  describe('deleteChatSession', () => {
    it('should delete chat session', async () => {
      service.deleteSession.mockResolvedValue(undefined);

      await controller.deleteChatSession(mockAgentId, mockChatId);

      expect(service.deleteSession).toHaveBeenCalledWith(mockAgentId, mockChatId);
    });
  });

  describe('listChatSessionMessages', () => {
    it('should return messages for chat session', async () => {
      const messages = [
        {
          id: 'msg-1',
          actor: 'user',
          message: 'hello',
          filtered: false,
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        },
      ];

      service.getMessagesForSession.mockResolvedValue(messages);

      const result = await controller.listChatSessionMessages(mockAgentId, mockChatId, 50, 0);

      expect(result).toEqual(messages);
      expect(service.getMessagesForSession).toHaveBeenCalledWith(mockAgentId, mockChatId, 50, 0);
    });
  });
});
