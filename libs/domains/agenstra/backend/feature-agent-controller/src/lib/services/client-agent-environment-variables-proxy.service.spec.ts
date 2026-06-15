import {
  CreateEnvironmentVariableDto,
  EnvironmentVariableResponseDto,
  UpdateEnvironmentVariableDto,
} from '@forepath/agenstra/backend/feature-agent-manager';
import { AuthenticationType, ClientEntity } from '@forepath/identity/backend';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import axios, { AxiosError } from 'axios';

import { ClientsRepository } from '../repositories/clients.repository';

import { ClientAgentEnvironmentVariablesProxyService } from './client-agent-environment-variables-proxy.service';
import { ClientsService } from './clients.service';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('ClientAgentEnvironmentVariablesProxyService', () => {
  let service: ClientAgentEnvironmentVariablesProxyService;
  let clientsService: jest.Mocked<ClientsService>;
  let clientsRepository: jest.Mocked<ClientsRepository>;
  const mockClientId = 'test-client-uuid';
  const mockAgentId = 'test-agent-uuid';
  const mockEnvVarId = 'test-env-var-uuid';
  const mockClientEntity: ClientEntity = {
    id: mockClientId,
    name: 'Test Client',
    description: 'Test Description',
    endpoint: 'https://example.com/api',
    authenticationType: AuthenticationType.API_KEY,
    apiKey: 'test-api-key',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };
  const mockEnvironmentVariable: EnvironmentVariableResponseDto = {
    id: mockEnvVarId,
    agentId: mockAgentId,
    variable: 'API_KEY',
    content: 'secret-api-key-value',
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
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientAgentEnvironmentVariablesProxyService,
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

    service = module.get<ClientAgentEnvironmentVariablesProxyService>(ClientAgentEnvironmentVariablesProxyService);
    clientsService = module.get(ClientsService);
    clientsRepository = module.get(ClientsRepository);

    jest.clearAllMocks();
  });

  describe('getEnvironmentVariables', () => {
    it('should proxy get environment variables request successfully with API_KEY auth', async () => {
      const mockEnvVars: EnvironmentVariableResponseDto[] = [mockEnvironmentVariable];

      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        status: 200,
        data: mockEnvVars,
      } as any);

      const result = await service.getEnvironmentVariables(mockClientId, mockAgentId, 50, 0);

      expect(result).toEqual(mockEnvVars);
      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          params: { limit: 50, offset: 0 },
        }),
      );
    });

    it('should use default pagination parameters', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        status: 200,
        data: [],
      } as any);

      await service.getEnvironmentVariables(mockClientId, mockAgentId);

      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          params: { limit: 50, offset: 0 },
        }),
      );
    });

    it('should throw NotFoundException on 404 response', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        status: 404,
        data: { message: 'Agent not found' },
      } as any);

      await expect(service.getEnvironmentVariables(mockClientId, mockAgentId)).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException on 400 response', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        status: 400,
        data: { message: 'Invalid request' },
      } as any);

      await expect(service.getEnvironmentVariables(mockClientId, mockAgentId)).rejects.toThrow(BadRequestException);
    });
  });

  describe('countEnvironmentVariables', () => {
    it('should proxy count environment variables request successfully', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        status: 200,
        data: { count: 5 },
      } as any);

      const result = await service.countEnvironmentVariables(mockClientId, mockAgentId);

      expect(result).toEqual({ count: 5 });
      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          url: expect.stringContaining(`/api/agents/${mockAgentId}/environment/count`),
        }),
      );
    });
  });

  describe('createEnvironmentVariable', () => {
    it('should proxy create environment variable request successfully', async () => {
      const createDto: CreateEnvironmentVariableDto = {
        variable: 'API_KEY',
        content: 'secret-api-key-value',
      };

      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        status: 201,
        data: mockEnvironmentVariable,
      } as any);

      const result = await service.createEnvironmentVariable(mockClientId, mockAgentId, createDto);

      expect(result).toEqual(mockEnvironmentVariable);
      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          data: createDto,
        }),
      );
    });
  });

  describe('updateEnvironmentVariable', () => {
    it('should proxy update environment variable request successfully', async () => {
      const updateDto: UpdateEnvironmentVariableDto = {
        variable: 'UPDATED_API_KEY',
        content: 'updated-secret-value',
      };
      const updatedEnvVar: EnvironmentVariableResponseDto = {
        ...mockEnvironmentVariable,
        variable: 'UPDATED_API_KEY',
        content: 'updated-secret-value',
      };

      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        status: 200,
        data: updatedEnvVar,
      } as any);

      const result = await service.updateEnvironmentVariable(mockClientId, mockAgentId, mockEnvVarId, updateDto);

      expect(result).toEqual(updatedEnvVar);
      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'PUT',
          url: expect.stringContaining(`/api/agents/${mockAgentId}/environment/${mockEnvVarId}`),
          data: updateDto,
        }),
      );
    });
  });

  describe('deleteEnvironmentVariable', () => {
    it('should proxy delete environment variable request successfully', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        status: 204,
        data: undefined,
      } as any);

      await service.deleteEnvironmentVariable(mockClientId, mockAgentId, mockEnvVarId);

      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'DELETE',
          url: expect.stringContaining(`/api/agents/${mockAgentId}/environment/${mockEnvVarId}`),
        }),
      );
    });
  });

  describe('deleteAllEnvironmentVariables', () => {
    it('should proxy delete all environment variables request successfully', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        status: 200,
        data: { deletedCount: 3 },
      } as any);

      const result = await service.deleteAllEnvironmentVariables(mockClientId, mockAgentId);

      expect(result).toEqual({ deletedCount: 3 });
      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'DELETE',
        }),
      );
    });
  });

  describe('authentication', () => {
    it('should use API key for API_KEY authentication type', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        status: 200,
        data: [],
      } as any);

      await service.getEnvironmentVariables(mockClientId, mockAgentId);

      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key',
          }),
        }),
      );
    });

    it('should use Keycloak token for KEYCLOAK authentication type', async () => {
      const keycloakClient: ClientEntity = {
        ...mockClientEntity,
        authenticationType: AuthenticationType.KEYCLOAK,
      };

      clientsRepository.findByIdOrThrow.mockResolvedValue(keycloakClient);
      clientsService.getAccessToken.mockResolvedValue('keycloak-token');
      mockedAxios.request.mockResolvedValue({
        status: 200,
        data: [],
      } as any);

      await service.getEnvironmentVariables(mockClientId, mockAgentId);

      expect(clientsService.getAccessToken).toHaveBeenCalledWith(mockClientId);
      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer keycloak-token',
          }),
        }),
      );
    });

    it('should throw BadRequestException when API key is missing', async () => {
      const clientWithoutApiKey: ClientEntity = {
        ...mockClientEntity,
        apiKey: undefined,
      };

      clientsRepository.findByIdOrThrow.mockResolvedValue(clientWithoutApiKey);

      await expect(service.getEnvironmentVariables(mockClientId, mockAgentId)).rejects.toThrow(BadRequestException);
      expect(mockedAxios.request).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should handle axios network errors', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);

      const axiosError = new Error('Network error') as AxiosError;

      axiosError.request = {};
      mockedAxios.request.mockRejectedValue(axiosError);

      await expect(service.getEnvironmentVariables(mockClientId, mockAgentId)).rejects.toThrow(BadRequestException);
    });

    it('should handle axios response errors', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);

      const axiosError = new Error('Request failed') as AxiosError;

      axiosError.response = {
        status: 500,
        data: { message: 'Internal server error' },
      } as any;
      mockedAxios.request.mockRejectedValue(axiosError);

      await expect(service.getEnvironmentVariables(mockClientId, mockAgentId)).rejects.toThrow(BadRequestException);
    });
  });
});
