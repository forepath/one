/* eslint-disable @typescript-eslint/no-var-requires */
import { AuthenticationType } from '@forepath/identity/backend';
import { BadRequestException, forwardRef, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import axios, { AxiosError, AxiosRequestConfig } from 'axios';

import { ClientsRepository } from '../repositories/clients.repository';
import { getClientEndpointTlsPolicy, validateClientEndpointWithDnsOrThrow } from '../utils/client-endpoint-security';
import { buildClientProxyRequestHeaders } from '../utils/client-proxy-request-headers';

import { ClientsService } from './clients.service';

/**
 * Service for proxying deployment and CI/CD pipeline requests to client endpoints.
 * Handles authentication (API key or Keycloak JWT) and forwards requests to the client's agent-manager service.
 */
@Injectable()
export class ClientAgentDeploymentsProxyService {
  private readonly logger = new Logger(ClientAgentDeploymentsProxyService.name);

  constructor(
    @Inject(forwardRef(() => ClientsService))
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
   * Build the base URL for deployment API requests.
   * @param endpoint - The client's endpoint URL
   * @param agentId - The UUID of the agent
   * @returns The base URL for deployment API requests
   */
  private buildAgentDeploymentsApiUrl(endpoint: string, agentId: string): string {
    // Remove trailing slash if present
    const baseUrl = endpoint.replace(/\/$/, '');

    // Ensure /api/agents/:agentId/deployments path
    return `${baseUrl}/api/agents/${agentId}/deployments`;
  }

  /**
   * Make an HTTP request to the client's agent-manager service for deployment operations.
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
    const baseUrl = this.buildAgentDeploymentsApiUrl(clientEntity.endpoint, agentId);
    const tlsPolicy = getClientEndpointTlsPolicy(this.logger);

    try {
      this.logger.debug(
        `Proxying deployment request to ${baseUrl}${config.url || ''} for client ${clientId}, agent ${agentId}`,
      );

      const response = await axios.request<T>({
        ...config,
        url: config.url ? `${baseUrl}${config.url}` : baseUrl,
        headers: buildClientProxyRequestHeaders(config.headers, authHeader),
        validateStatus: (status) => status < 500, // Don't throw on 4xx errors
        timeout: process.env.REQUEST_TIMEOUT ? parseInt(process.env.REQUEST_TIMEOUT) : 600000, // 10 minutes timeout
        httpsAgent: baseUrl.startsWith('https://')
          ? new (require('https').Agent)({
              rejectUnauthorized: tlsPolicy.rejectUnauthorized,
            })
          : undefined,
      });

      // Handle error responses
      if (response.status >= 400) {
        const error = response.data as { message?: string; error?: string };
        const errorMessage = error?.message || error?.error || `Request failed with status ${response.status}`;

        this.logger.error(`Deployment request failed: ${errorMessage}`);

        if (response.status === 404) {
          throw new NotFoundException(errorMessage);
        }

        throw new BadRequestException(errorMessage);
      }

      return response.data;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }

      const axiosError = error as AxiosError;

      if (axiosError.response) {
        const errorData = axiosError.response.data as { message?: string; error?: string };
        const errorMessage = errorData?.message || errorData?.error || axiosError.message;

        this.logger.error(`Deployment request failed: ${errorMessage}`);

        if (axiosError.response.status === 404) {
          throw new NotFoundException(errorMessage);
        }

        throw new BadRequestException(errorMessage);
      }

      this.logger.error(`Deployment request error: ${axiosError.message}`);
      throw new BadRequestException(`Failed to proxy deployment request: ${axiosError.message}`);
    }
  }

  /**
   * Get deployment configuration for an agent.
   */
  async getConfiguration(clientId: string, agentId: string): Promise<unknown> {
    return await this.makeRequest(clientId, agentId, {
      method: 'GET',
      url: '/configuration',
    });
  }

  /**
   * Create or update deployment configuration for an agent.
   */
  async upsertConfiguration(clientId: string, agentId: string, dto: unknown): Promise<unknown> {
    return await this.makeRequest(clientId, agentId, {
      method: 'POST',
      url: '/configuration',
      data: dto,
    });
  }

  /**
   * Delete deployment configuration for an agent.
   */
  async deleteConfiguration(clientId: string, agentId: string): Promise<void> {
    await this.makeRequest(clientId, agentId, {
      method: 'DELETE',
      url: '/configuration',
    });
  }

  /**
   * List repositories accessible with the agent's deployment configuration.
   */
  async listRepositories(clientId: string, agentId: string): Promise<unknown[]> {
    return await this.makeRequest<unknown[]>(clientId, agentId, {
      method: 'GET',
      url: '/repositories',
    });
  }

  /**
   * List branches for a repository.
   */
  async listBranches(clientId: string, agentId: string, repositoryId: string): Promise<unknown[]> {
    return await this.makeRequest<unknown[]>(clientId, agentId, {
      method: 'GET',
      url: `/repositories/${encodeURIComponent(repositoryId)}/branches`,
    });
  }

  /**
   * List workflows for a repository.
   */
  async listWorkflows(clientId: string, agentId: string, repositoryId: string, branch?: string): Promise<unknown[]> {
    const url = `/repositories/${encodeURIComponent(repositoryId)}/workflows${branch ? `?branch=${encodeURIComponent(branch)}` : ''}`;

    return await this.makeRequest<unknown[]>(clientId, agentId, {
      method: 'GET',
      url,
    });
  }

  /**
   * Trigger a workflow run.
   */
  async triggerWorkflow(clientId: string, agentId: string, dto: unknown): Promise<unknown> {
    return await this.makeRequest(clientId, agentId, {
      method: 'POST',
      url: '/workflows/trigger',
      data: dto,
    });
  }

  /**
   * List deployment runs for an agent.
   */
  async listRuns(clientId: string, agentId: string, limit?: number, offset?: number): Promise<unknown[]> {
    const params = new URLSearchParams();

    if (limit !== undefined) params.append('limit', limit.toString());

    if (offset !== undefined) params.append('offset', offset.toString());

    const queryString = params.toString();

    return await this.makeRequest<unknown[]>(clientId, agentId, {
      method: 'GET',
      url: `/runs${queryString ? `?${queryString}` : ''}`,
    });
  }

  /**
   * Get the status of a pipeline run.
   */
  async getRunStatus(clientId: string, agentId: string, runId: string): Promise<unknown> {
    return await this.makeRequest(clientId, agentId, {
      method: 'GET',
      url: `/runs/${encodeURIComponent(runId)}`,
    });
  }

  /**
   * Get logs for a pipeline run.
   */
  async getRunLogs(clientId: string, agentId: string, runId: string): Promise<{ logs: string }> {
    return await this.makeRequest<{ logs: string }>(clientId, agentId, {
      method: 'GET',
      url: `/runs/${encodeURIComponent(runId)}/logs`,
    });
  }

  /**
   * List jobs/steps for a pipeline run.
   */
  async listRunJobs(clientId: string, agentId: string, runId: string): Promise<unknown[]> {
    return await this.makeRequest<unknown[]>(clientId, agentId, {
      method: 'GET',
      url: `/runs/${encodeURIComponent(runId)}/jobs`,
    });
  }

  /**
   * Get logs for a specific job/step.
   */
  async getJobLogs(clientId: string, agentId: string, runId: string, jobId: string): Promise<{ logs: string }> {
    return await this.makeRequest<{ logs: string }>(clientId, agentId, {
      method: 'GET',
      url: `/runs/${encodeURIComponent(runId)}/jobs/${encodeURIComponent(jobId)}/logs`,
    });
  }

  /**
   * Cancel a running pipeline.
   */
  async cancelRun(clientId: string, agentId: string, runId: string): Promise<void> {
    await this.makeRequest(clientId, agentId, {
      method: 'POST',
      url: `/runs/${encodeURIComponent(runId)}/cancel`,
    });
  }
}
