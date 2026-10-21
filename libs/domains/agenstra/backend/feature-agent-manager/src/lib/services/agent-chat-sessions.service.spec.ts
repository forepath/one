import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { QueryFailedError } from 'typeorm';

import {
  PRIMARY_CHAT_RESUME_SESSION_SUFFIX,
  buildUserChatResumeSessionSuffix,
} from '../constants/chat-session.constants';
import { AgentChatSessionEntity } from '../entities/agent-chat-session.entity';
import { AgentChatSessionsRepository } from '../repositories/agent-chat-sessions.repository';
import { AgentMessagesRepository } from '../repositories/agent-messages.repository';
import { AgentsRepository } from '../repositories/agents.repository';

import { AgentChatSessionsService } from './agent-chat-sessions.service';

describe('AgentChatSessionsService', () => {
  let service: AgentChatSessionsService;
  const agentId = 'agent-uuid-123';
  const mockPrimarySession: AgentChatSessionEntity = {
    id: 'primary-chat-id',
    agentId,
    title: 'Chat',
    kind: 'primary',
    resumeSessionSuffix: PRIMARY_CHAT_RESUME_SESSION_SUFFIX,
    lastMessageAt: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  } as AgentChatSessionEntity;
  const mockUserSession: AgentChatSessionEntity = {
    id: 'user-chat-id',
    agentId,
    title: 'My Chat',
    kind: 'user',
    resumeSessionSuffix: buildUserChatResumeSessionSuffix('user-chat-id'),
    lastMessageAt: null,
    createdAt: new Date('2024-01-02'),
    updatedAt: new Date('2024-01-02'),
  } as AgentChatSessionEntity;
  const mockChatSessionsRepository = {
    findPrimaryByAgentId: jest.fn(),
    create: jest.fn(),
    findByAgentIdAndIdOrThrow: jest.fn(),
    findByAgentId: jest.fn(),
    countByAgentId: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findAllByAgentIds: jest.fn(),
    touchLastMessageAt: jest.fn(),
  };
  const mockAgentsRepository = {
    findByIdOrThrow: jest.fn(),
    clearOpencodeSession: jest.fn(),
  };
  const mockAgentMessagesRepository = {
    findByAgentIdAndChatSessionId: jest.fn(),
    countByAgentIdAndChatSessionId: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentChatSessionsService,
        {
          provide: AgentChatSessionsRepository,
          useValue: mockChatSessionsRepository,
        },
        {
          provide: AgentsRepository,
          useValue: mockAgentsRepository,
        },
        {
          provide: AgentMessagesRepository,
          useValue: mockAgentMessagesRepository,
        },
      ],
    }).compile();

    service = module.get<AgentChatSessionsService>(AgentChatSessionsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('ensurePrimarySession', () => {
    it('creates primary session when missing', async () => {
      mockChatSessionsRepository.findPrimaryByAgentId.mockResolvedValue(null);
      mockAgentsRepository.findByIdOrThrow.mockResolvedValue({ id: agentId });
      mockChatSessionsRepository.create.mockResolvedValue(mockPrimarySession);

      const result = await service.ensurePrimarySession(agentId);

      expect(result).toEqual(mockPrimarySession);
      expect(mockAgentsRepository.findByIdOrThrow).toHaveBeenCalledWith(agentId);
      expect(mockChatSessionsRepository.create).toHaveBeenCalledWith({
        agentId,
        title: 'Chat',
        kind: 'primary',
        resumeSessionSuffix: PRIMARY_CHAT_RESUME_SESSION_SUFFIX,
      });
    });

    it('returns existing primary session without creating', async () => {
      mockChatSessionsRepository.findPrimaryByAgentId.mockResolvedValue(mockPrimarySession);

      const result = await service.ensurePrimarySession(agentId);

      expect(result).toEqual(mockPrimarySession);
      expect(mockAgentsRepository.findByIdOrThrow).not.toHaveBeenCalled();
      expect(mockChatSessionsRepository.create).not.toHaveBeenCalled();
    });

    it('recovers when concurrent create hits unique violation', async () => {
      const uniqueError = new QueryFailedError('', [], Object.assign(new Error('duplicate'), { code: '23505' }));

      mockChatSessionsRepository.findPrimaryByAgentId
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockPrimarySession);
      mockAgentsRepository.findByIdOrThrow.mockResolvedValue({ id: agentId });
      mockChatSessionsRepository.create.mockRejectedValue(uniqueError);

      const result = await service.ensurePrimarySession(agentId);

      expect(result).toEqual(mockPrimarySession);
      expect(mockChatSessionsRepository.create).toHaveBeenCalled();
    });
  });

  describe('createUserSession', () => {
    it('creates session with kind user and -chat-{id} suffix', async () => {
      mockAgentsRepository.findByIdOrThrow.mockResolvedValue({ id: agentId });
      mockChatSessionsRepository.findPrimaryByAgentId.mockResolvedValue(mockPrimarySession);
      mockChatSessionsRepository.create.mockImplementation(async (dto: Partial<AgentChatSessionEntity>) => ({
        ...mockUserSession,
        id: dto.id as string,
        title: dto.title,
        kind: dto.kind,
        resumeSessionSuffix: dto.resumeSessionSuffix,
        agentId: dto.agentId as string,
      }));

      const result = await service.createUserSession(agentId, '  My Chat  ');

      expect(result.kind).toBe('user');
      expect(result.resumeSessionSuffix).toBe(buildUserChatResumeSessionSuffix(result.id));
      expect(mockChatSessionsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId,
          title: 'My Chat',
          kind: 'user',
          id: expect.any(String),
          resumeSessionSuffix: expect.stringMatching(/^-chat-/),
        }),
      );
    });
  });

  describe('updateSessionTitle', () => {
    it('updates trimmed title', async () => {
      const updated = { ...mockUserSession, title: 'Renamed' };

      mockChatSessionsRepository.findByAgentIdAndIdOrThrow.mockResolvedValue(mockUserSession);
      mockChatSessionsRepository.update.mockResolvedValue(updated);

      const result = await service.updateSessionTitle(agentId, mockUserSession.id, '  Renamed  ');

      expect(result).toEqual(updated);
      expect(mockChatSessionsRepository.update).toHaveBeenCalledWith(mockUserSession.id, { title: 'Renamed' });
    });

    it('rejects empty title', async () => {
      mockChatSessionsRepository.findByAgentIdAndIdOrThrow.mockResolvedValue(mockUserSession);

      await expect(service.updateSessionTitle(agentId, mockUserSession.id, '   ')).rejects.toThrow(BadRequestException);
      expect(mockChatSessionsRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('deleteSession', () => {
    it('rejects primary session with BadRequestException', async () => {
      mockChatSessionsRepository.findByAgentIdAndIdOrThrow.mockResolvedValue(mockPrimarySession);

      await expect(service.deleteSession(agentId, mockPrimarySession.id)).rejects.toThrow(BadRequestException);
      expect(mockChatSessionsRepository.delete).not.toHaveBeenCalled();
      expect(mockAgentsRepository.clearOpencodeSession).not.toHaveBeenCalled();
    });

    it('deletes user session and clears ACP session', async () => {
      mockChatSessionsRepository.findByAgentIdAndIdOrThrow.mockResolvedValue(mockUserSession);
      mockChatSessionsRepository.delete.mockResolvedValue(undefined);
      mockAgentsRepository.clearOpencodeSession.mockResolvedValue(undefined);

      await service.deleteSession(agentId, mockUserSession.id);

      expect(mockChatSessionsRepository.delete).toHaveBeenCalledWith(mockUserSession.id);
      expect(mockAgentsRepository.clearOpencodeSession).toHaveBeenCalledWith(
        agentId,
        mockUserSession.resumeSessionSuffix,
      );
    });
  });

  describe('resolveSessionForChat', () => {
    it('defaults to primary when chatId omitted', async () => {
      mockChatSessionsRepository.findPrimaryByAgentId.mockResolvedValue(mockPrimarySession);

      const result = await service.resolveSessionForChat(agentId);

      expect(result).toEqual(mockPrimarySession);
      expect(mockChatSessionsRepository.findByAgentIdAndIdOrThrow).not.toHaveBeenCalled();
    });

    it('resolves specific session when chatId provided', async () => {
      mockChatSessionsRepository.findByAgentIdAndIdOrThrow.mockResolvedValue(mockUserSession);

      const result = await service.resolveSessionForChat(agentId, mockUserSession.id);

      expect(result).toEqual(mockUserSession);
      expect(mockChatSessionsRepository.findByAgentIdAndIdOrThrow).toHaveBeenCalledWith(agentId, mockUserSession.id);
    });
  });

  describe('listSessions', () => {
    it('ensures primary then lists sessions', async () => {
      mockAgentsRepository.findByIdOrThrow.mockResolvedValue({ id: agentId });
      mockChatSessionsRepository.findPrimaryByAgentId.mockResolvedValue(mockPrimarySession);
      mockChatSessionsRepository.findByAgentId.mockResolvedValue([mockPrimarySession, mockUserSession]);

      const result = await service.listSessions(agentId, 25, 5);

      expect(result).toEqual([mockPrimarySession, mockUserSession]);
      expect(mockChatSessionsRepository.findByAgentId).toHaveBeenCalledWith(agentId, 25, 5);
    });
  });

  describe('countSessions', () => {
    it('ensures primary then counts sessions', async () => {
      mockAgentsRepository.findByIdOrThrow.mockResolvedValue({ id: agentId });
      mockChatSessionsRepository.findPrimaryByAgentId.mockResolvedValue(mockPrimarySession);
      mockChatSessionsRepository.countByAgentId.mockResolvedValue(2);

      const result = await service.countSessions(agentId);

      expect(result).toBe(2);
      expect(mockChatSessionsRepository.countByAgentId).toHaveBeenCalledWith(agentId);
    });
  });

  describe('mapToResponseDto', () => {
    it('maps entity to response DTO', () => {
      const dto = service.mapToResponseDto(mockUserSession);

      expect(dto).toEqual({
        id: mockUserSession.id,
        agentId: mockUserSession.agentId,
        title: mockUserSession.title,
        kind: mockUserSession.kind,
        lastMessageAt: undefined,
        createdAt: mockUserSession.createdAt,
        updatedAt: mockUserSession.updatedAt,
      });
    });
  });

  describe('mapToSummaryDto', () => {
    it('maps entity to summary DTO', () => {
      const dto = service.mapToSummaryDto(mockPrimarySession);

      expect(dto).toEqual({
        id: mockPrimarySession.id,
        title: mockPrimarySession.title,
        kind: mockPrimarySession.kind,
        lastMessageAt: undefined,
        createdAt: mockPrimarySession.createdAt,
      });
    });
  });
});
