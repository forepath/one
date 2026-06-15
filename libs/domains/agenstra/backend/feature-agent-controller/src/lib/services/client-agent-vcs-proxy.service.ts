/* eslint-disable @typescript-eslint/no-var-requires */
import {
  CommitDto,
  CreateBranchDto,
  GitBranchDto,
  GitDiffDto,
  GitStatusDto,
  PrepareCleanWorkspaceDto,
  RebaseDto,
  ResolveConflictDto,
  RunVerifierCommandsDto,
  RunVerifierCommandsResponseDto,
  StageFilesDto,
  UnstageFilesDto,
} from '@forepath/agenstra/backend/feature-agent-manager';
import { AuthenticationType } from '@forepath/identity/backend';
import { BadRequestException, forwardRef, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import axios, { AxiosError, AxiosRequestConfig } from 'axios';

import { ClientsRepository } from '../repositories/clients.repository';
import { getClientEndpointTlsPolicy, validateClientEndpointWithDnsOrThrow } from '../utils/client-endpoint-security';
import { buildClientProxyRequestHeaders } from '../utils/client-proxy-request-headers';

import { AgentConsoleStatusService } from './agent-console-status.service';
import { ClientsService } from './clients.service';

/**
 * Service for proxying agent VCS requests to client endpoints.
 * Handles authentication (API key or Keycloak JWT) and forwards VCS requests to the client's agent-manager service.
 */
@Injectable()
export class ClientAgentVcsProxyService {
  private readonly logger = new Logger(ClientAgentVcsProxyService.name);

  constructor(
    private readonly clientsService: ClientsService,
    private readonly clientsRepository: ClientsRepository,
    @Inject(forwardRef(() => AgentConsoleStatusService))
    private readonly agentConsoleStatusService: AgentConsoleStatusService,
  ) {}

  private emitGitStateChanged(clientId: string, agentId: string): void {
    void this.agentConsoleStatusService.notifyVcsStateChanged(clientId, agentId).catch((error: unknown) => {
      this.logger.warn(
        `Failed to publish status patch after VCS change for ${clientId}/${agentId}: ${(error as Error).message}`,
      );
    });
  }

  private async runGitStateMutation<T>(clientId: string, agentId: string, operation: () => Promise<T>): Promise<T> {
    const result = await operation();

    this.emitGitStateChanged(clientId, agentId);

    return result;
  }

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
   * Build the base URL for agent VCS API requests.
   * @param endpoint - The client's endpoint URL
   * @param agentId - The UUID of the agent
   * @returns The base URL for agent VCS API requests
   */
  private buildAgentManagerResourceUrl(endpoint: string, agentId: string, resource: 'vcs' | 'automation'): string {
    const baseUrl = endpoint.replace(/\/$/, '');

    return `${baseUrl}/api/agents/${agentId}/${resource}`;
  }

  /**
   * Make an HTTP request to the client's agent-manager service for VCS operations.
   * @param clientId - The UUID of the client
   * @param agentId - The UUID of the agent
   * @param config - Axios request configuration
   * @returns The response data
   * @throws NotFoundException if client or agent is not found
   * @throws BadRequestException if request fails
   */
  private async makeRequest<T>(
    clientId: string,
    agentId: string,
    config: AxiosRequestConfig,
    resource: 'vcs' | 'automation' = 'vcs',
  ): Promise<T> {
    const clientEntity = await this.clientsRepository.findByIdOrThrow(clientId);

    await validateClientEndpointWithDnsOrThrow(clientEntity.endpoint);
    const authHeader = await this.getAuthHeader(clientId);
    const baseUrl = this.buildAgentManagerResourceUrl(clientEntity.endpoint, agentId, resource);
    const tlsPolicy = getClientEndpointTlsPolicy(this.logger);

    try {
      this.logger.debug(
        `Proxying VCS request to ${baseUrl}${config.url || ''} for client ${clientId}, agent ${agentId}`,
      );

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
        this.logger.error(`No response received from ${baseUrl}${config.url || ''}: ${axiosError.message}`);
        throw new BadRequestException(`Failed to connect to client endpoint: ${axiosError.message}`);
      } else {
        this.logger.error(`Error setting up request to ${baseUrl}${config.url || ''}: ${axiosError.message}`);
        throw new BadRequestException(`Request setup failed: ${axiosError.message}`);
      }
    }
  }

  /**
   * Get git status for the agent's repository via client proxy.
   * @param clientId - The UUID of the client
   * @param agentId - The UUID of the agent
   * @returns Git status information
   */
  async getStatus(clientId: string, agentId: string): Promise<GitStatusDto> {
    return await this.makeRequest<GitStatusDto>(clientId, agentId, {
      method: 'GET',
      url: '/status',
    });
  }

  /**
   * List all branches (local and remote) via client proxy.
   * @param clientId - The UUID of the client
   * @param agentId - The UUID of the agent
   * @returns Array of branch information
   */
  async getBranches(clientId: string, agentId: string): Promise<GitBranchDto[]> {
    return await this.makeRequest<GitBranchDto[]>(clientId, agentId, {
      method: 'GET',
      url: '/branches',
    });
  }

  /**
   * Get diff for a specific file via client proxy.
   * @param clientId - The UUID of the client
   * @param agentId - The UUID of the agent
   * @param filePath - The file path relative to repository root
   * @returns File diff information
   */
  async getFileDiff(clientId: string, agentId: string, filePath: string): Promise<GitDiffDto> {
    return await this.makeRequest<GitDiffDto>(clientId, agentId, {
      method: 'GET',
      url: '/diff',
      params: { path: filePath },
    });
  }

  /**
   * Stage files via client proxy.
   * @param clientId - The UUID of the client
   * @param agentId - The UUID of the agent
   * @param stageFilesDto - Files to stage (empty array stages all)
   */
  async stageFiles(clientId: string, agentId: string, stageFilesDto: StageFilesDto): Promise<void> {
    await this.runGitStateMutation(clientId, agentId, () =>
      this.makeRequest<void>(clientId, agentId, {
        method: 'POST',
        url: '/stage',
        data: stageFilesDto,
      }),
    );
  }

  /**
   * Unstage files via client proxy.
   * @param clientId - The UUID of the client
   * @param agentId - The UUID of the agent
   * @param unstageFilesDto - Files to unstage (empty array unstages all)
   */
  async unstageFiles(clientId: string, agentId: string, unstageFilesDto: UnstageFilesDto): Promise<void> {
    await this.runGitStateMutation(clientId, agentId, () =>
      this.makeRequest<void>(clientId, agentId, {
        method: 'POST',
        url: '/unstage',
        data: unstageFilesDto,
      }),
    );
  }

  /**
   * Commit staged changes via client proxy.
   * @param clientId - The UUID of the client
   * @param agentId - The UUID of the agent
   * @param commitDto - Commit message
   */
  async commit(clientId: string, agentId: string, commitDto: CommitDto): Promise<void> {
    await this.runGitStateMutation(clientId, agentId, () =>
      this.makeRequest<void>(clientId, agentId, {
        method: 'POST',
        url: '/commit',
        data: commitDto,
      }),
    );
  }

  /**
   * Push changes to remote via client proxy.
   * @param clientId - The UUID of the client
   * @param agentId - The UUID of the agent
   * @param pushOptions - Optional push options (e.g., force flag)
   */
  async push(clientId: string, agentId: string, pushOptions: { force?: boolean } = {}): Promise<void> {
    await this.runGitStateMutation(clientId, agentId, () =>
      this.makeRequest<void>(clientId, agentId, {
        method: 'POST',
        url: '/push',
        data: pushOptions,
      }),
    );
  }

  /**
   * Pull changes from remote via client proxy.
   * @param clientId - The UUID of the client
   * @param agentId - The UUID of the agent
   */
  async pull(clientId: string, agentId: string): Promise<void> {
    await this.runGitStateMutation(clientId, agentId, () =>
      this.makeRequest<void>(clientId, agentId, {
        method: 'POST',
        url: '/pull',
      }),
    );
  }

  /**
   * Fetch changes from remote via client proxy.
   * @param clientId - The UUID of the client
   * @param agentId - The UUID of the agent
   */
  async fetch(clientId: string, agentId: string): Promise<void> {
    await this.runGitStateMutation(clientId, agentId, () =>
      this.makeRequest<void>(clientId, agentId, {
        method: 'POST',
        url: '/fetch',
      }),
    );
  }

  /**
   * Rebase current branch onto another branch via client proxy.
   * @param clientId - The UUID of the client
   * @param agentId - The UUID of the agent
   * @param rebaseDto - Branch to rebase onto
   */
  async rebase(clientId: string, agentId: string, rebaseDto: RebaseDto): Promise<void> {
    await this.runGitStateMutation(clientId, agentId, () =>
      this.makeRequest<void>(clientId, agentId, {
        method: 'POST',
        url: '/rebase',
        data: rebaseDto,
      }),
    );
  }

  /**
   * Switch to a different branch via client proxy.
   * @param clientId - The UUID of the client
   * @param agentId - The UUID of the agent
   * @param branch - Branch name to switch to
   */
  async switchBranch(clientId: string, agentId: string, branch: string): Promise<void> {
    await this.runGitStateMutation(clientId, agentId, () =>
      this.makeRequest<void>(clientId, agentId, {
        method: 'POST',
        url: `/branches/${encodeURIComponent(branch)}/switch`,
      }),
    );
  }

  /**
   * Create a new branch via client proxy.
   * @param clientId - The UUID of the client
   * @param agentId - The UUID of the agent
   * @param createBranchDto - Branch creation data
   */
  async createBranch(clientId: string, agentId: string, createBranchDto: CreateBranchDto): Promise<void> {
    await this.runGitStateMutation(clientId, agentId, () =>
      this.makeRequest<void>(clientId, agentId, {
        method: 'POST',
        url: '/branches',
        data: createBranchDto,
      }),
    );
  }

  /**
   * Delete a branch via client proxy.
   * @param clientId - The UUID of the client
   * @param agentId - The UUID of the agent
   * @param branch - Branch name to delete
   */
  async deleteBranch(clientId: string, agentId: string, branch: string): Promise<void> {
    await this.runGitStateMutation(clientId, agentId, () =>
      this.makeRequest<void>(clientId, agentId, {
        method: 'DELETE',
        url: `/branches/${encodeURIComponent(branch)}`,
      }),
    );
  }

  /**
   * Resolve a merge conflict via client proxy.
   * @param clientId - The UUID of the client
   * @param agentId - The UUID of the agent
   * @param resolveConflictDto - Conflict resolution data
   */
  async resolveConflict(clientId: string, agentId: string, resolveConflictDto: ResolveConflictDto): Promise<void> {
    await this.runGitStateMutation(clientId, agentId, () =>
      this.makeRequest<void>(clientId, agentId, {
        method: 'POST',
        url: '/conflicts/resolve',
        data: resolveConflictDto,
      }),
    );
  }

  /**
   * Fetch, checkout base branch, hard reset to upstream, and clean (proxied to client agent-manager).
   */
  async prepareCleanWorkspace(clientId: string, agentId: string, body: PrepareCleanWorkspaceDto): Promise<void> {
    await this.runGitStateMutation(clientId, agentId, () =>
      this.makeRequest<void>(clientId, agentId, {
        method: 'POST',
        url: '/workspace/prepare-clean',
        data: body,
      }),
    );
  }

  /**
   * Run verifier shell commands in the agent container (proxied).
   */
  async runVerifierCommands(
    clientId: string,
    agentId: string,
    body: RunVerifierCommandsDto,
  ): Promise<RunVerifierCommandsResponseDto> {
    return await this.makeRequest<RunVerifierCommandsResponseDto>(
      clientId,
      agentId,
      {
        method: 'POST',
        url: '/verify-commands',
        data: body,
      },
      'automation',
    );
  }
}
