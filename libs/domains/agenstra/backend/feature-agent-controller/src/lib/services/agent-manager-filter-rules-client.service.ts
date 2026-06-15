/* eslint-disable @typescript-eslint/no-var-requires */
import type {
  CreateRegexFilterRuleDto,
  RegexFilterRuleResponseDto,
  UpdateRegexFilterRuleDto,
} from '@forepath/agenstra/backend/feature-agent-manager';
import { AuthenticationType } from '@forepath/identity/backend';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import axios, { AxiosError, AxiosRequestConfig } from 'axios';

import { ClientsRepository } from '../repositories/clients.repository';
import { getClientEndpointTlsPolicy, validateClientEndpointWithDnsOrThrow } from '../utils/client-endpoint-security';
import { buildClientProxyRequestHeaders } from '../utils/client-proxy-request-headers';

import { ClientsService } from './clients.service';

/**
 * Calls agent-manager `/api/agents-filters` for a given workspace (client).
 */
@Injectable()
export class AgentManagerFilterRulesClientService {
  private readonly logger = new Logger(AgentManagerFilterRulesClientService.name);

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

  private buildBaseUrl(endpoint: string): string {
    const baseUrl = endpoint.replace(/\/$/, '');

    return `${baseUrl}/api/agents-filters`;
  }

  private async request<T>(clientId: string, config: AxiosRequestConfig): Promise<T> {
    const clientEntity = await this.clientsRepository.findByIdOrThrow(clientId);

    await validateClientEndpointWithDnsOrThrow(clientEntity.endpoint);
    const authHeader = await this.getAuthHeader(clientId);
    const baseUrl = this.buildBaseUrl(clientEntity.endpoint);
    const tlsPolicy = getClientEndpointTlsPolicy(this.logger);

    try {
      this.logger.debug(`Filter rules ${config.method} ${baseUrl}${config.url || ''} for client ${clientId}`);
      const response = await axios.request<T>({
        ...config,
        url: config.url ? `${baseUrl}${config.url}` : baseUrl,
        headers: buildClientProxyRequestHeaders(config.headers, authHeader),
        validateStatus: (status) => status < 500,
        httpsAgent: baseUrl.startsWith('https://')
          ? new (require('https').Agent)({ rejectUnauthorized: tlsPolicy.rejectUnauthorized })
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
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }

      const axiosError = error as AxiosError;

      if (axiosError.response) {
        const errorMessage =
          (axiosError.response.data as { message?: string })?.message || axiosError.message || 'Request failed';

        if (axiosError.response.status === 404) {
          throw new NotFoundException(errorMessage);
        }

        throw new BadRequestException(errorMessage);
      }

      throw new BadRequestException(axiosError.message || 'Request failed');
    }
  }

  async createRule(clientId: string, body: CreateRegexFilterRuleDto): Promise<RegexFilterRuleResponseDto> {
    return await this.request<RegexFilterRuleResponseDto>(clientId, { method: 'POST', data: body });
  }

  async updateRule(
    clientId: string,
    managerRuleId: string,
    body: UpdateRegexFilterRuleDto,
  ): Promise<RegexFilterRuleResponseDto> {
    return await this.request<RegexFilterRuleResponseDto>(clientId, {
      method: 'PUT',
      url: `/${managerRuleId}`,
      data: body,
    });
  }

  async deleteRule(clientId: string, managerRuleId: string): Promise<void> {
    await this.request<unknown>(clientId, { method: 'DELETE', url: `/${managerRuleId}` });
  }
}
