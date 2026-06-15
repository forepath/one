import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/shared/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import { Observable } from 'rxjs';

import type {
  CreateEnvironmentVariableDto,
  EnvironmentVariableResponseDto,
  ListEnvironmentVariablesParams,
  UpdateEnvironmentVariableDto,
} from '../state/env/env.types';

@Injectable({
  providedIn: 'root',
})
export class EnvService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  /**
   * Get the base URL for the API.
   */
  private get apiUrl(): string {
    return this.environment.controller.restApiUrl;
  }

  /**
   * List all environment variables for a specific agent with optional pagination.
   */
  listEnvironmentVariables(
    clientId: string,
    agentId: string,
    params?: ListEnvironmentVariablesParams,
  ): Observable<EnvironmentVariableResponseDto[]> {
    let httpParams = new HttpParams();

    if (params?.limit !== undefined) {
      httpParams = httpParams.set('limit', params.limit.toString());
    }

    if (params?.offset !== undefined) {
      httpParams = httpParams.set('offset', params.offset.toString());
    }

    return this.http.get<EnvironmentVariableResponseDto[]>(
      `${this.apiUrl}/clients/${clientId}/agents/${agentId}/environment`,
      {
        params: httpParams,
      },
    );
  }

  /**
   * Get count of environment variables for a specific agent.
   */
  countEnvironmentVariables(clientId: string, agentId: string): Observable<{ count: number }> {
    return this.http.get<{ count: number }>(`${this.apiUrl}/clients/${clientId}/agents/${agentId}/environment/count`);
  }

  /**
   * Create a new environment variable for a specific agent.
   */
  createEnvironmentVariable(
    clientId: string,
    agentId: string,
    createDto: CreateEnvironmentVariableDto,
  ): Observable<EnvironmentVariableResponseDto> {
    return this.http.post<EnvironmentVariableResponseDto>(
      `${this.apiUrl}/clients/${clientId}/agents/${agentId}/environment`,
      createDto,
    );
  }

  /**
   * Update an existing environment variable for a specific agent.
   */
  updateEnvironmentVariable(
    clientId: string,
    agentId: string,
    envVarId: string,
    updateDto: UpdateEnvironmentVariableDto,
  ): Observable<EnvironmentVariableResponseDto> {
    return this.http.put<EnvironmentVariableResponseDto>(
      `${this.apiUrl}/clients/${clientId}/agents/${agentId}/environment/${envVarId}`,
      updateDto,
    );
  }

  /**
   * Delete an environment variable for a specific agent.
   */
  deleteEnvironmentVariable(clientId: string, agentId: string, envVarId: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/clients/${clientId}/agents/${agentId}/environment/${envVarId}`);
  }

  /**
   * Delete all environment variables for a specific agent.
   */
  deleteAllEnvironmentVariables(clientId: string, agentId: string): Observable<{ deletedCount: number }> {
    return this.http.delete<{ deletedCount: number }>(
      `${this.apiUrl}/clients/${clientId}/agents/${agentId}/environment`,
    );
  }
}
