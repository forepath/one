/* eslint-disable @typescript-eslint/no-var-requires */
import { AuthenticationType } from '@forepath/identity/backend';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import axios, { AxiosError, AxiosRequestConfig } from 'axios';

import {
  OpencodeAgentsListResponseDto,
  OpencodeCommandsListResponseDto,
  OpencodeConfigResponseDto,
  OpencodeMcpAuthStartResponseDto,
  OpencodeMcpServerStatusDto,
  OpencodeMcpStatusListResponseDto,
  UpsertOpencodeConfigDto,
} from '../dto/opencode-config.dto';
import { ClientsRepository } from '../repositories/clients.repository';
import { getClientEndpointTlsPolicy, validateClientEndpointWithDnsOrThrow } from '../utils/client-endpoint-security';
import { buildClientProxyRequestHeaders } from '../utils/client-proxy-request-headers';

import { ClientsService } from './clients.service';

@Injectable()
export class ClientAgentOpencodeConfigProxyService {
  private readonly logger = new Logger(ClientAgentOpencodeConfigProxyService.name);

  constructor(
    private readonly clientsService: ClientsService,
    private readonly clientsRepository: ClientsRepository,
  ) {}

  private async getAuthHeader(clientId: string): Promise<string> {
    const clientEntity = await this.clientsRepository.findByIdOrThrow(clientId);

    if (clientEntity.authenticationType === AuthenticationType.API_KEY) {
      if (!clientEntity.apiKey) {
        throw new BadRequestException('API key is not configured for this client');
      }

      return `Bearer ${clientEntity.apiKey}`;
    }

    if (clientEntity.authenticationType === AuthenticationType.KEYCLOAK) {
      const token = await this.clientsService.getAccessToken(clientId);

      return `Bearer ${token}`;
    }

    throw new BadRequestException(`Unsupported authentication type: ${clientEntity.authenticationType}`);
  }

  private async makeRequest<T>(
    clientId: string,
    agentId: string,
    config: AxiosRequestConfig,
    resource: 'opencode/config' | 'opencode/mcp' = 'opencode/config',
  ): Promise<T> {
    const clientEntity = await this.clientsRepository.findByIdOrThrow(clientId);

    await validateClientEndpointWithDnsOrThrow(clientEntity.endpoint);
    const authHeader = await this.getAuthHeader(clientId);
    const baseUrl = `${clientEntity.endpoint.replace(/\/$/, '')}/api/agents/${agentId}/${resource}`;
    const tlsPolicy = getClientEndpointTlsPolicy(this.logger);

    try {
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

        if (response.status === 404) {
          throw new NotFoundException(errorMessage);
        }

        throw new BadRequestException(errorMessage);
      }

      return response.data;
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }

      const axiosError = error as AxiosError;
      const message = axiosError.message || 'OpenCode config proxy request failed';

      this.logger.error(`OpenCode config proxy failed for agent ${agentId}: ${message}`);
      throw new BadRequestException(message);
    }
  }

  async get(clientId: string, agentId: string): Promise<OpencodeConfigResponseDto> {
    return await this.makeRequest(clientId, agentId, { method: 'GET' });
  }

  async put(clientId: string, agentId: string, dto: UpsertOpencodeConfigDto): Promise<OpencodeConfigResponseDto> {
    return await this.makeRequest(clientId, agentId, { method: 'PUT', data: dto });
  }

  async syncEffective(
    clientId: string,
    agentId: string,
    effective: Record<string, unknown>,
    secrets?: Record<string, string>,
  ): Promise<{ ok: boolean; defer?: boolean; error?: string }> {
    const result = await this.makeRequest<{ ok: boolean; defer?: boolean; error?: string }>(clientId, agentId, {
      method: 'POST',
      url: '/sync',
      data: { config: effective, secrets: secrets ?? {} },
    });

    if (!result || typeof result.ok !== 'boolean') {
      return { ok: false, error: 'Invalid sync response from agent manager' };
    }

    return result;
  }

  async listAgents(clientId: string, agentId: string): Promise<OpencodeAgentsListResponseDto> {
    return await this.makeRequest(clientId, agentId, {
      method: 'GET',
      url: '/agents',
    });
  }

  async listCommands(clientId: string, agentId: string): Promise<OpencodeCommandsListResponseDto> {
    return await this.makeRequest(clientId, agentId, {
      method: 'GET',
      url: '/commands',
    });
  }

  async listMcpStatuses(clientId: string, agentId: string): Promise<OpencodeMcpStatusListResponseDto> {
    return await this.makeRequest(clientId, agentId, { method: 'GET' }, 'opencode/mcp');
  }

  async startMcpAuth(
    clientId: string,
    agentId: string,
    name: string,
    redirectUri?: string,
  ): Promise<OpencodeMcpAuthStartResponseDto> {
    return await this.makeRequest(
      clientId,
      agentId,
      {
        method: 'POST',
        url: `/${encodeURIComponent(name)}/auth`,
        data: redirectUri ? { redirectUri } : {},
      },
      'opencode/mcp',
    );
  }

  async completeMcpAuth(
    clientId: string,
    agentId: string,
    name: string,
    code: string,
  ): Promise<OpencodeMcpServerStatusDto> {
    return await this.makeRequest(
      clientId,
      agentId,
      {
        method: 'POST',
        url: `/${encodeURIComponent(name)}/auth/callback`,
        data: { code },
      },
      'opencode/mcp',
    );
  }

  async removeMcpAuth(clientId: string, agentId: string, name: string): Promise<{ success: true }> {
    return await this.makeRequest(
      clientId,
      agentId,
      {
        method: 'DELETE',
        url: `/${encodeURIComponent(name)}/auth`,
      },
      'opencode/mcp',
    );
  }
}
