import { LatestAgentMessageDto } from '@forepath/framework/backend/feature-agent-manager';
import { AuthenticationType } from '@forepath/identity/backend';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import axios, { AxiosError, AxiosRequestConfig } from 'axios';

import { ClientsRepository } from '../repositories/clients.repository';
import { getClientEndpointTlsPolicy, validateClientEndpointWithDnsOrThrow } from '../utils/client-endpoint-security';
import { buildClientProxyRequestHeaders } from '../utils/client-proxy-request-headers';

import { ClientsService } from './clients.service';

@Injectable()
export class ClientAgentMessagesProxyService {
  private readonly logger = new Logger(ClientAgentMessagesProxyService.name);

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

  private buildMessagesUrl(endpoint: string, agentId: string): string {
    const baseUrl = endpoint.replace(/\/$/, '');

    return `${baseUrl}/api/agents/${agentId}/messages/latest-agent`;
  }

  private async makeRequest<T>(clientId: string, agentId: string, config: AxiosRequestConfig): Promise<T | null> {
    const clientEntity = await this.clientsRepository.findByIdOrThrow(clientId);

    await validateClientEndpointWithDnsOrThrow(clientEntity.endpoint);
    const authHeader = await this.getAuthHeader(clientId);
    const url = this.buildMessagesUrl(clientEntity.endpoint, agentId);
    const tlsPolicy = getClientEndpointTlsPolicy(this.logger);

    try {
      const response = await axios.request<T>({
        ...config,
        url,
        headers: buildClientProxyRequestHeaders(config.headers, authHeader),
        validateStatus: (status) => status < 500,
        timeout: process.env.REQUEST_TIMEOUT ? parseInt(process.env.REQUEST_TIMEOUT, 10) : 60000,
        httpsAgent: url.startsWith('https://')
          ? // eslint-disable-next-line @typescript-eslint/no-var-requires
            new (require('https').Agent)({
              rejectUnauthorized: tlsPolicy.rejectUnauthorized,
            })
          : undefined,
      });

      if (response.status === 404) {
        return null;
      }

      if (response.status >= 400) {
        const errorMessage = (response.data as { message?: string })?.message || 'Request failed';

        if (response.status === 404) {
          return null;
        }

        throw new BadRequestException(errorMessage);
      }

      return response.data;
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }

      const axiosError = error as AxiosError;

      if (axiosError.response?.status === 404) {
        return null;
      }

      this.logger.debug(
        `Latest agent message request failed for client ${clientId}, agent ${agentId}: ${axiosError.message}`,
      );

      return null;
    }
  }

  async getLatestAgentMessage(clientId: string, agentId: string): Promise<LatestAgentMessageDto | null> {
    return await this.makeRequest<LatestAgentMessageDto>(clientId, agentId, { method: 'GET' });
  }
}
