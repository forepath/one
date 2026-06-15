import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/shared/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import { Observable } from 'rxjs';

import type {
  AgentModelsMap,
  AgentResponseDto,
  CreateAgentDto,
  CreateAgentResponseDto,
  ListClientAgentsParams,
  UpdateAgentDto,
} from '../state/agents/agents.types';

@Injectable({
  providedIn: 'root',
})
export class AgentsService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  /**
   * Get the base URL for the API.
   */
  private get apiUrl(): string {
    return this.environment.controller.restApiUrl;
  }

  /**
   * List all agents for a specific client with optional pagination.
   */
  listClientAgents(clientId: string, params?: ListClientAgentsParams): Observable<AgentResponseDto[]> {
    let httpParams = new HttpParams();

    if (params?.limit !== undefined) {
      httpParams = httpParams.set('limit', params.limit.toString());
    }

    if (params?.offset !== undefined) {
      httpParams = httpParams.set('offset', params.offset.toString());
    }

    return this.http.get<AgentResponseDto[]>(`${this.apiUrl}/clients/${clientId}/agents`, {
      params: httpParams,
    });
  }

  /**
   * Get an agent by ID for a specific client.
   */
  getClientAgent(clientId: string, agentId: string): Observable<AgentResponseDto> {
    return this.http.get<AgentResponseDto>(`${this.apiUrl}/clients/${clientId}/agents/${agentId}`);
  }

  /**
   * List models available for an agent (proxied to agent-controller → agent-manager).
   */
  listClientAgentModels(clientId: string, agentId: string): Observable<AgentModelsMap> {
    return this.http.get<AgentModelsMap>(`${this.apiUrl}/clients/${clientId}/agents/${agentId}/models`);
  }

  /**
   * Create a new agent for a specific client.
   */
  createClientAgent(clientId: string, agent: CreateAgentDto): Observable<CreateAgentResponseDto> {
    return this.http.post<CreateAgentResponseDto>(`${this.apiUrl}/clients/${clientId}/agents`, agent);
  }

  /**
   * Update an existing agent for a specific client.
   */
  updateClientAgent(clientId: string, agentId: string, agent: UpdateAgentDto): Observable<AgentResponseDto> {
    return this.http.post<AgentResponseDto>(`${this.apiUrl}/clients/${clientId}/agents/${agentId}`, agent);
  }

  /**
   * Delete an agent for a specific client.
   */
  deleteClientAgent(clientId: string, agentId: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/clients/${clientId}/agents/${agentId}`);
  }

  /**
   * Start all containers for an agent for a specific client.
   */
  startClientAgent(clientId: string, agentId: string): Observable<AgentResponseDto> {
    return this.http.post<AgentResponseDto>(`${this.apiUrl}/clients/${clientId}/agents/${agentId}/start`, {});
  }

  /**
   * Stop all containers for an agent for a specific client.
   */
  stopClientAgent(clientId: string, agentId: string): Observable<AgentResponseDto> {
    return this.http.post<AgentResponseDto>(`${this.apiUrl}/clients/${clientId}/agents/${agentId}/stop`, {});
  }

  /**
   * Restart all containers for an agent for a specific client.
   */
  restartClientAgent(clientId: string, agentId: string): Observable<AgentResponseDto> {
    return this.http.post<AgentResponseDto>(`${this.apiUrl}/clients/${clientId}/agents/${agentId}/restart`, {});
  }
}
