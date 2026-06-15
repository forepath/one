import { ClientUsersRepository } from '@forepath/identity/backend';
import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { ClientsRepository } from '../repositories/clients.repository';
import { ClientAgentDeploymentsProxyService } from '../services/client-agent-deployments-proxy.service';

import { ClientsDeploymentsController } from './clients-deployments.controller';

describe('ClientsDeploymentsController', () => {
  let controller: ClientsDeploymentsController;
  let proxyService: jest.Mocked<ClientAgentDeploymentsProxyService>;
  const mockClientsRepository = {
    findById: jest.fn(),
  };
  const mockClientUsersRepository = {
    findUserClientAccess: jest.fn(),
  };
  const mockProxyService = {
    getConfiguration: jest.fn(),
    upsertConfiguration: jest.fn(),
    deleteConfiguration: jest.fn(),
    listRepositories: jest.fn(),
    listBranches: jest.fn(),
    listWorkflows: jest.fn(),
    triggerWorkflow: jest.fn(),
    listRuns: jest.fn(),
    getRunStatus: jest.fn(),
    getRunLogs: jest.fn(),
    listRunJobs: jest.fn(),
    getJobLogs: jest.fn(),
    cancelRun: jest.fn(),
  };

  beforeEach(async () => {
    mockClientsRepository.findById.mockResolvedValue({ id: 'client-uuid', userId: null });
    mockClientUsersRepository.findUserClientAccess.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ClientsDeploymentsController],
      providers: [
        {
          provide: ClientAgentDeploymentsProxyService,
          useValue: mockProxyService,
        },
        {
          provide: ClientsRepository,
          useValue: mockClientsRepository,
        },
        {
          provide: ClientUsersRepository,
          useValue: mockClientUsersRepository,
        },
      ],
    }).compile();

    controller = module.get<ClientsDeploymentsController>(ClientsDeploymentsController);
    proxyService = module.get(ClientAgentDeploymentsProxyService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getConfiguration', () => {
    it('should get deployment configuration', async () => {
      const mockConfiguration = {
        id: 'config-uuid',
        agentId: 'agent-uuid',
        providerType: 'github',
        repositoryId: 'owner/repo',
      };

      proxyService.getConfiguration.mockResolvedValue(mockConfiguration);

      const mockReq = { apiKeyAuthenticated: true } as any;
      const result = await controller.getConfiguration('client-uuid', 'agent-uuid', mockReq);

      expect(result).toEqual(mockConfiguration);
      expect(proxyService.getConfiguration).toHaveBeenCalledWith('client-uuid', 'agent-uuid');
    });
  });

  describe('upsertConfiguration', () => {
    it('should create or update deployment configuration', async () => {
      const dto = {
        providerType: 'github',
        repositoryId: 'owner/repo',
        defaultBranch: 'main',
        providerToken: 'token',
      };
      const mockConfiguration = {
        id: 'config-uuid',
        agentId: 'agent-uuid',
        providerType: 'github',
        repositoryId: 'owner/repo',
      };

      proxyService.upsertConfiguration.mockResolvedValue(mockConfiguration);

      const mockReq = { apiKeyAuthenticated: true } as any;
      const result = await controller.upsertConfiguration('client-uuid', 'agent-uuid', dto, mockReq);

      expect(result).toEqual(mockConfiguration);
      expect(proxyService.upsertConfiguration).toHaveBeenCalledWith('client-uuid', 'agent-uuid', dto);
    });
  });

  describe('deleteConfiguration', () => {
    it('should delete deployment configuration', async () => {
      proxyService.deleteConfiguration.mockResolvedValue(undefined);

      const mockReq = { apiKeyAuthenticated: true } as any;

      await controller.deleteConfiguration('client-uuid', 'agent-uuid', mockReq);

      expect(proxyService.deleteConfiguration).toHaveBeenCalledWith('client-uuid', 'agent-uuid');
    });
  });

  describe('listRepositories', () => {
    it('should list repositories', async () => {
      const mockRepositories = [
        {
          id: 'owner/repo1',
          name: 'repo1',
          fullName: 'owner/repo1',
          defaultBranch: 'main',
          url: 'https://github.com/owner/repo1',
          private: false,
        },
      ];

      proxyService.listRepositories.mockResolvedValue(mockRepositories);

      const mockReq = { apiKeyAuthenticated: true } as any;
      const result = await controller.listRepositories('client-uuid', 'agent-uuid', mockReq);

      expect(result).toEqual(mockRepositories);
      expect(proxyService.listRepositories).toHaveBeenCalledWith('client-uuid', 'agent-uuid');
    });
  });

  describe('listBranches', () => {
    it('should list branches for a repository', async () => {
      const mockBranches = [
        { name: 'main', sha: 'abc123', default: true },
        { name: 'develop', sha: 'def456', default: false },
      ];

      proxyService.listBranches.mockResolvedValue(mockBranches);

      const mockReq = { apiKeyAuthenticated: true } as any;
      const result = await controller.listBranches('client-uuid', 'agent-uuid', 'owner/repo', mockReq);

      expect(result).toEqual(mockBranches);
      expect(proxyService.listBranches).toHaveBeenCalledWith('client-uuid', 'agent-uuid', 'owner/repo');
    });
  });

  describe('listWorkflows', () => {
    it('should list workflows for a repository', async () => {
      const mockWorkflows = [
        {
          id: '123',
          name: 'CI',
          path: '.github/workflows/ci.yml',
          state: 'active',
          canTrigger: true,
        },
      ];

      proxyService.listWorkflows.mockResolvedValue(mockWorkflows);

      const mockReq = { apiKeyAuthenticated: true } as any;
      const result = await controller.listWorkflows('client-uuid', 'agent-uuid', 'owner/repo', 'main', mockReq);

      expect(result).toEqual(mockWorkflows);
      expect(proxyService.listWorkflows).toHaveBeenCalledWith('client-uuid', 'agent-uuid', 'owner/repo', 'main');
    });

    it('should list workflows without branch parameter', async () => {
      const mockWorkflows = [
        {
          id: '123',
          name: 'CI',
          path: '.github/workflows/ci.yml',
          state: 'active',
          canTrigger: true,
        },
      ];

      proxyService.listWorkflows.mockResolvedValue(mockWorkflows);

      const mockReq = { apiKeyAuthenticated: true } as any;
      const result = await controller.listWorkflows('client-uuid', 'agent-uuid', 'owner/repo', undefined, mockReq);

      expect(result).toEqual(mockWorkflows);
      expect(proxyService.listWorkflows).toHaveBeenCalledWith('client-uuid', 'agent-uuid', 'owner/repo', undefined);
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
        providerRunId: '789',
        status: 'queued',
      };

      proxyService.triggerWorkflow.mockResolvedValue(mockRun);

      const mockReq = { apiKeyAuthenticated: true } as any;
      const result = await controller.triggerWorkflow('client-uuid', 'agent-uuid', dto, mockReq);

      expect(result).toEqual(mockRun);
      expect(proxyService.triggerWorkflow).toHaveBeenCalledWith('client-uuid', 'agent-uuid', dto);
    });
  });

  describe('listRuns', () => {
    it('should list deployment runs', async () => {
      const mockRuns = [
        {
          id: 'run-uuid',
          providerRunId: '789',
          status: 'completed',
        },
      ];

      proxyService.listRuns.mockResolvedValue(mockRuns);

      const mockReq = { apiKeyAuthenticated: true } as any;
      const result = await controller.listRuns('client-uuid', 'agent-uuid', 50, 0, mockReq);

      expect(result).toEqual(mockRuns);
      expect(proxyService.listRuns).toHaveBeenCalledWith('client-uuid', 'agent-uuid', 50, 0);
    });

    it('should list runs without pagination parameters', async () => {
      const mockRuns = [
        {
          id: 'run-uuid',
          providerRunId: '789',
          status: 'completed',
        },
      ];

      proxyService.listRuns.mockResolvedValue(mockRuns);

      const mockReq = { apiKeyAuthenticated: true } as any;
      const result = await controller.listRuns('client-uuid', 'agent-uuid', undefined, undefined, mockReq);

      expect(result).toEqual(mockRuns);
      expect(proxyService.listRuns).toHaveBeenCalledWith('client-uuid', 'agent-uuid', undefined, undefined);
    });
  });

  describe('getRunStatus', () => {
    it('should get run status', async () => {
      const mockRun = {
        id: 'run-uuid',
        providerRunId: '789',
        status: 'completed',
        conclusion: 'success',
      };

      proxyService.getRunStatus.mockResolvedValue(mockRun);

      const mockReq = { apiKeyAuthenticated: true } as any;
      const result = await controller.getRunStatus('client-uuid', 'agent-uuid', '789', mockReq);

      expect(result).toEqual(mockRun);
      expect(proxyService.getRunStatus).toHaveBeenCalledWith('client-uuid', 'agent-uuid', '789');
    });
  });

  describe('getRunLogs', () => {
    it('should get run logs', async () => {
      const mockLogs = { logs: 'Log content' };

      proxyService.getRunLogs.mockResolvedValue(mockLogs);

      const mockReq = { apiKeyAuthenticated: true } as any;
      const result = await controller.getRunLogs('client-uuid', 'agent-uuid', '789', mockReq);

      expect(result).toEqual(mockLogs);
      expect(proxyService.getRunLogs).toHaveBeenCalledWith('client-uuid', 'agent-uuid', '789');
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
        },
      ];

      proxyService.listRunJobs.mockResolvedValue(mockJobs);

      const mockReq = { apiKeyAuthenticated: true } as any;
      const result = await controller.listRunJobs('client-uuid', 'agent-uuid', '789', mockReq);

      expect(result).toEqual(mockJobs);
      expect(proxyService.listRunJobs).toHaveBeenCalledWith('client-uuid', 'agent-uuid', '789');
    });
  });

  describe('getJobLogs', () => {
    it('should get job logs', async () => {
      const mockLogs = { logs: 'Job log content' };

      proxyService.getJobLogs.mockResolvedValue(mockLogs);

      const mockReq = { apiKeyAuthenticated: true } as any;
      const result = await controller.getJobLogs('client-uuid', 'agent-uuid', '789', '1', mockReq);

      expect(result).toEqual(mockLogs);
      expect(proxyService.getJobLogs).toHaveBeenCalledWith('client-uuid', 'agent-uuid', '789', '1');
    });
  });

  describe('cancelRun', () => {
    it('should cancel run', async () => {
      proxyService.cancelRun.mockResolvedValue(undefined);

      const mockReq = { apiKeyAuthenticated: true } as any;

      await controller.cancelRun('client-uuid', 'agent-uuid', '789', mockReq);

      expect(proxyService.cancelRun).toHaveBeenCalledWith('client-uuid', 'agent-uuid', '789');
    });
  });

  describe('permission checks', () => {
    it('should throw ForbiddenException when user does not have access', async () => {
      mockClientsRepository.findById.mockResolvedValue({ id: 'client-uuid', userId: 'other-user-id' });
      mockClientUsersRepository.findUserClientAccess.mockResolvedValue(null);

      const mockReq = { apiKeyAuthenticated: false, user: { id: 'user-uuid', roles: ['user'] } } as any;

      await expect(controller.getConfiguration('client-uuid', 'agent-uuid', mockReq)).rejects.toThrow(
        ForbiddenException,
      );
      expect(proxyService.getConfiguration).not.toHaveBeenCalled();
    });
  });
});
