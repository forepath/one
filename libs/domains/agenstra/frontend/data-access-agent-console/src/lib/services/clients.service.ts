import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/shared/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import { Observable } from 'rxjs';

import type {
  ClientAgentAutonomyResponseDto,
  UpsertClientAgentAutonomyDto,
} from '../state/client-agent-autonomy/client-agent-autonomy.types';
import type {
  AddClientUserDto,
  ClientResponseDto,
  ClientUserResponseDto,
  CreateClientDto,
  CreateClientResponseDto,
  ListClientsParams,
  ProvisionServerDto,
  ProvisionedServerResponseDto,
  ProvisioningProviderInfo,
  ProviderLocation,
  ServerInfo,
  ServerType,
  UpdateClientDto,
} from '../state/clients/clients.types';

@Injectable({
  providedIn: 'root',
})
export class ClientsService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  /**
   * Get the base URL for the API.
   */
  private get apiUrl(): string {
    return this.environment.controller.restApiUrl;
  }

  /**
   * List all clients with optional pagination.
   */
  listClients(params?: ListClientsParams): Observable<ClientResponseDto[]> {
    let httpParams = new HttpParams();

    if (params?.limit !== undefined) {
      httpParams = httpParams.set('limit', params.limit.toString());
    }

    if (params?.offset !== undefined) {
      httpParams = httpParams.set('offset', params.offset.toString());
    }

    return this.http.get<ClientResponseDto[]>(`${this.apiUrl}/clients`, {
      params: httpParams,
    });
  }

  /**
   * Get a client by ID.
   */
  getClient(id: string): Observable<ClientResponseDto> {
    return this.http.get<ClientResponseDto>(`${this.apiUrl}/clients/${id}`);
  }

  /**
   * Create a new client.
   */
  createClient(client: CreateClientDto): Observable<CreateClientResponseDto> {
    return this.http.post<CreateClientResponseDto>(`${this.apiUrl}/clients`, client);
  }

  /**
   * Update an existing client.
   */
  updateClient(id: string, client: UpdateClientDto): Observable<ClientResponseDto> {
    return this.http.post<ClientResponseDto>(`${this.apiUrl}/clients/${id}`, client);
  }

  /**
   * Delete a client.
   */
  deleteClient(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/clients/${id}`);
  }

  /**
   * List all available provisioning providers.
   */
  listProvisioningProviders(): Observable<ProvisioningProviderInfo[]> {
    return this.http.get<ProvisioningProviderInfo[]>(`${this.apiUrl}/clients/provisioning/providers`);
  }

  /**
   * Get available server types for a provisioning provider.
   */
  getServerTypes(providerType: string): Observable<ServerType[]> {
    return this.http.get<ServerType[]>(`${this.apiUrl}/clients/provisioning/providers/${providerType}/server-types`);
  }

  /**
   * Get available geography options for a provisioning provider.
   */
  getLocations(providerType: string): Observable<ProviderLocation[]> {
    return this.http.get<ProviderLocation[]>(`${this.apiUrl}/clients/provisioning/providers/${providerType}/locations`);
  }

  /**
   * Provision a new server and create a client.
   */
  provisionServer(dto: ProvisionServerDto): Observable<ProvisionedServerResponseDto> {
    return this.http.post<ProvisionedServerResponseDto>(`${this.apiUrl}/clients/provisioning/provision`, dto);
  }

  /**
   * Get server information for a provisioned client.
   */
  getServerInfo(clientId: string): Observable<ServerInfo> {
    return this.http.get<ServerInfo>(`${this.apiUrl}/clients/${clientId}/provisioning/info`);
  }

  /**
   * Delete a provisioned server and its associated client.
   */
  deleteProvisionedServer(clientId: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/clients/${clientId}/provisioning`);
  }

  /**
   * List users associated with a client.
   */
  getClientUsers(clientId: string): Observable<ClientUserResponseDto[]> {
    return this.http.get<ClientUserResponseDto[]>(`${this.apiUrl}/clients/${clientId}/users`);
  }

  /**
   * Add a user to a client by email.
   */
  addClientUser(clientId: string, dto: AddClientUserDto): Observable<ClientUserResponseDto> {
    return this.http.post<ClientUserResponseDto>(`${this.apiUrl}/clients/${clientId}/users`, dto);
  }

  /**
   * Remove a user from a client.
   */
  removeClientUser(clientId: string, relationshipId: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/clients/${clientId}/users/${relationshipId}`);
  }

  /**
   * Agent UUIDs with prototype autonomy enabled for this client (scheduler only considers these agents).
   */
  listEnabledAutonomyAgentIds(clientId: string): Observable<{ agentIds: string[] }> {
    return this.http.get<{ agentIds: string[] }>(`${this.apiUrl}/clients/${clientId}/agent-autonomy/enabled-agent-ids`);
  }

  getClientAgentAutonomy(clientId: string, agentId: string): Observable<ClientAgentAutonomyResponseDto> {
    return this.http.get<ClientAgentAutonomyResponseDto>(
      `${this.apiUrl}/clients/${clientId}/agents/${agentId}/autonomy`,
    );
  }

  upsertClientAgentAutonomy(
    clientId: string,
    agentId: string,
    dto: UpsertClientAgentAutonomyDto,
  ): Observable<ClientAgentAutonomyResponseDto> {
    return this.http.put<ClientAgentAutonomyResponseDto>(
      `${this.apiUrl}/clients/${clientId}/agents/${agentId}/autonomy`,
      dto,
    );
  }
}
