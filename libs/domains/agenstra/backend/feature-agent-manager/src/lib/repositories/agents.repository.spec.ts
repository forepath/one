import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AgentEntity, ContainerType } from '../entities/agent.entity';

import { AgentsRepository } from './agents.repository';

describe('AgentsRepository', () => {
  let repository: AgentsRepository;
  const mockAgent: AgentEntity = {
    id: 'test-uuid',
    name: 'Test Agent',
    description: 'Test Description',
    hashedPassword: 'hashed-password',
    containerId: 'container-id-123',
    volumePath: '/opt/agents/test-volume-uuid',
    agentType: 'opencode',
    containerType: ContainerType.GENERIC,
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
    update: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentsRepository,
        {
          provide: getRepositoryToken(AgentEntity),
          useValue: mockTypeOrmRepository,
        },
      ],
    }).compile();

    repository = module.get<AgentsRepository>(AgentsRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findByIdOrThrow', () => {
    it('should return agent when found', async () => {
      mockTypeOrmRepository.findOne.mockResolvedValue(mockAgent);

      const result = await repository.findByIdOrThrow('test-uuid');

      expect(result).toEqual(mockAgent);
      expect(mockTypeOrmRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'test-uuid' },
      });
    });

    it('should throw NotFoundException when agent not found', async () => {
      mockTypeOrmRepository.findOne.mockResolvedValue(null);

      await expect(repository.findByIdOrThrow('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findById', () => {
    it('should return agent when found', async () => {
      mockTypeOrmRepository.findOne.mockResolvedValue(mockAgent);

      const result = await repository.findById('test-uuid');

      expect(result).toEqual(mockAgent);
    });

    it('should return null when agent not found', async () => {
      mockTypeOrmRepository.findOne.mockResolvedValue(null);

      const result = await repository.findById('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('findByName', () => {
    it('should return agent when found', async () => {
      mockTypeOrmRepository.findOne.mockResolvedValue(mockAgent);

      const result = await repository.findByName('Test Agent');

      expect(result).toEqual(mockAgent);
      expect(mockTypeOrmRepository.findOne).toHaveBeenCalledWith({
        where: { name: 'Test Agent' },
      });
    });
  });

  describe('findAll', () => {
    it('should return array of agents with pagination', async () => {
      const agents = [mockAgent];

      mockTypeOrmRepository.find.mockResolvedValue(agents);

      const result = await repository.findAll(10, 0);

      expect(result).toEqual(agents);
      expect(mockTypeOrmRepository.find).toHaveBeenCalledWith({
        take: 10,
        skip: 0,
        order: { createdAt: 'DESC' },
      });
    });

    it('should use default pagination values', async () => {
      const agents = [mockAgent];

      mockTypeOrmRepository.find.mockResolvedValue(agents);

      await repository.findAll();

      expect(mockTypeOrmRepository.find).toHaveBeenCalledWith({
        take: 10,
        skip: 0,
        order: { createdAt: 'DESC' },
      });
    });
  });

  describe('count', () => {
    it('should return total count', async () => {
      mockTypeOrmRepository.count.mockResolvedValue(5);

      const result = await repository.count();

      expect(result).toBe(5);
    });
  });

  describe('create', () => {
    it('should create and save new agent', async () => {
      const createData = {
        name: 'New Agent',
        description: 'New Description',
        hashedPassword: 'hashed',
        containerId: 'container-id-123',
        volumePath: '/opt/agents/test-volume-uuid',
      };
      const createdAgent = { ...mockAgent, ...createData };

      mockTypeOrmRepository.create.mockReturnValue(createdAgent);
      mockTypeOrmRepository.save.mockResolvedValue(createdAgent);

      const result = await repository.create(createData);

      expect(result).toEqual(createdAgent);
      expect(mockTypeOrmRepository.create).toHaveBeenCalledWith(createData);
      expect(mockTypeOrmRepository.save).toHaveBeenCalledWith(createdAgent);
    });
  });

  describe('update', () => {
    it('should update existing agent', async () => {
      const updateData = { name: 'Updated Agent' };
      const updatedAgent = { ...mockAgent, ...updateData };

      mockTypeOrmRepository.findOne.mockResolvedValue(mockAgent);
      mockTypeOrmRepository.save.mockResolvedValue(updatedAgent);

      const result = await repository.update('test-uuid', updateData);

      expect(result.name).toBe('Updated Agent');
      expect(result.updatedAt).toBeInstanceOf(Date);
      expect(mockTypeOrmRepository.save).toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('should delete agent', async () => {
      mockTypeOrmRepository.findOne.mockResolvedValue(mockAgent);
      mockTypeOrmRepository.remove.mockResolvedValue(mockAgent);

      await repository.delete('test-uuid');

      expect(mockTypeOrmRepository.remove).toHaveBeenCalledWith(mockAgent);
    });
  });

  describe('ACP session persistence', () => {
    it('findPersistedAcpSessionId returns primary id when container matches', async () => {
      mockTypeOrmRepository.findOne.mockResolvedValue({
        ...mockAgent,
        acpSessions: { '': 'sess-abc' },
        acpSessionContainerId: 'container-id-123',
      });

      await expect(repository.findPersistedAcpSessionId('test-uuid', 'container-id-123')).resolves.toBe('sess-abc');
    });

    it('findPersistedAcpSessionId returns suffix id', async () => {
      mockTypeOrmRepository.findOne.mockResolvedValue({
        ...mockAgent,
        acpSessions: { '': 'sess-main', '-ticket-auto-loop': 'sess-loop' },
        acpSessionContainerId: 'container-id-123',
      });

      await expect(
        repository.findPersistedAcpSessionId('test-uuid', 'container-id-123', '-ticket-auto-loop'),
      ).resolves.toBe('sess-loop');
    });

    it('findPersistedAcpSessionId returns null when container changed', async () => {
      mockTypeOrmRepository.findOne.mockResolvedValue({
        ...mockAgent,
        acpSessions: { '': 'sess-abc' },
        acpSessionContainerId: 'old-container',
      });

      await expect(repository.findPersistedAcpSessionId('test-uuid', 'container-id-123')).resolves.toBeNull();
    });

    it('saveAcpSession merges a suffix without dropping others', async () => {
      mockTypeOrmRepository.findOne.mockResolvedValue({
        ...mockAgent,
        acpSessions: { '': 'sess-main' },
        acpSessionContainerId: 'container-id-123',
      });
      mockTypeOrmRepository.update.mockResolvedValue({ affected: 1 });

      await repository.saveAcpSession('test-uuid', 'container-id-123', 'sess-loop', '-ticket-auto-loop');

      expect(mockTypeOrmRepository.update).toHaveBeenCalledWith('test-uuid', {
        acpSessions: { '': 'sess-main', '-ticket-auto-loop': 'sess-loop' },
        acpSessionContainerId: 'container-id-123',
      });
    });

    it('saveAcpSession resets map when container changed', async () => {
      mockTypeOrmRepository.findOne.mockResolvedValue({
        ...mockAgent,
        acpSessions: { '': 'sess-old' },
        acpSessionContainerId: 'old-container',
      });
      mockTypeOrmRepository.update.mockResolvedValue({ affected: 1 });

      await repository.saveAcpSession('test-uuid', 'container-id-123', 'sess-new', '-ticket-auto-loop');

      expect(mockTypeOrmRepository.update).toHaveBeenCalledWith('test-uuid', {
        acpSessions: { '-ticket-auto-loop': 'sess-new' },
        acpSessionContainerId: 'container-id-123',
      });
    });

    it('clearAcpSession removes one suffix and keeps others', async () => {
      mockTypeOrmRepository.findOne.mockResolvedValue({
        ...mockAgent,
        acpSessions: { '': 'sess-main', '-ticket-auto-loop': 'sess-loop' },
        acpSessionContainerId: 'container-id-123',
      });
      mockTypeOrmRepository.update.mockResolvedValue({ affected: 1 });

      await repository.clearAcpSession('test-uuid', '-ticket-auto-loop');

      expect(mockTypeOrmRepository.update).toHaveBeenCalledWith('test-uuid', {
        acpSessions: { '': 'sess-main' },
        acpSessionContainerId: 'container-id-123',
      });
    });

    it('clearAcpSession nulls map and container when last entry removed', async () => {
      mockTypeOrmRepository.findOne.mockResolvedValue({
        ...mockAgent,
        acpSessions: { '': 'sess-main' },
        acpSessionContainerId: 'container-id-123',
      });
      mockTypeOrmRepository.update.mockResolvedValue({ affected: 1 });

      await repository.clearAcpSession('test-uuid');

      expect(mockTypeOrmRepository.update).toHaveBeenCalledWith('test-uuid', {
        acpSessions: null,
        acpSessionContainerId: null,
      });
    });
  });
});
