import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { DeploymentConfigurationEntity } from '../entities/deployment-configuration.entity';
import { DeploymentRunEntity } from '../entities/deployment-run.entity';
import { PipelineProviderFactory } from '../providers/pipeline-provider.factory';
import { PipelineProvider } from '../providers/pipeline-provider.interface';
import { AgentsRepository } from '../repositories/agents.repository';
import { DeploymentConfigurationsRepository } from '../repositories/deployment-configurations.repository';
import { DeploymentRunsRepository } from '../repositories/deployment-runs.repository';

import { DeploymentsService } from './deployments.service';

describe('DeploymentsService', () => {
  let service: DeploymentsService;
  let mockProvider: jest.Mocked<PipelineProvider>;
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
  const mockRun: DeploymentRunEntity = {
    id: 'run-uuid',
    configurationId: 'config-uuid',
    providerRunId: '789',
    runName: 'Pipeline #789',
    status: 'completed',
    conclusion: 'success',
    ref: 'main',
    sha: 'abc123',
    workflowId: '123',
    workflowName: 'CI Workflow',
    startedAt: new Date('2024-01-01T00:01:00Z'),
    completedAt: new Date('2024-01-01T00:05:00Z'),
    htmlUrl: 'https://github.com/owner/repo/actions/runs/789',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    configuration: {} as any,
  };
  const mockConfigRepository = {
    findByAgentId: jest.fn(),
    findByAgentIdOrThrow: jest.fn(),
    upsertByAgentId: jest.fn(),
    deleteByAgentId: jest.fn(),
  };
  const mockRunsRepository = {
    findByConfigurationId: jest.fn(),
    findByProviderRunId: jest.fn(),
    findById: jest.fn(),
    upsertByProviderRunId: jest.fn(),
    update: jest.fn(),
  };
  const mockAgentsRepository = {
    findByIdOrThrow: jest.fn(),
  };
  const mockProviderFactory = {
    hasProvider: jest.fn(),
    getProvider: jest.fn(),
  };
  const mockPipelineProvider: jest.Mocked<PipelineProvider> = {
    getType: jest.fn().mockReturnValue('github'),
    getDisplayName: jest.fn().mockReturnValue('GitHub Actions'),
    listRepositories: jest.fn(),
    listBranches: jest.fn(),
    listWorkflows: jest.fn(),
    triggerWorkflow: jest.fn(),
    getRunStatus: jest.fn(),
    getRunLogs: jest.fn(),
    listRunJobs: jest.fn(),
    getJobLogs: jest.fn(),
    cancelRun: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeploymentsService,
        {
          provide: DeploymentConfigurationsRepository,
          useValue: mockConfigRepository,
        },
        {
          provide: DeploymentRunsRepository,
          useValue: mockRunsRepository,
        },
        {
          provide: AgentsRepository,
          useValue: mockAgentsRepository,
        },
        {
          provide: PipelineProviderFactory,
          useValue: mockProviderFactory,
        },
      ],
    }).compile();

    service = module.get<DeploymentsService>(DeploymentsService);
    mockProvider = mockPipelineProvider;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getConfiguration', () => {
    it('should return configuration when found', async () => {
      mockConfigRepository.findByAgentId.mockResolvedValue(mockConfiguration);

      const result = await service.getConfiguration('agent-uuid');

      expect(result).toBeDefined();
      expect(result?.id).toBe('config-uuid');
    });

    it('should return null when not found', async () => {
      mockConfigRepository.findByAgentId.mockResolvedValue(null);

      const result = await service.getConfiguration('agent-uuid');

      expect(result).toBeNull();
    });
  });

  describe('upsertConfiguration', () => {
    it('should create new configuration', async () => {
      const dto = {
        providerType: 'github',
        repositoryId: 'owner/repo',
        defaultBranch: 'main',
        providerToken: 'token',
      };

      mockAgentsRepository.findByIdOrThrow.mockResolvedValue({} as any);
      mockProviderFactory.hasProvider.mockReturnValue(true);
      mockConfigRepository.upsertByAgentId.mockResolvedValue(mockConfiguration);

      const result = await service.upsertConfiguration('agent-uuid', dto);

      expect(result).toBeDefined();
      expect(mockConfigRepository.upsertByAgentId).toHaveBeenCalled();
    });

    it('should throw error when provider not available', async () => {
      const dto = {
        providerType: 'unknown' as any,
        repositoryId: 'owner/repo',
      };

      mockAgentsRepository.findByIdOrThrow.mockResolvedValue({} as any);
      mockProviderFactory.hasProvider.mockReturnValue(false);

      await expect(service.upsertConfiguration('agent-uuid', dto)).rejects.toThrow(BadRequestException);
    });

    it('should throw error when agent not found', async () => {
      const dto = {
        providerType: 'github',
        repositoryId: 'owner/repo',
      };

      mockAgentsRepository.findByIdOrThrow.mockRejectedValue(new NotFoundException());

      await expect(service.upsertConfiguration('agent-uuid', dto)).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteConfiguration', () => {
    it('should delete configuration', async () => {
      mockConfigRepository.deleteByAgentId.mockResolvedValue(undefined);

      await service.deleteConfiguration('agent-uuid');

      expect(mockConfigRepository.deleteByAgentId).toHaveBeenCalledWith('agent-uuid');
    });
  });

  describe('listRepositories', () => {
    it('should list repositories', async () => {
      const mockRepos = [
        {
          id: 'owner/repo1',
          name: 'repo1',
          fullName: 'owner/repo1',
          defaultBranch: 'main',
          url: 'https://github.com/owner/repo1',
          private: false,
        },
      ];

      mockConfigRepository.findByAgentIdOrThrow.mockResolvedValue(mockConfiguration);
      mockProviderFactory.getProvider.mockReturnValue(mockProvider);
      mockProvider.listRepositories.mockResolvedValue(mockRepos);

      const result = await service.listRepositories('agent-uuid');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('owner/repo1');
    });
  });

  describe('triggerWorkflow', () => {
    it('should trigger workflow and store run', async () => {
      const dto = {
        workflowId: '123',
        ref: 'main',
        inputs: { environment: 'production' },
      };
      const mockPipelineRun = {
        id: '789',
        name: 'Pipeline #789',
        status: 'queued',
        conclusion: undefined,
        ref: 'main',
        sha: 'abc123',
        workflowId: '123',
        workflowName: 'CI Workflow',
        createdAt: new Date(),
        updatedAt: new Date(),
        startedAt: undefined,
        completedAt: undefined,
        htmlUrl: 'https://github.com/owner/repo/actions/runs/789',
      };

      mockConfigRepository.findByAgentIdOrThrow.mockResolvedValue(mockConfiguration);
      mockProviderFactory.getProvider.mockReturnValue(mockProvider);
      mockProvider.triggerWorkflow.mockResolvedValue(mockPipelineRun);
      mockRunsRepository.upsertByProviderRunId.mockResolvedValue(mockRun);

      const result = await service.triggerWorkflow('agent-uuid', dto);

      expect(result).toBeDefined();
      expect(result.providerRunId).toBe('789');
      expect(mockProvider.triggerWorkflow).toHaveBeenCalledWith(expect.any(Object), 'owner/repo', '123', 'main', {
        environment: 'production',
      });
    });
  });

  describe('getRunStatus', () => {
    it('should get run status and update database', async () => {
      const mockPipelineRun = {
        id: '789',
        name: 'Pipeline #789',
        status: 'completed',
        conclusion: 'success',
        ref: 'main',
        sha: 'abc123',
        workflowId: '123',
        workflowName: 'CI Workflow',
        createdAt: new Date(),
        updatedAt: new Date(),
        startedAt: new Date('2024-01-01T00:01:00Z'),
        completedAt: new Date('2024-01-01T00:05:00Z'),
        htmlUrl: 'https://github.com/owner/repo/actions/runs/789',
      };

      mockConfigRepository.findByAgentIdOrThrow.mockResolvedValue(mockConfiguration);
      mockRunsRepository.findById.mockResolvedValue(mockRun);
      mockProviderFactory.getProvider.mockReturnValue(mockProvider);
      mockProvider.getRunStatus.mockResolvedValue(mockPipelineRun);
      mockRunsRepository.upsertByProviderRunId.mockResolvedValue(mockRun);

      const result = await service.getRunStatus('agent-uuid', 'run-uuid');

      expect(result).toBeDefined();
      expect(result.status).toBe('completed');
      expect(mockRunsRepository.findById).toHaveBeenCalledWith('run-uuid');
      expect(mockProvider.getRunStatus).toHaveBeenCalledWith(expect.any(Object), 'owner/repo', '789');
      expect(mockRunsRepository.upsertByProviderRunId).toHaveBeenCalled();
    });
  });

  describe('getRunLogs', () => {
    it('should get run logs', async () => {
      mockConfigRepository.findByAgentIdOrThrow.mockResolvedValue(mockConfiguration);
      mockRunsRepository.findById.mockResolvedValue(mockRun);
      mockProviderFactory.getProvider.mockReturnValue(mockProvider);
      mockProvider.getRunLogs.mockResolvedValue('Log content');

      const result = await service.getRunLogs('agent-uuid', 'run-uuid');

      expect(result).toBe('Log content');
      expect(mockRunsRepository.findById).toHaveBeenCalledWith('run-uuid');
      expect(mockProvider.getRunLogs).toHaveBeenCalledWith(expect.any(Object), 'owner/repo', '789');
    });
  });

  describe('listRunJobs', () => {
    it('should list run jobs', async () => {
      const mockJobs = [
        {
          id: '1',
          name: 'Build',
          status: 'completed',
          conclusion: 'success',
          startedAt: new Date(),
          completedAt: new Date(),
        },
      ];

      mockConfigRepository.findByAgentIdOrThrow.mockResolvedValue(mockConfiguration);
      mockRunsRepository.findById.mockResolvedValue(mockRun);
      mockProviderFactory.getProvider.mockReturnValue(mockProvider);
      mockProvider.listRunJobs.mockResolvedValue(mockJobs);

      const result = await service.listRunJobs('agent-uuid', 'run-uuid');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Build');
      expect(mockRunsRepository.findById).toHaveBeenCalledWith('run-uuid');
      expect(mockProvider.listRunJobs).toHaveBeenCalledWith(expect.any(Object), 'owner/repo', '789');
    });
  });

  describe('getJobLogs', () => {
    it('should get job logs', async () => {
      mockConfigRepository.findByAgentIdOrThrow.mockResolvedValue(mockConfiguration);
      mockRunsRepository.findById.mockResolvedValue(mockRun);
      mockProviderFactory.getProvider.mockReturnValue(mockProvider);
      mockProvider.getJobLogs.mockResolvedValue('Job log content');

      const result = await service.getJobLogs('agent-uuid', 'run-uuid', '1');

      expect(result).toBe('Job log content');
      expect(mockRunsRepository.findById).toHaveBeenCalledWith('run-uuid');
      expect(mockProvider.getJobLogs).toHaveBeenCalledWith(expect.any(Object), 'owner/repo', '789', '1');
    });
  });

  describe('cancelRun', () => {
    it('should cancel run', async () => {
      mockConfigRepository.findByAgentIdOrThrow.mockResolvedValue(mockConfiguration);
      mockRunsRepository.findById.mockResolvedValue(mockRun);
      mockProviderFactory.getProvider.mockReturnValue(mockProvider);
      mockProvider.cancelRun.mockResolvedValue(undefined);
      mockRunsRepository.update.mockResolvedValue({ ...mockRun, status: 'cancelled', conclusion: 'cancelled' });

      await service.cancelRun('agent-uuid', 'run-uuid');

      expect(mockRunsRepository.findById).toHaveBeenCalledWith('run-uuid');
      expect(mockProvider.cancelRun).toHaveBeenCalledWith(expect.any(Object), 'owner/repo', '789');
      expect(mockRunsRepository.update).toHaveBeenCalled();
    });
  });
});
