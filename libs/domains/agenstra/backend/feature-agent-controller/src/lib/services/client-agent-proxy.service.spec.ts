import {
  AgentModelsResponseDto,
  AgentResponseDto,
  ContainerType,
  CreateAgentDto,
  CreateAgentResponseDto,
  GitRepositorySetupMode,
  UpdateAgentDto,
} from '@forepath/agenstra/backend/feature-agent-manager';
import { AuthenticationType, ClientAgentCredentialsService, ClientEntity } from '@forepath/identity/backend';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import axios, { AxiosError } from 'axios';

import { ClientsRepository } from '../repositories/clients.repository';
import { AgenstraSearchIndexService } from '../search/agenstra-search-index.service';

import { ClientAgentProxyService } from './client-agent-proxy.service';
import { ClientsService } from './clients.service';
import { StatisticsService } from './statistics.service';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('ClientAgentProxyService', () => {
  let service: ClientAgentProxyService;
  let clientsService: jest.Mocked<ClientsService>;
  let clientsRepository: jest.Mocked<ClientsRepository>;
  let credentialsService: jest.Mocked<ClientAgentCredentialsService>;
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
  const mockAgentResponse: AgentResponseDto = {
    id: 'agent-uuid',
    name: 'Test Agent',
    description: 'Test Agent Description',
    agentType: 'opencode',
    containerType: ContainerType.GENERIC,
    chats: [],
    primaryChatId: 'primary-chat-uuid',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };
  const mockCreateAgentResponse: CreateAgentResponseDto = {
    ...mockAgentResponse,
    password: 'generated-password-123',
  };
  const mockClientsService = {
    findOne: jest.fn(),
    getAccessToken: jest.fn(),
  };
  const mockClientsRepository = {
    findByIdOrThrow: jest.fn(),
  };
  const mockCredentialsService = {
    saveCredentials: jest.fn(),
    deleteCredentials: jest.fn(),
  };
  const mockStatisticsService = {
    recordEntityCreated: jest.fn().mockResolvedValue(undefined),
    recordEntityUpdated: jest.fn().mockResolvedValue(undefined),
    recordEntityDeleted: jest.fn().mockResolvedValue(undefined),
  };
  const mockSearchIndex = {
    isEnabled: jest.fn().mockReturnValue(false),
    searchIds: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientAgentProxyService,
        {
          provide: ClientsService,
          useValue: mockClientsService,
        },
        {
          provide: ClientsRepository,
          useValue: mockClientsRepository,
        },
        {
          provide: ClientAgentCredentialsService,
          useValue: mockCredentialsService,
        },
        {
          provide: StatisticsService,
          useValue: mockStatisticsService,
        },
        {
          provide: AgenstraSearchIndexService,
          useValue: mockSearchIndex,
        },
      ],
    }).compile();

    service = module.get<ClientAgentProxyService>(ClientAgentProxyService);
    clientsService = module.get(ClientsService);
    clientsRepository = module.get(ClientsRepository);
    credentialsService = module.get(ClientAgentCredentialsService);

    // Reset mocks
    jest.clearAllMocks();
    mockedAxios.request.mockClear();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getClientEnvironmentProgress', () => {
    it('should proxy GET /progress to the agent-manager', async () => {
      const operations = [{ operationId: 'op-1', agentName: 'Env', progress: 10 }];

      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        data: operations,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      });

      const result = await service.getClientEnvironmentProgress('client-uuid');

      expect(result).toEqual(operations);
      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'GET', url: 'https://example.com/api/api/agents/progress' }),
      );
    });

    it('should return an empty list when the manager responds with a non-array body', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        data: '',
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      });

      await expect(service.getClientEnvironmentProgress('client-uuid')).resolves.toEqual([]);
    });
  });

  describe('getClientAgents', () => {
    it('should return array of agents for API_KEY client', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        data: [mockAgentResponse],
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      });

      const result = await service.getClientAgents('client-uuid', 10, 0);

      expect(result).toEqual([mockAgentResponse]);
      expect(clientsRepository.findByIdOrThrow).toHaveBeenCalledWith('client-uuid');
      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          url: 'https://example.com/api/api/agents',
          params: { limit: 10, offset: 0 },
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key-123',
            'Content-Type': 'application/json',
          }),
        }),
      );
    });

    it('should return array of agents for KEYCLOAK client', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockKeycloakClientEntity);
      clientsService.getAccessToken.mockResolvedValue('keycloak-jwt-token');
      mockedAxios.request.mockResolvedValue({
        data: [mockAgentResponse],
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      });

      const result = await service.getClientAgents('client-uuid', 10, 0);

      expect(result).toEqual([mockAgentResponse]);
      expect(clientsService.getAccessToken).toHaveBeenCalledWith('client-uuid');
      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer keycloak-jwt-token',
          }),
        }),
      );
    });

    it('should handle 404 error', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      const axiosError = {
        response: {
          status: 404,
          data: { message: 'Agent not found' },
        },
        message: 'Not Found',
      } as AxiosError;

      mockedAxios.request.mockRejectedValue(axiosError);

      await expect(service.getClientAgents('client-uuid', 10, 0)).rejects.toThrow(NotFoundException);
      await expect(service.getClientAgents('client-uuid', 10, 0)).rejects.toThrow('Agent not found');
    });

    it('should handle 400 error', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        data: { message: 'Invalid request' },
        status: 400,
        statusText: 'Bad Request',
        headers: {},
        config: {} as any,
      });

      await expect(service.getClientAgents('client-uuid', 10, 0)).rejects.toThrow(BadRequestException);
      await expect(service.getClientAgents('client-uuid', 10, 0)).rejects.toThrow('Invalid request');
    });

    it('should pass gVisor runtime failures through with their machine-readable code', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        data: {
          statusCode: 400,
          error: 'Bad Request',
          message: 'The sandboxed-kvm (gVisor on KVM) container could not be started: boom',
          code: 'E_ISOLATION_RUNTIME_FAILED',
          isolationLevel: 'sandboxed-kvm',
          extra: 'not forwarded',
        },
        status: 400,
        statusText: 'Bad Request',
        headers: {},
        config: {} as any,
      });

      const error = (await service
        .getClientAgents('client-uuid', 10, 0)
        .catch((e: unknown) => e)) as BadRequestException;

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.message).toBe('The sandboxed-kvm (gVisor on KVM) container could not be started: boom');
      expect(error.getResponse()).toEqual({
        statusCode: 400,
        error: 'Bad Request',
        message: 'The sandboxed-kvm (gVisor on KVM) container could not be started: boom',
        code: 'E_ISOLATION_RUNTIME_FAILED',
        isolationLevel: 'sandboxed-kvm',
      });
    });

    it('should not forward unknown codes or levels of other 400 errors', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        data: { message: 'Invalid request', code: 'E_SOMETHING_ELSE' },
        status: 400,
        statusText: 'Bad Request',
        headers: {},
        config: {} as any,
      });

      const error = (await service
        .getClientAgents('client-uuid', 10, 0)
        .catch((e: unknown) => e)) as BadRequestException;

      expect(error.getResponse()).toEqual(expect.not.objectContaining({ code: expect.anything() }));

      mockedAxios.request.mockResolvedValue({
        data: { message: 'x', code: 'E_ISOLATION_RUNTIME_FAILED', isolationLevel: '<script>' },
        status: 400,
        statusText: 'Bad Request',
        headers: {},
        config: {} as any,
      });

      const unknownLevel = (await service
        .getClientAgents('client-uuid', 10, 0)
        .catch((e: unknown) => e)) as BadRequestException;

      expect(unknownLevel.getResponse()).toEqual(expect.not.objectContaining({ isolationLevel: expect.anything() }));
    });

    it('should map 409 conflicts (e.g. stale isolation selections)', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        data: { message: 'stale capability revision' },
        status: 409,
        statusText: 'Conflict',
        headers: {},
        config: {} as any,
      });

      await expect(service.getClientAgents('client-uuid', 10, 0)).rejects.toThrow(ConflictException);
      await expect(service.getClientAgents('client-uuid', 10, 0)).rejects.toThrow('stale capability revision');
    });

    it('should handle connection error', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      const axiosError = {
        request: {},
        message: 'Network Error',
      } as AxiosError;

      mockedAxios.request.mockRejectedValue(axiosError);

      await expect(service.getClientAgents('client-uuid', 10, 0)).rejects.toThrow(BadRequestException);
      await expect(service.getClientAgents('client-uuid', 10, 0)).rejects.toThrow('Failed to connect');
    });
  });

  describe('isolation capabilities', () => {
    it('reads and re-probes the agent manager isolation capabilities', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        data: { revision: 'sha256:x' },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      });

      await expect(service.getClientIsolation('client-uuid')).resolves.toEqual({ revision: 'sha256:x' });
      expect(mockedAxios.request).toHaveBeenLastCalledWith(
        expect.objectContaining({ method: 'GET', url: expect.stringMatching(/\/api\/isolation$/), timeout: 10_000 }),
      );

      await service.probeClientIsolation('client-uuid');
      expect(mockedAxios.request).toHaveBeenLastCalledWith(
        expect.objectContaining({ method: 'POST', url: expect.stringMatching(/\/api\/isolation\/probe$/) }),
      );
    });
  });

  describe('getClientAgent', () => {
    it('should return single agent', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        data: mockAgentResponse,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      });

      const result = await service.getClientAgent('client-uuid', 'agent-uuid');

      expect(result).toEqual(mockAgentResponse);
      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          url: 'https://example.com/api/api/agents/agent-uuid',
        }),
      );
    });

    it('should handle 404 error', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        data: { message: 'Agent not found' },
        status: 404,
        statusText: 'Not Found',
        headers: {},
        config: {} as any,
      });

      await expect(service.getClientAgent('client-uuid', 'agent-uuid')).rejects.toThrow(NotFoundException);
    });
  });

  describe('listClientAgentModels', () => {
    it('should return models map from remote agent-manager', async () => {
      const models: AgentModelsResponseDto = { 'm-1': 'Model One', 'm-2': 'Model Two' };

      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        data: models,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      });

      const result = await service.listClientAgentModels('client-uuid', 'agent-uuid');

      expect(result).toEqual(models);
      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          url: 'https://example.com/api/api/agents/agent-uuid/models',
        }),
      );
    });
  });

  describe('createClientAgent', () => {
    it('should create new agent and persist credentials', async () => {
      const createDto: CreateAgentDto = {
        name: 'New Agent',
        description: 'New Agent Description',
      };

      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        data: mockCreateAgentResponse,
        status: 201,
        statusText: 'Created',
        headers: {},
        config: {} as any,
      });

      const result = await service.createClientAgent('client-uuid', createDto);

      expect(result).toEqual(mockCreateAgentResponse);
      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          url: 'https://example.com/api/api/agents',
          data: createDto,
        }),
      );
      expect(credentialsService.saveCredentials).toHaveBeenCalledWith(
        'client-uuid',
        mockCreateAgentResponse.id,
        mockCreateAgentResponse.password,
      );
    });
    it('should forward gitRepositorySetupMode when creating an agent', async () => {
      const createDto: CreateAgentDto = {
        name: 'Empty Agent',
        gitRepositorySetupMode: GitRepositorySetupMode.EMPTY,
      };

      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        data: mockCreateAgentResponse,
        status: 201,
        statusText: 'Created',
        headers: {},
        config: {} as any,
      });

      await service.createClientAgent('client-uuid', createDto);

      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          data: createDto,
        }),
      );
    });
  });

  describe('updateClientAgent', () => {
    it('should update agent', async () => {
      const updateDto: UpdateAgentDto = {
        name: 'Updated Agent',
      };

      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        data: mockAgentResponse,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      });

      const result = await service.updateClientAgent('client-uuid', 'agent-uuid', updateDto);

      expect(result).toEqual(mockAgentResponse);
      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          url: 'https://example.com/api/api/agents/agent-uuid',
          data: updateDto,
        }),
      );
    });
  });

  describe('deleteClientAgent', () => {
    it('should delete agent and cleanup credentials', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        data: undefined,
        status: 204,
        statusText: 'No Content',
        headers: {},
        config: {} as any,
      });

      await service.deleteClientAgent('client-uuid', 'agent-uuid');

      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'DELETE',
          url: 'https://example.com/api/api/agents/agent-uuid',
        }),
      );
      // credentials cleanup
      const credentialsService = (service as any)['clientAgentCredentialsService'] as {
        deleteCredentials: jest.Mock;
      };

      expect(credentialsService.deleteCredentials).toHaveBeenCalledWith('client-uuid', 'agent-uuid');
    });
  });

  describe('startClientAgent', () => {
    it('should start agent and return agent response', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        data: mockAgentResponse,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      });

      const result = await service.startClientAgent('client-uuid', 'agent-uuid');

      expect(result).toEqual(mockAgentResponse);
      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          url: 'https://example.com/api/api/agents/agent-uuid/start',
        }),
      );
    });
  });

  describe('stopClientAgent', () => {
    it('should stop agent and return agent response', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        data: mockAgentResponse,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      });

      const result = await service.stopClientAgent('client-uuid', 'agent-uuid');

      expect(result).toEqual(mockAgentResponse);
      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          url: 'https://example.com/api/api/agents/agent-uuid/stop',
        }),
      );
    });
  });

  describe('restartClientAgent', () => {
    it('should restart agent and return agent response', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        data: mockAgentResponse,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      });

      const result = await service.restartClientAgent('client-uuid', 'agent-uuid');

      expect(result).toEqual(mockAgentResponse);
      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          url: 'https://example.com/api/api/agents/agent-uuid/restart',
        }),
      );
    });
  });

  describe('getAuthHeader', () => {
    it('should throw error if API key is missing for API_KEY client', async () => {
      const clientWithoutApiKey: ClientEntity = {
        ...mockClientEntity,
        apiKey: undefined,
      };

      clientsRepository.findByIdOrThrow.mockResolvedValue(clientWithoutApiKey);

      await expect(service.getClientAgents('client-uuid', 10, 0)).rejects.toThrow(BadRequestException);
      await expect(service.getClientAgents('client-uuid', 10, 0)).rejects.toThrow(
        'API key is not configured for this client',
      );
    });

    it('should throw error if Keycloak credentials are missing', async () => {
      const clientWithoutKeycloak: ClientEntity = {
        ...mockKeycloakClientEntity,
        keycloakClientId: undefined,
      };

      clientsRepository.findByIdOrThrow.mockResolvedValue(clientWithoutKeycloak);
      clientsService.getAccessToken.mockRejectedValue(
        new BadRequestException('Keycloak client credentials are not configured'),
      );

      await expect(service.getClientAgents('client-uuid', 10, 0)).rejects.toThrow(BadRequestException);
    });
  });

  describe('buildAgentApiUrl', () => {
    it('should build correct URL with trailing slash', async () => {
      const clientWithTrailingSlash: ClientEntity = {
        ...mockClientEntity,
        endpoint: 'https://example.com/api/',
      };

      clientsRepository.findByIdOrThrow.mockResolvedValue(clientWithTrailingSlash);
      mockedAxios.request.mockResolvedValue({
        data: [mockAgentResponse],
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      });

      await service.getClientAgents('client-uuid', 10, 0);

      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://example.com/api/api/agents',
        }),
      );
    });

    it('should build correct URL without trailing slash', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        data: [mockAgentResponse],
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      });

      await service.getClientAgents('client-uuid', 10, 0);

      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://example.com/api/api/agents',
        }),
      );
    });
  });

  describe('pingClient', () => {
    beforeEach(() => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
    });

    it('reports reachable when the manager health endpoint answers 2xx', async () => {
      mockedAxios.request.mockResolvedValue({
        data: {},
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      });

      await expect(service.pingClient('client-uuid')).resolves.toEqual({
        reachable: true,
        checkedAt: expect.any(String),
      });
      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'GET', url: 'https://example.com/api/api/health', timeout: 5000 }),
      );
      // Public health endpoint: no workspace credentials are sent.
      expect(mockedAxios.request.mock.calls[0][0]).not.toHaveProperty('headers');
    });

    it('reports unreachable on HTTP errors without throwing', async () => {
      mockedAxios.request.mockResolvedValue({ data: '', status: 503, statusText: 'x', headers: {}, config: {} as any });

      await expect(service.pingClient('client-uuid')).resolves.toMatchObject({
        reachable: false,
        error: 'Workspace health check failed (HTTP 503)',
      });
    });

    it('reports connection failures and timeouts', async () => {
      mockedAxios.request.mockRejectedValueOnce(
        Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:3000'), { code: 'ECONNREFUSED' }),
      );
      mockedAxios.request.mockRejectedValueOnce(
        Object.assign(new Error('timeout of 5000ms exceeded'), { code: 'ECONNABORTED' }),
      );

      await expect(service.pingClient('client-uuid')).resolves.toMatchObject({
        reachable: false,
        error: 'Failed to connect to client endpoint: connect ECONNREFUSED 10.0.0.1:3000',
      });
      await expect(service.pingClient('client-uuid')).resolves.toMatchObject({
        reachable: false,
        error: 'Workspace did not respond within 5s',
      });
    });

    it('reports unknown workspaces as unreachable instead of throwing', async () => {
      clientsRepository.findByIdOrThrow.mockRejectedValue(new Error('Client with ID client-uuid not found'));

      await expect(service.pingClient('client-uuid')).resolves.toMatchObject({ reachable: false });
      expect(mockedAxios.request).not.toHaveBeenCalled();
    });
  });
});
