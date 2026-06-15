import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { AgentEnvironmentVariableEntity } from '../entities/agent-environment-variable.entity';
import { AgentEntity } from '../entities/agent.entity';
import { AgentProviderFactory } from '../providers/agent-provider.factory';
import { AgentEnvironmentVariablesRepository } from '../repositories/agent-environment-variables.repository';
import { AgentMessagesRepository } from '../repositories/agent-messages.repository';
import { AgentsRepository } from '../repositories/agents.repository';

import { AgentEnvironmentVariablesService } from './agent-environment-variables.service';
import { AgentMessagesService } from './agent-messages.service';
import { AgentSessionHydrationService } from './agent-session-hydration.service';
import { DockerService } from './docker.service';

describe('AgentEnvironmentVariablesService', () => {
  let service: AgentEnvironmentVariablesService;
  const mockAgent: AgentEntity = {
    id: 'agent-uuid-123',
    name: 'Test Agent',
    description: 'Test Description',
    hashedPassword: 'hashed-password',
    containerId: 'container-id-123',
    volumePath: '/opt/agents/test-volume-uuid',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as AgentEntity;
  const mockEnvironmentVariable: AgentEnvironmentVariableEntity = {
    id: 'env-var-uuid-123',
    agentId: 'agent-uuid-123',
    agent: mockAgent as unknown as AgentEnvironmentVariableEntity['agent'],
    variable: 'API_KEY',
    content: 'secret-api-key-value',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const mockRepository = {
    create: jest.fn(),
    update: jest.fn(),
    findByAgentId: jest.fn(),
    findAllByAgentId: jest.fn(),
    countByAgentId: jest.fn(),
    deleteByAgentId: jest.fn(),
    delete: jest.fn(),
    findByIdOrThrow: jest.fn(),
    findById: jest.fn(),
  };
  const mockAgentsRepository = {
    findByIdOrThrow: jest.fn(),
    findAllWithContainers: jest.fn(),
    update: jest.fn(),
  };
  const mockAgentMessagesRepository = {
    deleteByAgentId: jest.fn(),
  };
  const mockAgentMessagesService = {
    countMessages: jest.fn(),
    getChatHistory: jest.fn(),
  };
  const mockAgentProvider = {
    sendMessage: jest.fn(),
    toParseableStrings: jest.fn(),
    toUnifiedResponse: jest.fn(),
  };
  const mockAgentProviderFactory = {
    getProvider: jest.fn().mockReturnValue(mockAgentProvider),
  };
  const mockAgentSessionHydrationService = {
    storePendingSummary: jest.fn(),
  };
  const mockDockerService = {
    updateContainer: jest.fn(),
    getContainerEnvironmentMap: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentEnvironmentVariablesService,
        {
          provide: AgentEnvironmentVariablesRepository,
          useValue: mockRepository,
        },
        {
          provide: AgentsRepository,
          useValue: mockAgentsRepository,
        },
        {
          provide: AgentMessagesRepository,
          useValue: mockAgentMessagesRepository,
        },
        {
          provide: AgentMessagesService,
          useValue: mockAgentMessagesService,
        },
        {
          provide: AgentProviderFactory,
          useValue: mockAgentProviderFactory,
        },
        {
          provide: AgentSessionHydrationService,
          useValue: mockAgentSessionHydrationService,
        },
        {
          provide: DockerService,
          useValue: mockDockerService,
        },
      ],
    }).compile();

    service = module.get<AgentEnvironmentVariablesService>(AgentEnvironmentVariablesService);
    mockAgentMessagesService.countMessages.mockResolvedValue(0);
    mockAgentMessagesService.getChatHistory.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createEnvironmentVariable', () => {
    it('should create and persist an environment variable and reconcile with container', async () => {
      const agentId = 'agent-uuid-123';
      const variable = 'API_KEY';
      const content = 'secret-api-key-value';
      const expectedVariable = {
        ...mockEnvironmentVariable,
        agentId,
        variable,
        content,
      };
      const newContainerId = 'new-container-id-456';

      mockRepository.create.mockResolvedValue(expectedVariable);
      mockAgentsRepository.findByIdOrThrow.mockResolvedValue(mockAgent);
      mockRepository.findAllByAgentId.mockResolvedValue([expectedVariable]);
      mockDockerService.updateContainer.mockResolvedValue(newContainerId);
      mockAgentsRepository.update.mockResolvedValue({ ...mockAgent, containerId: newContainerId });
      mockAgentMessagesRepository.deleteByAgentId.mockResolvedValue(undefined);

      const result = await service.createEnvironmentVariable(agentId, variable, content);

      expect(result).toEqual(expectedVariable);
      expect(mockRepository.create).toHaveBeenCalledWith({
        agentId,
        variable,
        content,
      });
      expect(mockAgentsRepository.findByIdOrThrow).toHaveBeenCalledWith(agentId);
      expect(mockRepository.findAllByAgentId).toHaveBeenCalledWith(agentId);
      expect(mockDockerService.updateContainer).toHaveBeenCalledWith('container-id-123', {
        env: { API_KEY: 'secret-api-key-value' },
      });
      expect(mockAgentsRepository.update).toHaveBeenCalledWith(agentId, { containerId: newContainerId });
      expect(mockAgentSessionHydrationService.storePendingSummary).toHaveBeenCalledWith(agentId, expect.any(String));
    });

    it('should handle empty content', async () => {
      const agentId = 'agent-uuid-123';
      const variable = 'EMPTY_VAR';
      const content = '';
      const expectedVariable = {
        ...mockEnvironmentVariable,
        agentId,
        variable,
        content,
      };
      const newContainerId = 'new-container-id-456';

      mockRepository.create.mockResolvedValue(expectedVariable);
      mockAgentsRepository.findByIdOrThrow.mockResolvedValue(mockAgent);
      mockRepository.findAllByAgentId.mockResolvedValue([expectedVariable]);
      mockDockerService.updateContainer.mockResolvedValue(newContainerId);
      mockAgentsRepository.update.mockResolvedValue({ ...mockAgent, containerId: newContainerId });
      mockAgentMessagesRepository.deleteByAgentId.mockResolvedValue(undefined);

      const result = await service.createEnvironmentVariable(agentId, variable, content);

      expect(result).toEqual(expectedVariable);
      expect(mockRepository.create).toHaveBeenCalledWith({
        agentId,
        variable,
        content,
      });
      expect(mockDockerService.updateContainer).toHaveBeenCalledWith('container-id-123', {
        env: { EMPTY_VAR: '' },
      });
      expect(mockAgentsRepository.update).toHaveBeenCalledWith(agentId, { containerId: newContainerId });
      expect(mockAgentSessionHydrationService.storePendingSummary).toHaveBeenCalledWith(agentId, expect.any(String));
    });
  });

  describe('updateEnvironmentVariable', () => {
    it('should update an environment variable and reconcile with container', async () => {
      const id = 'env-var-uuid-123';
      const variable = 'UPDATED_API_KEY';
      const content = 'updated-secret-value';
      const expectedVariable = {
        ...mockEnvironmentVariable,
        id,
        variable,
        content,
        agentId: 'agent-uuid-123',
      };
      const newContainerId = 'new-container-id-456';

      mockRepository.update.mockResolvedValue(expectedVariable);
      mockAgentsRepository.findByIdOrThrow.mockResolvedValue(mockAgent);
      mockRepository.findAllByAgentId.mockResolvedValue([expectedVariable]);
      mockDockerService.updateContainer.mockResolvedValue(newContainerId);
      mockAgentsRepository.update.mockResolvedValue({ ...mockAgent, containerId: newContainerId });
      mockAgentMessagesRepository.deleteByAgentId.mockResolvedValue(undefined);

      const result = await service.updateEnvironmentVariable(id, variable, content);

      expect(result).toEqual(expectedVariable);
      expect(mockRepository.update).toHaveBeenCalledWith(id, { variable, content });
      expect(mockAgentsRepository.findByIdOrThrow).toHaveBeenCalledWith('agent-uuid-123');
      expect(mockRepository.findAllByAgentId).toHaveBeenCalledWith('agent-uuid-123');
      expect(mockDockerService.updateContainer).toHaveBeenCalledWith('container-id-123', {
        env: { UPDATED_API_KEY: 'updated-secret-value' },
      });
      expect(mockAgentsRepository.update).toHaveBeenCalledWith('agent-uuid-123', { containerId: newContainerId });
      expect(mockAgentSessionHydrationService.storePendingSummary).toHaveBeenCalledWith(
        'agent-uuid-123',
        expect.any(String),
      );
    });

    it('should update only the content', async () => {
      const id = 'env-var-uuid-123';
      const variable = 'API_KEY';
      const content = 'new-secret-value';
      const expectedVariable = {
        ...mockEnvironmentVariable,
        id,
        variable,
        content,
        agentId: 'agent-uuid-123',
      };
      const newContainerId = 'new-container-id-456';

      mockRepository.update.mockResolvedValue(expectedVariable);
      mockAgentsRepository.findByIdOrThrow.mockResolvedValue(mockAgent);
      mockRepository.findAllByAgentId.mockResolvedValue([expectedVariable]);
      mockDockerService.updateContainer.mockResolvedValue(newContainerId);
      mockAgentsRepository.update.mockResolvedValue({ ...mockAgent, containerId: newContainerId });
      mockAgentMessagesRepository.deleteByAgentId.mockResolvedValue(undefined);

      const result = await service.updateEnvironmentVariable(id, variable, content);

      expect(result).toEqual(expectedVariable);
      expect(mockRepository.update).toHaveBeenCalledWith(id, { variable, content });
      expect(mockDockerService.updateContainer).toHaveBeenCalledWith('container-id-123', {
        env: { API_KEY: 'new-secret-value' },
      });
      expect(mockAgentsRepository.update).toHaveBeenCalledWith('agent-uuid-123', { containerId: newContainerId });
      expect(mockAgentSessionHydrationService.storePendingSummary).toHaveBeenCalledWith(
        'agent-uuid-123',
        expect.any(String),
      );
    });

    it('should update only the variable name', async () => {
      const id = 'env-var-uuid-123';
      const variable = 'NEW_VARIABLE_NAME';
      const content = 'secret-api-key-value';
      const expectedVariable = {
        ...mockEnvironmentVariable,
        id,
        variable,
        content,
        agentId: 'agent-uuid-123',
      };
      const newContainerId = 'new-container-id-456';

      mockRepository.update.mockResolvedValue(expectedVariable);
      mockAgentsRepository.findByIdOrThrow.mockResolvedValue(mockAgent);
      mockRepository.findAllByAgentId.mockResolvedValue([expectedVariable]);
      mockDockerService.updateContainer.mockResolvedValue(newContainerId);
      mockAgentsRepository.update.mockResolvedValue({ ...mockAgent, containerId: newContainerId });
      mockAgentMessagesRepository.deleteByAgentId.mockResolvedValue(undefined);

      const result = await service.updateEnvironmentVariable(id, variable, content);

      expect(result).toEqual(expectedVariable);
      expect(mockRepository.update).toHaveBeenCalledWith(id, { variable, content });
      expect(mockDockerService.updateContainer).toHaveBeenCalledWith('container-id-123', {
        env: { NEW_VARIABLE_NAME: 'secret-api-key-value' },
      });
      expect(mockAgentsRepository.update).toHaveBeenCalledWith('agent-uuid-123', { containerId: newContainerId });
      expect(mockAgentSessionHydrationService.storePendingSummary).toHaveBeenCalledWith(
        'agent-uuid-123',
        expect.any(String),
      );
    });
  });

  describe('deleteEnvironmentVariable', () => {
    it('should delete an environment variable and reconcile with container', async () => {
      const id = 'env-var-uuid-123';
      const variableToDelete = {
        ...mockEnvironmentVariable,
        id,
        agentId: 'agent-uuid-123',
      };
      const newContainerId = 'new-container-id-456';

      mockRepository.findByIdOrThrow.mockResolvedValue(variableToDelete);
      mockRepository.delete.mockResolvedValue(undefined);
      mockAgentsRepository.findByIdOrThrow.mockResolvedValue(mockAgent);
      mockRepository.findAllByAgentId.mockResolvedValue([]);
      mockDockerService.updateContainer.mockResolvedValue(newContainerId);
      mockAgentsRepository.update.mockResolvedValue({ ...mockAgent, containerId: newContainerId });
      mockAgentMessagesRepository.deleteByAgentId.mockResolvedValue(undefined);

      await service.deleteEnvironmentVariable(id);

      expect(mockRepository.findByIdOrThrow).toHaveBeenCalledWith(id);
      expect(mockRepository.delete).toHaveBeenCalledWith(id);
      expect(mockAgentsRepository.findByIdOrThrow).toHaveBeenCalledWith('agent-uuid-123');
      expect(mockRepository.findAllByAgentId).toHaveBeenCalledWith('agent-uuid-123');
      expect(mockDockerService.updateContainer).toHaveBeenCalledWith('container-id-123', { env: {} });
      expect(mockAgentsRepository.update).toHaveBeenCalledWith('agent-uuid-123', { containerId: newContainerId });
      expect(mockAgentSessionHydrationService.storePendingSummary).toHaveBeenCalledWith(
        'agent-uuid-123',
        expect.any(String),
      );
    });

    it('should throw NotFoundException when environment variable not found', async () => {
      const id = 'env-var-uuid-123';

      mockRepository.findByIdOrThrow.mockRejectedValue(new NotFoundException('Environment variable not found'));

      await expect(service.deleteEnvironmentVariable(id)).rejects.toThrow(NotFoundException);
      expect(mockRepository.findByIdOrThrow).toHaveBeenCalledWith(id);
      expect(mockRepository.delete).not.toHaveBeenCalled();
    });
  });

  describe('getEnvironmentVariables', () => {
    it('should return environment variables for an agent', async () => {
      const agentId = 'agent-uuid-123';
      const variables = [mockEnvironmentVariable];

      mockRepository.findByAgentId.mockResolvedValue(variables);

      const result = await service.getEnvironmentVariables(agentId);

      expect(result).toEqual(variables);
      expect(mockRepository.findByAgentId).toHaveBeenCalledWith(agentId, 50, 0);
    });

    it('should use custom pagination parameters', async () => {
      const agentId = 'agent-uuid-123';
      const variables = [mockEnvironmentVariable];

      mockRepository.findByAgentId.mockResolvedValue(variables);

      await service.getEnvironmentVariables(agentId, 100, 10);

      expect(mockRepository.findByAgentId).toHaveBeenCalledWith(agentId, 100, 10);
    });

    it('should return empty array when no environment variables exist', async () => {
      const agentId = 'agent-uuid-123';

      mockRepository.findByAgentId.mockResolvedValue([]);

      const result = await service.getEnvironmentVariables(agentId);

      expect(result).toEqual([]);
      expect(mockRepository.findByAgentId).toHaveBeenCalledWith(agentId, 50, 0);
    });
  });

  describe('countEnvironmentVariables', () => {
    it('should return count of environment variables for an agent', async () => {
      const agentId = 'agent-uuid-123';

      mockRepository.countByAgentId.mockResolvedValue(5);

      const result = await service.countEnvironmentVariables(agentId);

      expect(result).toBe(5);
      expect(mockRepository.countByAgentId).toHaveBeenCalledWith(agentId);
    });

    it('should return 0 when no environment variables exist', async () => {
      const agentId = 'agent-uuid-123';

      mockRepository.countByAgentId.mockResolvedValue(0);

      const result = await service.countEnvironmentVariables(agentId);

      expect(result).toBe(0);
      expect(mockRepository.countByAgentId).toHaveBeenCalledWith(agentId);
    });
  });

  describe('deleteAllEnvironmentVariables', () => {
    it('should delete all environment variables for an agent and reconcile with container', async () => {
      const agentId = 'agent-uuid-123';
      const newContainerId = 'new-container-id-456';

      mockRepository.deleteByAgentId.mockResolvedValue(3);
      mockAgentsRepository.findByIdOrThrow.mockResolvedValue(mockAgent);
      mockRepository.findAllByAgentId.mockResolvedValue([]);
      mockDockerService.updateContainer.mockResolvedValue(newContainerId);
      mockAgentsRepository.update.mockResolvedValue({ ...mockAgent, containerId: newContainerId });
      mockAgentMessagesRepository.deleteByAgentId.mockResolvedValue(undefined);

      const result = await service.deleteAllEnvironmentVariables(agentId);

      expect(result).toBe(3);
      expect(mockRepository.deleteByAgentId).toHaveBeenCalledWith(agentId);
      expect(mockAgentsRepository.findByIdOrThrow).toHaveBeenCalledWith(agentId);
      expect(mockRepository.findAllByAgentId).toHaveBeenCalledWith(agentId);
      expect(mockDockerService.updateContainer).toHaveBeenCalledWith('container-id-123', { env: {} });
      expect(mockAgentsRepository.update).toHaveBeenCalledWith(agentId, { containerId: newContainerId });
      expect(mockAgentSessionHydrationService.storePendingSummary).toHaveBeenCalledWith(agentId, expect.any(String));
    });

    it('should return 0 when no environment variables are deleted', async () => {
      const agentId = 'agent-uuid-123';
      const newContainerId = 'new-container-id-456';

      mockRepository.deleteByAgentId.mockResolvedValue(0);
      mockAgentsRepository.findByIdOrThrow.mockResolvedValue(mockAgent);
      mockRepository.findAllByAgentId.mockResolvedValue([]);
      mockDockerService.updateContainer.mockResolvedValue(newContainerId);
      mockAgentsRepository.update.mockResolvedValue({ ...mockAgent, containerId: newContainerId });
      mockAgentMessagesRepository.deleteByAgentId.mockResolvedValue(undefined);

      const result = await service.deleteAllEnvironmentVariables(agentId);

      expect(result).toBe(0);
      expect(mockRepository.deleteByAgentId).toHaveBeenCalledWith(agentId);
      expect(mockDockerService.updateContainer).toHaveBeenCalledWith('container-id-123', { env: {} });
      expect(mockAgentsRepository.update).toHaveBeenCalledWith(agentId, { containerId: newContainerId });
      expect(mockAgentSessionHydrationService.storePendingSummary).toHaveBeenCalledWith(agentId, expect.any(String));
    });
  });

  describe('reconcileEnvironmentVariables', () => {
    it('should update container with all environment variables', async () => {
      const agentId = 'agent-uuid-123';
      const envVars = [
        { ...mockEnvironmentVariable, variable: 'API_KEY', content: 'secret-key' },
        { ...mockEnvironmentVariable, id: 'env-var-2', variable: 'DB_URL', content: 'postgres://...' },
      ];
      const newContainerId = 'new-container-id-456';

      mockAgentsRepository.findByIdOrThrow.mockResolvedValue(mockAgent);
      mockRepository.findAllByAgentId.mockResolvedValue(envVars);
      mockDockerService.updateContainer.mockResolvedValue(newContainerId);
      mockAgentsRepository.update.mockResolvedValue({ ...mockAgent, containerId: newContainerId });
      mockAgentMessagesRepository.deleteByAgentId.mockResolvedValue(undefined);

      await service.reconcileEnvironmentVariables(agentId);

      expect(mockAgentsRepository.findByIdOrThrow).toHaveBeenCalledWith(agentId);
      expect(mockRepository.findAllByAgentId).toHaveBeenCalledWith(agentId);
      expect(mockDockerService.updateContainer).toHaveBeenCalledWith('container-id-123', {
        env: {
          API_KEY: 'secret-key',
          DB_URL: 'postgres://...',
        },
      });
      expect(mockAgentsRepository.update).toHaveBeenCalledWith(agentId, { containerId: newContainerId });
      expect(mockAgentSessionHydrationService.storePendingSummary).toHaveBeenCalledWith(agentId, expect.any(String));
    });

    it('should handle agent with no container ID', async () => {
      const agentId = 'agent-uuid-123';
      const agentWithoutContainer = {
        ...mockAgent,
        containerId: undefined,
      };

      mockAgentsRepository.findByIdOrThrow.mockResolvedValue(agentWithoutContainer);

      await service.reconcileEnvironmentVariables(agentId);

      expect(mockAgentsRepository.findByIdOrThrow).toHaveBeenCalledWith(agentId);
      expect(mockRepository.findAllByAgentId).not.toHaveBeenCalled();
      expect(mockDockerService.updateContainer).not.toHaveBeenCalled();
      expect(mockAgentSessionHydrationService.storePendingSummary).not.toHaveBeenCalled();
    });

    it('should handle empty environment variables', async () => {
      const agentId = 'agent-uuid-123';
      const newContainerId = 'new-container-id-456';

      mockAgentsRepository.findByIdOrThrow.mockResolvedValue(mockAgent);
      mockRepository.findAllByAgentId.mockResolvedValue([]);
      mockDockerService.updateContainer.mockResolvedValue(newContainerId);
      mockAgentsRepository.update.mockResolvedValue({ ...mockAgent, containerId: newContainerId });
      mockAgentMessagesRepository.deleteByAgentId.mockResolvedValue(undefined);

      await service.reconcileEnvironmentVariables(agentId);

      expect(mockDockerService.updateContainer).toHaveBeenCalledWith('container-id-123', { env: {} });
      expect(mockAgentsRepository.update).toHaveBeenCalledWith(agentId, { containerId: newContainerId });
      expect(mockAgentSessionHydrationService.storePendingSummary).toHaveBeenCalledWith(agentId, expect.any(String));
    });

    it('should throw NotFoundException when agent not found', async () => {
      const agentId = 'agent-uuid-123';

      mockAgentsRepository.findByIdOrThrow.mockRejectedValue(new NotFoundException('Agent not found'));

      await expect(service.reconcileEnvironmentVariables(agentId)).rejects.toThrow(NotFoundException);
      expect(mockRepository.findAllByAgentId).not.toHaveBeenCalled();
      expect(mockDockerService.updateContainer).not.toHaveBeenCalled();
      expect(mockAgentSessionHydrationService.storePendingSummary).not.toHaveBeenCalled();
    });

    it('should handle environment variables with undefined content', async () => {
      const agentId = 'agent-uuid-123';
      const envVars = [{ ...mockEnvironmentVariable, variable: 'API_KEY', content: undefined }];
      const newContainerId = 'new-container-id-456';

      mockAgentsRepository.findByIdOrThrow.mockResolvedValue(mockAgent);
      mockRepository.findAllByAgentId.mockResolvedValue(envVars);
      mockDockerService.updateContainer.mockResolvedValue(newContainerId);
      mockAgentsRepository.update.mockResolvedValue({ ...mockAgent, containerId: newContainerId });
      mockAgentMessagesRepository.deleteByAgentId.mockResolvedValue(undefined);

      await service.reconcileEnvironmentVariables(agentId);

      expect(mockDockerService.updateContainer).toHaveBeenCalledWith('container-id-123', {
        env: { API_KEY: '' },
      });
      expect(mockAgentsRepository.update).toHaveBeenCalledWith(agentId, { containerId: newContainerId });
      expect(mockAgentSessionHydrationService.storePendingSummary).toHaveBeenCalledWith(agentId, expect.any(String));
    });
  });

  describe('reconcileWorkspaceConfigurationOverrides', () => {
    it('recreates containers only for agents where changed keys are present', async () => {
      const secondAgent: AgentEntity = {
        ...mockAgent,
        id: 'agent-uuid-456',
        containerId: 'container-id-456',
      } as AgentEntity;

      mockAgentsRepository.findAllWithContainers.mockResolvedValue([mockAgent, secondAgent]);
      mockDockerService.getContainerEnvironmentMap
        .mockResolvedValueOnce({ GIT_TOKEN: 'old-token', OTHER: 'x' })
        .mockResolvedValueOnce({ OTHER: 'x' });
      mockDockerService.updateContainer.mockResolvedValue('new-container-id-123');
      mockAgentsRepository.update.mockResolvedValue({ ...mockAgent, containerId: 'new-container-id-123' });

      await service.reconcileWorkspaceConfigurationOverrides({ GIT_TOKEN: 'new-token' });

      expect(mockDockerService.updateContainer).toHaveBeenCalledTimes(1);
      expect(mockDockerService.updateContainer).toHaveBeenCalledWith('container-id-123', {
        env: { GIT_TOKEN: 'new-token' },
      });
      expect(mockAgentsRepository.update).toHaveBeenCalledWith('agent-uuid-123', {
        containerId: 'new-container-id-123',
      });
    });
  });
});
