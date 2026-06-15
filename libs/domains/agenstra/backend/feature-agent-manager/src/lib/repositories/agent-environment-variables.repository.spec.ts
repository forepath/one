import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AgentEnvironmentVariableEntity } from '../entities/agent-environment-variable.entity';
import { AgentEntity, ContainerType } from '../entities/agent.entity';

import { AgentEnvironmentVariablesRepository } from './agent-environment-variables.repository';

describe('AgentEnvironmentVariablesRepository', () => {
  let repository: AgentEnvironmentVariablesRepository;
  const mockAgent: AgentEntity = {
    id: 'agent-uuid-123',
    name: 'Test Agent',
    description: 'Test Description',
    hashedPassword: 'hashed-password',
    containerId: 'container-id-123',
    volumePath: '/opt/agents/test-volume-uuid',
    agentType: 'cursor',
    containerType: ContainerType.GENERIC,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const mockVariable: AgentEnvironmentVariableEntity = {
    id: 'variable-uuid-123',
    agentId: 'agent-uuid-123',
    agent: mockAgent,
    variable: 'TEST_VARIABLE',
    content: 'Test variable content',
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
        AgentEnvironmentVariablesRepository,
        {
          provide: getRepositoryToken(AgentEnvironmentVariableEntity),
          useValue: mockTypeOrmRepository,
        },
      ],
    }).compile();

    repository = module.get<AgentEnvironmentVariablesRepository>(AgentEnvironmentVariablesRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findByIdOrThrow', () => {
    it('should return variable when found', async () => {
      mockTypeOrmRepository.findOne.mockResolvedValue(mockVariable);

      const result = await repository.findByIdOrThrow('variable-uuid-123');

      expect(result).toEqual(mockVariable);
      expect(mockTypeOrmRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'variable-uuid-123' },
      });
    });

    it('should throw NotFoundException when variable not found', async () => {
      mockTypeOrmRepository.findOne.mockResolvedValue(null);

      await expect(repository.findByIdOrThrow('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findById', () => {
    it('should return variable when found', async () => {
      mockTypeOrmRepository.findOne.mockResolvedValue(mockVariable);

      const result = await repository.findById('variable-uuid-123');

      expect(result).toEqual(mockVariable);
    });

    it('should return null when variable not found', async () => {
      mockTypeOrmRepository.findOne.mockResolvedValue(null);

      const result = await repository.findById('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('findByAgentId', () => {
    it('should return array of variables for agent with pagination', async () => {
      const variables = [mockVariable];

      mockTypeOrmRepository.find.mockResolvedValue(variables);

      const result = await repository.findByAgentId('agent-uuid-123', 50, 0);

      expect(result).toEqual(variables);
      expect(mockTypeOrmRepository.find).toHaveBeenCalledWith({
        where: { agentId: 'agent-uuid-123' },
        take: 50,
        skip: 0,
        order: { createdAt: 'ASC' },
        relations: ['agent'],
      });
    });
    it('should use default pagination values', async () => {
      const variables = [mockVariable];

      mockTypeOrmRepository.find.mockResolvedValue(variables);

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

  describe('findEnvironmentVariablesByAgentId', () => {
    it('should return array of variables for agent', async () => {
      const variables = [mockVariable];

      mockTypeOrmRepository.find.mockResolvedValue(variables);

      const result = await repository.findAllByAgentId('agent-uuid-123');

      expect(result).toEqual(variables);
      expect(mockTypeOrmRepository.find).toHaveBeenCalledWith({
        where: { agentId: 'agent-uuid-123' },
      });
    });

    it('should return empty array when no variables found', async () => {
      mockTypeOrmRepository.find.mockResolvedValue([]);

      const result = await repository.findAllByAgentId('agent-uuid-123');

      expect(result).toEqual([]);
    });

    it('should return empty array when agent not found', async () => {
      mockTypeOrmRepository.find.mockResolvedValue([]);

      const result = await repository.findAllByAgentId('non-existent');

      expect(result).toEqual([]);
    });
  });

  describe('findAll', () => {
    it('should return array of variables with pagination', async () => {
      const variables = [mockVariable];

      mockTypeOrmRepository.find.mockResolvedValue(variables);

      const result = await repository.findAll(50, 0);

      expect(result).toEqual(variables);
      expect(mockTypeOrmRepository.find).toHaveBeenCalledWith({
        take: 50,
        skip: 0,
        order: { createdAt: 'ASC' },
        relations: ['agent'],
      });
    });

    it('should use default pagination values', async () => {
      const variables = [mockVariable];

      mockTypeOrmRepository.find.mockResolvedValue(variables);

      await repository.findAll();

      expect(mockTypeOrmRepository.find).toHaveBeenCalledWith({
        take: 50,
        skip: 0,
        order: { createdAt: 'ASC' },
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
    it('should create and save new variable', async () => {
      const createData = {
        agentId: 'agent-uuid-123',
        variable: 'TEST_VARIABLE',
        content: 'New variable content',
      };
      const createdVariable = { ...mockVariable, ...createData };

      mockTypeOrmRepository.create.mockReturnValue(createdVariable);
      mockTypeOrmRepository.save.mockResolvedValue(createdVariable);

      const result = await repository.create(createData);

      expect(result).toEqual(createdVariable);
      expect(mockTypeOrmRepository.create).toHaveBeenCalledWith(createData);
      expect(mockTypeOrmRepository.save).toHaveBeenCalledWith(createdVariable);
    });
  });

  describe('update', () => {
    it('should update existing variable', async () => {
      const updateData = { variable: 'UPDATED_VARIABLE', content: 'Updated variable content' };
      const updatedVariable = { ...mockVariable, ...updateData };

      mockTypeOrmRepository.findOne.mockResolvedValue(mockVariable);
      mockTypeOrmRepository.save.mockResolvedValue(updatedVariable);

      const result = await repository.update('test-uuid', updateData);

      expect(result.variable).toBe('UPDATED_VARIABLE');
      expect(result.content).toBe('Updated variable content');
      expect(result.updatedAt).toBeInstanceOf(Date);
      expect(mockTypeOrmRepository.save).toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('should delete variable', async () => {
      mockTypeOrmRepository.findOne.mockResolvedValue(mockVariable);
      mockTypeOrmRepository.remove.mockResolvedValue(mockVariable);

      await repository.delete('variable-uuid-123');

      expect(mockTypeOrmRepository.remove).toHaveBeenCalledWith(mockVariable);
    });
  });

  describe('deleteByAgentId', () => {
    it('should delete all variables for agent', async () => {
      mockTypeOrmRepository.delete.mockResolvedValue({ affected: 3 });

      const result = await repository.deleteByAgentId('agent-uuid-123');

      expect(result).toBe(3);
      expect(mockTypeOrmRepository.delete).toHaveBeenCalledWith({
        agentId: 'agent-uuid-123',
      });
    });

    it('should return 0 when no variables deleted', async () => {
      mockTypeOrmRepository.delete.mockResolvedValue({ affected: 0 });

      const result = await repository.deleteByAgentId('agent-uuid-123');

      expect(result).toBe(0);
    });
  });
});
