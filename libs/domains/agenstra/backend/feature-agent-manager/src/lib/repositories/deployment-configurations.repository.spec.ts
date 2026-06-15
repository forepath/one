import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { DeploymentConfigurationEntity } from '../entities/deployment-configuration.entity';

import { DeploymentConfigurationsRepository } from './deployment-configurations.repository';

describe('DeploymentConfigurationsRepository', () => {
  let repository: DeploymentConfigurationsRepository;
  const mockConfiguration: DeploymentConfigurationEntity = {
    id: 'config-uuid',
    agentId: 'agent-uuid',
    providerType: 'github',
    repositoryId: 'owner/repo',
    defaultBranch: 'main',
    workflowId: '12345678',
    providerToken: 'encrypted-token',
    providerBaseUrl: undefined,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    agent: {} as any,
  };
  const mockTypeOrmRepository = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeploymentConfigurationsRepository,
        {
          provide: getRepositoryToken(DeploymentConfigurationEntity),
          useValue: mockTypeOrmRepository,
        },
      ],
    }).compile();

    repository = module.get<DeploymentConfigurationsRepository>(DeploymentConfigurationsRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findByAgentId', () => {
    it('should return configuration when found', async () => {
      mockTypeOrmRepository.findOne.mockResolvedValue(mockConfiguration);

      const result = await repository.findByAgentId('agent-uuid');

      expect(result).toEqual(mockConfiguration);
      expect(mockTypeOrmRepository.findOne).toHaveBeenCalledWith({
        where: { agentId: 'agent-uuid' },
      });
    });

    it('should return null when not found', async () => {
      mockTypeOrmRepository.findOne.mockResolvedValue(null);

      const result = await repository.findByAgentId('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('findByAgentIdOrThrow', () => {
    it('should return configuration when found', async () => {
      mockTypeOrmRepository.findOne.mockResolvedValue(mockConfiguration);

      const result = await repository.findByAgentIdOrThrow('agent-uuid');

      expect(result).toEqual(mockConfiguration);
    });

    it('should throw NotFoundException when not found', async () => {
      mockTypeOrmRepository.findOne.mockResolvedValue(null);

      await expect(repository.findByAgentIdOrThrow('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByIdOrThrow', () => {
    it('should return configuration when found', async () => {
      mockTypeOrmRepository.findOne.mockResolvedValue(mockConfiguration);

      const result = await repository.findByIdOrThrow('config-uuid');

      expect(result).toEqual(mockConfiguration);
    });

    it('should throw NotFoundException when not found', async () => {
      mockTypeOrmRepository.findOne.mockResolvedValue(null);

      await expect(repository.findByIdOrThrow('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('should create and save new configuration', async () => {
      const createData = {
        agentId: 'agent-uuid',
        providerType: 'github',
        repositoryId: 'owner/repo',
        providerToken: 'token',
      };
      const createdConfig = { ...mockConfiguration, ...createData };

      mockTypeOrmRepository.create.mockReturnValue(createdConfig);
      mockTypeOrmRepository.save.mockResolvedValue(createdConfig);

      const result = await repository.create(createData);

      expect(result).toEqual(createdConfig);
      expect(mockTypeOrmRepository.create).toHaveBeenCalledWith(createData);
      expect(mockTypeOrmRepository.save).toHaveBeenCalledWith(createdConfig);
    });
  });

  describe('update', () => {
    it('should update existing configuration', async () => {
      const updateData = { repositoryId: 'owner/newrepo' };
      const updatedConfig = { ...mockConfiguration, ...updateData };

      mockTypeOrmRepository.findOne.mockResolvedValue(mockConfiguration);
      mockTypeOrmRepository.save.mockResolvedValue(updatedConfig);

      const result = await repository.update('config-uuid', updateData);

      expect(result.repositoryId).toBe('owner/newrepo');
      expect(mockTypeOrmRepository.save).toHaveBeenCalled();
    });
  });

  describe('upsertByAgentId', () => {
    it('should create new configuration when not exists', async () => {
      const createData = {
        agentId: 'agent-uuid',
        providerType: 'github',
        repositoryId: 'owner/repo',
        providerToken: 'token',
      };
      const createdConfig = { ...mockConfiguration, ...createData };

      mockTypeOrmRepository.findOne.mockResolvedValue(null);
      mockTypeOrmRepository.create.mockReturnValue(createdConfig);
      mockTypeOrmRepository.save.mockResolvedValue(createdConfig);

      const result = await repository.upsertByAgentId('agent-uuid', createData);

      expect(result).toEqual(createdConfig);
      expect(mockTypeOrmRepository.create).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'agent-uuid' }));
    });

    it('should update existing configuration when exists', async () => {
      const updateData = { repositoryId: 'owner/newrepo' };
      const updatedConfig = { ...mockConfiguration, ...updateData };

      mockTypeOrmRepository.findOne.mockResolvedValue(mockConfiguration);
      mockTypeOrmRepository.save.mockResolvedValue(updatedConfig);

      const result = await repository.upsertByAgentId('agent-uuid', updateData);

      expect(result.repositoryId).toBe('owner/newrepo');
      expect(mockTypeOrmRepository.save).toHaveBeenCalled();
    });
  });

  describe('deleteByAgentId', () => {
    it('should delete configuration', async () => {
      mockTypeOrmRepository.findOne.mockResolvedValue(mockConfiguration);
      mockTypeOrmRepository.remove.mockResolvedValue(mockConfiguration);

      await repository.deleteByAgentId('agent-uuid');

      expect(mockTypeOrmRepository.remove).toHaveBeenCalledWith(mockConfiguration);
    });

    it('should throw NotFoundException when not found', async () => {
      mockTypeOrmRepository.findOne.mockResolvedValue(null);

      await expect(repository.deleteByAgentId('non-existent')).rejects.toThrow(NotFoundException);
    });
  });
});
