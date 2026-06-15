/* eslint-disable @typescript-eslint/no-var-requires */
import {
  AgentModelsResponseDto,
  AgentResponseDto,
  ConfigResponseDto,
  CreateAgentDto,
  CreateAgentResponseDto,
  UpdateAgentDto,
} from '@forepath/agenstra/backend/feature-agent-manager';
import { AuthenticationType, ClientAgentCredentialsService } from '@forepath/identity/backend';
import { BadRequestException, forwardRef, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import axios, { AxiosError, AxiosRequestConfig } from 'axios';

import { StatisticsEntityType } from '../entities/statistics-entity-event.entity';
import { ClientsRepository } from '../repositories/clients.repository';
import { getClientEndpointTlsPolicy, validateClientEndpointWithDnsOrThrow } from '../utils/client-endpoint-security';
import { buildClientProxyRequestHeaders } from '../utils/client-proxy-request-headers';

import { ClientsService } from './clients.service';
import { StatisticsService } from './statistics.service';

/**
 * Service for proxying agent management requests to client endpoints.
 * Handles authentication (API key or Keycloak JWT) and forwards requests to the client's agent-manager service.
 */
@Injectable()
export class ClientAgentProxyService {
  private readonly logger = new Logger(ClientAgentProxyService.name);

  constructor(
    @Inject(forwardRef(() => ClientsService))
    private readonly clientsService: ClientsService,
    private readonly clientsRepository: ClientsRepository,
    private readonly clientAgentCredentialsService: ClientAgentCredentialsService,
    private readonly statisticsService: StatisticsService,
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
    } else if (clientEntity.authenticationType === AuthenticationType.KEYCLOAK) {
      const token = await this.clientsService.getAccessToken(clientId);

      return `Bearer ${token}`;
    } else {
      throw new BadRequestException(`Unsupported authentication type: ${clientEntity.authenticationType}`);
    }
  }

  /**
   * Build the base URL for agent API requests.
   * @param endpoint - The client's endpoint URL
   * @returns The base URL for agent API requests
   */
  private buildAgentApiUrl(endpoint: string): string {
    // Remove trailing slash if present
    const baseUrl = endpoint.replace(/\/$/, '');

    // Ensure /api/agents path
    return `${baseUrl}/api/agents`;
  }

  /**
   * Build the base URL for config API requests.
   * @param endpoint - The client's endpoint URL
   * @returns The base URL for config API requests
   */
  private buildConfigApiUrl(endpoint: string): string {
    // Remove trailing slash if present
    const baseUrl = endpoint.replace(/\/$/, '');

    // Ensure /api/config path
    return `${baseUrl}/api/config`;
  }

  /**
   * Make an HTTP request to the client's agent-manager service.
   * @param clientId - The UUID of the client
   * @param config - Axios request configuration
   * @returns The response data
   * @throws NotFoundException if client is not found
   * @throws BadRequestException if request fails
   */
  private async makeRequest<T>(clientId: string, config: AxiosRequestConfig): Promise<T> {
    const clientEntity = await this.clientsRepository.findByIdOrThrow(clientId);

    await validateClientEndpointWithDnsOrThrow(clientEntity.endpoint);
    const authHeader = await this.getAuthHeader(clientId);
    const baseUrl = this.buildAgentApiUrl(clientEntity.endpoint);
    const tlsPolicy = getClientEndpointTlsPolicy(this.logger);

    try {
      this.logger.debug(`Proxying request to ${baseUrl}${config.url || ''} for client ${clientId}`);

      const response = await axios.request<T>({
        ...config,
        url: config.url ? `${baseUrl}${config.url}` : baseUrl,
        headers: buildClientProxyRequestHeaders(config.headers, authHeader),
        validateStatus: (status) => status < 500, // Don't throw on 4xx errors
        timeout: process.env.REQUEST_TIMEOUT ? parseInt(process.env.REQUEST_TIMEOUT) : 600000, // 10 minutes timeout for long-running processes
        httpsAgent: baseUrl.startsWith('https://')
          ? new (require('https').Agent)({
              rejectUnauthorized: tlsPolicy.rejectUnauthorized,
            })
          : undefined,
      });

      // Handle error responses
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
        // Check for timeout errors
        if (axiosError.code === 'ECONNABORTED' || axiosError.message?.includes('timeout')) {
          this.logger.error(
            `Request to ${baseUrl}${config.url || ''} timed out after 10 minutes for client ${clientId}`,
          );
          throw new BadRequestException(
            'Request timed out after 10 minutes. The operation may still be processing on the remote server.',
          );
        }

        this.logger.error(`No response received from ${baseUrl}${config.url || ''}: ${axiosError.message}`);
        throw new BadRequestException(`Failed to connect to client endpoint: ${axiosError.message}`);
      } else {
        this.logger.error(`Error setting up request to ${baseUrl}${config.url || ''}: ${axiosError.message}`);
        throw new BadRequestException(`Request setup failed: ${axiosError.message}`);
      }
    }
  }

  /**
   * Get all agents for a specific client with pagination.
   * @param clientId - The UUID of the client
   * @param limit - Maximum number of agents to return
   * @param offset - Number of agents to skip
   * @returns Array of agent response DTOs
   */
  async getClientAgents(clientId: string, limit = 10, offset = 0): Promise<AgentResponseDto[]> {
    return await this.makeRequest<AgentResponseDto[]>(clientId, {
      method: 'GET',
      params: { limit, offset },
    });
  }

  /**
   * Get a single agent for a specific client by agent ID.
   * @param clientId - The UUID of the client
   * @param agentId - The UUID of the agent
   * @returns The agent response DTO
   */
  async getClientAgent(clientId: string, agentId: string): Promise<AgentResponseDto> {
    return await this.makeRequest<AgentResponseDto>(clientId, {
      method: 'GET',
      url: `/${agentId}`,
    });
  }

  /**
   * List models available for an agent (proxied to agent-manager).
   * @param clientId - The UUID of the client
   * @param agentId - The UUID of the agent
   * @returns Map of model id to display name
   */
  async listClientAgentModels(clientId: string, agentId: string): Promise<AgentModelsResponseDto> {
    return await this.makeRequest<AgentModelsResponseDto>(clientId, {
      method: 'GET',
      url: `/${agentId}/models`,
    });
  }

  /**
   * Create a new agent for a specific client.
   * @param clientId - The UUID of the client
   * @param createAgentDto - Data transfer object for creating an agent
   * @returns The created agent response DTO with generated password
   */
  async createClientAgent(
    clientId: string,
    createAgentDto: CreateAgentDto,
    userId?: string,
  ): Promise<CreateAgentResponseDto> {
    const result = await this.makeRequest<CreateAgentResponseDto>(clientId, {
      method: 'POST',
      data: createAgentDto,
    });

    // Persist credentials for socket proxying
    if (result?.id && result?.password) {
      await this.clientAgentCredentialsService.saveCredentials(clientId, result.id, result.password);
    }

    if (result?.id) {
      this.statisticsService
        .recordEntityCreated(
          StatisticsEntityType.AGENT,
          result.id,
          {
            clientId,
            agentType: createAgentDto.agentType ?? 'cursor',
            containerType: createAgentDto.containerType?.toString() ?? 'generic',
            name: createAgentDto.name,
            description: createAgentDto.description,
          },
          userId,
        )
        .catch(() => undefined);
    }

    return result;
  }

  /**
   * Update an existing agent for a specific client.
   * @param clientId - The UUID of the client
   * @param agentId - The UUID of the agent to update
   * @param updateAgentDto - Data transfer object for updating an agent
   * @returns The updated agent response DTO
   */
  async updateClientAgent(
    clientId: string,
    agentId: string,
    updateAgentDto: UpdateAgentDto,
    userId?: string,
  ): Promise<AgentResponseDto> {
    const result = await this.makeRequest<AgentResponseDto>(clientId, {
      method: 'POST',
      url: `/${agentId}`,
      data: updateAgentDto,
    });

    this.statisticsService
      .recordEntityUpdated(
        StatisticsEntityType.AGENT,
        agentId,
        {
          clientId,
          agentType: result.agentType,
          containerType: result.containerType?.toString(),
          name: result.name,
          description: result.description,
        },
        userId,
      )
      .catch(() => undefined);

    return result;
  }

  /**
   * Delete an agent for a specific client by agent ID.
   * @param clientId - The UUID of the client
   * @param agentId - The UUID of the agent to delete
   */
  async deleteClientAgent(clientId: string, agentId: string, userId?: string): Promise<void> {
    this.statisticsService.recordEntityDeleted(StatisticsEntityType.AGENT, agentId, userId).catch(() => undefined);
    await this.makeRequest<void>(clientId, {
      method: 'DELETE',
      url: `/${agentId}`,
    });
    // Cleanup stored credentials for this client/agent pair
    await this.clientAgentCredentialsService.deleteCredentials(clientId, agentId);
  }

  /**
   * Start all Docker containers for an agent (main, VNC, SSH).
   * @param clientId - The UUID of the client
   * @param agentId - The UUID of the agent
   * @returns The agent response DTO
   */
  async startClientAgent(clientId: string, agentId: string): Promise<AgentResponseDto> {
    return await this.makeRequest<AgentResponseDto>(clientId, {
      method: 'POST',
      url: `/${agentId}/start`,
    });
  }

  /**
   * Stop all Docker containers for an agent (main, VNC, SSH).
   * @param clientId - The UUID of the client
   * @param agentId - The UUID of the agent
   * @returns The agent response DTO
   */
  async stopClientAgent(clientId: string, agentId: string): Promise<AgentResponseDto> {
    return await this.makeRequest<AgentResponseDto>(clientId, {
      method: 'POST',
      url: `/${agentId}/stop`,
    });
  }

  /**
   * Restart all Docker containers for an agent (main, VNC, SSH).
   * @param clientId - The UUID of the client
   * @param agentId - The UUID of the agent
   * @returns The agent response DTO
   */
  async restartClientAgent(clientId: string, agentId: string): Promise<AgentResponseDto> {
    return await this.makeRequest<AgentResponseDto>(clientId, {
      method: 'POST',
      url: `/${agentId}/restart`,
    });
  }

  /**
   * Get configuration from the client's agent-manager service.
   * Returns undefined if the request fails (e.g., agent-manager is unreachable).
   * @param clientId - The UUID of the client
   * @returns The config response DTO, or undefined if the request fails
   */
  async getClientConfig(clientId: string): Promise<ConfigResponseDto | undefined> {
    try {
      const clientEntity = await this.clientsRepository.findByIdOrThrow(clientId);

      await validateClientEndpointWithDnsOrThrow(clientEntity.endpoint);
      const authHeader = await this.getAuthHeader(clientId);
      const baseUrl = this.buildConfigApiUrl(clientEntity.endpoint);
      const tlsPolicy = getClientEndpointTlsPolicy(this.logger);

      this.logger.debug(`Fetching config from ${baseUrl} for client ${clientId}`);

      const response = await axios.request<ConfigResponseDto>({
        method: 'GET',
        url: baseUrl,
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        validateStatus: (status) => status < 500, // Don't throw on 4xx errors
        timeout: 5000, // 5 second timeout
        httpsAgent: baseUrl.startsWith('https://')
          ? new (require('https').Agent)({
              rejectUnauthorized: tlsPolicy.rejectUnauthorized,
            })
          : undefined,
      });

      // Handle error responses
      if (response.status >= 400) {
        this.logger.warn(`Failed to fetch config from ${baseUrl} for client ${clientId}: status ${response.status}`);

        return undefined;
      }

      return response.data;
    } catch (error) {
      // Log but don't throw - config is optional
      const axiosError = error as AxiosError;

      if (axiosError.response) {
        this.logger.warn(
          `Failed to fetch config for client ${clientId}: ${axiosError.response.status} ${axiosError.message}`,
        );
      } else if (axiosError.request) {
        this.logger.warn(`No response received when fetching config for client ${clientId}: ${axiosError.message}`);
      } else {
        this.logger.warn(`Error setting up config request for client ${clientId}: ${axiosError.message}`);
      }

      return undefined;
    }
  }
}
