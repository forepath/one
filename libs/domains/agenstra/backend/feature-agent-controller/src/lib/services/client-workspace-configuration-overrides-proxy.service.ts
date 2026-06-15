/* eslint-disable @typescript-eslint/no-var-requires */
import {
  UpsertWorkspaceConfigurationOverrideDto,
  WorkspaceConfigurationSettingResponseDto,
} from '@forepath/agenstra/backend/feature-agent-manager';
import { AuthenticationType } from '@forepath/identity/backend';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import axios, { AxiosError, AxiosRequestConfig } from 'axios';

import { ClientsRepository } from '../repositories/clients.repository';
import { getClientEndpointTlsPolicy, validateClientEndpointWithDnsOrThrow } from '../utils/client-endpoint-security';
import { buildClientProxyRequestHeaders } from '../utils/client-proxy-request-headers';

import { ClientsService } from './clients.service';

@Injectable()
export class ClientWorkspaceConfigurationOverridesProxyService {
  private readonly logger = new Logger(ClientWorkspaceConfigurationOverridesProxyService.name);

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
    } else if (clientEntity.authenticationType === AuthenticationType.KEYCLOAK) {
      const token = await this.clientsService.getAccessToken(clientId);

      return `Bearer ${token}`;
    } else {
      throw new BadRequestException(`Unsupported authentication type: ${clientEntity.authenticationType}`);
    }
  }

  private buildConfigurationOverridesApiUrl(endpoint: string): string {
    const baseUrl = endpoint.replace(/\/$/, '');

    return `${baseUrl}/api/configuration-overrides`;
  }

  private async makeRequest<T>(clientId: string, config: AxiosRequestConfig): Promise<T> {
    const clientEntity = await this.clientsRepository.findByIdOrThrow(clientId);

    await validateClientEndpointWithDnsOrThrow(clientEntity.endpoint);
    const authHeader = await this.getAuthHeader(clientId);
    const baseUrl = this.buildConfigurationOverridesApiUrl(clientEntity.endpoint);
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

        this.logger.error(
          `Configuration override request to ${baseUrl}${config.url || ''} failed with status ${response.status}: ${errorMessage}`,
        );

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
      const errorMessage =
        (axiosError.response?.data as { message?: string } | undefined)?.message ||
        axiosError.message ||
        'Request failed';

      this.logger.error(`Configuration override proxy error for ${baseUrl}${config.url || ''}: ${errorMessage}`);
      throw new BadRequestException(errorMessage);
    }
  }

  async getConfigurationOverrides(clientId: string): Promise<WorkspaceConfigurationSettingResponseDto[]> {
    return await this.makeRequest<WorkspaceConfigurationSettingResponseDto[]>(clientId, {
      method: 'GET',
    });
  }

  async upsertConfigurationOverride(
    clientId: string,
    settingKey: string,
    dto: UpsertWorkspaceConfigurationOverrideDto,
  ): Promise<WorkspaceConfigurationSettingResponseDto> {
    return await this.makeRequest<WorkspaceConfigurationSettingResponseDto>(clientId, {
      method: 'PUT',
      url: `/${encodeURIComponent(settingKey)}`,
      data: dto,
    });
  }

  async deleteConfigurationOverride(clientId: string, settingKey: string): Promise<void> {
    await this.makeRequest<void>(clientId, {
      method: 'DELETE',
      url: `/${encodeURIComponent(settingKey)}`,
    });
  }
}
