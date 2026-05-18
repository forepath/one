import { LatestAgentMessageDto } from '@forepath/framework/backend/feature-agent-manager';
import { AuthenticationType, ClientEntity } from '@forepath/identity/backend';
import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import axios from 'axios';

import { ClientsRepository } from '../repositories/clients.repository';

import { ClientAgentMessagesProxyService } from './client-agent-messages-proxy.service';
import { ClientsService } from './clients.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('ClientAgentMessagesProxyService', () => {
  let service: ClientAgentMessagesProxyService;
  const mockClientId = 'client-uuid';
  const mockAgentId = 'agent-uuid';
  const mockClientEntity: ClientEntity = {
    id: mockClientId,
    name: 'Test',
    description: '',
    endpoint: 'https://example.com',
    authenticationType: AuthenticationType.API_KEY,
    apiKey: 'test-key',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const mockClientsService = { getAccessToken: jest.fn() };
  const mockClientsRepository = { findByIdOrThrow: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientAgentMessagesProxyService,
        { provide: ClientsService, useValue: mockClientsService },
        { provide: ClientsRepository, useValue: mockClientsRepository },
      ],
    }).compile();

    service = module.get(ClientAgentMessagesProxyService);
    jest.clearAllMocks();
    mockClientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
  });

  describe('getLatestAgentMessage', () => {
    it('proxies GET latest-agent with API key auth', async () => {
      const dto: LatestAgentMessageDto = {
        id: 'msg-1',
        createdAt: '2026-01-01T00:00:00.000Z',
      };

      mockedAxios.request.mockResolvedValue({ status: 200, data: dto } as never);

      const result = await service.getLatestAgentMessage(mockClientId, mockAgentId);

      expect(result).toEqual(dto);
      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          url: `https://example.com/api/agents/${mockAgentId}/messages/latest-agent`,
          headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
        }),
      );
    });

    it('returns null on 404', async () => {
      mockedAxios.request.mockResolvedValue({ status: 404, data: {} } as never);

      const result = await service.getLatestAgentMessage(mockClientId, mockAgentId);

      expect(result).toBeNull();
    });

    it('throws BadRequestException on other 4xx', async () => {
      mockedAxios.request.mockResolvedValue({ status: 400, data: { message: 'bad' } } as never);

      await expect(service.getLatestAgentMessage(mockClientId, mockAgentId)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('returns null on network failure', async () => {
      mockedAxios.request.mockRejectedValue({ message: 'timeout', response: undefined });

      const result = await service.getLatestAgentMessage(mockClientId, mockAgentId);

      expect(result).toBeNull();
    });
  });
});
