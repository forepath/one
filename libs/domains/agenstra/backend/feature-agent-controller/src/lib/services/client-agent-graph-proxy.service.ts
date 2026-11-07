/* eslint-disable @typescript-eslint/no-var-requires */
import {
  AGENT_GRAPH_LIMITS,
  isAgentGraphQueryLayer,
  type AgentGraphComposeRequest,
  type AgentGraphDocument,
  type AgentGraphEnvironmentDigest,
  type AgentGraphFileResponse,
  type AgentGraphNodeDetail,
  type AgentGraphOverview,
  type AgentGraphPathResponse,
  type AgentGraphReferencesResponse,
  type AgentGraphRefreshResponse,
  type AgentGraphSearchResponse,
  type AgentGraphStatus,
} from '@forepath/agenstra/shared/util-opencode-config';
import { AuthenticationType } from '@forepath/identity/backend';
import { BadRequestException, forwardRef, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import axios, { AxiosError, AxiosRequestConfig } from 'axios';

import { ClientsRepository } from '../repositories/clients.repository';
import { getClientEndpointTlsPolicy, validateClientEndpointWithDnsOrThrow } from '../utils/client-endpoint-security';
import { createClientMtlsAuthorizationHeader } from '../utils/client-mtls-authorization';
import { buildClientProxyRequestHeaders } from '../utils/client-proxy-request-headers';
import {
  clampGraphInt,
  parseGraphId,
  parseGraphLayer,
  parseGraphNodeTypes,
  parseGraphQuery,
  parseOptionalGraphId,
} from '../utils/workspace-graph.utils';

import { ClientsService } from './clients.service';

/** Raw (untrusted) query values as received by the controller. */
export type AgentGraphQueryInput = Record<string, unknown>;

/** Default number of prompts listed by the references route. */
const DEFAULT_REFERENCE_PROMPTS = 50;

/**
 * Service for proxying environment graph requests to client endpoints (agent-manager `agents/:agentId/graph/*` and
 * `graphs/compose`). Query parameters are whitelisted and bounded before they leave the controller.
 */
@Injectable()
export class ClientAgentGraphProxyService {
  private readonly logger = new Logger(ClientAgentGraphProxyService.name);

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
   * Build the agent graph base URL (`<endpoint>/api/agents/<agentId>/graph`).
   * @param endpoint - The client's endpoint URL
   * @param agentId - The UUID of the agent
   */
  private buildAgentGraphApiUrl(endpoint: string, agentId: string): string {
    return `${endpoint.replace(/\/$/, '')}/api/agents/${encodeURIComponent(agentId)}/graph`;
  }

  /**
   * Make an HTTP request to the client's agent-manager service.
   * @param clientId - The UUID of the client
   * @param buildUrl - Builds the absolute target URL from the client endpoint
   * @param config - Axios request configuration (method, params, data)
   * @returns The response data
   * @throws NotFoundException on 404 responses
   * @throws BadRequestException on other failures
   */
  private async makeRequest<T>(
    clientId: string,
    buildUrl: (endpoint: string) => string,
    config: AxiosRequestConfig,
  ): Promise<T> {
    const clientEntity = await this.clientsRepository.findByIdOrThrow(clientId);

    await validateClientEndpointWithDnsOrThrow(clientEntity.endpoint);
    const authHeader = await this.getAuthHeader(clientId);
    const url = buildUrl(clientEntity.endpoint);
    const tlsPolicy = getClientEndpointTlsPolicy(this.logger);

    try {
      this.logger.debug(`Proxying graph request to ${url} for client ${clientId}`);

      const response = await axios.request<T>({
        ...config,
        url,
        headers: buildClientProxyRequestHeaders(config.headers, authHeader),
        validateStatus: (status) => status < 500, // Don't throw on 4xx errors
        httpsAgent: url.startsWith('https://')
          ? new (require('https').Agent)({
              rejectUnauthorized: tlsPolicy.rejectUnauthorized,
            })
          : undefined,
      });

      if (response.status >= 400) {
        const errorMessage = (response.data as { message?: string })?.message || 'Request failed';

        this.logger.error(`Request to ${url} failed with status ${response.status}: ${errorMessage}`);

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

        this.logger.error(`Request to ${url} failed: ${errorMessage}`);

        if (axiosError.response.status === 404) {
          throw new NotFoundException(errorMessage);
        } else if (axiosError.response.status === 400) {
          throw new BadRequestException(errorMessage);
        } else {
          throw new BadRequestException(`Request failed: ${errorMessage}`);
        }
      } else if (axiosError.request) {
        this.logger.error(`No response received from ${url}: ${axiosError.message}`);
        throw new BadRequestException(`Failed to connect to client endpoint: ${axiosError.message}`);
      } else {
        this.logger.error(`Error setting up request to ${url}: ${axiosError.message}`);
        throw new BadRequestException(`Request setup failed: ${axiosError.message}`);
      }
    }
  }

  private async agentRequest<T>(
    clientId: string,
    agentId: string,
    suffix: string,
    config: AxiosRequestConfig = { method: 'GET' },
  ): Promise<T> {
    return await this.makeRequest<T>(
      clientId,
      (endpoint) => `${this.buildAgentGraphApiUrl(endpoint, agentId)}${suffix}`,
      config,
    );
  }

  /** Drop `undefined` entries so axios does not serialize them. */
  private compact(params: Record<string, string | number | undefined>): Record<string, string | number> {
    return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined)) as Record<
      string,
      string | number
    >;
  }

  async getStatus(clientId: string, agentId: string): Promise<AgentGraphStatus> {
    return await this.agentRequest<AgentGraphStatus>(clientId, agentId, '/status');
  }

  async getOverview(clientId: string, agentId: string): Promise<AgentGraphOverview> {
    return await this.agentRequest<AgentGraphOverview>(clientId, agentId, '/overview');
  }

  async getDigest(clientId: string, agentId: string): Promise<AgentGraphEnvironmentDigest> {
    return await this.agentRequest<AgentGraphEnvironmentDigest>(clientId, agentId, '/digest');
  }

  /** Graph document of one layer (`layer`, `limit`, `types`). */
  async getDocument(clientId: string, agentId: string, query: AgentGraphQueryInput = {}): Promise<AgentGraphDocument> {
    return await this.agentRequest<AgentGraphDocument>(clientId, agentId, '', {
      method: 'GET',
      params: this.compact({
        layer: parseGraphLayer(query['layer']),
        limit: clampGraphInt(query['limit'], 1, AGENT_GRAPH_LIMITS.maxDocumentNodes),
        types: parseGraphNodeTypes(query['types']),
        offset: clampGraphInt(query['offset'], 0, Number.MAX_SAFE_INTEGER),
      }),
    });
  }

  async search(clientId: string, agentId: string, query: AgentGraphQueryInput): Promise<AgentGraphSearchResponse> {
    return await this.agentRequest<AgentGraphSearchResponse>(clientId, agentId, '/search', {
      method: 'GET',
      params: this.compact({
        query: parseGraphQuery(query['query']),
        layer: parseGraphLayer(query['layer']),
        types: parseGraphNodeTypes(query['types']),
        limit: clampGraphInt(query['limit'], 1, AGENT_GRAPH_LIMITS.maxSearchResults),
      }),
    });
  }

  async getNode(clientId: string, agentId: string, query: AgentGraphQueryInput): Promise<AgentGraphNodeDetail> {
    return await this.agentRequest<AgentGraphNodeDetail>(clientId, agentId, '/nodes', {
      method: 'GET',
      params: this.compact({
        id: parseGraphId(query['id'], 'id'),
        layer: parseGraphLayer(query['layer']),
      }),
    });
  }

  async getNeighbors(clientId: string, agentId: string, query: AgentGraphQueryInput): Promise<AgentGraphDocument> {
    return await this.agentRequest<AgentGraphDocument>(clientId, agentId, '/neighbors', {
      method: 'GET',
      params: this.compact({
        id: parseGraphId(query['id'], 'id'),
        layer: parseGraphLayer(query['layer']),
        depth: clampGraphInt(query['depth'], 1, AGENT_GRAPH_LIMITS.maxNeighborDepth),
        limit: clampGraphInt(query['limit'], 1, AGENT_GRAPH_LIMITS.maxNeighborNodes),
      }),
    });
  }

  async getPath(clientId: string, agentId: string, query: AgentGraphQueryInput): Promise<AgentGraphPathResponse> {
    return await this.agentRequest<AgentGraphPathResponse>(clientId, agentId, '/path', {
      method: 'GET',
      params: this.compact({
        from: parseGraphId(query['from'], 'from'),
        to: parseGraphId(query['to'], 'to'),
        layer: parseGraphLayer(query['layer']),
      }),
    });
  }

  async getFile(clientId: string, agentId: string, query: AgentGraphQueryInput): Promise<AgentGraphFileResponse> {
    return await this.agentRequest<AgentGraphFileResponse>(clientId, agentId, '/file', {
      method: 'GET',
      params: { path: parseGraphId(query['path'], 'path') },
    });
  }

  async getReferences(
    clientId: string,
    agentId: string,
    query: AgentGraphQueryInput = {},
  ): Promise<AgentGraphReferencesResponse> {
    return await this.agentRequest<AgentGraphReferencesResponse>(clientId, agentId, '/references', {
      method: 'GET',
      params: this.compact({
        promptId: parseOptionalGraphId(query['promptId'], 'promptId'),
        limit:
          clampGraphInt(query['limit'], 1, AGENT_GRAPH_LIMITS.maxPromptRecords) ??
          Math.min(DEFAULT_REFERENCE_PROMPTS, AGENT_GRAPH_LIMITS.maxPromptRecords),
      }),
    });
  }

  async refresh(clientId: string, agentId: string): Promise<AgentGraphRefreshResponse> {
    return await this.agentRequest<AgentGraphRefreshResponse>(clientId, agentId, '/refresh', { method: 'POST' });
  }

  /**
   * Compose a workspace graph on the manager. `environmentIds` must be controller-verified members of the workspace.
   */
  async compose(clientId: string, request: AgentGraphComposeRequest): Promise<AgentGraphDocument> {
    const layer = isAgentGraphQueryLayer(request.layer) ? request.layer : 'code';
    const body: AgentGraphComposeRequest = {
      environmentIds: [...new Set(request.environmentIds)],
      layer,
      ...(request.limit !== undefined
        ? { limit: clampGraphInt(request.limit, 1, AGENT_GRAPH_LIMITS.maxDocumentNodes) }
        : {}),
      ...(request.names ? { names: request.names } : {}),
    };

    return await this.makeRequest<AgentGraphDocument>(
      clientId,
      (endpoint) => `${endpoint.replace(/\/$/, '')}/api/graphs/compose`,
      { method: 'POST', data: body },
    );
  }
}
