/* eslint-disable @typescript-eslint/no-var-requires */
import {
  ChatSessionResponseDto,
  CreateChatSessionDto,
  UpdateChatSessionDto,
} from '@forepath/agenstra/backend/feature-agent-manager';
import { AuthenticationType } from '@forepath/identity/backend';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import axios, { AxiosError, AxiosRequestConfig } from 'axios';

import { AgenstraNotificationPublisher } from '../notifications/agenstra-notification.publisher';
import { ClientsRepository } from '../repositories/clients.repository';
import { getClientEndpointTlsPolicy, validateClientEndpointWithDnsOrThrow } from '../utils/client-endpoint-security';
import { createClientMtlsAuthorizationHeader } from '../utils/client-mtls-authorization';
import { buildClientProxyRequestHeaders } from '../utils/client-proxy-request-headers';

import { ClientsService } from './clients.service';


export type ChatSessionMessageResponse = {
  id: string;
  actor: string;
  message: string;
  filtered: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Service for proxying agent chat session requests to client endpoints.
 * Handles authentication (API key or OIDC client credentials token) and forwards chat session requests to the client's agent-manager service.
 */
@Injectable()
export class ClientAgentChatsProxyService {
  private readonly logger = new Logger(ClientAgentChatsProxyService.name);

  constructor(
    private readonly clientsService: ClientsService,
    private readonly clientsRepository: ClientsRepository,
    private readonly notificationPublisher: AgenstraNotificationPublisher,
  ) {}

  /**
   * Get authentication header for a client.
   * @param clientId - The UUID of the client
   * @returns Authorization header value
   * @throws BadRequestException if client authentication is not properly configured
   */
  private async getAuthHeader(clientId: string): Promise<string> {
    const clientEntity = await this.clientsRepository.findByIdOrThrow(clientId);

    if (clientEntity.authenticationType === AuthenticationType.API_KEY) {
      if (!clientEntity.apiKey) {
        throw new BadRequestException('API key is not configured for this client');
      }

      return `Bearer ${clientEntity.apiKey}`;
    } else if (clientEntity.authenticationType === AuthenticationType.OIDC) {
      const token = await this.clientsService.getAccessToken(clientId);

      return `Bearer ${token}`;
    } else if (clientEntity.authenticationType === AuthenticationType.MTLS) {
      return createClientMtlsAuthorizationHeader(clientEntity);
    } else {
      throw new BadRequestException(`Unsupported authentication type: ${clientEntity.authenticationType}`);
    }
  }

  /**
   * Build the base URL for agent chat session API requests.
   * @param endpoint - The client's endpoint URL
   * @param agentId - The UUID of the agent
   * @returns The base URL for agent chat session API requests
   */
  private buildAgentChatsApiUrl(endpoint: string, agentId: string): string {
    const baseUrl = endpoint.replace(/\/$/, '');

    return `${baseUrl}/api/agents/${agentId}/chats`;
  }

  /**
   * Make an HTTP request to the client's agent-manager service for chat session operations.
   * @param clientId - The UUID of the client
   * @param agentId - The UUID of the agent
   * @param config - Axios request configuration
   * @returns The response data
   * @throws NotFoundException if client or agent is not found
   * @throws BadRequestException if request fails
   */
  private async makeRequest<T>(clientId: string, agentId: string, config: AxiosRequestConfig): Promise<T> {
    const clientEntity = await this.clientsRepository.findByIdOrThrow(clientId);

    await validateClientEndpointWithDnsOrThrow(clientEntity.endpoint);
    const authHeader = await this.getAuthHeader(clientId);
    const baseUrl = this.buildAgentChatsApiUrl(clientEntity.endpoint, agentId);
    const tlsPolicy = getClientEndpointTlsPolicy(this.logger);

    try {
      this.logger.debug(
        `Proxying chat session request to ${baseUrl}${config.url || ''} for client ${clientId}, agent ${agentId}`,
      );

      const response = await axios.request<T>({
        ...config,
        url: config.url ? `${baseUrl}${config.url}` : baseUrl,
        headers: buildClientProxyRequestHeaders(config.headers, authHeader),
        validateStatus: (status) => status < 500,
        httpsAgent: baseUrl.startsWith('https://')
          ? new (require('https').Agent)({
              rejectUnauthorized: tlsPolicy.rejectUnauthorized,
            })
          : undefined,
      });

      if (response.status >= 400) {
        const errorMessage = (response.data as { message?: string })?.message || 'Request failed';

        this.logger.error(
          `Request to ${baseUrl}${config.url || ''} failed with status ${response.status}: ${errorMessage}`,
        );

        if (response.status === 404) {
          throw new NotFoundException(errorMessage);
        } else if (response.status === 400) {
          throw new BadRequestException(errorMessage);
        } else {
          throw new BadRequestException(`Request failed: ${errorMessage}`);
        }
      }

      return response.data;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }

      const axiosError = error as AxiosError;

      if (axiosError.response) {
        const errorMessage =
          (axiosError.response.data as { message?: string })?.message || axiosError.message || 'Request failed';

        this.logger.error(`Request to ${baseUrl}${config.url || ''} failed: ${errorMessage}`, axiosError.response.data);

        if (axiosError.response.status === 404) {
          throw new NotFoundException(errorMessage);
        } else if (axiosError.response.status === 400) {
          throw new BadRequestException(errorMessage);
        } else {
          throw new BadRequestException(`Request failed: ${errorMessage}`);
        }
      } else if (axiosError.request) {
        this.logger.error(`No response received from ${baseUrl}${config.url || ''}: ${axiosError.message}`);
        throw new BadRequestException(`Failed to connect to client endpoint: ${axiosError.message}`);
      } else {
        this.logger.error(`Error setting up request to ${baseUrl}${config.url || ''}: ${axiosError.message}`);
        throw new BadRequestException(`Request setup failed: ${axiosError.message}`);
      }
    }
  }

  /**
   * List chat sessions for an agent with pagination.
   */
  async list(clientId: string, agentId: string, limit = 50, offset = 0): Promise<ChatSessionResponseDto[]> {
    return await this.makeRequest<ChatSessionResponseDto[]>(clientId, agentId, {
      method: 'GET',
      params: { limit, offset },
    });
  }

  /**
   * Get count of chat sessions for an agent.
   */
  async count(clientId: string, agentId: string): Promise<{ count: number }> {
    return await this.makeRequest<{ count: number }>(clientId, agentId, {
      method: 'GET',
      url: '/count',
    });
  }

  /**
   * Create a new user chat session for an agent.
   */
  async create(clientId: string, agentId: string, createDto: CreateChatSessionDto): Promise<ChatSessionResponseDto> {
    const created = await this.makeRequest<ChatSessionResponseDto>(clientId, agentId, {
      method: 'POST',
      data: createDto,
    });

    this.notificationPublisher.publishChatSession('chat_session.created', clientId, created);

    return created;
  }

  /**
   * Get a chat session by ID.
   */
  async get(clientId: string, agentId: string, chatId: string): Promise<ChatSessionResponseDto> {
    return await this.makeRequest<ChatSessionResponseDto>(clientId, agentId, {
      method: 'GET',
      url: `/${chatId}`,
    });
  }

  /**
   * Update a chat session title.
   */
  async update(
    clientId: string,
    agentId: string,
    chatId: string,
    updateDto: UpdateChatSessionDto,
  ): Promise<ChatSessionResponseDto> {
    const updated = await this.makeRequest<ChatSessionResponseDto>(clientId, agentId, {
      method: 'PUT',
      url: `/${chatId}`,
      data: updateDto,
    });

    this.notificationPublisher.publishChatSession('chat_session.updated', clientId, updated);

    return updated;
  }

  /**
   * Delete a chat session by ID.
   */
  async delete(clientId: string, agentId: string, chatId: string): Promise<void> {
    await this.makeRequest<void>(clientId, agentId, {
      method: 'DELETE',
      url: `/${chatId}`,
    });

    this.notificationPublisher.publishChatSession('chat_session.deleted', clientId, {
      id: chatId,
      agentId,
    });
  }

  /**
   * List messages for a chat session with pagination.
   */
  async listMessages(
    clientId: string,
    agentId: string,
    chatId: string,
    limit = 50,
    offset = 0,
  ): Promise<ChatSessionMessageResponse[]> {
    return await this.makeRequest<ChatSessionMessageResponse[]>(clientId, agentId, {
      method: 'GET',
      url: `/${chatId}/messages`,
      params: { limit, offset },
    });
  }
}
