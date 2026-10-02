import { CreateVncSessionResponseDto } from '@forepath/agenstra/backend/feature-agent-manager';
import { AuthenticationType } from '@forepath/identity/backend';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import axios, { AxiosError } from 'axios';

import { CreateClientVncSessionResponseDto } from '../dto/create-client-vnc-session-response.dto';
import { ClientsRepository } from '../repositories/clients.repository';
import { getClientEndpointTlsPolicy, validateClientEndpointWithDnsOrThrow } from '../utils/client-endpoint-security';
import { buildClientProxyRequestHeaders } from '../utils/client-proxy-request-headers';
import { buildRemoteVncWsUrl } from '../utils/remote-manager-url.utils';

import { ClientsService } from './clients.service';
import { ControllerVncTicketService } from './controller-vnc-ticket.service';

@Injectable()
export class ClientAgentVncProxyService {
  private readonly logger = new Logger(ClientAgentVncProxyService.name);

  constructor(
    private readonly clientsService: ClientsService,
    private readonly clientsRepository: ClientsRepository,
    private readonly controllerVncTicketService: ControllerVncTicketService,
  ) {}

  async createSession(
    clientId: string,
    agentId: string,
    access: { subject: string; isApiKeyAuth: boolean; userRole?: import('@forepath/identity/backend').UserRole },
  ): Promise<CreateClientVncSessionResponseDto> {
    const clientEntity = await this.clientsRepository.findByIdOrThrow(clientId);

    await validateClientEndpointWithDnsOrThrow(clientEntity.endpoint);

    const authHeader = await this.getAuthHeader(clientId);
    const baseUrl = this.buildAgentApiUrl(clientEntity.endpoint);
    const tlsPolicy = getClientEndpointTlsPolicy(this.logger);

    let managerSession: CreateVncSessionResponseDto;

    try {
      const response = await axios.request<CreateVncSessionResponseDto>({
        method: 'POST',
        url: `${baseUrl}/${agentId}/vnc/sessions`,
        headers: buildClientProxyRequestHeaders({}, authHeader),
        validateStatus: (status) => status < 500,
        timeout: 30_000,
        httpsAgent: baseUrl.startsWith('https://')
          ? // eslint-disable-next-line @typescript-eslint/no-var-requires
            new (require('https').Agent)({
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

      managerSession = response.data;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }

      const axiosError = error as AxiosError;
      const errorMessage =
        (axiosError.response?.data as { message?: string })?.message || axiosError.message || 'Request failed';

      this.logger.error(`Failed to mint manager VNC ticket for ${clientId}/${agentId}: ${errorMessage}`);
      throw new BadRequestException('Failed to create VNC session');
    }

    const managerWsUrl = this.buildManagerVncWsUrl(clientEntity.endpoint);
    const minted = await this.controllerVncTicketService.mint({
      clientId,
      agentId,
      subject: access.subject,
      isApiKeyAuth: access.isApiKeyAuth,
      userRole: access.userRole,
      managerTicket: managerSession.ticket,
      managerWsUrl,
      clientAuthHeader: authHeader,
      ttlMs: Math.min(60_000, Math.max(1_000, managerSession.expiresIn * 1000)),
    });

    return {
      ticket: minted.ticket,
      expiresIn: minted.expiresIn,
    };
  }

  buildManagerVncWsUrl(endpoint: string): string {
    return buildRemoteVncWsUrl(endpoint);
  }

  private buildAgentApiUrl(endpoint: string): string {
    const baseUrl = endpoint.replace(/\/$/, '');

    return `${baseUrl}/api/agents`;
  }

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
}
