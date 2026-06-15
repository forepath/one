import {
  CreateRegexFilterRuleDto,
  RegexFilterRuleResponseDto,
  UpdateRegexFilterRuleDto,
} from '@forepath/agenstra/backend/feature-agent-manager';
import { AuthenticationType, ClientEntity } from '@forepath/identity/backend';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import axios, { AxiosError } from 'axios';

import { ClientsRepository } from '../repositories/clients.repository';

import { AgentManagerFilterRulesClientService } from './agent-manager-filter-rules-client.service';
import { ClientsService } from './clients.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('AgentManagerFilterRulesClientService', () => {
  let service: AgentManagerFilterRulesClientService;
  const mockClientId = '11111111-1111-1111-1111-111111111111';
  const mockManagerRuleId = '22222222-2222-2222-2222-222222222222';
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
  const createDto: CreateRegexFilterRuleDto = {
    pattern: 'foo',
    direction: 'incoming',
    filterType: 'none',
  };
  const mockRuleResponse: RegexFilterRuleResponseDto = {
    id: mockManagerRuleId,
    pattern: 'foo',
    regexFlags: 'g',
    direction: 'incoming',
    filterType: 'none',
    priority: 0,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
  const mockClientsService = {
    getAccessToken: jest.fn(),
  };
  const mockClientsRepository = {
    findByIdOrThrow: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentManagerFilterRulesClientService,
        { provide: ClientsService, useValue: mockClientsService },
        { provide: ClientsRepository, useValue: mockClientsRepository },
      ],
    }).compile();

    service = module.get(AgentManagerFilterRulesClientService);
  });

  describe('createRule', () => {
    it('should POST to agent-manager agents-filters with API key auth', async () => {
      mockClientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        status: 201,
        data: mockRuleResponse,
      } as never);

      const result = await service.createRule(mockClientId, createDto);

      expect(result).toEqual(mockRuleResponse);
      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          url: 'https://example.com/api/api/agents-filters',
          data: createDto,
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key',
          }),
        }),
      );
    });

    it('should use Keycloak token when authentication type is KEYCLOAK', async () => {
      const keycloakClient: ClientEntity = {
        ...mockClientEntity,
        authenticationType: AuthenticationType.KEYCLOAK,
      };

      mockClientsRepository.findByIdOrThrow.mockResolvedValue(keycloakClient);
      mockClientsService.getAccessToken.mockResolvedValue('kc-token');
      mockedAxios.request.mockResolvedValue({
        status: 201,
        data: mockRuleResponse,
      } as never);

      await service.createRule(mockClientId, createDto);

      expect(mockClientsService.getAccessToken).toHaveBeenCalledWith(mockClientId);
      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer kc-token',
          }),
        }),
      );
    });

    it('should throw NotFoundException when manager returns 404', async () => {
      mockClientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        status: 404,
        data: { message: 'Rule not found' },
      } as never);

      await expect(service.createRule(mockClientId, createDto)).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when manager returns 400', async () => {
      mockClientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        status: 400,
        data: { message: 'Invalid regex' },
      } as never);

      await expect(service.createRule(mockClientId, createDto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateRule', () => {
    it('should PUT to agent-manager with rule id in path', async () => {
      const updateDto: UpdateRegexFilterRuleDto = { pattern: 'bar' };
      const updated: RegexFilterRuleResponseDto = { ...mockRuleResponse, pattern: 'bar' };

      mockClientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        status: 200,
        data: updated,
      } as never);

      const result = await service.updateRule(mockClientId, mockManagerRuleId, updateDto);

      expect(result).toEqual(updated);
      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'PUT',
          url: `https://example.com/api/api/agents-filters/${mockManagerRuleId}`,
          data: updateDto,
        }),
      );
    });
  });

  describe('deleteRule', () => {
    it('should DELETE rule on agent-manager', async () => {
      mockClientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        status: 204,
        data: undefined,
      } as never);

      await service.deleteRule(mockClientId, mockManagerRuleId);

      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'DELETE',
          url: `https://example.com/api/api/agents-filters/${mockManagerRuleId}`,
        }),
      );
    });
  });

  describe('authentication', () => {
    it('should throw BadRequestException when API key is missing for API_KEY client', async () => {
      const clientWithoutKey: ClientEntity = {
        ...mockClientEntity,
        apiKey: undefined,
      };

      mockClientsRepository.findByIdOrThrow.mockResolvedValue(clientWithoutKey);

      await expect(service.createRule(mockClientId, createDto)).rejects.toThrow(BadRequestException);
      expect(mockedAxios.request).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should map axios errors without response to BadRequestException', async () => {
      mockClientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      const axiosError = new Error('Network error') as AxiosError;

      mockedAxios.request.mockRejectedValue(axiosError);

      await expect(service.createRule(mockClientId, createDto)).rejects.toThrow(BadRequestException);
    });

    it('should map axios response errors with 404 to NotFoundException', async () => {
      mockClientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      const axiosError = new Error('Not found') as AxiosError;

      axiosError.response = {
        status: 404,
        data: { message: 'Missing' },
      } as never;
      mockedAxios.request.mockRejectedValue(axiosError);

      await expect(service.createRule(mockClientId, createDto)).rejects.toThrow(NotFoundException);
    });
  });
});
