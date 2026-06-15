import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import {
  clearEnvironmentVariables,
  createEnvironmentVariable,
  deleteAllEnvironmentVariables,
  deleteEnvironmentVariable,
  loadEnvironmentVariables,
  loadEnvironmentVariablesCount,
  updateEnvironmentVariable,
} from './env.actions';
import {
  selectEnvironmentVariableOperationLoading,
  selectEnvironmentVariablesCount,
  selectEnvironmentVariablesForAgent,
  selectEnvironmentVariablesOperationLoading,
  selectEnvError,
  selectEnvVarError,
  selectIsCreatingEnvironmentVariable,
  selectIsDeletingAllEnvironmentVariables,
  selectIsDeletingEnvironmentVariable,
  selectIsLoadingEnvironmentVariables,
  selectIsLoadingEnvironmentVariablesCount,
  selectIsUpdatingEnvironmentVariable,
} from './env.selectors';
import type {
  CreateEnvironmentVariableDto,
  EnvironmentVariableResponseDto,
  ListEnvironmentVariablesParams,
  UpdateEnvironmentVariableDto,
} from './env.types';

/**
 * Facade for environment variables state management.
 * Provides a clean API for components to interact with environment variables state
 * without directly accessing the NgRx store.
 * All operations are scoped to a specific client and agent.
 */
@Injectable({
  providedIn: 'root',
})
export class EnvFacade {
  private readonly store = inject(Store);

  /**
   * Get environment variables for a specific client and agent.
   * @param clientId - The client ID
   * @param agentId - The agent ID
   * @returns Observable of environment variables array or null if not loaded
   */
  getEnvironmentVariables$(clientId: string, agentId: string): Observable<EnvironmentVariableResponseDto[] | null> {
    return this.store.select(selectEnvironmentVariablesForAgent(clientId, agentId));
  }

  /**
   * Get count of environment variables for a specific client and agent.
   * @param clientId - The client ID
   * @param agentId - The agent ID
   * @returns Observable of count or null if not loaded
   */
  getEnvironmentVariablesCount$(clientId: string, agentId: string): Observable<number | null> {
    return this.store.select(selectEnvironmentVariablesCount(clientId, agentId));
  }

  /**
   * Get loading state for loading environment variables.
   * @param clientId - The client ID
   * @param agentId - The agent ID
   * @returns Observable of loading state
   */
  isLoadingEnvironmentVariables$(clientId: string, agentId: string): Observable<boolean> {
    return this.store.select(selectIsLoadingEnvironmentVariables(clientId, agentId));
  }

  /**
   * Get loading state for loading environment variables count.
   * @param clientId - The client ID
   * @param agentId - The agent ID
   * @returns Observable of loading state
   */
  isLoadingEnvironmentVariablesCount$(clientId: string, agentId: string): Observable<boolean> {
    return this.store.select(selectIsLoadingEnvironmentVariablesCount(clientId, agentId));
  }

  /**
   * Get loading state for creating an environment variable.
   * @param clientId - The client ID
   * @param agentId - The agent ID
   * @returns Observable of loading state
   */
  isCreatingEnvironmentVariable$(clientId: string, agentId: string): Observable<boolean> {
    return this.store.select(selectIsCreatingEnvironmentVariable(clientId, agentId));
  }

  /**
   * Get loading state for updating an environment variable.
   * @param clientId - The client ID
   * @param agentId - The agent ID
   * @param envVarId - The environment variable ID
   * @returns Observable of loading state
   */
  isUpdatingEnvironmentVariable$(clientId: string, agentId: string, envVarId: string): Observable<boolean> {
    return this.store.select(selectIsUpdatingEnvironmentVariable(clientId, agentId, envVarId));
  }

  /**
   * Get loading state for deleting an environment variable.
   * @param clientId - The client ID
   * @param agentId - The agent ID
   * @param envVarId - The environment variable ID
   * @returns Observable of loading state
   */
  isDeletingEnvironmentVariable$(clientId: string, agentId: string, envVarId: string): Observable<boolean> {
    return this.store.select(selectIsDeletingEnvironmentVariable(clientId, agentId, envVarId));
  }

  /**
   * Get loading state for deleting all environment variables.
   * @param clientId - The client ID
   * @param agentId - The agent ID
   * @returns Observable of loading state
   */
  isDeletingAllEnvironmentVariables$(clientId: string, agentId: string): Observable<boolean> {
    return this.store.select(selectIsDeletingAllEnvironmentVariables(clientId, agentId));
  }

  /**
   * Get combined loading state for any environment variables operation.
   * @param clientId - The client ID
   * @param agentId - The agent ID
   * @returns Observable of combined loading state
   */
  isEnvironmentVariablesOperationLoading$(clientId: string, agentId: string): Observable<boolean> {
    return this.store.select(selectEnvironmentVariablesOperationLoading(clientId, agentId));
  }

  /**
   * Get combined loading state for a specific environment variable operation.
   * @param clientId - The client ID
   * @param agentId - The agent ID
   * @param envVarId - The environment variable ID
   * @returns Observable of combined loading state
   */
  isEnvironmentVariableOperationLoading$(clientId: string, agentId: string, envVarId: string): Observable<boolean> {
    return this.store.select(selectEnvironmentVariableOperationLoading(clientId, agentId, envVarId));
  }

  /**
   * Get error state for environment variables operations.
   * @param clientId - The client ID
   * @param agentId - The agent ID
   * @returns Observable of error message or null
   */
  getEnvError$(clientId: string, agentId: string): Observable<string | null> {
    return this.store.select(selectEnvError(clientId, agentId));
  }

  /**
   * Get error state for a specific environment variable operation.
   * @param clientId - The client ID
   * @param agentId - The agent ID
   * @param envVarId - The environment variable ID
   * @returns Observable of error message or null
   */
  getEnvVarError$(clientId: string, agentId: string, envVarId: string): Observable<string | null> {
    return this.store.select(selectEnvVarError(clientId, agentId, envVarId));
  }

  /**
   * Load environment variables for a specific agent.
   * @param clientId - The client ID
   * @param agentId - The agent ID
   * @param params - Optional pagination parameters
   */
  loadEnvironmentVariables(clientId: string, agentId: string, params?: ListEnvironmentVariablesParams): void {
    this.store.dispatch(loadEnvironmentVariables({ clientId, agentId, params }));
  }

  /**
   * Load count of environment variables for a specific agent.
   * @param clientId - The client ID
   * @param agentId - The agent ID
   */
  loadEnvironmentVariablesCount(clientId: string, agentId: string): void {
    this.store.dispatch(loadEnvironmentVariablesCount({ clientId, agentId }));
  }

  /**
   * Create a new environment variable for a specific agent.
   * @param clientId - The client ID
   * @param agentId - The agent ID
   * @param createDto - The environment variable creation data
   */
  createEnvironmentVariable(clientId: string, agentId: string, createDto: CreateEnvironmentVariableDto): void {
    this.store.dispatch(createEnvironmentVariable({ clientId, agentId, createDto }));
  }

  /**
   * Update an existing environment variable for a specific agent.
   * @param clientId - The client ID
   * @param agentId - The agent ID
   * @param envVarId - The environment variable ID
   * @param updateDto - The environment variable update data
   */
  updateEnvironmentVariable(
    clientId: string,
    agentId: string,
    envVarId: string,
    updateDto: UpdateEnvironmentVariableDto,
  ): void {
    this.store.dispatch(updateEnvironmentVariable({ clientId, agentId, envVarId, updateDto }));
  }

  /**
   * Delete an environment variable for a specific agent.
   * @param clientId - The client ID
   * @param agentId - The agent ID
   * @param envVarId - The environment variable ID
   */
  deleteEnvironmentVariable(clientId: string, agentId: string, envVarId: string): void {
    this.store.dispatch(deleteEnvironmentVariable({ clientId, agentId, envVarId }));
  }

  /**
   * Delete all environment variables for a specific agent.
   * @param clientId - The client ID
   * @param agentId - The agent ID
   */
  deleteAllEnvironmentVariables(clientId: string, agentId: string): void {
    this.store.dispatch(deleteAllEnvironmentVariables({ clientId, agentId }));
  }

  /**
   * Clear cached environment variables for a specific client and agent.
   * @param clientId - The client ID
   * @param agentId - The agent ID
   */
  clearEnvironmentVariables(clientId: string, agentId: string): void {
    this.store.dispatch(clearEnvironmentVariables({ clientId, agentId }));
  }
}
