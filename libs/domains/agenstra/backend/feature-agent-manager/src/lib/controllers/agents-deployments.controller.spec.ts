import { Test, TestingModule } from '@nestjs/testing';

import { DeploymentConfigurationResponseDto } from '../dto/deployment-configuration.dto';
import { DeploymentsService } from '../services/deployments.service';

import { AgentsDeploymentsController } from './agents-deployments.controller';

describe('AgentsDeploymentsController', () => {
  let controller: AgentsDeploymentsController;
  let service: jest.Mocked<DeploymentsService>;
  const mockConfiguration: DeploymentConfigurationResponseDto = {
    id: 'config-uuid',
    agentId: 'agent-uuid',
    providerType: 'github',
    repositoryId: 'owner/repo',
    defaultBranch: 'main',
    workflowId: '12345678',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };
  const mockService = {
    getConfiguration: jest.fn(),
    upsertConfiguration: jest.fn(),
    deleteConfiguration: jest.fn(),
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
      controllers: [AgentsDeploymentsController],
      providers: [
        {
          provide: DeploymentsService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<AgentsDeploymentsController>(AgentsDeploymentsController);
    service = module.get(DeploymentsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getConfiguration', () => {
    it('should return configuration', async () => {
      service.getConfiguration.mockResolvedValue(mockConfiguration);

      const result = await controller.getConfiguration('agent-uuid');

      expect(result).toEqual(mockConfiguration);
      expect(service.getConfiguration).toHaveBeenCalledWith('agent-uuid');
    });
  });

  describe('upsertConfiguration', () => {
    it('should create or update configuration', async () => {
      const dto = {
        providerType: 'github',
        repositoryId: 'owner/repo',
        defaultBranch: 'main',
        providerToken: 'token',
      };

      service.upsertConfiguration.mockResolvedValue(mockConfiguration);

      const result = await controller.upsertConfiguration('agent-uuid', dto);

      expect(result).toEqual(mockConfiguration);
      expect(service.upsertConfiguration).toHaveBeenCalledWith('agent-uuid', dto);
    });
  });

  describe('deleteConfiguration', () => {
    it('should delete configuration', async () => {
      service.deleteConfiguration.mockResolvedValue(undefined);

      await controller.deleteConfiguration('agent-uuid');

      expect(service.deleteConfiguration).toHaveBeenCalledWith('agent-uuid');
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

      service.listRepositories.mockResolvedValue(mockRepos);

      const result = await controller.listRepositories('agent-uuid');

      expect(result).toEqual(mockRepos);
      expect(service.listRepositories).toHaveBeenCalledWith('agent-uuid');
    });
  });

  describe('listBranches', () => {
    it('should list branches', async () => {
      const mockBranches = [
        { name: 'main', sha: 'abc123', default: true },
        { name: 'develop', sha: 'def456', default: false },
      ];

      service.listBranches.mockResolvedValue(mockBranches);

      const result = await controller.listBranches('agent-uuid', 'owner/repo');

      expect(result).toEqual(mockBranches);
      expect(service.listBranches).toHaveBeenCalledWith('agent-uuid', 'owner/repo');
    });
  });

  describe('listWorkflows', () => {
    it('should list workflows', async () => {
      const mockWorkflows = [
        {
          id: '123',
          name: 'CI',
          path: '.github/workflows/ci.yml',
          state: 'active',
          canTrigger: true,
        },
      ];

      service.listWorkflows.mockResolvedValue(mockWorkflows);

      const result = await controller.listWorkflows('agent-uuid', 'owner/repo', 'main');

      expect(result).toEqual(mockWorkflows);
      expect(service.listWorkflows).toHaveBeenCalledWith('agent-uuid', 'owner/repo', 'main');
    });
  });

  describe('triggerWorkflow', () => {
    it('should trigger workflow', async () => {
      const dto = {
        workflowId: '123',
        ref: 'main',
        inputs: { environment: 'production' },
      };
      const mockRun = {
        id: 'run-uuid',
        configurationId: 'config-uuid',
        providerRunId: '789',
        runName: 'Pipeline #789',
        status: 'queued',
        conclusion: undefined,
        ref: 'main',
        sha: 'abc123',
        workflowId: '123',
        workflowName: 'CI Workflow',
        startedAt: undefined,
        completedAt: undefined,
        htmlUrl: 'https://github.com/owner/repo/actions/runs/789',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      service.triggerWorkflow.mockResolvedValue(mockRun);

      const result = await controller.triggerWorkflow('agent-uuid', dto);

      expect(result).toEqual(mockRun);
      expect(service.triggerWorkflow).toHaveBeenCalledWith('agent-uuid', dto);
    });
  });

  describe('getRunStatus', () => {
    it('should get run status', async () => {
      const mockRun = {
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
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      service.getRunStatus.mockResolvedValue(mockRun);

      const result = await controller.getRunStatus('agent-uuid', '789');

      expect(result).toEqual(mockRun);
      expect(service.getRunStatus).toHaveBeenCalledWith('agent-uuid', '789');
    });
  });

  describe('getRunLogs', () => {
    it('should get run logs', async () => {
      service.getRunLogs.mockResolvedValue('Log content');

      const result = await controller.getRunLogs('agent-uuid', '789');

      expect(result).toEqual({ logs: 'Log content' });
      expect(service.getRunLogs).toHaveBeenCalledWith('agent-uuid', '789');
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

      service.listRunJobs.mockResolvedValue(mockJobs);

      const result = await controller.listRunJobs('agent-uuid', '789');

      expect(result).toEqual(mockJobs);
      expect(service.listRunJobs).toHaveBeenCalledWith('agent-uuid', '789');
    });
  });

  describe('getJobLogs', () => {
    it('should get job logs', async () => {
      service.getJobLogs.mockResolvedValue('Job log content');

      const result = await controller.getJobLogs('agent-uuid', '789', '1');

      expect(result).toEqual({ logs: 'Job log content' });
      expect(service.getJobLogs).toHaveBeenCalledWith('agent-uuid', '789', '1');
    });
  });

  describe('cancelRun', () => {
    it('should cancel run', async () => {
      service.cancelRun.mockResolvedValue(undefined);

      await controller.cancelRun('agent-uuid', '789');

      expect(service.cancelRun).toHaveBeenCalledWith('agent-uuid', '789');
    });
  });
});
