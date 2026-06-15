import {
  CreateDeploymentConfigurationDto,
  DeploymentConfigurationResponseDto,
  DeploymentRunResponseDto,
  JobResponseDto,
  RepositoryResponseDto,
  TriggerWorkflowDto,
} from '@forepath/agenstra/backend/feature-agent-manager';
import { AuthenticationType, ClientEntity } from '@forepath/identity/backend';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import axios, { AxiosError } from 'axios';

import { ClientsRepository } from '../repositories/clients.repository';

import { ClientAgentDeploymentsProxyService } from './client-agent-deployments-proxy.service';
import { ClientsService } from './clients.service';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('ClientAgentDeploymentsProxyService', () => {
  let service: ClientAgentDeploymentsProxyService;
  let clientsService: jest.Mocked<ClientsService>;
  let clientsRepository: jest.Mocked<ClientsRepository>;
  const mockClientEntity: ClientEntity = {
    id: 'client-uuid',
    name: 'Test Client',
    description: 'Test Description',
    endpoint: 'https://example.com/api',
    authenticationType: AuthenticationType.API_KEY,
    apiKey: 'test-api-key-123',
    keycloakClientId: undefined,
    keycloakClientSecret: undefined,
    keycloakRealm: undefined,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };
  const mockKeycloakClientEntity: ClientEntity = {
    ...mockClientEntity,
    authenticationType: AuthenticationType.KEYCLOAK,
    apiKey: undefined,
    keycloakClientId: 'keycloak-client-id',
    keycloakClientSecret: 'keycloak-client-secret',
    keycloakRealm: 'test-realm',
  };
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
  const mockClientsService = {
    getAccessToken: jest.fn(),
  };
  const mockClientsRepository = {
    findByIdOrThrow: jest.fn(),
  };

  beforeEach(async () => {
    mockedAxios.request = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientAgentDeploymentsProxyService,
        {
          provide: ClientsService,
          useValue: mockClientsService,
        },
        {
          provide: ClientsRepository,
          useValue: mockClientsRepository,
        },
      ],
    }).compile();

    service = module.get<ClientAgentDeploymentsProxyService>(ClientAgentDeploymentsProxyService);
    clientsService = module.get(ClientsService);
    clientsRepository = module.get(ClientsRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getConfiguration', () => {
    it('should get configuration with API key authentication', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({ data: mockConfiguration, status: 200 });

      const result = await service.getConfiguration('client-uuid', 'agent-uuid');

      expect(result).toEqual(mockConfiguration);
      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          url: 'https://example.com/api/api/agents/agent-uuid/deployments/configuration',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key-123',
          }),
        }),
      );
    });

    it('should get configuration with Keycloak authentication', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockKeycloakClientEntity);
      clientsService.getAccessToken.mockResolvedValue('keycloak-jwt-token');
      mockedAxios.request.mockResolvedValue({ data: mockConfiguration, status: 200 });

      const result = await service.getConfiguration('client-uuid', 'agent-uuid');

      expect(result).toEqual(mockConfiguration);
      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer keycloak-jwt-token',
          }),
        }),
      );
    });

    it('should throw NotFoundException on 404', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        data: { message: 'Not found' },
        status: 404,
      });

      await expect(service.getConfiguration('client-uuid', 'agent-uuid')).rejects.toThrow(NotFoundException);
    });
  });

  describe('upsertConfiguration', () => {
    it('should create or update configuration', async () => {
      const dto: CreateDeploymentConfigurationDto = {
        providerType: 'github',
        repositoryId: 'owner/repo',
        defaultBranch: 'main',
        providerToken: 'token',
      };

      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({ data: mockConfiguration, status: 200 });

      const result = await service.upsertConfiguration('client-uuid', 'agent-uuid', dto);

      expect(result).toEqual(mockConfiguration);
      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          url: 'https://example.com/api/api/agents/agent-uuid/deployments/configuration',
          data: dto,
        }),
      );
    });
  });

  describe('deleteConfiguration', () => {
    it('should delete configuration', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({ data: {}, status: 204 });

      await service.deleteConfiguration('client-uuid', 'agent-uuid');

      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'DELETE',
          url: 'https://example.com/api/api/agents/agent-uuid/deployments/configuration',
        }),
      );
    });
  });

  describe('listRepositories', () => {
    it('should list repositories', async () => {
      const mockRepos: RepositoryResponseDto[] = [
        {
          id: 'owner/repo1',
          name: 'repo1',
          fullName: 'owner/repo1',
          defaultBranch: 'main',
          url: 'https://github.com/owner/repo1',
          private: false,
        },
      ];

      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({ data: mockRepos, status: 200 });

      const result = await service.listRepositories('client-uuid', 'agent-uuid');

      expect(result).toEqual(mockRepos);
    });
  });

  describe('triggerWorkflow', () => {
    it('should trigger workflow', async () => {
      const dto: TriggerWorkflowDto = {
        workflowId: '123',
        ref: 'main',
        inputs: { environment: 'production' },
      };
      const mockRun: DeploymentRunResponseDto = {
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

      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({ data: mockRun, status: 200 });

      const result = await service.triggerWorkflow('client-uuid', 'agent-uuid', dto);

      expect(result).toEqual(mockRun);
      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          url: 'https://example.com/api/api/agents/agent-uuid/deployments/workflows/trigger',
          data: dto,
        }),
      );
    });
  });

  describe('getRunStatus', () => {
    it('should get run status', async () => {
      const mockRun: DeploymentRunResponseDto = {
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

      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({ data: mockRun, status: 200 });

      const result = await service.getRunStatus('client-uuid', 'agent-uuid', '789');

      expect(result).toEqual(mockRun);
    });
  });

  describe('getRunLogs', () => {
    it('should get run logs', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({ data: 'Log content', status: 200 });

      const result = await service.getRunLogs('client-uuid', 'agent-uuid', '789');

      expect(result).toBe('Log content');
    });
  });

  describe('listRunJobs', () => {
    it('should list run jobs', async () => {
      const mockJobs: JobResponseDto[] = [
        {
          id: '1',
          name: 'Build',
          status: 'completed',
          conclusion: 'success',
          startedAt: new Date(),
          completedAt: new Date(),
        },
      ];

      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({ data: mockJobs, status: 200 });

      const result = await service.listRunJobs('client-uuid', 'agent-uuid', '789');

      expect(result).toEqual(mockJobs);
    });
  });

  describe('getJobLogs', () => {
    it('should get job logs', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({ data: 'Job log content', status: 200 });

      const result = await service.getJobLogs('client-uuid', 'agent-uuid', '789', '1');

      expect(result).toBe('Job log content');
    });
  });

  describe('cancelRun', () => {
    it('should cancel run', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({ data: {}, status: 200 });

      await service.cancelRun('client-uuid', 'agent-uuid', '789');

      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          url: 'https://example.com/api/api/agents/agent-uuid/deployments/runs/789/cancel',
        }),
      );
    });
  });

  describe('error handling', () => {
    it('should handle axios errors', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      const error = new Error('Network error') as AxiosError;

      mockedAxios.request.mockRejectedValue(error);

      await expect(service.getConfiguration('client-uuid', 'agent-uuid')).rejects.toThrow(BadRequestException);
    });

    it('should handle 400 errors', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        data: { message: 'Bad request' },
        status: 400,
      });

      await expect(service.getConfiguration('client-uuid', 'agent-uuid')).rejects.toThrow(BadRequestException);
    });
  });
});
