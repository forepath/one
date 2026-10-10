import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import type { EnvironmentProgressDto } from '../dto/environment-progress.dto';
import { AgentEnvironmentVariableEntity } from '../entities/agent-environment-variable.entity';
import { AgentEntity } from '../entities/agent.entity';
import { AgentProviderFactory } from '../providers/agent-provider.factory';
import { AgentEnvironmentVariablesRepository } from '../repositories/agent-environment-variables.repository';
import { AgentMessagesRepository } from '../repositories/agent-messages.repository';
import { AgentsRepository } from '../repositories/agents.repository';

import { AgentEnvironmentVariablesService } from './agent-environment-variables.service';
import { AgentMessagesService } from './agent-messages.service';
import { AgentRuntimeRefreshService } from './agent-runtime-refresh.service';
import { AgentSessionHydrationService } from './agent-session-hydration.service';
import { DockerService } from './docker.service';
import { EnvironmentProgressService } from './environment-progress.service';

describe('AgentEnvironmentVariablesService', () => {
  let service: AgentEnvironmentVariablesService;
  let progressService: EnvironmentProgressService;
  let emittedProgress: EnvironmentProgressDto[];
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
    getEnvironmentApplyStrategy: jest.fn(),
  };
  const mockAgentRuntimeRefresh = {
    invalidateConnections: jest.fn(),
    waitForHealthy: jest.fn(),
    reattachWatchers: jest.fn(),
    restoreGitCredentials: jest.fn(),
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
        {
          provide: AgentRuntimeRefreshService,
          useValue: mockAgentRuntimeRefresh,
        },
        EnvironmentProgressService,
      ],
    }).compile();

    service = module.get<AgentEnvironmentVariablesService>(AgentEnvironmentVariablesService);
    progressService = module.get(EnvironmentProgressService);
    emittedProgress = [];
    progressService.registerBroadcaster((progress) => emittedProgress.push(progress));
    mockAgentMessagesService.countMessages.mockResolvedValue(0);
    mockAgentMessagesService.getChatHistory.mockResolvedValue([]);
    mockDockerService.getEnvironmentApplyStrategy.mockResolvedValue('recreate');
    mockDockerService.getContainerEnvironmentMap.mockResolvedValue({});
    mockRepository.findByIdOrThrow.mockResolvedValue(mockEnvironmentVariable);
    mockAgentRuntimeRefresh.waitForHealthy.mockResolvedValue(true);
    mockAgentRuntimeRefresh.reattachWatchers.mockResolvedValue(undefined);
    mockAgentRuntimeRefresh.restoreGitCredentials.mockResolvedValue(true);
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

    it('queues update progress for every affected agent up front and completes each', async () => {
      const secondAgent: AgentEntity = {
        ...mockAgent,
        id: 'agent-uuid-456',
        name: 'Second Agent',
        containerId: 'container-id-456',
      } as AgentEntity;

      mockAgentsRepository.findAllWithContainers.mockResolvedValue([mockAgent, secondAgent]);
      mockDockerService.getContainerEnvironmentMap.mockResolvedValue({ GIT_TOKEN: 'old-token' });
      mockDockerService.updateContainer.mockResolvedValue('new-container');
      mockAgentsRepository.update.mockResolvedValue(mockAgent);

      await service.reconcileWorkspaceConfigurationOverrides({ GIT_TOKEN: 'new-token' });

      expect(emittedProgress.slice(0, 2)).toEqual([
        expect.objectContaining({ agentId: 'agent-uuid-123', operation: 'update', step: 'queued', progress: 0 }),
        expect.objectContaining({ agentId: 'agent-uuid-456', operation: 'update', step: 'queued', progress: 0 }),
      ]);

      const completed = emittedProgress.filter((e) => e.status === 'completed').map((e) => e.agentId);

      expect(completed).toEqual(['agent-uuid-123', 'agent-uuid-456']);
      expect(progressService.list()).toEqual([]);
    });

    it('fails the current and remaining queued operations when one agent fails', async () => {
      const secondAgent: AgentEntity = {
        ...mockAgent,
        id: 'agent-uuid-456',
        containerId: 'container-id-456',
      } as AgentEntity;

      mockAgentsRepository.findAllWithContainers.mockResolvedValue([mockAgent, secondAgent]);
      mockDockerService.getContainerEnvironmentMap.mockResolvedValue({ GIT_TOKEN: 'old-token' });
      mockDockerService.updateContainer.mockRejectedValueOnce(new Error('docker down'));

      await expect(service.reconcileWorkspaceConfigurationOverrides({ GIT_TOKEN: 'new-token' })).rejects.toThrow(
        'docker down',
      );

      const failed = emittedProgress.filter((e) => e.status === 'failed');

      expect(failed).toEqual([
        expect.objectContaining({ agentId: 'agent-uuid-123', error: 'docker down' }),
        expect.objectContaining({ agentId: 'agent-uuid-456' }),
      ]);
      expect(mockDockerService.updateContainer).toHaveBeenCalledTimes(1);
      expect(progressService.list()).toEqual([]);
    });

    it('does not report progress when no agent is affected', async () => {
      mockAgentsRepository.findAllWithContainers.mockResolvedValue([mockAgent]);
      mockDockerService.getContainerEnvironmentMap.mockResolvedValue({ OTHER: 'x' });

      await service.reconcileWorkspaceConfigurationOverrides({ GIT_TOKEN: 'new-token' });

      expect(emittedProgress).toEqual([]);
    });
  });

  describe('reconcileEnvironmentVariables progress', () => {
    it('reports update steps and completes', async () => {
      mockAgentsRepository.findByIdOrThrow.mockResolvedValue(mockAgent);
      mockRepository.findAllByAgentId.mockResolvedValue([mockEnvironmentVariable]);
      mockDockerService.updateContainer.mockResolvedValue('new-container');
      mockAgentsRepository.update.mockResolvedValue(mockAgent);

      await service.reconcileEnvironmentVariables(mockAgent.id);

      expect([...new Set(emittedProgress.map((e) => e.step))]).toEqual([
        'queued',
        'summarizingContext',
        'recreatingContainer',
        'restoringGitCredentials',
        'finalizing',
      ]);
      // The recreated container lost the credential files of its writable layer.
      expect(mockAgentRuntimeRefresh.restoreGitCredentials).toHaveBeenCalledWith(mockAgent.id, 'new-container');
      expect(emittedProgress.at(-1)).toEqual(
        expect.objectContaining({ agentId: mockAgent.id, agentName: mockAgent.name, status: 'completed' }),
      );
    });

    it('reports failure when container recreation fails', async () => {
      mockAgentsRepository.findByIdOrThrow.mockResolvedValue(mockAgent);
      mockRepository.findAllByAgentId.mockResolvedValue([]);
      mockDockerService.updateContainer.mockRejectedValueOnce(new Error('recreate failed'));

      await expect(service.reconcileEnvironmentVariables(mockAgent.id)).rejects.toThrow('recreate failed');

      expect(emittedProgress.at(-1)).toEqual(expect.objectContaining({ status: 'failed', error: 'recreate failed' }));
    });
  });

  describe('reconcileEnvironmentVariables with the mounted environment (restart strategy)', () => {
    beforeEach(() => {
      mockDockerService.getEnvironmentApplyStrategy.mockResolvedValue('restart');
    });

    it('restarts in place without summarizing context or touching the stored container ID', async () => {
      mockAgentsRepository.findByIdOrThrow.mockResolvedValue(mockAgent);
      mockRepository.findAllByAgentId.mockResolvedValue([mockEnvironmentVariable]);
      mockDockerService.updateContainer.mockResolvedValue('container-id-123');

      await service.reconcileEnvironmentVariables(mockAgent.id);

      expect(mockDockerService.getEnvironmentApplyStrategy).toHaveBeenCalledWith('container-id-123');
      expect(mockDockerService.updateContainer).toHaveBeenCalledWith('container-id-123', {
        env: { API_KEY: 'secret-api-key-value' },
      });
      expect(mockAgentSessionHydrationService.storePendingSummary).not.toHaveBeenCalled();
      expect(mockAgentMessagesService.getChatHistory).not.toHaveBeenCalled();
      expect(mockAgentsRepository.update).not.toHaveBeenCalledWith(
        'agent-uuid-123',
        expect.objectContaining({ containerId: expect.anything() }),
      );
    });

    it('refreshes runtime connections, waits for health and re-attaches watchers', async () => {
      mockAgentsRepository.findByIdOrThrow.mockResolvedValue(mockAgent);
      mockRepository.findAllByAgentId.mockResolvedValue([]);
      mockDockerService.updateContainer.mockResolvedValue('container-id-123');

      await service.reconcileEnvironmentVariables(mockAgent.id);

      expect(mockAgentRuntimeRefresh.invalidateConnections).toHaveBeenCalledWith(mockAgent.id);
      expect(mockAgentRuntimeRefresh.waitForHealthy).toHaveBeenCalledWith(mockAgent.id, 'container-id-123');
      expect(mockAgentRuntimeRefresh.reattachWatchers).toHaveBeenCalledWith(mockAgent.id);
    });

    it('reports restart progress steps and completes', async () => {
      mockAgentsRepository.findByIdOrThrow.mockResolvedValue(mockAgent);
      mockRepository.findAllByAgentId.mockResolvedValue([mockEnvironmentVariable]);
      mockDockerService.updateContainer.mockResolvedValue('container-id-123');

      await service.reconcileEnvironmentVariables(mockAgent.id);

      expect([...new Set(emittedProgress.map((e) => e.step))]).toEqual([
        'queued',
        'restartingContainer',
        'waitingForHealthy',
        'finalizing',
      ]);
      expect(emittedProgress.at(-1)).toEqual(expect.objectContaining({ status: 'completed', progress: 100 }));
    });

    it('does not touch the Git credential files when no Git credential changed', async () => {
      mockAgentsRepository.findByIdOrThrow.mockResolvedValue(mockAgent);
      mockRepository.findAllByAgentId.mockResolvedValue([mockEnvironmentVariable]);
      mockDockerService.updateContainer.mockResolvedValue('container-id-123');

      await service.reconcileEnvironmentVariables(mockAgent.id);

      expect(mockAgentRuntimeRefresh.restoreGitCredentials).not.toHaveBeenCalled();
    });

    it('re-provisions the Git credential files after the restart when a Git credential changed', async () => {
      mockAgentsRepository.findByIdOrThrow.mockResolvedValue(mockAgent);
      mockRepository.findAllByAgentId.mockResolvedValue([
        { ...mockEnvironmentVariable, variable: 'GIT_TOKEN', content: 'rotated' },
      ]);
      mockDockerService.updateContainer.mockResolvedValue('container-id-123');

      await service.reconcileEnvironmentVariables(mockAgent.id);

      expect(mockAgentRuntimeRefresh.restoreGitCredentials).toHaveBeenCalledWith(mockAgent.id, 'container-id-123');
      expect(mockAgentRuntimeRefresh.waitForHealthy.mock.invocationCallOrder[0]).toBeLessThan(
        mockAgentRuntimeRefresh.restoreGitCredentials.mock.invocationCallOrder[0],
      );
      expect([...new Set(emittedProgress.map((e) => e.step))]).toEqual([
        'queued',
        'restartingContainer',
        'waitingForHealthy',
        'restoringGitCredentials',
        'finalizing',
      ]);
      expect(emittedProgress.at(-1)).toEqual(expect.objectContaining({ status: 'completed', progress: 100 }));
    });

    it('re-provisions the Git credential files when a rotated SSH key override is applied', async () => {
      mockAgentsRepository.findAllWithContainers.mockResolvedValue([mockAgent]);
      mockDockerService.getContainerEnvironmentMap.mockResolvedValue({ GIT_PRIVATE_KEY: 'old-key' });
      mockDockerService.updateContainer.mockResolvedValue('container-id-123');

      await service.reconcileWorkspaceConfigurationOverrides({ GIT_PRIVATE_KEY: 'new-key' });

      expect(mockDockerService.updateContainer).toHaveBeenCalledWith('container-id-123', {
        env: { GIT_PRIVATE_KEY: 'new-key' },
      });
      expect(mockAgentRuntimeRefresh.restoreGitCredentials).toHaveBeenCalledWith(mockAgent.id, 'container-id-123');
    });

    it('still completes when the agent does not become healthy in time', async () => {
      mockAgentsRepository.findByIdOrThrow.mockResolvedValue(mockAgent);
      mockRepository.findAllByAgentId.mockResolvedValue([]);
      mockDockerService.updateContainer.mockResolvedValue('container-id-123');
      mockAgentRuntimeRefresh.waitForHealthy.mockResolvedValueOnce(false);

      await expect(service.reconcileEnvironmentVariables(mockAgent.id)).resolves.toBeUndefined();

      expect(emittedProgress.at(-1)).toEqual(expect.objectContaining({ status: 'completed' }));
    });

    it('reports failure when the in-place restart fails', async () => {
      mockAgentsRepository.findByIdOrThrow.mockResolvedValue(mockAgent);
      mockRepository.findAllByAgentId.mockResolvedValue([]);
      mockDockerService.updateContainer.mockRejectedValueOnce(new Error('restart failed'));

      await expect(service.reconcileEnvironmentVariables(mockAgent.id)).rejects.toThrow('restart failed');

      expect(emittedProgress.at(-1)).toEqual(
        expect.objectContaining({ step: 'restartingContainer', status: 'failed', error: 'restart failed' }),
      );
      expect(mockAgentRuntimeRefresh.reattachWatchers).not.toHaveBeenCalled();
    });

    it('restarts workspace configuration overrides in place', async () => {
      mockAgentsRepository.findAllWithContainers.mockResolvedValue([mockAgent]);
      mockDockerService.getContainerEnvironmentMap.mockResolvedValue({ GIT_TOKEN: 'old' });
      mockRepository.findAllByAgentId.mockResolvedValue([]);
      mockDockerService.updateContainer.mockResolvedValue('container-id-123');

      await service.reconcileWorkspaceConfigurationOverrides({ GIT_TOKEN: 'new' });

      expect(mockDockerService.updateContainer).toHaveBeenCalledTimes(1);
      expect(mockAgentsRepository.update).not.toHaveBeenCalled();
      expect(mockAgentSessionHydrationService.storePendingSummary).not.toHaveBeenCalled();
      expect([...new Set(emittedProgress.map((e) => e.step))]).toContain('restartingContainer');
      expect(emittedProgress.at(-1)).toEqual(expect.objectContaining({ status: 'completed' }));
    });
  });

  describe('environment variable baseline', () => {
    const trackedAgent = (baseline: Record<string, string | null>): AgentEntity =>
      ({ ...mockAgent, environmentVariableBaseline: JSON.stringify(baseline) }) as AgentEntity;

    beforeEach(() => {
      mockDockerService.getEnvironmentApplyStrategy.mockResolvedValue('restart');
      mockDockerService.updateContainer.mockResolvedValue('container-id-123');
    });

    it('records the replaced value when an agent variable overrides an existing key', async () => {
      mockRepository.create.mockResolvedValue({ ...mockEnvironmentVariable, variable: 'HTTP_PROXY', content: 'b' });
      mockAgentsRepository.findByIdOrThrow.mockResolvedValue(trackedAgent({}));
      mockRepository.findAllByAgentId.mockResolvedValue([
        { ...mockEnvironmentVariable, variable: 'HTTP_PROXY', content: 'b' },
      ]);
      mockDockerService.getContainerEnvironmentMap.mockResolvedValue({ HTTP_PROXY: 'a' });

      await service.createEnvironmentVariable('agent-uuid-123', 'HTTP_PROXY', 'b');

      expect(mockDockerService.updateContainer).toHaveBeenCalledWith('container-id-123', {
        env: { HTTP_PROXY: 'b' },
      });
      expect(mockAgentsRepository.update).toHaveBeenCalledWith('agent-uuid-123', {
        environmentVariableBaseline: JSON.stringify({ HTTP_PROXY: 'a' }),
      });
    });

    it('restores the replaced value when the agent variable is deleted', async () => {
      mockRepository.findById.mockResolvedValue({ ...mockEnvironmentVariable, variable: 'HTTP_PROXY' });
      mockRepository.findByIdOrThrow.mockResolvedValue({ ...mockEnvironmentVariable, variable: 'HTTP_PROXY' });
      mockRepository.delete.mockResolvedValue(undefined);
      mockAgentsRepository.findByIdOrThrow.mockResolvedValue(trackedAgent({ HTTP_PROXY: 'a' }));
      mockRepository.findAllByAgentId.mockResolvedValue([]);
      mockDockerService.getContainerEnvironmentMap.mockResolvedValue({ HTTP_PROXY: 'b' });

      await service.deleteEnvironmentVariable(mockEnvironmentVariable.id);

      expect(mockDockerService.updateContainer).toHaveBeenCalledWith('container-id-123', {
        env: { HTTP_PROXY: 'a' },
      });
      expect(mockAgentsRepository.update).toHaveBeenCalledWith('agent-uuid-123', {
        environmentVariableBaseline: '{}',
      });
    });

    it('removes a deleted variable that did not replace anything', async () => {
      mockRepository.findById.mockResolvedValue(mockEnvironmentVariable);
      mockRepository.findByIdOrThrow.mockResolvedValue(mockEnvironmentVariable);
      mockRepository.delete.mockResolvedValue(undefined);
      mockAgentsRepository.findByIdOrThrow.mockResolvedValue(trackedAgent({ API_KEY: null }));
      mockRepository.findAllByAgentId.mockResolvedValue([]);
      mockDockerService.getContainerEnvironmentMap.mockResolvedValue({ API_KEY: 'secret-api-key-value' });

      await service.deleteEnvironmentVariable(mockEnvironmentVariable.id);

      const [, options] = mockDockerService.updateContainer.mock.calls[0];

      expect(options.env).toHaveProperty('API_KEY', undefined);
    });

    it('removes a deleted variable of an untracked (legacy) agent', async () => {
      mockRepository.findById.mockResolvedValue(mockEnvironmentVariable);
      mockRepository.findByIdOrThrow.mockResolvedValue(mockEnvironmentVariable);
      mockRepository.delete.mockResolvedValue(undefined);
      mockAgentsRepository.findByIdOrThrow.mockResolvedValue(mockAgent);
      mockRepository.findAllByAgentId.mockResolvedValue([]);
      mockDockerService.getContainerEnvironmentMap.mockResolvedValue({ API_KEY: 'secret-api-key-value' });

      await service.deleteEnvironmentVariable(mockEnvironmentVariable.id);

      const [, options] = mockDockerService.updateContainer.mock.calls[0];

      expect(options.env).toHaveProperty('API_KEY', undefined);
    });

    it('removes the old key when an agent variable is renamed', async () => {
      const renamed = { ...mockEnvironmentVariable, variable: 'NEW_KEY' };

      mockRepository.findByIdOrThrow.mockResolvedValue(mockEnvironmentVariable);
      mockRepository.update.mockResolvedValue(renamed);
      mockAgentsRepository.findByIdOrThrow.mockResolvedValue(mockAgent);
      mockRepository.findAllByAgentId.mockResolvedValue([renamed]);
      mockDockerService.getContainerEnvironmentMap.mockResolvedValue({ API_KEY: 'secret-api-key-value' });

      await service.updateEnvironmentVariable(mockEnvironmentVariable.id, 'NEW_KEY', renamed.content);

      const [, options] = mockDockerService.updateContainer.mock.calls[0];

      expect(options.env).toHaveProperty('API_KEY', undefined);
      expect(options.env).toHaveProperty('NEW_KEY', 'secret-api-key-value');
      expect(mockAgentsRepository.update).toHaveBeenCalledWith('agent-uuid-123', {
        environmentVariableBaseline: JSON.stringify({ NEW_KEY: null }),
      });
    });

    it('removes every deleted key when all agent variables are deleted', async () => {
      mockRepository.findAllByAgentId.mockResolvedValueOnce([mockEnvironmentVariable]).mockResolvedValueOnce([]);
      mockRepository.deleteByAgentId.mockResolvedValue(1);
      mockAgentsRepository.findByIdOrThrow.mockResolvedValue(mockAgent);
      mockDockerService.getContainerEnvironmentMap.mockResolvedValue({ API_KEY: 'secret-api-key-value' });

      await service.deleteAllEnvironmentVariables('agent-uuid-123');

      const [, options] = mockDockerService.updateContainer.mock.calls[0];

      expect(options.env).toHaveProperty('API_KEY', undefined);
    });

    it('does not persist the baseline when applying the environment fails', async () => {
      mockAgentsRepository.findByIdOrThrow.mockResolvedValue(trackedAgent({}));
      mockRepository.findAllByAgentId.mockResolvedValue([mockEnvironmentVariable]);
      mockDockerService.updateContainer.mockRejectedValue(new Error('restart failed'));

      await expect(service.reconcileEnvironmentVariables('agent-uuid-123')).rejects.toThrow('restart failed');

      expect(mockAgentsRepository.update).not.toHaveBeenCalledWith(
        'agent-uuid-123',
        expect.objectContaining({ environmentVariableBaseline: expect.anything() }),
      );
    });

    it('only records workspace overrides of keys controlled by agent variables', async () => {
      const agent = trackedAgent({ HTTP_PROXY: 'a' });

      mockAgentsRepository.findAllWithContainers.mockResolvedValue([agent]);
      mockAgentsRepository.findByIdOrThrow.mockResolvedValue(agent);
      mockDockerService.getContainerEnvironmentMap.mockResolvedValue({ HTTP_PROXY: 'b' });

      await service.reconcileWorkspaceConfigurationOverrides({ HTTP_PROXY: 'c' });

      expect(mockDockerService.updateContainer).not.toHaveBeenCalled();
      expect(mockAgentsRepository.update).toHaveBeenCalledWith('agent-uuid-123', {
        environmentVariableBaseline: JSON.stringify({ HTTP_PROXY: 'c' }),
      });
      expect(emittedProgress).toEqual([]);
    });

    it('applies only the workspace overrides that are not controlled by agent variables', async () => {
      const agent = trackedAgent({ HTTP_PROXY: 'a' });

      mockAgentsRepository.findAllWithContainers.mockResolvedValue([agent]);
      mockAgentsRepository.findByIdOrThrow.mockResolvedValue(agent);
      mockDockerService.getContainerEnvironmentMap.mockResolvedValue({ HTTP_PROXY: 'b', GIT_TOKEN: 'old' });

      await service.reconcileWorkspaceConfigurationOverrides({ HTTP_PROXY: 'c', GIT_TOKEN: 'new' });

      expect(mockDockerService.updateContainer).toHaveBeenCalledWith('container-id-123', {
        env: { GIT_TOKEN: 'new' },
      });
      expect(mockAgentsRepository.update).toHaveBeenCalledWith('agent-uuid-123', {
        environmentVariableBaseline: JSON.stringify({ HTTP_PROXY: 'c' }),
      });
    });
  });
});
