import { Test, TestingModule } from '@nestjs/testing';

import { AgentMessageEntity } from '../entities/agent-message.entity';
import { AgentMessagesRepository } from '../repositories/agent-messages.repository';

import { AgentMessagesService } from './agent-messages.service';

describe('AgentMessagesService', () => {
  let service: AgentMessagesService;
  const mockAgent = {
    id: 'agent-uuid-123',
    name: 'Test Agent',
    description: 'Test Description',
    hashedPassword: 'hashed-password',
    containerId: 'container-id-123',
    volumePath: '/opt/agents/test-volume-uuid',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const mockMessage: AgentMessageEntity = {
    id: 'message-uuid-123',
    agentId: 'agent-uuid-123',
    agent: mockAgent as any,
    actor: 'user',
    message: 'Test message content',
    filtered: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const mockRepository = {
    create: jest.fn(),
    findByAgentId: jest.fn(),
    findLatestAgentMessage: jest.fn(),
    countByAgentId: jest.fn(),
    deleteByAgentId: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentMessagesService,
        {
          provide: AgentMessagesRepository,
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<AgentMessagesService>(AgentMessagesService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createUserMessage', () => {
    it('should create and persist a user message', async () => {
      const agentId = 'agent-uuid-123';
      const messageText = 'Hello, agent!';
      const expectedMessage = {
        ...mockMessage,
        agentId,
        actor: 'user',
        message: messageText,
      };

      mockRepository.create.mockResolvedValue(expectedMessage);

      const result = await service.createUserMessage(agentId, messageText);

      expect(result).toEqual(expectedMessage);
      expect(mockRepository.create).toHaveBeenCalledWith({
        agentId,
        actor: 'user',
        message: messageText,
        filtered: false,
      });
    });

    it('should trim the message content', async () => {
      const agentId = 'agent-uuid-123';
      const messageText = '  Hello, agent!  ';
      const expectedMessage = {
        ...mockMessage,
        agentId,
        actor: 'user',
        message: 'Hello, agent!',
      };

      mockRepository.create.mockResolvedValue(expectedMessage);

      await service.createUserMessage(agentId, messageText);

      expect(mockRepository.create).toHaveBeenCalledWith({
        agentId,
        actor: 'user',
        message: 'Hello, agent!',
        filtered: false,
      });
    });
  });

  describe('createAgentMessage', () => {
    it('should create and persist an agent message with string response', async () => {
      const agentId = 'agent-uuid-123';
      const response = 'Agent response text';
      const expectedMessage = {
        ...mockMessage,
        agentId,
        actor: 'agent',
        message: response,
      };

      mockRepository.create.mockResolvedValue(expectedMessage);

      const result = await service.createAgentMessage(agentId, response);

      expect(result).toEqual(expectedMessage);
      expect(mockRepository.create).toHaveBeenCalledWith({
        agentId,
        actor: 'agent',
        message: response,
        filtered: false,
      });
    });

    it('should create and persist a filtered agent message', async () => {
      const agentId = 'agent-uuid-123';
      const response = 'Agent response text';
      const expectedMessage = {
        ...mockMessage,
        agentId,
        actor: 'agent',
        message: response,
        filtered: true,
      };

      mockRepository.create.mockResolvedValue(expectedMessage);

      const result = await service.createAgentMessage(agentId, response, true);

      expect(result).toEqual(expectedMessage);
      expect(mockRepository.create).toHaveBeenCalledWith({
        agentId,
        actor: 'agent',
        message: response,
        filtered: true,
      });
    });

    it('should create and persist an agent message with JSON object response', async () => {
      const agentId = 'agent-uuid-123';
      const response = {
        type: 'response',
        result: 'Success',
        duration_ms: 100,
      };
      const expectedMessage = {
        ...mockMessage,
        agentId,
        actor: 'agent',
        message: JSON.stringify(response),
      };

      mockRepository.create.mockResolvedValue(expectedMessage);

      const result = await service.createAgentMessage(agentId, response);

      expect(result).toEqual(expectedMessage);
      expect(mockRepository.create).toHaveBeenCalledWith({
        agentId,
        actor: 'agent',
        message: JSON.stringify(response),
        filtered: false,
      });
    });

    it('should handle null response by converting to string', async () => {
      const agentId = 'agent-uuid-123';
      const response = null;
      const expectedMessage = {
        ...mockMessage,
        agentId,
        actor: 'agent',
        message: 'null',
      };

      mockRepository.create.mockResolvedValue(expectedMessage);

      const result = await service.createAgentMessage(agentId, response);

      expect(result).toEqual(expectedMessage);
      expect(mockRepository.create).toHaveBeenCalledWith({
        agentId,
        actor: 'agent',
        message: 'null',
        filtered: false,
      });
    });

    it('should handle number response by converting to string', async () => {
      const agentId = 'agent-uuid-123';
      const response = 42;
      const expectedMessage = {
        ...mockMessage,
        agentId,
        actor: 'agent',
        message: '42',
      };

      mockRepository.create.mockResolvedValue(expectedMessage);

      const result = await service.createAgentMessage(agentId, response);

      expect(result).toEqual(expectedMessage);
      expect(mockRepository.create).toHaveBeenCalledWith({
        agentId,
        actor: 'agent',
        message: '42',
        filtered: false,
      });
    });

    it('should handle circular reference in object by falling back to String()', async () => {
      const agentId = 'agent-uuid-123';
      const circularObj: { self?: unknown } = {};

      circularObj.self = circularObj; // Create circular reference

      // Mock JSON.stringify to throw an error for circular reference
      const originalStringify = JSON.stringify;

      jest.spyOn(JSON, 'stringify').mockImplementation(() => {
        throw new Error('Circular reference');
      });

      const expectedMessage = {
        ...mockMessage,
        agentId,
        actor: 'agent',
        message: String(circularObj),
      };

      mockRepository.create.mockResolvedValue(expectedMessage);

      const result = await service.createAgentMessage(agentId, circularObj);

      expect(result).toEqual(expectedMessage);
      expect(mockRepository.create).toHaveBeenCalledWith({
        agentId,
        actor: 'agent',
        message: expect.any(String),
        filtered: false,
      });

      // Restore original stringify
      JSON.stringify = originalStringify;
    });
  });

  describe('getChatHistory', () => {
    it('should return chat history for an agent', async () => {
      const agentId = 'agent-uuid-123';
      const messages = [mockMessage];

      mockRepository.findByAgentId.mockResolvedValue(messages);

      const result = await service.getChatHistory(agentId);

      expect(result).toEqual(messages);
      expect(mockRepository.findByAgentId).toHaveBeenCalledWith(agentId, 50, 0);
    });

    it('should use custom pagination parameters', async () => {
      const agentId = 'agent-uuid-123';
      const messages = [mockMessage];

      mockRepository.findByAgentId.mockResolvedValue(messages);

      await service.getChatHistory(agentId, 100, 10);

      expect(mockRepository.findByAgentId).toHaveBeenCalledWith(agentId, 100, 10);
    });
  });

  describe('countMessages', () => {
    it('should return count of messages for an agent', async () => {
      const agentId = 'agent-uuid-123';

      mockRepository.countByAgentId.mockResolvedValue(5);

      const result = await service.countMessages(agentId);

      expect(result).toBe(5);
      expect(mockRepository.countByAgentId).toHaveBeenCalledWith(agentId);
    });
  });

  describe('getLatestAgentMessage', () => {
    it('returns id and createdAt when message exists', async () => {
      const createdAt = new Date('2026-01-01T00:00:00.000Z');

      mockRepository.findLatestAgentMessage.mockResolvedValue({
        id: 'msg-1',
        createdAt,
        agentId: 'agent-uuid-123',
        actor: 'agent',
        message: 'hi',
        filtered: false,
        updatedAt: createdAt,
      });

      const result = await service.getLatestAgentMessage('agent-uuid-123');

      expect(result).toEqual({ id: 'msg-1', createdAt });
      expect(mockRepository.findLatestAgentMessage).toHaveBeenCalledWith('agent-uuid-123');
    });

    it('returns null when repository has no agent message', async () => {
      mockRepository.findLatestAgentMessage.mockResolvedValue(null);

      const result = await service.getLatestAgentMessage('agent-uuid-123');

      expect(result).toBeNull();
    });
  });

  describe('deleteAllMessages', () => {
    it('should delete all messages for an agent', async () => {
      const agentId = 'agent-uuid-123';

      mockRepository.deleteByAgentId.mockResolvedValue(3);

      const result = await service.deleteAllMessages(agentId);

      expect(result).toBe(3);
      expect(mockRepository.deleteByAgentId).toHaveBeenCalledWith(agentId);
    });

    it('should return 0 when no messages are deleted', async () => {
      const agentId = 'agent-uuid-123';

      mockRepository.deleteByAgentId.mockResolvedValue(0);

      const result = await service.deleteAllMessages(agentId);

      expect(result).toBe(0);
    });
  });
});
