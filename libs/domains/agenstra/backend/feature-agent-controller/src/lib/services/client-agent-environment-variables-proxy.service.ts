/* eslint-disable @typescript-eslint/no-var-requires */
import {
  CreateEnvironmentVariableDto,
  EnvironmentVariableResponseDto,
  UpdateEnvironmentVariableDto,
} from '@forepath/agenstra/backend/feature-agent-manager';
import { AuthenticationType } from '@forepath/identity/backend';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import axios, { AxiosError, AxiosRequestConfig } from 'axios';

import { ClientsRepository } from '../repositories/clients.repository';
import { getClientEndpointTlsPolicy, validateClientEndpointWithDnsOrThrow } from '../utils/client-endpoint-security';
import { buildClientProxyRequestHeaders } from '../utils/client-proxy-request-headers';

import { AgenstraNotificationPublisher } from '../notifications/agenstra-notification.publisher';
import { ClientsService } from './clients.service';

/**
 * Service for proxying agent environment variable requests to client endpoints.
 * Handles authentication (API key or Keycloak JWT) and forwards environment variable requests to the client's agent-manager service.
 */
@Injectable()
export class ClientAgentEnvironmentVariablesProxyService {
  private readonly logger = new Logger(ClientAgentEnvironmentVariablesProxyService.name);

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
    } else if (clientEntity.authenticationType === AuthenticationType.KEYCLOAK) {
      const token = await this.clientsService.getAccessToken(clientId);

      return `Bearer ${token}`;
    } else {
      throw new BadRequestException(`Unsupported authentication type: ${clientEntity.authenticationType}`);
    }
  }

  /**
   * Build the base URL for agent environment variable API requests.
   * @param endpoint - The client's endpoint URL
   * @param agentId - The UUID of the agent
   * @returns The base URL for agent environment variable API requests
   */
  private buildAgentEnvironmentApiUrl(endpoint: string, agentId: string): string {
    // Remove trailing slash if present
    const baseUrl = endpoint.replace(/\/$/, '');

    // Ensure /api/agents/{agentId}/environment path
    return `${baseUrl}/api/agents/${agentId}/environment`;
  }

  /**
   * Make an HTTP request to the client's agent-manager service for environment variable operations.
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
    const baseUrl = this.buildAgentEnvironmentApiUrl(clientEntity.endpoint, agentId);
    const tlsPolicy = getClientEndpointTlsPolicy(this.logger);

    try {
      this.logger.debug(
        `Proxying environment variable request to ${baseUrl}${config.url || ''} for client ${clientId}, agent ${agentId}`,
      );

      const response = await axios.request<T>({
        ...config,
        url: config.url ? `${baseUrl}${config.url}` : baseUrl,
        headers: buildClientProxyRequestHeaders(config.headers, authHeader),
        validateStatus: (status) => status < 500, // Don't throw on 4xx errors
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
        this.logger.error(`No response received from ${baseUrl}${config.url || ''}: ${axiosError.message}`);
        throw new BadRequestException(`Failed to connect to client endpoint: ${axiosError.message}`);
      } else {
        this.logger.error(`Error setting up request to ${baseUrl}${config.url || ''}: ${axiosError.message}`);
        throw new BadRequestException(`Request setup failed: ${axiosError.message}`);
      }
    }
  }

  /**
   * Get all environment variables for an agent with pagination.
   * @param clientId - The UUID of the client
   * @param agentId - The UUID of the agent
   * @param limit - Maximum number of environment variables to return (default: 50)
   * @param offset - Number of environment variables to skip (default: 0)
   * @returns Array of environment variable response DTOs
   */
  async getEnvironmentVariables(
    clientId: string,
    agentId: string,
    limit = 50,
    offset = 0,
  ): Promise<EnvironmentVariableResponseDto[]> {
    return await this.makeRequest<EnvironmentVariableResponseDto[]>(clientId, agentId, {
      method: 'GET',
      params: { limit, offset },
    });
  }

  /**
   * Get count of environment variables for an agent.
   * @param clientId - The UUID of the client
   * @param agentId - The UUID of the agent
   * @returns Count of environment variables
   */
  async countEnvironmentVariables(clientId: string, agentId: string): Promise<{ count: number }> {
    return await this.makeRequest<{ count: number }>(clientId, agentId, {
      method: 'GET',
      url: '/count',
    });
  }

  /**
   * Create a new environment variable for an agent.
   * @param clientId - The UUID of the client
   * @param agentId - The UUID of the agent
   * @param createDto - Data transfer object for creating an environment variable
   * @returns The created environment variable response DTO
   */
  async createEnvironmentVariable(
    clientId: string,
    agentId: string,
    createDto: CreateEnvironmentVariableDto,
  ): Promise<EnvironmentVariableResponseDto> {
    const created = await this.makeRequest<EnvironmentVariableResponseDto>(clientId, agentId, {
      method: 'POST',
      data: createDto,
    });

    this.notificationPublisher.publishEnvironment('environment.created', clientId, created);

    return created;
  }

  /**
   * Update an existing environment variable.
   * @param clientId - The UUID of the client
   * @param agentId - The UUID of the agent
   * @param id - The UUID of the environment variable to update
   * @param updateDto - Data transfer object for updating an environment variable
   * @returns The updated environment variable response DTO
   */
  async updateEnvironmentVariable(
    clientId: string,
    agentId: string,
    id: string,
    updateDto: UpdateEnvironmentVariableDto,
  ): Promise<EnvironmentVariableResponseDto> {
    const updated = await this.makeRequest<EnvironmentVariableResponseDto>(clientId, agentId, {
      method: 'PUT',
      url: `/${id}`,
      data: updateDto,
    });

    this.notificationPublisher.publishEnvironment('environment.updated', clientId, updated);

    return updated;
  }

  /**
   * Delete an environment variable by ID.
   * @param clientId - The UUID of the client
   * @param agentId - The UUID of the agent
   * @param id - The UUID of the environment variable to delete
   */
  async deleteEnvironmentVariable(clientId: string, agentId: string, id: string): Promise<void> {
    await this.makeRequest<void>(clientId, agentId, {
      method: 'DELETE',
      url: `/${id}`,
    });

    this.notificationPublisher.publishEnvironment('environment.deleted', clientId, {
      id,
      agentId,
    });
  }

  /**
   * Delete all environment variables for an agent.
   * @param clientId - The UUID of the client
   * @param agentId - The UUID of the agent
   * @returns Number of environment variables deleted
   */
  async deleteAllEnvironmentVariables(clientId: string, agentId: string): Promise<{ deletedCount: number }> {
    return await this.makeRequest<{ deletedCount: number }>(clientId, agentId, {
      method: 'DELETE',
    });
  }
}
