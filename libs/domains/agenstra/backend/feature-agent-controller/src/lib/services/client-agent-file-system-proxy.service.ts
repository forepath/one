/* eslint-disable @typescript-eslint/no-var-requires */
import {
  CreateFileDto,
  FileContentDto,
  FileNodeDto,
  MoveFileDto,
  WriteFileDto,
  type AgentFileManagerContext,
} from '@forepath/agenstra/backend/feature-agent-manager';
import { AuthenticationType } from '@forepath/identity/backend';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import axios, { AxiosError, AxiosRequestConfig } from 'axios';

import { ClientsRepository } from '../repositories/clients.repository';
import { getClientEndpointTlsPolicy, validateClientEndpointWithDnsOrThrow } from '../utils/client-endpoint-security';
import { buildClientProxyRequestHeaders } from '../utils/client-proxy-request-headers';

import { ClientsService } from './clients.service';

/**
 * Service for proxying agent file system requests to client endpoints.
 * Handles authentication (API key or Keycloak JWT) and forwards file system requests to the client's agent-manager service.
 */
@Injectable()
export class ClientAgentFileSystemProxyService {
  private readonly logger = new Logger(ClientAgentFileSystemProxyService.name);

  constructor(
    private readonly clientsService: ClientsService,
    private readonly clientsRepository: ClientsRepository,
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
   * Build the base URL for agent file system API requests.
   * @param endpoint - The client's endpoint URL
   * @returns The base URL for agent file system API requests
   */
  private buildAgentFilesApiUrl(endpoint: string, agentId: string): string {
    // Remove trailing slash if present
    const baseUrl = endpoint.replace(/\/$/, '');

    // Ensure /api/agents/{agentId}/files path
    return `${baseUrl}/api/agents/${agentId}/files`;
  }

  /**
   * Make an HTTP request to the client's agent-manager service for file operations.
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
    const baseUrl = this.buildAgentFilesApiUrl(clientEntity.endpoint, agentId);
    const tlsPolicy = getClientEndpointTlsPolicy(this.logger);

    try {
      this.logger.debug(
        `Proxying file system request to ${baseUrl}${config.url || ''} for client ${clientId}, agent ${agentId}`,
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
   * Read file content from agent container via client proxy.
   * @param clientId - The UUID of the client
   * @param agentId - The UUID of the agent
   * @param filePath - The relative path to the file (from /app)
   * @returns File content (base64-encoded) and encoding type
   */
  async readFile(
    clientId: string,
    agentId: string,
    filePath: string,
    context: AgentFileManagerContext = 'app',
  ): Promise<FileContentDto> {
    const encodedPath = encodeURIComponent(filePath);

    return await this.makeRequest<FileContentDto>(clientId, agentId, {
      method: 'GET',
      url: `/${encodedPath}`,
      params: context === 'config' ? { context: 'config' } : undefined,
    });
  }

  /**
   * Write file content to agent container via client proxy.
   * @param clientId - The UUID of the client
   * @param agentId - The UUID of the agent
   * @param filePath - The relative path to the file (from /app)
   * @param writeFileDto - The file content to write (base64-encoded)
   */
  async writeFile(
    clientId: string,
    agentId: string,
    filePath: string,
    writeFileDto: WriteFileDto,
    context: AgentFileManagerContext = 'app',
  ): Promise<void> {
    const encodedPath = encodeURIComponent(filePath);

    await this.makeRequest<void>(clientId, agentId, {
      method: 'PUT',
      url: `/${encodedPath}`,
      data: writeFileDto,
      params: context === 'config' ? { context: 'config' } : undefined,
    });
  }

  /**
   * List directory contents in agent container via client proxy.
   * @param clientId - The UUID of the client
   * @param agentId - The UUID of the agent
   * @param path - Optional directory path (defaults to '.')
   * @returns Array of file nodes
   */
  async listDirectory(
    clientId: string,
    agentId: string,
    path?: string,
    context: AgentFileManagerContext = 'app',
  ): Promise<FileNodeDto[]> {
    const params: Record<string, string> = {};

    if (path) {
      params.path = path;
    }

    if (context === 'config') {
      params.context = 'config';
    }

    return await this.makeRequest<FileNodeDto[]>(clientId, agentId, {
      method: 'GET',
      params: Object.keys(params).length ? params : undefined,
    });
  }

  /**
   * Create a file or directory in agent container via client proxy.
   * @param clientId - The UUID of the client
   * @param agentId - The UUID of the agent
   * @param filePath - The relative path to create (from /app)
   * @param createFileDto - The file/directory creation data
   */
  async createFileOrDirectory(
    clientId: string,
    agentId: string,
    filePath: string,
    createFileDto: CreateFileDto,
    context: AgentFileManagerContext = 'app',
  ): Promise<void> {
    const encodedPath = encodeURIComponent(filePath);

    await this.makeRequest<void>(clientId, agentId, {
      method: 'POST',
      url: `/${encodedPath}`,
      data: createFileDto,
      params: context === 'config' ? { context: 'config' } : undefined,
    });
  }

  /**
   * Delete a file or directory from agent container via client proxy.
   * @param clientId - The UUID of the client
   * @param agentId - The UUID of the agent
   * @param filePath - The relative path to delete (from /app)
   */
  async deleteFileOrDirectory(
    clientId: string,
    agentId: string,
    filePath: string,
    context: AgentFileManagerContext = 'app',
  ): Promise<void> {
    const encodedPath = encodeURIComponent(filePath);

    await this.makeRequest<void>(clientId, agentId, {
      method: 'DELETE',
      url: `/${encodedPath}`,
      params: context === 'config' ? { context: 'config' } : undefined,
    });
  }

  /**
   * Move a file or directory in agent container via client proxy.
   * @param clientId - The UUID of the client
   * @param agentId - The UUID of the agent
   * @param sourcePath - The relative path to the source file/directory (from /app)
   * @param moveFileDto - The move operation data (destination path)
   */
  async moveFileOrDirectory(
    clientId: string,
    agentId: string,
    sourcePath: string,
    moveFileDto: MoveFileDto,
    context: AgentFileManagerContext = 'app',
  ): Promise<void> {
    const encodedPath = encodeURIComponent(sourcePath);

    await this.makeRequest<void>(clientId, agentId, {
      method: 'PATCH',
      url: `/${encodedPath}`,
      data: moveFileDto,
      params: context === 'config' ? { context: 'config' } : undefined,
    });
  }
}
