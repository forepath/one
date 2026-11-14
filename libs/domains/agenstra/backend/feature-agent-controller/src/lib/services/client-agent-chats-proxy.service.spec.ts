import {
  ChatSessionResponseDto,
  CreateChatSessionDto,
  UpdateChatSessionDto,
} from '@forepath/agenstra/backend/feature-agent-manager';
import { AuthenticationType, ClientEntity } from '@forepath/identity/backend';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import axios, { AxiosError } from 'axios';

import { AgenstraNotificationPublisher } from '../notifications/agenstra-notification.publisher';
import { ClientsRepository } from '../repositories/clients.repository';

import { ClientAgentChatsProxyService } from './client-agent-chats-proxy.service';
import { ClientsService } from './clients.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('ClientAgentChatsProxyService', () => {
  let service: ClientAgentChatsProxyService;
  let clientsService: jest.Mocked<ClientsService>;
  let clientsRepository: jest.Mocked<ClientsRepository>;
  const mockClientId = 'test-client-uuid';
  const mockAgentId = 'test-agent-uuid';
  const mockChatId = 'test-chat-uuid';
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
  const mockChatSession: ChatSessionResponseDto = {
    id: mockChatId,
    agentId: mockAgentId,
    title: 'My chat',
    kind: 'user',
    lastMessageAt: new Date('2024-01-02'),
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };
  const mockClientsService = {
    getAccessToken: jest.fn(),
  };
  const mockClientsRepository = {
    findByIdOrThrow: jest.fn(),
  };
  const mockNotificationPublisher = {
    publishChatSession: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientAgentChatsProxyService,
        {
          provide: ClientsService,
          useValue: mockClientsService,
        },
        {
          provide: ClientsRepository,
          useValue: mockClientsRepository,
        },
        {
          provide: AgenstraNotificationPublisher,
          useValue: mockNotificationPublisher,
        },
      ],
    }).compile();

    service = module.get<ClientAgentChatsProxyService>(ClientAgentChatsProxyService);
    clientsService = module.get(ClientsService);
    clientsRepository = module.get(ClientsRepository);

    jest.clearAllMocks();
  });

  describe('list', () => {
    it('should proxy list chat sessions request successfully with API_KEY auth', async () => {
      const mockSessions: ChatSessionResponseDto[] = [mockChatSession];

      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        status: 200,
        data: mockSessions,
      } as any);

      const result = await service.list(mockClientId, mockAgentId, 50, 0);

      expect(result).toEqual(mockSessions);
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

      await service.list(mockClientId, mockAgentId);

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

      await expect(service.list(mockClientId, mockAgentId)).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException on 400 response', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        status: 400,
        data: { message: 'Invalid request' },
      } as any);

      await expect(service.list(mockClientId, mockAgentId)).rejects.toThrow(BadRequestException);
    });
  });

  describe('count', () => {
    it('should proxy count chat sessions request successfully', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        status: 200,
        data: { count: 5 },
      } as any);

      const result = await service.count(mockClientId, mockAgentId);

      expect(result).toEqual({ count: 5 });
      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          url: expect.stringContaining(`/api/agents/${mockAgentId}/chats/count`),
        }),
      );
    });
  });

  describe('create', () => {
    it('should proxy create chat session request successfully', async () => {
      const createDto: CreateChatSessionDto = {
        title: 'My chat',
      };

      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        status: 201,
        data: mockChatSession,
      } as any);

      const result = await service.create(mockClientId, mockAgentId, createDto);

      expect(result).toEqual(mockChatSession);
      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          data: createDto,
        }),
      );
      expect(mockNotificationPublisher.publishChatSession).toHaveBeenCalledWith(
        'chat_session.created',
        mockClientId,
        mockChatSession,
      );
    });
  });

  describe('get', () => {
    it('should proxy get chat session request successfully', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        status: 200,
        data: mockChatSession,
      } as any);

      const result = await service.get(mockClientId, mockAgentId, mockChatId);

      expect(result).toEqual(mockChatSession);
      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          url: expect.stringContaining(`/api/agents/${mockAgentId}/chats/${mockChatId}`),
        }),
      );
    });
  });

  describe('update', () => {
    it('should proxy update chat session request successfully', async () => {
      const updateDto: UpdateChatSessionDto = {
        title: 'Renamed chat',
      };
      const updatedSession: ChatSessionResponseDto = {
        ...mockChatSession,
        title: 'Renamed chat',
      };

      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        status: 200,
        data: updatedSession,
      } as any);

      const result = await service.update(mockClientId, mockAgentId, mockChatId, updateDto);

      expect(result).toEqual(updatedSession);
      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'PUT',
          url: expect.stringContaining(`/api/agents/${mockAgentId}/chats/${mockChatId}`),
          data: updateDto,
        }),
      );
      expect(mockNotificationPublisher.publishChatSession).toHaveBeenCalledWith(
        'chat_session.updated',
        mockClientId,
        updatedSession,
      );
    });
  });

  describe('delete', () => {
    it('should proxy delete chat session request successfully', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        status: 204,
        data: undefined,
      } as any);

      await service.delete(mockClientId, mockAgentId, mockChatId);

      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'DELETE',
          url: expect.stringContaining(`/api/agents/${mockAgentId}/chats/${mockChatId}`),
        }),
      );
      expect(mockNotificationPublisher.publishChatSession).toHaveBeenCalledWith('chat_session.deleted', mockClientId, {
        id: mockChatId,
        agentId: mockAgentId,
      });
    });
  });

  describe('listMessages', () => {
    it('should proxy list chat session messages request successfully', async () => {
      const mockMessages = [
        {
          id: 'msg-1',
          actor: 'user',
          message: 'Hello',
          filtered: false,
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        },
      ];

      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);
      mockedAxios.request.mockResolvedValue({
        status: 200,
        data: mockMessages,
      } as any);

      const result = await service.listMessages(mockClientId, mockAgentId, mockChatId, 50, 0);

      expect(result).toEqual(mockMessages);
      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          url: expect.stringContaining(`/api/agents/${mockAgentId}/chats/${mockChatId}/messages`),
          params: { limit: 50, offset: 0 },
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

      await service.list(mockClientId, mockAgentId);

      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key',
          }),
        }),
      );
    });

    it('should use OIDC token for OIDC authentication type', async () => {
      const oidcClient: ClientEntity = {
        ...mockClientEntity,
        authenticationType: AuthenticationType.OIDC,
      };

      clientsRepository.findByIdOrThrow.mockResolvedValue(oidcClient);
      clientsService.getAccessToken.mockResolvedValue('oidc-token');
      mockedAxios.request.mockResolvedValue({
        status: 200,
        data: [],
      } as any);

      await service.list(mockClientId, mockAgentId);

      expect(clientsService.getAccessToken).toHaveBeenCalledWith(mockClientId);
      expect(mockedAxios.request).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer oidc-token',
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

      await expect(service.list(mockClientId, mockAgentId)).rejects.toThrow(BadRequestException);
      expect(mockedAxios.request).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should handle axios network errors', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);

      const axiosError = new Error('Network error') as AxiosError;

      axiosError.request = {};
      mockedAxios.request.mockRejectedValue(axiosError);

      await expect(service.list(mockClientId, mockAgentId)).rejects.toThrow(BadRequestException);
    });

    it('should handle axios response errors', async () => {
      clientsRepository.findByIdOrThrow.mockResolvedValue(mockClientEntity);

      const axiosError = new Error('Request failed') as AxiosError;

      axiosError.response = {
        status: 500,
        data: { message: 'Internal server error' },
      } as any;
      mockedAxios.request.mockRejectedValue(axiosError);

      await expect(service.list(mockClientId, mockAgentId)).rejects.toThrow(BadRequestException);
    });
  });
});
