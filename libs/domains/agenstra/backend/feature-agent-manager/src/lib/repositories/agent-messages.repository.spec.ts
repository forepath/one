import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AgentMessageEntity } from '../entities/agent-message.entity';
import { AgentEntity, ContainerType } from '../entities/agent.entity';

import { AgentMessagesRepository } from './agent-messages.repository';

describe('AgentMessagesRepository', () => {
  let repository: AgentMessagesRepository;
  const mockAgent: AgentEntity = {
    id: 'agent-uuid-123',
    name: 'Test Agent',
    description: 'Test Description',
    hashedPassword: 'hashed-password',
    containerId: 'container-id-123',
    volumePath: '/opt/agents/test-volume-uuid',
    agentType: 'cursor',
    containerType: ContainerType.GENERIC,
    browserPreviewEnabled: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const mockMessage: AgentMessageEntity = {
    id: 'message-uuid-123',
    agentId: 'agent-uuid-123',
    agent: mockAgent,
    actor: 'user',
    message: 'Test message content',
    filtered: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const mockTypeOrmRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
    delete: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentMessagesRepository,
        {
          provide: getRepositoryToken(AgentMessageEntity),
          useValue: mockTypeOrmRepository,
        },
      ],
    }).compile();

    repository = module.get<AgentMessagesRepository>(AgentMessagesRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findByIdOrThrow', () => {
    it('should return message when found', async () => {
      mockTypeOrmRepository.findOne.mockResolvedValue(mockMessage);

      const result = await repository.findByIdOrThrow('message-uuid-123');

      expect(result).toEqual(mockMessage);
      expect(mockTypeOrmRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'message-uuid-123' },
      });
    });

    it('should throw NotFoundException when message not found', async () => {
      mockTypeOrmRepository.findOne.mockResolvedValue(null);

      await expect(repository.findByIdOrThrow('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findById', () => {
    it('should return message when found', async () => {
      mockTypeOrmRepository.findOne.mockResolvedValue(mockMessage);

      const result = await repository.findById('message-uuid-123');

      expect(result).toEqual(mockMessage);
    });

    it('should return null when message not found', async () => {
      mockTypeOrmRepository.findOne.mockResolvedValue(null);

      const result = await repository.findById('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('findByAgentId', () => {
    it('should return array of messages for agent with pagination', async () => {
      const messages = [mockMessage];

      mockTypeOrmRepository.find.mockResolvedValue(messages);

      const result = await repository.findByAgentId('agent-uuid-123', 50, 0);

      expect(result).toEqual(messages);
      expect(mockTypeOrmRepository.find).toHaveBeenCalledWith({
        where: { agentId: 'agent-uuid-123' },
        take: 50,
        skip: 0,
        order: { createdAt: 'ASC' },
        relations: ['agent'],
      });
    });

    it('should use default pagination values', async () => {
      const messages = [mockMessage];

      mockTypeOrmRepository.find.mockResolvedValue(messages);

      await repository.findByAgentId('agent-uuid-123');

      expect(mockTypeOrmRepository.find).toHaveBeenCalledWith({
        where: { agentId: 'agent-uuid-123' },
        take: 50,
        skip: 0,
        order: { createdAt: 'ASC' },
        relations: ['agent'],
      });
    });
  });

  describe('findAll', () => {
    it('should return array of messages with pagination', async () => {
      const messages = [mockMessage];

      mockTypeOrmRepository.find.mockResolvedValue(messages);

      const result = await repository.findAll(50, 0);

      expect(result).toEqual(messages);
      expect(mockTypeOrmRepository.find).toHaveBeenCalledWith({
        take: 50,
        skip: 0,
        order: { createdAt: 'DESC' },
        relations: ['agent'],
      });
    });

    it('should use default pagination values', async () => {
      const messages = [mockMessage];

      mockTypeOrmRepository.find.mockResolvedValue(messages);

      await repository.findAll();

      expect(mockTypeOrmRepository.find).toHaveBeenCalledWith({
        take: 50,
        skip: 0,
        order: { createdAt: 'DESC' },
        relations: ['agent'],
      });
    });
  });

  describe('count', () => {
    it('should return total count', async () => {
      mockTypeOrmRepository.count.mockResolvedValue(10);

      const result = await repository.count();

      expect(result).toBe(10);
    });
  });

  describe('countByAgentId', () => {
    it('should return count for specific agent', async () => {
      mockTypeOrmRepository.count.mockResolvedValue(5);

      const result = await repository.countByAgentId('agent-uuid-123');

      expect(result).toBe(5);
      expect(mockTypeOrmRepository.count).toHaveBeenCalledWith({
        where: { agentId: 'agent-uuid-123' },
      });
    });
  });

  describe('create', () => {
    it('should create and save new message', async () => {
      const createData = {
        agentId: 'agent-uuid-123',
        actor: 'user',
        message: 'New message content',
      };
      const createdMessage = { ...mockMessage, ...createData };

      mockTypeOrmRepository.create.mockReturnValue(createdMessage);
      mockTypeOrmRepository.save.mockResolvedValue(createdMessage);

      const result = await repository.create(createData);

      expect(result).toEqual(createdMessage);
      expect(mockTypeOrmRepository.create).toHaveBeenCalledWith(createData);
      expect(mockTypeOrmRepository.save).toHaveBeenCalledWith(createdMessage);
    });
  });

  describe('delete', () => {
    it('should delete message', async () => {
      mockTypeOrmRepository.findOne.mockResolvedValue(mockMessage);
      mockTypeOrmRepository.remove.mockResolvedValue(mockMessage);

      await repository.delete('message-uuid-123');

      expect(mockTypeOrmRepository.remove).toHaveBeenCalledWith(mockMessage);
    });
  });

  describe('findLatestAgentMessage', () => {
    it('returns latest agent-authored message', async () => {
      const agentMessage = { ...mockMessage, actor: 'agent' };

      mockTypeOrmRepository.findOne.mockResolvedValue(agentMessage);

      const result = await repository.findLatestAgentMessage('agent-uuid-123');

      expect(result).toEqual(agentMessage);
      expect(mockTypeOrmRepository.findOne).toHaveBeenCalledWith({
        where: { agentId: 'agent-uuid-123', actor: 'agent' },
        order: { createdAt: 'DESC' },
      });
    });

    it('returns null when no agent messages exist', async () => {
      mockTypeOrmRepository.findOne.mockResolvedValue(null);

      const result = await repository.findLatestAgentMessage('agent-uuid-123');

      expect(result).toBeNull();
    });
  });

  describe('deleteByAgentId', () => {
    it('should delete all messages for agent', async () => {
      mockTypeOrmRepository.delete.mockResolvedValue({ affected: 3 });

      const result = await repository.deleteByAgentId('agent-uuid-123');

      expect(result).toBe(3);
      expect(mockTypeOrmRepository.delete).toHaveBeenCalledWith({
        agentId: 'agent-uuid-123',
      });
    });

    it('should return 0 when no messages deleted', async () => {
      mockTypeOrmRepository.delete.mockResolvedValue({ affected: 0 });

      const result = await repository.deleteByAgentId('agent-uuid-123');

      expect(result).toBe(0);
    });
  });
});
